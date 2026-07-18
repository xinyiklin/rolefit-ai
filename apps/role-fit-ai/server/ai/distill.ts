// /api/distill route handler. An AI-based job-description distiller: it sends the
// raw (tag-stripped) posting text to the configured provider and gets back the
// SAME structured fields the deterministic engine (src/lib/jobExtract.ts) emits,
// but resolved semantically — so novel ATS layouts, inline-prose duties, and
// unusual section headings parse where the regex engine's heading tables can't.
//
// Anti-fabrication is enforced server-side, not just by the prompt: the model is
// told to extract only what the posting states, and then every SCALAR fact it
// returns (title, company, location, salary numbers, tech keywords) is dropped
// unless it is grounded in the source text. The client falls back to the
// deterministic engine on any non-200, so a missing key / timeout / bad model
// reply never breaks distillation.

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  FetchTimeoutError,
  isRequestAborted,
  readBody,
  requestAbortSignal,
  sendJson
} from "../http.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { providerLabel, resolveProviderRequest } from "./providers.ts";
import { callConfiguredProvider } from "./clients.ts";
import { clipForPrompt, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { AUTH_STEMS, mentionsAuthStem } from "./eligibilityLexicon.ts";
import { findUngroundedCuratedClaimTerm } from "./grounding.ts";

// Optional dispatch-attempt collector: callConfiguredProvider bumps `attempts`.
type AttemptStats = { attempts?: number };
// Clean/cap options for strList (maxItems required; maxLen/minLen defaulted).
type StrListOptions = { maxItems: number; maxLen?: number; minLen?: number };

const JOB_TEXT_CHAR_LIMIT = 24_000;

export function buildDistillPrompts({ jobText }: { jobText: unknown }): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a precise job-posting parser. You read one job posting and return ONLY a structured JSON object of facts that are EXPLICITLY present in it.

${inputFirewallRule()}

ABSOLUTE RULES (anti-fabrication — this is the whole job):
1. Extract only what the posting actually states. If a field is not stated, return "" (empty string), null, or [] — never guess, infer, or fill from typical postings.
2. Never invent a company, title, location, salary, technology, or requirement. Copy facts as written (you may fix casing/whitespace and trim, nothing more).
3. Do NOT put benefits, perks, pay/compensation prose, EEO/legal/diversity statements, application instructions, recruiter marketing, or "about the company" fluff into responsibilities or qualifications.
4. techKeywords are ONLY concrete technologies/languages/frameworks/tools/platforms NAMED in the posting (e.g. "Python", "React", "AWS", "Kubernetes"). Never a generic skill ("communication") and never a tool the posting does not name.
5. roleDescription is a neutral extract or light trim of the posting's own role/company description. Do not synthesize a new summary, combine unrelated claims, or add implied context.
6. Each list item is one concise duty/qualification (no numbering, no bullets).
7. Output exactly one JSON object and nothing else — no markdown fences, no commentary.`;

  const schema = `Return this JSON shape (use "" / null / [] for anything not stated):
{
  "title": "the exact role title, or \\"\\"",
  "company": "the hiring company's name, or \\"\\"",
  "location": "primary work location e.g. \\"Austin, TX\\" or \\"Remote\\" or \\"\\"",
  "jobType": "one of: Full-time, Part-time, Contract, Internship, Temporary, or \\"\\"",
  "workAuth": "a work-authorization / visa / security-clearance requirement sentence if stated, else \\"\\"",
  "salaryMin": <integer e.g. 120000, or null>,
  "salaryMax": <integer, or null>,
  "salaryCurrency": "USD, GBP, EUR, CAD, AUD, JPY, or \\"\\"",
  "salaryPeriod": "yr, mo, hr, or \\"\\"",
  "roleDescription": "a neutral 1-3 sentence extract/light trim of the stated role/company description, or \\"\\"",
  "responsibilities": ["one duty per item"],
  "requiredQualifications": ["one required qualification per item"],
  "preferredQualifications": ["one preferred/nice-to-have qualification per item"],
  "techKeywords": ["only technologies named in the posting"],
  "senioritySignals": ["e.g. \\"senior\\", \\"entry-level / junior\\", \\"3-5 years\\", \\"leadership\\""],
  "domainSignals": ["e.g. \\"fintech\\", \\"healthcare\\", \\"AI\\", \\"infrastructure\\""]
}`;

  // The source URL is intentionally NOT included: it can carry private ATS
  // tokens / tracking params, and the product contract (README, ai-server.md)
  // promises the job link is never sent to the model. Only the posting text goes.
  const userPrompt = `Parse the posting inside the <job_description> tags below.

<job_description>
${fenceUntrusted(clipForPrompt(jobText, JOB_TEXT_CHAR_LIMIT, "job posting")) || "Not provided."}
</job_description>

${schema}`;

  return { systemPrompt, userPrompt };
}

// --- sanitizing + grounding ------------------------------------------------

const norm = (s: unknown): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function str(value: unknown, max = 200): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function strList(value: unknown, { maxItems, maxLen = 240, minLen = 3 }: StrListOptions): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const item = str(raw, maxLen).replace(/^[\s•·‣◦▪●○*\-–—]+/, "").replace(/^\d+[.)]\s*/, "").trim();
    if (item.length < minLen) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

// A scalar fact is kept only if it is grounded in the source text (case/spacing-
// insensitive substring). Guards against the model inventing or "tidying" a value
// into something the posting never said.
function grounded(value: unknown, sourceNorm: string): boolean {
  const v = norm(value);
  return Boolean(v) && v.length >= 2 && sourceNorm.includes(v);
}

// Generic connective tissue that appears in almost every posting — matching one
// of these does NOT count toward a list item being anchored in the source.
const LIST_STOPWORDS = new Set([
  "and", "the", "for", "with", "you", "your", "our", "are", "will", "that", "this",
  "have", "from", "they", "their", "has", "was", "were", "into", "than", "then",
  "other", "using", "use", "used", "including", "include", "includes", "such",
  "across", "within", "via", "ability", "able", "experience", "experienced",
  "strong", "excellent", "good", "work", "working", "role", "team", "teams",
  "years", "year", "plus", "etc", "required", "preferred", "must", "should", "who"
]);

const ROLE_DESCRIPTION_STOPWORDS = new Set([
  ...LIST_STOPWORDS,
  "company", "business", "position", "candidate", "candidates", "looking", "seeking",
  "help", "helps", "helping", "join", "joining", "opportunity"
]);

const ROLE_TOKEN_CANONICAL = new Map([
  ["postgresql", "postgres"], ["postgres", "postgres"],
  ["k8s", "kubernetes"], ["kubernetes", "kubernetes"],
  ["typescript", "typescript"], ["ts", "typescript"]
]);

// Light morphology keeps grounding paraphrase-friendly without turning it into
// semantic guesswork: "building" can match "build" and "services" can match
// "service", but an invented domain/tool still has no matching token.
function tokenKey(token: string): string {
  let key = token;
  if (key.length > 5 && key.endsWith("ies")) key = `${key.slice(0, -3)}y`;
  else if (key.length > 5 && key.endsWith("ing")) key = key.slice(0, -3).replace(/(.)\1$/, "$1");
  else if (key.length > 4 && key.endsWith("ed")) key = key.slice(0, -2).replace(/(.)\1$/, "$1");
  else if (key.length > 4 && key.endsWith("s")) key = key.slice(0, -1);
  return ROLE_TOKEN_CANONICAL.get(key) ?? key;
}

function distinctiveTokenKeys(value: unknown, stopwords: Set<string>): string[] {
  return [...new Set(norm(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !stopwords.has(token))
    .map(tokenKey)
    .filter(Boolean))];
}

// Free-text fields need the same symbol/case-aware protection as techKeywords.
// Otherwise generic token overlap lets clearance/business phrases ground an
// invented technology claim (TS/SCI -> TypeScript, net-zero -> .NET, etc.).
function atomicTechClaimsGrounded(claim: unknown, sourceText: string): boolean {
  const text = String(claim ?? "");
  // Generic token overlap is not enough for concrete tools: a mostly copied
  // duty could smuggle one invented technology (for example, adding Kubernetes
  // to an otherwise grounded API sentence) and still clear the 60% list-item
  // threshold below. Reuse the central curated technology lexicons so every
  // known concept/tool/short token in extraction prose must occur in the source.
  if (findUngroundedCuratedClaimTerm(text, sourceText)) return false;
  const claimsTypeScript = /\bTypeScript\b/i.test(text)
    || /(?:^|[^A-Za-z0-9/])TS(?!\s*\/\s*SCI\b|[A-Za-z0-9])/i.test(text);
  if (claimsTypeScript && !groundedTech("ts", sourceText)) return false;
  if (/\.net\b/i.test(text) && !groundedTech(".net", sourceText)) return false;
  if ((/\bGolang\b/i.test(text) || /(?:^|[^A-Za-z0-9])Go(?![-&A-Za-z0-9+#])/.test(text))
    && !groundedTech("go", sourceText)) return false;
  if (/(?:^|[^A-Za-z0-9])C(?![-&A-Za-z0-9+#])/.test(text) && !groundedTech("c", sourceText)) return false;
  if (/(?:^|[^A-Za-z0-9])R(?![-&A-Za-z0-9+#])/.test(text) && !groundedTech("r", sourceText)) return false;
  return true;
}

// roleDescription used to pass through as trusted prose. Keep a neutral/lightly
// paraphrased extract only when nearly all of its distinctive content is present
// in the posting. Every distinctive token must match (with only light morphology
// and established aliases), so one novel domain cannot hide inside copied prose.
function groundedRoleDescription(value: unknown, sourceText: string): string {
  const description = str(value, 900);
  if (!description) return "";
  if (!atomicTechClaimsGrounded(description, sourceText)) return "";
  const tokens = distinctiveTokenKeys(description, ROLE_DESCRIPTION_STOPWORDS);
  if (!tokens.length) return "";
  const sourceTokens = new Set(distinctiveTokenKeys(sourceText, new Set()));
  const hits = tokens.filter((token) => sourceTokens.has(token)).length;
  return hits === tokens.length ? description : "";
}

// A content-list item (a duty / qualification sentence) is kept only if it is
// ANCHORED in the posting: a clear majority (>=60%) of its distinctive word
// tokens actually appear in the source. This extends the scalar/tech grounding
// to free-text lists — the model may lightly paraphrase or re-case (its job),
// but a "requirement" whose key terms never appear in the posting (e.g. an
// invented "Kubernetes and HIPAA" line) is a fabrication and is dropped. Items
// with no distinctive tokens left after stop-word removal are kept (already
// cleaned, nothing left to verify against).
function listItemGrounded(item: unknown, sourceTokens: Set<string>, sourceText: string): boolean {
  if (!atomicTechClaimsGrounded(item, sourceText)) return false;
  const tokens = norm(item)
    .split(" ")
    .filter((t) => t.length >= 3 && !LIST_STOPWORDS.has(t));
  if (tokens.length === 0) return true;
  let hits = 0;
  for (const t of tokens) if (sourceTokens.has(t)) hits += 1;
  return hits * 5 >= tokens.length * 3; // hits / tokens >= 0.6, integer-safe
}

// Clean + cap a list (strList), then drop any item not grounded in the source.
function groundedList(value: unknown, opts: StrListOptions, sourceTokens: Set<string>, sourceText: string): string[] {
  return strList(value, opts).filter((item) => listItemGrounded(item, sourceTokens, sourceText));
}

// Tech grounding is symbol-aware (C#, C++, .NET, Go) — norm() would strip the
// symbols and "go"/"c" would false-match inside words. Require the term as a
// whole token in the raw lowercased source: a non-token char (or start) before
// it, and no alphanumeric immediately after.
function groundedTech(tech: unknown, sourceText: string): boolean {
  const t = String(tech ?? "").toLowerCase().trim();
  if (t.length < 2 && t !== "c" && t !== "r") return false;
  // Keep clearance/business phrases from being reclassified as technologies.
  // These short/symbolic names need stricter boundaries than the generic token
  // matcher below.
  if (t === "ts") {
    return /\bTypeScript\b/i.test(sourceText)
      || /(?:^|[^A-Za-z0-9/])TS(?!\s*\/\s*SCI\b|[A-Za-z0-9])/i.test(sourceText);
  }
  if (t === ".net") return /(?:^|[^a-z0-9])\.net(?![-a-z0-9])/i.test(sourceText);
  if (t === "go") {
    return /\bGolang\b/i.test(sourceText)
      || /(?:^|[^A-Za-z0-9])Go(?![-&A-Za-z0-9+#]|\s+to\s+market)/.test(sourceText);
  }
  if (t === "c") return /(?:^|[^A-Za-z0-9])C(?![-&A-Za-z0-9+#])/.test(sourceText);
  if (t === "r") return /(?:^|[^A-Za-z0-9])R(?![-&A-Za-z0-9+#]|\s*&\s*D\b)/.test(sourceText);
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Whole-token match: a hyphen counts as a boundary char on BOTH sides too, so a
  // short term ("go"/"ai") can't false-ground inside hyphenated prose
  // ("go-getter", "retail-ai", "let-go").
  return new RegExp(String.raw`(?:^|[^a-z0-9.+#-])${esc}(?![a-z0-9-])`, "i").test(sourceText);
}

// workAuth is an ELIGIBILITY-BLOCKER fact — it can force a DON'T APPLY verdict and
// persists into the application tracker — so it gets the same anti-fabrication
// discipline as every other distilled field (the old code passed it through
// ungrounded). Keep it only when the SPECIFIC authorization class the model named
// (clearance / citizenship / visa / sponsorship / work authorization / …) actually
// appears in the posting: an invented "active security clearance required" for a
// posting that never mentions clearance is dropped, while a genuine "authorized to
// work without sponsorship" is kept. A workAuth naming no auth class at all is not
// a real constraint and is dropped. AUTH_STEMS + the boundary-anchored matcher
// live in the shared eligibility lexicon (./eligibilityLexicon.ts — the one
// home for every work-auth/credential term list; its header documents how this
// list deliberately differs from scoring's blocker/bucket lists).
function groundedWorkAuth(value: unknown, sourceLower: string): string {
  const wa = str(value, 240);
  if (!wa) return "";
  const waLower = wa.toLowerCase();
  const named = AUTH_STEMS.filter((stem) => mentionsAuthStem(waLower, stem));
  if (!named.length) return "";                                          // not an auth statement
  if (!named.some((stem) => mentionsAuthStem(sourceLower, stem))) return ""; // invented auth requirement
  return wa;
}

function salaryContextFromSource(sourceText: string): string {
  return sourceText
    .split(/\r?\n|(?<=[.!?])\s+/)
    .filter((part) =>
      /\b(?:salary|compensation|base pay|pay range|hourly rate|annual pay|remuneration)\b/i.test(part)
      || /(?:[$£€¥]|\b(?:USD|GBP|EUR|CAD|AUD|JPY)\b)\s*\d/i.test(part)
    )
    .join("\n");
}

// Derive currency only from the explicit salary/pay context, never from a
// plausible default. Bare salary numbers therefore keep currency empty.
function currencyFromSalaryContext(salaryContext: string): string {
  if (/\bGBP\b|£/.test(salaryContext)) return "GBP";
  if (/\bEUR\b|€/.test(salaryContext)) return "EUR";
  if (/\bJPY\b|¥/.test(salaryContext)) return "JPY";
  if (/\bCAD\b|CA\$|C\$/.test(salaryContext)) return "CAD";
  if (/\bAUD\b|A\$/.test(salaryContext)) return "AUD";
  if (/\bUSD\b|US\$|\$/.test(salaryContext)) return "USD";
  return "";
}

function periodFromSalaryContext(salaryContext: string): string {
  if (/\b(?:per\s+year|annually|annual|yearly)\b|\/\s*(?:yr|year)\b/i.test(salaryContext)) return "yr";
  if (/\b(?:per\s+month|monthly)\b|\/\s*(?:mo|month)\b/i.test(salaryContext)) return "mo";
  if (/\b(?:per\s+hour|hourly)\b|\/\s*(?:hr|hour)\b/i.test(salaryContext)) return "hr";
  return "";
}

function normalizeJobType(value: unknown): string {
  const t = str(value, 40);
  if (/full[-\s]?time/i.test(t)) return "Full-time";
  if (/part[-\s]?time/i.test(t)) return "Part-time";
  if (/contract/i.test(t)) return "Contract";
  if (/intern(ship)?/i.test(t)) return "Internship";
  if (/temp(orary)?/i.test(t)) return "Temporary";
  return "";
}

// A normalized employment type is still a claim. Require the corresponding
// phrase in the posting instead of accepting a plausible model classification
// (for example, turning an unspecified role into "Full-time"). Contract uses
// employment-context patterns so ordinary prose such as "manage contracts" does
// not become an employment type.
function groundedJobType(value: unknown, sourceText: string): string {
  const normalized = normalizeJobType(value);
  if (!normalized) return "";
  const patterns: Record<string, RegExp[]> = {
    "Full-time": [
      /\b(?:employment|job|position|role)\s+type\s*[:\-]?\s*full[-\s]?time\b/i,
      /\bfull[-\s]?time\s+(?:role|position|job|employment)\b/i,
      /\b(?:role|position|job)\s+(?:is\s+)?full[-\s]?time\b/i,
      /^\s*full[-\s]?time\s*$/i
    ],
    "Part-time": [
      /\b(?:employment|job|position|role)\s+type\s*[:\-]?\s*part[-\s]?time\b/i,
      /\bpart[-\s]?time\s+(?:role|position|job|employment)\b/i,
      /\b(?:role|position|job)\s+(?:is\s+)?part[-\s]?time\b/i,
      /^\s*part[-\s]?time\s*$/i
    ],
    Contract: [
      /\b(?:employment|job)\s+type\s*[:\-]?\s*contract\b/i,
      /\bcontract(?:[-\s]+(?:role|position|job|employment|basis|opportunity|to[-\s]hire))\b/i,
      /\b(?:role|position|job)\s+(?:is\s+)?(?:a\s+)?contract\b/i,
      /\b\d+[-\s]?(?:month|year)\s+contract\b/i,
      /(?:^|\n)\s*contract\s*(?:$|\n)/im
    ],
    Internship: [
      /\bintern\s+(?:role|position|job|program)\b/i,
      /\b(?:employment|job)\s+type\s*[:\-]?\s*intern(?:ship)?\b/i,
      /\b(?:internship|intern)\s+(?:role|position|job|program|opportunity)\b/i,
      /\b(?:role|position|job)\s+(?:is\s+)?(?:an?\s+)?internship\b/i,
      /^\s*[^.!?\n]{0,60}\b(?:internship|intern)\b\s*$/i
    ],
    Temporary: [
      /\btemporary\s+(?:role|position|job|employment|assignment)\b/i,
      /\b(?:employment|job)\s+type\s*[:\-]?\s*temporary\b/i
    ]
  };
  const segments = sourceText.split(/\r?\n|(?<=[.!?])\s+/);
  const affirmative = segments.some((segment) => {
    if (!patterns[normalized]?.some((pattern) => pattern.test(segment))) return false;
    // A historical qualification, benefit rule, or explicit negation does not
    // describe this role's employment type.
    if (/\b(?:benefits?|employees?|eligibility)\b/i.test(segment)) return false;
    if (/\b(?:prior|previous|past)\b.{0,45}\b(?:experience|employment|work|internship)\b/i.test(segment)) return false;
    if (/\b(?:not|isn['’]?t|is\s+not|no)\b.{0,45}\b(?:full[-\s]?time|part[-\s]?time|contract|intern(?:ship)?|temporary)\b/i.test(segment)) return false;
    return true;
  });
  return affirmative ? normalized : "";
}

// A salary number is kept only when its digits actually appear in the posting
// (as 120000 / 120,000 / 120k), so the model can't fabricate a figure.
function groundedAmount(value: unknown, sourceText: string): number | null {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
  if (n == null || n <= 0) return null;
  const digits = String(n);
  const k = n % 1000 === 0 ? String(n / 1000) : null;
  const plain = sourceText.replace(/,/g, "");
  // Digit-BOUNDARY match, not substring: 20000 must not "ground" inside 120000,
  // and a zip/count digit run must not pass as a salary figure.
  if (new RegExp(String.raw`(?<!\d)${digits}(?!\d)`).test(plain)) return n;
  if (k && new RegExp(String.raw`(?<!\d)${k}\s*k\b`, "i").test(sourceText)) return n;
  return null;
}

export function sanitizeDistill(parsed: unknown, sourceText: string) {
  // Model output: read fields defensively off a record view (never validated).
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const sourceNorm = norm(sourceText);
  // Token set for list grounding (distinctive words actually present in the posting).
  const sourceTokens = new Set(sourceNorm.split(" ").filter(Boolean));

  const titleRaw = str(obj.title);
  const companyRaw = str(obj.company);
  const locationRaw = str(obj.location);
  // Scalars must be grounded in the posting.
  const title = grounded(titleRaw, sourceNorm) ? titleRaw : "";
  const company = grounded(companyRaw, sourceNorm) ? companyRaw : "";
  const location = grounded(locationRaw, sourceNorm) ? locationRaw : "";

  const salaryContext = salaryContextFromSource(sourceText);
  // A number elsewhere in the posting (headcount, users, requisition id) is not
  // salary evidence. Require amounts to occur in an explicit pay context.
  let salaryMin = groundedAmount(obj.salaryMin, salaryContext);
  let salaryMax = groundedAmount(obj.salaryMax, salaryContext);
  if (salaryMin != null && salaryMax != null && salaryMin > salaryMax) {
    [salaryMin, salaryMax] = [salaryMax, salaryMin];
  }
  const hasSalary = salaryMin != null || salaryMax != null;

  // techKeywords must each be named in the posting (symbol-aware, 2-char floor
  // so "Go"/"C#"/"AI" survive while inventions are dropped).
  const sourceLower = sourceText.toLowerCase();
  const techKeywords = strList(obj.techKeywords, { maxItems: 24, maxLen: 40, minLen: 1 }).filter((t) =>
    groundedTech(t, sourceText)
  );

  return {
    title,
    company,
    location,
    jobType: groundedJobType(obj.jobType, sourceText),
    workAuth: groundedWorkAuth(obj.workAuth, sourceLower),
    salaryMin,
    salaryMax,
    salaryCurrency: hasSalary ? currencyFromSalaryContext(salaryContext) : "",
    salaryPeriod: hasSalary ? periodFromSalaryContext(salaryContext) : "",
    roleDescription: groundedRoleDescription(obj.roleDescription, sourceText),
    // Content lists are grounded against the posting (anti-fabrication), like scalars/tech.
    responsibilities: groundedList(obj.responsibilities, { maxItems: 12 }, sourceTokens, sourceText),
    requiredQualifications: groundedList(obj.requiredQualifications, { maxItems: 12 }, sourceTokens, sourceText),
    preferredQualifications: groundedList(obj.preferredQualifications, { maxItems: 12 }, sourceTokens, sourceText),
    techKeywords,
    // senioritySignals/domainSignals feed AI Review and the visible job brief,
    // so they get the same source-grounding as the content lists —
    // an invented "fintech" domain or "staff-level" seniority signal is dropped.
    senioritySignals: groundedList(obj.senioritySignals, { maxItems: 8, maxLen: 60 }, sourceTokens, sourceText),
    domainSignals: groundedList(obj.domainSignals, { maxItems: 8, maxLen: 40 }, sourceTokens, sourceText)
  };
}

// Resolve provider from `body` (default provider when none given), call the model,
// and return grounded fields plus the RESOLVED provider/model/reasoningEffort and
// the dispatch attempt count. Used by the /api/distill route (extension imports
// also distill through that route, client-side from the receiving tab — the
// server-side import pass only resolves the raw page text). Throws on
// no-provider / timeout / unreadable output so callers can decide how to degrade.
// apiKey is intentionally NOT returned — the route echoes only the
// non-secret resolved config.
export async function distillToFields({
  jobText,
  body = {},
  signal
}: {
  jobText: string;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}) {
  const { provider, apiKey, model, reasoningEffort } = resolveProviderRequest(body);
  const { systemPrompt, userPrompt } = buildDistillPrompts({ jobText });
  const stats: AttemptStats = {};
  const parsed = await callConfiguredProvider(
    { provider, model, reasoningEffort, apiKey, systemPrompt, userPrompt, signal },
    stats
  );
  return {
    fields: sanitizeDistill(parsed, jobText),
    provider,
    model,
    reasoningEffort,
    attempts: stats.attempts ?? 1
  };
}

export async function handleDistill(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }
  // Actual default validation happens inside the guarded resolver below.
  let provider = "claude-cli";
  const request = requestAbortSignal(req, res);
  try {
    const body = JSON.parse(await readBody(req, 2_000_000));
    const jobText = String(body.text ?? "");
    if (jobText.trim().length < 40) {
      sendJson(res, 400, { error: "Provide the job posting text to distill (at least a short description)." });
      return;
    }
    // Resolve once for the error label / key validation, then distill.
    provider = resolveProviderRequest(body).provider;
    const result = await distillToFields({ jobText, body, signal: request.signal });
    // Echo the RESOLVED provider/model/reasoningEffort (never the API key)
    // plus the dispatch attempt count so the client can record which model actually
    // produced the brief.
    sendJson(res, 200, {
      source: "ai",
      ...result.fields,
      provider: result.provider,
      model: result.model,
      reasoningEffort: result.reasoningEffort,
      attempts: result.attempts
    });
  } catch (error) {
    if (isRequestAborted(error, req, res)) return;
    if (error instanceof UserSafeAiError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    if (error instanceof FetchTimeoutError || (error instanceof Error && /timed out|timeout/i.test(error.message))) {
      sendJson(res, 504, { error: `${providerLabel(provider)} timed out. Try again or switch providers.` });
      return;
    }
    if (error instanceof Error && error.message === "Request is too large.") {
      sendJson(res, 413, { error: "Job posting is too large. Trim it and try again." });
      return;
    }
    const configMessage = safeConfigErrorMessage(error instanceof Error ? error.message : "");
    if (configMessage) {
      sendJson(res, 400, { error: configMessage });
      return;
    }
    sendJson(res, 500, { error: "Could not distill the job posting with AI." });
  } finally {
    request.dispose();
  }
}
