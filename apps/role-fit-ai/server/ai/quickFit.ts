import { sanitizeQuickFit } from "../../shared/quickFitContract.ts";
import { callConfiguredProvider } from "./clients.ts";
import { clipForPrompt, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { resolveProviderRequest } from "./providers.ts";

const RESUME_CHAR_LIMIT = 28_000;
const JOB_CHAR_LIMIT = 24_000;

function text(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export { sanitizeQuickFit } from "../../shared/quickFitContract.ts";

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

<selected_resume label="${fenceUntrusted(text(resumeLabel, 160))}">
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
    initialFit: sanitizeQuickFit(parsed),
    provider,
    model,
    reasoningEffort
  };
}
