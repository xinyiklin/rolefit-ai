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
import { readBody, sendJson, FetchTimeoutError } from "../http.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { getDefaultProvider, normalizeProvider, providerLabel, resolveProviderRequest } from "./providers.ts";
import { callConfiguredProvider } from "./clients.ts";
import { clipForPrompt, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { AUTH_STEMS, mentionsAuthStem } from "./eligibilityLexicon.ts";

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
5. Each list item is one concise duty/qualification (no numbering, no bullets).
6. Output exactly one JSON object and nothing else — no markdown fences, no commentary.`;

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
  "roleDescription": "a neutral 1-3 sentence summary of the role/company, or \\"\\"",
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

// A content-list item (a duty / qualification sentence) is kept only if it is
// ANCHORED in the posting: a clear majority (>=60%) of its distinctive word
// tokens actually appear in the source. This extends the scalar/tech grounding
// to free-text lists — the model may lightly paraphrase or re-case (its job),
// but a "requirement" whose key terms never appear in the posting (e.g. an
// invented "Kubernetes and HIPAA" line) is a fabrication and is dropped. Items
// with no distinctive tokens left after stop-word removal are kept (already
// cleaned, nothing left to verify against).
function listItemGrounded(item: unknown, sourceTokens: Set<string>): boolean {
  const tokens = norm(item)
    .split(" ")
    .filter((t) => t.length >= 3 && !LIST_STOPWORDS.has(t));
  if (tokens.length === 0) return true;
  let hits = 0;
  for (const t of tokens) if (sourceTokens.has(t)) hits += 1;
  return hits * 5 >= tokens.length * 3; // hits / tokens >= 0.6, integer-safe
}

// Clean + cap a list (strList), then drop any item not grounded in the source.
function groundedList(value: unknown, opts: StrListOptions, sourceTokens: Set<string>): string[] {
  return strList(value, opts).filter((item) => listItemGrounded(item, sourceTokens));
}

// Tech grounding is symbol-aware (C#, C++, .NET, Go) — norm() would strip the
// symbols and "go"/"c" would false-match inside words. Require the term as a
// whole token in the raw lowercased source: a non-token char (or start) before
// it, and no alphanumeric immediately after.
function groundedTech(tech: unknown, sourceLower: string): boolean {
  const t = String(tech ?? "").toLowerCase().trim();
  if (t.length < 2) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Whole-token match: a hyphen counts as a boundary char on BOTH sides too, so a
  // short term ("go"/"ai") can't false-ground inside hyphenated prose
  // ("go-getter", "retail-ai", "let-go").
  return new RegExp(String.raw`(?:^|[^a-z0-9.+#-])${esc}(?![a-z0-9-])`, "i").test(sourceLower);
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

// Derive the salary currency FROM the source (the figures are already grounded),
// rather than trusting the model — so a "£55,000" role is never reported as USD.
function currencyFromSource(sourceText: string): string {
  if (/£|\bGBP\b/.test(sourceText)) return "GBP";
  if (/€|\bEUR\b/.test(sourceText)) return "EUR";
  if (/¥|\bJPY\b/.test(sourceText)) return "JPY";
  if (/\b(CAD|CA\$|C\$)\b|CA\$|C\$/.test(sourceText)) return "CAD";
  if (/\b(AUD|A\$)\b|A\$/.test(sourceText)) return "AUD";
  return "USD";
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

function normalizePeriod(value: unknown): string {
  const t = str(value, 8).toLowerCase();
  return t === "yr" || t === "mo" || t === "hr" ? t : "";
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

  let salaryMin = groundedAmount(obj.salaryMin, sourceText);
  let salaryMax = groundedAmount(obj.salaryMax, sourceText);
  if (salaryMin != null && salaryMax != null && salaryMin > salaryMax) {
    [salaryMin, salaryMax] = [salaryMax, salaryMin];
  }
  const hasSalary = salaryMin != null || salaryMax != null;

  // techKeywords must each be named in the posting (symbol-aware, 2-char floor
  // so "Go"/"C#"/"AI" survive while inventions are dropped).
  const sourceLower = sourceText.toLowerCase();
  const techKeywords = strList(obj.techKeywords, { maxItems: 24, maxLen: 40, minLen: 2 }).filter((t) =>
    groundedTech(t, sourceLower)
  );

  return {
    title,
    company,
    location,
    jobType: normalizeJobType(obj.jobType),
    workAuth: groundedWorkAuth(obj.workAuth, sourceLower),
    salaryMin,
    salaryMax,
    salaryCurrency: hasSalary ? currencyFromSource(sourceText) : "",
    salaryPeriod: hasSalary ? normalizePeriod(obj.salaryPeriod) || (((salaryMin ?? salaryMax) ?? 0) >= 1000 ? "yr" : "") : "",
    roleDescription: str(obj.roleDescription, 900),
    // Content lists are grounded against the posting (anti-fabrication), like scalars/tech.
    responsibilities: groundedList(obj.responsibilities, { maxItems: 12 }, sourceTokens),
    requiredQualifications: groundedList(obj.requiredQualifications, { maxItems: 12 }, sourceTokens),
    preferredQualifications: groundedList(obj.preferredQualifications, { maxItems: 12 }, sourceTokens),
    techKeywords,
    // senioritySignals/domainSignals feed the local keyword score (~40%) and the
    // review model, so they get the same source-grounding as the content lists —
    // an invented "fintech" domain or "staff-level" seniority signal is dropped.
    senioritySignals: groundedList(obj.senioritySignals, { maxItems: 8, maxLen: 60 }, sourceTokens),
    domainSignals: groundedList(obj.domainSignals, { maxItems: 8, maxLen: 40 }, sourceTokens)
  };
}

// Resolve provider from `body` (default provider when none given), call the model,
// and return grounded fields plus the RESOLVED provider/model/reasoningEffort and
// the dispatch attempt count. Used by the /api/distill route (extension imports
// also distill through that route, client-side from the receiving tab — the
// server-side import pass only resolves the raw page text). Throws on
// no-provider / timeout / unreadable output so callers can decide how to degrade.
// apiKey / apiBaseUrl are intentionally NOT returned — the route echoes only the
// non-secret resolved config.
export async function distillToFields({ jobText, body = {} }: { jobText: string; body?: Record<string, unknown> }) {
  const { provider, apiKey, apiBaseUrl, model, reasoningEffort } = resolveProviderRequest(body);
  const { systemPrompt, userPrompt } = buildDistillPrompts({ jobText });
  const stats: AttemptStats = {};
  const parsed = await callConfiguredProvider(
    { provider, model, reasoningEffort, apiKey, apiBaseUrl, systemPrompt, userPrompt },
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
  let provider = normalizeProvider(getDefaultProvider());
  try {
    const body = JSON.parse(await readBody(req, 2_000_000));
    const jobText = String(body.text ?? "");
    if (jobText.trim().length < 40) {
      sendJson(res, 400, { error: "Provide the job posting text to distill (at least a short description)." });
      return;
    }
    // Resolve once for the error label / key validation, then distill.
    provider = resolveProviderRequest(body).provider;
    const result = await distillToFields({ jobText, body });
    // Echo the RESOLVED provider/model/reasoningEffort (never the apiKey/apiBaseUrl)
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
    if (error instanceof UserSafeAiError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    if (error instanceof FetchTimeoutError || (error instanceof Error && /timed out after/i.test(error.message))) {
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
  }
}
