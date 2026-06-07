// /api/polish route handler. The route is intentionally multi-pass: rewrite
// first, an optional strict recruiter audit second, and an optional cover
// letter third, so one model response is not forced to rewrite, score, audit,
// and draft a letter at once. Provider config, prompts, provider clients,
// response sanitizing, and error types live in sibling modules under server/ai/.

import { FetchTimeoutError, readBody, sendJson } from "../http.mjs";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.mjs";
import {
  getDefaultProvider,
  normalizeProvider,
  providerLabel,
  resolveAuditProviderRequest,
  resolveProviderRequest
} from "./providers.mjs";
import {
  COVER_JOB_CHAR_LIMIT,
  COVER_RESUME_CHAR_LIMIT,
  STRICT_REVIEW_JOB_CHAR_LIMIT,
  STRICT_REVIEW_RESUME_CHAR_LIMIT,
  buildCoverLetterPrompts,
  buildPolishPrompts,
  buildStrictReviewPrompts,
  clipForPrompt
} from "./prompts.mjs";
import { callConfiguredProvider } from "./clients.mjs";
import {
  missingRequiredSkillsFromStrictReview,
  reconcileScoreToVerdict,
  sanitizeAiScore,
  sanitizeMissingRequiredSkills
} from "./sanitize.mjs";

export async function handlePolish(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  let provider = normalizeProvider(getDefaultProvider());
  try {
    const body = JSON.parse(await readBody(req));
    const resumeText = String(body.resumeText ?? "").slice(0, 45_000);
    const jobText = String(body.jobText ?? "").slice(0, 35_000);
    const includeCoverLetter = Boolean(body.includeCoverLetter);
    const preserveFormat = Boolean(body.preserveFormat);
    const sourceFormat = String(body.sourceFormat ?? "").slice(0, 60);
    const strictReview = Boolean(body.strictReview);
    const roleAppliedAs = String(body.roleAppliedAs ?? "").slice(0, 80);
    const honestContext = String(body.honestContext ?? "").slice(0, 8_000);
    const customInstructions = String(body.customInstructions ?? "").slice(0, 4_000);

    if (resumeText.trim().length < 80 || jobText.trim().length < 40) {
      sendJson(res, 400, { error: "Add a resume and job description before polishing." });
      return;
    }

    const resolved = resolveProviderRequest(body);
    provider = resolved.provider;
    const { apiKey, apiBaseUrl, model, reasoningEffort } = resolved;

    const { systemPrompt, userPrompt } = buildPolishPrompts({
      jobText,
      preserveFormat,
      sourceFormat,
      resumeText,
      honestContext,
      customInstructions
    });

    const parsed = await callConfiguredProvider({ provider, model, reasoningEffort, apiKey, apiBaseUrl, systemPrompt, userPrompt });
    const polishedText = String(parsed.polishedText ?? "").trim();
    if (!polishedText) {
      throw new UserSafeAiError("AI response did not include polished resume text. Try again or switch models.", 502);
    }

    let strictReviewResult = null;
    let strictFitScore = null;
    // The audit reuses the primary config unless the request assigns an
    // independent reviewer provider. A different reviewer audits what the
    // rewrite produced without the rewriting model's self-consistency bias; the
    // audit pass never rewrites the resume, so a different reviewer model cannot
    // alter the format-preserved output.
    const audit = strictReview ? resolveAuditProviderRequest(body, resolved) : resolved;
    if (strictReview) {
      const reviewPrompts = buildStrictReviewPrompts({
        jobText: clipForPrompt(jobText, STRICT_REVIEW_JOB_CHAR_LIMIT, "job description"),
        resumeText: clipForPrompt(resumeText, STRICT_REVIEW_RESUME_CHAR_LIMIT, "original resume"),
        polishedText: clipForPrompt(polishedText, STRICT_REVIEW_RESUME_CHAR_LIMIT, "polished resume"),
        roleAppliedAs,
        honestContext,
        customInstructions
      });
      const reviewParsed = await callConfiguredProvider({
        provider: audit.provider,
        model: audit.model,
        reasoningEffort: audit.reasoningEffort,
        apiKey: audit.apiKey,
        apiBaseUrl: audit.apiBaseUrl,
        systemPrompt: reviewPrompts.systemPrompt,
        userPrompt: reviewPrompts.userPrompt
      });
      strictReviewResult = reviewParsed.strictReview ?? null;
      strictFitScore = reviewParsed.fitScore ?? null;
    }

    let coverLetterText = "";
    if (includeCoverLetter) {
      const coverPrompts = buildCoverLetterPrompts({
        jobText: clipForPrompt(jobText, COVER_JOB_CHAR_LIMIT, "job description"),
        resumeText: clipForPrompt(resumeText, COVER_RESUME_CHAR_LIMIT, "original resume"),
        polishedText: clipForPrompt(polishedText, COVER_RESUME_CHAR_LIMIT, "polished resume"),
        roleAppliedAs,
        honestContext,
        customInstructions
      });
      const coverParsed = await callConfiguredProvider({
        provider,
        model,
        reasoningEffort,
        apiKey,
        apiBaseUrl,
        systemPrompt: coverPrompts.systemPrompt,
        userPrompt: coverPrompts.userPrompt
      });
      coverLetterText = String(coverParsed.coverLetterText ?? "").trim();
    }

    const missingRequiredSkills = sanitizeMissingRequiredSkills(parsed.missingRequiredSkills);
    const strictMissingRequiredSkills = missingRequiredSkillsFromStrictReview(strictReviewResult);

    sendJson(res, 200, {
      polishedText,
      coverLetterText,
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 4) : [],
      fixes: Array.isArray(parsed.fixes) ? parsed.fixes.map(String).slice(0, 4) : [],
      missingRequiredSkills: missingRequiredSkills.length ? missingRequiredSkills : strictMissingRequiredSkills,
      aiScore: reconcileScoreToVerdict(sanitizeAiScore(strictFitScore ?? parsed.fitScore), strictReviewResult?.verdict),
      strictReview: strictReviewResult,
      model,
      reasoningEffort,
      provider,
      ...(strictReview ? { auditProvider: audit.provider, auditModel: audit.model } : {})
    });
  } catch (error) {
    if (error instanceof UserSafeAiError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    if (error instanceof FetchTimeoutError) {
      sendJson(res, 504, { error: `${providerLabel(provider)} timed out. Try again or switch providers.` });
      return;
    }

    const configMessage = safeConfigErrorMessage(error instanceof Error ? error.message : "");
    if (configMessage) {
      sendJson(res, 400, { error: configMessage });
      return;
    }

    console.warn("[ai] polish failed", {
      provider,
      errorName: error instanceof Error ? error.name : typeof error
    });
    sendJson(res, 500, {
      error: `${providerLabel(provider)} did not return a usable draft. Check the selected provider and model, then try again.`
    });
  }
}
