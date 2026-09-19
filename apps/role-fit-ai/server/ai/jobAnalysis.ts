// Job analysis preserves safe generated fields and attaches evidence warnings.
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  FetchTimeoutError,
  isRequestAborted,
  requestAbortSignal,
  sendJson
} from "../http.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { readAiJsonBody } from "./json.ts";
import { providerLabel, resolveProviderRequest } from "./providers.ts";
import { callConfiguredProvider } from "./clients.ts";
import { clipForPrompt, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { groundedJobCondition } from "./jobConditionEvidence.ts";
import { sanitizeJobAnalysisWarnings, type JobAnalysisWarning } from "../../shared/jobAnalysisWarnings.ts";
import type { JobConditionIssue } from "../../shared/jobConditionContract.ts";
import {
  LIST_STOPWORDS,
  distinctiveTokenKeys,
  findUngroundedCuratedClaimTerm
} from "./grounding.ts";
import {
  FIT_ASSESSMENT_RULES,
  FIT_ASSESSMENT_RESPONSE_SCHEMA,
  analyzeFitAssessment,
  fitAssessmentPromptSection,
  evaluateFitAssessmentResponse
} from "./fitAssessment.ts";
import {
  normalizeFitAssessmentInput,
  type FitAssessmentResult
} from "../../shared/fitAssessmentContract.ts";

// Optional dispatch-attempt collector: callConfiguredProvider bumps `attempts`.
type AttemptStats = { attempts?: number };
// Clean/cap options for strList (maxItems required; maxLen/minLen defaulted).
type StrListOptions = { maxItems: number; maxLen?: number; minLen?: number };

const JOB_TEXT_CHAR_LIMIT = 24_000;

type FitAssessmentInput = {
  resumeText: string;
  candidateContext?: string;
};

export function buildJobAnalysisPrompts({
  jobText,
  fitAssessment
}: {
  jobText: unknown;
  fitAssessment?: FitAssessmentInput | null;
}): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = `You are a precise job-posting parser. You read one job posting and return ONLY a structured JSON object of facts that are EXPLICITLY present in it.

${inputFirewallRule()}

ABSOLUTE RULES (anti-fabrication — this is the whole job):
1. Extract only what the posting actually states. If a field is not stated, return "" (empty string), null, or [] — never guess, infer, or fill from typical postings.
2. Never invent a company, title, location, salary, technology, or requirement. Copy facts as written (you may fix casing/whitespace and trim, nothing more).
3. Do NOT put benefits, perks, pay/compensation prose, EEO/legal/diversity statements, application instructions, recruiter marketing, or "about the company" fluff into responsibilities or qualifications.
4. techKeywords are ONLY concrete technologies/languages/frameworks/tools/platforms NAMED in the posting (e.g. "Python", "React", "AWS", "Kubernetes"). Never a generic skill ("communication") and never a tool the posting does not name.
5. roleDescription is a neutral extract or light trim of the posting's own role/company description. Do not synthesize a new summary, combine unrelated claims, or add implied context.
6. Each list item is one concise duty/qualification (no numbering, no bullets).
7. Output exactly one JSON object and nothing else — no markdown fences, no commentary.${fitAssessment ? `

${FIT_ASSESSMENT_RULES}` : ""}`;

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
  const responseSchema = fitAssessment
    ? `Return this JSON shape. The job and fitAssessment subsections are independent; always return the best job object even if Fit Assessment is unavailable. For insufficient job information, replace the assessed fitAssessment example below with the compact object in the Fit Assessment rules:
{
  "job": ${schema.slice(schema.indexOf("{"))},
  "fitAssessment": ${FIT_ASSESSMENT_RESPONSE_SCHEMA}
}`
    : schema;
  // A combined request must show Fit Assessment the same normalized posting that
  // its exact-excerpt validator will use after the response returns.
  const promptJobText = fitAssessment ? normalizeFitAssessmentInput(jobText) : jobText;

  // The source URL is intentionally NOT included: it can carry private ATS
  // tokens / tracking params, and the product contract (README, ai-server.md)
  // promises the job link is never sent to the model. Only the posting text goes.
  const userPrompt = `Parse the posting inside the <job_description> tags below.

<job_description>
${fenceUntrusted(clipForPrompt(promptJobText, JOB_TEXT_CHAR_LIMIT, "job posting")) || "Not provided."}
</job_description>

${fitAssessment ? fitAssessmentPromptSection(fitAssessment) : ""}

${responseSchema}`;

  return { systemPrompt, userPrompt };
}

function fitAssessmentInput(body: Record<string, unknown>): FitAssessmentInput | null {
  const raw = body.fitAssessment;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  if (source.enabled !== true) return null;
  const resumeText = typeof source.resumeText === "string" ? source.resumeText : "";
  if (resumeText.trim().length < 40) return null;
  return {
    resumeText,
    ...(typeof source.candidateContext === "string" ? { candidateContext: source.candidateContext } : {})
  };
}

// --- sanitizing + grounding ------------------------------------------------

const norm = (s: unknown): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function str(value: unknown, max = 200): string {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
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

// Case/spacing-insensitive source matching supplies advisory evidence checks.
function grounded(value: unknown, sourceNorm: string): boolean {
  const v = norm(value);
  return Boolean(v) && v.length >= 2 && sourceNorm.includes(v);
}

const ROLE_DESCRIPTION_STOPWORDS = new Set([
  ...LIST_STOPWORDS,
  "company", "business", "position", "candidate", "candidates", "looking", "seeking",
  "help", "helps", "helping", "join", "joining", "opportunity"
]);

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

// A novel domain or technology inside copied prose remains an evidence concern.
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

// Detect weak source overlap separately from preserving usable list text.
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
  if (/^full[-\s]?time$/i.test(t)) return "Full-time";
  if (/^part[-\s]?time$/i.test(t)) return "Part-time";
  if (/^contract$/i.test(t)) return "Contract";
  if (/^intern(ship)?$/i.test(t)) return "Internship";
  if (/^temp(orary)?$/i.test(t)) return "Temporary";
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

// Numeric source matching detects invented salary figures without withholding them.
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

export function sanitizeJobAnalysis(parsed: unknown, sourceText: string) {
  const obj = (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as Record<string, unknown>;
  const sourceNorm = norm(sourceText);
  const conditionIssues: JobConditionIssue[] = [];
  const warnings: JobAnalysisWarning[] = [];
  const sourceTokens = new Set(sourceNorm.split(" ").filter(Boolean));
  const warn = (field: JobAnalysisWarning["field"], supported: boolean, value: unknown) => {
    if (value !== "" && value !== null && !supported && !warnings.some((item) => item.field === field && item.message.startsWith("Not supported"))) warnings.push({
      field, message: "Not supported by provided evidence. Check this generated field against the original posting."
    });
  };
  const scalar = (field: "title" | "company" | "location") => {
    const value = str(obj[field]);
    warn(field, grounded(value, sourceNorm), value);
    return value;
  };
  const list = (field: "responsibilities" | "requiredQualifications" | "preferredQualifications" | "senioritySignals" | "domainSignals", maxItems: number, maxLen: number) => {
    if (Array.isArray(obj[field]) && obj[field].length > maxItems) warnings.push({ field, message: "Additional generated items were omitted at the display limit. Review the original posting for complete requirements." });
    return strList(obj[field], { maxItems, maxLen, minLen: 1 }).map((item) => {
      warn(field, listItemGrounded(item, sourceTokens, sourceText), item);
      return field === "senioritySignals" || field === "domainSignals"
        ? item : groundedJobCondition(item, field, sourceText, conditionIssues, warnings);
    });
  };
  const salaryContext = salaryContextFromSource(sourceText);
  const salary = (field: "salaryMin" | "salaryMax") => {
    const raw = obj[field];
    const value = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
    warn(field, groundedAmount(value, salaryContext) === value, value);
    return value;
  };
  const salaryMin = salary("salaryMin");
  const salaryMax = salary("salaryMax");
  if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
    warnings.push({ field: "salaryMin", message: "The generated minimum exceeds the maximum. Review the salary range." });
  }
  const salaryCurrencyRaw = str(obj.salaryCurrency, 20).toUpperCase();
  const salaryCurrency = ["USD", "GBP", "EUR", "CAD", "AUD", "JPY"].includes(salaryCurrencyRaw) ? salaryCurrencyRaw : "";
  const salaryPeriodRaw = str(obj.salaryPeriod, 20);
  const salaryPeriod = ["yr", "mo", "hr"].includes(salaryPeriodRaw) ? salaryPeriodRaw : "";
  warn("salaryCurrency", salaryCurrency === currencyFromSalaryContext(salaryContext), salaryCurrency);
  warn("salaryPeriod", salaryPeriod === periodFromSalaryContext(salaryContext), salaryPeriod);
  const jobType = normalizeJobType(obj.jobType);
  warn("jobType", jobType === groundedJobType(obj.jobType, sourceText), jobType);
  const roleDescription = str(obj.roleDescription, 900);
  warn("roleDescription", Boolean(groundedRoleDescription(roleDescription, sourceText)), roleDescription);
  const techKeywords = strList(obj.techKeywords, { maxItems: 24, maxLen: 40, minLen: 1 });
  if (Array.isArray(obj.techKeywords) && obj.techKeywords.length > 24) warnings.push({ field: "techKeywords", message: "Additional generated terms were omitted at the display limit. Review the original posting for complete requirements." });
  for (const term of techKeywords) warn("techKeywords", groundedTech(term, sourceText), term);
  const result = {
    title: scalar("title"), company: scalar("company"), location: scalar("location"),
    jobType,
    workAuth: groundedJobCondition(str(obj.workAuth, 1000), "workAuth", sourceText, conditionIssues, warnings),
    salaryMin, salaryMax, salaryCurrency, salaryPeriod, roleDescription,
    responsibilities: list("responsibilities", 12, 1000),
    requiredQualifications: list("requiredQualifications", 12, 1000),
    preferredQualifications: list("preferredQualifications", 12, 1000),
    techKeywords,
    senioritySignals: list("senioritySignals", 8, 60),
    domainSignals: list("domainSignals", 8, 40),
    conditionIssues
  };
  const jobWarnings = sanitizeJobAnalysisWarnings(warnings);
  return { ...result, ...(jobWarnings ? { jobWarnings } : {}) };
}

export function sanitizePrepareAnalysisResponse(
  parsed: unknown,
  jobText: string,
  // The Fit Assessment inputs, or null when no screening was requested. The two
  // subsections are sanitized independently on purpose: a weak job half must
  // not discard a valid screening, and vice versa.
  fitInput: FitAssessmentInput | null
): { fields: ReturnType<typeof sanitizeJobAnalysis>; fitAssessment?: FitAssessmentResult | null; fitAssessmentError?: string } {
  const source = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const rawJob = fitInput && source.job && typeof source.job === "object"
    ? source.job
    : source;
  return {
    fields: sanitizeJobAnalysis(rawJob, jobText),
    ...(fitInput
      ? {
          ...evaluateFitAssessmentResponse(source.fitAssessment, {
            jobText,
            resumeText: fitInput.resumeText,
            candidateContext: fitInput.candidateContext
          })
        }
      : {})
  };
}

// Resolve provider from `body` (default provider when none given), call the model,
// and return checked fields plus the RESOLVED provider/model/reasoningEffort and
// the dispatch attempt count. Used by the /api/job-analysis route (extension imports
// also analyze through that route, client-side from the receiving tab — the
// server-side import pass only resolves the raw page text). Throws on
// no-provider / timeout / unreadable output so callers can decide how to degrade.
// apiKey is intentionally NOT returned — the route echoes only the
// non-secret resolved config.
export async function analyzeJobToFields({
  jobText,
  body = {},
  signal
}: {
  jobText: string;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}) {
  const { provider, apiKey, model, reasoningEffort } = resolveProviderRequest(body);
  const fitInput = fitAssessmentInput(body);
  const { systemPrompt, userPrompt } = buildJobAnalysisPrompts({ jobText, fitAssessment: fitInput });
  const stats: AttemptStats = {};
  const parsed = await callConfiguredProvider(
    { provider, model, reasoningEffort, apiKey, systemPrompt, userPrompt, signal },
    stats
  );
  const prepared = sanitizePrepareAnalysisResponse(parsed, jobText, fitInput);
  return {
    ...prepared,
    fitAssessmentRequested: Boolean(fitInput),
    provider,
    model,
    reasoningEffort,
    attempts: stats.attempts ?? 1
  };
}

export async function handleJobAnalysis(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }
  // Actual default validation happens inside the guarded resolver below.
  let provider = "claude-cli";
  const request = requestAbortSignal(req, res);
  try {
    const body = await readAiJsonBody(req, 2_000_000);
    const jobText = String(body.text ?? "");
    if (jobText.trim().length < 40) {
      sendJson(res, 400, { error: "Provide the job posting text to analyze (at least a short description)." });
      return;
    }
    // Resolve once for the error label / key validation, then analyze.
    provider = resolveProviderRequest(body).provider;
    if (body.mode === "fit-assessment") {
      const resumeText = String(body.resumeText ?? "");
      if (resumeText.trim().length < 40) {
        sendJson(res, 400, { error: "Load a resume before retrying Fit Assessment." });
        return;
      }
      const fit = await analyzeFitAssessment({
        jobText,
        resumeText,
        candidateContext: String(body.candidateContext ?? ""),
        body,
        signal: request.signal
      });
      sendJson(res, 200, {
        source: "ai",
        fitAssessment: fit.fitAssessment,
        fitAssessmentStatus: fit.fitAssessment ? "ready" : "unavailable",
        ...(fit.fitAssessmentError ? { fitAssessmentError: fit.fitAssessmentError } : {}),
        provider: fit.provider,
        model: fit.model,
        reasoningEffort: fit.reasoningEffort,
        attempts: fit.attempts
      });
      return;
    }
    const result = await analyzeJobToFields({ jobText, body, signal: request.signal });
    // Echo the RESOLVED provider/model/reasoningEffort (never the API key)
    // plus the dispatch attempt count so the client can record which model actually
    // produced the brief.
    sendJson(res, 200, {
      source: "ai",
      ...result.fields,
      provider: result.provider,
      model: result.model,
      reasoningEffort: result.reasoningEffort,
      attempts: result.attempts,
      ...(result.fitAssessmentRequested
        ? {
            fitAssessment: result.fitAssessment,
            fitAssessmentStatus: result.fitAssessment ? "ready" : "unavailable",
            ...(result.fitAssessmentError ? { fitAssessmentError: result.fitAssessmentError } : {})
          }
        : {})
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
    sendJson(res, 500, { error: "Could not analyze the job posting with AI." });
  } finally {
    request.dispose();
  }
}
