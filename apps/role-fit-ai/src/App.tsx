import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  analyzeResumeText,
  type PolishedResume
} from "./resumeEngine";

import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useDocStyle } from "@typeset/editor/hooks/useDocStyle.ts";
import { FormattingToolbar } from "@typeset/editor/components/toolbar/FormattingToolbar.tsx";
import {
  type InlineFormatState,
  type TypesetEditorHandle
} from "@typeset/editor/sections/editor/TypesetEditor.tsx";
import { DOC_PAGE_WIDTH_PX, DOC_STYLE_BOUNDS } from "@typeset/engine/lib/documentStyle.ts";
import {
  STYLE_FIELD_MARK_DEFAULTS,
  globalAlignmentState,
  styleFieldDefaultSizePt,
  styleFieldFontStates,
  styleFieldMarkStates,
  styleFieldSizeStates
} from "@typeset/engine/lib/styleFieldFormatting.ts";
import { useAiSettings } from "./hooks/useAiSettings";
import { useAvailableProviders } from "./hooks/useAvailableProviders";
import { useApplicationAnswers } from "./hooks/useApplicationAnswers";
import {
  useApplications,
  missingRequiredSkillsFromApplication,
  type Application
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
import {
  buildResumeDocumentTitle,
  completeAutoResumeDocumentTitle,
  resolveResumeApplicantName,
  sanitizeFileBase
} from "./lib/downloads";
import { buildStageRequestFields, type StageId } from "./lib/aiRequest";
import { useDraggableDock } from "./hooks/useDraggableDock";
import { buildCandidateFactsContext, mergeHonestContext } from "./lib/candidateFacts";
import { extractJobPosting, type ExtractedJobTracking } from "./lib/jobExtract";
import { serializeResumeData } from "./lib/resumeText";
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
import { AiWorkflowProgress, TaskProgress } from "./sections/AiWorkflowProgress";
import type { AiWorkflowStage } from "./lib/aiWorkflow";
import { SessionsMenu } from "./sections/SessionsRail";
import { ResumeMenu } from "./sections/ResumeMenu";
import { StudioPane } from "./sections/StudioPane";
import { ExportMenu } from "./sections/ExportRail";
import { ApplyDownloadDialog } from "./sections/ApplyDownloadDialog";
import { ResumePrintLayer } from "@typeset/editor/sections/ResumePrintLayer.tsx";
import { ResumeTab } from "./sections/tabs/ResumeTab";
import { MaterialsTab } from "./sections/tabs/MaterialsTab";
import type { TrackerView } from "./sections/tabs/TrackerTab";
import type { OutputTab, OutputTabDescriptor } from "./sections/shared";
import { providerLabel } from "./config/aiOptions";
import type { ApplicationActivityFilter } from "./lib/applicationDisplay";

const PreviewOverlay = lazy(() => import("./sections/PreviewOverlay"));
const ApplicationModal = lazy(() =>
  import("./sections/ApplicationModal").then((module) => ({ default: module.ApplicationModal }))
);
const TrackerTab = lazy(() =>
  import("./sections/tabs/TrackerTab").then((module) => ({ default: module.TrackerTab }))
);
const AnalyticsTab = lazy(() =>
  import("./sections/tabs/AnalyticsTab").then((module) => ({ default: module.AnalyticsTab }))
);

function ApplicationModalLoading() {
  return (
    <div className="application-modal">
      <div className="application-modal__scrim" aria-hidden="true" />
      <section className="application-modal__panel" aria-busy="true">
        <p className="pipeline-note" role="status" aria-live="polite">Loading application…</p>
      </section>
    </div>
  );
}

// The AI menu's three provider sections, in pipeline order.
const STAGE_SECTIONS: { id: StageId; title: string }[] = [
  { id: "distill", title: "Distill" },
  { id: "tailor", title: "Tailor" },
  { id: "review", title: "Review" }
];

const EMPTY_INLINE_FORMAT: InlineFormatState = {
  canFormat: false,
  bold: false,
  italic: false,
  underline: false,
  fontFamily: null,
  fontSizePt: null,
  alignment: null,
  alignmentScope: null,
  entryField: null,
  linkHref: null,
  linkText: "",
  linkAutomatic: false,
  canLink: false,
  canClearFormatting: false
};

const DEFAULT_DOCUMENT_TITLE = "Resume";
const LEGACY_DEFAULT_DOCUMENT_TITLE = "Resume draft";
const DOCUMENT_TITLE_STORAGE_KEY = "rolefit:documentTitle";
const OUTPUT_TABS: OutputTabDescriptor[] = [
  { id: "resume", label: "Resume" },
  { id: "materials", label: "Materials" },
  { id: "applications", label: "Applications" },
  { id: "analytics", label: "Analytics" }
];

// ============ Types ============

function definedTracking(tracking: ExtractedJobTracking) {
  return Object.fromEntries(
    Object.entries(tracking).filter(([, value]) => value !== undefined && value !== "" && value !== null)
  ) as ExtractedJobTracking;
}

function documentTitleForJob(tracking: ExtractedJobTracking, applicantName: string): string {
  const company = (tracking.company || "").trim();
  return buildResumeDocumentTitle(applicantName, company);
}

function browserTabTitle(tracking: ExtractedJobTracking): string {
  const company = (tracking.company || "").trim();
  const role = (tracking.role || "").trim();
  return [...(company ? [company] : []), ...(role ? [role] : []), "RoleFit AI"].join(" - ");
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
  // Tab-local document identity: independent tailoring sessions can name their
  // drafts independently, and the same title becomes the default PDF/.resume
  // file name. Successful imports/distills replace it with the new job target.
  const [documentTitle, setDocumentTitle] = useState(() => {
    try {
      const stored = sessionStorage.getItem(DOCUMENT_TITLE_STORAGE_KEY)?.trim();
      // `Resume draft` was the old generated default, not a user-authored file
      // contract. Normalize that one known value to the current D075 fallback.
      return !stored || stored === LEGACY_DEFAULT_DOCUMENT_TITLE ? DEFAULT_DOCUMENT_TITLE : stored;
    } catch {
      return DEFAULT_DOCUMENT_TITLE;
    }
  });
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
  // Surfaces polish-flow feedback beside the Polish action.
  const [polishStatus, setPolishStatus] = useState("");
  const polishStatusIsError = /failed|stopped|too little|already tracked|no review attempt|changed/i.test(polishStatus);
  // Holds the imported job's text when an extension import arrives with the "Tailor
  // automatically" toggle on, so the app jumps straight to polish once a resume is
  // ready (no manual click). Scoping to the specific job — not a bare flag — means a
  // later import/paste/edit, or a toggle-OFF import, can never trigger a surprise
  // polish against the wrong posting.
  const [autoTailorJob, setAutoTailorJob] = useState<string | null>(null);
  // Export and Apply report to their own local action surfaces instead of a
  // shared global toast.
  const [exportStatus, setExportStatus] = useState("");
  const exportStatusIsError = /failed|could not|couldn't|unavailable|load a resume/i.test(exportStatus);
  const [applyStatus, setApplyStatus] = useState("");
  const applyStatusIsError = /failed|could not|couldn't/i.test(applyStatus);
  // All auto-saved AI preferences (primary provider/model, the reviewer-override
  // audit* fields, and the polish prefs that persist with them) plus the
  // debounced localStorage write live in useAiSettings. Credentials are owned
  // by the local companion and have no browser state. Destructured into the
  // same names the handlers + JSX already use.
  const providerAvailability = useAvailableProviders();
  const ai = useAiSettings();
  const {
    stages,
    updateStage,
    changeStageProvider,
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
  const availableProviderById = useMemo(
    () => new Map(providerAvailability.providers.map((provider) => [provider.id, provider])),
    [providerAvailability.providers]
  );
  const providerReady = useCallback(
    (provider: (typeof stages)[StageId]["provider"]) => availableProviderById.get(provider)?.ready === true,
    [availableProviderById]
  );
  const providerRecoveryMessage = useCallback(
    (provider: (typeof stages)[StageId]["provider"]) => {
      if (providerAvailability.status === "loading") {
        return "Checking providers in RoleFit Companion…";
      }
      if (!providerAvailability.companionManaged) return providerAvailability.message;
      const connection = availableProviderById.get(provider);
      if (!connection) return `Add ${providerLabel(provider)} in RoleFit Companion.`;
      return connection.ready ? "" : connection.guidance;
    },
    [availableProviderById, providerAvailability.companionManaged, providerAvailability.message, providerAvailability.status]
  );
  const distillProviderReady = providerReady(stages.distill.provider);
  const tailorProviderReady = providerReady(stages.tailor.provider);
  const reviewProviderReady = providerReady(stages.review.provider);
  const distillProviderMessage = providerRecoveryMessage(stages.distill.provider);
  const tailorProviderMessage = providerRecoveryMessage(stages.tailor.provider);
  const reviewProviderMessage = providerRecoveryMessage(stages.review.provider);
  const ensureDistillProvider = useCallback(
    () => providerAvailability.ensureProvider(stages.distill.provider),
    [providerAvailability.ensureProvider, stages.distill.provider]
  );
  const ensureTailorProvider = useCallback(
    () => providerAvailability.ensureProvider(stages.tailor.provider),
    [providerAvailability.ensureProvider, stages.tailor.provider]
  );
  const ensureReviewProvider = useCallback(
    () => providerAvailability.ensureProvider(stages.review.provider),
    [providerAvailability.ensureProvider, stages.review.provider]
  );
  const selectedPolishProvidersReady =
    (polishStages === "review" || tailorProviderReady) &&
    (polishStages === "tailor" || reviewProviderReady);
  const polishProviderMessage =
    polishStages !== "review" && !tailorProviderReady
      ? tailorProviderMessage
      : polishStages !== "tailor" && !reviewProviderReady
        ? reviewProviderMessage
        : "";
  const candidateFactsContext = buildCandidateFactsContext({ citizenshipStatus, legallyAuthorizedToWork, requiresSponsorship });
  const requestHonestContext = mergeHonestContext(honestContext, candidateFactsContext);
  // Distill runs on its own concrete provider config (synced to other stages via
  // the copy buttons, not a live link). Shared by every distill entry point
  // (link, paste, extension import, and their retries).
  const distillRequestFields = () => buildStageRequestFields(stages.distill);
  const [includeCoverLetter, setIncludeCoverLetter] = useState(false);
  const [activeOutputTab, setActiveOutputTab] = useState<OutputTab>("resume");
  const [statusFilter, setStatusFilter] = useState<ApplicationActivityFilter>("all");
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

  // ----- Structured resume editor -----
  // editedResume is the canonical editable model; it seeds at discrete events
  // (a fresh polish, a loaded base resume, a restored snapshot). `currentResumeText`
  // is its serialization (falling back to the raw polish output) — the bridge every
  // text consumer (scoring, diff, exports, print, application snapshots) reads.
  const {
    editedResume,
    dirty: resumeEdited,
    // Free-form hand-edits only (NOT accepting/undoing a reviewed suggestion).
    // Gates fit provenance so applying reviewed suggestions keeps the AI score;
    // arbitrary typing makes it stale until AI Review runs again.
    manualEdited: resumeManuallyEdited,
    canUndo: canUndoResume,
    canRedo: canRedoResume,
    serializedResume,
    seed: seedResumeEditor,
    seedData: seedResumeData,
    markClean: markResumeClean,
    actions: resumeEditorActions
  } = useResumeEditor();
  const typesetEditorRef = useRef<TypesetEditorHandle>(null);
  const [inlineFormat, setInlineFormat] = useState<InlineFormatState>(EMPTY_INLINE_FORMAT);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const currentResumeText = serializedResume || result?.polishedText || "";

  useEffect(() => {
    try {
      sessionStorage.setItem(DOCUMENT_TITLE_STORAGE_KEY, documentTitle.trim() || DEFAULT_DOCUMENT_TITLE);
    } catch {
      // Session storage can be blocked; the in-memory title still works.
    }
  }, [documentTitle]);

  const setImportedJobAndDocumentTitle = useCallback((snapshot: ImportedJobSnapshot | null) => {
    setImportedJob(snapshot);
    if (!snapshot) return;
    const applicantName = resolveResumeApplicantName(editedResume?.name, currentResumeText || resumeText);
    setDocumentTitle(documentTitleForJob(snapshot.tracking, applicantName));
  }, [currentResumeText, editedResume?.name, resumeText]);
  // Per-section tailoring choice. Off is the implicit default (absent key); the
  // map stores only "tailor"/"include" so the three states are mutually exclusive
  // by construction.
  const [tailorModes, setTailorModes] = useState<Record<string, TailorMode>>({});
  // Stable identity keeps the typeset editor's section controls from
  // re-rendering solely because App rendered.
  const setTailorMode = useCallback((sectionId: string, mode: TailorMode) => {
    setTailorModes((current) => {
      const next = { ...current };
      if (mode === "off") delete next[sectionId];
      else next[sectionId] = mode;
      return next;
    });
  }, []);
  // Shared Typeset formatting state. Print-affecting values travel with the
  // strict .resume file; zoom and spellcheck remain local view preferences.
  const docStyle = useDocStyle();
  const globalAlignments = useMemo(
    () => editedResume ? globalAlignmentState(editedResume, docStyle.style) : null,
    [docStyle.style, editedResume]
  );
  const styleMarkStates = useMemo(
    () => editedResume ? styleFieldMarkStates(editedResume) : undefined,
    [editedResume]
  );
  const styleFontStates = useMemo(
    () => editedResume ? styleFieldFontStates(editedResume, docStyle.style.fontFamily) : undefined,
    [docStyle.style.fontFamily, editedResume]
  );
  const styleSizeStates = useMemo(
    () => editedResume ? styleFieldSizeStates(editedResume, docStyle.style.baseFontSizePt) : undefined,
    [docStyle.style.baseFontSizePt, editedResume]
  );
  const fitResumePage = useCallback(() => {
    const pane = document.querySelector<HTMLElement>(".resume-workbench__editor");
    if (!pane) return;
    const styles = window.getComputedStyle(pane);
    const contentWidth = pane.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    // Clamp to the engine's actual zoom bounds (not a stale hardcoded 0.4)
    // so Fit can never persist a value the ZoomControl's own min/max can't
    // re-enter. Both bounds sit on a 2-decimal boundary, so flooring to the
    // nearest 1% below can't push the result back out of range.
    const fit = Math.max(
      DOC_STYLE_BOUNDS.zoom.min,
      Math.min(DOC_STYLE_BOUNDS.zoom.max, contentWidth / DOC_PAGE_WIDTH_PX)
    );
    docStyle.set("zoom", Math.floor(fit * 100) / 100);
  }, [docStyle]);

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

  // Keep browser tabs distinguishable when several applications are open.
  // The shared distilled metadata is authoritative, so imported and manually
  // entered jobs use the same Company - Role - RoleFit AI format.
  useEffect(() => {
    document.title = browserTabTitle(jobTracking);
    return () => {
      document.title = "RoleFit AI";
    };
  }, [jobTracking.company, jobTracking.role]);

  // The job and workspace resume load independently. If job intake initially
  // produced Company_Resume, complete it when the structured applicant name
  // becomes available. Only known automatic fallbacks are eligible, so a title
  // the user edited remains untouched.
  useEffect(() => {
    const applicantName = resolveResumeApplicantName(editedResume?.name, resumeText);
    const company = (jobTracking.company ?? "").trim();
    if (!applicantName || !company) return;
    setDocumentTitle((current) =>
      completeAutoResumeDocumentTitle(current, applicantName, company, DEFAULT_DOCUMENT_TITLE)
    );
  }, [editedResume?.name, jobTracking.company, resumeText]);

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
  const draftAutosaveState = useAutosaveDraft({
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
    pendingWrites: pendingApplicationWrites,
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
    dismissDuplicateGroup,
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
    resumeText: currentResumeText || resumeText,
    resumeData: editedResume,
    jobDescription,
    jobUrl,
    honestContext: requestHonestContext,
    customInstructions,
    aiRequest: stages.tailor,
    providerReady: tailorProviderReady,
    providerMessage: tailorProviderMessage,
    upsertApplication,
    findForTarget
  });


  // On-demand cover letter (no full polish required). Generates from the CURRENT
  // resume; the polish path also feeds this state (see runTailorStage) so the
  // Materials view, Copy, and save-to-application all read one source.
  const {
    coverLetterText,
    applyCoverLetter,
    applyPolishCoverResult,
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
    providerReady: tailorProviderReady,
    providerMessage: tailorProviderMessage,
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
  const resumeReady = (currentResumeText || resumeText).trim().length > 80;
  const canPolish = useMemo(() => {
    return Boolean(
      editedResume &&
        resumeReady &&
        Object.values(tailorModes).some((mode) => mode === "tailor") &&
        jobDescription.trim().length > 40 &&
        selectedPolishProvidersReady
    );
  }, [editedResume, jobDescription, resumeReady, selectedPolishProvidersReady, tailorModes]);

  // The edited resume is debounced before the diff recompute so typing in the
  // editor stays smooth (the editor preview itself updates live).
  const debouncedCurrentResumeText = useDebouncedValue(currentResumeText);

  // Every review-score/diff derivation the UI shows is pure (read-only) and lives
  // in useResumeAnalysis, so it stays decoupled from App's setters.
  const {
    resumeDiff,
    fitComparison,
    headlineScore,
    jobConstraints,
    resultSourceLabel
  } = useResumeAnalysis({
    resumeText,
    jobDescription,
    debouncedCurrentResumeText,
    // Gate AI fit provenance on FREE edits only. Accepting reviewed suggestions
    // keeps the score attached to the proposal the reviewer judged.
    isEdited: resumeManuallyEdited,
    result
  });

  // ----- Derived (non-memo) -----
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
    : !selectedPolishProvidersReady
    ? polishProviderMessage
    : "Add more resume text in the Resume menu (a few lines at least).";

  // ----- Resume export (engine PDF / .resume save) -----
  const {
    coverCopied,
    isRenderingPdf,
    resetStatuses: resetExportStatuses,
    handleCopyCoverLetter,
    handleDownloadPdf,
    handleDownloadResume,
    resumeDownloadName,
    getResumeArtifacts
  } = useResumeExport({
    result,
    editedResume,
    currentResumeText,
    documentTitle,
    jobUrl,
    // Name downloads after the same company the application is saved with
    // (distilled from the posting), not just a URL guess. Thunk: currentJobTracking
    // is a hoisted declaration, evaluated lazily at save time.
    resolveJobCompany: () => currentJobTracking().company ?? "",
    coverLetterText,
    resumeText,
    docStyle: docStyle.style,
    setExportStatus
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
    distillContinuesToPolish,
    dismissDistillProgress,
    distillRetry,
    handleManualJobDescriptionChange,
    handleExtractFromLink,
    handleDistillPaste
  } = useJobIntake({
    jobUrl,
    setJobUrl,
    jobDescription,
    setJobDescription,
    setImportedJob: setImportedJobAndDocumentTitle,
    setResult,
    applyCoverLetter,
    setPipelineAiUsage,
    setJobRawText,
    setAutoTailorJob,
    setPolishStatus,
    setLinkStatus,
    confirmDuplicateBeforeDistill: duplicateGuard.confirmDuplicateBeforeDistill,
    confirmDuplicateAfterDistill: duplicateGuard.confirmDuplicateAfterDistill,
    distillRequestFields,
    ensureProviderReady: ensureDistillProvider,
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
    ensureTailorProviderReady: ensureTailorProvider,
    ensureReviewProviderReady: ensureReviewProvider,
    setResult,
    applyPolishCoverResult,
    setActiveOutputTab,
    setPipelineAiUsage,
    setPolishStatus,
    resetExportStatuses,
    setExportStatus,
    confirmDuplicateBeforePolish: duplicateGuard.confirmDuplicateBeforePolish
  });

  const aiWorkflowStages: AiWorkflowStage[] = [];
  if (distillProgressVisible) {
    aiWorkflowStages.push({ key: "distill", state: distillProgress, onRetry: distillRetry });
  }
  if (polishProgressVisible || (distillProgressVisible && distillContinuesToPolish)) {
    if (polishStages !== "review") {
      aiWorkflowStages.push({
        key: "tailor",
        state: polishProgress.tailor,
        onRetry: () => void retryStage("tailor"),
        onStop: stopPolish
      });
    }
    if (polishStages !== "tailor") {
      aiWorkflowStages.push({
        key: "review",
        state: polishProgress.review,
        onRetry: () => void retryStage("review"),
        onStop: stopPolish
      });
    }
  }

  function dismissAiWorkflow() {
    dismissDistillProgress();
    setPolishProgressVisible(false);
  }

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
    resumeEdited || isPolishing || distillProgress.status === "running" || pendingApplicationWrites > 0
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
    isWorkspaceBootstrapping,
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
    setExportStatus,
    clearAutosaveDraft,
    setPendingAutosaveDraft,
    seedResumeData,
    currentResumeText,
    resumeText,
    editedResume,
    docStyle
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
      const template = `${keyword}: [describe your exact experience: what you did, where, and when]`;
      setHonestContext(honestContext ? `${honestContext}\n${template}` : template);
    }
    setPolishMenuOpen(true);
    // Give the menu one frame to render before trying to focus the textarea.
    window.requestAnimationFrame(() => {
      honestContextTextareaRef.current?.focus();
    });
    setPolishStatus(`Added an evidence prompt for "${keyword}". Fill it in, then Polish again.`);
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
    isApplying,
    applySaveError,
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
    handleDownloadPdf,
    getResumeArtifacts,
    clearAutosaveDraft,
    markResumeClean,
    setApplyStatus,
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
    const applicantName = resolveResumeApplicantName(
      app.resumeData?.name,
      app.polishedText || currentResumeText || resumeText
    );
    setDocumentTitle(documentTitleForJob({ role: app.role, title: app.title, company: app.company }, applicantName));
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
        // Restore only a saved AI comparison. Legacy deterministic estimates
        // are intentionally ignored and require a fresh AI Review.
        savedFit:
          app.fitScoreSource === "ai" && typeof app.baseFitScore === "number" && typeof app.tailoredFitScore === "number"
            ? { source: "ai", base: app.baseFitScore, tailored: app.tailoredFitScore }
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
    setExportStatus("");
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

  async function handleSaveApplicationFromModal(application: Application): Promise<boolean> {
    const saved = await saveApplication(application);
    if (saved) setExpandedApplicationId(application.id);
    return saved;
  }

  // ----- Render -----

  return (
    <div className="app-shell">
      <Masthead
        onApply={handleApply}
        applyDisabled={!jobUrl.trim() && !jobDescription.trim()}
        applyHint="Add a job link or description (Job menu) before applying."
        onPolish={handlePolish}
        canPolish={canPolish}
        isPolishing={isPolishing}
        polishHint={polishGateHint}
        polishStatus={polishStatus}
        polishStatusIsError={polishStatusIsError}
        onDismissPolishStatus={() => setPolishStatus("")}
        applyStatus={applyStatus}
        applyStatusIsError={applyStatusIsError}
        onDismissApplyStatus={() => setApplyStatus("")}
        resumeControl={
          <ResumeMenu
            baseResumeName={baseResumeName}
            baseResumeOptions={baseResumeOptions}
            baseResumeHistory={baseResumeHistory}
            workspaceStatus={workspaceStatus}
            isSavingBaseResume={isSavingBaseResume}
            isWorkspaceBootstrapping={isWorkspaceBootstrapping}
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
            distillProviderReady={distillProviderReady}
            distillProviderMessage={distillProviderMessage}
          />
        }
        aiControl={
          <AiMenu>
            {/* Pipeline order: Distill → Tailor → Review. All three stage
                settings stay visible; Copy settings performs a one-shot sync. */}
            {STAGE_SECTIONS.map(({ id, title }) => (
              <ProviderSection
                key={id}
                stage={id}
                title={title}
                config={stages[id]}
                providers={providerAvailability.providers}
                availabilityStatus={providerAvailability.status}
                availabilityMessage={providerAvailability.message}
                onRefreshProviders={providerAvailability.refresh}
                onChange={(patch) => updateStage(id, patch)}
                onProviderChange={(provider) => changeStageProvider(id, provider)}
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
        sessionsControl={
          <SessionsMenu self={{ jobLabel: _autosaveJobLabel, phase: _myPhase }} others={otherSessions} />
        }
      />

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
          <AiWorkflowProgress
            stages={aiWorkflowStages}
            onDismiss={dismissAiWorkflow}
            busy={isExtractingLink || isPolishing}
          />
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
          outputTabs={OUTPUT_TABS}
          overlay={
            resumePreview ? (
              <Suspense fallback={null}>
                {/* Saved-application resume preview (react-pdf): views a PDF saved
                    in the tracker. The live editor is its own WYSIWYG preview, so
                    there is no separate compile-preview of the current resume. */}
                <PreviewOverlay
                  isOpen
                  pdfUrl={resumePreview.url}
                  fileName={resumePreview.name}
                  onClose={() => setResumePreview(null)}
                />
              </Suspense>
            ) : null
          }
        >
          {activeOutputTab === "resume" ? (
            <ResumeTab
              documentTitle={documentTitle}
              onDocumentTitleChange={setDocumentTitle}
              editedResume={editedResume}
              actions={resumeEditorActions}
              canUndo={canUndoResume}
              canRedo={canRedoResume}
              dirty={resumeEdited}
              draftAutosaveState={draftAutosaveState}
              isWorkspaceBootstrapping={isWorkspaceBootstrapping}
              resultSourceLabel={resultSourceLabel}
              jobConstraints={jobConstraints}
              result={result}
              resumeDiff={resumeDiff}
              docStyle={docStyle}
              formattingToolbar={(
                <FormattingToolbar
                  onUndo={() => {
                    if (typesetEditorRef.current) typesetEditorRef.current.undo();
                    else resumeEditorActions.undo();
                  }}
                  onRedo={() => {
                    if (typesetEditorRef.current) typesetEditorRef.current.redo();
                    else resumeEditorActions.redo();
                  }}
                  canUndo={canUndoResume}
                  canRedo={canRedoResume}
                  formattingDisabled={!editedResume}
                  inlineFormatting={{
                    fontFamily: {
                      value: inlineFormat.fontFamily,
                      onChange: (fontFamily) => typesetEditorRef.current?.setFontFamily(fontFamily),
                      disabled: false
                    },
                    fontSize: {
                      value: inlineFormat.fontSizePt,
                      onChange: (fontSizePt) => typesetEditorRef.current?.setFontSize(fontSizePt),
                      disabled: false
                    },
                    alignment: {
                      value: inlineFormat.alignment,
                      onChange: (alignment) => typesetEditorRef.current?.setAlignment(alignment),
                      disabled: false
                    },
                    bold: {
                      onToggle: () => typesetEditorRef.current?.toggleMark("bold"),
                      pressed: inlineFormat.bold,
                      disabled: inlineFormat.alignmentScope === "heading" && docStyle.style.headingCase === "smallcaps"
                    },
                    italic: {
                      onToggle: () => typesetEditorRef.current?.toggleMark("italic"),
                      pressed: inlineFormat.italic,
                      disabled: inlineFormat.alignmentScope === "heading" && docStyle.style.headingCase === "smallcaps"
                    },
                    underline: {
                      onToggle: () => typesetEditorRef.current?.toggleMark("underline"),
                      pressed: inlineFormat.underline,
                      disabled: inlineFormat.alignmentScope === "heading" && docStyle.style.headingCase === "smallcaps"
                    },
                    link: {
                      href: inlineFormat.linkHref,
                      text: inlineFormat.linkText,
                      automatic: inlineFormat.linkAutomatic,
                      onApply: ({ text, href }) => typesetEditorRef.current?.applyLink(text, href),
                      onRemove: () => typesetEditorRef.current?.removeLink(),
                      disabled: !inlineFormat.canLink,
                      open: linkEditorOpen,
                      onOpenChange: setLinkEditorOpen
                    },
                    clearFormatting: {
                      onClear: () => typesetEditorRef.current?.clearFormatting(),
                      disabled: !inlineFormat.canClearFormatting
                    }
                  }}
                  docStyle={docStyle}
                  globalAlignments={globalAlignments ?? undefined}
                  onGlobalAlignmentChange={(scope, alignment) => {
                    resumeEditorActions.clearAlignmentOverrides(scope);
                    setInlineFormat((current) => current.alignmentScope === scope ? { ...current, alignment } : current);
                    if (scope === "body") docStyle.set("bodyAlign", alignment);
                    else if (scope === "header") docStyle.set("headerAlign", alignment === "justify" ? "left" : alignment);
                    else docStyle.set("headingAlign", alignment === "justify" ? "left" : alignment);
                  }}
                  styleMarkStates={styleMarkStates}
                  onStyleFieldMarkChange={(field, mark, on) => {
                    resumeEditorActions.setStyleFieldMark(field, mark, on);
                    setInlineFormat((current) => current.entryField === field ? { ...current, [mark]: on } : current);
                  }}
                  styleFontStates={styleFontStates}
                  onStyleFieldFontChange={(field, family) => {
                    resumeEditorActions.setStyleFieldFont(field, family === docStyle.style.fontFamily ? "default" : family);
                    setInlineFormat((current) => current.entryField === field ? { ...current, fontFamily: family } : current);
                  }}
                  styleSizeStates={styleSizeStates}
                  onStyleFieldSizeChange={(field, sizePt) => {
                    const isDefault = Math.abs(sizePt - styleFieldDefaultSizePt(field, docStyle.style.baseFontSizePt)) < 0.05;
                    resumeEditorActions.setStyleFieldSize(field, isDefault ? "default" : sizePt);
                    setInlineFormat((current) => current.entryField === field ? { ...current, fontSizePt: sizePt } : current);
                  }}
                  onResetStyleFormatting={() => {
                    resumeEditorActions.resetStyleFieldFormatting();
                    setInlineFormat((current) => current.entryField
                      ? { ...current, ...STYLE_FIELD_MARK_DEFAULTS[current.entryField] }
                      : current);
                  }}
                  onFitZoom={fitResumePage}
                />
              )}
              editorRef={typesetEditorRef}
              onInlineFormatStateChange={setInlineFormat}
              onRequestLinkEditor={() => setLinkEditorOpen(true)}
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
                  canExport={canExportResume}
                  defaultFileBaseName={resumeDownloadName("pdf").replace(/\.pdf$/i, "")}
                  isRenderingPdf={isRenderingPdf}
                  status={exportStatus}
                  statusIsError={exportStatusIsError}
                  onDismissStatus={() => setExportStatus("")}
                  onDownloadPdf={handleDownloadPdf}
                  onDownloadResume={handleDownloadResume}
                />
              }
            />
          ) : null}


          {activeOutputTab === "applications" ? (
            <Suspense fallback={<p className="pipeline-note" role="status">Loading applications…</p>}>
              <TrackerTab
                applications={applications}
                applicationsPath={applicationsPath}
                applicationsError={applicationsError}
                pendingApplicationWrites={pendingApplicationWrites}
                isApplicationsLoading={isApplicationsLoading}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
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
                onDismissDuplicateGroup={dismissDuplicateGroup}
              />
            </Suspense>
          ) : null}

          <div
            className="materials-tab-mount"
            hidden={activeOutputTab !== "materials"}
            aria-hidden={activeOutputTab !== "materials"}
          >
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
              aiProviderReady={tailorProviderReady}
              aiProviderMessage={tailorProviderMessage}
              canSave={Boolean(jobUrl.trim() || jobDescription.trim())}
              onGenerate={handleGenerateAnswers}
              onSaveAnswers={handleSaveAnswers}
              jobTarget={materialsJobTarget}
            />
          </div>

          {activeOutputTab === "analytics" ? (
            <Suspense fallback={<p className="pipeline-note" role="status">Loading analytics…</p>}>
              <AnalyticsTab applications={applications} onOpenApplications={() => setActiveOutputTab("applications")} />
            </Suspense>
          ) : null}
        </StudioPane>
      </div>

      {isApplicationModalOpen ? (
        <Suspense fallback={<ApplicationModalLoading />}>
          <ApplicationModal
            open
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
        </Suspense>
      ) : null}

      {applyDownloadPrompt ? (
        <ApplyDownloadDialog
          label={applyDownloadPrompt.label}
          defaultFileBaseName={resumeDownloadName("pdf").replace(/\.pdf$/i, "")}
          busy={isApplying}
          error={applySaveError}
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

      {editedResume ? (
        <ResumePrintLayer
          resume={editedResume}
          docStyle={docStyle.style}
        />
      ) : null}
    </div>
  );
}

export default App;
