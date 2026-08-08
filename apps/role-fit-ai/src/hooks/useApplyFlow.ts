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
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { makeApplicationDraft, type Application, type ApplicationStatus } from "./useApplications";
import type { ApplyDuplicateResolution } from "./useDuplicateGuard";
import type { ExtractedJobTracking } from "../lib/jobExtract";
import { canonicalizeAiUsageStageKeys, type StageAiUsage } from "../lib/aiUsage";
import type { PolishedResume } from "../resumeEngine";
import type { OutputTab } from "../sections/shared";
import { normalizeDocumentSnapshot } from "../lib/applicationDocuments";
import type { DocumentUpload } from "../lib/applicationDocumentRequests";
import { dedupeSourceUrls } from "../lib/jobIdentity";
import { runApplyPdfExports } from "../lib/applyPdfExports";
import type { QuickFitSnapshot } from "../../shared/quickFitContract.ts";
import type { FinalCheckResult } from "../../shared/finalCheckContract.ts";

// Which of the offered PDFs the user kept checked in the download dialog, and
// the base name (extension excluded) each one carries. Owned here with the rest
// of the Apply contract; the dialog imports both. The dialog seeds the cover
// letter's name from the resume's so the pair matches, then lets the user edit
// either — so by the time they arrive here each name is already final.
export type ApplyDownloadPicks = { resume: boolean; coverLetter: boolean };
export type ApplyDownloadNames = { resume: string; coverLetter: string };

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
  initialFitSnapshot: QuickFitSnapshot | null;
  finalCheckSnapshot: FinalCheckResult | null;
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
  // Whether each PDF can actually be TYPESET, which is stricter than the export
  // rail's enabled-state: the engine needs the structured model, so a text-only
  // polish result must not put a resume checkbox in the download prompt.
  canExportResumePdf: boolean;
  canExportCoverLetter: boolean;
  // Both resolve false when the export fails; the Apply flow owns the message
  // because each editor's own status surface is no longer on screen by then.
  handleDownloadPdf: (overrideBase?: string) => Promise<boolean>;
  handleDownloadCoverLetterPdf: (overrideBase?: string) => Promise<boolean>;
  getResumeArtifacts: () => Promise<DocumentUpload | null>;
  getCoverLetterArtifacts: () => Promise<DocumentUpload | null>;
  resumeDocumentVersion: string;
  coverLetterDocumentVersion: string;
  onResumeSaved: () => void;
  onCoverLetterSaved: () => void;
  // Accepts an updater so a late failure can APPEND to the status commitApply
  // already set, instead of erasing an artifact-save warning the user needs.
  setApplyStatus: Dispatch<SetStateAction<string>>;
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
  initialFitSnapshot,
  finalCheckSnapshot,
  pipelineAiUsage,
  applications,
  linkedApplicationId,
  findForTarget,
  persistAppliedApplication,
  saveApplicationDocument,
  linkApplication,
  currentJobTracking,
  resolveApplyDuplicate,
  canExportResumePdf,
  canExportCoverLetter,
  handleDownloadPdf,
  handleDownloadCoverLetterPdf,
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
  // Post-Apply download prompt: holds the just-applied role's label and which
  // included materials this Apply can actually export, so the dialog offers a
  // cover-letter PDF whenever the letter is part of the application.
  const [applyDownloadPrompt, setApplyDownloadPrompt] = useState<{
    label: string;
    canDownloadResume: boolean;
    canDownloadCoverLetter: boolean;
  } | null>(null);
  const [isResolvingApply, setIsResolvingApply] = useState(false);
  const [isCommittingApply, setIsCommittingApply] = useState(false);
  const [isDownloadingApplyPdfs, setIsDownloadingApplyPdfs] = useState(false);
  const [applySaveError, setApplySaveError] = useState("");
  const applyResolutionInFlightRef = useRef(false);
  const applyCommitInFlightRef = useRef(false);
  const applyDownloadInFlightRef = useRef(false);
  const isApplying = isResolvingApply || isCommittingApply || isDownloadingApplyPdfs;
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
    setIsCommittingApply(true);
    setApplySaveError("");
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
    const aiUsage: Record<string, StageAiUsage> = canonicalizeAiUsageStageKeys(existing?.aiUsage);
    aiUsage["job-analysis"] = pipelineAiUsage["job-analysis"] ?? { source: "none" };
    if (materialSelection.resume) {
      aiUsage["resume-polish"] = pipelineAiUsage["resume-polish"] ?? { source: "none" };
      if (pipelineAiUsage["final-check"]) {
        aiUsage["final-check"] = pipelineAiUsage["final-check"];
      } else {
        delete aiUsage["final-check"];
      }
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
            initialFit: initialFitSnapshot ?? undefined,
            finalCheck: finalCheckSnapshot ?? undefined,
            resumeUsed: usedBase ? ("base" as const) : ("tailored" as const),
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
      setIsCommittingApply(false);
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
      setIsCommittingApply(false);
    }
  }

  // Apply button handler: runs the layered duplicate scan first (warn / confirm
  // as needed — see findDuplicatesForTarget), then either commits immediately
  // (no download dialog) or shows the pre-apply dialog for the file name.
  async function handleApply() {
    if (
      applyResolutionInFlightRef.current ||
      applyCommitInFlightRef.current ||
      applyDownloadInFlightRef.current
    ) return;
    if (!canApply) {
      setApplyStatus(applyBlocker || "Finish preparing this application before applying.");
      return;
    }
    applyResolutionInFlightRef.current = true;
    setIsResolvingApply(true);
    try {
      setApplyStatus("");
      applyMaterialSelectionRef.current = {
        ...currentMaterialSelectionRef.current
      };
      // Reset before evaluating so a prior call's stale target can never leak
      // into an unrelated apply. The dialogs, acknowledgment, and merge-target
      // decision live in useDuplicateGuard; commitApply consumes the ref.
      applyMergeTargetRef.current = null;
      let resolution: ApplyDuplicateResolution;
      try {
        resolution = await resolveApplyDuplicate();
      } catch {
        applyMaterialSelectionRef.current = null;
        applyMergeTargetRef.current = null;
        setApplyStatus("Duplicate checking failed, so the application was not saved. Retry Apply.");
        return;
      }
      if (!resolution.proceed) {
        applyMaterialSelectionRef.current = null;
        return;
      }
      applyMergeTargetRef.current = resolution.mergeTargetId;

      const canDownloadResume = applyMaterialSelectionRef.current.resume && canExportResumePdf;
      const canDownloadCoverLetter =
        applyMaterialSelectionRef.current.coverLetter && canExportCoverLetter;
      if (!canDownloadResume && !canDownloadCoverLetter) {
        await commitApply();
        return;
      }
      const existing = findForTarget(jobUrl, preparedJobDescription);
      const draft = makeApplicationDraft(jobUrl, preparedJobDescription, currentJobTracking());
      setApplySaveError("");
      setApplyDownloadPrompt({
        label: existing?.title || draft.title,
        canDownloadResume,
        canDownloadCoverLetter
      });
    } finally {
      applyResolutionInFlightRef.current = false;
      setIsResolvingApply(false);
    }
  }

  // Downloads run sequentially: two near-simultaneous programmatic downloads
  // trip the browser's multiple-download prompt, and a failed second render
  // must not look like the first one failed. A failed export never undoes the
  // apply — it only appends to the status, because the application and its
  // saved artifacts are already committed by this point.
  async function handleApplyDownloadPick(names: ApplyDownloadNames, picks: ApplyDownloadPicks) {
    if (
      applyResolutionInFlightRef.current ||
      applyDownloadInFlightRef.current ||
      applyCommitInFlightRef.current
    ) return;
    applyDownloadInFlightRef.current = true;
    setIsDownloadingApplyPdfs(true);
    const label = applyDownloadPrompt?.label ?? "";
    try {
      if (!(await commitApply())) return;
      const exportResume = async () => await handleDownloadPdf(names.resume || undefined);
      const exportCoverLetter = async () =>
        await handleDownloadCoverLetterPdf(names.coverLetter || undefined);
      const failed = await runApplyPdfExports({
        resume: picks.resume ? exportResume : undefined,
        coverLetter: picks.coverLetter ? exportCoverLetter : undefined
      });
      if (failed.length) {
        const detail =
          `The ${failed.join(" and ")} PDF${failed.length > 1 ? "s" : ""} could not be exported.` +
          ` Retry from ${failed.length > 1 ? "each" : "that"} document's own export menu.`;
        // commitApply has already reported the apply and any artifact-save
        // problem; keep that and add this rather than replacing it.
        setApplyStatus((current) =>
          current ? `${current} ${detail}` : `Applied${label ? ` "${label}"` : ""}. ${detail}`
        );
      }
      // Keep the modal mounted and busy until every selected attempt settles.
      // It is the lock that prevents edits between the saved artifact snapshot
      // and a later sequential export. A failed commit returns above and keeps
      // the same prompt open for retry.
      setApplyDownloadPrompt(null);
    } finally {
      applyDownloadInFlightRef.current = false;
      setIsDownloadingApplyPdfs(false);
    }
  }

  async function handleApplyOnly() {
    if (
      applyResolutionInFlightRef.current ||
      applyCommitInFlightRef.current ||
      applyDownloadInFlightRef.current
    ) return;
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
