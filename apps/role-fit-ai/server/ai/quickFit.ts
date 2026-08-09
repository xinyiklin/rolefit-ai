import {
  QUICK_FIT_ELIGIBILITY,
  QUICK_FIT_EVIDENCE_SOURCES,
  QUICK_FIT_SUMMARY,
  QUICK_FIT_VERDICTS,
  normalizeQuickFitInput,
  type QuickFitEligibilityStatus,
  type QuickFitResult,
  type QuickFitVerdict
} from "../../shared/quickFitContract.ts";
import { callConfiguredProvider } from "./clients.ts";
import { clipForPrompt, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { resolveProviderRequest } from "./providers.ts";

const RESUME_CHAR_LIMIT = 28_000;
const JOB_CHAR_LIMIT = 24_000;
const CANDIDATE_CONTEXT_CHAR_LIMIT = 4_000;
const MAX_EXCERPT_LENGTH = 500;
const MAX_NOTE_LENGTH = 240;

const verdicts = new Set<string>(QUICK_FIT_VERDICTS);
const eligibilityStatuses = new Set<string>(QUICK_FIT_ELIGIBILITY);
const evidenceSources = new Set<string>(QUICK_FIT_EVIDENCE_SOURCES);

export const QUICK_FIT_RESPONSE_SCHEMA = `{
  "verdict": "STRONG | REASONABLE | STRETCH | LIMITED",
  "matches": [
    {
      "jobExcerpt": "exact contiguous excerpt from the job posting",
      "candidateSource": "RESUME | CANDIDATE_CONTEXT",
      "candidateExcerpt": "exact contiguous excerpt from that candidate source"
    }
  ],
  "gaps": [
    {
      "jobExcerpt": "exact contiguous excerpt from the job posting",
      "status": "NOT_SHOWN",
      "note": "optional short factual note"
    }
  ],
  "eligibility": {
    "status": "CLEAR | CHECK | BLOCKED",
    "jobExcerpt": "exact job excerpt for CHECK or BLOCKED",
    "candidateExcerpt": "exact candidate-context excerpt required for BLOCKED",
    "note": "optional short factual note"
  }
}`;

export const QUICK_FIT_RULES = `Initial Fit rules:
- Judge only the evidence currently supplied in the posting, selected resume, and candidate context. Assess the candidate's demonstrated fit for this role, not the potential of a future tailored resume.

Apply this rubric directly:
- STRONG: The candidate explicitly demonstrates most main responsibilities and core qualifications, with no major material gap.
- REASONABLE: The candidate explicitly demonstrates most main responsibilities, with only one or two material core gaps and a credible path to perform the role.
- STRETCH: There is meaningful relevant overlap, but several important gaps remain or the core experience is mostly transferable rather than direct.
- LIMITED: The candidate shows little direct evidence for the role's main responsibilities and core qualifications.

Evidence rules:
- Missing evidence is a gap, not proof that the candidate is incapable.
- Return at most three matches and three gaps. Preserve posting order; when evidence is tied, choose the earliest material item in the posting.
- Every match copies an exact contiguous job excerpt and an exact contiguous excerpt from RESUME or CANDIDATE_CONTEXT.
- Every gap copies an exact contiguous job excerpt and uses status NOT_SHOWN. Absence is a gap, never a contradiction.
- Do not infer years, degree equivalence, skill adjacency, alternatives, scores, percentages, or hidden requirement bookkeeping.
- If the evidence genuinely falls between adjacent categories, choose the lower category unless direct candidate evidence supports the higher one.
- Assess employment eligibility separately from fit. CLEAR means no stated condition needs attention. CHECK means the posting states a condition the candidate should confirm. BLOCKED requires both an explicit posting condition and a conflicting explicit candidate-context fact.
- Eligibility never changes the verdict. If the candidate context does not explicitly conflict, never return BLOCKED.
- Return only the fields in the response shape.`;

type PromptSources = {
  jobText: string;
  resumeText: string;
  candidateContext: string;
};

function promptSources({
  jobText,
  resumeText,
  candidateContext
}: {
  jobText: unknown;
  resumeText: unknown;
  candidateContext?: unknown;
}): PromptSources {
  return {
    jobText: clipForPrompt(normalizeQuickFitInput(jobText), JOB_CHAR_LIMIT, "job posting"),
    resumeText: clipForPrompt(normalizeQuickFitInput(resumeText), RESUME_CHAR_LIMIT, "selected resume"),
    candidateContext: clipForPrompt(
      normalizeQuickFitInput(candidateContext),
      CANDIDATE_CONTEXT_CHAR_LIMIT,
      "candidate context"
    )
  };
}

function compactText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function exactExcerpt(value: unknown, source: string): string | null {
  if (typeof value !== "string") return null;
  const excerpt = value.trim();
  if (!excerpt || excerpt.length > MAX_EXCERPT_LENGTH || !source.includes(excerpt)) return null;
  return excerpt.replace(/\s+/g, " ");
}

function dedupeKey(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function sanitizeMatches(raw: unknown, sources: PromptSources): string[] | null {
  if (!Array.isArray(raw) || raw.length > 3) return null;
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const source = item as Record<string, unknown>;
    const jobExcerpt = exactExcerpt(source.jobExcerpt, sources.jobText);
    const candidateSource = compactText(source.candidateSource, 32).toUpperCase();
    if (!jobExcerpt || !evidenceSources.has(candidateSource)) return null;
    const candidateExcerpt = exactExcerpt(
      source.candidateExcerpt,
      candidateSource === "RESUME" ? sources.resumeText : sources.candidateContext
    );
    const key = dedupeKey(jobExcerpt);
    if (!candidateExcerpt || seen.has(key)) return null;
    seen.add(key);
    matches.push(jobExcerpt);
  }
  return matches;
}

function sanitizeGaps(raw: unknown, sources: PromptSources, occupied: ReadonlySet<string>): string[] | null {
  if (!Array.isArray(raw) || raw.length > 3) return null;
  const seen = new Set(occupied);
  const gaps: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const source = item as Record<string, unknown>;
    const jobExcerpt = exactExcerpt(source.jobExcerpt, sources.jobText);
    const status = compactText(source.status, 24).toUpperCase();
    const note = compactText(source.note, MAX_NOTE_LENGTH + 1);
    const key = jobExcerpt ? dedupeKey(jobExcerpt) : "";
    if (!jobExcerpt || status !== "NOT_SHOWN" || note.length > MAX_NOTE_LENGTH || seen.has(key)) return null;
    seen.add(key);
    gaps.push(jobExcerpt);
  }
  return gaps;
}

function sanitizeEligibility(raw: unknown, sources: PromptSources): QuickFitResult["eligibility"] | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const status = compactText(source.status, 16).toUpperCase();
  if (!eligibilityStatuses.has(status)) return null;
  const note = compactText(source.note, MAX_NOTE_LENGTH + 1);
  if (note.length > MAX_NOTE_LENGTH) return null;

  if (status === "CHECK" || status === "BLOCKED") {
    if (!exactExcerpt(source.jobExcerpt, sources.jobText)) return null;
  }
  if (status === "BLOCKED" && !exactExcerpt(source.candidateExcerpt, sources.candidateContext)) return null;
  if (source.candidateExcerpt !== undefined && status !== "BLOCKED") {
    if (!exactExcerpt(source.candidateExcerpt, sources.candidateContext)) return null;
  }

  return {
    status: status as QuickFitEligibilityStatus,
    ...(note ? { note } : {})
  };
}

export function sanitizeQuickFitResponse(
  raw: unknown,
  input: { jobText: unknown; resumeText: unknown; candidateContext?: unknown }
): QuickFitResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const verdict = compactText(source.verdict, 24).toUpperCase();
  if (!verdicts.has(verdict)) return null;
  const sources = promptSources(input);
  const matches = sanitizeMatches(source.matches, sources);
  if (!matches) return null;
  const gaps = sanitizeGaps(source.gaps, sources, new Set(matches.map(dedupeKey)));
  if (!gaps) return null;
  const eligibility = sanitizeEligibility(source.eligibility, sources);
  if (eligibility === null) return null;

  const typedVerdict = verdict as QuickFitVerdict;
  return {
    verdict: typedVerdict,
    summary: QUICK_FIT_SUMMARY[typedVerdict],
    matches,
    gaps,
    ...(eligibility ? { eligibility } : {})
  };
}

export function quickFitPromptSection({
  resumeText,
  candidateContext
}: {
  resumeText: unknown;
  candidateContext?: unknown;
}): string {
  const sources = promptSources({ jobText: "", resumeText, candidateContext });
  return `Also produce a compact Initial Fit result using the candidate evidence below.

<selected_resume>
${fenceUntrusted(sources.resumeText) || "No usable resume was provided."}
</selected_resume>

<candidate_context>
${fenceUntrusted(sources.candidateContext) || "Not provided."}
</candidate_context>`;
}

export function buildQuickFitPrompts({
  jobText,
  resumeText,
  candidateContext
}: {
  jobText: unknown;
  resumeText: unknown;
  candidateContext?: unknown;
}) {
  const sources = promptSources({ jobText, resumeText, candidateContext });
  const systemPrompt = `You are a careful resume-to-job screening assistant. Return exactly one JSON object and no markdown.

${inputFirewallRule()}

Use only explicit evidence from the posting, selected resume, and candidate context. Never invent skills, experience, eligibility, employers, dates, metrics, tools, outcomes, requirements, or evidence excerpts.

${QUICK_FIT_RULES}`;
  const userPrompt = `Screen the posting against the selected resume.

<job_description>
${fenceUntrusted(sources.jobText) || "Not provided."}
</job_description>

${quickFitPromptSection({ resumeText: sources.resumeText, candidateContext: sources.candidateContext })}

Return the Initial Fit result itself, without an outer key, in this shape:
${QUICK_FIT_RESPONSE_SCHEMA}`;
  return { systemPrompt, userPrompt };
}

export async function analyzeQuickFit({
  jobText,
  resumeText,
  candidateContext,
  body = {},
  signal
}: {
  jobText: string;
  resumeText: string;
  candidateContext?: string;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}) {
  const { provider, apiKey, model, reasoningEffort } = resolveProviderRequest(body);
  const { systemPrompt, userPrompt } = buildQuickFitPrompts({ jobText, resumeText, candidateContext });
  const parsed = await callConfiguredProvider({
    provider,
    apiKey,
    model,
    reasoningEffort,
    systemPrompt,
    userPrompt,
    signal
  });
  return {
    initialFit: sanitizeQuickFitResponse(parsed, { jobText, resumeText, candidateContext }),
    provider,
    model,
    reasoningEffort
  };
}
