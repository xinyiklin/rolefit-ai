import { candidateClaimIssue, evidenceSegments } from "./claimEvidence.ts";
import { sanitizeContentWarnings } from "../../shared/contentWarnings.ts";
import { explicitEligibilityConflict, hasFitEvidenceConflict, isAffirmativeFitEvidence } from "./fitEvidence.ts";
import {
  INSUFFICIENT_JOB_SUMMARY,
  FIT_ASSESSMENT_ELIGIBILITY,
  FIT_ASSESSMENT_EVIDENCE_SOURCES,
  FIT_ASSESSMENT_SUMMARY,
  FIT_ASSESSMENT_VERDICTS,
  normalizeFitAssessmentInput,
  type FitAssessmentEligibilityStatus,
  type FitAssessmentMatch,
  type FitAssessmentGapDetail,
  type FitAssessmentResult,
  type FitAssessmentVerdict
} from "../../shared/fitAssessmentContract.ts";
import { callConfiguredProvider } from "./clients.ts";
import { clipForPrompt, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { resolveProviderRequest } from "./providers.ts";

const RESUME_CHAR_LIMIT = 28_000;
const JOB_CHAR_LIMIT = 24_000;
const CANDIDATE_CONTEXT_CHAR_LIMIT = 4_000;
const MAX_EXCERPT_LENGTH = 500;
const MAX_NOTE_LENGTH = 240;

const verdicts = new Set<string>(FIT_ASSESSMENT_VERDICTS);
const eligibilityStatuses = new Set<string>(FIT_ASSESSMENT_ELIGIBILITY);
const evidenceSources = new Set<string>(FIT_ASSESSMENT_EVIDENCE_SOURCES);
type AttemptStats = { attempts?: number };

const FIT_FAILURE_MESSAGES = {
  "input-limit": "Fit could not review all supplied text because it exceeds the assessment limit. Shorten the posting or candidate context, or select a shorter resume.",
  "invalid-response": "The AI returned an assessment in an unsupported format. Retry the assessment or choose another model in Fit settings."
} as const;
type FitFailureReason = keyof typeof FIT_FAILURE_MESSAGES;

export const FIT_ASSESSMENT_RESPONSE_SCHEMA = `{
  "status": "ASSESSED",
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
      "note": "optional short factual note",
      "relationship": "transferable",
      "candidateSource": "RESUME | CANDIDATE_CONTEXT",
      "candidateExcerpt": "exact candidate excerpt supporting the transferable relationship"
    }
  ],
  "eligibility": {
    "status": "CLEAR | CHECK | BLOCKED",
    "jobExcerpt": "exact job excerpt for CHECK or BLOCKED",
    "candidateExcerpt": "exact candidate-context excerpt required for BLOCKED",
    "note": "optional short factual note"
  }
}`;

export const FIT_ASSESSMENT_RULES = `Fit Assessment rules:
- Judge only the evidence currently supplied in the posting, selected resume, and candidate context. Assess the candidate's demonstrated fit for this role, not the potential of a future tailored resume.

Apply this rubric directly:
- STRONG: The candidate explicitly demonstrates most main responsibilities and core qualifications, with no major material gap.
- REASONABLE: The candidate explicitly demonstrates most main responsibilities, with only one or two material core gaps and a credible path to perform the role.
- STRETCH: There is meaningful relevant overlap, but several important gaps remain or the core experience is mostly transferable rather than direct.
- LIMITED: The supplied evidence shows little relevant foundation for the role's main work and core qualifications, either directly or through meaningful transferable experience. Generic skills or interest alone do not establish that foundation.
- First classify posting text into main responsibilities, core qualifications, preferred qualifications, logistics, and administrative or form content. Determine the verdict from the main responsibilities and core qualifications. Missing preferred items alone must not lower an otherwise STRONG or REASONABLE result. Logistics, benefits, equal-opportunity text, and administrative or application-form questions are not fit evidence.
- If the posting lacks substantive role responsibilities or qualifications after that classification, use exactly {"status":"INSUFFICIENT_JOB_INFORMATION"} as the Fit Assessment result, with no verdict, matches, gaps, or eligibility. In a combined Job analysis response, this object is the fitAssessment value. Do not infer requirements from a title, employer description, or application form.
- For LIMITED versus STRETCH only, when a substantive posting has meaningful direct evidence for supporting core work but the role-defining specialization is unshown, choose STRETCH. Meaningful transferable evidence for core work can also support STRETCH; do not choose LIMITED solely because that evidence is not a direct match. Reserve LIMITED for substantive postings with little relevant core foundation. This boundary never promotes a candidate to REASONABLE or STRONG.

Evidence rules:
- Missing evidence is a gap, not proof that the candidate is incapable.
- Return at most three matches and three gaps. Select the most decision-relevant findings: the central evidence and limiting gaps that best explain the verdict. Use posting order only as a tie-breaker between equally material findings.
- Every match copies an exact contiguous job excerpt and an exact contiguous excerpt from RESUME or CANDIDATE_CONTEXT. Every excerpt in matches, gaps, and eligibility must be at most ${MAX_EXCERPT_LENGTH} characters; choose a shorter contiguous source passage without dropping a condition that changes its meaning. Optional notes must be at most ${MAX_NOTE_LENGTH} characters.
- A match requires direct candidate evidence for the cited job item. Transferable or adjacent experience may inform the verdict but cannot prove an unshown specific requirement.
- Respect the posting's experience source. A requirement for professional, industry, commercial, or paid experience is not satisfied by academic, personal, volunteer, or open-source work unless the posting explicitly accepts that source. When the posting does not constrain the source, judge each declared source by its direct relevance.
- Candidate-context experience categories may overlap. Never add their years or counts together. A role/project count does not imply duration, and a duration in one category does not transfer to another.
- Every gap copies an exact contiguous job excerpt and uses status NOT_SHOWN. Absence is a gap, never a contradiction. For affirmative transferable evidence, include relationship "transferable", candidateSource, and an exact candidateExcerpt together; otherwise omit all three fields. STRONG and REASONABLE require at least one direct match. When STRETCH has no direct matches, at least one gap must include this affirmative transferable citation.
- A job excerpt may appear only once and must never appear in both matches and gaps.
- Return one gap per underlying missing need; do not count the same missing qualification twice through overlapping posting excerpts.
- Separate experience source, deployment environment, duration, and responsibility. Production deployments in a personal project may satisfy a source-neutral production requirement; they cannot satisfy professional duration.
- Judge requirements and transferable experience semantically. Preserve stated conditions and alternatives; do not require matching wording or produce hidden requirement bookkeeping.
- Do not add overlapping durations or invent years, degree equivalence, tools, scores, or percentages. Report uncertain or transferable support as a gap rather than a direct match.
- If the evidence genuinely falls between adjacent categories, choose the lower category unless the supplied candidate evidence meets the higher category's definition; STRETCH may rely on meaningful transferable core evidence.
- Determine the verdict without considering eligibility, then assess employment eligibility separately. Work authorization never counts as a match or gap and never lowers the verdict.
- Eligibility covers only work authorization, visa or sponsorship, security clearance, or legal ability to take the role; education, skills, and experience are fit evidence, not eligibility. CLEAR means no stated eligibility condition needs attention. CHECK means the posting states an eligibility condition the candidate should confirm. BLOCKED requires both an explicit posting condition and a conflicting explicit candidate-context fact.
- Location, onsite or hybrid schedule, relocation, and application-form questions are neither fit gaps nor eligibility conditions unless they state a legal-work restriction. When explicit candidate facts satisfy a stated eligibility condition, return CLEAR.
- Eligibility never changes the verdict. If the candidate context does not explicitly conflict, never return BLOCKED.
- Before returning JSON, locate and verify every job and candidate excerpt as exact contiguous character-for-character text in the supplied source. Never rewrite, combine, or normalize punctuation in an excerpt. If a source is uncertain, describe that uncertainty honestly; never invent a quotation to make a finding appear verified. Verify that no job excerpt appears twice or in both lists and that each list has at most three items.
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
    jobText: clipForPrompt(normalizeFitAssessmentInput(jobText), JOB_CHAR_LIMIT, "job posting"),
    resumeText: clipForPrompt(normalizeFitAssessmentInput(resumeText), RESUME_CHAR_LIMIT, "selected resume"),
    candidateContext: clipForPrompt(
      normalizeFitAssessmentInput(candidateContext),
      CANDIDATE_CONTEXT_CHAR_LIMIT,
      "candidate context"
    )
  };
}

function compactText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function excerpt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= MAX_EXCERPT_LENGTH && !/<[^>]*>/.test(text) ? text : null;
}

function dedupeKey(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function unexplainedCandidateClaim(text: string, sources: PromptSources): boolean {
  return evidenceSegments(text).some((segment) => {
    if (/\b(?:not (?:shown|established|provided|demonstrated|confirmed|evident|supported)|no evidence|missing evidence)\b/i.test(segment)) return false;
    return Boolean(candidateClaimIssue(segment, `${sources.resumeText}\n${sources.candidateContext}`));
  });
}

function sanitizeMatches(
  raw: unknown, sources: PromptSources, warnings: string[], reject: (reason: FitFailureReason) => null
): FitAssessmentMatch[] | null {
  if (!Array.isArray(raw) || raw.length > 3) return reject("invalid-response");
  const seen = new Set<string>();
  const matches: FitAssessmentMatch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return reject("invalid-response");
    const source = item as Record<string, unknown>;
    const jobExcerpt = excerpt(source.jobExcerpt);
    const candidateSource = compactText(source.candidateSource, 32).toUpperCase();
    const candidateExcerpt = source.candidateExcerpt === undefined || source.candidateExcerpt === "" ? "" : excerpt(source.candidateExcerpt);
    if (!evidenceSources.has(candidateSource) || !jobExcerpt || candidateExcerpt === null) return reject("invalid-response");
    const candidateText = candidateSource === "RESUME" ? sources.resumeText : sources.candidateContext;
    if (!sources.jobText.includes(jobExcerpt) || !candidateExcerpt || !candidateText.includes(candidateExcerpt)) {
      warnings.push(`Match ${matches.length + 1}: source reference could not be confirmed. Quoted text is unconfirmed.`);
    }
    const key = dedupeKey(jobExcerpt);
    if (seen.has(key)) warnings.push(`Match ${matches.length + 1}: this requirement is repeated.`);
    if (hasFitEvidenceConflict(jobExcerpt, candidateExcerpt, candidateText)) {
      warnings.push(`Match ${matches.length + 1}: not supported by provided evidence; an explicit conflict was detected.`);
    }
    seen.add(key);
    matches.push({ jobExcerpt, candidateSource: candidateSource as FitAssessmentMatch["candidateSource"], candidateExcerpt });
  }
  return matches;
}

function sanitizeGaps(
  raw: unknown, sources: PromptSources, occupied: ReadonlySet<string>, warnings: string[],
  reject: (reason: FitFailureReason) => null
): { gaps: string[]; gapDetails: FitAssessmentGapDetail[] } | null {
  if (!Array.isArray(raw) || raw.length > 3) return reject("invalid-response");
  const seen = new Set(occupied);
  const gaps: string[] = [];
  const gapDetails: FitAssessmentGapDetail[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return reject("invalid-response");
    const source = item as Record<string, unknown>;
    const jobExcerpt = excerpt(source.jobExcerpt);
    const status = compactText(source.status, 24).toUpperCase();
    const note = compactText(source.note, MAX_NOTE_LENGTH + 1);
    if (!jobExcerpt || status !== "NOT_SHOWN" || note.length > MAX_NOTE_LENGTH || /<[^>]*>/.test(note)) return reject("invalid-response");
    if (note && unexplainedCandidateClaim(note, sources)) warnings.push(`Gap ${gaps.length + 1}: explanatory claims are not supported by provided evidence.`);
    const key = dedupeKey(jobExcerpt);
    if (seen.has(key)) warnings.push(`Gap ${gaps.length + 1}: this requirement overlaps another finding.`);
    if (!sources.jobText.includes(jobExcerpt)) warnings.push(`Gap ${gaps.length + 1}: source reference could not be confirmed. Quoted text is unconfirmed.`);
    seen.add(key);
    gaps.push(jobExcerpt);
    const detail: FitAssessmentGapDetail = { jobExcerpt, ...(note ? { note } : {}) };
    if (source.relationship !== undefined) {
      if (source.relationship !== "transferable" && source.relationship !== "contradictory") return reject("invalid-response");
      detail.relationship = source.relationship;
    }
    if (source.candidateSource !== undefined) {
      const candidateSource = compactText(source.candidateSource, 32).toUpperCase();
      if (!evidenceSources.has(candidateSource)) return reject("invalid-response");
      detail.candidateSource = candidateSource as FitAssessmentMatch["candidateSource"];
    }
    if (source.candidateExcerpt !== undefined) {
      const candidateExcerpt = excerpt(source.candidateExcerpt);
      if (!candidateExcerpt) return reject("invalid-response");
      detail.candidateExcerpt = candidateExcerpt;
    }
    if (detail.relationship || detail.candidateExcerpt || detail.candidateSource) {
      const candidateText = detail.candidateSource === "RESUME" ? sources.resumeText : sources.candidateContext;
      if (!detail.candidateSource || !detail.candidateExcerpt || !candidateText.includes(detail.candidateExcerpt)) {
        warnings.push(`Gap ${gaps.length}: source reference could not be confirmed. Quoted text is unconfirmed.`);
      } else if (detail.relationship === "transferable" && !isAffirmativeFitEvidence(detail.candidateExcerpt, candidateText)) {
        warnings.push(`Gap ${gaps.length}: the cited text does not establish affirmative transferable support.`);
      } else if (detail.relationship === "contradictory" && !hasFitEvidenceConflict(jobExcerpt, detail.candidateExcerpt, candidateText)) {
        warnings.push(`Gap ${gaps.length}: the reported evidence conflict could not be confirmed.`);
      }
    }
    if (note || detail.relationship || detail.candidateSource || detail.candidateExcerpt) gapDetails.push(detail);
  }
  return { gaps, gapDetails };
}

function sanitizeEligibility(
  raw: unknown, sources: PromptSources, warnings: string[], reject: (reason: FitFailureReason) => null
): FitAssessmentResult["eligibility"] | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return reject("invalid-response");
  const source = raw as Record<string, unknown>;
  const status = compactText(source.status, 16).toUpperCase();
  if (!eligibilityStatuses.has(status)) return reject("invalid-response");
  const note = compactText(source.note, MAX_NOTE_LENGTH + 1);
  if (note.length > MAX_NOTE_LENGTH || /<[^>]*>/.test(note)) return reject("invalid-response");
  if (note && unexplainedCandidateClaim(note, sources)) warnings.push("Eligibility: explanatory claims are not supported by provided evidence.");
  const jobExcerpt = source.jobExcerpt === undefined || source.jobExcerpt === "" ? undefined : excerpt(source.jobExcerpt);
  const candidateExcerpt = source.candidateExcerpt === undefined || source.candidateExcerpt === "" ? undefined : excerpt(source.candidateExcerpt);
  if (jobExcerpt === null || candidateExcerpt === null) return reject("invalid-response");
  if ((status === "CHECK" || status === "BLOCKED") && (!jobExcerpt || !sources.jobText.includes(jobExcerpt)) ||
    candidateExcerpt && !sources.candidateContext.includes(candidateExcerpt)) {
    warnings.push("Eligibility: source reference could not be confirmed. Quoted text is unconfirmed.");
  }
  if (status === "BLOCKED" && !explicitEligibilityConflict(jobExcerpt ?? "", candidateExcerpt ?? "")) {
    warnings.push("Eligibility: not supported by provided evidence; the supplied context does not establish a clear conflict.");
  }
  return {
    status: status as FitAssessmentEligibilityStatus,
    ...(jobExcerpt ? { jobExcerpt } : {}),
    ...(candidateExcerpt ? { candidateExcerpt } : {}),
    ...(note ? { note } : {})
  };
}

export function sanitizeFitAssessmentResponse(
  raw: unknown,
  input: { jobText: unknown; resumeText: unknown; candidateContext?: unknown },
  reportFailure?: (reason: FitFailureReason) => void
): FitAssessmentResult | null {
  const reject = (reason: FitFailureReason): null => { reportFailure?.(reason); return null; };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject("invalid-response");
  const source = raw as Record<string, unknown>;
  if (normalizeFitAssessmentInput(input.jobText).length > JOB_CHAR_LIMIT || normalizeFitAssessmentInput(input.resumeText).length > RESUME_CHAR_LIMIT || normalizeFitAssessmentInput(input.candidateContext ?? "").length > CANDIDATE_CONTEXT_CHAR_LIMIT) return reject("input-limit");
  const sources = promptSources(input);
  if (source.status === "INSUFFICIENT_JOB_INFORMATION") {
    if (source.verdict !== undefined || source.eligibility !== undefined ||
      (source.matches !== undefined && (!Array.isArray(source.matches) || source.matches.length)) ||
      (source.gaps !== undefined && (!Array.isArray(source.gaps) || source.gaps.length))) return reject("invalid-response");
    return { status: "INSUFFICIENT_JOB_INFORMATION", summary: INSUFFICIENT_JOB_SUMMARY, matches: [], gaps: [] };
  }
  if (source.status !== undefined && source.status !== "ASSESSED") return reject("invalid-response");
  const verdict = compactText(source.verdict, 24).toUpperCase();
  if (!verdicts.has(verdict)) return reject("invalid-response");
  const warnings: string[] = [];
  const matches = sanitizeMatches(source.matches, sources, warnings, reject);
  if (!matches) return null;
  const gapResult = sanitizeGaps(source.gaps, sources, new Set(matches.map(({ jobExcerpt }) => dedupeKey(jobExcerpt))), warnings, reject);
  if (!gapResult) return null;
  const { gaps, gapDetails } = gapResult;
  if (verdict !== "LIMITED" && matches.length === 0 &&
    !(verdict === "STRETCH" && gapDetails.some((detail) => detail.relationship === "transferable"))) warnings.push("Verdict: not supported by provided evidence; no supporting candidate finding was supplied.");
  const eligibility = sanitizeEligibility(source.eligibility, sources, warnings, reject);
  if (eligibility === null) return null;

  if (source.summary !== undefined && typeof source.summary !== "string") return reject("invalid-response");
  const summary = source.summary === undefined ? "" : compactText(source.summary, 501);
  if (summary.length > 500 || /<[^>]*>/.test(summary)) return reject("invalid-response");
  if (summary && unexplainedCandidateClaim(summary, sources)) {
    warnings.push("Summary: not supported by provided evidence. Review candidate tools, metrics and outcomes.");
  }
  const typedVerdict = verdict as FitAssessmentVerdict;
  return {
    status: "ASSESSED",
    verdict: typedVerdict,
    summary: summary || FIT_ASSESSMENT_SUMMARY[typedVerdict],
    ...(warnings.length ? { warnings: sanitizeContentWarnings(warnings) } : {}),
    matches,
    gaps,
    ...(gapDetails.length ? { gapDetails } : {}),
    ...(eligibility ? { eligibility } : {})
  };
}

export function evaluateFitAssessmentResponse(
  raw: unknown,
  input: { jobText: unknown; resumeText: unknown; candidateContext?: unknown }
): { fitAssessment: FitAssessmentResult | null; fitAssessmentError?: string } {
  let failure: FitFailureReason | undefined;
  const fitAssessment = sanitizeFitAssessmentResponse(raw, input, (reason) => { failure = reason; });
  return { fitAssessment, ...(failure ? { fitAssessmentError: FIT_FAILURE_MESSAGES[failure] } : {}) };
}

export function fitAssessmentPromptSection({
  resumeText,
  candidateContext
}: {
  resumeText: unknown;
  candidateContext?: unknown;
}): string {
  const sources = promptSources({ jobText: "", resumeText, candidateContext });
  return `Also produce a compact Fit Assessment result using the candidate evidence below.

<selected_resume>
${fenceUntrusted(sources.resumeText) || "No usable resume was provided."}
</selected_resume>

<candidate_context>
${fenceUntrusted(sources.candidateContext) || "Not provided."}
</candidate_context>`;
}

export function buildFitAssessmentPrompts({
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

${FIT_ASSESSMENT_RULES}`;
  const userPrompt = `Screen the posting against the selected resume.

<job_description>
${fenceUntrusted(sources.jobText) || "Not provided."}
</job_description>

${fitAssessmentPromptSection({ resumeText: sources.resumeText, candidateContext: sources.candidateContext })}

Return the Fit Assessment result itself, without an outer key. For insufficient job information, use only the compact object in the rules. An assessed result uses this shape:
${FIT_ASSESSMENT_RESPONSE_SCHEMA}`;
  return { systemPrompt, userPrompt };
}

export async function analyzeFitAssessment({
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
  const { systemPrompt, userPrompt } = buildFitAssessmentPrompts({ jobText, resumeText, candidateContext });
  const stats: AttemptStats = {};
  const parsed = await callConfiguredProvider(
    { provider, apiKey, model, reasoningEffort, systemPrompt, userPrompt, signal },
    stats
  );
  return {
    ...evaluateFitAssessmentResponse(parsed, { jobText, resumeText, candidateContext }),
    provider,
    model,
    reasoningEffort,
    attempts: stats.attempts ?? 1
  };
}
