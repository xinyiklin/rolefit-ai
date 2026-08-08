import { sanitizeQuickFit } from "../../shared/quickFitContract.ts";
import type { QuickFitResult } from "../../shared/quickFitContract.ts";
import { callConfiguredProvider } from "./clients.ts";
import { AUTH_STEMS, mentionsAuthStem } from "./eligibilityLexicon.ts";
import {
  LIST_STOPWORDS,
  distinctiveTokenKeys,
  findUngroundedCuratedClaimTerm
} from "./grounding.ts";
import { clipForPrompt, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { resolveProviderRequest } from "./providers.ts";

const RESUME_CHAR_LIMIT = 28_000;
const JOB_CHAR_LIMIT = 24_000;

function text(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export { sanitizeQuickFit } from "../../shared/quickFitContract.ts";

export type QuickFitSources = {
  jobText: string;
  resumeText: string;
  candidateContext?: string;
};

// Initial Fit is a fast decision aid, so it gets a deliberately NARROW accuracy
// layer rather than the retired evidence ledger and forensic validator: the
// shape sanitizer alone accepted any confident-sounding sentence, while a full
// audit is the overcomplication this workflow removed. Only the three
// hallucinations that actually mislead an applicant are rejected here, and
// ordinary semantic description is left to the model:
//
//   1. a named technology in a match or gap that appears in NEITHER source;
//   2. a gap whose distinctive terms appear nowhere in the posting;
//   3. an eligibility note claiming a work-authorization class that neither the
//      posting nor the candidate's own context mentions.
//
// The verdict and summary are not filtered. A verdict is a judgement, not a
// claim of fact, and dropping a whole screening over one summary word would
// trade a small inaccuracy for no screening at all.
export function groundQuickFit(
  result: QuickFitResult | null,
  { jobText, resumeText, candidateContext = "" }: QuickFitSources
): QuickFitResult | null {
  if (!result) return null;
  // A match asserts overlap and a gap asserts a requirement, so a technology
  // named in either must exist somewhere real. Requiring it in BOTH would drop
  // honest paraphrase (a posting's "Go" against a resume's "Golang"); requiring
  // it in neither is the anti-fabrication floor.
  const namedSources = `${jobText}\n${resumeText}`;
  const postingTokens = new Set(distinctiveTokenKeys(jobText, LIST_STOPWORDS));

  const matches = result.matches.filter((match) => !findUngroundedCuratedClaimTerm(match, namedSources));
  const gaps = result.gaps.filter((gap) => {
    if (findUngroundedCuratedClaimTerm(gap, namedSources)) return false;
    const tokens = distinctiveTokenKeys(gap, LIST_STOPWORDS);
    // Nothing distinctive left after stop-words is not evidence of invention.
    return tokens.length === 0 || tokens.some((token) => postingTokens.has(token));
  });

  let eligibility = result.eligibility;
  if (eligibility?.note) {
    const eligibilitySources = `${jobText}\n${candidateContext}`;
    const claimedStems = AUTH_STEMS.filter((stem) => mentionsAuthStem(eligibility!.note!, stem));
    const invented =
      claimedStems.length > 0 &&
      !claimedStems.some((stem) => mentionsAuthStem(eligibilitySources, stem));
    // Drop the invented sentence, keep the status: a wrongly raised concern is
    // the safe direction, and the rail already has neutral wording for a flag
    // with no note. Never the reverse — nothing here can invent a CLEAR.
    if (invented) eligibility = { status: eligibility.status };
  }

  return {
    ...result,
    matches,
    gaps,
    ...(eligibility ? { eligibility } : {})
  };
}

export function quickFitPromptSection({
  resumeText,
  resumeLabel,
  candidateContext
}: {
  resumeText: unknown;
  resumeLabel: unknown;
  candidateContext?: unknown;
}): string {
  return `Also perform a quick Initial Fit screening using ONLY the selected resume and candidate context below.

This is a fast decision aid, not a forensic audit. Return:
- one verdict: STRONG, REASONABLE, STRETCH, or LIMITED
- one short plain-language summary
- at most 3 concise matches grounded in BOTH the posting and resume
- at most 3 important gaps grounded in the posting
- eligibility only when the posting or candidate context raises a real concern

Do not return a score, confidence, requirement ledger, evidence quotations, IDs, recommendation action, or resume-surfacing permission.
Do not invent candidate evidence. A missing requirement is a gap, never permission to add it to the resume.

<selected_resume_label>
${fenceUntrusted(text(resumeLabel, 160))}
</selected_resume_label>

<selected_resume>
${fenceUntrusted(clipForPrompt(resumeText, RESUME_CHAR_LIMIT, "selected resume")) || "No usable resume was provided."}
</selected_resume>

<candidate_context>
${fenceUntrusted(clipForPrompt(candidateContext, 4_000, "candidate context")) || "Not provided."}
</candidate_context>`;
}

export function buildQuickFitPrompts({
  jobText,
  resumeText,
  resumeLabel,
  candidateContext
}: {
  jobText: unknown;
  resumeText: unknown;
  resumeLabel: unknown;
  candidateContext?: unknown;
}) {
  const systemPrompt = `You are a careful resume-to-job screening assistant. Return exactly one JSON object and no markdown.

${inputFirewallRule()}

Use only explicit evidence from the posting, selected resume, and candidate context. Never invent skills, experience, eligibility, employers, dates, metrics, tools, or outcomes.`;
  const userPrompt = `Screen the posting against the selected resume.

<job_description>
${fenceUntrusted(clipForPrompt(jobText, JOB_CHAR_LIMIT, "job posting")) || "Not provided."}
</job_description>

${quickFitPromptSection({ resumeText, resumeLabel, candidateContext })}

Return the Initial Fit object itself, without an outer key, in this shape:
{
  "verdict": "STRONG | REASONABLE | STRETCH | LIMITED",
  "summary": "one short explanation",
  "matches": ["up to 3 concise matches"],
  "gaps": ["up to 3 important gaps"],
  "eligibility": { "status": "CLEAR | CHECK | BLOCKED", "note": "optional" }
}`;
  return { systemPrompt, userPrompt };
}

export async function analyzeQuickFit({
  jobText,
  resumeText,
  resumeLabel,
  candidateContext,
  body = {},
  signal
}: {
  jobText: string;
  resumeText: string;
  resumeLabel: string;
  candidateContext?: string;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}) {
  const { provider, apiKey, model, reasoningEffort } = resolveProviderRequest(body);
  const { systemPrompt, userPrompt } = buildQuickFitPrompts({
    jobText,
    resumeText,
    resumeLabel,
    candidateContext
  });
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
    initialFit: groundQuickFit(sanitizeQuickFit(parsed), { jobText, resumeText, candidateContext }),
    provider,
    model,
    reasoningEffort
  };
}
