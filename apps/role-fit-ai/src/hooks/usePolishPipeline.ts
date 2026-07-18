/**
 * usePolishPipeline — the two-stage polish flow (Tailor -> Review), extracted
 * from App.tsx: buildPolishContext, the reviewer-attribution + merge helpers,
 * the two stage runners, handlePolish, retryStage, and the Stop/clean-stop
 * teardown.
 *
 * State ownership: isPolishing/polishProgress/polishProgressVisible are OWNED
 * here (not passed in), mirroring useJobIntake's reasoning — every mutator of
 * them is one of these functions; App only READS them for render (Masthead's
 * isPolishing prop, the progress-dock visibility check, AiWorkflowProgress's
 * progress/busy props, the before-unload guard, and the _myPhase presence
 * memo) and for the auto-tailor effect's `if (canPolish && !isPolishing)`
 * guard, so returning them keeps the interface small without splitting
 * control between two owners. polishAbortRef stays internal (only
 * handlePolish/retryStage/stopPolish touch it).
 *
 * editedResume/tailorModes/jobDescription/the tailor+review StageConfigs/etc.
 * stay in App (they're shared far beyond this flow — the editor, review,
 * exports, autosave), so they arrive via args; duplicateGuard and the focused
 * cover-result callback likewise arrive as dependencies rather than being
 * re-owned here.
 */
import { useEffect, useRef, useState } from "react";
import { analyzeResumeText, normalizePolishedResume, type PolishedResume } from "../resumeEngine";
import { describeProviderModel } from "../config/aiOptions";
import { buildAuditRequestFields, buildStageRequestFields, type StageConfig } from "../lib/aiRequest";
import { ApiError, classifyFailure } from "../lib/failures";
import { buildTailorScope, defaultTailorModes, tailorScopeToText, type TailorMode } from "../lib/tailorScope";
import type { StageAiUsage } from "../lib/aiUsage";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import {
  workflowInputFingerprint,
  workflowRequestIsCurrent,
  type PolishProgressState
} from "../lib/aiWorkflow";
import type { OutputTab } from "../sections/shared";
import type { PolishCoverResult } from "./useCoverLetter";

function idleProgress(): PolishProgressState {
  return {
    tailor: { status: "idle" },
    review: { status: "idle" }
  };
}

type PolishContext = {
  scopedResumeText: string;
  commonBody: Record<string, unknown>;
  reviewFingerprint: string;
  inputFingerprint: string;
};

type ReviewSuggestions = NonNullable<PolishedResume["suggestedChanges"]>;
type ReviewTarget = "current" | "proposal";
type ReviewSnapshot = {
  target: ReviewTarget;
  suggestions: ReviewSuggestions;
  fingerprint: string;
};

async function readAiResponse(response: Response, stage: "tailor" | "review"): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    throw new ApiError(`The ${stage} returned an unparseable response`, 502);
  }
}

type UsePolishPipelineArgs = {
  editedResume: ResumeData | null;
  tailorModes: Record<string, TailorMode>;
  currentResumeText: string;
  // The job target text sent to Tailor and AI Review. App has no separate
  // "combined" job text; it passes its single jobDescription state here.
  jobDescription: string;
  includeCoverLetter: boolean;
  requestHonestContext: string;
  customInstructions: string;
  polishStages: "tailor" | "review" | "both";
  tailor: StageConfig;
  review: StageConfig;
  setResult: (updater: PolishedResume | null | ((prev: PolishedResume | null) => PolishedResume | null)) => void;
  applyPolishCoverResult: (result: PolishCoverResult) => void;
  setActiveOutputTab: (tab: OutputTab) => void;
  setPipelineAiUsage: (updater: (prev: Record<string, StageAiUsage>) => Record<string, StageAiUsage>) => void;
  setPolishStatus: (value: string) => void;
  resetExportStatuses: () => void;
  setExportStatus: (value: string) => void;
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
  setResult,
  applyPolishCoverResult,
  setActiveOutputTab,
  setPipelineAiUsage,
  setPolishStatus,
  resetExportStatuses,
  setExportStatus,
  confirmDuplicateBeforePolish
}: UsePolishPipelineArgs) {
  const [isPolishing, setIsPolishing] = useState(false);
  // Per-stage progress state for the two-stage polish flow (Tailor / Review).
  // Shown in the shared AI workflow while a polish is in-flight or has
  // a failed stage. Reset to all-idle on every new polish run.
  const [polishProgress, setPolishProgress] = useState<PolishProgressState>(idleProgress);
  // True once a polish has been initiated — keeps the workflow visible after
  // the run completes (including failures) until the user dismisses it.
  const [polishProgressVisible, setPolishProgressVisible] = useState(false);
  // Aborts the in-flight polish fetch(es) when the user clicks Stop. Created per
  // run in handlePolish/retryStage; both stages share one controller so a Stop
  // during either tailor or review cancels the whole run.
  const polishAbortRef = useRef<AbortController | null>(null);
  const polishGenerationRef = useRef(0);
  const polishRunLockRef = useRef(false);
  // Snapshot the exact target + suggestion payload handed to the most recent
  // review attempt. Null means there is no legitimate Review retry for this run.
  const reviewSnapshotRef = useRef<ReviewSnapshot | null>(null);
  const inputFingerprint = workflowInputFingerprint({
    editedResume,
    tailorModes,
    currentResumeText,
    jobDescription,
    includeCoverLetter,
    requestHonestContext,
    customInstructions,
    polishStages,
    tailor: buildStageRequestFields(tailor),
    review: buildAuditRequestFields(review)
  });
  const inputFingerprintRef = useRef(inputFingerprint);
  inputFingerprintRef.current = inputFingerprint;

  function runIdentityMatches(generation: number, ctx: PolishContext): boolean {
    return workflowRequestIsCurrent(
      generation,
      polishGenerationRef.current,
      ctx.inputFingerprint,
      inputFingerprintRef.current
    );
  }

  function runCanCommit(generation: number, ctx: PolishContext, signal?: AbortSignal): boolean {
    return workflowRequestIsCurrent(
      generation,
      polishGenerationRef.current,
      ctx.inputFingerprint,
      inputFingerprintRef.current,
      signal
    );
  }

  useEffect(() => {
    if (!polishRunLockRef.current && !polishAbortRef.current) return;
    polishGenerationRef.current += 1;
    polishAbortRef.current?.abort();
    polishAbortRef.current = null;
    polishRunLockRef.current = false;
    setIsPolishing(false);
    setPolishProgress((prev) => ({
      tailor: prev.tailor.status === "running"
        ? { status: "stopped", errorHeadline: "Inputs changed", error: "Tailor was cancelled before it could update this draft." }
        : prev.tailor,
      review: prev.review.status === "running"
        ? { status: "stopped", errorHeadline: "Inputs changed", error: "Review was cancelled before it could update this draft." }
        : prev.review
    }));
    setPolishProgressVisible(true);
    setPolishStatus("Resume, job, workflow, or AI settings changed. Start a new AI workflow for the current inputs.");
  }, [inputFingerprint, setPolishStatus]);

  useEffect(() => () => {
    polishGenerationRef.current += 1;
    polishAbortRef.current?.abort();
    polishAbortRef.current = null;
    polishRunLockRef.current = false;
  }, []);

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

    // Retry provenance: bind a Review attempt to the exact document scope and
    // evidence inputs it audited. Provider settings may intentionally change for
    // a retry, but stale suggestions must never be re-applied to a rebuilt scope.
    const reviewFingerprint = JSON.stringify({
      tailorScope,
      jobText: jobDescription,
      honestContext: requestHonestContext,
      customInstructions
    });

    return { scopedResumeText, commonBody, reviewFingerprint, inputFingerprint: inputFingerprintRef.current };
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
  // with stages:"tailor", and builds a result WITHOUT aiScore/strictReview.
  // A Tailor-only run has no fit judgment until AI Review succeeds. Returns the
  // server-sanitized suggestedChanges array on success, null on failure.
  async function runTailorStage(
    ctx: PolishContext,
    generation: number,
    signal?: AbortSignal
  ): Promise<ReviewSuggestions | null> {
    if (!runCanCommit(generation, ctx, signal)) return null;
    const { scopedResumeText, commonBody } = ctx;
    setPolishProgress((prev) => ({ ...prev, tailor: { status: "running" }, review: { status: "idle" } }));
    try {
      const response = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...commonBody, stages: "tailor" }),
        signal
      });
      const data = await readAiResponse(response, "tailor");
      if (!runCanCommit(generation, ctx, signal)) return null;
      if (!response.ok) throw new ApiError((data.error as string) ?? "AI tailor failed.", response.status);
      const suggestedChanges: ReviewSuggestions = Array.isArray(data.suggestedChanges) ? data.suggestedChanges : [];
      if (!data.polishedText && !suggestedChanges.length) {
        throw new ApiError("The tailor returned no usable resume suggestions", 502);
      }
      const scopedPolishedText = data.polishedText
        ? normalizePolishedResume(data.polishedText as string, scopedResumeText)
        : scopedResumeText;
      const analysis = analyzeResumeText(
        suggestedChanges.length ? currentResumeText || scopedPolishedText : scopedPolishedText,
        jobDescription
      );
      const legacyCoverText = typeof data.coverLetterText === "string" ? data.coverLetterText.trim() : "";
      const coverStatus: PolishCoverResult["status"] =
        data.coverStatus === "off" || data.coverStatus === "ok" || data.coverStatus === "failed"
          ? data.coverStatus
          : !includeCoverLetter
            ? "off"
            : legacyCoverText
              ? "ok"
              : "failed";
      const coverText = coverStatus === "ok"
        ? legacyCoverText || undefined
        : undefined;
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
        // as undefined so it does not display a stale or invented fit judgment.
        // reviewStatus resets too, so a stale "failed" from a prior review doesn't
        // linger on a fresh tailor result that hasn't been reviewed yet.
        aiScore: undefined,
        strictReview: undefined,
        reviewedBy: undefined,
        reviewStatus: undefined
      });
      // Feed the shared cover-letter owner the explicit secondary-pass outcome.
      // It shows success/failure in Materials + the task dock and preserves any
      // existing letter when the optional combined cover pass fails.
      applyPolishCoverResult({
        status: coverStatus,
        coverLetterText: coverText,
        ...(typeof data.provider === "string" && data.provider ? { provider: data.provider } : {}),
        ...(typeof data.model === "string" && data.model ? { model: data.model } : {}),
        ...(typeof data.reasoningEffort === "string" && data.reasoningEffort ? { reasoningEffort: data.reasoningEffort } : {})
      });
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
        tailor: tailorUsage
      }));
      return suggestedChanges;
    } catch (error) {
      // User clicked Stop — let the orchestrator handle the clean stop; do NOT
      // mark the stage failed.
      if (signal?.aborted) {
        if (runIdentityMatches(generation, ctx)) throw error;
        return null;
      }
      if (!runIdentityMatches(generation, ctx)) return null;
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
          requestedModel: tailor.selectedModel,
          completedAt: new Date().toISOString()
        }
      }));
      return null;
    }
  }

  // Stage runner: Review. Sets progress.review=running, snapshots and posts an
  // explicit target plus its exact suggestedChanges input: the just-sanitized
  // Tailor proposal in Both mode, or [] when a standalone Review audits the
  // current edited draft as-is. A current-draft success replaces any stale prior
  // proposal result before merging the new review fields; a proposal success
  // preserves the Tailor result already on screen.
  async function runReviewStage(
    ctx: PolishContext,
    snapshot: ReviewSnapshot,
    generation: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (!runCanCommit(generation, ctx, signal)) return;
    const { scopedResumeText, commonBody } = ctx;
    reviewSnapshotRef.current = snapshot;
    setPolishProgress((prev) => ({ ...prev, review: { status: "running" } }));
    try {
      const response = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...commonBody, stages: "review", suggestedChanges: snapshot.suggestions }),
        signal
      });
      const data = await readAiResponse(response, "review");
      if (!runCanCommit(generation, ctx, signal)) return;
      if (!response.ok) throw new ApiError((data.error as string) ?? "AI review failed.", response.status);
      // The request itself succeeded (200 OK), but the server's strict-review
      // pass may still have produced nothing usable — reviewStatus distinguishes
      // that from "review not requested" (see server/ai/polish.ts). In that case
      // strictReview/aiScore come back null, so merging would wipe any PRIOR
      // successful review already sitting in the result. Skip the merge and mark
      // the stage failed (no local review stands in — D011); the result,
      // including any prior successful review, is left untouched, and the fit
      // readout keeps only a prior successful AI review, if one exists.
      if (data.reviewStatus === "failed") {
        const reviewError = typeof data.reviewError === "string"
          ? data.reviewError
          : "The reviewer returned no usable score and evidence. Retry, or switch the Review provider.";
        const reviewErrorStatus = typeof data.reviewErrorStatus === "number"
          ? data.reviewErrorStatus
          : 502;
        const failure = classifyFailure(new ApiError(reviewError, reviewErrorStatus));
        setPolishProgress((prev) => ({
          ...prev,
          review: { status: "failed", errorHeadline: failure.headline, error: failure.detail }
        }));
        setPipelineAiUsage((prev) => ({
          ...prev,
          review: {
            source: "none",
            requestedProvider: review.provider,
            requestedModel: review.selectedModel,
            completedAt: new Date().toISOString()
          }
        }));
        return;
      }
      const reviewedBy = computePolishReviewedBy(data);
      setResult((prev) => {
        if (!runCanCommit(generation, ctx, signal)) return prev;
        // Standalone Review always describes the current edited draft, never a
        // stale proposal retained from an earlier Tailor run. Proposal review
        // keeps the existing Tailor result, including its zero-suggestion case.
        if (snapshot.target === "current" || !prev) {
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
      if (signal?.aborted) {
        if (runIdentityMatches(generation, ctx)) throw error;
        return;
      }
      if (!runIdentityMatches(generation, ctx)) return;
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
          requestedModel: review.selectedModel,
          completedAt: new Date().toISOString()
        }
      }));
    }
  }

  // Clean-stop teardown shared by handlePolish/retryStage when the user clicks
  // Stop. Preserve the completed rows, mark the active row stopped, and leave
  // later rows visibly not run. The displayed resume is left as-is.
  function handlePolishStopped() {
    setPolishProgress((prev) => ({
      tailor: prev.tailor.status === "running"
        ? { status: "stopped", errorHeadline: "Stopped by user", error: "Tailor was cancelled. Review was not run." }
        : prev.tailor,
      review: prev.review.status === "running"
        ? { status: "stopped", errorHeadline: "Stopped by user", error: "Review was cancelled." }
        : prev.review
    }));
    setPolishProgressVisible(true);
    setPolishStatus("AI workflow stopped.");
  }

  // Abort the in-flight polish fetch(es). The stage runners re-throw the abort,
  // the orchestrator's catch runs handlePolishStopped, and `finally` clears
  // isPolishing — so a Stop frees the UI immediately. (The server-side AI call
  // runs on this machine and self-terminates within its own timeout.)
  function stopPolish() {
    polishAbortRef.current?.abort();
  }

  async function handlePolish() {
    if (polishRunLockRef.current) return;
    polishRunLockRef.current = true;
    polishGenerationRef.current += 1;
    const generation = polishGenerationRef.current;
    const ctx = buildPolishContext();
    if (!ctx) {
      polishRunLockRef.current = false;
      return;
    }

    // Duplicate gate BEFORE any AI spend (dialog copy + acknowledgment live in
    // useDuplicateGuard). The auto-tailor path funnels through here too — so an
    // extension import of an already-applied job pauses instead of silently
    // burning a polish run on it.
    const duplicateAllowed = await confirmDuplicateBeforePolish();
    if (!runIdentityMatches(generation, ctx)) return;
    if (!duplicateAllowed) {
      const firstStage = polishStages === "review" ? "review" : "tailor";
      setPolishProgress({
        ...idleProgress(),
        [firstStage]: {
          status: "stopped",
          errorHeadline: "Duplicate application found",
          error: `Pipeline stopped before ${firstStage === "review" ? "Review" : "Tailor"}. No AI request was made.`
        }
      });
      setPolishProgressVisible(true);
      setPolishStatus("Pipeline stopped because this application is already tracked.");
      polishRunLockRef.current = false;
      return;
    }

    // A fresh run owns a fresh retry history. The next Review attempt (if any)
    // installs its own current/proposal snapshot before making the request.
    reviewSnapshotRef.current = null;
    const controller = new AbortController();
    polishAbortRef.current = controller;
    const { signal } = controller;
    setIsPolishing(true);
    setPolishProgress(idleProgress());
    setPolishProgressVisible(true);
    setPolishStatus("");
    resetExportStatuses();
    setExportStatus("");
    // A fresh full run must not show stale prior-run provider attribution while
    // the new run is in flight — the stage runners below repopulate whichever
    // keys they actually run.
    setPipelineAiUsage((prev) => {
      const next = { ...prev };
      delete next.tailor;
      delete next.review;
      // Preserve provenance for an existing letter when this run is not asking
      // the Tailor stage to replace it. Review-only never generates a cover.
      if (includeCoverLetter && polishStages !== "review") delete next.cover;
      return next;
    });

    try {
      if (polishStages === "tailor") {
        await runTailorStage(ctx, generation, signal);
      } else if (polishStages === "review") {
        // A fresh standalone Review audits the CURRENT edited draft as-is. Old
        // result suggestions may describe a prior draft and must not be silently
        // re-applied or re-judged.
        await runReviewStage(ctx, {
          target: "current",
          suggestions: [],
          fingerprint: ctx.reviewFingerprint
        }, generation, signal);
      } else {
        // both: tailor first, then review only if tailor succeeded.
        const suggestions = await runTailorStage(ctx, generation, signal);
        if (suggestions !== null) {
          await runReviewStage(ctx, {
            target: "proposal",
            suggestions,
            fingerprint: ctx.reviewFingerprint
          }, generation, signal);
        }
      }
    } catch (error) {
      // The only throw that reaches here is a Stop abort (stage runners catch
      // their own request errors and surface them as a failed stage).
      if (signal.aborted && runIdentityMatches(generation, ctx)) handlePolishStopped();
      // Defensive: stage runners convert their own request errors into a failed
      // stage, so only a Stop abort should reach here. Surface anything else as a
      // status toast rather than re-throwing out of this onClick-driven handler.
      else if (runIdentityMatches(generation, ctx)) {
        const failure = classifyFailure(error);
        setPolishStatus(`${failure.headline}: ${failure.detail}.`);
      }
    } finally {
      if (runIdentityMatches(generation, ctx)) {
        setIsPolishing(false);
        polishAbortRef.current = null;
        polishRunLockRef.current = false;
      }
    }
  }

  // Retry a failed stage — a thin dispatcher over the shared stage runners. For
  // "tailor": re-runs the tailor stage (and if polishStages === "both" and it
  // succeeds, runs review). For "review": replays the exact suggestion payload
  // and target captured by the failed review attempt — the Both proposal stays
  // a proposal, while standalone Review stays a current-draft-as-is audit.
  async function retryStage(stage: "tailor" | "review") {
    if (polishRunLockRef.current) return;
    polishRunLockRef.current = true;
    polishGenerationRef.current += 1;
    const generation = polishGenerationRef.current;
    const reviewSnapshot = stage === "review" ? reviewSnapshotRef.current : null;
    if (stage === "review" && !reviewSnapshot) {
      setPolishStatus("There is no review attempt to retry. Start a new Review instead.");
      polishRunLockRef.current = false;
      return;
    }
    const ctx = buildPolishContext();
    if (!ctx) {
      polishRunLockRef.current = false;
      return;
    }
    if (reviewSnapshot && reviewSnapshot.fingerprint !== ctx.reviewFingerprint) {
      reviewSnapshotRef.current = null;
      setPolishStatus("The resume or review inputs changed. Start a new Review instead of retrying the stale proposal.");
      setPolishProgress((prev) => ({
        ...prev,
        review: {
          status: "failed",
          errorHeadline: "Inputs changed",
          error: "Start a new Review so it audits the current resume and job inputs."
        }
      }));
      polishRunLockRef.current = false;
      return;
    }

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
        if (includeCoverLetter) delete next.cover;
      } else {
        delete next.review;
      }
      return next;
    });
    try {
      if (stage === "tailor") {
        const suggestions = await runTailorStage(ctx, generation, signal);
        // If polishStages === "both", auto-run review after a successful tailor retry.
        if (suggestions !== null && polishStages === "both") {
          await runReviewStage(ctx, {
            target: "proposal",
            suggestions,
            fingerprint: ctx.reviewFingerprint
          }, generation, signal);
        }
      } else {
        // Guarded above; keep this branch explicit so a future refactor cannot
        // silently fall back to an empty/stale payload.
        if (reviewSnapshot) await runReviewStage(ctx, reviewSnapshot, generation, signal);
      }
    } catch (error) {
      if (signal.aborted && runIdentityMatches(generation, ctx)) handlePolishStopped();
      // Defensive: stage runners convert their own request errors into a failed
      // stage, so only a Stop abort should reach here. Surface anything else as a
      // status toast rather than re-throwing out of this onClick-driven handler.
      else if (runIdentityMatches(generation, ctx)) {
        const failure = classifyFailure(error);
        setPolishStatus(`${failure.headline}: ${failure.detail}.`);
      }
    } finally {
      if (runIdentityMatches(generation, ctx)) {
        setIsPolishing(false);
        polishAbortRef.current = null;
        polishRunLockRef.current = false;
      }
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
