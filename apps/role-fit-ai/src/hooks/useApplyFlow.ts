/**
 * useApplyFlow — the Apply flow, extracted from App.tsx: the download-prompt
 * state, commitApply, handleApply, handleApplyDownloadPick, handleApplyOnly,
 * and saveAppliedDocumentArtifacts.
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
import { makeApplicationDraft, type Application, type ApplicationStatus } from "./useApplications";
import type { ApplyDuplicateResolution } from "./useDuplicateGuard";
import type { ExtractedJobTracking } from "../lib/jobExtract";
import type { StageAiUsage } from "../lib/aiUsage";
import type { PolishedResume } from "../resumeEngine";
import type { FitComparison, OutputTab } from "../sections/shared";
import { normalizeDocumentSnapshot } from "../lib/applicationDocuments";
import type { DocumentUpload } from "../lib/applicationDocumentRequests";
import { dedupeSourceUrls } from "../lib/jobIdentity";

type UseApplyFlowArgs = {
  canApply: boolean;
  applyBlocker: string;
  includeResume: boolean;
  includeCoverLetter: boolean;
  jobUrl: string;
  preparedJobDescription: string;
  jobRawText: string;
  result: PolishedResume | null;
  currentResumeText: string;
  headlineScore: number | null;
  fitComparison: FitComparison | null;
  pipelineAiUsage: Record<string, StageAiUsage>;
  applications: Application[];
  linkedApplicationId: string | null;
  findForTarget: (url: string, desc: string) => Application | undefined;
  persistAppliedApplication: (app: Application) => Promise<boolean>;
  saveApplicationDocument: (
    id: string,
    kind: "resume" | "cover",
    upload: DocumentUpload
  ) => Promise<{ ok: boolean; error?: string }>;
  // Remembers which application this session is now working against, so the
  // per-document "Update application" actions save into it instead of creating
  // a second record.
  linkApplication: (id: string | null) => void;
  currentJobTracking: () => ExtractedJobTracking;
  resolveApplyDuplicate: () => Promise<ApplyDuplicateResolution>;
  canExportResume: boolean;
  handleDownloadPdf: (overrideBase?: string) => void | Promise<void>;
  getResumeArtifacts: () => Promise<DocumentUpload | null>;
  getCoverLetterArtifacts: () => Promise<DocumentUpload | null>;
  resumeDocumentVersion: string;
  coverLetterDocumentVersion: string;
  onResumeSaved: () => void;
  onCoverLetterSaved: () => void;
  setApplyStatus: (value: string) => void;
  setActiveOutputTab: (tab: OutputTab) => void;
  setExpandedApplicationId: (id: string | null) => void;
};

export function useApplyFlow({
  canApply,
  applyBlocker,
  includeResume,
  includeCoverLetter,
  jobUrl,
  preparedJobDescription,
  jobRawText,
  result,
  currentResumeText,
  headlineScore,
  fitComparison,
  pipelineAiUsage,
  applications,
  linkedApplicationId,
  findForTarget,
  persistAppliedApplication,
  saveApplicationDocument,
  linkApplication,
  currentJobTracking,
  resolveApplyDuplicate,
  canExportResume,
  handleDownloadPdf,
  getResumeArtifacts,
  getCoverLetterArtifacts,
  resumeDocumentVersion,
  coverLetterDocumentVersion,
  onResumeSaved,
  onCoverLetterSaved,
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
  const applyMaterialSelectionRef = useRef<{
    resume: boolean;
    coverLetter: boolean;
  } | null>(null);
  const currentMaterialSelectionRef = useRef({
    resume: includeResume,
    coverLetter: includeCoverLetter
  });
  currentMaterialSelectionRef.current = {
    resume: includeResume,
    coverLetter: includeCoverLetter
  };
  // Post-Apply download prompt: holds the just-applied role's label while open.
  const [applyDownloadPrompt, setApplyDownloadPrompt] = useState<{
    label: string;
  } | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applySaveError, setApplySaveError] = useState("");
  const applyCommitInFlightRef = useRef(false);
  const latestDocumentVersionsRef = useRef({
    resume: resumeDocumentVersion,
    coverLetter: coverLetterDocumentVersion
  });
  latestDocumentVersionsRef.current = {
    resume: resumeDocumentVersion,
    coverLetter: coverLetterDocumentVersion
  };

  // Persist only the material selection captured when Apply began. Excluding a
  // slot is deliberately non-destructive on a re-apply: it does not snapshot or
  // update that document, and it never deletes an older tracker artifact.
  async function saveAppliedDocumentArtifacts(
    id: string,
    label: string,
    expectedVersions: { resume: string; coverLetter: string }
  ) {
    const selection = applyMaterialSelectionRef.current ?? currentMaterialSelectionRef.current;
    const resume = selection.resume ? await getResumeArtifacts().catch(() => null) : null;
    const cover = selection.coverLetter ? await getCoverLetterArtifacts().catch(() => null) : null;
    const storedResume = selection.resume
      ? resume
        ? latestDocumentVersionsRef.current.resume === expectedVersions.resume
          ? await saveApplicationDocument(id, "resume", resume)
          : { ok: false, error: "changed before it could be saved; save the current draft again" }
        : { ok: false, error: "No editable resume source is available." }
      : null;
    const currentStoredResume =
      storedResume?.ok &&
      latestDocumentVersionsRef.current.resume !== expectedVersions.resume
        ? {
            ok: false,
            error:
              "changed while saving; the application has the earlier version, so save the current draft again"
          }
        : storedResume;
    const storedCover = selection.coverLetter
      ? cover
        ? latestDocumentVersionsRef.current.coverLetter ===
          expectedVersions.coverLetter
          ? await saveApplicationDocument(id, "cover", cover)
          : { ok: false, error: "changed before it could be saved; save the current draft again" }
        : { ok: false, error: "No editable cover-letter source is available." }
      : null;
    const currentStoredCover =
      storedCover?.ok &&
      latestDocumentVersionsRef.current.coverLetter !==
        expectedVersions.coverLetter
        ? {
            ok: false,
            error:
              "changed while saving; the application has the earlier version, so save the current draft again"
          }
        : storedCover;
    const failures = [
      ...(selection.resume && !currentStoredResume?.ok
        ? [`resume: ${currentStoredResume?.error ?? "save failed"}`]
        : []),
      ...(selection.coverLetter && !currentStoredCover?.ok
        ? [`cover letter: ${currentStoredCover?.error ?? "save failed"}`]
        : [])
    ];
    if (failures.length) {
      setApplyStatus(`Applied "${label}", but ${failures.join("; ")}. Retry from the document's Save menu.`);
      return {
        resumeSaved: Boolean(currentStoredResume?.ok),
        coverSaved: Boolean(currentStoredCover?.ok)
      };
    }
    const savedLabels = [
      ...(currentStoredResume?.ok ? ["resume"] : []),
      ...(currentStoredCover?.ok ? ["cover letter"] : [])
    ];
    setApplyStatus(
      savedLabels.length
        ? `Applied "${label}". Saved ${savedLabels.join(" and ")}.`
        : `Applied "${label}". No documents were included in this Apply.`
    );
    return {
      resumeSaved: Boolean(currentStoredResume?.ok),
      coverSaved: Boolean(currentStoredCover?.ok)
    };
  }

  // The actual apply: save the application, snapshot artifacts, update UI.
  // Called directly when the user has opted to skip the download dialog, or
  // from the dialog's Download / Apply-only callbacks.
  async function commitApply(): Promise<boolean> {
    if (!canApply) {
      setApplyStatus(applyBlocker || "Finish preparing this application before applying.");
      return false;
    }
    if (applyCommitInFlightRef.current) return false;
    applyCommitInFlightRef.current = true;
    // The document sources and versions belong to the user's final Apply
    // confirmation. If either editor changes while the tracker write is in
    // flight, the older artifact must not be saved or mark the newer draft
    // clean.
    const expectedDocumentVersions = { ...latestDocumentVersionsRef.current };
    setIsApplying(true);
    setApplySaveError("");
    const sr = result?.strictReview;
    const hasStructuredSuggestions = Boolean(result?.suggestedChanges?.length);
    const acceptedStructuredSuggestions =
      hasStructuredSuggestions &&
      Boolean(result?.polishedText) &&
      normalizeDocumentSnapshot(currentResumeText) !== normalizeDocumentSnapshot(result?.polishedText ?? "");
    const usedBase = !result?.polishedText || (hasStructuredSuggestions && !acceptedStructuredSuggestions);
    const materialSelection = applyMaterialSelectionRef.current ?? currentMaterialSelectionRef.current;
    // A duplicate scan in handleApply may have already identified which record
    // this apply should merge into (exact/high confidence, user-confirmed when
    // not "interested"). Prefer that over the exact-only findForTarget lookup;
    // Retain the target until persistence succeeds so a recoverable retry keeps
    // the user's confirmed merge decision; cancel and success both clear it.
    const existing =
      (applyMergeTargetRef.current ? applications.find((a) => a.id === applyMergeTargetRef.current) : undefined) ??
      (linkedApplicationId ? applications.find((application) => application.id === linkedApplicationId) : undefined) ??
      findForTarget(jobUrl, preparedJobDescription);
    const now = new Date().toISOString();
    const status: ApplicationStatus =
      existing && existing.status && existing.status !== "interested" ? existing.status : "applied";
    const tracking = currentJobTracking();
    const draft = makeApplicationDraft(jobUrl, preparedJobDescription, tracking);
    const aiUsage: Record<string, StageAiUsage> = {
      ...(existing?.aiUsage ?? {}),
      distill: pipelineAiUsage.distill ?? { source: "none" }
    };
    if (materialSelection.resume) {
      aiUsage.tailor = pipelineAiUsage.tailor ?? { source: "none" };
      aiUsage.review = pipelineAiUsage.review ?? { source: "none" };
    }
    if (materialSelection.coverLetter) {
      if (pipelineAiUsage.cover) aiUsage.cover = pipelineAiUsage.cover;
      else delete aiUsage.cover;
    }
    const nextJobUrl = jobUrl.trim();
    const priorJobUrl = existing?.jobUrl.trim() ?? "";
    const sourceUrls = dedupeSourceUrls(
      [
        ...(existing?.sourceUrls ?? []),
        ...(priorJobUrl && priorJobUrl !== nextJobUrl
          ? [{ url: priorJobUrl, source: existing?.source, addedAt: now }]
          : [])
      ],
      nextJobUrl,
      now
    );
    const app: Application = {
      ...(existing ?? {}),
      ...draft,
      id: existing?.id ?? draft.id,
      title:
        [tracking.role || tracking.title, tracking.company]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
          .join(" at ") || draft.title,
      company: String(tracking.company ?? "").trim(),
      role: String(tracking.role || tracking.title || "").trim(),
      source: draft.source,
      jobUrl: nextJobUrl,
      jobDescription: preparedJobDescription.trim(),
      // Keep the captured source even when a no-AI import initially produced
      // identical prepared text. Later manual edits must not rewrite View
      // source or make Prepare again operate on an edited brief.
      rawJobDescription: jobRawText.trim(),
      roleDescription: String(tracking.roleDescription ?? "").trim(),
      location: String(tracking.location ?? "").trim(),
      jobType: String(tracking.jobType ?? "").trim(),
      workAuth: String(tracking.workAuth ?? "").trim(),
      salaryMin: tracking.salaryMin ?? null,
      salaryMax: tracking.salaryMax ?? null,
      salaryCurrency: String(tracking.salaryCurrency ?? "").trim(),
      salaryPeriod: tracking.salaryPeriod || undefined,
      sourceUrls: sourceUrls.length ? sourceUrls : undefined,
      status,
      appliedAt: existing?.appliedAt ?? now,
      aiUsage,
      ...(materialSelection.resume
        ? {
            fitScore: headlineScore,
            baseFitScore: fitComparison?.base ?? null,
            tailoredFitScore: fitComparison?.tailored ?? null,
            fitScoreSource: fitComparison?.source ?? null,
            resumeUsed: usedBase ? ("base" as const) : ("tailored" as const),
            missingRequiredSkills: result?.missingRequiredSkills?.length
              ? result.missingRequiredSkills
              : undefined,
            ...(sr
              ? {
                  review: {
                    verdict: sr.verdict,
                    verdictReason: sr.verdictReason,
                    riskFlags: sr.riskFlags.map((r) => ({
                      risk: r.risk,
                      suggestion: r.suggestion
                    })),
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
                }
              : existing?.review
                ? { review: existing.review }
                : {})
          }
        : {})
    };
    let saved = false;
    try {
      saved = await persistAppliedApplication(app);
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
    // From here the session has one application of record: later resume or
    // cover-letter saves update THIS row rather than creating a duplicate.
    linkApplication(existing?.id ?? app.id);
    // The application record now exists; the strict source save below decides
    // whether the editor can safely stop advertising recovery.
    const selectedMaterials = [
      ...(materialSelection.resume ? [usedBase ? "original resume" : "tailored resume"] : []),
      ...(materialSelection.coverLetter ? ["cover letter"] : [])
    ];
    setApplyStatus(
      `Applied. Saved "${existing?.title || app.title}" to Applications${
        selectedMaterials.length ? ` with ${selectedMaterials.join(" and ")}` : ""
      }.`
    );
    setActiveOutputTab("applications");
    setExpandedApplicationId(existing?.id ?? app.id);
    try {
      const savedDocuments = await saveAppliedDocumentArtifacts(
        existing?.id ?? app.id,
        existing?.title || app.title,
        expectedDocumentVersions
      );
      // Tracker text is not a reloadable document. Preserve recovery until the
      // corresponding strict editable source has also been committed.
      if (savedDocuments.resumeSaved) onResumeSaved();
      if (savedDocuments.coverSaved) onCoverLetterSaved();
      return true;
    } catch {
      setApplyStatus(
        `Applied "${existing?.title || app.title}", but the included documents could not be saved. Retry from each document's Save menu.`
      );
      return true;
    } finally {
      applyMaterialSelectionRef.current = null;
      applyCommitInFlightRef.current = false;
      setIsApplying(false);
    }
  }

  // Apply button handler: runs the layered duplicate scan first (warn / confirm
  // as needed — see findDuplicatesForTarget), then either commits immediately
  // (no download dialog) or shows the pre-apply dialog for the file name.
  async function handleApply() {
    if (!canApply) {
      setApplyStatus(applyBlocker || "Finish preparing this application before applying.");
      return;
    }
    setApplyStatus("");
    applyMaterialSelectionRef.current = {
      ...currentMaterialSelectionRef.current
    };
    // Reset before evaluating so a prior call's stale target can never leak
    // into an unrelated apply. The dialogs, acknowledgment, and merge-target
    // decision live in useDuplicateGuard; commitApply consumes the ref.
    applyMergeTargetRef.current = null;
    const resolution = await resolveApplyDuplicate();
    if (!resolution.proceed) {
      applyMaterialSelectionRef.current = null;
      return;
    }
    applyMergeTargetRef.current = resolution.mergeTargetId;

    if (!applyMaterialSelectionRef.current.resume || !canExportResume) {
      await commitApply();
      return;
    }
    const existing = findForTarget(jobUrl, preparedJobDescription);
    const draft = makeApplicationDraft(jobUrl, preparedJobDescription, currentJobTracking());
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
    applyMaterialSelectionRef,
    applyDownloadPrompt,
    setApplyDownloadPrompt,
    isApplying,
    applySaveError,
    handleApply,
    handleApplyDownloadPick,
    handleApplyOnly
  };
}
