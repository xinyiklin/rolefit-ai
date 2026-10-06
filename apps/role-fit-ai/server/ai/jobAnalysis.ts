// Job analysis extracts a posting into bounded structured fields.
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  FetchTimeoutError,
  isRequestAborted,
  requestAbortSignal,
  sendJson
} from "../http.ts";
import { candidateContextLimitError } from "../../shared/candidateProfileContract.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { readAiJsonBody } from "./json.ts";
import { providerLabel, resolveProviderRequest } from "./providers.ts";
import { callConfiguredProvider } from "./clients.ts";
import { clipForPrompt, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import {
  FIT_ASSESSMENT_RULES,
  FIT_ASSESSMENT_RESPONSE_SCHEMA,
  analyzeFitAssessment,
  fitAssessmentInputLimitError,
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
  const systemPrompt = `You are a precise job-posting parser. Extract and organize one job posting into a concise structured JSON object using only the information it provides.

${inputFirewallRule()}

ABSOLUTE RULES (anti-fabrication — this is the whole job):
1. Extract only what the posting actually states. If a field is not stated, return "" (empty string), null, or [] — never guess, infer, or fill from typical postings.
2. Never invent a company, title, location, salary, technology, or requirement. You may summarize and paraphrase while preserving the stated facts, alternatives, negation, thresholds, and required versus preferred qualifications.
3. Do NOT put benefits, perks, pay/compensation prose, EEO/legal/diversity statements, application instructions, recruiter marketing, or "about the company" fluff into responsibilities or qualifications.
4. techKeywords are ONLY concrete technologies/languages/frameworks/tools/platforms NAMED in the posting (e.g. "Python", "React", "AWS", "Kubernetes"). Never a generic skill ("communication") and never a tool the posting does not name.
5. roleDescription is a concise neutral summary of the posting's role/company description. Do not add implied context.
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
  "roleDescription": "a concise neutral 1-3 sentence summary of the stated role/company description, or \\"\\"",
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

function str(value: unknown, max = 200): string {
  return typeof value === "string" ? value.replace(/<\/?[a-z][^>]*>/gi, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
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

function normalizeJobType(value: unknown): string {
  const t = str(value, 40);
  if (/full[-\s]?time/i.test(t)) return "Full-time";
  if (/part[-\s]?time/i.test(t)) return "Part-time";
  if (/\bcontract\b/i.test(t)) return "Contract";
  if (/\bintern(ship)?\b/i.test(t)) return "Internship";
  if (/\btemp(orary)?\b/i.test(t)) return "Temporary";
  return "";
}

export function sanitizeJobAnalysis(parsed: unknown) {
  const obj = (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as Record<string, unknown>;
  const amount = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  const salaryMin = amount(obj.salaryMin);
  const salaryMax = amount(obj.salaryMax);
  const hasSalary = salaryMin !== null || salaryMax !== null;
  const currency = str(obj.salaryCurrency, 20).toUpperCase();
  const period = str(obj.salaryPeriod, 20);
  return {
    title: str(obj.title),
    company: str(obj.company),
    location: str(obj.location),
    jobType: normalizeJobType(obj.jobType),
    workAuth: str(obj.workAuth, 1000),
    salaryMin,
    salaryMax,
    salaryCurrency: hasSalary && ["USD", "GBP", "EUR", "CAD", "AUD", "JPY"].includes(currency) ? currency : "",
    salaryPeriod: hasSalary && ["yr", "mo", "hr"].includes(period) ? period : "",
    roleDescription: str(obj.roleDescription, 900),
    responsibilities: strList(obj.responsibilities, { maxItems: 12, maxLen: 1000, minLen: 1 }),
    requiredQualifications: strList(obj.requiredQualifications, { maxItems: 12, maxLen: 1000, minLen: 1 }),
    preferredQualifications: strList(obj.preferredQualifications, { maxItems: 12, maxLen: 1000, minLen: 1 }),
    techKeywords: strList(obj.techKeywords, { maxItems: 24, maxLen: 40, minLen: 1 }),
    senioritySignals: strList(obj.senioritySignals, { maxItems: 8, maxLen: 60, minLen: 1 }),
    domainSignals: strList(obj.domainSignals, { maxItems: 8, maxLen: 40, minLen: 1 })
  };
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
    fields: sanitizeJobAnalysis(rawJob),
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
  const requestedFit = fitAssessmentInput(body);
  // Oversized Fit inputs never reach the provider; Job analysis still runs. The
  // Profile is named first because its message tells the user where to fix it.
  const fitLimitError = requestedFit
    ? candidateContextLimitError(requestedFit.candidateContext ?? "")
      ?? fitAssessmentInputLimitError({ jobText, resumeText: requestedFit.resumeText, candidateContext: requestedFit.candidateContext })
    : null;
  const fitInput = fitLimitError ? null : requestedFit;
  const { systemPrompt, userPrompt } = buildJobAnalysisPrompts({ jobText, fitAssessment: fitInput });
  const stats: AttemptStats = {};
  const parsed = await callConfiguredProvider(
    { provider, model, reasoningEffort, apiKey, systemPrompt, userPrompt, signal },
    stats
  );
  const prepared = sanitizePrepareAnalysisResponse(parsed, jobText, fitInput);
  return {
    ...prepared,
    ...(fitLimitError ? { fitAssessment: null, fitAssessmentError: fitLimitError } : {}),
    fitAssessmentRequested: Boolean(requestedFit),
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
      const candidateContext = String(body.candidateContext ?? "");
      const contextLimitError = candidateContextLimitError(candidateContext);
      if (contextLimitError) {
        sendJson(res, 400, { error: contextLimitError });
        return;
      }
      const fit = await analyzeFitAssessment({
        jobText,
        resumeText,
        candidateContext,
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
