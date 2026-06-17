// /api/polish route handler. The route is intentionally multi-pass: a
// suggestion pass first, then the optional strict recruiter audit and optional
// cover letter IN PARALLEL, so one model response is not forced to rewrite,
// score, audit, and draft a letter at once. The polished preview is never
// model-authored: it is derived by applying the sanitized suggestions to the
// scoped text, so every tailored character has passed the exact-evidence gate.
// Provider config, prompts, provider clients, response sanitizing, and error
// types live in sibling modules under server/ai/.

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
import { findUngroundedJdTerm } from "./grounding.mjs";
import {
  applyGapCapsAndVerdict,
  coverageHasEligibilityBlocker,
  missingRequiredSkillsFromStrictReview,
  reconcileFitVerdict,
  sanitizeAiScore,
  sanitizeMissingRequiredSkills,
  sanitizeStrictReview,
  sanitizeTailorSuggestions,
  scoreFromBuckets,
  scoreFromRequirementCoverage,
  tailorTargetKeys
} from "./sanitize.mjs";

function trimText(value, max = 1200) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeScopeSection(section) {
  const id = trimText(section?.id, 120);
  const heading = trimText(section?.heading, 120);
  if (!id || !heading) return null;
  const type = section?.type === "skills" ? "skills" : section?.type === "summary" ? "summary" : "standard";
  const entries = Array.isArray(section?.entries) ? section.entries : [];
  return {
    id,
    heading,
    type,
    entries: entries
      .map((entry) => {
        const entryId = trimText(entry?.id, 120);
        if (!entryId) return null;
        return {
          id: entryId,
          titleLeft: trimText(entry?.titleLeft),
          titleRight: trimText(entry?.titleRight),
          subtitleLeft: trimText(entry?.subtitleLeft),
          subtitleRight: trimText(entry?.subtitleRight),
          bullets: Array.isArray(entry?.bullets)
            ? entry.bullets
                .map((bullet) => {
                  const bulletId = trimText(bullet?.id, 120);
                  if (!bulletId) return null;
                  return { id: bulletId, text: trimText(bullet?.text) };
                })
                .filter(Boolean)
                .slice(0, 20)
            : []
        };
      })
      .filter(Boolean)
      .slice(0, 20)
  };
}

function normalizeTailorScope(raw) {
  const sections = (Array.isArray(raw?.sections) ? raw.sections : [])
    .map(normalizeScopeSection)
    .filter(Boolean)
    .slice(0, 12);
  // Disjointness firewall: a section can never be both editable and read-only.
  // If a client (or a crafted payload) lists the same id in both, TAILOR wins and
  // the context copy is dropped — so an editable section is never silently demoted,
  // and a context section is never promoted into the editable target map.
  const sectionIds = new Set(sections.map((section) => section.id));
  const contextSections = (Array.isArray(raw?.contextSections) ? raw.contextSections : [])
    .map(normalizeScopeSection)
    .filter(Boolean)
    .filter((section) => !sectionIds.has(section.id))
    .slice(0, 12);
  return {
    version: 1,
    locked: {
      omittedIdentity: true,
      omittedContact: true,
      omittedSections: Array.isArray(raw?.locked?.omittedSections)
        ? raw.locked.omittedSections.map((item) => trimText(item, 120)).filter(Boolean).slice(0, 20)
        : []
    },
    sections,
    contextSections
  };
}

function appendScopeSection(lines, section, valueFor) {
  lines.push(String(section.heading).toUpperCase());
  for (const entry of section.entries) {
    if (section.type === "skills") {
      const label = valueFor(section.id, entry.id, "", "titleLeft", entry.titleLeft).trim();
      const skills = valueFor(section.id, entry.id, "", "skill", entry.subtitleLeft).trim();
      if (label || skills) lines.push(label ? `${label}: ${skills}` : skills);
      continue;
    }
    if (section.type === "summary") {
      // Summary paragraphs live in bullets but serialize as plain lines.
      for (const bullet of entry.bullets) {
        const text = valueFor(section.id, entry.id, bullet.id, "bullet", bullet.text).trim();
        if (text) lines.push(text);
      }
      continue;
    }
    const titleLeft = valueFor(section.id, entry.id, "", "titleLeft", entry.titleLeft).trim();
    const titleRight = valueFor(section.id, entry.id, "", "titleRight", entry.titleRight).trim();
    const subtitleLeft = valueFor(section.id, entry.id, "", "subtitleLeft", entry.subtitleLeft).trim();
    const subtitleRight = valueFor(section.id, entry.id, "", "subtitleRight", entry.subtitleRight).trim();
    const title = [titleLeft, titleRight].filter(Boolean).join(" | ");
    const subtitle = [subtitleLeft, subtitleRight].filter(Boolean).join(" | ");
    if (title) lines.push(title);
    if (subtitle) lines.push(subtitle);
    for (const bullet of entry.bullets) {
      const text = valueFor(section.id, entry.id, bullet.id, "bullet", bullet.text).trim();
      if (text) lines.push(`- ${text}`);
    }
  }
  lines.push("");
}

// Serialize the scope to plain text. Editable `sections` apply the sanitized
// suggestions; read-only `contextSections` are emitted VERBATIM (identity
// valueFor — suggestions can't target them anyway, since the sanitizer's target
// map is built from `sections` only). `editableOnly` (the polish gate) limits
// output to the editable sections.
function scopeToText(scope, suggestions = [], editableOnly = false) {
  const replacements = new Map(
    suggestions.map((suggestion) => [
      [
        suggestion.target.sectionId,
        suggestion.target.entryId ?? "",
        suggestion.target.bulletId ?? "",
        suggestion.target.field
      ].join("::"),
      suggestion.proposedText
    ])
  );
  const valueFor = (sectionId, entryId, bulletId, field, current) =>
    replacements.get([sectionId, entryId ?? "", bulletId ?? "", field].join("::")) ?? current;
  const verbatim = (sectionId, entryId, bulletId, field, current) => current;
  const lines = [];
  for (const section of scope.sections) appendScopeSection(lines, section, valueFor);
  if (!editableOnly) {
    for (const section of scope.contextSections ?? []) appendScopeSection(lines, section, verbatim);
  }
  return lines.join("\n").trim();
}

export async function handlePolish(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  let provider = normalizeProvider(getDefaultProvider());
  try {
    const body = JSON.parse(await readBody(req, 1_000_000));
    const tailorScope = normalizeTailorScope(body.tailorScope);
    // scopeText feeds the strict-review/context picture and includes read-only
    // context sections; the GATE below measures editable text only so a
    // context-only request (no tailorable sections) is rejected.
    const scopeText = scopeToText(tailorScope);
    const editableText = scopeToText(tailorScope, [], true);
    const jobText = String(body.jobText ?? "").slice(0, 35_000);
    const includeCoverLetter = Boolean(body.includeCoverLetter);
    const strictReview = Boolean(body.strictReview);
    // `stages` lets the client run the tailor pass and the strict-review pass
    // independently. Back-compat: callers that only send `strictReview`
    // (e.g. the fabrication eval) still get the legacy mapping —
    // strictReview:true ≡ "both", strictReview:false ≡ "tailor".
    //   tailor: run the tailor provider call, skip the review pass (today's
    //           strictReview:false behavior).
    //   both:   tailor + review (today's strictReview:true behavior).
    //   review: skip the tailor provider call; audit prior (untrusted) client
    //           suggestions re-sanitized against the scope. No cover letter.
    const stages = (body.stages === "tailor" || body.stages === "review" || body.stages === "both")
      ? body.stages
      : (strictReview ? "both" : "tailor");
    const runTailor = stages !== "review";
    const runReview = stages !== "tailor";
    const honestContext = String(body.honestContext ?? "").slice(0, 8_000);
    const customInstructions = String(body.customInstructions ?? "").slice(0, 4_000);

    if (!tailorScope.sections.length || editableText.trim().length < 40 || jobText.trim().length < 40) {
      sendJson(res, 400, { error: "Select at least one editable resume section and add a job description before polishing." });
      return;
    }

    const resolved = resolveProviderRequest(body);
    provider = resolved.provider;
    const { apiKey, apiBaseUrl, model, reasoningEffort } = resolved;

    const { systemPrompt, userPrompt } = buildPolishPrompts({
      jobText,
      tailorScope,
      honestContext,
      customInstructions
    });

    // Tailor pass. In review-only mode there are no model-authored suggestions
    // to generate, so the provider call is skipped and the suggestions come from
    // the request body (a prior tailor response round-tripped through the client,
    // hence UNTRUSTED). Both paths feed the SAME sanitizer against the scope, so
    // client-provided suggestions are never trusted unsanitized.
    const parsed = runTailor
      ? await callConfiguredProvider({ provider, model, reasoningEffort, apiKey, apiBaseUrl, systemPrompt, userPrompt })
      : { suggestedChanges: Array.isArray(body.suggestedChanges) ? body.suggestedChanges : [] };
    const suggestionDropStats = {};
    const suggestedChanges = sanitizeTailorSuggestions(parsed.suggestedChanges, tailorScope, suggestionDropStats, honestContext, jobText);
    const rawSuggestionCount = Array.isArray(parsed.suggestedChanges) ? parsed.suggestedChanges.length : 0;
    if (runTailor && rawSuggestionCount > 0 && suggestedChanges.length === 0) {
      // Shape-only: reason counts, never suggestion text. An all-drop reaching
      // the user as "no suggestions" is indistinguishable from a clean pass
      // without this. The target shapes (ids/field only — structural, never
      // proposedText/evidence/resume content) reveal HOW the model mis-targeted
      // (e.g. heading/label in place of the section/entry id) so the resolver
      // and prompt can be corrected against real failures, not guesses.
      const droppedTargets = (Array.isArray(parsed.suggestedChanges) ? parsed.suggestedChanges : [])
        .map((c) => {
          const t = c && typeof c === "object" && c.target && typeof c.target === "object" ? c.target : (c ?? {});
          return { sectionId: t.sectionId, entryId: t.entryId, bulletId: t.bulletId, field: t.field };
        });
      console.warn("[ai] every tailor suggestion was dropped in sanitization", {
        provider,
        rawSuggestionCount,
        ...suggestionDropStats,
        droppedTargets,
        validTargetKeys: tailorTargetKeys(tailorScope)
      });
    }
    const missingRequiredSkills = sanitizeMissingRequiredSkills(parsed.missingRequiredSkills);
    // changeSummary replaced the old strengths/fixes arrays (which no UI surface
    // ever rendered): 1-3 bullets on what changed or why nothing needed to. It
    // doubles as the usable-response signal — a reply with no suggestions, no
    // gaps, AND no summary is an unusable shape, not an "already strong" verdict.
    const changeSummary = Array.isArray(parsed.changeSummary)
      ? parsed.changeSummary.map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
      : [];
    // Usable-response guard is a TAILOR-pass check: a model reply with no
    // suggestions, no gaps, AND no summary is an unusable shape. In review-only
    // mode an empty change list is valid (audit the base resume as-is), so the
    // guard must not fire.
    if (runTailor && !suggestedChanges.length && !missingRequiredSkills.length && !changeSummary.length) {
      throw new UserSafeAiError("AI response did not include usable resume suggestions. Try again or switch models.", 502);
    }
    // The polished preview is DERIVED, never model-authored: apply only the
    // sanitized suggestions to the scoped text. Every tailored character has
    // passed the exact-evidence gate, and the audit/cover passes judge exactly
    // the text the editor can end up with. Zero sanitized suggestions is a
    // valid outcome (the scope already fits) — the preview is then the
    // unchanged scope.
    const polishedText = scopeToText(tailorScope, suggestedChanges);

    // Grounding corpus for the secondary passes: the resume the user actually
    // ends up with (every char already past the exact-evidence gate) plus the
    // honest context. A JD skill term the audit's rewrites or the cover letter
    // introduce that is absent from here is unsupported.
    const groundingText = `${polishedText}\n${honestContext}`;

    // The audit reuses the primary config unless the request assigns an
    // independent reviewer provider. A different reviewer audits what the
    // rewrite produced without the rewriting model's self-consistency bias; the
    // audit pass never rewrites the resume, so a different reviewer model cannot
    // alter the format-preserved output. Audit and cover letter both depend
    // only on the derived polished text, so they run in parallel.
    const audit = runReview ? resolveAuditProviderRequest(body, resolved) : resolved;
    const reviewPromise = !runReview
      ? Promise.resolve(null)
      : (async () => {
          const reviewPrompts = buildStrictReviewPrompts({
            jobText: clipForPrompt(jobText, STRICT_REVIEW_JOB_CHAR_LIMIT, "job description"),
            resumeText: clipForPrompt(scopeText, STRICT_REVIEW_RESUME_CHAR_LIMIT, "original selected resume sections"),
            // The audit judges original + the sanitized change list (the
            // polished resume is derivable from them); sending the polished
            // copy too nearly doubled the audit prompt for no information.
            suggestedChanges,
            honestContext,
            customInstructions
          });
          return callConfiguredProvider({
            provider: audit.provider,
            model: audit.model,
            reasoningEffort: audit.reasoningEffort,
            apiKey: audit.apiKey,
            apiBaseUrl: audit.apiBaseUrl,
            systemPrompt: reviewPrompts.systemPrompt,
            userPrompt: reviewPrompts.userPrompt
          });
        })();
    // No cover letter in review-only mode: the cover pass tailors prose off the
    // polished resume, which is purely a tailor-pass artifact.
    const coverPromise = !(runTailor && includeCoverLetter)
      ? Promise.resolve(null)
      : (async () => {
          const coverPrompts = buildCoverLetterPrompts({
            jobText: clipForPrompt(jobText, COVER_JOB_CHAR_LIMIT, "job description"),
            resumeText: clipForPrompt(polishedText, COVER_RESUME_CHAR_LIMIT, "tailored resume"),
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
          const letter = String(coverParsed.coverLetterText ?? "").trim();
          // Prose-mode grounding backstop: the letter may freely name the target
          // company/role (proper nouns are not flagged), but a JD SKILL term it
          // claims that is absent from the polished resume + honest context is
          // unsupported. Blank it so the client falls back to the local,
          // strictly-grounded draftCoverLetter rather than shipping the claim.
          if (letter && findUngroundedJdTerm(letter, jobText.toLowerCase(), groundingText.toLowerCase(), { proseMode: true })) {
            console.warn("[ai] cover letter introduced an ungrounded JD skill term; falling back to local draft", { provider });
            return "";
          }
          return letter;
        })();
    // Secondary passes are OPTIONAL enhancements over an already-usable primary
    // rewrite. A failure in either (provider 5xx, timeout, unreadable JSON
    // surviving retry) must NOT sink the request and discard the computed
    // suggestions/polishedText — especially with an independent reviewer that
    // can run on a different provider/key. allSettled isolates each: a rejected
    // review falls back to strictReview:null (pane omitted); a rejected cover
    // falls back to "" (the same shape used when cover generation is disabled).
    const [reviewSettled, coverSettled] = await Promise.allSettled([reviewPromise, coverPromise]);
    let reviewParsed = null;
    if (reviewSettled.status === "fulfilled") {
      reviewParsed = reviewSettled.value;
    } else {
      console.warn("[ai] strict review pass failed; returning primary rewrite without it", {
        provider: audit.provider,
        errorName: reviewSettled.reason instanceof Error ? reviewSettled.reason.name : typeof reviewSettled.reason,
        errorMessage: reviewSettled.reason instanceof Error ? reviewSettled.reason.message : String(reviewSettled.reason)
      });
    }
    let coverLetterText = "";
    if (coverSettled.status === "fulfilled") {
      coverLetterText = coverSettled.value ?? "";
    } else {
      console.warn("[ai] cover letter pass failed; returning primary rewrite without it", {
        provider,
        errorName: coverSettled.reason instanceof Error ? coverSettled.reason.name : typeof coverSettled.reason,
        errorMessage: coverSettled.reason instanceof Error ? coverSettled.reason.message : String(coverSettled.reason)
      });
    }
    let strictReviewResult = reviewParsed ? sanitizeStrictReview(reviewParsed.strictReview, jobText, groundingText) : null;

    // Scoring: prefer the requirement-coverage path — the reviewer extracts
    // per-requirement evidence/statuses, then the server calculates every point.
    // Legacy fitBuckets remain as a rollout fallback, and gap caps still apply
    // to whichever score shape is available.
    const coverageScore = scoreFromRequirementCoverage(reviewParsed?.requirementCoverage, strictReviewResult);
    const bucketScore = coverageScore ?? scoreFromBuckets(reviewParsed?.fitBuckets);
    let reconciled;
    if (strictReviewResult) {
      const baseScore = bucketScore ?? sanitizeAiScore(reviewParsed?.fitScore ?? parsed.fitScore);
      // A hard eligibility gate (clearance/work-auth/license/cert/degree) the
      // model reports only as a missing critical/high requirementCoverage row —
      // not as a BLOCKER gap — must still force the DON'T APPLY band. Derive that
      // synthetic blocker from the same coverage table the score is built from.
      const hasCoverageBlocker = coverageHasEligibilityBlocker(reviewParsed?.requirementCoverage);
      reconciled = applyGapCapsAndVerdict(baseScore, strictReviewResult, hasCoverageBlocker);
    } else {
      reconciled = reconcileFitVerdict(
        bucketScore ?? sanitizeAiScore(reviewParsed?.fitScore ?? parsed.fitScore),
        strictReviewResult?.verdict
      );
    }
    if (strictReviewResult && reconciled.verdict && reconciled.verdict !== strictReviewResult.verdict) {
      strictReviewResult = { ...strictReviewResult, verdict: reconciled.verdict };
    }

    const strictMissingRequiredSkills = missingRequiredSkillsFromStrictReview(strictReviewResult);

    // The audit echo (auditProvider/auditModel) accompanies any response that
    // ran the review pass — both "both" and review-only.
    const auditEcho = runReview ? { auditProvider: audit.provider, auditModel: audit.model } : {};

    if (!runTailor) {
      // Review-only: no model-authored tailor output, no cover letter. Report
      // the audit plus the re-sanitized suggestions and the derived (unchanged)
      // scope text the audit judged.
      sendJson(res, 200, {
        polishedText,
        suggestedChanges,
        changeSummary: [],
        missingRequiredSkills: strictMissingRequiredSkills,
        aiScore: reconciled.aiScore,
        strictReview: strictReviewResult,
        model,
        reasoningEffort,
        provider,
        ...auditEcho
      });
      return;
    }

    sendJson(res, 200, {
      polishedText,
      coverLetterText: coverLetterText ?? "",
      changeSummary,
      missingRequiredSkills: missingRequiredSkills.length ? missingRequiredSkills : strictMissingRequiredSkills,
      suggestedChanges,
      aiScore: reconciled.aiScore,
      strictReview: strictReviewResult,
      model,
      reasoningEffort,
      provider,
      ...auditEcho
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
      sendJson(res, 413, { error: "Request is too large. Shorten the resume or job text." });
      return;
    }

    const configMessage = safeConfigErrorMessage(error instanceof Error ? error.message : "");
    if (configMessage) {
      sendJson(res, 400, { error: configMessage });
      return;
    }

    console.warn("[ai] polish failed", {
      provider,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    sendJson(res, 500, {
      error: `${providerLabel(provider)} did not return a usable draft. Check the selected provider and model, then try again.`
    });
  }
}
