// /api/polish route handler. The route is intentionally multi-pass: a
// suggestion pass first, then the optional submission-readiness audit and optional
// cover letter IN PARALLEL, so one model response is not forced to rewrite,
// tailor, audit, and draft a letter at once. The polished preview is never
// model-authored: it is derived by applying suggestions that passed the current
// deterministic grounding/sanitization gates to the scoped text.
// Provider config, prompts, provider clients, response sanitizing, and error
// types live in sibling modules under server/ai/.

import type { IncomingMessage, ServerResponse } from "node:http";
import { INLINE_MARK_TAG_PATTERN } from "@typeset/engine/lib/inlineMarksText.ts";
import {
  FetchTimeoutError,
  RequestAbortedError,
  isRequestAborted,
  requestAbortSignal,
  sendJson
} from "../http.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { readAiJsonBody } from "./json.ts";
import {
  providerLabel,
  resolveAuditProviderRequest,
  resolveProviderRequest,
  resolveReviewOnlyProviderRequest
} from "./providers.ts";
import {
  buildPolishPrompts
} from "./prompts.ts";
import { callConfiguredProvider } from "./clients.ts";
import { findUngroundedClaimTerm, findUngroundedOutcomeClaim, proseHasUngroundedTerm } from "./grounding.ts";
import { reviseGroundedCoverLetter } from "./coverLetter.ts";
import {
  hasUngroundedNumericClaim,
  sanitizeMissingRequiredSkills,
  sanitizeTailorSuggestions,
  summarizeDroppedSuggestions
} from "./sanitize.ts";
import {
  resolveReviewOutcome,
  reviewFailureFromReason,
  runRecruiterAudit,
  type RecruiterAuditOutcome
} from "./recruiterAudit.ts";

export { resolveReviewOutcome, reviewFailureFromReason } from "./recruiterAudit.ts";

// Optional dispatch-attempt collector: callConfiguredProvider bumps `attempts`.
type AttemptStats = { attempts?: number };

// The server-normalized tailor scope (built by normalizeTailorScope from the
// untrusted request body) and the shapes its serializer consumes.
type ScopeBullet = { id: string; text: string };
type ScopeEntry = {
  id: string;
  titleLeft: string;
  titleRight: string;
  subtitleLeft: string;
  subtitleRight: string;
  bullets: ScopeBullet[];
};
type ScopeSection = {
  id: string;
  heading: string;
  type: "skills" | "summary" | "standard";
  entries: ScopeEntry[];
};
type NormalizedScope = {
  version: number;
  locked: { omittedIdentity: boolean; omittedContact: boolean; omittedSections: string[] };
  sections: ScopeSection[];
  contextSections: ScopeSection[];
};
// The subset of a sanitized tailor suggestion the text serializer reads.
type PolishSuggestion = {
  target: { sectionId: string; entryId?: string; bulletId?: string; field: string };
  proposedText: string;
};
// Field-value resolver passed into appendScopeSection (apply-suggestions or verbatim).
type ValueFor = (sectionId: string, entryId: string, bulletId: string, field: string, current: string) => string;

function trimText(value: unknown, max = 1200): string {
  return String(value ?? "").trim().slice(0, max);
}

// ResumeData fields may carry inline display/structure tokens. The Tailor model
// needs <b>/<i>/<u> so it can preserve visible emphasis, but link destinations,
// font/size overrides, alignment, and nolink suppression are editor structure,
// not candidate evidence. Match the engine's single grammar source and preserve
// only emphasis tags before prompt construction AND before every sanitizer /
// grounding consumer sees the normalized scope.
const INLINE_MARK_RE = new RegExp(INLINE_MARK_TAG_PATTERN, "gi");
export function stripStructuralInlineMarks(value: unknown): string {
  INLINE_MARK_RE.lastIndex = 0;
  return String(value ?? "").replace(
    INLINE_MARK_RE,
    (tag) => /^<\/?(?:b|i|u)>$/i.test(tag) ? tag : ""
  );
}

function trimScopeText(value: unknown, max = 1200): string {
  return stripStructuralInlineMarks(value).trim().slice(0, max);
}

// changeSummary ("What changed") is free model prose, NOT derived from the
// sanitized suggestions — so a model can claim a change ("added Kubernetes to
// your Skills") that never survived sanitization, leaving the summary describing
// an edit the resume never received. Drop any bullet that introduces a JD
// tool/term absent from the TAILORED resume. Honest context may authorize a
// proposed edit, but it must not make the summary claim that an edit landed when
// sanitization rejected it. The general claim backstop also covers tools absent
// from the job text (such as Claude Code or Codex) that the JD-only check cannot
// see. Lowercase only the first character before that backstop: summaries begin
// with ordinary action words ("Added", "Tightened"), while later TitleCase terms
// remain available for claim checking.
export function groundChangeSummary(changeSummary: string[], jobText: unknown, tailoredText: unknown): string[] {
  if (!changeSummary.length) return changeSummary;
  const jobLower = String(jobText ?? "").toLowerCase();
  const tailored = String(tailoredText ?? "").toLowerCase();
  return changeSummary
    // Provider output is boundary data. Keep the UI's 1-3 short-summary
    // contract even when a model returns a paragraph or embedded newlines.
    .map((bullet) => String(bullet ?? "").replace(/\s+/g, " ").trim().slice(0, 300))
    .filter(Boolean)
    .filter((bullet) => {
      // Section/UI nouns are capitalized conventionally in an editorial summary,
      // not asserted technologies or employers. Remove that presentation-only
      // capitalization before the candidate-claim gate; named tools stay intact.
      const claimText = (bullet ? `${bullet[0].toLowerCase()}${bullet.slice(1)}` : bullet)
        .replace(/\b(?:Resume|Section|Sections|Skill|Skills|Technical|Experience|Tooling|Tools|Requirements|Role)\b/g, (word) => word.toLowerCase());
      return !proseHasUngroundedTerm(bullet, jobLower, tailored)
        && !findUngroundedClaimTerm(claimText, tailored)
        && !findUngroundedOutcomeClaim(claimText, tailored)
        && !hasUngroundedNumericClaim(bullet, tailored);
    });
}

// section is untrusted request-body JSON (already `any` from JSON.parse); it is
// walked defensively with `?.` and clamped by trimText. The RETURN is fully typed.
function normalizeScopeSection(section: any): ScopeSection | null {
  const id = trimText(section?.id, 120);
  const heading = trimScopeText(section?.heading, 120);
  if (!id || !heading) return null;
  const type = section?.type === "skills" ? "skills" : section?.type === "summary" ? "summary" : "standard";
  const entries = Array.isArray(section?.entries) ? section.entries : [];
  return {
    id,
    heading,
    type,
    entries: entries
      .map((entry: any) => {
        const entryId = trimText(entry?.id, 120);
        if (!entryId) return null;
        return {
          id: entryId,
          titleLeft: trimScopeText(entry?.titleLeft),
          titleRight: trimScopeText(entry?.titleRight),
          subtitleLeft: trimScopeText(entry?.subtitleLeft),
          subtitleRight: trimScopeText(entry?.subtitleRight),
          bullets: Array.isArray(entry?.bullets)
            ? entry.bullets
                .map((bullet: any) => {
                  const bulletId = trimText(bullet?.id, 120);
                  if (!bulletId) return null;
                  return { id: bulletId, text: trimScopeText(bullet?.text) };
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

// raw is untrusted request-body JSON (already `any`); walked defensively. The
// RETURN is fully typed so every consumer of the scope is strict.
export function normalizeTailorScope(raw: any): NormalizedScope {
  const sections: ScopeSection[] = (Array.isArray(raw?.sections) ? raw.sections : [])
    .map(normalizeScopeSection)
    .filter(Boolean)
    .slice(0, 12);
  // Disjointness firewall: a section can never be both editable and read-only.
  // If a client (or a crafted payload) lists the same id in both, TAILOR wins and
  // the context copy is dropped — so an editable section is never silently demoted,
  // and a context section is never promoted into the editable target map.
  const sectionIds = new Set(sections.map((section) => section.id));
  const contextSections: ScopeSection[] = (Array.isArray(raw?.contextSections) ? raw.contextSections : [])
    .map(normalizeScopeSection)
    .filter(Boolean)
    .filter((section: any) => !sectionIds.has(section.id))
    .slice(0, 12);
  return {
    version: 1,
    locked: {
      omittedIdentity: true,
      omittedContact: true,
      omittedSections: Array.isArray(raw?.locked?.omittedSections)
        ? raw.locked.omittedSections.map((item: any) => trimScopeText(item, 120)).filter(Boolean).slice(0, 20)
        : []
    },
    sections,
    contextSections
  };
}

function appendScopeSection(lines: string[], section: ScopeSection, valueFor: ValueFor): void {
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
function scopeToText(scope: NormalizedScope, suggestions: PolishSuggestion[] = [], editableOnly = false): string {
  const replacements = new Map(
    suggestions.map((suggestion): [string, string] => [
      [
        suggestion.target.sectionId,
        suggestion.target.entryId ?? "",
        suggestion.target.bulletId ?? "",
        suggestion.target.field
      ].join("::"),
      suggestion.proposedText
    ])
  );
  const valueFor: ValueFor = (sectionId, entryId, bulletId, field, current) =>
    replacements.get([sectionId, entryId ?? "", bulletId ?? "", field].join("::")) ?? current;
  const verbatim: ValueFor = (sectionId, entryId, bulletId, field, current) => current;
  const lines: string[] = [];
  for (const section of scope.sections) appendScopeSection(lines, section, valueFor);
  if (!editableOnly) {
    for (const section of scope.contextSections ?? []) appendScopeSection(lines, section, verbatim);
  }
  return lines.join("\n").trim();
}

// The submission-review pass fails closed unless its complete, evidence-grounded assessment validates.
export async function handlePolish(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  // Safe label fallback only; actual default/provider validation happens inside
  // the try via resolveProviderRequest so an invalid AI_PROVIDER returns JSON
  // instead of escaping the route before its error handler.
  let provider = "claude-cli";
  const request = requestAbortSignal(req, res);
  try {
    const body = await readAiJsonBody(req, 1_000_000);
    const tailorScope = normalizeTailorScope(body.tailorScope);
    // scopeText feeds the submission-review context and includes read-only
    // context sections; the GATE below measures editable text only so a
    // context-only request (no tailorable sections) is rejected.
    const scopeText = scopeToText(tailorScope);
    const editableText = scopeToText(tailorScope, [], true);
    const jobText = String(body.jobText ?? "").slice(0, 35_000);
    const includeCoverLetter = body.includeCoverLetter === true;
    const sourceCoverLetterText = String(body.sourceCoverLetterText ?? "").slice(0, 35_000);
    // The explicit stage keeps tailoring and submission review independently runnable.
    if (body.stages !== "tailor" && body.stages !== "review" && body.stages !== "both") {
      sendJson(res, 400, { error: "Choose tailor, review, or both before polishing." });
      return;
    }
    const stages = body.stages;
    const runTailor = stages !== "review";
    const runReview = stages !== "tailor";
    const reviewTarget = !runTailor
      ? body.reviewTarget === "current" || body.reviewTarget === "proposal"
        ? body.reviewTarget
        : null
      : null;
    if (!runTailor && !reviewTarget) {
      sendJson(res, 400, { error: "Choose the current draft or Tailor proposal before reviewing." });
      return;
    }
    const honestContext = String(body.honestContext ?? "").slice(0, 8_000);
    const customInstructions = String(body.customInstructions ?? "").slice(0, 4_000);

    if (!tailorScope.sections.length || editableText.trim().length < 40 || jobText.trim().length < 40) {
      sendJson(res, 400, { error: "Select at least one editable resume section and add a job description before polishing." });
      return;
    }

    // Standalone Review dispatches only the Review config. Do not validate the
    // unused Tailor config first (a blank hosted Tailor key must not block a valid
    // CLI reviewer). Headless review callers without audit* fields retain the
    // normal primary/default field semantics.
    const resolved = runTailor
      ? resolveProviderRequest(body)
      : resolveReviewOnlyProviderRequest(body);
    provider = resolved.provider;
    const { apiKey, model, reasoningEffort } = resolved;

    // Tailor pass. Review-only skips its provider entirely. A proposal review
    // re-sanitizes that run's suggestions against the original scope; a current
    // review deliberately ignores suggestions and audits the edited scope as-is.
    const tailorStats: AttemptStats = {};
    let parsed: unknown;
    if (runTailor) {
      const tailorPrompts = buildPolishPrompts({
        jobText,
        tailorScope,
        honestContext,
        customInstructions
      });
      parsed = await callConfiguredProvider({
        provider,
        model,
        reasoningEffort,
        apiKey,
        systemPrompt: tailorPrompts.systemPrompt,
        userPrompt: tailorPrompts.userPrompt,
        signal: request.signal
      }, tailorStats);
    } else {
      parsed = {
        suggestedChanges: reviewTarget === "proposal" && Array.isArray(body.suggestedChanges)
          ? body.suggestedChanges
          : []
      };
    }
    // Model output (or the review-only body echo): read fields defensively.
    const parsedObj = parsed as { suggestedChanges?: unknown; missingRequiredSkills?: unknown; changeSummary?: unknown };
    const suggestionDropStats = {};
    const suggestedChanges = sanitizeTailorSuggestions(parsedObj.suggestedChanges, tailorScope, suggestionDropStats, honestContext, jobText);
    const rawSuggestionCount = Array.isArray(parsedObj.suggestedChanges) ? parsedObj.suggestedChanges.length : 0;
    if (runTailor && rawSuggestionCount > 0 && suggestedChanges.length === 0) {
      // Counts only, never suggestion text or model-supplied identifiers. An all-drop reaching
      // the user as "no suggestions" is indistinguishable from a clean pass
      // without this. IDs are untrusted model output and may contain copied
      // resume text, so they are deliberately excluded from diagnostics.
      console.warn("[ai] every tailor suggestion was dropped in sanitization", {
        provider,
        rawSuggestionCount,
        ...suggestionDropStats
      });
    }
    // Surface the anti-fabrication catches: a silent all-drop otherwise looks
    // identical to a clean "nothing to suggest" pass (counts by reason only, no
    // suggestion text — safe to send).
    const droppedSuggestions = summarizeDroppedSuggestions(suggestionDropStats);
    const missingRequiredSkills = sanitizeMissingRequiredSkills(
      parsedObj.missingRequiredSkills,
      jobText,
      `${scopeText}\n${honestContext}`
    );
    // changeSummary replaced the old strengths/fixes arrays (which no UI surface
    // ever rendered): 1-3 bullets on what changed or why nothing needed to. It
    // doubles as the usable-response signal — a reply with no suggestions, no
    // gaps, AND no summary is an unusable shape, not an "already strong" verdict.
    const changeSummary = Array.isArray(parsedObj.changeSummary)
      ? parsedObj.changeSummary.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 4)
      : [];
    // The polished preview is DERIVED, never model-authored: apply only the
    // sanitized suggestions to the scoped text. Every applied suggestion has
    // passed the current deterministic grounding/sanitization gates, and the
    // audit/cover passes judge exactly the text the editor can end up with. Zero
    // sanitized suggestions is a valid outcome (the scope needs no edits) — the
    // preview is then the unchanged scope.
    const polishedText = scopeToText(tailorScope, suggestedChanges);

    // changeSummary is free model prose. With no accepted edits, no model prose
    // can truthfully describe a resume change, so omit the entire section and
    // let the explicit withheld-edits note explain the outcome. Otherwise it may
    // mention only material in the tailored resume itself; honest context cannot
    // turn an evidence-withheld proposal into a claimed resume change.
    const honestChangeSummary = suggestedChanges.length
      ? groundChangeSummary(changeSummary, jobText, polishedText)
      : [];

    // Usable-response guard is a TAILOR-pass check: a model reply with no
    // suggestions, no gaps, AND no honest summary is an unusable shape. In
    // review-only mode an empty change list is valid (audit the base resume
    // as-is), so the guard must not fire.
    if (runTailor && rawSuggestionCount === 0 && !missingRequiredSkills.length && !honestChangeSummary.length) {
      throw new UserSafeAiError("AI response did not include usable resume suggestions. Try again or switch models.", 502);
    }

    // The audit reuses the primary config unless the request assigns an
    // independent reviewer provider. A different reviewer audits what the
    // rewrite produced without the rewriting model's self-consistency bias; the
    // audit pass never rewrites the resume, so a different reviewer model cannot
    // alter the format-preserved output. Audit and cover letter both depend
    // only on the derived polished text, so they run in parallel.
    const audit = runReview
      ? (runTailor ? resolveAuditProviderRequest(body, resolved) : resolved)
      : resolved;
    const auditStats: AttemptStats = {};
    const reviewPromise = !runReview
      ? Promise.resolve(null)
      : runRecruiterAudit({
          mode: "comparison",
          provider: audit,
          jobText,
          resumeText: polishedText,
          honestContext,
          customInstructions,
          signal: request.signal
        }, auditStats);
    // No cover letter in review-only mode: the cover pass tailors prose off the
    // polished resume, which is purely a tailor-pass artifact. Shares the
    // grounded reviser with the standalone /api/cover-letter path; grounding
    // against polishedText matches the prior `${polishedText}\n${honestContext}`
    // corpus (the grounding backstop now lives in one place).
    const coverRequested =
      runTailor && includeCoverLetter && sourceCoverLetterText.trim().length >= 80;
    const coverPromise = !coverRequested
      ? Promise.resolve(null)
      : reviseGroundedCoverLetter({
          provider,
          model,
          reasoningEffort,
          apiKey,
          jobText,
          resumeText: polishedText,
          sourceCoverLetterText,
          honestContext,
          customInstructions,
          signal: request.signal
        });
    // Secondary passes are OPTIONAL enhancements over an already-usable primary
    // rewrite. A failure in either (provider 5xx, timeout, unreadable JSON
    // surviving retry) must NOT sink the request and discard the computed
    // suggestions/polishedText — especially with an independent reviewer that
    // can run on a different provider/key. allSettled isolates each: a rejected
    // review falls back to a null submission assessment; a rejected
    // or blank cover returns "" + coverStatus:"failed".
    const [reviewSettled, coverSettled] = await Promise.allSettled([reviewPromise, coverPromise]);
    if (request.signal.aborted) throw new RequestAbortedError();
    let reviewOutcome: RecruiterAuditOutcome | null = null;
    if (reviewSettled.status === "fulfilled") {
      reviewOutcome = reviewSettled.value;
      if (reviewOutcome?.status === "invalid") {
        console.warn("[ai] assessment output rejected", {
          stage: "submission-review",
          provider: audit.provider,
          model: audit.model,
          phase: reviewOutcome.issue.phase,
          code: reviewOutcome.issue.code,
          path: reviewOutcome.issue.path
        });
      }
    } else {
      console.warn("[ai] submission review pass failed; returning primary rewrite without it", {
        provider: audit.provider,
        errorName: reviewSettled.reason instanceof Error ? reviewSettled.reason.name : typeof reviewSettled.reason
      });
    }
    let coverLetterText = "";
    let coverStatus: "off" | "ok" | "failed" = coverRequested ? "failed" : "off";
    if (coverSettled.status === "fulfilled") {
      coverLetterText = coverSettled.value ?? "";
      if (coverRequested && coverLetterText.trim()) coverStatus = "ok";
    } else if (coverRequested) {
      console.warn("[ai] cover letter pass failed; returning primary rewrite without it", {
        provider,
        errorName: coverSettled.reason instanceof Error ? coverSettled.reason.name : typeof coverSettled.reason
      });
    }
    const submissionAssessment = reviewOutcome?.status === "ok"
      ? reviewOutcome.assessment
      : null;

    // reviewStatus lets the client distinguish a review that was never requested
    // from one that ran but produced nothing usable. "off" = review not run;
    // "failed" = review requested but no usable submission assessment survived — whether
    // the pass rejected, returned no parseable object, or its shape did not
    // validate; "ok" = a sanitized submission assessment is returned.
    const reviewStatus = !runReview
      ? "off"
      : (!submissionAssessment ? "failed" : "ok");
    const reviewFailure = reviewStatus !== "failed"
      ? null
      : reviewSettled.status === "rejected"
        ? reviewFailureFromReason(reviewSettled.reason, audit.provider)
        : {
            message: `${providerLabel(audit.provider)} returned a submission review that did not satisfy RoleFit's evidence contract. Retry, or switch providers.`,
            status: 502,
            kind: "output-validation" as const
          };
    const reviewFailureEcho = reviewFailure
      ? {
          reviewError: reviewFailure.message,
          reviewErrorStatus: reviewFailure.status,
          ...("kind" in reviewFailure ? { reviewErrorKind: reviewFailure.kind } : {})
        }
      : {};

    // The audit echo accompanies any response that ran the review pass — both
    // "both" and review-only — and is ALWAYS fully populated when review ran,
    // even when the reviewer resolves to the SAME provider/model as the primary.
    // (The client only shows "reviewed by" when auditProvider !== provider, so
    // always sending is backward compatible, but it lets a caller distinguish
    // "review ran with the same provider" from "no review".) auditAttempts is the
    // dispatch count for the audit pass; it is 0 only if the review promise never
    // reached dispatch (it always does when runReview is true, so >=1 in practice).
    const auditEcho = runReview
      ? {
          auditProvider: audit.provider,
          auditModel: audit.model,
          auditReasoningEffort: audit.reasoningEffort,
          auditAttempts: auditStats.attempts ?? 0
        }
      : {};

    if (!runTailor) {
      // Review-only: no model-authored tailor output, no cover letter. Report
      // the audit plus the re-sanitized suggestions and the derived (unchanged)
      // suggestion-applied scope text the audit judged.
      // Review-only ran no tailor provider call, so `attempts` is omitted (there
      // is no tailor pass to count); auditAttempts in auditEcho covers the audit.
      sendJson(res, 200, {
        polishedText,
        suggestedChanges,
        changeSummary: [],
        missingRequiredSkills: [],
        droppedSuggestions,
        submissionAssessment,
        reviewStatus,
        ...reviewFailureEcho,
        coverStatus,
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
      coverStatus,
      changeSummary: honestChangeSummary,
      missingRequiredSkills,
      suggestedChanges,
      droppedSuggestions,
      submissionAssessment,
      reviewStatus,
      ...reviewFailureEcho,
      model,
      reasoningEffort,
      provider,
      // Dispatch count for the tailor/suggestion pass (1 = no retry, 2 = the
      // JSON-only retry fired).
      attempts: tailorStats.attempts ?? 1,
      ...auditEcho
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
      errorName: error instanceof Error ? error.name : typeof error
    });
    sendJson(res, 500, {
      error: `${providerLabel(provider)} did not return a usable draft. Check the selected provider and model, then try again.`
    });
  } finally {
    request.dispose();
  }
}
