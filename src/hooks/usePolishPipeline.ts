/**
 * usePolishPipeline — the two-stage polish flow (Tailor -> Review), extracted
 * from App.tsx: buildPolishContext, the reviewer-attribution + merge helpers,
 * the two stage runners, handlePolish, retryStage, and the Stop/clean-stop
 * teardown.
 *
 * State ownership: isPolishing/polishProgress/polishProgressVisible are OWNED
 * here (not passed in), mirroring useJobIntake's reasoning — every mutator of
 * them is one of these functions; App only READS them for render (Masthead's
 * isPolishing prop, the progress-dock visibility check, PolishProgress's
 * progress/busy props, the before-unload guard, and the _myPhase presence
 * memo) and for the auto-tailor effect's `if (canPolish && !isPolishing)`
 * guard, so returning them keeps the interface small without splitting
 * control between two owners. polishAbortRef stays internal (only
 * handlePolish/retryStage/stopPolish touch it).
 *
 * result/editedResume/tailorModes/jobDescription/the tailor+review StageConfigs/
 * etc. stay in App (they're shared far beyond this flow — the editor, scoring,
 * exports, autosave), so they arrive via args; duplicateGuard and
 * includeCoverLetter likewise arrive as dependencies rather than being
 * re-owned here.
 */
import { useRef, useState } from "react";
import { analyzeResumeText, normalizePolishedResume, type PolishedResume } from "../resumeEngine";
import { describeProviderModel } from "../config/aiOptions";
import { buildAuditRequestFields, buildStageRequestFields, type StageConfig } from "../lib/aiRequest";
import { AI_UNAVAILABLE, ApiError, classifyFailure } from "../lib/failures";
import { buildTailorScope, defaultTailorModes, tailorScopeToText, type TailorMode } from "../lib/tailorScope";
import type { StageAiUsage } from "../lib/aiUsage";
import type { ResumeData } from "../lib/resumeData";
import type { PolishProgressState } from "../sections/PolishProgress";
import type { OutputTab } from "../sections/shared";

function idleProgress(): PolishProgressState {
  return {
    tailor: { status: "idle" },
    review: { status: "idle" }
  };
}

type PolishContext = {
  scopedResumeText: string;
  commonBody: Record<string, unknown>;
};

type UsePolishPipelineArgs = {
  editedResume: ResumeData | null;
  tailorModes: Record<string, TailorMode>;
  currentResumeText: string;
  // The job target text used both as the request's jobText and as the local
  // scoring input — one value, one name (App has no separate "combined" job
  // text; it passes its single jobDescription state here).
  jobDescription: string;
  includeCoverLetter: boolean;
  requestHonestContext: string;
  customInstructions: string;
  polishStages: "tailor" | "review" | "both";
  tailor: StageConfig;
  review: StageConfig;
  result: PolishedResume | null;
  setResult: (updater: PolishedResume | null | ((prev: PolishedResume | null) => PolishedResume | null)) => void;
  applyCoverLetter: (text: string) => void;
  setActiveOutputTab: (tab: OutputTab) => void;
  setPipelineAiUsage: (updater: (prev: Record<string, StageAiUsage>) => Record<string, StageAiUsage>) => void;
  setPolishStatus: (value: string) => void;
  resetExportStatuses: () => void;
  setTexStatus: (value: string) => void;
  confirmDuplicateBeforePolish: () => Promise<boolean>;
};

export function usePolishPipeline({
  editedResume,
  tailorModes,
  currentResumeText,
  jobDescription,
  includeCoverLetter,
  requestHonestContext,
  customInstructions,
  polishStages,
  tailor,
  review,
  result,
  setResult,
  applyCoverLetter,
  setActiveOutputTab,
  setPipelineAiUsage,
  setPolishStatus,
  resetExportStatuses,
  setTexStatus,
  confirmDuplicateBeforePolish
}: UsePolishPipelineArgs) {
  const [isPolishing, setIsPolishing] = useState(false);
  // Per-stage progress state for the two-stage polish flow (Tailor / Review).
  // Shown in the PolishProgress component while a polish is in-flight or has
  // a failed stage. Reset to all-idle on every new polish run.
  const [polishProgress, setPolishProgress] = useState<PolishProgressState>(idleProgress);
  // True once a polish has been initiated — keeps PolishProgress visible after
  // the run completes (including failures) until the user dismisses it.
  const [polishProgressVisible, setPolishProgressVisible] = useState(false);
  // Aborts the in-flight polish fetch(es) when the user clicks Stop. Created per
  // run in handlePolish/retryStage; both stages share one controller so a Stop
  // during either tailor or review cancels the whole run.
  const polishAbortRef = useRef<AbortController | null>(null);

  // Build the per-run context, or return null after setting a guard status.
  // Guards (no editable resume, empty/too-short tailor scope) match the original
  // handlePolish pre-flight checks; the `isPolishing` guard stays in each caller.
  function buildPolishContext(): PolishContext | null {
    if (!editedResume) {
      setPolishStatus("Load a resume before polishing.");
      return null;
    }
    // Fall back to the default modes if the user never touched the controls.
    const modes = Object.keys(tailorModes).length ? tailorModes : defaultTailorModes(editedResume);
    const tailorIds = Object.keys(modes).filter((id) => modes[id] === "tailor");
    const contextIds = Object.keys(modes).filter((id) => modes[id] === "include");
    const tailorScope = buildTailorScope(editedResume, tailorIds, contextIds);
    // Context-inclusive text (read-only Include sections appended) — used by the
    // AI-path polished/fit/cover derivations so those sections count and can be
    // cited. The editable-only variant powers the too-short gate below.
    const scopedResumeText = tailorScopeToText(tailorScope);
    const editableResumeText = tailorScopeToText(tailorScope, true);
    // Gate on EDITABLE sections: a context-only scope (Include but nothing to
    // Tailor) has no targets, so it cannot be polished.
    if (!tailorScope.sections.length || editableResumeText.trim().length < 40) {
      setPolishStatus("Set at least one resume section to Tailor.");
      return null;
    }

    // Common request body shared by both stages.
    const commonBody = {
      ...buildStageRequestFields(tailor),
      ...buildAuditRequestFields(review),
      tailorScope,
      jobText: jobDescription,
      includeCoverLetter,
      honestContext: requestHonestContext,
      customInstructions
    };

    return { scopedResumeText, commonBody };
  }

  // Compute the reviewer attribution string from a server response (non-empty
  // only when the audit ran on a different provider/model than the tailor).
  function computePolishReviewedBy(data: Record<string, unknown>): string {
    if (
      typeof data.auditProvider === "string" &&
      data.auditProvider &&
      (data.auditProvider !== data.provider || (data.auditModel || "") !== (data.model || ""))
    ) {
      return describeProviderModel(data.auditProvider as string, (data.auditModel as string | undefined) ?? "");
    }
    return "";
  }

  // Merge review data (aiScore, strictReview, reviewedBy, reviewStatus) from a
  // server response into the given base result, preferring any missing-skills
  // the base already held. Callers always supply a concrete base (the prior
  // result, or a synthesized review-only base).
  function mergeReviewIntoResult(
    base: PolishedResume,
    data: Record<string, unknown>,
    reviewedBy: string
  ): PolishedResume {
    const prevMissing = base.missingRequiredSkills;
    const dataMissing = Array.isArray(data.missingRequiredSkills) ? data.missingRequiredSkills : undefined;
    return {
      ...base,
      aiScore: (data.aiScore as PolishedResume["aiScore"]) ?? undefined,
      strictReview: (data.strictReview as PolishedResume["strictReview"]) ?? undefined,
      reviewedBy: reviewedBy || undefined,
      reviewStatus: (data.reviewStatus as PolishedResume["reviewStatus"]) ?? undefined,
      missingRequiredSkills: (prevMissing?.length ? prevMissing : dataMissing) ?? undefined
    };
  }

  // Stage runner: Tailor. Sets progress.tailor=running, posts to /api/polish
  // with stages:"tailor", builds a result WITHOUT aiScore/strictReview (so the
  // fit verdict shows "Estimated"/local, not "AI-judged"). Returns the
  // server-sanitized suggestedChanges array on success, null on failure.
  async function runTailorStage(ctx: PolishContext, signal?: AbortSignal): Promise<PolishedResume["suggestedChanges"] | null> {
    const { scopedResumeText, commonBody } = ctx;
    setPolishProgress((prev) => ({ ...prev, tailor: { status: "running" }, review: { status: "idle" } }));
    try {
      const response = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...commonBody, stages: "tailor" }),
        signal
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new ApiError((data.error as string) ?? "AI tailor failed.", response.status);
      const suggestedChanges: PolishedResume["suggestedChanges"] = Array.isArray(data.suggestedChanges) ? data.suggestedChanges : [];
      if (!data.polishedText && !suggestedChanges.length) {
        throw new Error("AI response did not include usable resume suggestions.");
      }
      const scopedPolishedText = data.polishedText
        ? normalizePolishedResume(data.polishedText as string, scopedResumeText)
        : scopedResumeText;
      const analysis = analyzeResumeText(
        suggestedChanges.length ? currentResumeText || scopedPolishedText : scopedPolishedText,
        jobDescription
      );
      const coverText = includeCoverLetter ? ((data.coverLetterText as string | undefined) || undefined) : undefined;
      setResult({
        ...analysis,
        polishedText: suggestedChanges.length ? currentResumeText || scopedPolishedText : scopedPolishedText,
        source: "ai",
        coverLetterText: coverText,
        changeSummary: Array.isArray(data.changeSummary) && data.changeSummary.length ? data.changeSummary as string[] : undefined,
        missingRequiredSkills: Array.isArray(data.missingRequiredSkills) && data.missingRequiredSkills.length
          ? data.missingRequiredSkills as PolishedResume["missingRequiredSkills"]
          : undefined,
        suggestedChanges,
        droppedSuggestions: (data.droppedSuggestions as PolishedResume["droppedSuggestions"]) ?? null,
        // Tailor-only: no AI review fields — useResumeAnalysis must see these
        // as undefined so the fit verdict shows "Estimated"/local, not "AI-judged".
        // reviewStatus resets too, so a stale "failed" from a prior review doesn't
        // linger on a fresh tailor result that hasn't been reviewed yet.
        aiScore: undefined,
        strictReview: undefined,
        reviewedBy: undefined,
        reviewStatus: undefined
      });
      // Feed the shared cover-letter state so Materials/Copy/save read one source
      // whether the letter came from the polish pass or on-demand generation.
      if (coverText) applyCoverLetter(coverText);
      setActiveOutputTab("resume");
      setPolishProgress((prev) => ({ ...prev, tailor: { status: "done", note: "Tailored with AI", noteTone: "ok" } }));
      const tailorUsage: StageAiUsage = {
        source: "ai",
        ...(typeof data.provider === "string" && data.provider ? { provider: data.provider } : {}),
        ...(typeof data.model === "string" && data.model ? { model: data.model } : {}),
        ...(typeof data.reasoningEffort === "string" && data.reasoningEffort ? { reasoningEffort: data.reasoningEffort } : {}),
        ...(typeof data.attempts === "number" ? { attempts: data.attempts } : {}),
        completedAt: new Date().toISOString()
      };
      setPipelineAiUsage((prev) => ({
        ...prev,
        tailor: tailorUsage,
        // The cover letter from this same run shares the tailor call's
        // attribution (it exists only when the AI actually produced it).
        ...(coverText ? { cover: tailorUsage } : {})
      }));
      return suggestedChanges;
    } catch (error) {
      // User clicked Stop — let the orchestrator handle the clean stop; do NOT
      // mark the stage failed.
      if (signal?.aborted) throw error;
      // No deterministic tailor fallback (removed by user decision, D011 — its
      // keyword-stuffed rewrite wasn't worth showing): the stage fails plainly
      // with a classified reason and Retry. Any prior result stays on screen.
      const f = classifyFailure(error);
      setPolishProgress((prev) => ({
        ...prev,
        tailor: { status: "failed", errorHeadline: f.headline, error: f.detail }
      }));
      setPipelineAiUsage((prev) => ({
        ...prev,
        tailor: {
          source: "none",
          requestedProvider: tailor.provider,
          requestedModel: tailor.selectedModel === "custom" ? tailor.customModel.trim() : tailor.selectedModel,
          completedAt: new Date().toISOString()
        }
      }));
      return null;
    }
  }

  // Stage runner: Review. Sets progress.review=running, posts with stages:"review"
  // and the sanitized suggestedChanges (from the prior tailor, or [] for
  // review-only). Merges review data (aiScore, strictReview) into the current
  // result via setResult; for review-only with no prior result it synthesizes a
  // base result first so the verdict describes the displayed resume.
  async function runReviewStage(
    ctx: PolishContext,
    suggestions: PolishedResume["suggestedChanges"],
    signal?: AbortSignal
  ): Promise<void> {
    const { scopedResumeText, commonBody } = ctx;
    setPolishProgress((prev) => ({ ...prev, review: { status: "running" } }));
    try {
      const response = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...commonBody, stages: "review", suggestedChanges: suggestions ?? [] }),
        signal
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new ApiError((data.error as string) ?? "AI review failed.", response.status);
      // The request itself succeeded (200 OK), but the server's strict-review
      // pass may still have produced nothing usable — reviewStatus distinguishes
      // that from "review not requested" (see server/ai/polish.ts). In that case
      // strictReview/aiScore come back null, so merging would wipe any PRIOR
      // successful review already sitting in the result. Skip the merge and mark
      // the stage failed (no local review stands in — D011); the result,
      // including any prior successful review, is left untouched, and the fit
      // readout keeps whatever estimate it already showed.
      if (data.reviewStatus === "failed") {
        setPolishProgress((prev) => ({
          ...prev,
          review: { status: "failed", errorHeadline: AI_UNAVAILABLE, error: "The reviewer returned nothing usable. Retry, or switch the Review provider." }
        }));
        setPipelineAiUsage((prev) => ({
          ...prev,
          review: {
            source: "none",
            requestedProvider: review.provider,
            requestedModel: review.selectedModel === "custom" ? review.customModel.trim() : review.selectedModel,
            completedAt: new Date().toISOString()
          }
        }));
        return;
      }
      const reviewedBy = computePolishReviewedBy(data);
      setResult((prev) => {
        // review-only (no prior tailor): synthesize a base result first.
        if (!prev) {
          const baseAnalysis = analyzeResumeText(currentResumeText || scopedResumeText, jobDescription);
          const baseResult: PolishedResume = {
            ...baseAnalysis,
            polishedText: currentResumeText || scopedResumeText,
            source: "ai",
            suggestedChanges: []
          };
          return mergeReviewIntoResult(baseResult, data, reviewedBy);
        }
        return mergeReviewIntoResult(prev, data, reviewedBy);
      });
      setActiveOutputTab("resume");
      setPolishProgress((prev) => ({ ...prev, review: { status: "done", note: "Reviewed with AI", noteTone: "ok" } }));
      const reviewProvider = (data.auditProvider ?? data.provider) as string | undefined;
      const reviewModel = (data.auditModel ?? data.model) as string | undefined;
      setPipelineAiUsage((prev) => ({
        ...prev,
        review: {
          source: "ai",
          ...(reviewProvider ? { provider: reviewProvider } : {}),
          ...(reviewModel ? { model: reviewModel } : {}),
          ...(typeof data.auditReasoningEffort === "string" && data.auditReasoningEffort
            ? { reasoningEffort: data.auditReasoningEffort }
            : {}),
          ...(typeof data.auditAttempts === "number" ? { attempts: data.auditAttempts } : {}),
          completedAt: new Date().toISOString()
        }
      }));
    } catch (error) {
      // User clicked Stop — let the orchestrator handle the clean stop. The
      // existing result (e.g. a completed tailor in "both") is left intact.
      if (signal?.aborted) throw error;
      // No local review stands in (D011): the stage fails plainly with a
      // classified reason and Retry. The existing result is kept — a successful
      // tailor result is never clobbered, and the fit readout keeps whatever
      // estimate it already showed.
      const f = classifyFailure(error);
      setPolishProgress((prev) => ({
        ...prev,
        review: { status: "failed", errorHeadline: f.headline, error: f.detail }
      }));
      setPipelineAiUsage((prev) => ({
        ...prev,
        review: {
          source: "none",
          requestedProvider: review.provider,
          requestedModel: review.selectedModel === "custom" ? review.customModel.trim() : review.selectedModel,
          completedAt: new Date().toISOString()
        }
      }));
    }
  }

  // Clean-stop teardown shared by handlePolish/retryStage when the user clicks
  // Stop: clear the per-stage progress, hide the indicator, and surface a quiet
  // status. The displayed resume is left as-is (a completed tailor stage in
  // "both" keeps its result; a stopped tailor never replaced the prior result).
  function handlePolishStopped() {
    setPolishProgress(idleProgress());
    setPolishProgressVisible(false);
    setPolishStatus("Polish stopped.");
  }

  // Abort the in-flight polish fetch(es). The stage runners re-throw the abort,
  // the orchestrator's catch runs handlePolishStopped, and `finally` clears
  // isPolishing — so a Stop frees the UI immediately. (The server-side AI call
  // runs on this machine and self-terminates within its own timeout.)
  function stopPolish() {
    polishAbortRef.current?.abort();
  }

  async function handlePolish() {
    if (isPolishing) return;
    const ctx = buildPolishContext();
    if (!ctx) return;

    // Duplicate gate BEFORE any AI spend (dialog copy + acknowledgment live in
    // useDuplicateGuard). The auto-tailor path funnels through here too — so an
    // extension import of an already-applied job pauses instead of silently
    // burning a polish run on it.
    if (!(await confirmDuplicateBeforePolish())) return;

    const controller = new AbortController();
    polishAbortRef.current = controller;
    const { signal } = controller;
    setIsPolishing(true);
    setPolishProgress(idleProgress());
    setPolishProgressVisible(true);
    setPolishStatus("");
    resetExportStatuses();
    setTexStatus("");
    // A fresh full run must not show stale prior-run provider attribution while
    // the new run is in flight — the stage runners below repopulate whichever
    // keys they actually run.
    setPipelineAiUsage((prev) => {
      const next = { ...prev };
      delete next.tailor;
      delete next.review;
      delete next.cover;
      return next;
    });

    try {
      if (polishStages === "tailor") {
        await runTailorStage(ctx, signal);
      } else if (polishStages === "review") {
        // Standalone review audits the current proposal when one exists (so the
        // verdict describes the displayed resume), else the base resume.
        await runReviewStage(ctx, result?.suggestedChanges ?? [], signal);
      } else {
        // both: tailor first, then review only if tailor succeeded.
        const suggestions = await runTailorStage(ctx, signal);
        if (suggestions !== null) {
          await runReviewStage(ctx, suggestions, signal);
        } else {
          // Tailor failed (there is no local tailor fallback anymore — D011),
          // so review has nothing to audit: mark it failed alongside rather
          // than pretending a local estimate stands in.
          setPolishProgress((prev) => ({
            ...prev,
            review: { status: "failed", errorHeadline: "Skipped", error: "Tailor did not complete, so there was nothing to review." }
          }));
        }
      }
    } catch (error) {
      // The only throw that reaches here is a Stop abort (stage runners catch
      // their own request errors and surface them as a failed stage).
      if (signal.aborted) handlePolishStopped();
      // Defensive: stage runners convert their own request errors into a failed
      // stage, so only a Stop abort should reach here. Surface anything else as a
      // status toast rather than re-throwing out of this onClick-driven handler.
      else setPolishStatus(error instanceof Error ? error.message : "Unexpected polish error.");
    } finally {
      setIsPolishing(false);
      polishAbortRef.current = null;
    }
  }

  // Retry a failed stage — a thin dispatcher over the shared stage runners. For
  // "tailor": re-runs the tailor stage (and if polishStages === "both" and it
  // succeeds, runs review). For "review": re-runs review with the current
  // result's suggestedChanges (the server-sanitized list from the prior tailor —
  // never re-derives from scope).
  async function retryStage(stage: "tailor" | "review") {
    if (isPolishing) return;
    const ctx = buildPolishContext();
    if (!ctx) return;

    const controller = new AbortController();
    polishAbortRef.current = controller;
    const { signal } = controller;
    setIsPolishing(true);
    // Only clear the stage(s) about to re-run — e.g. retrying "review" alone
    // must not wipe a still-valid "tailor" usage from the prior run.
    setPipelineAiUsage((prev) => {
      const next = { ...prev };
      if (stage === "tailor") {
        delete next.tailor;
        delete next.cover;
      } else {
        delete next.review;
      }
      return next;
    });
    try {
      if (stage === "tailor") {
        const suggestions = await runTailorStage(ctx, signal);
        // If polishStages === "both", auto-run review after a successful tailor retry.
        if (suggestions !== null && polishStages === "both") {
          await runReviewStage(ctx, suggestions, signal);
        }
      } else {
        // stage === "review": reuse the server-sanitized suggestedChanges from
        // the current result (never re-derives from tailorScope).
        await runReviewStage(ctx, result?.suggestedChanges ?? [], signal);
      }
    } catch (error) {
      if (signal.aborted) handlePolishStopped();
      // Defensive: stage runners convert their own request errors into a failed
      // stage, so only a Stop abort should reach here. Surface anything else as a
      // status toast rather than re-throwing out of this onClick-driven handler.
      else setPolishStatus(error instanceof Error ? error.message : "Unexpected polish error.");
    } finally {
      setIsPolishing(false);
      polishAbortRef.current = null;
    }
  }

  return {
    isPolishing,
    polishProgress,
    polishProgressVisible,
    setPolishProgressVisible,
    handlePolish,
    retryStage,
    stopPolish
  };
}
