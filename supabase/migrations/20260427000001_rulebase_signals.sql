-- Rulebase custom signals
-- 2026-04-27
-- 9 signals mapped to 3 ICPs: QA, Complaints, Sales Compliance

INSERT INTO signals (name, slug, description, long_description, category, icon, execution_type, tool_key, config, is_builtin)
VALUES
(
  'Trustpilot Review Surge',
  'trustpilot-review-surge',
  'Detect deteriorating Trustpilot scores, rising negative reviews, and recurring complaint themes.',
  'Searches for the company''s Trustpilot page and recent negative reviews on BBB, Reddit, and Google. A review surge is the earliest public indicator that complaint handling is broken — it precedes regulatory attention and is a strong opening for outreach.',
  'engagement',
  'Star',
  'exa_search',
  NULL,
  '{"query": "{company} complaints OR terrible service OR negative reviews site:trustpilot.com OR site:bbb.org OR site:reddit.com", "numResults": 8}'::jsonb,
  true
),
(
  'Regulatory Action',
  'regulatory-action',
  'Detect recent CFPB consent orders, state AG settlements, fines, or enforcement actions.',
  'Searches for enforcement actions, consent orders, and regulatory settlements related to the company. Firms under consent orders are compelled buyers — they must improve monitoring. Treats this as a score booster rather than primary detection.',
  'custom',
  'Shield',
  'exa_search',
  NULL,
  '{"query": "{company} consent order OR enforcement action OR fine OR settlement consumer lending OR auto finance", "numResults": 5, "category": "news"}'::jsonb,
  true
),
(
  'CX & Customer Ops Hiring',
  'cx-ops-hiring',
  'Detect hiring for CX leadership, customer operations, QA, or support roles.',
  'Searches for recent hires and open roles for Head of CX, VP Customer Ops, QA Manager, and similar positions. A new CX/ops leader is the single strongest QA buying signal — they audit processes and buy tools within 90 days. Also detects frontline hiring surges indicating scaling pain.',
  'hiring',
  'UserPlus',
  'exa_search',
  NULL,
  '{"query": "{company} hired OR appointed Head of CX OR VP Customer Operations OR Director of Customer Experience OR QA Manager OR VP Operations", "numResults": 5, "category": "news"}'::jsonb,
  true
),
(
  'AI Agent Adoption in CX',
  'ai-agent-adoption-cx',
  'Detect companies deploying AI agents or chatbots for customer interactions.',
  'Searches for AI agent deployments, chatbot launches, and conversational AI adoption in customer service. Companies rolling out AI agents create a new QA problem: who''s QA-ing the AI? Traditional manual QA can''t review AI-handled conversations at scale.',
  'product',
  'Bot',
  'exa_search',
  NULL,
  '{"query": "{company} AI agent OR AI chatbot OR conversational AI customer service OR voice AI deployed OR launched", "numResults": 5}'::jsonb,
  true
),
(
  'Tech Stack / No Incumbent',
  'tech-stack-no-incumbent',
  'Detect integration-ready tech stack (Zendesk, Aircall, Five9) and absence of speech analytics incumbents.',
  'Searches for the company''s tech stack on StackShare, BuiltWith, G2, and job postings. Integration-ready (cloud telephony/helpdesk) + no existing speech analytics vendor (CallMiner, Verint, NICE) = greenfield opportunity with fastest path to deployment.',
  'product',
  'Layers',
  'exa_search',
  NULL,
  '{"query": "{company} Zendesk OR Aircall OR Five9 OR Talkdesk OR RingCentral OR Genesys site:stackshare.com OR site:builtwith.com OR site:g2.com", "numResults": 5}'::jsonb,
  true
),
(
  'PE Acquisition / Funding',
  'pe-acquisition-funding',
  'Detect recent PE acquisitions, funding rounds, or major investments in lending/fintech.',
  'Searches for private equity acquisitions, funding announcements, and investment rounds. PE-backed lenders face compliance growing pains post-acquisition. New funding means budget available and scaling pain is acute.',
  'funding',
  'DollarSign',
  'exa_search',
  NULL,
  '{"query": "{company} acquired OR acquisition OR private equity OR funding round auto finance OR consumer lending OR fintech", "numResults": 5, "category": "news"}'::jsonb,
  true
),
(
  'Fast Growth / Scaling',
  'fast-growth-scaling',
  'Detect rapid headcount growth, revenue expansion, new offices, or market launches.',
  'Searches for growth signals: funding, hiring surges, new market entries, and expansion announcements. Growth is a universal pain amplifier — a lender fine at 30 agents is drowning at 100. Fast growth compounds QA and compliance gaps.',
  'funding',
  'TrendingUp',
  'exa_search',
  NULL,
  '{"query": "{company} Series OR raised OR funding OR revenue growth OR expansion OR new office OR new market OR headcount growth", "numResults": 5, "category": "news"}'::jsonb,
  true
),
(
  'Multi-State Expansion',
  'multi-state-expansion',
  'Detect lenders expanding into new states or applying for new licenses.',
  'Searches for new state licensing, multi-state expansion, and market launches. New states mean new compliance requirements on top of federal. Expansion without compliance tooling creates acute risk.',
  'custom',
  'MapPin',
  'exa_search',
  NULL,
  '{"query": "{company} NMLS new state license OR multi-state expansion OR new market launch lending", "numResults": 5}'::jsonb,
  true
),
(
  'Customer-Facing Headcount',
  'customer-facing-headcount',
  'Estimate the size of customer-facing teams (support, sales, collections).',
  'Searches for mentions of support team size, contact center operations, and BDC headcount. Manual QA breaks down at scale — 50+ customer-facing agents is the structural prerequisite for QA pain. Combined with growth signals, a company scaling from 40 to 100 agents is in acute pain.',
  'hiring',
  'Users',
  'exa_search',
  NULL,
  '{"query": "{company} customer support team OR contact center OR call center team size agents OR BDC", "numResults": 5}'::jsonb,
  true
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  long_description = EXCLUDED.long_description,
  config = EXCLUDED.config;
