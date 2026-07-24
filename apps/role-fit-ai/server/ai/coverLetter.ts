// Cover-letter revision: a shared grounded reviser used by BOTH the
// /api/polish cover pass and the standalone /api/cover-letter handler, plus the
// HTTP handler for the standalone path. Anti-fabrication is enforced by the
// prose-mode grounding backstop — the letter may name the target company/role,
// but a JD SKILL term it claims that is absent from the resume + honest context
// is blanked so callers can surface revision failure and offer Retry.

import type { IncomingMessage, ServerResponse } from "node:http";
import { FetchTimeoutError, isRequestAborted, requestAbortSignal, sendJson } from "../http.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { readAiJsonBody } from "./json.ts";
import { resolveProviderRequest } from "./providers.ts";
import {
  buildCoverLetterPrompts,
  clipForPrompt,
  COVER_JOB_CHAR_LIMIT,
  COVER_RESUME_CHAR_LIMIT,
  COVER_SOURCE_CHAR_LIMIT
} from "./prompts.ts";
import { callConfiguredProvider } from "./clients.ts";
import { findUngroundedOutcomeClaim, proseHasUngroundedTerm } from "./grounding.ts";
import { hasUngroundedNumericClaim } from "./sanitize.ts";

// Upper bound on a returned cover letter (~3 paragraphs / 180-280 words is ~2k
// chars; this just caps a pathological provider response, matching the per-field
// caps in applicationAnswers.ts).
const COVER_LETTER_CHAR_LIMIT = 8_000;

// Optional dispatch-attempt collector (same additive pattern as the sanitizer's
// drop-stats): callConfiguredProvider bumps `attempts` once per dispatch attempt.
type AttemptStats = { attempts?: number };

// The resolved provider config + grounding inputs the grounded generator needs.
type CoverLetterArgs = {
  provider: string;
  model: string;
  reasoningEffort?: string | null;
  apiKey?: string;
  jobText: string;
  resumeText: string;
  sourceCoverLetterText: string;
  honestContext: string;
  customInstructions: string;
  signal?: AbortSignal;
};

// Build the cover-letter revision prompt, call the provider, and apply the grounding
// backstop. The grounding corpus is the resume text fed to the prompt plus
// honest context, so each caller grounds against exactly what produced the
// letter: the polish pass passes its polished/tailored text, the standalone
// path passes the current resume. Returns the letter, or "" when it is empty or
// blanked for an ungrounded claim (callers treat that as a failed revision).
export async function reviseGroundedCoverLetter({
  provider,
  model,
  reasoningEffort,
  apiKey,
  jobText,
  resumeText,
  sourceCoverLetterText,
  honestContext,
  customInstructions,
  signal
}: CoverLetterArgs, stats?: AttemptStats): Promise<string> {
  const { systemPrompt, userPrompt } = buildCoverLetterPrompts({
    jobText: clipForPrompt(jobText, COVER_JOB_CHAR_LIMIT, "job description"),
    resumeText: clipForPrompt(resumeText, COVER_RESUME_CHAR_LIMIT, "resume"),
    sourceCoverLetterText: clipForPrompt(
      sourceCoverLetterText,
      COVER_SOURCE_CHAR_LIMIT,
      "source cover letter"
    ),
    honestContext,
    customInstructions
  });
  const parsed = await callConfiguredProvider({
    provider,
    model,
    reasoningEffort,
    apiKey,
    systemPrompt,
    userPrompt,
    signal
  }, stats);
  const letter = String((parsed as { coverLetterText?: unknown }).coverLetterText ?? "").trim().slice(0, COVER_LETTER_CHAR_LIMIT);
  const grounding = `${sourceCoverLetterText}\n${resumeText}\n${honestContext}`;
  if (
    proseHasUngroundedTerm(letter, jobText.toLowerCase(), grounding.toLowerCase())
    || hasUngroundedNumericClaim(letter, grounding)
    || findUngroundedOutcomeClaim(letter, grounding, { candidateProse: true })
  ) {
    console.warn("[ai] cover letter introduced an ungrounded claim; returning an empty result", { provider });
    return "";
  }
  return letter;
}

export async function handleCoverLetter(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  const request = requestAbortSignal(req, res);
  try {
    const body = await readAiJsonBody(req, 1_000_000);
    const resumeText = String(body.resumeText ?? "").slice(0, 45_000);
    const jobText = String(body.jobText ?? "").slice(0, 35_000);
    const sourceCoverLetterText = String(body.sourceCoverLetterText ?? "").slice(0, 35_000);
    const honestContext = String(body.honestContext ?? "").slice(0, 8_000);
    const customInstructions = String(body.customInstructions ?? "").slice(0, 4_000);

    if (sourceCoverLetterText.trim().length < 80) {
      sendJson(res, 400, { error: "Open your own cover letter before tailoring it." });
      return;
    }
    if (resumeText.trim().length < 80) {
      sendJson(res, 400, { error: "Add your resume before tailoring a cover letter." });
      return;
    }
    if (jobText.trim().length < 40) {
      sendJson(res, 400, { error: "Add the job description so the cover letter can be tailored to this role." });
      return;
    }

    const resolved = resolveProviderRequest(body);
    const { provider, apiKey, model, reasoningEffort } = resolved;

    const coverStats: AttemptStats = {};
    const coverLetterText = await reviseGroundedCoverLetter({
      provider,
      model,
      reasoningEffort,
      apiKey,
      jobText,
      resumeText,
      sourceCoverLetterText,
      honestContext,
      customInstructions,
      signal: request.signal
    }, coverStats);

    // Echo the resolved provider/model/reasoningEffort (never the API key).
    sendJson(res, 200, { coverLetterText, model, provider, reasoningEffort, attempts: coverStats.attempts ?? 1 });
  } catch (error) {
    if (isRequestAborted(error, req, res)) return;
    if (error instanceof UserSafeAiError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    if (error instanceof FetchTimeoutError || (error instanceof Error && /timed out|timeout/i.test(error.message))) {
      sendJson(res, 504, { error: "The AI provider timed out. Try again or switch providers." });
      return;
    }
    if (error instanceof Error && error.message === "Request is too large.") {
      sendJson(res, 413, { error: "Request is too large. Shorten the cover letter, resume, or job text." });
      return;
    }
    const configMessage = safeConfigErrorMessage(error instanceof Error ? error.message : "");
    if (configMessage) {
      sendJson(res, 400, { error: configMessage });
      return;
    }
    sendJson(res, 500, { error: "Could not tailor the cover letter. Check AI settings and try again." });
  } finally {
    request.dispose();
  }
}
