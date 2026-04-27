/**
 * Daily enrichment pipeline — problem-first company discovery.
 *
 * 1. DISCOVER: Search for evidence of problems (not company filters)
 *    - Exa: companies in the news for complaints, enforcement, CX issues
 *    - Exa: companies actively hiring to fix the problem
 *    - Apollo: companies with specific compliance/CX job titles posted NOW
 *
 * 2. ENRICH: Apollo org enrich for firmographics
 *
 * 3. CONTACTS: Apollo people search — C-suite/VP/Director only
 *
 * 4. SIGNALS: Exa searches for fresh Trustpilot, regulatory, hiring evidence
 *
 * 5. SCORE: Based on signal evidence, not company filters
 *
 * 6. OUTPUT: Insert into DB, generate CSVs, post Slack briefing
 */

const EXA_API_KEY = process.env.EXA_API_KEY;
const EXA_BASE = "https://api.exa.ai/search";

interface ExaResult {
  title: string;
  url: string;
  publishedDate: string | null;
  text: string | null;
  highlights?: string[];
}

async function exaSearch(
  query: string,
  numResults = 10,
  daysBack = 7,
): Promise<ExaResult[]> {
  if (!EXA_API_KEY) return [];
  const startDate = new Date(Date.now() - daysBack * 86400000)
    .toISOString()
    .split("T")[0];

  try {
    const res = await fetch(EXA_BASE, {
      method: "POST",
      headers: { "x-api-key": EXA_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        numResults,
        useAutoprompt: true,
        type: "neural",
        startPublishedDate: startDate,
        contents: { text: { maxCharacters: 500 } },
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data as { results: ExaResult[] }).results ?? [];
  } catch {
    return [];
  }
}

// ── Step 1: Problem-first discovery ──────────────────────────────────

interface DiscoveredCompany {
  name: string;
  domain: string | null;
  source: string;
  evidence: string;
}

// Extract company domains from Exa search results — ONLY use the domain, never article titles
function extractCompaniesFromResults(
  results: ExaResult[],
  source: string,
): DiscoveredCompany[] {
  const companies: DiscoveredCompany[] = [];

  for (const r of results) {
    const domain = extractDomain(r.url);
    if (!domain) continue;

    // Skip if the URL is a news/aggregator site — we want the company being discussed, not the publisher
    const skipPublishers = [
      "reuters.com",
      "bloomberg.com",
      "cnbc.com",
      "wsj.com",
      "nytimes.com",
      "consumerfinance.gov",
      "ftc.gov",
      "sec.gov",
      "occ.gov",
      "fdic.gov",
      "trustpilot.com",
      "reddit.com",
      "bbb.org",
      "g2.com",
      "glassdoor.com",
      "indeed.com",
      "linkedin.com",
      "twitter.com",
      "facebook.com",
      "youtube.com",
      "wikipedia.org",
      "investopedia.com",
      "forbes.com",
      "propublica.org",
      "pymnts.com",
      "finextra.com",
      "americanbanker.com",
      "housingwire.com",
      "nationalmortgagenews.com",
      "medium.com",
      "substack.com",
      "techcrunch.com",
      "crunchbase.com",
      "pitchbook.com",
      "github.com",
      "law.com",
      "jdsupra.com",
      "govping.com",
      "changeflow.com",
      "govinfo.gov",
      "federalregister.gov",
      "marketwatch.com",
      "seekingalpha.com",
      "yahoo.com",
      "google.com",
      "nclc.org",
      "stateagencyreport.com",
      "bedgut.com",
      "auto.com",
    ];
    if (skipPublishers.some((d) => domain.includes(d))) continue;
    if (domain.endsWith(".gov") || domain.endsWith(".edu")) continue;

    // Use domain as the name (cleaned up) — never use article titles
    const cleanName = domain
      .replace(/^www\./, "")
      .replace(/\.(com|co|io|net|org|llc)$/, "")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    companies.push({
      name: cleanName,
      domain: domain.replace(/^www\./, ""),
      source,
      evidence: (r.text ?? r.title ?? "").slice(0, 200),
    });
  }

  return companies;
}

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

interface DiscoveryQueries {
  preset: string;
  // Problem evidence queries — find companies experiencing the problem
  problemQueries: Array<{ query: string; daysBack: number }>;
  // Effort to solve queries — find companies actively trying to fix it
  effortQueries: Array<{ query: string; daysBack: number }>;
}

const DISCOVERY_QUERIES: DiscoveryQueries[] = [
  {
    preset: "complaints",
    problemQueries: [
      {
        query: "auto finance company CFPB enforcement complaint 2026",
        daysBack: 30,
      },
      {
        query:
          "consumer lender Trustpilot complaints terrible service auto loan 2026",
        daysBack: 14,
      },
      {
        query:
          "auto finance company fined OR settlement consumer protection 2026",
        daysBack: 30,
      },
      {
        query:
          "mortgage servicer complaints rising CFPB consumer financial protection",
        daysBack: 14,
      },
    ],
    effortQueries: [
      {
        query:
          'auto finance OR consumer lending company "hired" OR "appointed" Chief Compliance Officer 2026',
        daysBack: 30,
      },
      {
        query:
          'lending company hiring "complaints manager" OR "compliance analyst" OR "consumer affairs"',
        daysBack: 14,
      },
    ],
  },
  {
    preset: "sales-compliance",
    problemQueries: [
      {
        query:
          "auto lender UDAAP violation OR misleading sales practices enforcement 2026",
        daysBack: 30,
      },
      {
        query: "consumer lending company fair lending violation CFPB ECOA 2026",
        daysBack: 30,
      },
      {
        query: "auto dealer finance compliance failure disclosure violation",
        daysBack: 14,
      },
    ],
    effortQueries: [
      {
        query:
          'auto finance OR lending "hiring" sales compliance OR fair lending officer OR compliance monitoring',
        daysBack: 14,
      },
    ],
  },
  {
    preset: "qa",
    problemQueries: [
      {
        query:
          "fintech OR SaaS company scaling customer support team growing 2026",
        daysBack: 14,
      },
      {
        query: "company poor customer service Trustpilot CSAT dropping fintech",
        daysBack: 14,
      },
      {
        query: "contact center QA quality assurance challenge scaling",
        daysBack: 14,
      },
    ],
    effortQueries: [
      {
        query:
          'fintech OR SaaS "hired" OR "appointed" Head of CX OR VP Customer Experience 2026',
        daysBack: 30,
      },
      {
        query: "company deployed AI chatbot AI agent customer service 2026",
        daysBack: 14,
      },
      {
        query:
          'company hiring "QA Manager" OR "Quality Analyst" OR "Head of Customer Experience" customer support',
        daysBack: 14,
      },
    ],
  },
];

export async function discoverCompanies(
  preset: string,
  targetCount = 30,
): Promise<DiscoveredCompany[]> {
  const config = DISCOVERY_QUERIES.find((d) => d.preset === preset);
  if (!config) return [];

  const allCompanies: DiscoveredCompany[] = [];
  const seenDomains = new Set<string>();

  // Run problem queries
  for (const q of config.problemQueries) {
    const results = await exaSearch(q.query, 10, q.daysBack);
    const companies = extractCompaniesFromResults(results, "problem_evidence");
    for (const c of companies) {
      if (c.domain && !seenDomains.has(c.domain)) {
        seenDomains.add(c.domain);
        allCompanies.push(c);
      }
    }
    if (allCompanies.length >= targetCount) break;
  }

  // Run effort queries
  for (const q of config.effortQueries) {
    const results = await exaSearch(q.query, 10, q.daysBack);
    const companies = extractCompaniesFromResults(results, "effort_to_solve");
    for (const c of companies) {
      if (c.domain && !seenDomains.has(c.domain)) {
        seenDomains.add(c.domain);
        allCompanies.push(c);
      }
    }
    if (allCompanies.length >= targetCount) break;
  }

  return allCompanies.slice(0, targetCount);
}

// ── Step 4: Run signal evidence searches ─────────────────────────────

export interface SignalResult {
  signalName: string;
  found: boolean;
  summary: string;
  confidence: "high" | "medium" | "low";
  evidence: Array<{ url: string; snippet: string }>;
  hits: number;
}

interface SignalQuery {
  name: string;
  query: string;
  daysBack: number;
  presets: string[];
}

const SIGNAL_SEARCHES: SignalQuery[] = [
  {
    name: "Consumer Complaints (Trustpilot/BBB/CFPB)",
    query:
      '"{company}" complaints OR negative reviews OR terrible service site:trustpilot.com OR site:bbb.org OR site:consumerfinance.gov',
    daysBack: 7,
    presets: ["complaints", "sales-compliance"],
  },
  {
    name: "Regulatory Action",
    query:
      '"{company}" CFPB OR consent order OR enforcement action OR fine OR state attorney general',
    daysBack: 30,
    presets: ["complaints", "sales-compliance"],
  },
  {
    name: "Negative Reddit Sentiment",
    query:
      '"{company}" complaints OR scam OR worst experience OR ripoff site:reddit.com',
    daysBack: 14,
    presets: ["complaints"],
  },
  {
    name: "CX / Ops Hiring",
    query:
      '"{company}" hiring OR hired Head of CX OR VP Customer Experience OR QA Manager OR complaints analyst',
    daysBack: 14,
    presets: ["complaints", "qa"],
  },
  {
    name: "AI Agent Deployment",
    query:
      '"{company}" AI agent OR AI chatbot OR conversational AI customer service deployed OR launched',
    daysBack: 14,
    presets: ["qa"],
  },
  {
    name: "Scaling / Growth",
    query:
      '"{company}" expansion OR raised OR funding OR new office OR growing team',
    daysBack: 14,
    presets: ["qa"],
  },
  {
    name: "UDAAP / Sales Practice Risk",
    query:
      '"{company}" UDAAP OR misleading OR disclosure failure OR fair lending violation',
    daysBack: 30,
    presets: ["sales-compliance"],
  },
  {
    name: "Marketing / Website Compliance Risk",
    query:
      '"{company}" misleading advertising OR deceptive marketing OR missing disclaimers lending',
    daysBack: 30,
    presets: ["sales-compliance"],
  },
];

export async function runSignals(
  companyName: string,
  preset: string,
  domain?: string | null,
): Promise<SignalResult[]> {
  const applicableSignals = SIGNAL_SEARCHES.filter((s) =>
    s.presets.includes(preset),
  );
  const results: SignalResult[] = [];

  for (const signal of applicableSignals) {
    const query = signal.query.replace(/\{company\}/g, companyName);
    const hits = await exaSearch(query, 3, signal.daysBack);
    const found = hits.length > 0;

    // Build evidence with proper source URLs
    const evidence = hits.slice(0, 3).map((h) => ({
      url: h.url,
      snippet: (h.text ?? h.title ?? "")
        .slice(0, 150)
        .replace(/\n/g, " ")
        .trim(),
    }));

    // Always add direct source links for relevant signals
    if (signal.name.includes("Consumer Complaints") && domain) {
      const cleanDomain = domain.replace(/^www\./, "");
      evidence.unshift({
        url: `https://www.trustpilot.com/review/${cleanDomain}`,
        snippet: `Trustpilot reviews for ${companyName}`,
      });
      evidence.push({
        url: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/?company=${encodeURIComponent(companyName)}`,
        snippet: `CFPB complaint database for ${companyName}`,
      });
    }
    if (signal.name.includes("Regulatory") && domain) {
      evidence.push({
        url: `https://www.consumerfinance.gov/enforcement/actions/?title=${encodeURIComponent(companyName)}`,
        snippet: `CFPB enforcement actions for ${companyName}`,
      });
    }
    if (signal.name.includes("Reddit")) {
      evidence.push({
        url: `https://www.reddit.com/search/?q=${encodeURIComponent(companyName + " complaints")}`,
        snippet: `Reddit search for ${companyName} complaints`,
      });
    }
    if (signal.name.includes("Hiring") && domain) {
      evidence.push({
        url: `https://www.linkedin.com/company/${cleanDomainForLinkedIn(domain)}/jobs/`,
        snippet: `LinkedIn jobs at ${companyName}`,
      });
    }

    results.push({
      signalName: signal.name,
      found,
      summary: found
        ? (hits[0].text ?? hits[0].title ?? "")
            .slice(0, 200)
            .replace(/\n/g, " ")
            .trim()
        : "No results found",
      confidence: found && hits.length >= 2 ? "high" : found ? "medium" : "low",
      evidence: evidence.slice(0, 5),
      hits: hits.length,
    });
  }

  return results;
}

function cleanDomainForLinkedIn(domain: string): string {
  return domain.replace(/^www\./, "").replace(/\.(com|co|io|net|org)$/, "");
}

// ── Step 5: Score ────────────────────────────────────────────────────

export function scoreCompany(
  signals: SignalResult[],
  _preset: string,
): { score: number; reason: string; confidence: "High" | "Medium" | "Low" } {
  const fired = signals.filter((s) => s.found);
  const highConfidence = fired.filter((s) => s.confidence === "high");

  let score = 7; // Base ICP fit
  let reason = "Static ICP fit";
  let confidence: "High" | "Medium" | "Low" = "Low";

  if (fired.some((s) => s.signalName.includes("Regulatory"))) {
    score = 10;
    reason = fired
      .find((s) => s.signalName.includes("Regulatory"))!
      .summary.slice(0, 100);
    confidence = "High";
  } else if (fired.some((s) => s.signalName.includes("Consumer Complaints"))) {
    score = 9;
    reason = fired
      .find((s) => s.signalName.includes("Consumer Complaints"))!
      .summary.slice(0, 100);
    confidence = "High";
  } else if (fired.some((s) => s.signalName.includes("UDAAP"))) {
    score = 9;
    reason = fired
      .find((s) => s.signalName.includes("UDAAP"))!
      .summary.slice(0, 100);
    confidence = "High";
  } else if (highConfidence.length >= 2) {
    score = 8;
    reason = highConfidence.map((s) => s.signalName).join(" + ");
    confidence = "Medium";
  } else if (fired.length > 0) {
    score = 8;
    reason = fired.map((s) => s.signalName).join(" + ");
    confidence = "Medium";
  }

  return { score, reason, confidence };
}

// ── ICP Classification ───────────────────────────────────────────────

export function classifyICP(
  signals: SignalResult[],
  preset: string,
): { primary: string; secondary: string[]; reasoning: string } {
  const icpLabels: Record<string, string> = {
    complaints: "Complaints Ops",
    "sales-compliance": "Sales Compliance / Marketing Review",
    qa: "QA / Agent Performance / Coaching",
  };

  const primary = icpLabels[preset] ?? preset;
  const secondary: string[] = [];
  let reasoning = "";

  const fired = signals.filter((s) => s.found);

  if (preset === "complaints") {
    reasoning = "Company shows evidence of complaint handling gaps";
    if (fired.some((s) => s.signalName.includes("CX"))) {
      secondary.push("QA / Agent Performance / Coaching");
      reasoning += " + actively hiring CX leadership (cross-sell opportunity)";
    }
  } else if (preset === "sales-compliance") {
    reasoning =
      "Company shows evidence of sales practice risk or regulatory pressure";
    if (fired.some((s) => s.signalName.includes("Consumer Complaints"))) {
      secondary.push("Complaints Ops");
      reasoning +=
        " + consumer complaint volume indicates complaint handling gap too";
    }
  } else if (preset === "qa") {
    reasoning = "Company is scaling CX and needs QA coverage at scale";
    if (fired.some((s) => s.signalName.includes("AI Agent"))) {
      reasoning += " — deploying AI agents that need QA monitoring";
    }
  }

  return { primary, secondary, reasoning };
}

// ── Generate outreach for one company ────────────────────────────────

export interface EnrichedCompanyOutput {
  // Company overview
  name: string;
  domain: string | null;
  headcount: number | null;
  industry: string | null;
  location: string | null;

  // ICP classification
  icpPrimary: string;
  icpSecondary: string[];
  icpReasoning: string;

  // Trending signals (top 3)
  signals: SignalResult[];

  // Score
  score: number;
  scoreReason: string;
  confidence: "High" | "Medium" | "Low";

  // Contacts
  contacts: Array<{
    name: string;
    title: string | null;
    email: string | null;
    linkedinUrl: string | null;
  }>;

  // Suggested outreach
  linkedinNote: string;
  message: string;
  callOpener: string;
  pitchAngle: string;

  // Sources
  sources: string[];
}

export function generateOutreach(
  companyName: string,
  signals: SignalResult[],
  preset: string,
  contactName?: string,
): {
  linkedinNote: string;
  message: string;
  callOpener: string;
  pitchAngle: string;
  creativePlay: string;
} {
  const fired = signals.filter((s) => s.found);
  const topSignal = fired[0];
  const first = contactName ?? "there";

  const pitchAngles: Record<string, string> = {
    complaints:
      "We detect 100% of complaints — including the 70% agents never log — before they become enforcement actions.",
    "sales-compliance":
      "We monitor every sales call for UDAAP, disclosure, and fair lending violations with auditable evidence examiners want to see.",
    qa: "We replace 1-3% manual sampling with 100% AI-powered QA across every channel.",
  };
  const pitchAngle = pitchAngles[preset] ?? pitchAngles.qa;

  let linkedinNote = "";
  let message = "";
  let callOpener = "";
  let creativePlay = "";

  if (preset === "complaints") {
    if (topSignal?.signalName.includes("Regulatory")) {
      linkedinNote = `Hi ${first} — saw the CFPB activity around ${companyName}. We help lenders catch the complaints that lead to enforcement before they compound. Thought it might be timely.`;
      message = `Hi ${first},\n\nThe regulatory activity around ${companyName} caught my attention. The pattern we see: complaint detection is almost always the root cause. Agents manually log maybe 30% of actual dissatisfaction — the rest festers until an examiner finds it.\n\nWe built Rulebase for exactly this. AI that flags every expression of dissatisfaction across every call, with timestamps and citations.\n\n15 minutes to show you?`;
      callOpener = `Hi ${first} — following up on a note I sent about complaint monitoring at ${companyName}. Quick question: right now, how are you catching the complaints that agents don't manually escalate?`;
      creativePlay = `Send a "Compliance Survival Kit" to ${first} at ${companyName} HQ — a small box with a branded stress ball, a one-pager titled "The 70% Problem: What Your Agents Aren't Logging," and a QR code to a 3-min Loom demo. Handwritten note: "Thought this might be useful given what's been happening. — Gideon"`;
    } else if (
      topSignal?.signalName.includes("Consumer") ||
      topSignal?.signalName.includes("Trustpilot")
    ) {
      linkedinNote = `Hi ${first} — ${companyName}'s Trustpilot caught my eye. We help lenders catch the complaints behind those reviews before they escalate. Worth connecting?`;
      message = `Hi ${first},\n\n${companyName}'s public reviews paint a picture — and what we consistently see is that the reviews are just the tip. For every Trustpilot complaint, there are 5-10 expressions of dissatisfaction buried in calls that never get logged.\n\nRulebase surfaces all of them automatically. No manual tagging, no missed complaints.\n\nOpen to a quick look?`;
      callOpener = `Hi ${first} — sent a note about the Trustpilot trends at ${companyName}. Curious: are you seeing the same themes internally that customers are posting publicly?`;
      creativePlay = `Print ${companyName}'s top 5 worst Trustpilot reviews on individual cards. On the back of each: "Rulebase would have caught this before it went public." Mail in a clean envelope to ${first} with a sticky note: "These are just the ones who bothered to post. Happy to show you the rest. — Gideon" + Calendly link.`;
    } else {
      linkedinNote = `Hi ${first} — we help lenders like ${companyName} catch the 70% of complaints agents never log. Would love to connect.`;
      message = `Hi ${first},\n\nQuick question: what percentage of customer complaints at ${companyName} do you think actually get logged?\n\nIndustry average is about 30%. The rest — implicit dissatisfaction, vague frustration, "I want to speak to someone else" — never makes it into a report. Until an examiner asks for it.\n\nRulebase catches all of it. Worth 15 min?`;
      callOpener = `Hi ${first} — if I told you that most lenders only capture about a third of actual complaints, would that surprise you?`;
      creativePlay = `Send a dozen cupcakes from a bakery near ${companyName}'s HQ. Each cupcake has a tiny flag: "1 in 3." Card reads: "You're only catching 1 in 3 complaints. Let us show you the other two. — Gideon @ Rulebase" with Calendly link.`;
    }
  } else if (preset === "sales-compliance") {
    if (
      topSignal?.signalName.includes("Regulatory") ||
      topSignal?.signalName.includes("UDAAP")
    ) {
      linkedinNote = `Hi ${first} — the enforcement landscape in auto finance is intense. We help lenders monitor 100% of sales calls for UDAAP violations. Thought ${companyName} might benefit.`;
      message = `Hi ${first},\n\nThe enforcement wave in auto finance is real — and ${companyName} operates in exactly the space regulators are watching.\n\nWhat we keep seeing: compliance samples 2-3% of calls, but 10-15% have disclosure gaps. The math doesn't work.\n\nRulebase monitors every call with auditable evidence. When the examiner asks, you have it.\n\nWorth a conversation?`;
      callOpener = `Hi ${first} — if a CFPB examiner pulled 50 random sales calls from ${companyName} tomorrow, how confident are you every disclosure was made correctly on all 50?`;
      creativePlay = `Create a "CFPB Exam Prep Box" — branded folder with: (1) top 5 UDAAP violations in auto finance this year, (2) a mock exam checklist "What Examiners Actually Ask For," (3) USB with a 5-min Rulebase demo. FedEx to ${first} at ${companyName}. Folder cover: "For when the examiner calls." Note: "No sales pitch — just thought this would be useful. — Gideon"`;
    } else {
      linkedinNote = `Hi ${first} — ${companyName} has the kind of sales operation CFPB examiners love to audit. We make sure every call is clean. Worth connecting?`;
      message = `Hi ${first},\n\nSales reps skip or botch required disclosures on roughly 10-15% of calls. At ${companyName}'s scale, that's hundreds of violations per month nobody catches until an examiner does.\n\nRulebase listens to every call and flags the gaps in real time. Deploys in days.\n\nRelevant?`;
      callOpener = `Hi ${first} — what percentage of ${companyName}'s sales calls are being reviewed for compliance today? We find most teams are under 5%, and that's where the risk lives.`;
      creativePlay = `Rent a mobile billboard truck to drive past ${companyName}'s HQ for one morning. Billboard: "10-15% of your sales calls have compliance gaps. We can prove it." + QR code. Then send ${first} a photo of the truck: "Not subtle, I know. But neither are CFPB fines. 15 min? — Gideon" (Top 3 targets only.)`;
    }
  } else if (preset === "qa") {
    if (topSignal?.signalName.includes("AI")) {
      linkedinNote = `Hi ${first} — saw ${companyName} is going big on AI for CX. Who QAs the AI? We built that. Would love to connect.`;
      message = `Hi ${first},\n\nSaw ${companyName} is deploying AI across CX — and it creates a problem nobody had 18 months ago: who quality-checks the AI?\n\nYour QA team can't manually review AI conversations at scale. Regulators expect the same oversight on AI as human interactions.\n\nRulebase evaluates 100% of both. Worth a look?`;
      callOpener = `Hi ${first} — how are you monitoring quality on the AI-handled conversations at ${companyName} right now?`;
      creativePlay = `Send a "Robot Report Card" — novelty report card grading ${companyName}'s AI agent: Communication A-, Accuracy ?, Compliance ?, Empathy C+. Inside: "Your AI is handling thousands of conversations. Who's grading them? — Gideon @ Rulebase" + Calendly. Ship to ${first}.`;
    } else if (
      topSignal?.signalName.includes("Hiring") ||
      topSignal?.signalName.includes("CX")
    ) {
      linkedinNote = `Hi ${first} — congrats on the CX build-out at ${companyName}. We help new CX leaders get instant visibility into quality. Would love to connect.`;
      message = `Hi ${first},\n\nNoticed ${companyName} is investing in CX. First thing new CX leaders discover: QA covers 1-3% of conversations — nowhere near enough to spot systemic issues.\n\nRulebase gets you to 100% in days. Every call, chat, email scored against your criteria.\n\n15 minutes?`;
      callOpener = `Hi ${first} — what does QA coverage look like at ${companyName} today? Percentage of conversations reviewed?`;
      creativePlay = `Send a jar of 100 jelly beans to ${first} at ${companyName}. 97 white, 3 red. Label: "You're reviewing 3 out of every 100 conversations. How sure are you about the other 97?" Card: "Rulebase reviews all 100. 15 min to show you? — Gideon" + Calendly.`;
    } else {
      linkedinNote = `Hi ${first} — ${companyName} is scaling fast. QA is usually the first thing that breaks. We fix that.`;
      message = `Hi ${first},\n\nMost CX teams review 1-3% of conversations hoping the sample is representative. It never is.\n\nRulebase evaluates 100% automatically — coaching insights, compliance flags, trend detection — without adding headcount.\n\nRelevant for ${companyName}?`;
      callOpener = `Hi ${first} — roughly what percentage of customer conversations does ${companyName} review for quality? And does that give you the full picture?`;
      creativePlay = `Mail a magnifying glass to ${first} at ${companyName}. Tag: "You're using this to review 3% of conversations. We review 100% without it." Back: "No gimmick — just math. — Gideon @ Rulebase" + QR to Calendly.`;
    }
  }

  return { linkedinNote, message, callOpener, pitchAngle, creativePlay };
}
