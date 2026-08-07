import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileDown,
  FilePlus2,
  FolderOpen,
  LayoutTemplate,
  Save,
  Settings,
  Upload
} from "lucide-react";

import { analyzeResumeText, type PolishedResume } from "./resumeEngine";

import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useDocStyle } from "@typeset/editor/hooks/useDocStyle.ts";
import { createHistoryClock } from "@typeset/editor/hooks/historyClock.ts";
import { FormattingToolbar } from "@typeset/editor/components/toolbar/FormattingToolbar.tsx";
import { DocumentStructureControls } from "@typeset/editor/components/toolbar/DocumentStructureControls.tsx";
import {
  type InlineFormatState,
  type TypesetCaret,
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
import { useApplications, missingRequiredSkillsFromApplication, type Application } from "./hooks/useApplications";
import { useResumeAnalysis } from "./hooks/useResumeAnalysis";
import { useResumeEditor } from "./hooks/useResumeEditor";
import { useResumeExport } from "./hooks/useResumeExport";
import { useCoverLetter } from "./hooks/useCoverLetter";
import { useCoverLetterEditor } from "./hooks/useCoverLetterEditor";
import { useDialog } from "./hooks/useDialog";
import {
  useAutosaveDraft,
  useBeforeUnloadGuard,
  recoverAutosaveDraft,
  clearAutosaveDraft,
  type AutosavedDraft
} from "./hooks/useAutosaveDraft";
import {
  useCoverLetterAutosaveDraft,
  recoverCoverLetterAutosaveDraft,
  clearCoverLetterAutosaveDraft,
  type CoverLetterAutosavedDraft
} from "./hooks/useCoverLetterAutosaveDraft";
import { useTabPresence } from "./hooks/useTabPresence";
import { subscribeWorkspaceRestoreAdoption, type PresencePhase } from "./lib/tabPresence";
import {
  buildDocumentTitle,
  completeAutoDocumentTitle,
  type DocumentTitleKind,
  resolveResumeApplicantName,
  sanitizeFileBase
} from "./lib/downloads";
import { buildStageRequestFields, type StageId } from "./lib/aiRequest";
import { useDraggableDock } from "./hooks/useDraggableDock";
import { buildCandidateFactsContext, mergeHonestContext } from "./lib/candidateFacts";
import { extractJobPosting, type ExtractedJobTracking } from "./lib/jobExtract";
import { serializeResumeData } from "./lib/resumeText";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import { defaultTailorModes, type TailorMode } from "./lib/tailorScope";
import { resumeDocumentVersion as resumeDocumentVersionFor } from "./lib/resumeDocumentVersion";
import { canonicalizeAiUsageStageKeys, type StageAiUsage } from "./lib/aiUsage";
import { useDuplicateGuard } from "./hooks/useDuplicateGuard";
import { useJobIntake, type ImportedJobSnapshot } from "./hooks/useJobIntake";
import { usePolishPipeline } from "./hooks/usePolishPipeline";
import { useWorkspaceResume } from "./hooks/useWorkspaceResume";
import { useApplyFlow } from "./hooks/useApplyFlow";
import { useApplicationDocumentSync } from "./hooks/useApplicationDocumentSync";
import { useApplicationFiles } from "./hooks/useApplicationFiles";
import { getPreparationReadiness } from "./lib/preparationReadiness";
import {
  assemblePreparedJobApplicationText,
  assemblePreparedJobTailoringText,
  buildPreparedJobBrief,
  preparedJobBriefFieldFromText,
  reconcilePreparedJobManualReviewFields,
  removePreparedJobRoleSummary,
  type PreparedJobBriefField
} from "./lib/preparedJobBrief";
import { recommendVariant, type VariantRecommendation } from "./lib/variantRecommendation";
import { coverLetterRecoveryDirty } from "./lib/coverLetterRecovery";
import { applicationDocumentUrl, type ApplicationDocumentKind } from "./lib/applicationDocumentRequests";
import { applicationDocumentPdfBlob } from "./lib/applicationDocumentPdf";

import { Masthead } from "./sections/Masthead";
import { AiWorkflowProgress, TaskProgress } from "./sections/AiWorkflowProgress";
import type { AiWorkflowStage } from "./lib/aiWorkflow";
import { SessionsMenu } from "./sections/SessionsRail";
import { DocumentOpenMenu } from "./sections/document/DocumentOpenMenu";
import { DocumentSaveMenu } from "./sections/document/DocumentSaveMenu";
import { StudioPane } from "./sections/StudioPane";
import { SettingsDialog, type SettingsSection } from "./sections/SettingsDialog";
import { ExportMenu } from "./sections/ExportRail";
import { ApplyDownloadDialog } from "./sections/ApplyDownloadDialog";
import { ResumePrintLayer } from "@typeset/editor/sections/ResumePrintLayer.tsx";
import { ResumeTab } from "./sections/tabs/ResumeTab";
import { PrepareTab } from "./sections/tabs/PrepareTab";
import { CoverLetterTab } from "./sections/tabs/CoverLetterTab";
import { MaterialsTab } from "./sections/tabs/MaterialsTab";
import type { TrackerView } from "./sections/tabs/TrackerTab";
import type { OutputTab, OutputTabDescriptor } from "./sections/shared";
import { providerLabel } from "./config/aiOptions";
import { formatHistoryDate } from "./lib/historyDate";
import {
  appFitVerdict,
  fitScore,
  type ApplicationActivityFilter
} from "./lib/applicationDisplay";

const PreviewOverlay = lazy(() => import("./sections/PreviewOverlay"));

const DEFAULT_MATERIAL_SELECTION = {
  resume: true,
  coverLetter: false
} as const;

const ApplicationModal = lazy(() =>
  import("./sections/ApplicationModal").then((module) => ({
    default: module.ApplicationModal
  }))
);

// Named importers so the rail can warm a split chunk before the tab is
// selected. The specifier stays a literal in each function — the bundler
// resolves these statically, and calling one twice reuses the same promise.
const importTrackerTab = () => import("./sections/tabs/TrackerTab");
const importAnalyticsTab = () => import("./sections/tabs/AnalyticsTab");

const TrackerTab = lazy(() => importTrackerTab().then((module) => ({ default: module.TrackerTab })));
const AnalyticsTab = lazy(() => importAnalyticsTab().then((module) => ({ default: module.AnalyticsTab })));

// Applications and Analytics are the only code-split tabs, so they are the only
// ones whose first visit pays a chunk fetch. Warming them on hover/focus (and
// once at idle, which also covers touch and keyboard-only navigation) removes
// that cost without moving them back into the main bundle.
const TAB_PREFETCH: Partial<Record<OutputTab, () => Promise<unknown>>> = {
  applications: importTrackerTab,
  analytics: importAnalyticsTab
};

function prefetchOutputTab(tab: OutputTab): void {
  // A rejected prefetch is not actionable: React.lazy re-imports on render and
  // surfaces the real failure through the error boundary there.
  void TAB_PREFETCH[tab]?.().catch(() => undefined);
}

function ApplicationModalLoading() {
  return (
    <div className="application-modal">
      <div className="application-modal__scrim" aria-hidden="true" />
      <section className="application-modal__panel" aria-busy="true">
        <p className="pipeline-note" role="status" aria-live="polite">
          Loading application…
        </p>
      </section>
    </div>
  );
}

// Slug a typed variant label into the base-resume file name it will be saved as.
function resumeVariantFileName(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug ? slug + ".resume" : "";
}

const EMPTY_INLINE_FORMAT: InlineFormatState = {
  canFormat: false,
  bold: false,
  italic: false,
  underline: false,
  fontFamily: null,
  fontSizePt: null,
  alignment: null,
  alignmentScope: null,
  canFormatParagraph: false,
  paragraphLineHeight: null,
  paragraphSpaceBeforePt: null,
  paragraphSpaceAfterPt: null,
  entryField: null,
  linkHref: null,
  linkText: "",
  linkAutomatic: false,
  linkTextEditable: true,
  canLink: false,
  canClearFormatting: false
};

const DEFAULT_DOCUMENT_TITLE = "Resume";
// The untouched titles the cover-letter editor sets itself (blank, starter, the
// workspace default). Only these — never a title the user typed — are upgraded
// to the shared Name_Company_Cover_Letter form.
const COVER_LETTER_TITLE_PLACEHOLDERS = ["Cover letter", "Untitled cover letter"] as const;
const DOCUMENT_TITLE_STORAGE_KEY = "rolefit:documentTitle";
const OUTPUT_TABS: OutputTabDescriptor[] = [
  { id: "prepare", label: "Prepare", group: "PREPARE" },
  { id: "resume", label: "Resume" },
  { id: "cover", label: "Cover letter" },
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

function documentTitleForJob(kind: DocumentTitleKind, tracking: ExtractedJobTracking, applicantName: string): string {
  return buildDocumentTitle(kind, applicantName, (tracking.company || "").trim());
}

function browserTabTitle(tracking: ExtractedJobTracking): string {
  const company = (tracking.company || "").trim();
  const role = (tracking.role || "").trim();
  return [...(company ? [company] : []), ...(role ? [role] : []), "RoleFit AI"].join(" - ");
}

// ============ App ============

function App() {
  // ----- Dialog system -----
  const { alert, confirm } = useDialog();

  // Draggable progress dock (Tailor/Review/Job analysis/Cover/Answers task cards) —
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
  // Same wording the cover-letter toolbar uses for its own replace prompts.
  const confirmReplaceCoverLetter = () =>
    confirm({
      title: "Replace cover letter?",
      message: "Replace the current cover letter? Unsaved edits will be lost.",
      confirmLabel: "Replace"
    });
  const confirmReplaceApplicationDraft = () =>
    confirm({
      title: "Replace application draft?",
      message: "Replace the current resume and cover letter? Unsaved edits will be lost.",
      confirmLabel: "Replace"
    });

  // ----- State -----
  const [jobDescription, setJobDescription] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [importedJob, setImportedJob] = useState<ImportedJobSnapshot | null>(null);
  const [materialSelection, setMaterialSelection] = useState<{
    resume: boolean;
    coverLetter: boolean;
  }>(DEFAULT_MATERIAL_SELECTION);
  const [isSelectingCoverVariant, setIsSelectingCoverVariant] = useState(false);
  const [isManuallySelectingResumeVariant, setIsManuallySelectingResumeVariant] = useState(false);
  const resumeManualVariantSelectionInFlightRef = useRef(false);
  const coverManualVariantSelectionInFlightRef = useRef(false);
  // Tab-local document identity: independent tailoring sessions can name their
  // drafts independently, and the same title becomes the default PDF/.resume
  // file name. Successful imports/analyses replace it with the new job target.
  const [documentTitle, setDocumentTitle] = useState(() => {
    try {
      const stored = sessionStorage.getItem(DOCUMENT_TITLE_STORAGE_KEY)?.trim();
      return stored || DEFAULT_DOCUMENT_TITLE;
    } catch {
      return DEFAULT_DOCUMENT_TITLE;
    }
  });
  // Per-stage AI usage snapshot (job analysis/tailor/review/cover), captured across
  // the pipeline and snapshotted onto the Application at Apply time. Keys are
  // deleted (not set to "none") when a fresh polish run starts, so a stale
  // provider attribution can never linger from a prior run into the new one.
  const [pipelineAiUsage, setPipelineAiUsage] = useState<Record<string, StageAiUsage>>({});
  // Immutable captured posting text. It remains separate even when it initially
  // matches jobDescription so prepared-brief edits and "Prepare again" never
  // rewrite or accidentally reanalyze the compact tailoring scaffold.
  const [jobRawText, setJobRawText] = useState("");
  // Starts empty; the mount effect (loadWorkspace) auto-loads a workspace
  // base-resume when one exists, otherwise the editor stays blank.
  const [resumeText, setResumeText] = useState("");
  const [fileName, setFileName] = useState("");

  const [result, setResult] = useState<PolishedResume | null>(null);
  const [fileError, setFileError] = useState("");
  const [fileStatus, setFileStatus] = useState("");
  const [linkStatus, setLinkStatus] = useState("");
  // Surfaces polish-flow feedback in the workflow rail.
  const [polishStatus, setPolishStatus] = useState("");
  const [resumeVariantRecommendation, setResumeVariantRecommendation] = useState<VariantRecommendation | null>(null);
  const [isRankingResumeVariants, setIsRankingResumeVariants] = useState(false);
  const resumeVariantRecommendationKeyRef = useRef("");
  const resumeVariantRecommendationGenerationRef = useRef(0);
  // Both document kinds use the same recommendation and safe auto-selection
  // contract; dirty editors and restored applications are never replaced.
  const [coverLetterVariantRecommendation, setCoverLetterVariantRecommendation] =
    useState<VariantRecommendation | null>(null);
  const [isRankingCoverLetterVariants, setIsRankingCoverLetterVariants] = useState(false);
  const coverLetterVariantRecommendationKeyRef = useRef("");
  const coverLetterVariantRecommendationGenerationRef = useRef(0);
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
  const resumeHistoryClock = useMemo(createHistoryClock, []);
  const {
    stages,
    updateStage,
    changeStageProvider,
    copyStage,
    honestContext,
    setHonestContext,
    polishStages,
    setPolishStages,
    resumeAutoPolishThreshold,
    setResumeAutoPolishThreshold,
    coverAutoPolishThreshold,
    setCoverAutoPolishThreshold,
    citizenshipStatus,
    setCitizenshipStatus,
    legallyAuthorizedToWork,
    setLegallyAuthorizedToWork,
    requiresSponsorship,
    setRequiresSponsorship,
    educationLevel,
    setEducationLevel,
    major,
    setMajor,
    customInstructions,
    setCustomInstructions,
    stageCustomInstructions,
    setStageCustomInstruction,
    customInstructionsFor,
    resetSettings
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
    [
      availableProviderById,
      providerAvailability.companionManaged,
      providerAvailability.message,
      providerAvailability.status
    ]
  );
  const jobAnalysisStage = stages["job-analysis"];
  const jobAnalysisProviderReady = providerReady(jobAnalysisStage.provider);
  const tailorProviderReady = providerReady(stages.tailor.provider);
  const reviewProviderReady = providerReady(stages.review.provider);
  const coverProviderReady = providerReady(stages.cover.provider);
  const answersProviderReady = providerReady(stages.answers.provider);
  const jobAnalysisProviderMessage = providerRecoveryMessage(jobAnalysisStage.provider);
  const tailorProviderMessage = providerRecoveryMessage(stages.tailor.provider);
  const coverProviderMessage = providerRecoveryMessage(stages.cover.provider);
  const answersProviderMessage = providerRecoveryMessage(stages.answers.provider);
  const ensureJobAnalysisProvider = useCallback(
    () => providerAvailability.ensureProvider(jobAnalysisStage.provider),
    [jobAnalysisStage.provider, providerAvailability.ensureProvider]
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
    (polishStages === "review" || tailorProviderReady) && (polishStages === "tailor" || reviewProviderReady);
  const candidateFactsContext = buildCandidateFactsContext({
    citizenshipStatus,
    legallyAuthorizedToWork,
    requiresSponsorship,
    educationLevel,
    major
  });
  const requestHonestContext = mergeHonestContext(honestContext, candidateFactsContext);
  // Job analysis runs on its own concrete provider config (synced to other stages via
  // the copy buttons, not a live link). Shared by every job analysis entry point
  // (link, paste, extension import, and their retries).
  const jobAnalysisRequestFields = () => buildStageRequestFields(jobAnalysisStage);
  const [activeOutputTab, setActiveOutputTab] = useState<OutputTab>("prepare");
  const [statusFilter, setStatusFilter] = useState<ApplicationActivityFilter>("all");
  const [trackerView, setTrackerView] = useState<TrackerView>("table");
  const [expandedApplicationId, setExpandedApplicationId] = useState<string | null>(null);
  // Saved-application resume PDF preview ({url,name} → open; null → closed).
  const [resumePreview, setResumePreview] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [isApplicationModalOpen, setIsApplicationModalOpen] = useState(false);
  // null → the modal is in "add" mode; an id → it edits that application.
  const [modalApplicationId, setModalApplicationId] = useState<string | null>(null);
  const applicationOpenInFlightRef = useRef(false);
  // Apply and tracker restore establish one application of record for the
  // current preparation. Manual brief edits must keep targeting that row even
  // though they intentionally make its last-saved job description stale.
  const [applicationOfRecordId, setApplicationOfRecordId] = useState<string | null>(null);

  useEffect(() => {
    const url = resumePreview?.url;
    return () => {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [resumePreview?.url]);

  // Warm the code-split tab chunks once the boot work has quieted down, so a
  // first visit to Applications or Analytics does not start with a fetch. Idle
  // only: never in competition with the initial render or the workspace load.
  useEffect(() => {
    if (typeof window.requestIdleCallback !== "function") {
      const timer = window.setTimeout(() => {
        prefetchOutputTab("applications");
        prefetchOutputTab("analytics");
      }, 2_000);
      return () => window.clearTimeout(timer);
    }
    const handle = window.requestIdleCallback(
      () => {
        prefetchOutputTab("applications");
        prefetchOutputTab("analytics");
      },
      { timeout: 5_000 }
    );
    return () => window.cancelIdleCallback(handle);
  }, []);
  // The Settings dialog's open state AND its active section in one value: null is
  // closed, a section id is open on that section. "Add evidence" opens it directly
  // on Guidance, so the section cannot be private to the dialog.
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  // Ref for the honest-context textarea inside Settings — focused after the dialog
  // is opened by handleAddHonestContext so the user can type immediately.
  const honestContextTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Hidden file input the resume Open menu's "Choose a file" row clicks.
  const resumeFileInputRef = useRef<HTMLInputElement>(null);
  // The PDF rename prompt is opened from the Save menu's PDF row; ExportMenu
  // still owns the dialog itself.
  const [pdfPromptOpen, setPdfPromptOpen] = useState(false);

  // Autosave draft recovery: on mount, check whether a draft was saved that
  // the user may want to restore. Null = no draft; non-null = prompt visible.
  const [pendingAutosaveDraft, setPendingAutosaveDraft] = useState<AutosavedDraft | null>(null);
  // The cover letter's own recovery draft — the two editors recover the same way.
  const [pendingCoverDraft, setPendingCoverDraft] = useState<CoverLetterAutosavedDraft | null>(null);
  // Track whether the resume proposal or job changed since the last audit.
  // When true, show a quiet stale notice in the proposal review.
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
    undoSequence: resumeUndoSequence,
    redoSequence: resumeRedoSequence,
    serializedResume,
    seed: seedResumeEditorDocument,
    seedData: seedResumeDataDocument,
    markClean: markResumeClean,
    actions: resumeEditorActions
  } = useResumeEditor(resumeHistoryClock);
  const typesetEditorRef = useRef<TypesetEditorHandle>(null);
  const resumeFitViewportRef = useRef<HTMLDivElement>(null);
  const [inlineFormat, setInlineFormat] = useState<InlineFormatState>(EMPTY_INLINE_FORMAT);
  // The caret each editor was left at, held across the tab switch that unmounts
  // it. Refs, not state: nothing renders from them, and they are read once by
  // the editor that mounts next.
  const resumeCaretRef = useRef<TypesetCaret | null>(null);
  const coverLetterCaretRef = useRef<TypesetCaret | null>(null);
  // Same idea for the page the user was looking at. Opening a document resets
  // both: a new document has no earlier position.
  const resumeScrollTopRef = useRef(0);
  const coverLetterScrollTopRef = useRef(0);

  // Opening a document — from the workspace, a file, a starter, or the pipeline
  // — puts the user in it at the first line. Wrapping the two seed paths is why
  // no open site has to remember to do this: `seedData`/`seed` are the editor
  // hook's only load paths.
  const seedResumeData = useCallback(
    (data: ResumeData) => {
      seedResumeDataDocument(data);
      resumeCaretRef.current = null;
      resumeScrollTopRef.current = 0;
      typesetEditorRef.current?.focusDocumentStart();
    },
    [seedResumeDataDocument]
  );
  const seedResumeEditor = useCallback(
    (text: string, sourceText?: string) => {
      seedResumeEditorDocument(text, sourceText);
      resumeCaretRef.current = null;
      resumeScrollTopRef.current = 0;
      typesetEditorRef.current?.focusDocumentStart();
    },
    [seedResumeEditorDocument]
  );
  const coverLetterEditorRef = useRef<TypesetEditorHandle>(null);
  const coverLetterEditor = useCoverLetterEditor({
    onOpenDocument: useCallback(() => {
      coverLetterCaretRef.current = null;
      coverLetterScrollTopRef.current = 0;
      coverLetterEditorRef.current?.focusDocumentStart();
    }, [])
  });
  // Aliased next to the editor so every naming path below can use it; the
  // setter itself is a plain useState setter and stable.
  const setCoverLetterTitle = coverLetterEditor.setDocumentTitle;
  const [coverLetterInlineFormat, setCoverLetterInlineFormat] = useState<InlineFormatState>(EMPTY_INLINE_FORMAT);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const currentResumeText = serializedResume || result?.polishedText || "";
  const coverReplacementStateRef = useRef({
    dirty: false,
    version: ""
  });
  coverReplacementStateRef.current = {
    dirty: coverLetterRecoveryDirty({
      documentDirty: coverLetterEditor.dirty,
      documentTitle: coverLetterEditor.documentTitle,
      persistedDocumentTitle: coverLetterEditor.persistedDocumentTitle
    }),
    version: `${coverLetterEditor.draftPayload ?? ""}\u0000${coverLetterEditor.documentTitle}`
  };

  const handleSelectPreparedCoverLetter = useCallback(
    async (fileName: string) => {
      if (
        !fileName ||
        fileName === coverLetterEditor.activeCoverFileName ||
        coverManualVariantSelectionInFlightRef.current
      ) {
        return;
      }
      coverManualVariantSelectionInFlightRef.current = true;
      setIsSelectingCoverVariant(true);
      try {
        if (coverReplacementStateRef.current.dirty && !(await confirmReplaceCoverLetter())) {
          return;
        }
        const approvedVersion = coverReplacementStateRef.current.version;
        const opened = await coverLetterEditor.openWorkspaceCoverLetter(
          fileName,
          false,
          () => coverReplacementStateRef.current.version !== approvedVersion
        );
        if (!opened && coverReplacementStateRef.current.version !== approvedVersion) {
          coverLetterEditor.setStatus(
            "The cover letter changed while that variant was loading. The current draft was kept."
          );
        }
      } finally {
        coverManualVariantSelectionInFlightRef.current = false;
        setIsSelectingCoverVariant(false);
      }
    },
    [
      confirmReplaceCoverLetter,
      coverLetterEditor.activeCoverFileName,
      coverLetterEditor.openWorkspaceCoverLetter,
      coverLetterEditor.setStatus
    ]
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(DOCUMENT_TITLE_STORAGE_KEY, documentTitle.trim() || DEFAULT_DOCUMENT_TITLE);
    } catch {
      // Session storage can be blocked; the in-memory title still works.
    }
  }, [documentTitle]);

  const setImportedJobAndDocumentTitle = useCallback(
    (snapshot: ImportedJobSnapshot | null) => {
      const continuesPreparedSource = Boolean(
        snapshot &&
          importedJob &&
          snapshot.url === importedJob.url &&
          snapshot.sourceText === importedJob.sourceText
      );
      setImportedJob(snapshot);
      // This setter is owned by fresh intake paths. Restoring or editing an
      // existing preparation uses setImportedJob directly. Re-preparing the
      // same captured source also keeps its application-of-record identity.
      if (!continuesPreparedSource) {
        setApplicationOfRecordId(null);
        setMaterialSelection(DEFAULT_MATERIAL_SELECTION);
        setResumeVariantRecommendation(null);
        setCoverLetterVariantRecommendation(null);
      }
      if (!snapshot) return;
      const applicantName = resolveResumeApplicantName(editedResume?.header?.name, currentResumeText || resumeText);
      setDocumentTitle(documentTitleForJob("resume", snapshot.tracking, applicantName));
      // Retitle the letter for the new role too. Leaving it behind would keep the
      // previous company in the letter's name and in every file exported from it.
      setCoverLetterTitle(documentTitleForJob("coverLetter", snapshot.tracking, applicantName));
    },
    [currentResumeText, editedResume?.header?.name, importedJob, resumeText, setCoverLetterTitle]
  );
  const handlePreparedJobTrackingChange = useCallback(
    (field: keyof ExtractedJobTracking, value: string | number | null) => {
      if (!importedJob) return;
      const roleValue = typeof value === "string" ? value : "";
      const rolePatch: Partial<ExtractedJobTracking> =
        field === "role"
          ? { role: roleValue, title: roleValue }
          : ({ [field]: value } as Partial<ExtractedJobTracking>);
      const nextTracking = definedTracking({
        ...importedJob.tracking,
        ...rolePatch
      });
      // Prepare exposes one Role context field. Once the user edits it, keep
      // that value authoritative instead of retaining a hidden, stale context.
      const nextBrief =
        field === "roleDescription" ? { ...importedJob.brief, companyContext: "" } : importedJob.brief;
      const nextTailoringText = assemblePreparedJobTailoringText(nextTracking, nextBrief);
      setImportedJob({
        ...importedJob,
        brief: nextBrief,
        tailoringText: nextTailoringText,
        tracking: nextTracking,
        manualReviewFields: reconcilePreparedJobManualReviewFields(
          nextTracking,
          nextBrief,
          importedJob.manualReviewFields
        )
      });
      setJobDescription(nextTailoringText);
      if (nextTailoringText !== importedJob.tailoringText) setResult(null);
      if (field === "role" || field === "title" || field === "company") {
        const applicantName = resolveResumeApplicantName(editedResume?.header?.name, currentResumeText || resumeText);
        setDocumentTitle(documentTitleForJob("resume", nextTracking, applicantName));
        setCoverLetterTitle(documentTitleForJob("coverLetter", nextTracking, applicantName));
      }
    },
    [currentResumeText, editedResume?.header?.name, importedJob, resumeText, setCoverLetterTitle]
  );
  const handlePreparedJobBriefChange = useCallback(
    (field: PreparedJobBriefField, value: string) => {
      if (!importedJob) return;
      const nextBrief = {
        ...importedJob.brief,
        [field]: preparedJobBriefFieldFromText(field, value)
      };
      const nextManualReviewFields = reconcilePreparedJobManualReviewFields(
        importedJob.tracking,
        nextBrief,
        importedJob.manualReviewFields
      );
      const nextTailoringText = assemblePreparedJobTailoringText(importedJob.tracking, nextBrief);
      setImportedJob({
        ...importedJob,
        brief: nextBrief,
        tailoringText: nextTailoringText,
        manualReviewFields: nextManualReviewFields
      });
      setJobDescription(nextTailoringText);
      if (field !== "benefits" && nextTailoringText !== importedJob.tailoringText) {
        setResult(null);
      }
    },
    [importedJob]
  );
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
  const docStyle = useDocStyle(resumeHistoryClock);
  const resumeDocumentDirty = resumeEdited || docStyle.dirty;
  const resumeDocumentVersion = useMemo(
    () => resumeDocumentVersionFor(editedResume, docStyle.style),
    [docStyle.style, editedResume]
  );
  const resumeReplacementStateRef = useRef({
    dirty: resumeDocumentDirty,
    version: resumeDocumentVersion
  });
  resumeReplacementStateRef.current = {
    dirty: resumeDocumentDirty,
    version: resumeDocumentVersion
  };
  const resumeReplacementGuard = useMemo(
    () => ({
      isDirtyNow: () => resumeReplacementStateRef.current.dirty,
      currentVersion: () => resumeReplacementStateRef.current.version,
      confirmReplacement: () =>
        confirm({
          title: "Replace resume?",
          message: "Replace the resume in the editor? Unsaved edits will be lost.",
          confirmLabel: "Replace"
        }),
      onReplacementCommitted: () => {
        clearAutosaveDraft();
        setPendingAutosaveDraft(null);
      }
    }),
    [confirm]
  );
  const markResumeDocumentClean = useCallback(() => {
    markResumeClean();
    docStyle.markClean();
  }, [docStyle.markClean, markResumeClean]);
  const markResumeApplicationSaved = useCallback(() => {
    clearAutosaveDraft();
    markResumeDocumentClean();
  }, [markResumeDocumentClean]);
  const globalAlignments = useMemo(
    () => (editedResume ? globalAlignmentState(editedResume, docStyle.style) : null),
    [docStyle.style, editedResume]
  );
  const styleMarkStates = useMemo(
    () => (editedResume ? styleFieldMarkStates(editedResume) : undefined),
    [editedResume]
  );
  const styleFontStates = useMemo(
    () => (editedResume ? styleFieldFontStates(editedResume, docStyle.style.fontFamily) : undefined),
    [docStyle.style.fontFamily, editedResume]
  );
  const styleSizeStates = useMemo(
    () => (editedResume ? styleFieldSizeStates(editedResume, docStyle.style.baseFontSizePt) : undefined),
    [docStyle.style.baseFontSizePt, editedResume]
  );
  const fitResumePage = useCallback(() => {
    const pane = resumeFitViewportRef.current;
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

  // Analyze the job once per (description, url, import) instead of on every
  // render. The full extractJobPosting parser is ~1500 LOC; running it in the
  // component body (the cover letter, materialsJobTarget, presence label, and the
  // apply/export callers below) re-parsed the JD on every keystroke-driven
  // re-render. Memoizing matches the debounce discipline the scoring path already
  // uses, with no behavior change.
  const jobTracking = useMemo((): ExtractedJobTracking => {
    const imported =
      importedJob && importedJob.url === jobUrl.trim() && importedJob.tailoringText === jobDescription.trim()
        ? importedJob.tracking
        : null;
    // The import (AI or deterministic) is the authoritative job analysis output. Don't
    // re-parse the compact scaffold and merge — that would let a stray number or
    // label in a bullet resurrect a field the job analyzer deliberately left empty
    // (e.g. a $5M budget figure becoming the salary). Only re-parse when there is
    // no matching import (user typed a raw JD straight into the box).
    return imported
      ? definedTracking(imported)
      : definedTracking(extractJobPosting(jobDescription, { url: jobUrl }).tracking);
  }, [jobDescription, jobUrl, importedJob]);

  // Keep browser tabs distinguishable when several applications are open.
  // The shared analyzed metadata is authoritative, so imported and manually
  // entered jobs use the same Company - Role - RoleFit AI format.
  useEffect(() => {
    document.title = browserTabTitle(jobTracking);
    return () => {
      document.title = "RoleFit AI";
    };
  }, [jobTracking.company, jobTracking.role]);

  // The job and workspace resume load independently. If job intake initially
  // produced a partial automatic title, complete it when either side of the
  // structured identity becomes available. Only known automatic fallbacks are
  // eligible, so a title the user edited remains untouched.
  useEffect(() => {
    const applicantName = resolveResumeApplicantName(editedResume?.header?.name, resumeText);
    const company = (jobTracking.company ?? "").trim();
    if (!applicantName && !company) return;
    setDocumentTitle((current) =>
      completeAutoDocumentTitle("resume", current, applicantName, company, [DEFAULT_DOCUMENT_TITLE])
    );
  }, [editedResume?.header?.name, jobTracking.company, resumeText]);

  // The letter follows the same naming rule (Name_Company_Cover_Letter), so a
  // resume and its letter for one role read as one application. Partial identity
  // is enough here — the letter has no second automatic naming path to complete.
  useEffect(() => {
    const applicantName = resolveResumeApplicantName(editedResume?.header?.name, resumeText);
    const company = (jobTracking.company ?? "").trim();
    if (!applicantName && !company) return;
    setCoverLetterTitle((current) =>
      completeAutoDocumentTitle("coverLetter", current, applicantName, company, COVER_LETTER_TITLE_PLACEHOLDERS)
    );
  }, [editedResume?.header?.name, jobTracking.company, resumeText, setCoverLetterTitle]);

  // Derive a short job-label for the autosave + cross-tab presence context (role
  // + company only — never the full JD body). Uses the shared `jobTracking` so
  // the label matches the AI-analyzed role/company shown elsewhere in the app,
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
    docStyle: docStyle.style,
    dirty: resumeDocumentDirty,
    jobLabel: _autosaveJobLabel,
    pipelineAiUsage,
    jobRawText,
    getJobKeyHash: () => duplicateGuard.currentJobKeyHash()
  });

  // The letter's equivalent: its unsaved edits are kept in their own recoverable
  // draft rather than only warning that the document is unsaved.
  const coverDraftAutosaveState = useCoverLetterAutosaveDraft({
    payload: coverLetterEditor.draftPayload,
    documentTitle: coverLetterEditor.documentTitle,
    persistedDocumentTitle: coverLetterEditor.persistedDocumentTitle,
    dirty: coverLetterEditor.dirty,
    jobLabel: _autosaveJobLabel
  });

  const {
    applications,
    isLoading: isApplicationsLoading,
    hasLoadedApplications,
    error: applicationsError,
    pendingWrites: pendingApplicationWrites,
    upsert: upsertApplication,
    saveApplication,
    updateStatus: updateApplicationStatus,
    updateNotes: updateApplicationNotes,
    updateField: updateApplicationField,
    remove: removeApplication,
    getApplication,
    storagePath: applicationsPath,
    findForTarget,
    findDuplicatesForTarget,
    mergeApplications,
    dismissDuplicateGroup,
    refresh: refreshApplications
  } = useApplications();

  const applicationFiles = useApplicationFiles({
    getApplication,
    refreshApplications
  });

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
  const preparedSnapshotMatchesInputs = Boolean(
    importedJob &&
      importedJob.url === jobUrl.trim() &&
      importedJob.tailoringText === jobDescription.trim()
  );
  const preparedApplicationJobDescription = preparedSnapshotMatchesInputs && importedJob
    ? assemblePreparedJobApplicationText(importedJob.tracking, importedJob.brief)
    : jobDescription.trim();

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
    applicationJobDescription: preparedApplicationJobDescription,
    applicationRawJobDescription: jobRawText,
    applicationTracking: jobTracking,
    linkedApplication:
      applicationOfRecordId !== null
        ? (applications.find((application) => application.id === applicationOfRecordId) ?? null)
        : null,
    jobUrl,
    honestContext: requestHonestContext,
    customInstructions: customInstructionsFor("answers"),
    aiRequest: stages.answers,
    providerReady: answersProviderReady,
    providerMessage: answersProviderMessage,
    upsertApplication,
    findForTarget
  });

  // Cover tailoring stages a whole-document proposal. The dedicated editor
  // remains the single owner for accepted text, direct edits, file lifecycle,
  // the pre-acceptance Restore snapshot, and application save.
  const {
    coverLetterText,
    resetCoverWorkflow,
    applyPolishCoverResult,
    coverStatus,
    isGeneratingCover,
    handleTailorCoverLetter,
    coverProgress,
    dismissCoverProgress,
    preflight: coverLetterPreflight,
    updateDetail: updateCoverLetterDetail,
    slotAnswers: coverLetterSlotAnswers,
    updateSlotAnswer: updateCoverLetterSlotAnswer,
    proposal: coverLetterProposal,
    acceptProposal: acceptCoverLetterProposal,
    discardProposal: discardCoverLetterProposal,
    lastAppliedResult: appliedCoverLetterResult,
    failure: coverLetterFailure
  } = useCoverLetter({
    currentCoverLetterText: coverLetterEditor.text,
    currentResumeText,
    resumeData: editedResume,
    jobText: jobDescription,
    honestContext: requestHonestContext,
    customInstructions: customInstructionsFor("cover"),
    aiRequest: stages.cover,
    providerReady: coverProviderReady,
    providerMessage: coverProviderMessage,
    resumeText,
    sourceRevision: coverLetterEditor.sourceRevision,
    tailorApplied: coverLetterEditor.canRestorePreTailor,
    candidateName: resolveResumeApplicantName(
      coverLetterEditor.data.header?.name || editedResume?.header?.name,
      currentResumeText || resumeText
    ),
    jobTarget: {
      role: jobTracking.role || jobTracking.title,
      company: jobTracking.company
    },
    onApplyTailored: coverLetterEditor.applyTailoredText,
    onApplyExternal: coverLetterEditor.applyExternalText,
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
    const coverDraft = recoverCoverLetterAutosaveDraft();
    if (coverDraft) setPendingCoverDraft(coverDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the user starts editing, the on-mount restore bar is offering a draft
  // the autosave has since overwritten — dismiss it so it can't advertise (and,
  // on click, reseed) stale text over the fresher edits.
  useEffect(() => {
    if (resumeDocumentDirty) setPendingAutosaveDraft(null);
  }, [resumeDocumentDirty]);

  useEffect(() => {
    if (coverLetterEditor.dirty) setPendingCoverDraft(null);
  }, [coverLetterEditor.dirty]);

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

  // Stale AI output: when the JD changes after Tailor or Review, that result
  // describes the old posting. Track whether the text still matches what the
  // result was based on, including valid Tailor runs with zero suggestions.
  const lastPolishedJobRef = useRef<string>("");
  useEffect(() => {
    if (!result) return;
    // result changed (new polish) — record the current JD as "last polished JD".
    lastPolishedJobRef.current = jobDescription;
    setReviewStale(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  useEffect(() => {
    // Any AI result is bound to its job input, even when Tailor correctly found
    // zero suggestions and there is no strict Review payload.
    if (!result) return;
    if (result.source !== "ai") return;
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
  const resumeHasContent = Boolean((currentResumeText || resumeText).trim().length > 0);
  const resumeReady = Boolean((currentResumeText || resumeText).trim().length > 80);
  const coverLetterReady =
    coverLetterPreflight.authoredWordCount >= 40 && coverLetterPreflight.template.slots.length === 0;
  // A usable application starts with a completed intake snapshot. Nonempty
  // source text alone is not enough: editing either source field invalidates
  // the snapshot until Prepare runs again.
  const jobPrepared = Boolean(
    preparedSnapshotMatchesInputs &&
    importedJob &&
    importedJob.tailoringText.length > 40
  );
  // Everything except provider readiness. Every stage selection needs these —
  // buildPolishContext requires an editable Tailor scope even for Review only —
  // so this gates the Polish trigger while selectedPolishProvidersReady gates
  // only the providers that the remembered workflow will call.
  const polishInputsReady = useMemo(() => {
    return Boolean(
      jobPrepared &&
      editedResume &&
      resumeReady &&
      Object.values(tailorModes).some((mode) => mode === "tailor") &&
      jobDescription.trim().length > 40
    );
  }, [editedResume, jobDescription, jobPrepared, resumeReady, tailorModes]);
  const canPolish = polishInputsReady && selectedPolishProvidersReady;

  // The edited resume is debounced before the diff recompute so typing in the
  // editor stays smooth (the editor preview itself updates live).
  const debouncedCurrentResumeText = useDebouncedValue(currentResumeText);
  const debouncedPreparedJobDescription = useDebouncedValue(jobDescription);

  // Every review-score/diff derivation the UI shows is pure (read-only) and lives
  // in useResumeAnalysis, so it stays decoupled from App's setters.
  const { resumeDiff, fitComparison, headlineScore, jobConstraints } = useResumeAnalysis({
    resumeText,
    jobDescription,
    debouncedCurrentResumeText,
    // Gate AI fit provenance on FREE edits only. Accepting reviewed suggestions
    // keeps the score attached to the proposal the reviewer judged.
    isEdited: resumeManuallyEdited,
    result
  });

  // ----- Derived (non-memo) -----
  const jobReady = jobPrepared;
  // Quiet target label for the Materials tab plan rail header.
  // Only derived when a job description is present; never invents content.
  const materialsJobTarget =
    jobReady && (jobTracking.role || jobTracking.company)
      ? { role: jobTracking.role, company: jobTracking.company }
      : undefined;
  // Exports work from the structured editor model (the same faithful path as the
  // compile preview), so they unlock as soon as a resume is loaded — not only
  // after an AI polish.
  const canExportResume = resumeHasContent;
  // Same rule for the letter: exportable as soon as it has content. Apply's own
  // readiness gate (coverLetterReady) still governs whether it can be included.
  const canExportCoverLetter = Boolean(coverLetterEditor.text.trim());
  // ----- Resume export (engine PDF / .resume save) -----
  const {
    isRenderingPdf,
    resetStatuses: resetExportStatuses,
    handleDownloadPdf,
    handleDownloadResume,
    resumeDownloadName,
    getResumeArtifacts,
    applicationSourceText: currentResumeSource
  } = useResumeExport({
    editedResume,
    currentResumeText,
    documentTitle,
    jobUrl,
    // Name downloads after the same company the application is saved with
    // (analyzed from the posting), not just a URL guess. Thunk: currentJobTracking
    // is a hoisted declaration, evaluated lazily at save time.
    resolveJobCompany: () => currentJobTracking().company ?? "",
    coverLetterText,
    resumeText,
    docStyle: docStyle.style,
    setExportStatus
  });

  // ----- Job intake (job analysis/import flows) -----
  // Link analysis, pasted-posting analysis, the browser-extension inbox import, and
  // each entry point's Retry — extracted to
  // src/hooks/useJobIntake.ts. isExtractingLink/jobAnalysisProgress/
  // jobAnalysisProgressVisible/jobAnalysisRetry are owned by the hook; App only reads
  // them below for render + the presence phase + the before-unload guard.
  const {
    isExtractingLink,
    extensionImportPhase,
    jobAnalysisProgress,
    jobAnalysisProgressVisible,
    dismissJobAnalysisProgress,
    jobAnalysisRetry,
    handleManualJobDescriptionChange,
    handleExtractFromLink,
    handleAnalyzePaste
  } = useJobIntake({
    jobUrl,
    setJobUrl,
    jobDescription,
    setJobDescription,
    setImportedJob: setImportedJobAndDocumentTitle,
    setResult,
    resetCoverWorkflow,
    setPipelineAiUsage,
    setJobRawText,
    setPolishStatus,
    setLinkStatus,
    onExtensionPrepareStarted: () => setActiveOutputTab("prepare"),
    onExtensionJobReceived: () => setActiveOutputTab("prepare"),
    confirmDuplicateBeforeJobAnalysis: duplicateGuard.confirmDuplicateBeforeJobAnalysis,
    confirmDuplicateAfterJobAnalysis: duplicateGuard.confirmDuplicateAfterJobAnalysis,
    jobAnalysisRequestFields,
    ensureProviderReady: ensureJobAnalysisProvider,
    extensionImportsReady: hasLoadedApplications,
  });
  const jobPreparationActive =
    isExtractingLink || extensionImportPhase !== null || jobAnalysisProgress.status === "running";

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
    includeCoverLetter: false,
    requestHonestContext,
    customInstructionsFor,
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
  if (jobAnalysisProgressVisible) {
    aiWorkflowStages.push({
      key: "job-analysis",
      state: jobAnalysisProgress,
      onRetry: jobAnalysisRetry
    });
  }
  if (polishProgressVisible) {
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
    dismissJobAnalysisProgress();
    setPolishProgressVisible(false);
  }

  // Cross-tab presence: each browser tab is an independent tailoring session, so
  // we publish this tab's coarse phase (derived from existing flow state — never
  // instrumented into the stage runners) and read back the OTHER live tabs for
  // the shared in-progress card. Privacy: only the role · company label leaves
  // the tab, never JD/resume text.
  const _myPhase: PresencePhase =
    jobAnalysisProgress.status === "running"
      ? "analyzing-job"
      : isPolishing
        ? polishStages === "review"
          ? "reviewing"
          : polishStages === "tailor"
            ? "tailoring"
            : "tailoring+reviewing"
        : resumeDocumentDirty
          ? "editing"
          : "idle";
  const otherSessions = useTabPresence({
    jobLabel: _autosaveJobLabel,
    phase: _myPhase
  });

  // Warn before close/reload when there are unsaved edits OR a job analysis/tailor/
  // review is mid-flight (losing an in-progress run is as costly as losing edits).
  // Apply marks each included document clean only after its source persists.
  useBeforeUnloadGuard(
    resumeDocumentDirty ||
      coverLetterEditor.dirty ||
      isGeneratingCover ||
      isPolishing ||
      jobAnalysisProgress.status === "running" ||
      pendingApplicationWrites > 0
  );

  // ----- Handlers -----

  // The workspace / base-resume cluster (state + handlers) lives in
  // useWorkspaceResume; App passes in the editor/export/dialog dependencies it
  // needs and reads back the workspace state + the handlers the Open menu wires up.
  const {
    baseResumeName,
    baseResumeOptions,
    baseResumeHistory,
    baseResumeCandidatesRevision,
    workspaceStatus,
    isSavingBaseResume,
    isWorkspaceBootstrapping,
    loadWorkspace,
    loadStarterTemplate,
    startBlankResume,
    restoreBaseResume,
    saveCurrentAsBaseResume,
    loadBaseResumeVersion,
    readBaseResumeCandidates,
    detachBaseResumeIdentity,
    handleFileUpload
  } = useWorkspaceResume({
    confirm,
    replacementGuard: resumeReplacementGuard,
    seedResumeEditor,
    fileName,
    setResumeText,
    setFileName,
    setDocumentTitle,
    setResult,
    resetCoverWorkflow,
    setFileError,
    setFileStatus,
    setPolishStatus,
    resetExportStatuses,
    setExportStatus,
    seedResumeData,
    currentResumeText,
    resumeText,
    editedResume,
    docStyle
  });

  const handleSelectBaseResumeVariant = useCallback(
    async (fileName: string) => {
      if (
        !fileName ||
        fileName === baseResumeName ||
        resumeManualVariantSelectionInFlightRef.current
      ) {
        return;
      }
      resumeManualVariantSelectionInFlightRef.current = true;
      setIsManuallySelectingResumeVariant(true);
      try {
        await loadBaseResumeVersion(fileName);
      } finally {
        resumeManualVariantSelectionInFlightRef.current = false;
        setIsManuallySelectingResumeVariant(false);
      }
    },
    [baseResumeName, loadBaseResumeVersion]
  );

  const workspaceRestoreAdoptionHandlerRef = useRef<() => void>(() => undefined);
  workspaceRestoreAdoptionHandlerRef.current = () => {
    if (resumeDocumentDirty) {
      setLinkStatus(
        "A workspace restore finished in another window. Your unsaved resume remains preserved in this tab."
      );
    } else {
      // A sibling restore refreshes workspace choices only. Automatically
      // applying its base document would race with edits begun after this
      // event but before the workspace response returns.
      void loadWorkspace(false);
      setLinkStatus("Workspace restored in another window. Refreshed saved resume options.");
    }
    const coverDocumentDirty =
      coverLetterEditor.dirty || coverLetterEditor.documentTitle !== coverLetterEditor.persistedDocumentTitle;
    coverLetterEditor.setStatus(
      coverDocumentDirty
        ? "A workspace restore finished in another window. Your unsaved cover letter remains preserved in this tab."
        : "Workspace restored in another window. Reopen a saved cover letter to use the restored copy."
    );
  };
  useEffect(
    () =>
      subscribeWorkspaceRestoreAdoption(() => {
        workspaceRestoreAdoptionHandlerRef.current();
      }),
    []
  );

  // The friendly name of the base resume currently loaded. Both the Open menu's
  // description and the Save menu's "update this base" row name it, so it is
  // derived once here rather than recomputed at each call site.
  const activeBaseResumeLabel =
    baseResumeOptions.find((option) => option.fileName === baseResumeName)?.label || baseResumeName;

  const rankingJobDescription = debouncedPreparedJobDescription.trim();
  const resumeVariantRecommendationInputKey =
    jobPrepared && rankingJobDescription === jobDescription.trim() && baseResumeOptions.length > 1
      ? JSON.stringify({
          job: rankingJobDescription,
          variants: baseResumeOptions.map((option) => option.fileName),
          candidatesRevision: baseResumeCandidatesRevision
        })
      : "";
  const resumeVariantSelectionStateRef = useRef({
    baseResumeName,
    resumeDocumentDirty,
    documentVersion: resumeReplacementStateRef.current.version,
    isWorkspaceBootstrapping,
    isSavingBaseResume,
    applicationOfRecordId,
    jobPrepared,
    preparedJobDescription: jobDescription.trim(),
    options: baseResumeOptions,
    loadBaseResumeVersion
  });
  resumeVariantSelectionStateRef.current = {
    baseResumeName,
    resumeDocumentDirty,
    documentVersion: resumeReplacementStateRef.current.version,
    isWorkspaceBootstrapping,
    isSavingBaseResume,
    applicationOfRecordId,
    jobPrepared,
    preparedJobDescription: jobDescription.trim(),
    options: baseResumeOptions,
    loadBaseResumeVersion
  };

  useEffect(() => {
    if (!resumeVariantRecommendationInputKey) {
      resumeVariantRecommendationKeyRef.current = "";
      resumeVariantRecommendationGenerationRef.current += 1;
      setResumeVariantRecommendation(null);
      setIsRankingResumeVariants(false);
      return;
    }
    if (resumeVariantRecommendationKeyRef.current === resumeVariantRecommendationInputKey) {
      return;
    }

    resumeVariantRecommendationKeyRef.current = resumeVariantRecommendationInputKey;
    const generation = resumeVariantRecommendationGenerationRef.current + 1;
    resumeVariantRecommendationGenerationRef.current = generation;
    const startState = resumeVariantSelectionStateRef.current;
    const startingBaseResumeName = startState.baseResumeName;
    const startingDocumentVersion = startState.documentVersion;
    const options = startState.options;
    setIsRankingResumeVariants(true);
    setResumeVariantRecommendation(null);

    void (async () => {
      const candidates = await readBaseResumeCandidates(options);
      if (
        generation !== resumeVariantRecommendationGenerationRef.current ||
        !resumeVariantSelectionStateRef.current.jobPrepared ||
        resumeVariantSelectionStateRef.current.preparedJobDescription !== rankingJobDescription
      ) {
        return;
      }
      const recommendation = recommendVariant(rankingJobDescription, candidates, options.length);
      setResumeVariantRecommendation(recommendation);

      const current = resumeVariantSelectionStateRef.current;
      const canAdoptRecommendation =
        recommendation !== null &&
        current.preparedJobDescription === rankingJobDescription &&
        recommendation.fileName !== current.baseResumeName &&
        current.baseResumeName === startingBaseResumeName &&
        current.documentVersion === startingDocumentVersion &&
        current.applicationOfRecordId === null &&
        !current.resumeDocumentDirty &&
        !resumeManualVariantSelectionInFlightRef.current &&
        !current.isWorkspaceBootstrapping &&
        !current.isSavingBaseResume;
      if (canAdoptRecommendation) {
        await current.loadBaseResumeVersion(recommendation.fileName, true, () => {
          const latest = resumeVariantSelectionStateRef.current;
          return (
            generation !== resumeVariantRecommendationGenerationRef.current ||
            !latest.jobPrepared ||
            latest.preparedJobDescription !== rankingJobDescription ||
            latest.applicationOfRecordId !== null ||
            latest.documentVersion !== startingDocumentVersion ||
            latest.resumeDocumentDirty ||
            latest.baseResumeName !== startingBaseResumeName ||
            resumeManualVariantSelectionInFlightRef.current
          );
        });
      }
      if (generation === resumeVariantRecommendationGenerationRef.current) {
        setIsRankingResumeVariants(false);
      }
    })();

    return () => {
      if (generation === resumeVariantRecommendationGenerationRef.current) {
        resumeVariantRecommendationGenerationRef.current += 1;
      }
    };
  }, [readBaseResumeCandidates, rankingJobDescription, resumeVariantRecommendationInputKey]);

  // Cover letters follow the same rule as resumes: select a meaningful unique
  // winner, but only while the current editor is clean and not application-owned.
  const coverLetterVariantRecommendationInputKey =
    jobPrepared &&
    rankingJobDescription === jobDescription.trim() &&
    coverLetterEditor.coverLetterOptions.length > 1
      ? JSON.stringify({
          job: rankingJobDescription,
          variants: coverLetterEditor.coverLetterOptions.map((option) => option.fileName),
          candidatesRevision: coverLetterEditor.coverLetterCandidatesRevision
        })
      : "";
  const coverLetterVariantOptionsRef = useRef(coverLetterEditor.coverLetterOptions);
  coverLetterVariantOptionsRef.current = coverLetterEditor.coverLetterOptions;
  const readCoverLetterVariantCandidates = coverLetterEditor.readCoverLetterVariantCandidates;
  const openWorkspaceCoverLetter = coverLetterEditor.openWorkspaceCoverLetter;
  const coverLetterVariantSelectionStateRef = useRef({
    activeFileName: coverLetterEditor.activeCoverFileName,
    dirty: coverReplacementStateRef.current.dirty,
    documentVersion: coverReplacementStateRef.current.version,
    isSelecting: isSelectingCoverVariant,
    applicationOfRecordId,
    jobPrepared,
    preparedJobDescription: jobDescription.trim(),
    openWorkspaceCoverLetter
  });
  coverLetterVariantSelectionStateRef.current = {
    activeFileName: coverLetterEditor.activeCoverFileName,
    dirty: coverReplacementStateRef.current.dirty,
    documentVersion: coverReplacementStateRef.current.version,
    isSelecting: isSelectingCoverVariant,
    applicationOfRecordId,
    jobPrepared,
    preparedJobDescription: jobDescription.trim(),
    openWorkspaceCoverLetter
  };

  useEffect(() => {
    if (!coverLetterVariantRecommendationInputKey) {
      coverLetterVariantRecommendationKeyRef.current = "";
      coverLetterVariantRecommendationGenerationRef.current += 1;
      setCoverLetterVariantRecommendation(null);
      setIsRankingCoverLetterVariants(false);
      return;
    }
    if (coverLetterVariantRecommendationKeyRef.current === coverLetterVariantRecommendationInputKey) {
      return;
    }

    coverLetterVariantRecommendationKeyRef.current = coverLetterVariantRecommendationInputKey;
    const generation = coverLetterVariantRecommendationGenerationRef.current + 1;
    coverLetterVariantRecommendationGenerationRef.current = generation;
    const startingFileName = coverLetterVariantSelectionStateRef.current.activeFileName;
    const startingDocumentVersion = coverLetterVariantSelectionStateRef.current.documentVersion;
    const options = coverLetterVariantOptionsRef.current;
    setIsRankingCoverLetterVariants(true);
    setCoverLetterVariantRecommendation(null);

    void (async () => {
      const candidates = await readCoverLetterVariantCandidates(options);
      if (generation !== coverLetterVariantRecommendationGenerationRef.current) return;
      // A cover letter's usable floor is its own: a real one-paragraph letter is
      // shorter than the stub length that disqualifies a resume.
      const recommendation = recommendVariant(rankingJobDescription, candidates, options.length, 40);
      setCoverLetterVariantRecommendation(recommendation);

      const current = coverLetterVariantSelectionStateRef.current;
      const canAdoptRecommendation =
        recommendation !== null &&
        current.preparedJobDescription === rankingJobDescription &&
        recommendation.fileName !== current.activeFileName &&
        current.activeFileName === startingFileName &&
        current.documentVersion === startingDocumentVersion &&
        current.applicationOfRecordId === null &&
        !current.dirty &&
        !coverManualVariantSelectionInFlightRef.current &&
        !current.isSelecting;
      if (canAdoptRecommendation) {
        await current.openWorkspaceCoverLetter(recommendation.fileName, "recommendation", () => {
          const latest = coverLetterVariantSelectionStateRef.current;
          return (
            generation !== coverLetterVariantRecommendationGenerationRef.current ||
            !latest.jobPrepared ||
            latest.preparedJobDescription !== rankingJobDescription ||
            latest.applicationOfRecordId !== null ||
            latest.dirty ||
            latest.activeFileName !== startingFileName ||
            latest.documentVersion !== startingDocumentVersion ||
            coverManualVariantSelectionInFlightRef.current
          );
        });
      }
      if (generation === coverLetterVariantRecommendationGenerationRef.current) {
        setIsRankingCoverLetterVariants(false);
      }
    })();

    return () => {
      if (generation === coverLetterVariantRecommendationGenerationRef.current) {
        coverLetterVariantRecommendationGenerationRef.current += 1;
      }
    };
  }, [
    coverLetterVariantRecommendationInputKey,
    rankingJobDescription,
    readCoverLetterVariantCandidates
  ]);

  const applicationPreparationActive =
    jobPreparationActive ||
    (materialSelection.resume &&
      (isPolishing ||
        isRankingResumeVariants ||
        isSavingBaseResume ||
        isManuallySelectingResumeVariant ||
        isWorkspaceBootstrapping)) ||
    (materialSelection.coverLetter &&
      (isGeneratingCover || isRankingCoverLetterVariants || isSelectingCoverVariant));
  const preparationReadiness = getPreparationReadiness({
    jobPrepared,
    includeResume: materialSelection.resume,
    resumeReady,
    includeCoverLetter: materialSelection.coverLetter,
    coverLetterReady,
    isPreparing: applicationPreparationActive
  });
  function handleTailorPreparedResume() {
    if (
      !jobPrepared ||
      !canPolish ||
      isPolishing ||
      isSavingBaseResume ||
      isManuallySelectingResumeVariant ||
      isRankingResumeVariants
    ) return;
    // This click is explicit: it tailors exactly the resume currently shown;
    // loading a different variant remains protected by useWorkspaceResume's
    // dirty-document confirmation.
    void handlePolish({ revealResumeOnSuccess: false });
  }

  // Called from the document review rails when a candidate claim needs evidence.
  // Appends a template line to honestContext (unless the keyword is already there),
  // then opens Settings on Guidance so the user can fill it in and re-run Polish.
  function handleAddHonestContext(keyword: string) {
    const alreadyPresent = honestContext.toLowerCase().includes(keyword.toLowerCase());
    if (!alreadyPresent) {
      const template = `${keyword}: [describe your exact experience: what you did, where, and when]`;
      setHonestContext(honestContext ? `${honestContext}\n${template}` : template);
    }
    setSettingsSection("guidance");
    // Give the dialog one frame to render before trying to focus the textarea.
    // This deliberately beats the dialog's own initial focus on the close button.
    window.requestAnimationFrame(() => {
      honestContextTextareaRef.current?.focus();
    });
    setPolishStatus(`Added an evidence prompt for "${keyword}". Fill it in, then Polish again.`);
  }

  // Settings' reset is destructive to preferences (providers, guidance, and the
  // declared candidate facts), so it confirms first. Documents and tracked
  // applications live in the workspace and are not touched.
  async function handleResetSettings() {
    const confirmed = await confirm({
      title: "Reset all settings?",
      message:
        "This clears your AI providers and models, honest context, custom instructions, and the facts in About you. Resumes, cover letters, and tracked applications are not affected.",
      confirmLabel: "Reset settings",
      tone: "danger"
    });
    if (confirmed) resetSettings();
  }

  // Reads the memoized job analysis above (apply/export callers run at click time,
  // so the value is always current); kept as a function for call-site stability.
  function currentJobTracking(): ExtractedJobTracking {
    return jobTracking;
  }

  // Per-document application saves. Apply snapshots only the selected package;
  // afterwards each editor keeps its own saved/unsaved state and explicit
  // "Update application" action in its Save menu.
  const {
    application: preparedApplication,
    linkApplication,
    resume: resumeApplicationSync,
    coverLetter: coverLetterApplicationSync
  } = useApplicationDocumentSync({
    applications,
    findForTarget,
    jobUrl,
    jobDescription: preparedApplicationJobDescription,
    currentResumeText,
    currentResumeSource,
    resumeDocumentVersion: resumeReplacementStateRef.current.version,
    coverLetterText: coverLetterEditor.text,
    currentCoverLetterSource: coverLetterEditor.draftPayload ?? "",
    coverLetterDocumentVersion: coverReplacementStateRef.current.version,
    saveApplicationDocument: applicationFiles.saveDocument,
    getResumeArtifacts,
    getCoverLetterArtifacts: coverLetterEditor.getArtifacts,
    onResumeSaved: markResumeApplicationSaved,
    onCoverLetterSaved: coverLetterEditor.markApplicationSaved,
    preserveLinkedApplication: applicationOfRecordId !== null && jobPrepared
  });
  const linkPreparedApplication = useCallback(
    (id: string | null) => {
      setApplicationOfRecordId(id);
      linkApplication(id);
    },
    [linkApplication]
  );
  const polishOutputCurrent = result?.source === "ai" && !reviewStale && !resumeManuallyEdited;
  const currentReviewAvailable = polishOutputCurrent && Boolean(result?.strictReview);
  const savedApplicationReviewAvailable = Boolean(
    jobPrepared &&
      preparedApplication?.review &&
      (preparedApplication.jobDescription ?? "").trim() ===
        preparedApplicationJobDescription.trim()
  );
  const prepareReviewGaps =
    currentReviewAvailable && result?.strictReview
      ? result.strictReview.gaps
      : savedApplicationReviewAvailable
        ? preparedApplication?.review?.gaps ?? []
        : [];
  const prepareReviewGapsProvenance = currentReviewAvailable
    ? "current"
    : savedApplicationReviewAvailable
      ? "saved"
      : "none";
  const savedApplicationFitVerdict =
    savedApplicationReviewAvailable && preparedApplication
      ? appFitVerdict(preparedApplication)
      : null;
  const prepareFitAssessment =
    currentReviewAvailable && result?.strictReview
      ? {
          verdict: result.strictReview.verdict,
          score: headlineScore,
          reason: result.strictReview.verdictReason,
          provenance: "current" as const
        }
      : savedApplicationReviewAvailable && preparedApplication && savedApplicationFitVerdict
        ? {
            verdict: savedApplicationFitVerdict.verdict,
            score: fitScore(preparedApplication),
            reason: preparedApplication.review?.verdictReason ?? "",
            provenance: "saved" as const
          }
        : null;

  // The Apply flow (download-prompt state + commitApply/handleApply/
  // handleApplyDownloadPick/handleApplyOnly/saveAppliedDocumentArtifacts) lives in
  // useApplyFlow; App passes in the job/resume/result/export/duplicate-guard
  // dependencies it needs and reads back the download-prompt state + handlers
  // the Apply button and ApplyDownloadDialog wire up.
  const {
    applyMergeTargetRef,
    applyMaterialSelectionRef,
    applyDownloadPrompt,
    setApplyDownloadPrompt,
    isApplying,
    applySaveError,
    handleApply,
    handleApplyDownloadPick,
    handleApplyOnly
  } = useApplyFlow({
    canApply: preparationReadiness.canApply,
    applyBlocker: preparationReadiness.primaryBlocker,
    includeResume: materialSelection.resume,
    includeCoverLetter: materialSelection.coverLetter,
    jobUrl,
    preparedJobDescription: preparedApplicationJobDescription,
    jobRawText,
    result,
    currentResumeText,
    headlineScore,
    fitComparison,
    pipelineAiUsage,
    applications,
    linkedApplicationId: applicationOfRecordId,
    findForTarget,
    persistAppliedApplication: saveApplication,
    saveApplicationDocument: applicationFiles.saveDocument,
    linkApplication: linkPreparedApplication,
    currentJobTracking,
    resolveApplyDuplicate: duplicateGuard.resolveApplyDuplicate,
    // Stricter than canExportResume: the engine typesets the structured model
    // only, so a text-only polish result has nothing to put in the PDF prompt.
    canExportResumePdf: Boolean(editedResume),
    canExportCoverLetter,
    handleDownloadPdf,
    handleDownloadCoverLetterPdf: coverLetterEditor.downloadPdf,
    getResumeArtifacts,
    getCoverLetterArtifacts: coverLetterEditor.getArtifacts,
    resumeDocumentVersion: resumeReplacementStateRef.current.version,
    coverLetterDocumentVersion: coverReplacementStateRef.current.version,
    onResumeSaved: markResumeApplicationSaved,
    onCoverLetterSaved: coverLetterEditor.markApplicationSaved,
    setApplyStatus,
    setActiveOutputTab,
    setExpandedApplicationId
  });

  async function handleLoadApplication(app: Application): Promise<boolean> {
    if (applicationOpenInFlightRef.current) return false;
    applicationOpenInFlightRef.current = true;
    try {
      if (resumeReplacementStateRef.current.dirty || coverReplacementStateRef.current.dirty) {
        if (!(await confirmReplaceApplicationDraft())) return false;
      }
      const approvedResumeVersion = resumeReplacementStateRef.current.version;
      const approvedCoverVersion = coverReplacementStateRef.current.version;

      // Strict application sources are authoritative for editor content and
      // style. Validate both before replacing either current editor.
      let savedResumeSource: ReturnType<typeof parseResumeFile> | null = null;
      let savedCoverSource = "";
      try {
        if (app.resumeArtifacts?.hasSource) {
          const response = await fetch(applicationDocumentUrl(app.id, "resume", "source"));
          if (!response.ok) throw new Error("The saved resume source could not be read.");
          savedResumeSource = parseResumeFile(await response.arrayBuffer());
        }
        if (app.coverLetterArtifacts?.hasSource) {
          const response = await fetch(applicationDocumentUrl(app.id, "cover", "source"));
          if (!response.ok) throw new Error("The saved cover letter source could not be read.");
          savedCoverSource = await response.text();
        }
      } catch (error) {
        await alert({
          title: "Open failed",
          message: error instanceof Error ? error.message : "The saved application documents could not be read."
        });
        return false;
      }
      if (
        resumeReplacementStateRef.current.version !== approvedResumeVersion ||
        coverReplacementStateRef.current.version !== approvedCoverVersion
      ) {
        await alert({
          title: "Open paused",
          message:
            "The resume or cover letter changed while the saved application was loading. Your current drafts were kept; open the preparation again when you are ready."
        });
        return false;
      }

      const restoredResumeData = savedResumeSource?.data ?? null;
      const restoredResume = restoredResumeData ? serializeResumeData(restoredResumeData) : "";
      const applicantName = resolveResumeApplicantName(
        restoredResumeData?.header?.name,
        restoredResume || currentResumeText || resumeText
      );
      const restoredJobDescription = (app.jobDescription || "").trim();
      const restoredSourceText = (app.rawJobDescription || restoredJobDescription).trim();
      const restoredExtraction = extractJobPosting(restoredSourceText, {
        url: app.jobUrl || undefined
      });
      const restoredTracking: ExtractedJobTracking = definedTracking({
        ...restoredExtraction.tracking,
        title: app.role,
        role: app.role,
        company: app.company,
        source: app.source,
        location: app.location,
        jobType: app.jobType,
        workAuth: app.workAuth,
        salaryMin: app.salaryMin,
        salaryMax: app.salaryMax,
        salaryCurrency: app.salaryCurrency,
        salaryPeriod: app.salaryPeriod,
        roleDescription: app.roleDescription
      });
      const storedBrief = removePreparedJobRoleSummary(
        buildPreparedJobBrief(restoredJobDescription, restoredJobDescription),
        app.roleDescription
      );
      const fallbackBrief = buildPreparedJobBrief(restoredExtraction.tailoringText, restoredSourceText);
      const storedPreparedDescription =
        /^Job Title\s*:/im.test(restoredJobDescription) &&
        /^Company \/ Product Context\s*:/im.test(restoredJobDescription) &&
        /^Core Responsibilities\s*:/im.test(restoredJobDescription) &&
        /^Required Qualifications\s*:/im.test(restoredJobDescription);
      const storedBenefitsSection = /^Benefits\s*:/im.test(restoredJobDescription);
      const restoredBrief = storedPreparedDescription
        ? {
            ...storedBrief,
            // New prepared applications always persist an explicit Benefits
            // section. "Not specified" is an intentional empty edit; only
            // legacy structured text with no section falls back to raw source.
            benefits: storedBenefitsSection ? storedBrief.benefits : fallbackBrief.benefits
          }
        : fallbackBrief;
      const restoredManualReviewFields = reconcilePreparedJobManualReviewFields(
        restoredTracking,
        restoredBrief,
        restoredExtraction.manualReviewFields
      );
      const restoredTailoringText = assemblePreparedJobTailoringText(restoredTracking, restoredBrief);
      const resumeTitle = documentTitleForJob("resume", restoredTracking, applicantName);
      const coverTitle = documentTitleForJob("coverLetter", restoredTracking, applicantName);
      if (savedCoverSource && !coverLetterEditor.openApplicationSource(savedCoverSource, coverTitle)) {
        await alert({
          title: "Open failed",
          message: "The saved cover letter source could not be read."
        });
        return false;
      }

      // Opening a tracked application supersedes any recovery prompt from the
      // previous desk state, even when that state happened to be clean.
      clearAutosaveDraft();
      clearCoverLetterAutosaveDraft();
      setPendingAutosaveDraft(null);
      setPendingCoverDraft(null);
      // Description and link are separate fields: restore each from its own slot.
      setJobDescription(restoredTailoringText);
      setJobUrl(app.jobUrl || "");
      setImportedJob(
        restoredTailoringText.length > 40
          ? {
              url: (app.jobUrl || "").trim(),
              sourceText: restoredSourceText,
              tailoringText: restoredTailoringText,
              tracking: restoredTracking,
              brief: restoredBrief,
              manualReviewFields: restoredManualReviewFields
            }
          : null
      );
      setDocumentTitle(resumeTitle);
      if (!savedCoverSource) {
        coverLetterEditor.startBlank();
        setCoverLetterTitle(coverTitle);
      }
      // Restore a consistent AI-usage/raw-text pair regardless of which branch
      // below runs — a tracker-restore must not carry over the PREVIOUS working
      // job's provider attribution or raw text.
      setPipelineAiUsage(
        canonicalizeAiUsageStageKeys(app.aiUsage ?? { "job-analysis": { source: "none" } })
      );
      setJobRawText(restoredSourceText);
      // Include controls describe the NEXT Apply package, not which historical
      // artifacts happen to exist. Reopen with the documented defaults; retained
      // excluded artifacts remain visible in the saved-application summary.
      setMaterialSelection(DEFAULT_MATERIAL_SELECTION);
      // Deliberately reloading a tracked application for another pass: pre-ack
      // its own record so the polish/apply duplicate gates don't nag that it
      // "already exists" — merging back into it is the point.
      duplicateGuard.ackApplication(app);
      // Work continues against THIS record: later document saves update it rather
      // than creating a second row for the same posting.
      linkPreparedApplication(app.id);
      detachBaseResumeIdentity();
      setFileName("");
      if (restoredResumeData || restoredResume) {
        const restoredAnalysis = analyzeResumeText(restoredResume, restoredTailoringText);
        setResumeText(restoredResume);
        setFileStatus("Loaded the saved resume into the editor. Save it as base if you want it at startup.");
        // Single-owner cover letter: show the saved letter alongside its restored
        // resume in the dedicated editor.
        setResult({
          ...restoredAnalysis,
          polishedText: restoredResume,
          // Restore only a saved AI comparison. Legacy deterministic estimates
          // are intentionally ignored and require a fresh AI Review.
          savedFit:
            app.fitScoreSource === "ai" &&
            typeof app.baseFitScore === "number" &&
            typeof app.tailoredFitScore === "number"
              ? {
                  source: "ai",
                  base: app.baseFitScore,
                  tailored: app.tailoredFitScore
                }
              : undefined,
          missingRequiredSkills: missingRequiredSkillsFromApplication(app)
        });
        if (restoredResumeData) {
          seedResumeData(restoredResumeData);
          if (savedResumeSource) {
            docStyle.replaceDocumentStyle(savedResumeSource.documentStyle);
          }
        } else {
          seedResumeEditor(restoredResume, "");
        }
        setLinkStatus(`Opened "${app.title}" preparation with its saved resume.`);
      } else {
        setLinkStatus(`Opened "${app.title}" preparation.`);
        setResult(null);
        seedResumeEditor("");
      }
      setPolishStatus("");
      resetExportStatuses();
      setExportStatus("");
      setActiveOutputTab("prepare");
      window.requestAnimationFrame(() => {
        document.getElementById("tab-prepare")?.focus();
      });
      return true;
    } catch (error) {
      await alert({
        title: "Open failed",
        message: error instanceof Error ? error.message : "The saved application could not be opened."
      });
      return false;
    } finally {
      applicationOpenInFlightRef.current = false;
    }
  }

  // Restore the autosaved draft into the editor and clear the prompt. The
  // stored copy deliberately survives: the editor seeds CLEAN (dirty=false), so
  // autosave will not re-write the draft until the next edit — clearing here
  // would leave a window where closing the tab permanently loses content that
  // was durably recoverable a moment earlier. The draft already lives under
  // THIS tab's key (recovery migrates orphans), and Apply / base-resume save /
  // explicit replace / dismiss all clear it once the content is safe elsewhere.
  async function handleRestoreAutosaveDraft(draft: AutosavedDraft) {
    if (resumeDocumentDirty) {
      if (!(await confirmReplaceEditor())) return;
    }
    const restored = parseResumeFile(draft.resumeSource);
    seedResumeData(restored.data);
    docStyle.replaceDocumentStyle(restored.documentStyle);
    resetCoverWorkflow();
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
      if (draft.pipelineAiUsage) {
        setPipelineAiUsage(canonicalizeAiUsageStageKeys(draft.pipelineAiUsage));
      }
      if (draft.jobRawText) setJobRawText(draft.jobRawText);
    }
    setPendingAutosaveDraft(null);
    setFileStatus(`Restored unsaved draft${draft.jobLabel ? ` (${draft.jobLabel})` : ""}.`);
  }

  function handleDismissAutosaveDraft() {
    clearAutosaveDraft();
    setPendingAutosaveDraft(null);
  }

  // Same contract as the resume restore above, including keeping the stored copy
  // until the letter is safe elsewhere: openRecoveryDraft seeds CLEAN, so a
  // crash immediately after restoring still has something to recover.
  async function handleRestoreCoverDraft(draft: CoverLetterAutosavedDraft) {
    if (coverLetterEditor.dirty && !(await confirmReplaceCoverLetter())) return;
    if (coverLetterEditor.openRecoveryDraft(draft.coverPayload, draft.documentTitle)) {
      setPendingCoverDraft(null);
    }
  }

  function handleDismissCoverDraft() {
    clearCoverLetterAutosaveDraft();
    setPendingCoverDraft(null);
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

  // Source-only `.resume`/`.cover` documents are rendered on demand so the
  // workspace does not need duplicate PDF bytes. Stored PDFs are fetched first
  // as well, so a missing file surfaces through the same recoverable dialog.
  async function handlePreviewApplicationDocument(application: Application, kind: ApplicationDocumentKind = "resume") {
    const base = sanitizeFileBase(application.company || application.role || application.title || "resume");
    try {
      setResumePreview({
        url: URL.createObjectURL(await applicationDocumentPdfBlob(application, kind, import.meta.env.BASE_URL)),
        name: `${base}_${kind === "resume" ? "Resume" : "Cover_Letter"}.pdf`
      });
    } catch (error) {
      await alert({
        title: "Preview failed",
        message: error instanceof Error ? error.message : "The saved document could not be previewed."
      });
    }
  }

  async function handleDownloadApplicationDocument(application: Application, kind: ApplicationDocumentKind) {
    const base = sanitizeFileBase(application.company || application.role || application.title || "resume");
    try {
      const [{ downloadBlob }, blob] = await Promise.all([
        import("@typeset/engine/lib/download.ts"),
        applicationDocumentPdfBlob(application, kind, import.meta.env.BASE_URL)
      ]);
      downloadBlob(blob, `${base}_${kind === "resume" ? "Resume" : "Cover_Letter"}.pdf`);
    } catch (error) {
      await alert({
        title: "Download failed",
        message: error instanceof Error ? error.message : "The saved document could not be downloaded."
      });
    }
  }

  function handlePrepareApplication() {
    setActiveOutputTab("prepare");
    window.requestAnimationFrame(() => {
      document.getElementById("tab-prepare")?.focus();
    });
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
        applyDisabled={!preparationReadiness.canApply || isApplying}
        applyHint={preparationReadiness.primaryBlocker || "Applying…"}
        applyStatus={applyStatus}
        applyStatusIsError={applyStatusIsError}
        onDismissApplyStatus={() => setApplyStatus("")}
      />

      {polishProgressVisible ||
      jobAnalysisProgressVisible ||
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
            onRetry={handleTailorCoverLetter}
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
          onPrefetchOutputTab={prefetchOutputTab}
          sidebarUtilities={
            <>
              <SessionsMenu self={{ jobLabel: _autosaveJobLabel, phase: _myPhase }} others={otherSessions} />
              <button
                type="button"
                className="studio-settings-trigger"
                aria-haspopup="dialog"
                aria-expanded={settingsSection !== null}
                onClick={() => setSettingsSection((current) => (current === null ? "stages" : null))}
                title="Settings"
              >
                <span className="studio-settings-trigger__icon" aria-hidden="true">
                  <Settings size={15} />
                </span>
                <span className="studio-settings-trigger__label">Settings</span>
              </button>
            </>
          }
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
          {activeOutputTab === "prepare" ? (
            <PrepareTab
              jobUrl={jobUrl}
              onJobUrlChange={setJobUrl}
              jobDescription={jobDescription}
              onJobDescriptionChange={handleManualJobDescriptionChange}
              jobRawText={jobRawText}
              importedJob={importedJob}
              onJobTrackingChange={handlePreparedJobTrackingChange}
              onJobBriefChange={handlePreparedJobBriefChange}
              jobPrepared={jobPrepared}
              isPreparing={jobPreparationActive}
              extensionImportPhase={extensionImportPhase}
              jobAnalysisProgress={jobAnalysisProgress}
              preparationStatus={linkStatus}
              jobAnalysisProviderReady={jobAnalysisProviderReady}
              jobAnalysisProviderMessage={jobAnalysisProviderMessage}
              onFetchPosting={handleExtractFromLink}
              onPreparePosting={handleAnalyzePaste}
              resumeReady={resumeReady}
              includeResume={materialSelection.resume}
              onIncludeResumeChange={(resume) => setMaterialSelection((current) => ({ ...current, resume }))}
              baseResumeName={baseResumeName}
              baseResumeOptions={baseResumeOptions}
              onSelectBaseResume={handleSelectBaseResumeVariant}
              resumeVariantRecommendation={resumeVariantRecommendation}
              isRankingResumeVariants={isRankingResumeVariants}
              isSelectingResume={isSavingBaseResume || isManuallySelectingResumeVariant}
              canTailor={
                canPolish &&
                !isSavingBaseResume &&
                !isManuallySelectingResumeVariant &&
                !isRankingResumeVariants
              }
              isPolishing={isPolishing}
              polishProgress={polishProgress}
              polishOutputCurrent={polishOutputCurrent}
              polishStatus={polishStatus}
              onTailorPreparedResume={handleTailorPreparedResume}
              onReviewResume={() => setActiveOutputTab("resume")}
              includeCoverLetter={materialSelection.coverLetter}
              onIncludeCoverLetterChange={(coverLetter) =>
                setMaterialSelection((current) => ({ ...current, coverLetter }))
              }
              coverLetterReady={coverLetterReady}
              coverLetterWordCount={coverLetterPreflight.authoredWordCount}
              coverLetterPlaceholderCount={coverLetterPreflight.template.slots.length}
              coverLetterFileName={coverLetterEditor.activeCoverFileName}
              coverLetterOptions={coverLetterEditor.coverLetterOptions}
              coverLetterVariantRecommendation={coverLetterVariantRecommendation}
              isRankingCoverLetterVariants={isRankingCoverLetterVariants}
              isSelectingCoverLetter={isSelectingCoverVariant}
              onSelectCoverLetter={handleSelectPreparedCoverLetter}
              canTailorCoverLetter={
                coverLetterPreflight.canTailor &&
                resumeReady &&
                jobReady &&
                coverProviderReady &&
                !isGeneratingCover &&
                !isSelectingCoverVariant &&
                !isRankingCoverLetterVariants
              }
              coverLetterTailorHint={
                !resumeReady && !jobReady
                  ? "Add your resume and prepare the job first."
                  : !resumeReady
                    ? "Add your resume first."
                    : !jobReady
                      ? "Prepare the job first."
                      : isSelectingCoverVariant || isRankingCoverLetterVariants
                        ? "Wait for the cover-letter variant selection to finish."
                      : !coverProviderReady
                        ? coverProviderMessage
                        : (coverLetterPreflight.blockers[0] ?? "")
              }
              isTailoringCoverLetter={isGeneratingCover}
              coverLetterStatus={coverStatus}
              onTailorCoverLetter={handleTailorCoverLetter}
              onOpenCoverLetter={() => setActiveOutputTab("cover")}
              reviewGaps={prepareReviewGaps}
              reviewGapsProvenance={prepareReviewGapsProvenance}
              fitAssessment={prepareFitAssessment}
              linkedApplication={preparedApplication}
              readiness={preparationReadiness}
              isApplying={isApplying}
              onApply={handleApply}
            />
          ) : null}

          {activeOutputTab === "resume" ? (
            <ResumeTab
              documentTitle={documentTitle}
              onDocumentTitleChange={setDocumentTitle}
              editedResume={editedResume}
              actions={resumeEditorActions}
              canUndo={canUndoResume}
              canRedo={canRedoResume}
              contentUndoSequence={resumeUndoSequence}
              contentRedoSequence={resumeRedoSequence}
              dirty={resumeDocumentDirty}
              draftAutosaveState={draftAutosaveState}
              jobConstraints={jobConstraints}
              result={result}
              resumeDiff={resumeDiff}
              docStyle={docStyle}
              formattingToolbar={
                <FormattingToolbar
                  onUndo={() => {
                    if (typesetEditorRef.current) typesetEditorRef.current.undo();
                    else resumeEditorActions.undo();
                  }}
                  onRedo={() => {
                    if (typesetEditorRef.current) typesetEditorRef.current.redo();
                    else resumeEditorActions.redo();
                  }}
                  canUndo={canUndoResume || docStyle.canUndo}
                  canRedo={canRedoResume || docStyle.canRedo}
                  formattingDisabled={false}
                  inlineFormatting={{
                    onRequestEditorFocus: () => typesetEditorRef.current?.focusSelection(),
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
                      textEditable: inlineFormat.linkTextEditable,
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
                    setInlineFormat((current) =>
                      current.alignmentScope === scope ? { ...current, alignment } : current
                    );
                    if (scope === "body") docStyle.set("bodyAlign", alignment);
                    else if (scope === "header")
                      docStyle.set("headerAlign", alignment === "justify" ? "left" : alignment);
                    else docStyle.set("headingAlign", alignment === "justify" ? "left" : alignment);
                  }}
                  styleMarkStates={styleMarkStates}
                  onStyleFieldMarkChange={(field, mark, on) => {
                    resumeEditorActions.setStyleFieldMark(field, mark, on);
                    setInlineFormat((current) => (current.entryField === field ? { ...current, [mark]: on } : current));
                  }}
                  styleFontStates={styleFontStates}
                  onStyleFieldFontChange={(field, family) => {
                    resumeEditorActions.setStyleFieldFont(
                      field,
                      family === docStyle.style.fontFamily ? "default" : family
                    );
                    setInlineFormat((current) =>
                      current.entryField === field ? { ...current, fontFamily: family } : current
                    );
                  }}
                  styleSizeStates={styleSizeStates}
                  onStyleFieldSizeChange={(field, sizePt) => {
                    const isDefault =
                      Math.abs(sizePt - styleFieldDefaultSizePt(field, docStyle.style.baseFontSizePt)) < 0.05;
                    resumeEditorActions.setStyleFieldSize(field, isDefault ? "default" : sizePt);
                    setInlineFormat((current) =>
                      current.entryField === field ? { ...current, fontSizePt: sizePt } : current
                    );
                  }}
                  onResetStyleFormatting={() => {
                    resumeEditorActions.resetStyleFieldFormatting();
                    setInlineFormat((current) =>
                      current.entryField
                        ? {
                            ...current,
                            ...STYLE_FIELD_MARK_DEFAULTS[current.entryField]
                          }
                        : current
                    );
                  }}
                  onFitZoom={fitResumePage}
                  fitViewportRef={resumeFitViewportRef}
                  documentStructureTools={
                    <DocumentStructureControls
                      header={editedResume.header}
                      contactDivider={docStyle.style.contactDivider}
                      disabled={false}
                      onCreateHeader={() => {
                        if (typesetEditorRef.current) {
                          typesetEditorRef.current.createHeader();
                        } else {
                          resumeEditorActions.createHeader();
                        }
                      }}
                      onSetHeaderVisible={resumeEditorActions.setHeaderVisible}
                      onSetHeaderName={(nextText) => {
                        if (typesetEditorRef.current) {
                          typesetEditorRef.current.replaceHeaderNameText(nextText);
                        } else {
                          resumeEditorActions.setHeaderName(nextText);
                        }
                      }}
                      onRemoveHeaderName={resumeEditorActions.removeHeaderName}
                      onUpdateContact={(index, nextText) => {
                        if (typesetEditorRef.current) {
                          typesetEditorRef.current.replaceHeaderContactText(index, nextText);
                        } else {
                          resumeEditorActions.updateContact(index, nextText);
                        }
                      }}
                      onInsertContact={resumeEditorActions.insertContact}
                      onRemoveContact={resumeEditorActions.removeContact}
                      onContactDividerChange={(value) => docStyle.set("contactDivider", value)}
                      onAddSection={(type, position) => typesetEditorRef.current?.addSection(type, position)}
                    />
                  }
                />
              }
              editorRef={typesetEditorRef}
              fitViewportRef={resumeFitViewportRef}
              initialCaret={resumeCaretRef.current}
              onCaretExit={(caret) => {
                resumeCaretRef.current = caret;
              }}
              initialScrollTop={resumeScrollTopRef.current}
              onScrollExit={(top) => {
                resumeScrollTopRef.current = top;
              }}
              onInlineFormatStateChange={setInlineFormat}
              onRequestLinkEditor={() => setLinkEditorOpen(true)}
              tailorModes={tailorModes}
              onSetTailorMode={setTailorMode}
              onAddHonestContext={handleAddHonestContext}
              pendingAutosaveDraft={pendingAutosaveDraft}
              onRestoreAutosaveDraft={handleRestoreAutosaveDraft}
              onDismissAutosaveDraft={handleDismissAutosaveDraft}
              reviewStale={reviewStale}
              resumeReady={resumeReady}
              jobReady={jobReady}
              tailorProviderReady={tailorProviderReady}
              auditProviderReady={reviewProviderReady}
              polishStages={polishStages}
              isPolishing={isPolishing}
              polishProgress={polishProgress}
              polishStatus={polishStatus}
              onPolish={() => void handlePolish()}
              onRetryTailor={() => void retryStage("tailor")}
              onRetryAudit={() => void retryStage("review")}
              onStopPolish={stopPolish}
              onProposalChange={() => setReviewStale(true)}
              jobTarget={materialsJobTarget}
              documentActions={
                <>
                  {/* The resume file picker is a hidden input the menu's "Choose a
                      file" row clicks, matching the cover letter — the menu is the
                      same component for both. */}
                  <input
                    ref={resumeFileInputRef}
                    className="sr-only"
                    type="file"
                    accept=".txt,.md,.csv,.resume"
                    onChange={handleFileUpload}
                  />
                  <DocumentOpenMenu
                    tooltip="Open a resume"
                    icon={<FolderOpen size={16} />}
                    disabled={isWorkspaceBootstrapping}
                    title={isWorkspaceBootstrapping ? "Checking workspace…" : "Open resume"}
                    description={
                      activeBaseResumeLabel ? `Current variant: ${activeBaseResumeLabel}` : "No workspace variant open."
                    }
                    actions={[
                      {
                        key: "starter",
                        icon: <LayoutTemplate size={15} aria-hidden="true" />,
                        title: "Bundled starter",
                        description: "An example resume to edit.",
                        disabled: isSavingBaseResume,
                        onSelect: () => void loadStarterTemplate()
                      },
                      {
                        key: "blank",
                        icon: <FilePlus2 size={15} aria-hidden="true" />,
                        title: "Blank document",
                        description: "Start with an empty resume.",
                        disabled: isSavingBaseResume,
                        onSelect: () => void startBlankResume()
                      },
                      {
                        key: "file",
                        icon: <Upload size={15} aria-hidden="true" />,
                        title: "Choose a file",
                        description: ".resume, .txt, .md, or .csv",
                        onSelect: () => resumeFileInputRef.current?.click()
                      }
                    ]}
                    saved={{
                      label: "Saved in workspace",
                      emptyNote: "No saved resume variants yet.",
                      groups: [
                        {
                          key: "bases",
                          label: "Variants",
                          icon: <FolderOpen size={11} aria-hidden="true" />,
                          entries: baseResumeOptions.map((option) => ({
                            key: option.fileName,
                            title: option.label,
                            meta: option.fileName,
                            active: option.fileName === baseResumeName,
                            onOpen: () => void handleSelectBaseResumeVariant(option.fileName)
                          }))
                        },
                        ...baseResumeHistory.map((group) => ({
                          key: `history-${group.variant}`,
                          label: `${group.label} earlier versions`,
                          collapsible: true,
                          defaultOpen:
                            baseResumeName.replace(/\.[a-z]+$/i, "") === group.variant &&
                            baseResumeHistory.length === 1,
                          entries: group.entries.map((entry) => ({
                            key: entry.key,
                            title: formatHistoryDate(entry.date),
                            meta: entry.kind.toUpperCase(),
                            openLabel: "Restore",
                            onOpen: () => restoreBaseResume(entry.key)
                          }))
                        }))
                      ]
                    }}
                    footer={
                      <>
                        {fileError ? (
                          <p className="document-open-note document-open-note--warn" role="status">
                            {fileError}
                          </p>
                        ) : null}
                        {fileStatus ? (
                          <p className="document-open-note" role="status">
                            {fileStatus}
                          </p>
                        ) : null}
                        {workspaceStatus ? (
                          <p className="document-open-note" role="status">
                            {workspaceStatus}
                          </p>
                        ) : null}
                      </>
                    }
                  />
                  <DocumentSaveMenu
                    tooltip="Save the resume"
                    icon={<Save size={16} />}
                    disabled={false}
                    title="Save resume"
                    description="Keep a workspace base or take a file away."
                    primary={{
                      title: baseResumeName ? `Update ${activeBaseResumeLabel}` : "Save as default base",
                      description: baseResumeName
                        ? "The version it replaces goes to history."
                        : "Opens automatically next time.",
                      disabled: isWorkspaceBootstrapping || isSavingBaseResume,
                      onSelect: () => saveCurrentAsBaseResume()
                    }}
                    variant={{
                      fieldId: "resume-variant-name",
                      fieldLabel: "New base variant",
                      placeholder: "e.g. Full stack",
                      fileNameFor: resumeVariantFileName,
                      existingNames: baseResumeOptions.map((option) => option.fileName),
                      disabled: isWorkspaceBootstrapping || isSavingBaseResume,
                      onSave: (fileName) => saveCurrentAsBaseResume(fileName)
                    }}
                    applicationSync={resumeApplicationSync}
                    actions={[
                      {
                        key: "resume",
                        icon: <Download size={15} aria-hidden="true" />,
                        title: "Download .resume",
                        disabled: false,
                        onSelect: () => void handleDownloadResume()
                      },
                      {
                        key: "pdf",
                        icon: <FileDown size={15} aria-hidden="true" />,
                        title: isRenderingPdf ? "Exporting PDF…" : "Download PDF",
                        disabled: !canExportResume || isRenderingPdf,
                        onSelect: () => setPdfPromptOpen(true)
                      }
                    ]}
                    status={workspaceStatus}
                  />
                  {/* Keeps the rename dialog and the export status beside the action
                      bar; its trigger is the Save menu's PDF row. */}
                  <ExportMenu
                    defaultFileBaseName={resumeDownloadName("pdf").replace(/\.pdf$/i, "")}
                    promptOpen={pdfPromptOpen}
                    onPromptOpenChange={setPdfPromptOpen}
                    status={exportStatus}
                    statusIsError={exportStatusIsError}
                    onDismissStatus={() => setExportStatus("")}
                    onDownloadPdf={handleDownloadPdf}
                  />
                </>
              }
            />
          ) : null}

          {activeOutputTab === "cover" ? (
            <CoverLetterTab
              editor={coverLetterEditor}
              editorRef={coverLetterEditorRef}
              initialCaret={coverLetterCaretRef.current}
              onCaretExit={(caret) => {
                coverLetterCaretRef.current = caret;
              }}
              initialScrollTop={coverLetterScrollTopRef.current}
              onScrollExit={(top) => {
                coverLetterScrollTopRef.current = top;
              }}
              inlineFormat={coverLetterInlineFormat}
              onInlineFormatStateChange={setCoverLetterInlineFormat}
              onTailor={handleTailorCoverLetter}
              applicationSync={coverLetterApplicationSync}
              draftAutosaveState={coverDraftAutosaveState}
              pendingAutosaveDraft={pendingCoverDraft}
              onRestoreAutosaveDraft={handleRestoreCoverDraft}
              onDismissAutosaveDraft={handleDismissCoverDraft}
              isTailoring={isGeneratingCover}
              tailorStatus={coverStatus}
              resumeReady={resumeReady}
              jobReady={jobReady}
              providerReady={coverProviderReady}
              jobTarget={materialsJobTarget}
              preflight={coverLetterPreflight}
              proposal={coverLetterProposal}
              appliedResult={appliedCoverLetterResult}
              failure={coverLetterFailure}
              slotAnswers={coverLetterSlotAnswers}
              onDetailChange={updateCoverLetterDetail}
              onSlotAnswerChange={updateCoverLetterSlotAnswer}
              onAcceptProposal={acceptCoverLetterProposal}
              onDiscardProposal={discardCoverLetterProposal}
              onAddHonestContext={handleAddHonestContext}
              onRestorePreTailor={() => {
                coverLetterEditor.restorePreTailor();
              }}
            />
          ) : null}

          {activeOutputTab === "applications" ? (
            <Suspense
              fallback={
                <p className="pipeline-note" role="status">
                  Loading applications…
                </p>
              }
            >
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
                onPreviewResume={(app) => handlePreviewApplicationDocument(app, "resume")}
                onDelete={handleDeleteApplication}
                onPrepareApplication={handlePrepareApplication}
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
            <Suspense
              fallback={
                <p className="pipeline-note" role="status">
                  Loading analytics…
                </p>
              }
            >
              <AnalyticsTab applications={applications} onOpenApplications={() => setActiveOutputTab("applications")} />
            </Suspense>
          ) : null}
        </StudioPane>
      </div>

      {settingsSection !== null ? (
        <SettingsDialog
          section={settingsSection}
          onSectionChange={setSettingsSection}
          onClose={() => setSettingsSection(null)}
          stages={stages}
          onStageChange={updateStage}
          onStageProviderChange={changeStageProvider}
          onCopyStage={copyStage}
          providers={providerAvailability.providers}
          availabilityStatus={providerAvailability.status}
          availabilityMessage={providerAvailability.message}
          onRefreshProviders={providerAvailability.refresh}
          polishStages={polishStages}
          onPolishStagesChange={setPolishStages}
          resumeAutoPolishThreshold={resumeAutoPolishThreshold}
          onResumeAutoPolishThresholdChange={setResumeAutoPolishThreshold}
          coverAutoPolishThreshold={coverAutoPolishThreshold}
          onCoverAutoPolishThresholdChange={setCoverAutoPolishThreshold}
          citizenshipStatus={citizenshipStatus}
          onCitizenshipChange={setCitizenshipStatus}
          legallyAuthorizedToWork={legallyAuthorizedToWork}
          onLegallyAuthorizedChange={setLegallyAuthorizedToWork}
          requiresSponsorship={requiresSponsorship}
          onRequiresSponsorshipChange={setRequiresSponsorship}
          educationLevel={educationLevel}
          onEducationLevelChange={setEducationLevel}
          major={major}
          onMajorChange={setMajor}
          honestContext={honestContext}
          onHonestContextChange={setHonestContext}
          honestContextRef={honestContextTextareaRef}
          customInstructions={customInstructions}
          onCustomInstructionsChange={setCustomInstructions}
          stageCustomInstructions={stageCustomInstructions}
          onStageCustomInstructionChange={setStageCustomInstruction}
          onReset={handleResetSettings}
        />
      ) : null}

      {isApplicationModalOpen ? (
        <Suspense fallback={<ApplicationModalLoading />}>
          <ApplicationModal
            open
            application={
              modalApplicationId ? (applications.find((app) => app.id === modalApplicationId) ?? null) : null
            }
            onClose={() => setIsApplicationModalOpen(false)}
            onSave={handleSaveApplicationFromModal}
            onDelete={handleDeleteApplication}
            onLoad={handleLoadApplication}
            onPreviewDocument={handlePreviewApplicationDocument}
            onDownloadDocument={handleDownloadApplicationDocument}
            onSaveDocument={applicationFiles.saveDocument}
            onRemoveDocument={applicationFiles.removeDocument}
            onSaveAttachment={applicationFiles.saveAttachment}
            onRemoveAttachment={applicationFiles.removeAttachment}
          />
        </Suspense>
      ) : null}

      {applyDownloadPrompt ? (
        <ApplyDownloadDialog
          label={applyDownloadPrompt.label}
          defaultFileBaseName={resumeDownloadName("pdf").replace(/\.pdf$/i, "")}
          canDownloadResume={applyDownloadPrompt.canDownloadResume}
          canDownloadCoverLetter={applyDownloadPrompt.canDownloadCoverLetter}
          busy={isApplying}
          error={applySaveError}
          onDownload={handleApplyDownloadPick}
          onSkip={() => {
            // True cancel path (backdrop click / × / Escape) — abandons the
            // whole apply without committing, so any duplicate-merge target
            // this flow identified must not leak into a later apply.
            applyMergeTargetRef.current = null;
            applyMaterialSelectionRef.current = null;
            setApplyDownloadPrompt(null);
          }}
          onApplyOnly={handleApplyOnly}
        />
      ) : null}

      <ResumePrintLayer resume={editedResume} docStyle={docStyle.style} />
    </div>
  );
}

export default App;
