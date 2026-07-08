/**
 * useApplyFlow — the Apply flow, extracted from App.tsx: the download-prompt +
 * default-export-format state, commitApply, handleApply, handleApplyDownloadPick,
 * handleApplyOnly, and saveAppliedResumeArtifacts.
 *
 * State ownership: applyMergeTargetRef/applyDownloadPrompt/defaultExportFormat
 * are OWNED here — every mutator of them is one of these functions. App only
 * reads applyDownloadPrompt/defaultExportFormat for render (the
 * ApplyDownloadDialog) and calls handleApply from the Apply button.
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
import { loadDefaultExportFormat, saveDefaultExportFormat, type ExportFormat } from "../lib/exportPrefs";
import type { StageAiUsage } from "../lib/aiUsage";
import type { ResumeData } from "../lib/resumeData";
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
  selectedTemplateId: string;
  coverLetterText: string;
  headlineScore: number | null;
  fitComparison: FitComparison | null;
  pipelineAiUsage: Record<string, StageAiUsage>;
  applications: Application[];
  findForTarget: (url: string, desc: string) => Application | undefined;
  upsertApplication: (app: Application) => void;
  patchApplication: (id: string, patch: Partial<Application>) => void;
  currentJobTracking: () => ExtractedJobTracking;
  resolveApplyDuplicate: () => Promise<ApplyDuplicateResolution>;
  canExportResume: boolean;
  handlePrintResume: (overrideBase?: string) => void;
  handleDownloadTex: (overrideBase?: string) => void | Promise<void>;
  handleDownloadLatexPdf: (overrideBase?: string) => void | Promise<void>;
  getResumeArtifacts: () => Promise<
    { tex: string; pdfBase64: string | null; fileName: string; templateId: string } | null
  >;
  clearAutosaveDraft: () => void;
  markResumeClean: () => void;
  setTexStatus: (value: string) => void;
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
  selectedTemplateId,
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
  handlePrintResume,
  handleDownloadTex,
  handleDownloadLatexPdf,
  getResumeArtifacts,
  clearAutosaveDraft,
  markResumeClean,
  setTexStatus,
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
  // The user's remembered "download this format on Apply" choice (localStorage).
  const [defaultExportFormat, setDefaultExportFormat] = useState<ExportFormat | null>(loadDefaultExportFormat);

  // Render the current resume to .tex/.pdf and persist them under the applied
  // application, then attach the returned metadata. Best-effort: Apply has
  // already succeeded, so a failed render/compile is swallowed (tex-only is a
  // valid outcome when Tectonic is missing).
  async function saveAppliedResumeArtifacts(id: string, label: string) {
    try {
      const artifacts = await getResumeArtifacts();
      if (!artifacts) return;
      const res = await fetch(`/api/applications/${encodeURIComponent(id)}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tex: artifacts.tex,
          pdfBase64: artifacts.pdfBase64 ?? undefined,
          fileName: artifacts.fileName,
          templateId: artifacts.templateId
        })
      });
      const data = await res.json();
      if (!res.ok || !data.resumeArtifacts) return;
      patchApplication(id, { resumeArtifacts: data.resumeArtifacts });
      setTexStatus(
        `Applied "${label}" — saved resume ${data.resumeArtifacts.hasPdf ? ".tex + PDF" : ".tex (install Tectonic to also save the PDF)"}.`
      );
    } catch {
      // Best-effort: the application is already saved.
    }
  }

  // The actual apply: save the application, snapshot artifacts, update UI.
  // Called directly when the user has opted to skip the download dialog, or
  // from the dialog's Download / Apply-only callbacks.
  function commitApply() {
    if (!jobUrl.trim() && !jobDescription.trim()) return;
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
    // consumed here regardless of hit/miss so it can never leak into a later,
    // unrelated commit (e.g. Apply-only clicked twice, or a stale ref from an
    // abandoned flow).
    const existing =
      (applyMergeTargetRef.current ? applications.find((a) => a.id === applyMergeTargetRef.current) : undefined) ??
      findForTarget(jobUrl, jobDescription);
    applyMergeTargetRef.current = null;
    const now = new Date().toISOString();
    const status: ApplicationStatus =
      existing && existing.status && existing.status !== "interested" ? existing.status : "applied";
    const draft = makeApplicationDraft(jobUrl, jobDescription, currentJobTracking());
    const app: Application = {
      ...draft,
      id: existing?.id ?? draft.id,
      status,
      appliedAt: existing?.appliedAt ?? now,
      fitScore: headlineScore ?? result?.score.overall ?? null,
      baseFitScore: fitComparison?.base ?? null,
      tailoredFitScore: fitComparison?.tailored ?? null,
      fitScoreSource: fitComparison?.source ?? null,
      templateId: selectedTemplateId,
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
    upsertApplication(app);
    // Edits are now tracked in the application record and an artifact is saved to
    // disk — clear the recovery draft AND mark the editor clean so the before-unload
    // guard stops warning. A later edit re-flips `dirty` and re-arms the guard.
    clearAutosaveDraft();
    markResumeClean();
    setTexStatus(`Applied — saved "${existing?.title || app.title}" to Applications (${usedBase ? "original" : "tailored"} resume).`);
    setActiveOutputTab("applications");
    setExpandedApplicationId(existing?.id ?? app.id);
    void saveAppliedResumeArtifacts(existing?.id ?? app.id, existing?.title || app.title);
  }

  // Apply button handler: runs the layered duplicate scan first (warn / confirm
  // as needed — see findDuplicatesForTarget), then either commits immediately
  // (no download dialog) or shows the pre-apply dialog for format/base choice.
  async function handleApply() {
    if (!jobUrl.trim() && !jobDescription.trim()) return;
    // Reset before evaluating so a prior call's stale target can never leak
    // into an unrelated apply. The dialogs, acknowledgment, and merge-target
    // decision live in useDuplicateGuard; commitApply consumes the ref.
    applyMergeTargetRef.current = null;
    const resolution = await resolveApplyDuplicate();
    if (!resolution.proceed) return;
    applyMergeTargetRef.current = resolution.mergeTargetId;

    if (!canExportResume) {
      commitApply();
      return;
    }
    const existing = findForTarget(jobUrl, jobDescription);
    const draft = makeApplicationDraft(jobUrl, jobDescription, currentJobTracking());
    setApplyDownloadPrompt({ label: existing?.title || draft.title });
  }

  function handleApplyDownloadPick(format: ExportFormat, makeDefault: boolean, fileBaseName: string) {
    if (makeDefault) {
      saveDefaultExportFormat(format);
      setDefaultExportFormat(format);
    }
    setApplyDownloadPrompt(null);
    commitApply();
    const base = fileBaseName || undefined;
    if (format === "pdf-latex") void handleDownloadLatexPdf(base);
    else if (format === "pdf-clean") handlePrintResume(base);
    else handleDownloadTex(base);
  }

  function handleApplyOnly() {
    setApplyDownloadPrompt(null);
    commitApply();
  }

  return {
    applyMergeTargetRef,
    applyDownloadPrompt,
    setApplyDownloadPrompt,
    defaultExportFormat,
    handleApply,
    handleApplyDownloadPick,
    handleApplyOnly
  };
}
