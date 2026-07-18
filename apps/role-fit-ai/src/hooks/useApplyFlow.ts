/**
 * useApplyFlow — the Apply flow, extracted from App.tsx: the download-prompt
 * state, commitApply, handleApply, handleApplyDownloadPick, handleApplyOnly,
 * and saveAppliedResumeArtifacts.
 *
 * State ownership: applyMergeTargetRef/applyDownloadPrompt are OWNED here —
 * every mutator of them is one of these functions. App only reads
 * applyDownloadPrompt for render (the ApplyDownloadDialog) and calls
 * handleApply from the Apply button.
 *
 * Everything this cluster reads or mutates OUTSIDE its own state (job/resume
 * text, the polish result, the applications store, export/download, duplicate
 * resolution) stays owned by App and arrives via args, mirroring
 * usePolishPipeline's pattern.
 */
import { useRef, useState } from "react";
import {
  makeApplicationDraft,
  type Application,
  type ApplicationStatus
} from "./useApplications";
import type { ApplyDuplicateResolution } from "./useDuplicateGuard";
import type { ExtractedJobTracking } from "../lib/jobExtract";
import type { StageAiUsage } from "../lib/aiUsage";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import type { PolishedResume } from "../resumeEngine";
import type { FitComparison, OutputTab } from "../sections/shared";

export function normalizeResumeSnapshot(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

type UseApplyFlowArgs = {
  jobUrl: string;
  jobDescription: string;
  jobRawText: string;
  result: PolishedResume | null;
  currentResumeText: string;
  resumeText: string;
  editedResume: ResumeData | null;
  coverLetterText: string;
  headlineScore: number | null;
  fitComparison: FitComparison | null;
  pipelineAiUsage: Record<string, StageAiUsage>;
  applications: Application[];
  findForTarget: (url: string, desc: string) => Application | undefined;
  upsertApplication: (app: Application) => Promise<boolean>;
  patchApplication: (id: string, patch: Partial<Application>) => void;
  currentJobTracking: () => ExtractedJobTracking;
  resolveApplyDuplicate: () => Promise<ApplyDuplicateResolution>;
  canExportResume: boolean;
  handleDownloadPdf: (overrideBase?: string) => void | Promise<void>;
  getResumeArtifacts: () => Promise<{ pdfBase64: string | null; fileName: string } | null>;
  clearAutosaveDraft: () => void;
  markResumeClean: () => void;
  setApplyStatus: (value: string) => void;
  setActiveOutputTab: (tab: OutputTab) => void;
  setExpandedApplicationId: (id: string | null) => void;
};

export function useApplyFlow({
  jobUrl,
  jobDescription,
  jobRawText,
  result,
  currentResumeText,
  resumeText,
  editedResume,
  coverLetterText,
  headlineScore,
  fitComparison,
  pipelineAiUsage,
  applications,
  findForTarget,
  upsertApplication,
  patchApplication,
  currentJobTracking,
  resolveApplyDuplicate,
  canExportResume,
  handleDownloadPdf,
  getResumeArtifacts,
  clearAutosaveDraft,
  markResumeClean,
  setApplyStatus,
  setActiveOutputTab,
  setExpandedApplicationId
}: UseApplyFlowArgs) {
  // Set by handleApply when a duplicate scan finds an "exact"/"high"-confidence
  // match, so commitApply merges into that record instead of (or in addition
  // to) whatever findForTarget's own exact-only lookup would find. Cleared on
  // every path where the apply flow completes or is abandoned. "possible"
  // matches never set this — they never auto-merge.
  const applyMergeTargetRef = useRef<string | null>(null);
  // Post-Apply download prompt: holds the just-applied role's label while open.
  const [applyDownloadPrompt, setApplyDownloadPrompt] = useState<{ label: string } | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applySaveError, setApplySaveError] = useState("");
  const applyCommitInFlightRef = useRef(false);

  // Render the current resume to PDF and persist it under the applied
  // application, then attach the returned metadata. Best-effort: Apply has
  // already succeeded, so a failed render is swallowed (the application is
  // still saved even without a resume snapshot attached).
  async function saveAppliedResumeArtifacts(id: string, label: string) {
    try {
      const artifacts = await getResumeArtifacts();
      if (!artifacts) return;
      const res = await fetch(`/api/applications/${encodeURIComponent(id)}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdfBase64: artifacts.pdfBase64 ?? undefined,
          fileName: artifacts.fileName
        })
      });
      const data = await res.json();
      if (!res.ok || !data.resumeArtifacts) return;
      patchApplication(id, { resumeArtifacts: data.resumeArtifacts });
      setApplyStatus(
        `Applied "${label}". Saved resume ${data.resumeArtifacts.hasPdf ? "PDF" : "without a PDF because typesetting failed"}.`
      );
    } catch {
      // Best-effort: the application is already saved.
    }
  }

  // The actual apply: save the application, snapshot artifacts, update UI.
  // Called directly when the user has opted to skip the download dialog, or
  // from the dialog's Download / Apply-only callbacks.
  async function commitApply(): Promise<boolean> {
    if ((!jobUrl.trim() && !jobDescription.trim()) || applyCommitInFlightRef.current) return false;
    applyCommitInFlightRef.current = true;
    setIsApplying(true);
    setApplySaveError("");
    const sr = result?.strictReview;
    const hasStructuredSuggestions = Boolean(result?.suggestedChanges?.length);
    const acceptedStructuredSuggestions =
      hasStructuredSuggestions &&
      Boolean(result?.polishedText) &&
      normalizeResumeSnapshot(currentResumeText) !== normalizeResumeSnapshot(result?.polishedText ?? "");
    const usedBase = !result?.polishedText || (hasStructuredSuggestions && !acceptedStructuredSuggestions);
    const sentResume = currentResumeText || resumeText || result?.polishedText || "";
    // A duplicate scan in handleApply may have already identified which record
    // this apply should merge into (exact/high confidence, user-confirmed when
    // not "interested"). Prefer that over the exact-only findForTarget lookup;
    // Retain the target until persistence succeeds so a recoverable retry keeps
    // the user's confirmed merge decision; cancel and success both clear it.
    const existing =
      (applyMergeTargetRef.current ? applications.find((a) => a.id === applyMergeTargetRef.current) : undefined) ??
      findForTarget(jobUrl, jobDescription);
    const now = new Date().toISOString();
    const status: ApplicationStatus =
      existing && existing.status && existing.status !== "interested" ? existing.status : "applied";
    const draft = makeApplicationDraft(jobUrl, jobDescription, currentJobTracking());
    const app: Application = {
      ...draft,
      id: existing?.id ?? draft.id,
      status,
      appliedAt: existing?.appliedAt ?? now,
      fitScore: headlineScore,
      baseFitScore: fitComparison?.base ?? null,
      tailoredFitScore: fitComparison?.tailored ?? null,
      fitScoreSource: fitComparison?.source ?? null,
      resumeData: editedResume ?? undefined,
      polishedText: sentResume,
      resumeUsed: usedBase ? "base" : "tailored",
      coverLetterText: coverLetterText || "",
      missingRequiredSkills: result?.missingRequiredSkills?.length ? result.missingRequiredSkills : undefined,
      // Only set rawJobDescription when it differs from the distilled jobDescription
      // (avoids storing the same text twice) — omitted entirely, never `undefined`,
      // so upsert's plain object-spread merge can't clobber an existing value.
      ...(jobRawText.trim() && jobRawText.trim() !== jobDescription.trim()
        ? { rawJobDescription: jobRawText.trim() }
        : {}),
      aiUsage: {
        distill: pipelineAiUsage.distill ?? { source: "none" },
        tailor: pipelineAiUsage.tailor ?? { source: "none" },
        review: pipelineAiUsage.review ?? { source: "none" },
        ...(pipelineAiUsage.cover ? { cover: pipelineAiUsage.cover } : {})
      },
      review: sr
        ? {
            verdict: sr.verdict,
            verdictReason: sr.verdictReason,
            riskFlags: sr.riskFlags.map((r) => ({ risk: r.risk, suggestion: r.suggestion })),
            gaps: sr.gaps.map((g) => ({
              gap: g.gap,
              severity: g.severity,
              evidenceType: g.evidenceType,
              canHonestlyAdd: g.canHonestlyAdd,
              evidence: g.evidence,
              suggestedEdit: g.suggestedEdit
            })),
            recommendation: {
              applyAsIs: sr.recommendation.applyAsIs,
              reason: sr.recommendation.reason,
              coverLetterAngle: sr.recommendation.coverLetterAngle,
              topEdits: sr.recommendation.topEdits
            }
          }
        : undefined
    };
    let saved = false;
    try {
      saved = await upsertApplication(app);
    } catch {
      // The store normally converts request failures to `false`; keep this
      // boundary fail-closed if a future adapter rejects unexpectedly.
    }
    if (!saved) {
      const message = "Application could not be saved. Your recovery draft is still available; retry Apply.";
      setApplySaveError(message);
      setApplyStatus(message);
      applyCommitInFlightRef.current = false;
      setIsApplying(false);
      return false;
    }
    applyMergeTargetRef.current = null;
    // Edits are now tracked in the application record and an artifact is saved to
    // disk — clear the recovery draft AND mark the editor clean so the before-unload
    // guard stops warning. A later edit re-flips `dirty` and re-arms the guard.
    clearAutosaveDraft();
    markResumeClean();
    setApplyStatus(`Applied. Saved "${existing?.title || app.title}" to Applications (${usedBase ? "original" : "tailored"} resume).`);
    setActiveOutputTab("applications");
    setExpandedApplicationId(existing?.id ?? app.id);
    void saveAppliedResumeArtifacts(existing?.id ?? app.id, existing?.title || app.title);
    applyCommitInFlightRef.current = false;
    setIsApplying(false);
    return true;
  }

  // Apply button handler: runs the layered duplicate scan first (warn / confirm
  // as needed — see findDuplicatesForTarget), then either commits immediately
  // (no download dialog) or shows the pre-apply dialog for the file name.
  async function handleApply() {
    if (!jobUrl.trim() && !jobDescription.trim()) return;
    setApplyStatus("");
    // Reset before evaluating so a prior call's stale target can never leak
    // into an unrelated apply. The dialogs, acknowledgment, and merge-target
    // decision live in useDuplicateGuard; commitApply consumes the ref.
    applyMergeTargetRef.current = null;
    const resolution = await resolveApplyDuplicate();
    if (!resolution.proceed) return;
    applyMergeTargetRef.current = resolution.mergeTargetId;

    if (!canExportResume) {
      await commitApply();
      return;
    }
    const existing = findForTarget(jobUrl, jobDescription);
    const draft = makeApplicationDraft(jobUrl, jobDescription, currentJobTracking());
    setApplySaveError("");
    setApplyDownloadPrompt({ label: existing?.title || draft.title });
  }

  async function handleApplyDownloadPick(fileBaseName: string) {
    if (!(await commitApply())) return;
    setApplyDownloadPrompt(null);
    await handleDownloadPdf(fileBaseName || undefined);
  }

  async function handleApplyOnly() {
    if (!(await commitApply())) return;
    setApplyDownloadPrompt(null);
  }

  return {
    applyMergeTargetRef,
    applyDownloadPrompt,
    setApplyDownloadPrompt,
    isApplying,
    applySaveError,
    handleApply,
    handleApplyDownloadPick,
    handleApplyOnly
  };
}
