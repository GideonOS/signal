import { getAdminClient } from "@/lib/supabase/admin";

function esc(value: string | null | undefined): string {
  if (!value) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: Request) {
  const supabase = getAdminClient();

  const { searchParams } = new URL(request.url);
  const preset = searchParams.get("preset");
  const campaignId = searchParams.get("campaignId");

  // Get campaign IDs
  let campaignIds: string[] = [];
  if (preset) {
    const { data } = await supabase
      .from("campaigns")
      .select("id")
      .eq("icp_preset_slug", preset);
    campaignIds = (data ?? []).map((c) => c.id as string);
  } else if (campaignId) {
    campaignIds = [campaignId];
  }

  if (campaignIds.length === 0)
    return new Response("No campaigns found", { status: 404 });

  // Get the preset slug for outreach generation
  const presetSlug = preset ?? "qa";

  // Fetch companies
  const { data: companyRows } = await supabase
    .from("campaign_organizations")
    .select(
      `
      relevance_score, score_reason, status, suggested_approach,
      organization:organizations!inner(id, name, domain, industry, location, enrichment_data)
    `,
    )
    .in("campaign_id", campaignIds)
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .limit(100);

  // Fetch contacts
  const { data: contactRows } = await supabase
    .from("campaign_people")
    .select(
      `
      priority_score, generated_email_subject, generated_email_body,
      person:people!inner(name, work_email, personal_email, title, linkedin_url, organization_id)
    `,
    )
    .in("campaign_id", campaignIds)
    .order("priority_score", { ascending: false, nullsFirst: false })
    .limit(300);

  // Contact map by org ID
  const contactMap = new Map<string, Array<Record<string, unknown>>>();
  for (const cr of (contactRows ?? []) as unknown as Array<
    Record<string, unknown>
  >) {
    const person = cr.person as Record<string, unknown>;
    const orgId = person?.organization_id as string;
    if (!orgId) continue;
    if (!contactMap.has(orgId)) contactMap.set(orgId, []);
    contactMap.get(orgId)!.push({ ...cr, person });
  }

  // Fetch signal results
  const orgIds = (
    (companyRows ?? []) as unknown as Array<Record<string, unknown>>
  )
    .map((c) => {
      const org = c.organization as Record<string, unknown>;
      return org.id as string;
    })
    .filter(Boolean);

  const signalAccum = new Map<string, string[]>();
  if (orgIds.length > 0) {
    const { data: signalRows } = await supabase
      .from("signal_results")
      .select("organization_id, output, signal:signals!inner(name)")
      .in("organization_id", orgIds)
      .eq("status", "success")
      .order("ran_at", { ascending: false })
      .limit(300);

    for (const sr of (signalRows ?? []) as unknown as Array<
      Record<string, unknown>
    >) {
      const orgId = sr.organization_id as string;
      const output = sr.output as Record<string, unknown>;
      const signal = sr.signal as Record<string, unknown>;
      if (!output?.found) continue;
      if (!signalAccum.has(orgId)) signalAccum.set(orgId, []);
      const list = signalAccum.get(orgId)!;
      if (list.length < 3) {
        list.push(
          `${signal.name}: ${((output.summary as string) ?? "").slice(0, 80)}`,
        );
      }
    }
  }

  // CSV header
  const header =
    "company,signal,contact_name,contact_title,email,linkedin,suggested_path,personalised_email,personalised_linkedin,creative_play";

  const csvRows: string[] = [];

  for (const row of (companyRows ?? []) as unknown as Array<
    Record<string, unknown>
  >) {
    const org = row.organization as Record<string, unknown>;
    const orgId = org.id as string;
    const companyName = org.name as string;
    const signalJoined = (signalAccum.get(orgId) ?? []).join(" | ");
    const signal = signalJoined || ((row.score_reason as string) ?? "");

    const contacts = contactMap.get(orgId) ?? [];

    // Build signal-aware messages directly from the data
    const hasRegulatory =
      signal.toLowerCase().includes("regulatory") ||
      signal.toLowerCase().includes("cfpb") ||
      signal.toLowerCase().includes("consent order");
    const hasTrustpilot =
      signal.toLowerCase().includes("trustpilot") ||
      signal.toLowerCase().includes("complaint");
    const hasHiring =
      signal.toLowerCase().includes("hiring") ||
      signal.toLowerCase().includes("cx");
    const hasAI =
      signal.toLowerCase().includes("ai agent") ||
      signal.toLowerCase().includes("ai chatbot");
    function makeEmail(firstName: string): string {
      if (presetSlug === "complaints" || presetSlug === "sales-compliance") {
        if (hasRegulatory) {
          return `Hi ${firstName || "there"},\n\nThe recent regulatory activity around ${companyName} caught my attention. The pattern we see with lenders in similar situations is that complaint detection is the root issue — agents manually log maybe 30% of actual dissatisfaction. The rest goes undetected until it compounds into enforcement.\n\nWe built Rulebase specifically for this — AI that detects every complaint across every call, with auditable evidence.\n\nWorth 15 minutes?`;
        }
        if (hasTrustpilot) {
          return `Hi ${firstName || "there"},\n\n${companyName}'s Trustpilot has been rough lately — and from what we've seen, public complaints are usually the tip of the iceberg. Most lenders only catch complaints agents manually log.\n\nRulebase detects the other 70% automatically across every call.\n\nOpen to a quick look?`;
        }
        return `Hi ${firstName || "there"},\n\nMost lenders we talk to are only catching complaints that agents manually flag — which is maybe 30% of actual dissatisfaction. The rest compounds silently until it becomes a regulatory issue.\n\nWe built Rulebase to catch 100% automatically. Relevant for ${companyName}?`;
      }
      // QA
      if (hasAI) {
        return `Hi ${firstName || "there"},\n\nSaw ${companyName} is deploying AI for CX — which raises a question most teams hit next: who QAs the AI? Manual sampling doesn't work when half your conversations are AI-handled.\n\nRulebase evaluates 100% of both human and AI conversations. Worth a look?`;
      }
      if (hasHiring) {
        return `Hi ${firstName || "there"},\n\nNoticed ${companyName} is building out the CX team. The first thing new CX leaders find is that QA covers 1-3% of conversations — not enough to spot systemic issues.\n\nRulebase gets you to 100% in days. Worth 15 min?`;
      }
      return `Hi ${firstName || "there"},\n\nMost CX teams we talk to are reviewing 1-3% of conversations. Rulebase evaluates 100% automatically and surfaces the patterns manual QA misses.\n\nRelevant for ${companyName}?`;
    }

    function makeLinkedIn(firstName: string): string {
      if (hasRegulatory)
        return `Hi ${firstName || "there"} — saw ${companyName} in the regulatory news. We help lenders detect 100% of complaints before they compound. Would love to connect.`;
      if (hasTrustpilot)
        return `Hi ${firstName || "there"} — noticed ${companyName}'s Trustpilot reviews. We help catch the 70% of complaints agents miss. Would love to connect.`;
      if (hasAI)
        return `Hi ${firstName || "there"} — saw ${companyName} is deploying AI for CX. We solve the QA gap for AI conversations. Would love to connect.`;
      if (hasHiring)
        return `Hi ${firstName || "there"} — noticed ${companyName} is scaling CX. We help teams maintain quality at scale with 100% QA coverage. Would love to connect.`;
      return `Hi ${firstName || "there"} — ${companyName} came up in our research. We help teams monitor 100% of customer conversations. Would love to connect.`;
    }

    function makeCreative(firstName: string): string {
      const who = firstName || "the CCO";
      if (presetSlug === "complaints") {
        if (hasRegulatory)
          return `Send a "Compliance Survival Kit" to ${who} at ${companyName} HQ — box with a branded stress ball, one-pager "The 70% Problem: What Your Agents Aren't Logging," QR to a 3-min Loom demo. Handwritten note: "Thought this might be useful given what's been happening. — Gideon"`;
        if (hasTrustpilot)
          return `Print ${companyName}'s top 5 worst Trustpilot reviews on cards. Back of each: "Rulebase would have caught this before it went public." Mail to ${who} with sticky note: "These are just the ones who bothered to post. — Gideon" + Calendly link.`;
        return `Send a dozen cupcakes from a bakery near ${companyName}'s HQ. Each has a tiny "1 in 3" flag. Card: "You're only catching 1 in 3 complaints. Let us show you the other two. — Gideon @ Rulebase" + Calendly.`;
      }
      if (presetSlug === "sales-compliance") {
        if (hasRegulatory)
          return `Create a "CFPB Exam Prep Box" — branded folder: (1) top 5 UDAAP violations this year, (2) mock exam checklist "What Examiners Actually Ask For," (3) USB with 5-min Rulebase demo. FedEx to ${who} at ${companyName}. Cover: "For when the examiner calls." Note: "No sales pitch — just useful. — Gideon"`;
        return `Rent a mobile billboard truck past ${companyName}'s HQ for one morning: "10-15% of your sales calls have compliance gaps. We can prove it." + QR code. Send ${who} a photo: "Not subtle. But neither are CFPB fines. 15 min? — Gideon" (Top 3 targets only.)`;
      }
      // QA
      if (hasAI)
        return `Send a "Robot Report Card" to ${who} at ${companyName} — novelty report card grading their AI agent: Communication A-, Accuracy ?, Compliance ?, Empathy C+. Inside: "Your AI handles thousands of conversations. Who's grading them? — Gideon @ Rulebase" + Calendly.`;
      if (hasHiring)
        return `Send a jar of 100 jelly beans to ${who} at ${companyName}. 97 white, 3 red. Label: "You're reviewing 3 out of 100 conversations. How sure are you about the other 97?" Card: "Rulebase reviews all 100. — Gideon" + Calendly.`;
      return `Mail a magnifying glass to ${who} at ${companyName}. Tag: "You're using this to review 3% of conversations. We review 100% without it." Back: "No gimmick — just math. — Gideon @ Rulebase" + QR to Calendly.`;
    }

    if (contacts.length > 0) {
      for (const cr of contacts) {
        const person = cr.person as Record<string, unknown>;
        const contactName = (person.name as string) ?? "";
        const title = (person.title as string) ?? "";
        const email =
          (person.work_email as string) ??
          (person.personal_email as string) ??
          "";
        const linkedin = (person.linkedin_url as string) ?? "";
        const firstName = contactName.split(" ")[0] ?? "";

        csvRows.push(
          [
            esc(companyName),
            esc(signal),
            esc(contactName),
            esc(title),
            esc(email),
            esc(linkedin),
            esc(`1. LinkedIn connect ${firstName} → 2. Message → 3. Call`),
            esc(makeEmail(firstName)),
            esc(makeLinkedIn(firstName)),
            esc(makeCreative(firstName)),
          ].join(","),
        );
      }
    } else {
      csvRows.push(
        [
          esc(companyName),
          esc(signal),
          esc(""),
          esc(""),
          esc(""),
          esc(""),
          esc("Find CCO / Head of CX on LinkedIn → connect → message → call"),
          esc(makeEmail("")),
          esc(makeLinkedIn("")),
          esc(makeCreative("")),
        ].join(","),
      );
    }
  }

  const csv = [header, ...csvRows].join("\n");
  const filename = preset
    ? `rulebase-${preset}-${new Date().toISOString().slice(0, 10)}.csv`
    : `rulebase-export-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
