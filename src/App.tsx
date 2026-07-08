import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  analyzeResumeText,
  type PolishedResume
} from "./resumeEngine";

import { useTemplates } from "./hooks/useTemplates";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useDocStyle } from "./hooks/useDocStyle";
import { useAiSettings } from "./hooks/useAiSettings";
import { useApplicationAnswers } from "./hooks/useApplicationAnswers";
import {
  useApplications,
  missingRequiredSkillsFromApplication,
  type Application,
  type ApplicationStatus
} from "./hooks/useApplications";
import { useResumeAnalysis } from "./hooks/useResumeAnalysis";
import { useResumeEditor } from "./hooks/useResumeEditor";
import { useResumeExport } from "./hooks/useResumeExport";
import { useCoverLetter } from "./hooks/useCoverLetter";
import { useDialog } from "./hooks/useDialog";
import {
  useAutosaveDraft,
  useBeforeUnloadGuard,
  recoverAutosaveDraft,
  clearAutosaveDraft,
  type AutosavedDraft
} from "./hooks/useAutosaveDraft";
import { useTabPresence } from "./hooks/useTabPresence";
import { type PresencePhase } from "./lib/tabPresence";
import { sanitizeFileBase } from "./lib/downloads";
import { buildStageRequestFields, type StageId } from "./lib/aiRequest";
import { useDraggableDock } from "./hooks/useDraggableDock";
import { buildCandidateFactsContext, mergeHonestContext } from "./lib/candidateFacts";
import { extractJobPosting, type ExtractedJobTracking } from "./lib/jobExtract";
import { serializeResumeData } from "./lib/resumeData";
import { defaultTailorModes, type TailorMode } from "./lib/tailorScope";
import type { StageAiUsage } from "./lib/aiUsage";
import { useDuplicateGuard } from "./hooks/useDuplicateGuard";
import { useJobIntake, type ImportedJobSnapshot } from "./hooks/useJobIntake";
import { usePolishPipeline } from "./hooks/usePolishPipeline";
import { useWorkspaceResume } from "./hooks/useWorkspaceResume";
import { useApplyFlow } from "./hooks/useApplyFlow";

import { AiMenu } from "./sections/AiMenu";
import { ProviderSection } from "./sections/ProviderSection";
import { Masthead } from "./sections/Masthead";
import { JobMenu } from "./sections/JobMenu";
import { PolishMenu } from "./sections/PolishMenu";
import { PolishProgress, DistillProgress, TaskProgress } from "./sections/PolishProgress";
import { SessionsRail } from "./sections/SessionsRail";
import { ResumeMenu } from "./sections/ResumeMenu";
import { StudioPane } from "./sections/StudioPane";
import { ExportMenu } from "./sections/ExportRail";
import { ApplyDownloadDialog } from "./sections/ApplyDownloadDialog";
const PreviewOverlay = lazy(() => import("./sections/PreviewOverlay"));
import { ApplicationModal } from "./sections/ApplicationModal";
import { ResumePrintLayer } from "./sections/ResumePrintLayer";
import { ViewportGate } from "./sections/ViewportGate";
import { ResumeTab } from "./sections/tabs/ResumeTab";
import { MaterialsTab } from "./sections/tabs/MaterialsTab";
import { TrackerTab } from "./sections/tabs/TrackerTab";
import type { TrackerView } from "./sections/tabs/TrackerTab";
import { AnalyticsTab } from "./sections/tabs/AnalyticsTab";
import type { OutputTab, OutputTabDescriptor } from "./sections/shared";

// The AI menu's three provider sections, in pipeline order.
const STAGE_SECTIONS: { id: StageId; title: string }[] = [
  { id: "distill", title: "Distill" },
  { id: "tailor", title: "Tailor" },
  { id: "review", title: "Review" }
];

// ============ Types ============

function definedTracking(tracking: ExtractedJobTracking) {
  return Object.fromEntries(
    Object.entries(tracking).filter(([, value]) => value !== undefined && value !== "" && value !== null)
  ) as ExtractedJobTracking;
}

// ============ App ============

function App() {
  // ----- Dialog system -----
  const { confirm } = useDialog();

  // Draggable progress dock (Tailor/Review/Distill/Cover/Answers task cards) —
  // lets the user drag the fixed-position stack out of the way of whatever
  // studio content it would otherwise sit over.
  const dock = useDraggableDock();

  // Shared helper for the 6 identical "replace editor" confirms.
  const confirmReplaceEditor = () =>
    confirm({
      title: "Replace resume?",
      message: "Replace the resume in the editor? Unsaved edits will be lost.",
      confirmLabel: "Replace"
    });

  // ----- State -----
  const [jobDescription, setJobDescription] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [importedJob, setImportedJob] = useState<ImportedJobSnapshot | null>(null);
  // Per-stage AI usage snapshot (distill/tailor/review/cover), captured across
  // the pipeline and snapshotted onto the Application at Apply time. Keys are
  // deleted (not set to "none") when a fresh polish run starts, so a stale
  // provider attribution can never linger from a prior run into the new one.
  const [pipelineAiUsage, setPipelineAiUsage] = useState<Record<string, StageAiUsage>>({});
  // Pre-distill raw posting text, kept ONLY when it differs from the working
  // jobDescription (the distilled brief) — mirrors Application.rawJobDescription
  // and feeds duplicate detection's requisition-id/fingerprint tiers, which work
  // best against the raw posting rather than the compact tailoring scaffold.
  const [jobRawText, setJobRawText] = useState("");
  // Starts empty; the mount effect (loadWorkspace) auto-loads a workspace
  // base-resume when one exists, otherwise the editor stays blank.
  const [resumeText, setResumeText] = useState("");
  const [fileName, setFileName] = useState("");

  const [result, setResult] = useState<PolishedResume | null>(null);
  const [fileError, setFileError] = useState("");
  const [fileStatus, setFileStatus] = useState("");
  const [linkStatus, setLinkStatus] = useState("");
  // Surfaces polish-flow feedback the user otherwise never sees: AI-failure
  // reasons (the local fallback still renders) and the pre-flight guards
  // ("load a resume", "select a section to tailor"). Rendered in an aria-live
  // banner below the masthead.
  const [polishStatus, setPolishStatus] = useState("");
  // Holds the imported job's text when an extension import arrives with the "Tailor
  // automatically" toggle on, so the app jumps straight to polish once a resume is
  // ready (no manual click). Scoping to the specific job — not a bare flag — means a
  // later import/paste/edit, or a toggle-OFF import, can never trigger a surprise
  // polish against the wrong posting.
  const [autoTailorJob, setAutoTailorJob] = useState<string | null>(null);
  // Resume export (print/LaTeX/preview) state + handlers live in
  // useResumeExport; texStatus stays here because non-export handlers write it too.
  const [texStatus, setTexStatus] = useState("");
  // All auto-saved AI preferences (primary provider/model, the reviewer-override
  // audit* fields, and the polish prefs that persist with them) plus the
  // debounced localStorage write live in useAiSettings. API keys are not
  // persisted. Destructured into the same names the handlers + JSX already use.
  const ai = useAiSettings();
  const {
    stages,
    updateStage,
    changeStageProvider,
    sectionOpen,
    toggleSection,
    copyStage,
    honestContext,
    setHonestContext,
    polishStages,
    setPolishStages,
    citizenshipStatus,
    setCitizenshipStatus,
    legallyAuthorizedToWork,
    setLegallyAuthorizedToWork,
    requiresSponsorship,
    setRequiresSponsorship,
    customInstructions,
    setCustomInstructions
  } = ai;
  const candidateFactsContext = buildCandidateFactsContext({ citizenshipStatus, legallyAuthorizedToWork, requiresSponsorship });
  const requestHonestContext = mergeHonestContext(honestContext, candidateFactsContext);
  // Distill runs on its own concrete provider config (synced to other stages via
  // the copy buttons, not a live link). Shared by every distill entry point
  // (link, paste, extension import, and their retries).
  const distillRequestFields = () => buildStageRequestFields(stages.distill);
  const [includeCoverLetter, setIncludeCoverLetter] = useState(false);
  const [activeOutputTab, setActiveOutputTab] = useState<OutputTab>("resume");
  const [pipelineFilter, setPipelineFilter] = useState<"all" | ApplicationStatus>("all");
  const [trackerView, setTrackerView] = useState<TrackerView>("table");
  const [expandedApplicationId, setExpandedApplicationId] = useState<string | null>(null);
  // Saved-application resume PDF preview ({url,name} → open; null → closed).
  const [resumePreview, setResumePreview] = useState<{ url: string; name: string } | null>(null);
  const [isApplicationModalOpen, setIsApplicationModalOpen] = useState(false);
  // null → the modal is in "add" mode; an id → it edits that application.
  const [modalApplicationId, setModalApplicationId] = useState<string | null>(null);
  // Controlled open state for the Options (PolishMenu) popover — lets the
  // "Add evidence" handler open it programmatically without a new popover system.
  const [polishMenuOpen, setPolishMenuOpen] = useState(false);
  // Ref for the honest-context textarea inside the Options menu — focused after
  // the menu is opened by handleAddHonestContext so the user can type immediately.
  const honestContextTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Autosave draft recovery: on mount, check whether a draft was saved that
  // the user may want to restore. Null = no draft; non-null = prompt visible.
  const [pendingAutosaveDraft, setPendingAutosaveDraft] = useState<AutosavedDraft | null>(null);
  // Track whether the JD has changed since the last polish result. When true,
  // show a quiet "review is stale" notice in the ReviewRail.
  const [reviewStale, setReviewStale] = useState(false);

  // ----- Hooks -----
  const {
    templates,
    selectedTemplateId,
    setSelectedTemplateId,
    tectonic,
    templatesError,
    renderTex,
    renderPdf,
    renderPdfFromSchema,
    renderTexFromSchema
  } = useTemplates();

  // ----- Structured resume editor -----
  // editedResume is the canonical editable model; it seeds at discrete events
  // (a fresh polish, a loaded base resume, a restored snapshot). `currentResumeText`
  // is its serialization (falling back to the raw polish output) — the bridge every
  // text consumer (scoring, diff, exports, print, application snapshots) reads.
  const {
    editedResume,
    dirty: resumeEdited,
    // Free-form hand-edits only (NOT accepting/undoing a reviewed suggestion).
    // Gates AI fit provenance so applying the AI's own suggestions keeps the
    // verdict "AI-judged"; arbitrary typing downgrades it to "Estimated".
    manualEdited: resumeManuallyEdited,
    serializedResume,
    seed: seedResumeEditor,
    seedData: seedResumeData,
    markClean: markResumeClean,
    actions: resumeEditorActions
  } = useResumeEditor();
  const currentResumeText = serializedResume || result?.polishedText || "";
  // Per-section tailoring choice. Off is the implicit default (absent key); the
  // map stores only "tailor"/"include" so the three states are mutually exclusive
  // by construction.
  const [tailorModes, setTailorModes] = useState<Record<string, TailorMode>>({});
  // Stable identity so the memoized SectionEditor isn't re-rendered for every
  // section on each App render (setTailorModes is itself stable).
  const setTailorMode = useCallback((sectionId: string, mode: TailorMode) => {
    setTailorModes((current) => {
      const next = { ...current };
      if (mode === "off") delete next[sectionId];
      else next[sectionId] = mode;
      return next;
    });
  }, []);
  // User typography for the HTML resume page (Format menu): persisted CSS vars
  // applied to the editor and the print mirror.
  const docStyle = useDocStyle();

  // Distill the job once per (description, url, import) instead of on every
  // render. The full extractJobPosting parser is ~1500 LOC; running it in the
  // component body (the cover letter, materialsJobTarget, presence label, and the
  // apply/export callers below) re-parsed the JD on every keystroke-driven
  // re-render. Memoizing matches the debounce discipline the scoring path already
  // uses, with no behavior change.
  const jobTracking = useMemo((): ExtractedJobTracking => {
    const imported =
      importedJob &&
      importedJob.url === jobUrl.trim() &&
      importedJob.tailoringText === jobDescription.trim()
        ? importedJob.tracking
        : null;
    // The import (AI or deterministic) is the authoritative distill output. Don't
    // re-parse the compact scaffold and merge — that would let a stray number or
    // label in a bullet resurrect a field the distiller deliberately left empty
    // (e.g. a $5M budget figure becoming the salary). Only re-parse when there is
    // no matching import (user typed a raw JD straight into the box).
    return imported
      ? definedTracking(imported)
      : definedTracking(extractJobPosting(jobDescription, { url: jobUrl }).tracking);
  }, [jobDescription, jobUrl, importedJob]);

  // Derive a short job-label for the autosave + cross-tab presence context (role
  // + company only — never the full JD body). Uses the shared `jobTracking` so
  // the label matches the AI-distilled role/company shown elsewhere in the app,
  // rather than a weaker deterministic re-parse of the raw text.
  const _autosaveJobLabel = useMemo(() => {
    if (!jobDescription.trim()) return "";
    const parts = [jobTracking.role, jobTracking.company].filter(Boolean);
    return parts.join(" · ");
  }, [jobDescription, jobTracking]);

  // Debounced autosave to localStorage whenever the editor has unsaved edits.
  // getJobKeyHash is a lazy closure: duplicateGuard is declared later in this
  // component and is only read inside the debounced write, after mount.
  useAutosaveDraft({
    editedResume,
    dirty: resumeEdited,
    jobLabel: _autosaveJobLabel,
    pipelineAiUsage,
    jobRawText,
    getJobKeyHash: () => duplicateGuard.currentJobKeyHash()
  });

  const {
    applications,
    isLoading: isApplicationsLoading,
    error: applicationsError,
    upsert: upsertApplication,
    saveApplication,
    patchApplication,
    updateStatus: updateApplicationStatus,
    updateNotes: updateApplicationNotes,
    updateField: updateApplicationField,
    remove: removeApplication,
    storagePath: applicationsPath,
    findForTarget,
    findDuplicatesForTarget,
    mergeApplications,
    refresh: refreshApplications
  } = useApplications();

  // Duplicate-warning ladder for the current job target (advisory note, the
  // pre-polish blocking gate, and the Apply merge-target resolution) — the
  // acknowledgment state and dialog copy live in the hook. `tracking` is lazy:
  // currentJobTracking is declared later in this component.
  const duplicateGuard = useDuplicateGuard({
    jobUrl,
    jobDescription,
    jobRawText,
    tracking: () => currentJobTracking(),
    findDuplicatesForTarget,
    confirm
  });

  const {
    answersResult,
    answersStatus,
    isGeneratingAnswers,
    handleGenerateAnswers,
    handleSaveAnswers,
    answersProgress,
    dismissAnswersProgress,
    retryAnswers
  } = useApplicationAnswers({
    resumeText,
    jobDescription,
    jobUrl,
    honestContext: requestHonestContext,
    customInstructions,
    aiRequest: stages.tailor,
    upsertApplication,
    findForTarget
  });


  // On-demand cover letter (no full polish required). Generates from the CURRENT
  // resume; the polish path also feeds this state (see runTailorStage) so the
  // Materials view, Copy, and save-to-application all read one source.
  const {
    coverLetterText,
    applyCoverLetter,
    coverStatus,
    isGeneratingCover,
    handleGenerateCoverLetter,
    coverProgress,
    dismissCoverProgress
  } = useCoverLetter({
    currentResumeText,
    jobText: jobDescription,
    honestContext: requestHonestContext,
    customInstructions,
    aiRequest: stages.tailor,
    resumeText,
    onUsage: (usage) => setPipelineAiUsage((prev) => ({ ...prev, cover: usage }))
  });

  // ----- Effects -----
  useEffect(() => {
    void loadWorkspace(true);
    // Check for a recoverable autosaved draft on mount. We surface it AFTER the
    // workspace load so we know whether the user already has a base resume seeded.
    // The draft prompt is shown in ResumeTab; the user clicks to restore or dismiss.
    const draft = recoverAutosaveDraft();
    if (draft) setPendingAutosaveDraft(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the user starts editing, the on-mount restore bar is offering a draft
  // the autosave has since overwritten — dismiss it so it can't advertise (and,
  // on click, reseed) stale text over the fresher edits.
  useEffect(() => {
    if (resumeEdited) setPendingAutosaveDraft(null);
  }, [resumeEdited]);

  const resumeSectionIdsKey = editedResume?.sections.map((section) => section.id).join("|") ?? "";
  useEffect(() => {
    if (!editedResume) {
      setTailorModes({});
      return;
    }
    const validIds = new Set(editedResume.sections.map((section) => section.id));
    setTailorModes((current) => {
      const preserved: Record<string, TailorMode> = {};
      for (const [id, mode] of Object.entries(current)) {
        if (validIds.has(id)) preserved[id] = mode;
      }
      return Object.keys(preserved).length ? preserved : defaultTailorModes(editedResume);
    });
    // Only reset when sections are added/removed/reparsed. Heading/text edits
    // should not wipe the user's explicit scope choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeSectionIdsKey]);

  useEffect(() => {
    if (!applications.length) {
      setExpandedApplicationId(null);
      return;
    }
    if (!expandedApplicationId || !applications.some((app) => app.id === expandedApplicationId)) {
      setExpandedApplicationId(applications[0].id);
    }
  }, [applications, expandedApplicationId]);

  // Stale-review: when the JD changes after a polish, the review describes the
  // old posting. Track whether the text matches what the result was based on.
  // We store the JD text at the time Polish ran, then compare on JD edits.
  const lastPolishedJobRef = useRef<string>("");
  useEffect(() => {
    if (!result) return;
    // result changed (new polish) — record the current JD as "last polished JD".
    lastPolishedJobRef.current = jobDescription;
    setReviewStale(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  useEffect(() => {
    // JD changed after a polish — mark stale if the review has substance.
    if (!result) return;
    const hasReview = Boolean(result.strictReview || result.suggestedChanges?.length);
    if (!hasReview) return;
    setReviewStale(jobDescription !== lastPolishedJobRef.current);
  }, [jobDescription, result]);
  useEffect(() => {
    // Resume FREELY edited after a review completed — mark stale so the user
    // understands why the AI fit numbers are hidden (useResumeAnalysis gates
    // them behind !isEdited). Accepting a reviewed suggestion is not a free edit
    // (the verdict still describes that proposal), so it does not mark stale.
    // Only fires when there is an AI review to flag.
    if (!result?.strictReview) return;
    if (resumeManuallyEdited) setReviewStale(true);
    // We deliberately do NOT reset on !resumeManuallyEdited — the stale flag
    // should clear only when a new polish result lands (the result effect above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeManuallyEdited]);

  // ----- Derived (memos) -----
  // The job link has its own field now: the description textarea holds the text
  // we tailor against, while `jobUrl` is optional metadata saved with the
  // application for pipeline tracking only — it is never sent to the model.
  const canPolish = useMemo(() => {
    return Boolean(
      editedResume &&
        Object.values(tailorModes).some((mode) => mode === "tailor") &&
        jobDescription.trim().length > 40
    );
  }, [editedResume, jobDescription, tailorModes]);

  // Debounce the live inputs so per-keystroke synchronous scoring doesn't jank
  // typing on large resumes. The polished `result` stays immediate.
  const debouncedResumeText = useDebouncedValue(resumeText);
  const debouncedJobDescription = useDebouncedValue(jobDescription);
  // The edited resume is debounced before the heavy match/diff/fit recompute so
  // typing in the editor stays smooth (the editor preview itself updates live).
  const debouncedCurrentResumeText = useDebouncedValue(currentResumeText);

  // Every score/diff/match derivation the UI shows is pure (read-only) and lives
  // in useResumeAnalysis, so it stays decoupled from App's setters.
  const {
    resumeDiff,
    fitComparison,
    headlineScore,
    scoreContext,
    fitVerdict,
    jobConstraints,
    resultSourceLabel
  } = useResumeAnalysis({
    resumeText,
    jobDescription,
    debouncedResumeText,
    debouncedJobDescription,
    debouncedCurrentResumeText,
    // Gate AI fit provenance on FREE edits only — accepting the AI's reviewed
    // suggestions keeps the verdict "AI-judged" (it describes that proposal).
    isEdited: resumeManuallyEdited,
    result
  });

  // ----- Derived (non-memo) -----
  const resumeReady = (currentResumeText || resumeText).trim().length > 80;
  const jobReady = jobDescription.trim().length > 40;
  // Quiet target label for the Materials tab plan rail header.
  // Only derived when a job description is present; never invents content.
  const materialsJobTarget =
    jobReady && (jobTracking.role || jobTracking.company)
      ? { role: jobTracking.role, company: jobTracking.company }
      : undefined;
  // Exports work from the structured editor model (the same faithful path as the
  // compile preview), so they unlock as soon as a resume is loaded — not only
  // after an AI polish.
  const canExportResume = Boolean(result || editedResume);
  // Name what is actually blocking Polish; both inputs now live in navbar menus.
  const polishGateHint = canPolish
    ? ""
    : !resumeReady && !jobReady
    ? "Add a resume (Resume menu) and the job description (Job menu) to polish."
    : !jobReady
    ? "Add the job description from the Job menu to polish."
    : !editedResume || !Object.values(tailorModes).some((mode) => mode === "tailor")
    ? "Load a resume and set at least one section to Tailor."
    : "Add more resume text in the Resume menu (a few lines at least).";
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;
  const outputTabs: OutputTabDescriptor[] = [
    { id: "resume", label: "Resume" },
    { id: "materials", label: "Materials" },
    { id: "applications", label: "Applications" },
    { id: "analytics", label: "Analytics" }
  ];

  // ----- Resume export (print / LaTeX / preview) -----
  const {
    coverCopied,
    downloadStatus,
    isDownloadingTex,
    isRenderingLatexPdf,
    isPreviewOpen,
    isPreviewLoading,
    previewError,
    previewPdfUrl,
    resetStatuses: resetExportStatuses,
    handleCopyCoverLetter,
    handlePrintResume,
    handleDownloadTex,
    handleDownloadLatexPdf,
    handlePreview,
    handleClosePreview,
    resumeDownloadName,
    getResumeArtifacts
  } = useResumeExport({
    result,
    editedResume,
    currentResumeText,
    jobUrl,
    // Name downloads after the same company the application is saved with
    // (distilled from the posting), not just a URL guess. Thunk: currentJobTracking
    // is a hoisted declaration, evaluated lazily at save time.
    resolveJobCompany: () => currentJobTracking().company ?? "",
    coverLetterText,
    resumeText,
    selectedTemplateId,
    selectedTemplate,
    renderTex,
    renderPdf,
    renderTexFromSchema,
    renderPdfFromSchema,
    docStyle: docStyle.style,
    tectonic,
    setTexStatus
  });

  // ----- Job intake (distill/import flows) -----
  // Extract-from-link, Distill-paste, the browser-extension inbox import (both
  // AI-off and AI-distill paths), and each entry point's Retry — extracted to
  // src/hooks/useJobIntake.ts. isExtractingLink/distillProgress/
  // distillProgressVisible/distillRetry are owned by the hook; App only reads
  // them below for render + the presence phase + the before-unload guard.
  const {
    isExtractingLink,
    distillProgress,
    distillProgressVisible,
    setDistillProgressVisible,
    distillRetry,
    handleManualJobDescriptionChange,
    handleExtractFromLink,
    handleDistillPaste
  } = useJobIntake({
    jobUrl,
    setJobUrl,
    jobDescription,
    setJobDescription,
    setImportedJob,
    setResult,
    applyCoverLetter,
    setPipelineAiUsage,
    setJobRawText,
    setAutoTailorJob,
    setPolishStatus,
    setLinkStatus,
    duplicateWarnNote: duplicateGuard.duplicateWarnNote,
    distillRequestFields,
    tailorModes,
    editedResume
  });

  // ----- Polish pipeline (Tailor -> Review) -----
  // buildPolishContext, the reviewer-attribution + merge helpers, the two
  // stage runners, handlePolish, retryStage, and Stop — extracted to
  // src/hooks/usePolishPipeline.ts. isPolishing/polishProgress/
  // polishProgressVisible are owned by the hook; App only reads them below for
  // render + the presence phase + the before-unload guard.
  const {
    isPolishing,
    polishProgress,
    polishProgressVisible,
    setPolishProgressVisible,
    handlePolish,
    retryStage,
    stopPolish
  } = usePolishPipeline({
    editedResume,
    tailorModes,
    currentResumeText,
    jobDescription,
    includeCoverLetter,
    requestHonestContext,
    customInstructions,
    polishStages,
    tailor: stages.tailor,
    review: stages.review,
    result,
    setResult,
    applyCoverLetter,
    setActiveOutputTab,
    setPipelineAiUsage,
    setPolishStatus,
    resetExportStatuses,
    setTexStatus,
    confirmDuplicateBeforePolish: duplicateGuard.confirmDuplicateBeforePolish
  });

  // Cross-tab presence: each browser tab is an independent tailoring session, so
  // we publish this tab's coarse phase (derived from existing flow state — never
  // instrumented into the stage runners) and read back the OTHER live tabs for
  // the shared in-progress card. Privacy: only the role · company label leaves
  // the tab, never JD/resume text.
  const _myPhase: PresencePhase = distillProgress.status === "running"
    ? "distilling"
    : isPolishing
      ? polishStages === "review"
        ? "reviewing"
        : polishStages === "tailor"
          ? "tailoring"
          : "tailoring+reviewing"
      : resumeEdited
        ? "editing"
        : "idle";
  const otherSessions = useTabPresence({ jobLabel: _autosaveJobLabel, phase: _myPhase });

  // Warn before close/reload when there are unsaved edits OR a distill/tailor/
  // review is mid-flight (losing an in-progress run is as costly as losing edits).
  // Apply clears `resumeEdited` (markResumeClean) since the work is then persisted
  // and a copy exported; editing again re-arms it.
  useBeforeUnloadGuard(
    resumeEdited || isPolishing || distillProgress.status === "running"
  );

  // ----- Handlers -----

  // The workspace / base-resume cluster (state + handlers) lives in
  // useWorkspaceResume; App passes in the editor/export/dialog dependencies it
  // needs and reads back the workspace state + the handlers ResumeMenu wires up.
  const {
    baseResumeName,
    baseResumeOptions,
    baseResumeHistory,
    workspaceStatus,
    isSavingBaseResume,
    loadWorkspace,
    removeBaseResume,
    restoreBaseResume,
    saveCurrentAsBaseResume,
    loadBaseResumeVersion,
    handleFileUpload
  } = useWorkspaceResume({
    confirm,
    confirmReplaceEditor,
    resumeEdited,
    seedResumeEditor,
    fileName,
    setResumeText,
    setFileName,
    setResult,
    applyCoverLetter,
    setFileError,
    setFileStatus,
    setPolishStatus,
    resetExportStatuses,
    setTexStatus,
    clearAutosaveDraft,
    setPendingAutosaveDraft,
    renderTexFromSchema,
    selectedTemplateId,
    docStyle,
    currentResumeText,
    resumeText,
    editedResume
  });

  // Auto-tailor: when an extension import requested it (toggle on), jump straight to
  // polish as soon as a resume is ready. Scoped to the imported job's text — if the
  // user swapped in a different JD (another import, a paste, or a hand edit) before a
  // resume loaded, drop the intent instead of firing a surprise polish on the wrong
  // posting.
  useEffect(() => {
    if (autoTailorJob === null) return;
    if (autoTailorJob !== jobDescription.trim()) {
      setAutoTailorJob(null);
      return;
    }
    if (canPolish && !isPolishing) {
      setAutoTailorJob(null);
      void handlePolish();
    }
  }, [autoTailorJob, jobDescription, canPolish, isPolishing]);

  // Called from the ReviewRail "Add evidence" button on gaps/missing-skills rows.
  // Appends a template line to honestContext (unless the keyword is already there),
  // then opens the Options menu so the user can fill it in and re-run Polish.
  function handleAddHonestContext(keyword: string) {
    const alreadyPresent = honestContext.toLowerCase().includes(keyword.toLowerCase());
    if (!alreadyPresent) {
      const template = `${keyword}: [describe your exact experience — what you did, where, when]`;
      setHonestContext(honestContext ? `${honestContext}\n${template}` : template);
    }
    setPolishMenuOpen(true);
    // Give the menu one frame to render before trying to focus the textarea.
    window.requestAnimationFrame(() => {
      honestContextTextareaRef.current?.focus();
    });
    setPolishStatus(`Added evidence prompt for "${keyword}" — fill it in, then Polish again.`);
  }

  // Reads the memoized distillation above (apply/export callers run at click time,
  // so the value is always current); kept as a function for call-site stability.
  function currentJobTracking(): ExtractedJobTracking {
    return jobTracking;
  }

  // The Apply flow (download-prompt state + commitApply/handleApply/
  // handleApplyDownloadPick/handleApplyOnly/saveAppliedResumeArtifacts) lives in
  // useApplyFlow; App passes in the job/resume/result/export/duplicate-guard
  // dependencies it needs and reads back the download-prompt state + handlers
  // the Apply button and ApplyDownloadDialog wire up.
  const {
    applyMergeTargetRef,
    applyDownloadPrompt,
    setApplyDownloadPrompt,
    defaultExportFormat,
    handleApply,
    handleApplyDownloadPick,
    handleApplyOnly
  } = useApplyFlow({
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
    resolveApplyDuplicate: duplicateGuard.resolveApplyDuplicate,
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
  });

  async function handleLoadApplication(app: Application) {
    if (resumeEdited) {
      if (!(await confirmReplaceEditor())) return;
      clearAutosaveDraft();
      setPendingAutosaveDraft(null);
    }
    // Description and link are separate fields: restore each from its own slot.
    setJobDescription(app.jobDescription || "");
    setJobUrl(app.jobUrl || "");
    setImportedJob(null);
    // Restore a consistent AI-usage/raw-text pair regardless of which branch
    // below runs — a tracker-restore must not carry over the PREVIOUS working
    // job's provider attribution or raw text.
    setPipelineAiUsage(app.aiUsage ?? { distill: { source: "none" } });
    setJobRawText(app.rawJobDescription ?? "");
    // Deliberately reloading a tracked application for another pass: pre-ack
    // its own record so the polish/apply duplicate gates don't nag that it
    // "already exists" — merging back into it is the point.
    duplicateGuard.ackApplication(app);
    if (app.resumeData || app.polishedText) {
      const restoredResume = app.polishedText || (app.resumeData ? serializeResumeData(app.resumeData) : "");
      const restoredAnalysis = analyzeResumeText(restoredResume, app.jobDescription || "");
      setResumeText(restoredResume);
      setFileName("");
      setFileStatus("Loaded the applied resume snapshot into the editor. Save it as base if you want it at startup.");
      // Single-owner cover letter: show the saved letter alongside its restored
      // resume (Materials/Copy/save read this hook state, not result).
      applyCoverLetter(app.coverLetterText || "");
      setResult({
        ...restoredAnalysis,
        polishedText: restoredResume,
        coverLetterText: app.coverLetterText || undefined,
        // Restore the saved comparison with its original provenance — never
        // relabel a local estimate as AI-judged.
        savedFit:
          typeof app.baseFitScore === "number" && typeof app.tailoredFitScore === "number"
            ? { source: app.fitScoreSource === "ai" ? "ai" : "local", base: app.baseFitScore, tailored: app.tailoredFitScore }
            : undefined,
        missingRequiredSkills: missingRequiredSkillsFromApplication(app)
      });
      if (app.resumeData) {
        seedResumeData(app.resumeData);
      } else {
        seedResumeEditor(restoredResume, "");
      }
      setLinkStatus(`Loaded "${app.title}" and its saved resume snapshot from pipeline.`);
    } else {
      setLinkStatus(`Loaded "${app.title}" job target from pipeline.`);
      setResult(null);
      applyCoverLetter(""); // no resume restored → no orphan cover letter
      seedResumeEditor("");
    }
    setPolishStatus("");
    resetExportStatuses();
    setTexStatus("");
    setActiveOutputTab("resume");
  }

  // Restore the autosaved draft into the editor, then clear the prompt and the
  // stored key so the affordance doesn't reappear.
  async function handleRestoreAutosaveDraft(draft: AutosavedDraft) {
    if (resumeEdited) {
      if (!(await confirmReplaceEditor())) return;
    }
    seedResumeEditor(draft.resumeText, "");
    applyCoverLetter(""); // resume swapped — clear any cover from a prior context
    // The autosave doesn't carry the job description/URL, so a saved
    // pipelineAiUsage/rawText only applies when the SAME job target is still
    // loaded — restoring onto an unrelated job would misattribute stale
    // AI-usage. Gate on the draft's job-key hash when present (exact target
    // identity); fall back to the role · company label for older drafts (a
    // label collides across reposts of the same role, so it's belt-only).
    const provenanceApplies = draft.jobKeyHash
      ? draft.jobKeyHash === duplicateGuard.currentJobKeyHash()
      : Boolean(draft.jobLabel && draft.jobLabel === _autosaveJobLabel);
    if (provenanceApplies) {
      if (draft.pipelineAiUsage) setPipelineAiUsage(draft.pipelineAiUsage);
      if (draft.jobRawText) setJobRawText(draft.jobRawText);
    }
    clearAutosaveDraft();
    setPendingAutosaveDraft(null);
    setFileStatus(`Restored unsaved draft${draft.jobLabel ? ` (${draft.jobLabel})` : ""}.`);
  }

  function handleDismissAutosaveDraft() {
    clearAutosaveDraft();
    setPendingAutosaveDraft(null);
  }

  async function handleDeleteApplication(id: string, title: string) {
    if (
      !(await confirm({
        title: "Delete application?",
        message: `Delete "${title}" from the pipeline?`,
        confirmLabel: "Delete",
        tone: "danger"
      }))
    )
      return;
    removeApplication(id);
    if (modalApplicationId === id) setIsApplicationModalOpen(false);
  }

  // Double-click in any tracker view opens the full detail modal for that role.
  function handleOpenApplicationDetail(application: Application) {
    setModalApplicationId(application.id);
    setExpandedApplicationId(application.id);
    setIsApplicationModalOpen(true);
  }

  // In-app PDF preview of the resume that was saved with an application (renders
  // the saved artifact via react-pdf — distinct from the editor compile preview).
  function handlePreviewApplicationResume(application: Application) {
    const base = sanitizeFileBase(
      application.company || application.role || application.title || "resume"
    );
    setResumePreview({
      url: `/api/applications/${encodeURIComponent(application.id)}/resume.pdf`,
      name: `${base}_Resume.pdf`
    });
  }

  function handleAddApplication() {
    setModalApplicationId(null);
    setIsApplicationModalOpen(true);
  }

  function handleSaveApplicationFromModal(application: Application) {
    saveApplication(application);
    setExpandedApplicationId(application.id);
  }

  // ----- Render -----

  return (
    <div className="app-shell">
      <ViewportGate />
      <Masthead
        onApply={handleApply}
        applyDisabled={!jobUrl.trim() && !jobDescription.trim()}
        applyHint="Add a job link or description (Job menu) before applying."
        onPolish={handlePolish}
        canPolish={canPolish}
        isPolishing={isPolishing}
        polishHint={polishGateHint}
        resumeControl={
          <ResumeMenu
            baseResumeName={baseResumeName}
            baseResumeOptions={baseResumeOptions}
            baseResumeHistory={baseResumeHistory}
            workspaceStatus={workspaceStatus}
            isSavingBaseResume={isSavingBaseResume}
            fileName={fileName}
            fileError={fileError}
            fileStatus={fileStatus}
            resumeText={currentResumeText || resumeText}
            resumeReady={resumeReady}
            onSaveCurrentAsBase={saveCurrentAsBaseResume}
            onLoadBaseResumeVersion={loadBaseResumeVersion}
            onRemoveBaseResume={removeBaseResume}
            onRestoreBaseResume={restoreBaseResume}
            onLoadWorkspace={loadWorkspace}
            onFileUpload={handleFileUpload}
          />
        }
        jobControl={
          <JobMenu
            jobDescription={jobDescription}
            setJobDescription={handleManualJobDescriptionChange}
            jobUrl={jobUrl}
            setJobUrl={setJobUrl}
            onExtractFromLink={handleExtractFromLink}
            isExtractingLink={isExtractingLink}
            onDistillPaste={handleDistillPaste}
            linkStatus={linkStatus}
            jobReady={jobReady}
          />
        }
        aiControl={
          <AiMenu>
            {/* Pipeline order: Distill → Tailor → Review. Each stage is its own
                concrete provider; the segmented buttons copy settings between them. */}
            {STAGE_SECTIONS.map(({ id, title }) => (
              <ProviderSection
                key={id}
                stage={id}
                title={title}
                config={stages[id]}
                onChange={(patch) => updateStage(id, patch)}
                onProviderChange={(provider) => changeStageProvider(id, provider)}
                open={sectionOpen[id]}
                onToggle={() => toggleSection(id)}
                onCopyFrom={(from) => copyStage(from, id)}
              />
            ))}
          </AiMenu>
        }
        polishControl={
          <PolishMenu
            includeCoverLetter={includeCoverLetter}
            setIncludeCoverLetter={setIncludeCoverLetter}
            polishStages={polishStages}
            setPolishStages={setPolishStages}
            honestContext={honestContext}
            setHonestContext={setHonestContext}
            citizenshipStatus={citizenshipStatus}
            setCitizenshipStatus={setCitizenshipStatus}
            legallyAuthorizedToWork={legallyAuthorizedToWork}
            setLegallyAuthorizedToWork={setLegallyAuthorizedToWork}
            requiresSponsorship={requiresSponsorship}
            setRequiresSponsorship={setRequiresSponsorship}
            customInstructions={customInstructions}
            setCustomInstructions={setCustomInstructions}
            open={polishMenuOpen}
            onOpenChange={setPolishMenuOpen}
            honestContextRef={honestContextTextareaRef}
          />
        }
      />

      {polishStatus ? (
        <div className="polish-toast" role="status" aria-live="polite">
          <span className="polish-toast__text">{polishStatus}</span>
          <button
            type="button"
            className="polish-toast__dismiss"
            onClick={() => setPolishStatus("")}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      ) : null}

      {polishProgressVisible ||
      distillProgressVisible ||
      coverProgress.status !== "idle" ||
      answersProgress.status !== "idle" ? (
        <div
          className={`progress-dock${dock.dragging ? " is-dragging" : ""}`}
          style={dock.style}
          onPointerDown={dock.onPointerDown}
          aria-label="Task progress"
        >
          {/* Distill renders first (top): in the normal flow the job is
              distilled before it's tailored, so top-to-bottom mirrors the order
              the steps actually ran. Polish (Tailor→Review), then the on-demand
              cover/answers, follow. */}
          {distillProgressVisible ? (
            <DistillProgress
              state={distillProgress}
              onRetry={distillRetry}
              onDismiss={() => setDistillProgressVisible(false)}
            />
          ) : null}
          {polishProgressVisible ? (
            <PolishProgress
              stages={polishStages}
              progress={polishProgress}
              onRetry={retryStage}
              onStop={stopPolish}
              onDismiss={() => setPolishProgressVisible(false)}
              busy={isPolishing}
            />
          ) : null}
          <TaskProgress
            stageKey="cover"
            state={coverProgress}
            onRetry={handleGenerateCoverLetter}
            onDismiss={dismissCoverProgress}
          />
          <TaskProgress
            stageKey="answers"
            state={answersProgress}
            onRetry={retryAnswers}
            onDismiss={dismissAnswersProgress}
          />
        </div>
      ) : null}

      <div className="workspace-grid">
        <StudioPane
          activeOutputTab={activeOutputTab}
          setActiveOutputTab={setActiveOutputTab}
          outputTabs={outputTabs}
          railFooter={<SessionsRail self={{ jobLabel: _autosaveJobLabel, phase: _myPhase }} others={otherSessions} />}
          overlay={
            <Suspense fallback={null}>
              <PreviewOverlay
                isOpen={isPreviewOpen}
                isLoading={isPreviewLoading}
                error={previewError}
                pdfUrl={previewPdfUrl}
                fileName={resumeDownloadName("pdf")}
                onClose={handleClosePreview}
                onRetry={handlePreview}
              />
              {/* Saved-application resume preview (react-pdf), separate from the
                  editor compile preview above. */}
              <PreviewOverlay
                isOpen={!!resumePreview}
                isLoading={false}
                error=""
                pdfUrl={resumePreview?.url ?? ""}
                fileName={resumePreview?.name ?? "resume.pdf"}
                onClose={() => setResumePreview(null)}
                onRetry={() => {}}
              />
            </Suspense>
          }
        >
          {activeOutputTab === "resume" ? (
            <ResumeTab
              editedResume={editedResume}
              actions={resumeEditorActions}
              dirty={resumeEdited}
              hasResult={Boolean(result)}
              resultSourceLabel={resultSourceLabel}
              scoreContext={scoreContext}
              fitVerdict={fitVerdict}
              jobConstraints={jobConstraints}
              result={result}
              resumeDiff={resumeDiff}
              docStyle={docStyle}
              tailorModes={tailorModes}
              onSetTailorMode={setTailorMode}
              onAddHonestContext={handleAddHonestContext}
              pendingAutosaveDraft={pendingAutosaveDraft}
              onRestoreAutosaveDraft={handleRestoreAutosaveDraft}
              onDismissAutosaveDraft={handleDismissAutosaveDraft}
              reviewStale={reviewStale}
              jobTarget={materialsJobTarget}
              exportControl={
                <ExportMenu
                  templates={templates}
                  templatesError={templatesError}
                  selectedTemplateId={selectedTemplateId}
                  setSelectedTemplateId={setSelectedTemplateId}
                  selectedTemplate={selectedTemplate}
                  tectonic={tectonic}
                  canExport={canExportResume}
                  defaultFileBaseName={resumeDownloadName("pdf").replace(/\.pdf$/i, "")}
                  isDownloadingTex={isDownloadingTex}
                  isRenderingLatexPdf={isRenderingLatexPdf}
                  isPreviewLoading={isPreviewLoading}
                  texStatus={texStatus}
                  downloadStatus={downloadStatus}
                  onDownloadTex={handleDownloadTex}
                  onDownloadLatexPdf={handleDownloadLatexPdf}
                  onPreview={handlePreview}
                  onPrintResume={handlePrintResume}
                />
              }
            />
          ) : null}


          {activeOutputTab === "applications" ? (
            <TrackerTab
              applications={applications}
              applicationsPath={applicationsPath}
              applicationsError={applicationsError}
              isApplicationsLoading={isApplicationsLoading}
              pipelineFilter={pipelineFilter}
              setPipelineFilter={setPipelineFilter}
              expandedApplicationId={expandedApplicationId}
              setExpandedApplicationId={setExpandedApplicationId}
              trackerView={trackerView}
              setTrackerView={setTrackerView}
              onUpdateStatus={updateApplicationStatus}
              onUpdateField={updateApplicationField}
              onUpdateNotes={updateApplicationNotes}
              onLoad={handleLoadApplication}
              onOpenApplication={handleOpenApplicationDetail}
              onPreviewResume={handlePreviewApplicationResume}
              onDelete={handleDeleteApplication}
              onAddApplication={handleAddApplication}
              onRefresh={refreshApplications}
              onMergeApplications={mergeApplications}
            />
          ) : null}

          {activeOutputTab === "materials" ? (
            <MaterialsTab
              coverLetterText={coverLetterText}
              onGenerateCoverLetter={handleGenerateCoverLetter}
              isGeneratingCover={isGeneratingCover}
              coverStatus={coverStatus}
              includeCoverLetter={includeCoverLetter}
              setIncludeCoverLetter={setIncludeCoverLetter}
              coverCopied={coverCopied}
              onCopy={handleCopyCoverLetter}
              answersResult={answersResult}
              answersStatus={answersStatus}
              isGeneratingAnswers={isGeneratingAnswers}
              resumeReady={resumeReady}
              jobReady={jobReady}
              canSave={Boolean(jobUrl.trim() || jobDescription.trim())}
              onGenerate={handleGenerateAnswers}
              onSaveAnswers={handleSaveAnswers}
              jobTarget={materialsJobTarget}
            />
          ) : null}

          {activeOutputTab === "analytics" ? (
            <AnalyticsTab applications={applications} onOpenApplications={() => setActiveOutputTab("applications")} />
          ) : null}
        </StudioPane>
      </div>

      <ApplicationModal
        open={isApplicationModalOpen}
        application={modalApplicationId ? applications.find((app) => app.id === modalApplicationId) ?? null : null}
        onClose={() => setIsApplicationModalOpen(false)}
        onSave={handleSaveApplicationFromModal}
        onDelete={handleDeleteApplication}
        onLoad={(app) => {
          setIsApplicationModalOpen(false);
          handleLoadApplication(app);
        }}
        onPreviewResume={handlePreviewApplicationResume}
      />

      {applyDownloadPrompt ? (
        <ApplyDownloadDialog
          label={applyDownloadPrompt.label}
          tectonicAvailable={tectonic.available}
          defaultFormat={defaultExportFormat}
          defaultFileBaseName={resumeDownloadName("pdf").replace(/\.pdf$/i, "")}
          onDownload={handleApplyDownloadPick}
          onSkip={() => {
            // True cancel path (backdrop click / × / Escape) — abandons the
            // whole apply without committing, so any duplicate-merge target
            // this flow identified must not leak into a later apply.
            applyMergeTargetRef.current = null;
            setApplyDownloadPrompt(null);
          }}
          onApplyOnly={handleApplyOnly}
        />
      ) : null}

      {currentResumeText ? (
        <ResumePrintLayer
          resume={editedResume}
          polishedText={currentResumeText}
          sourceText={resumeText}
          docStyleVars={docStyle.cssVars}
        />
      ) : null}
    </div>
  );
}

export default App;
