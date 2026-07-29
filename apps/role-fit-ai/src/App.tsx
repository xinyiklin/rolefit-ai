import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  FileDown,
  FolderOpen,
  LayoutTemplate,
  Layers,
  Save,
  ScanSearch,
  Settings,
  Sparkles,
  Upload,
  X,
  type LucideIcon
} from "lucide-react";

import {
  analyzeResumeText,
  type PolishedResume
} from "./resumeEngine";

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
import {
  useApplications,
  missingRequiredSkillsFromApplication,
  type Application
} from "./hooks/useApplications";
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
import { type PresencePhase } from "./lib/tabPresence";
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
import type { StageAiUsage } from "./lib/aiUsage";
import { useDuplicateGuard } from "./hooks/useDuplicateGuard";
import { useJobIntake, type ImportedJobSnapshot } from "./hooks/useJobIntake";
import { usePolishPipeline } from "./hooks/usePolishPipeline";
import { useWorkspaceResume } from "./hooks/useWorkspaceResume";
import { useApplyFlow } from "./hooks/useApplyFlow";
import { useApplicationDocumentSync } from "./hooks/useApplicationDocumentSync";
import { useApplicationFiles } from "./hooks/useApplicationFiles";
import {
  applicationDocumentUrl,
  type ApplicationDocumentKind
} from "./lib/applicationDocumentRequests";
import { applicationDocumentPdfBlob } from "./lib/applicationDocumentPdf";

import { Masthead } from "./sections/Masthead";
import { JobMenu } from "./sections/JobMenu";
import { AiWorkflowProgress, TaskProgress } from "./sections/AiWorkflowProgress";
import type { AiWorkflowStage } from "./lib/aiWorkflow";
import { SessionsMenu } from "./sections/SessionsRail";
import { DocumentOpenMenu } from "./sections/document/DocumentOpenMenu";
import { DocumentActionMenu } from "./sections/document/DocumentActionMenu";
import { DocumentSaveMenu } from "./sections/document/DocumentSaveMenu";
import { StudioPane } from "./sections/StudioPane";
import { SettingsDialog, type SettingsSection } from "./sections/SettingsDialog";
import { ExportMenu } from "./sections/ExportRail";
import { ApplyDownloadDialog } from "./sections/ApplyDownloadDialog";
import { ResumePrintLayer } from "@typeset/editor/sections/ResumePrintLayer.tsx";
import { ResumeTab } from "./sections/tabs/ResumeTab";
import { CoverLetterTab } from "./sections/tabs/CoverLetterTab";
import { MaterialsTab } from "./sections/tabs/MaterialsTab";
import type { TrackerView } from "./sections/tabs/TrackerTab";
import type { OutputTab, OutputTabDescriptor } from "./sections/shared";
import { providerLabel } from "./config/aiOptions";
import { formatHistoryDate } from "./lib/historyDate";
import type { ApplicationActivityFilter } from "./lib/applicationDisplay";

const PreviewOverlay = lazy(() => import("./sections/PreviewOverlay"));
const ApplicationModal = lazy(() =>
  import("./sections/ApplicationModal").then((module) => ({ default: module.ApplicationModal }))
);

// Named importers so the rail can warm a split chunk before the tab is
// selected. The specifier stays a literal in each function — the bundler
// resolves these statically, and calling one twice reuses the same promise.
const importTrackerTab = () => import("./sections/tabs/TrackerTab");
const importAnalyticsTab = () => import("./sections/tabs/AnalyticsTab");

const TrackerTab = lazy(() => importTrackerTab().then((module) => ({ default: module.TrackerTab })));
const AnalyticsTab = lazy(() =>
  importAnalyticsTab().then((module) => ({ default: module.AnalyticsTab }))
);

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
        <p className="pipeline-note" role="status" aria-live="polite">Loading application…</p>
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

// What the resume Polish action asks before it spends an AI run. This is the only
// place the three stage selections are named for the user; the value is the
// persisted `polishStages` setting, so picking one here also sets the default.
const POLISH_STAGE_ACTIONS: {
  value: "tailor" | "review" | "both";
  title: string;
  description: string;
  Icon: LucideIcon;
}[] = [
  {
    value: "both",
    title: "Tailor and review",
    description: "Rewrite against the job, then audit the proposal as a recruiter would.",
    Icon: Layers
  },
  {
    value: "tailor",
    title: "Tailor only",
    description: "Rewrite the Tailor sections against the job. No review pass.",
    Icon: Sparkles
  },
  {
    value: "review",
    title: "Review only",
    description: "Audit the current draft as it stands. Nothing is rewritten.",
    Icon: ScanSearch
  }
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
const LEGACY_DEFAULT_DOCUMENT_TITLE = "Resume draft";
// The untouched titles the cover-letter editor sets itself (blank, starter, the
// workspace default). Only these — never a title the user typed — are upgraded
// to the shared Name_Company_Cover_Letter form.
const COVER_LETTER_TITLE_PLACEHOLDERS = ["Cover letter", "Untitled cover letter"] as const;
const DOCUMENT_TITLE_STORAGE_KEY = "rolefit:documentTitle";
const OUTPUT_TABS: OutputTabDescriptor[] = [
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

function documentTitleForJob(
  kind: DocumentTitleKind,
  tracking: ExtractedJobTracking,
  applicantName: string
): string {
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
    [availableProviderById, providerAvailability.companionManaged, providerAvailability.message, providerAvailability.status]
  );
  const distillProviderReady = providerReady(stages.distill.provider);
  const tailorProviderReady = providerReady(stages.tailor.provider);
  const reviewProviderReady = providerReady(stages.review.provider);
  const coverProviderReady = providerReady(stages.cover.provider);
  const answersProviderReady = providerReady(stages.answers.provider);
  const distillProviderMessage = providerRecoveryMessage(stages.distill.provider);
  const tailorProviderMessage = providerRecoveryMessage(stages.tailor.provider);
  const reviewProviderMessage = providerRecoveryMessage(stages.review.provider);
  const coverProviderMessage = providerRecoveryMessage(stages.cover.provider);
  const answersProviderMessage = providerRecoveryMessage(stages.answers.provider);
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
  const candidateFactsContext = buildCandidateFactsContext({
    citizenshipStatus,
    legallyAuthorizedToWork,
    requiresSponsorship,
    educationLevel,
    major
  });
  const requestHonestContext = mergeHonestContext(honestContext, candidateFactsContext);
  // Distill runs on its own concrete provider config (synced to other stages via
  // the copy buttons, not a live link). Shared by every distill entry point
  // (link, paste, extension import, and their retries).
  const distillRequestFields = () => buildStageRequestFields(stages.distill);
  const [activeOutputTab, setActiveOutputTab] = useState<OutputTab>("resume");
  const [statusFilter, setStatusFilter] = useState<ApplicationActivityFilter>("all");
  const [trackerView, setTrackerView] = useState<TrackerView>("table");
  const [expandedApplicationId, setExpandedApplicationId] = useState<string | null>(null);
  // Saved-application resume PDF preview ({url,name} → open; null → closed).
  const [resumePreview, setResumePreview] = useState<{ url: string; name: string } | null>(null);
  const [isApplicationModalOpen, setIsApplicationModalOpen] = useState(false);
  // null → the modal is in "add" mode; an id → it edits that application.
  const [modalApplicationId, setModalApplicationId] = useState<string | null>(null);

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
    undoSequence: resumeUndoSequence,
    redoSequence: resumeRedoSequence,
    serializedResume,
    seed: seedResumeEditorDocument,
    seedData: seedResumeDataDocument,
    markClean: markResumeClean,
    actions: resumeEditorActions
  } = useResumeEditor(resumeHistoryClock);
  const typesetEditorRef = useRef<TypesetEditorHandle>(null);
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
    (data: ResumeData | null) => {
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
  const [coverLetterInlineFormat, setCoverLetterInlineFormat] =
    useState<InlineFormatState>(EMPTY_INLINE_FORMAT);
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
    const applicantName = resolveResumeApplicantName(
      editedResume?.header?.name,
      currentResumeText || resumeText
    );
    setDocumentTitle(documentTitleForJob("resume", snapshot.tracking, applicantName));
    // Retitle the letter for the new role too. Leaving it behind would keep the
    // previous company in the letter's name and in every file exported from it.
    setCoverLetterTitle(documentTitleForJob("coverLetter", snapshot.tracking, applicantName));
  }, [currentResumeText, editedResume?.header?.name, resumeText, setCoverLetterTitle]);
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
  const markResumeDocumentClean = useCallback(() => {
    markResumeClean();
    docStyle.markClean();
  }, [docStyle.markClean, markResumeClean]);
  const markResumeApplicationSaved = useCallback(() => {
    clearAutosaveDraft();
    markResumeDocumentClean();
  }, [markResumeDocumentClean]);
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
    const applicantName = resolveResumeApplicantName(editedResume?.header?.name, resumeText);
    const company = (jobTracking.company ?? "").trim();
    if (!applicantName || !company) return;
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
    // The current implementation does not yet own a durable title baseline;
    // using the live title here preserves existing behavior for the regression
    // test that introduces that missing contract.
    persistedDocumentTitle: coverLetterEditor.documentTitle,
    dirty: coverLetterEditor.dirty,
    hasContent: Boolean(
      coverLetterEditor.text.trim() || coverLetterEditor.data.header
    ),
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
    customInstructions: customInstructionsFor("answers"),
    aiRequest: stages.answers,
    providerReady: answersProviderReady,
    providerMessage: answersProviderMessage,
    upsertApplication,
    findForTarget
  });


  // One Tailor click writes the letter. Its dedicated editor remains the single
  // owner for applied text, direct edits, file lifecycle, the pre-tailor
  // snapshot behind Restore, and application save.
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
    lastResult: coverLetterResult
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
    jobTarget: { role: jobTracking.role || jobTracking.title, company: jobTracking.company },
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
  // Everything except provider readiness. Every stage selection needs these —
  // buildPolishContext requires an editable Tailor scope even for Review only —
  // so this gates the Polish trigger, and each stage row in its menu adds its own
  // provider check.
  const polishInputsReady = useMemo(() => {
    return Boolean(
      editedResume &&
        resumeReady &&
        Object.values(tailorModes).some((mode) => mode === "tailor") &&
        jobDescription.trim().length > 40
    );
  }, [editedResume, jobDescription, resumeReady, tailorModes]);
  const canPolish = polishInputsReady && selectedPolishProvidersReady;

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
  // Per-stage readiness for the Polish chooser: a stage the user can pick must
  // have its own provider, and a blocked row says which one and why.
  const polishStageReady: Record<"tailor" | "review" | "both", boolean> = {
    tailor: tailorProviderReady,
    review: reviewProviderReady,
    both: tailorProviderReady && reviewProviderReady
  };
  const polishStageBlocker = (stage: "tailor" | "review" | "both") =>
    stage !== "review" && !tailorProviderReady
      ? tailorProviderMessage
      : stage !== "tailor" && !reviewProviderReady
        ? reviewProviderMessage
        : "";

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
    resetCoverWorkflow,
    setPipelineAiUsage,
    setJobRawText,
    setAutoTailorJob,
    setPolishStatus,
    setLinkStatus,
    confirmDuplicateBeforeDistill: duplicateGuard.confirmDuplicateBeforeDistill,
    confirmDuplicateAfterDistill: duplicateGuard.confirmDuplicateAfterDistill,
    distillRequestFields,
    ensureProviderReady: ensureDistillProvider,
    extensionImportsReady: hasLoadedApplications,
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

  // Polish asks which stages to run, then runs them. `polishStages` stays the one
  // owner of that choice (it is a persisted AI setting, and the progress card,
  // retryStage, and the presence phase all read it), so the chooser SETS it and
  // the run starts on the next render rather than taking an override argument.
  //
  // The two-step is required, not stylistic: `polishStages` is part of the
  // pipeline's input fingerprint, and the fingerprint effect aborts any run that
  // is already in flight when it changes. Starting the run in the same tick as
  // the setState would abort the run we just started; letting the setState commit
  // first means that effect sees nothing in flight and returns early.
  const runPolishOnStagesCommitRef = useRef(false);
  function startPolish(nextStages: "tailor" | "review" | "both") {
    if (nextStages === polishStages) {
      void handlePolish();
      return;
    }
    runPolishOnStagesCommitRef.current = true;
    setPolishStages(nextStages);
  }
  useEffect(() => {
    if (!runPolishOnStagesCommitRef.current) return;
    runPolishOnStagesCommitRef.current = false;
    void handlePolish();
    // handlePolish is re-created every render; this must fire only on a committed
    // stage change, so it is deliberately keyed on polishStages alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polishStages]);

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
        : resumeDocumentDirty
          ? "editing"
          : "idle";
  const otherSessions = useTabPresence({ jobLabel: _autosaveJobLabel, phase: _myPhase });

  // Warn before close/reload when there are unsaved edits OR a distill/tailor/
  // review is mid-flight (losing an in-progress run is as costly as losing edits).
  // Apply marks content and document style clean after persisting both.
  useBeforeUnloadGuard(
    resumeDocumentDirty
      || coverLetterEditor.dirty
      || isGeneratingCover
      || isPolishing
      || distillProgress.status === "running"
      || pendingApplicationWrites > 0
  );

  // ----- Handlers -----

  // The workspace / base-resume cluster (state + handlers) lives in
  // useWorkspaceResume; App passes in the editor/export/dialog dependencies it
  // needs and reads back the workspace state + the handlers the Open menu wires up.
  const {
    baseResumeName,
    baseResumeOptions,
    baseResumeHistory,
    workspaceStatus,
    isSavingBaseResume,
    isWorkspaceBootstrapping,
    loadWorkspace,
    loadStarterTemplate,
    restoreBaseResume,
    saveCurrentAsBaseResume,
    loadBaseResumeVersion,
    handleFileUpload
  } = useWorkspaceResume({
    confirm,
    confirmReplaceEditor,
    resumeEdited: resumeDocumentDirty,
    seedResumeEditor,
    fileName,
    setResumeText,
    setFileName,
    setResult,
    resetCoverWorkflow,
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

  // The friendly name of the base resume currently loaded. Both the Open menu's
  // description and the Save menu's "update this base" row name it, so it is
  // derived once here rather than recomputed at each call site.
  const activeBaseResumeLabel =
    baseResumeOptions.find((option) => option.fileName === baseResumeName)?.label
    || baseResumeName;

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

  // Reads the memoized distillation above (apply/export callers run at click time,
  // so the value is always current); kept as a function for call-site stability.
  function currentJobTracking(): ExtractedJobTracking {
    return jobTracking;
  }

  // Per-document application saves. Apply snapshots both documents; afterwards
  // the resume and the cover letter each keep their own saved/unsaved state and
  // their own explicit "Update application" action in their Save menus.
  const {
    linkApplication,
    resume: resumeApplicationSync,
    coverLetter: coverLetterApplicationSync
  } = useApplicationDocumentSync({
    applications,
    findForTarget,
    jobUrl,
    jobDescription,
    currentResumeText,
    currentResumeSource,
    coverLetterText: coverLetterEditor.text,
    currentCoverLetterSource: coverLetterEditor.draftPayload ?? "",
    saveApplicationDocument: applicationFiles.saveDocument,
    getResumeArtifacts,
    getCoverLetterArtifacts: coverLetterEditor.getArtifacts,
    onResumeSaved: markResumeApplicationSaved,
    onCoverLetterSaved: coverLetterEditor.markApplicationSaved
  });

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
    headlineScore,
    fitComparison,
    pipelineAiUsage,
    applications,
    findForTarget,
    upsertApplication,
    saveApplicationDocument: applicationFiles.saveDocument,
    linkApplication,
    currentJobTracking,
    resolveApplyDuplicate: duplicateGuard.resolveApplyDuplicate,
    canExportResume,
    handleDownloadPdf,
    getResumeArtifacts,
    getCoverLetterArtifacts: coverLetterEditor.getArtifacts,
    onResumeSaved: markResumeApplicationSaved,
    onCoverLetterSaved: coverLetterEditor.markApplicationSaved,
    setApplyStatus,
    setActiveOutputTab,
    setExpandedApplicationId
  });

  async function handleLoadApplication(app: Application) {
    if (resumeDocumentDirty || coverLetterEditor.dirty) {
      if (!(await confirmReplaceApplicationDraft())) return;
    }

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
      return;
    }

    const restoredResumeData = savedResumeSource?.data ?? null;
    const restoredResume = restoredResumeData ? serializeResumeData(restoredResumeData) : "";
    const applicantName = resolveResumeApplicantName(
      restoredResumeData?.header?.name,
      restoredResume || currentResumeText || resumeText
    );
    const restoredTracking = { role: app.role, title: app.title, company: app.company };
    const resumeTitle = documentTitleForJob("resume", restoredTracking, applicantName);
    const coverTitle = documentTitleForJob("coverLetter", restoredTracking, applicantName);
    if (savedCoverSource && !coverLetterEditor.openApplicationSource(savedCoverSource, coverTitle)) {
      await alert({
        title: "Open failed",
        message: "The saved cover letter source could not be read."
      });
      return;
    }

    // Opening a tracked application supersedes any recovery prompt from the
    // previous desk state, even when that state happened to be clean.
    clearAutosaveDraft();
    clearCoverLetterAutosaveDraft();
    setPendingAutosaveDraft(null);
    setPendingCoverDraft(null);
    // Description and link are separate fields: restore each from its own slot.
    setJobDescription(app.jobDescription || "");
    setJobUrl(app.jobUrl || "");
    setImportedJob(null);
    setDocumentTitle(resumeTitle);
    if (!savedCoverSource) {
      coverLetterEditor.startBlank();
      setCoverLetterTitle(coverTitle);
    }
    // Restore a consistent AI-usage/raw-text pair regardless of which branch
    // below runs — a tracker-restore must not carry over the PREVIOUS working
    // job's provider attribution or raw text.
    setPipelineAiUsage(app.aiUsage ?? { distill: { source: "none" } });
    setJobRawText(app.rawJobDescription ?? "");
    // Deliberately reloading a tracked application for another pass: pre-ack
    // its own record so the polish/apply duplicate gates don't nag that it
    // "already exists" — merging back into it is the point.
    duplicateGuard.ackApplication(app);
    // Work continues against THIS record: later document saves update it rather
    // than creating a second row for the same posting.
    linkApplication(app.id);
    if (restoredResumeData || restoredResume) {
      const restoredAnalysis = analyzeResumeText(restoredResume, app.jobDescription || "");
      setResumeText(restoredResume);
      setFileName("");
      setFileStatus("Loaded the saved resume into the editor. Save it as base if you want it at startup.");
      // Single-owner cover letter: show the saved letter alongside its restored
      // resume in the dedicated editor.
      setResult({
        ...restoredAnalysis,
        polishedText: restoredResume,
        // Restore only a saved AI comparison. Legacy deterministic estimates
        // are intentionally ignored and require a fresh AI Review.
        savedFit:
          app.fitScoreSource === "ai" && typeof app.baseFitScore === "number" && typeof app.tailoredFitScore === "number"
            ? { source: "ai", base: app.baseFitScore, tailored: app.tailoredFitScore }
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
      setLinkStatus(`Loaded "${app.title}" and its saved resume from pipeline.`);
    } else {
      setLinkStatus(`Loaded "${app.title}" job target from pipeline.`);
      setResult(null);
      seedResumeEditor("");
    }
    setPolishStatus("");
    resetExportStatuses();
    setExportStatus("");
    setActiveOutputTab("resume");
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
      if (draft.pipelineAiUsage) setPipelineAiUsage(draft.pipelineAiUsage);
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
  async function handlePreviewApplicationDocument(
    application: Application,
    kind: ApplicationDocumentKind = "resume"
  ) {
    const base = sanitizeFileBase(
      application.company || application.role || application.title || "resume"
    );
    try {
      setResumePreview({
        url: URL.createObjectURL(
          await applicationDocumentPdfBlob(application, kind, import.meta.env.BASE_URL)
        ),
        name: `${base}_${kind === "resume" ? "Resume" : "Cover_Letter"}.pdf`
      });
    } catch (error) {
      await alert({
        title: "Preview failed",
        message: error instanceof Error ? error.message : "The saved document could not be previewed."
      });
    }
  }

  async function handleDownloadApplicationDocument(
    application: Application,
    kind: ApplicationDocumentKind
  ) {
    const base = sanitizeFileBase(
      application.company || application.role || application.title || "resume"
    );
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
        applyStatus={applyStatus}
        applyStatusIsError={applyStatusIsError}
        onDismissApplyStatus={() => setApplyStatus("")}
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
          sidebarFooter={
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
                  canUndo={canUndoResume || docStyle.canUndo}
                  canRedo={canRedoResume || docStyle.canRedo}
                  formattingDisabled={!editedResume}
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
                  documentStructureTools={(
                    <DocumentStructureControls
                      header={editedResume?.header ?? null}
                      contactDivider={docStyle.style.contactDivider}
                      disabled={!editedResume}
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
                  )}
                />
              )}
              editorRef={typesetEditorRef}
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
              jobTarget={materialsJobTarget}
              documentActions={(
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
                      activeBaseResumeLabel
                        ? `Current variant: ${activeBaseResumeLabel}`
                        : "No workspace variant open."
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
                            onOpen: () => loadBaseResumeVersion(option.fileName)
                          }))
                        },
                        ...baseResumeHistory.map((group) => ({
                          key: `history-${group.variant}`,
                          label: `${group.label} earlier versions`,
                          collapsible: true,
                          defaultOpen:
                            baseResumeName.replace(/\.[a-z]+$/i, "") === group.variant
                            && baseResumeHistory.length === 1,
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
                          <p className="document-open-note document-open-note--warn" role="status">{fileError}</p>
                        ) : null}
                        {fileStatus ? (
                          <p className="document-open-note" role="status">{fileStatus}</p>
                        ) : null}
                        {workspaceStatus ? (
                          <p className="document-open-note" role="status">{workspaceStatus}</p>
                        ) : null}
                      </>
                    }
                  />
                  <DocumentSaveMenu
                    tooltip="Save the resume"
                    icon={<Save size={16} />}
                    disabled={!editedResume}
                    title="Save resume"
                    description="Keep a workspace base or take a file away."
                    primary={{
                      title: baseResumeName ? `Update ${activeBaseResumeLabel}` : "Save as default base",
                      description: baseResumeName
                        ? "The version it replaces goes to history."
                        : "Opens automatically next time.",
                      disabled: !editedResume || isSavingBaseResume,
                      onSelect: () => saveCurrentAsBaseResume()
                    }}
                    variant={{
                      fieldId: "resume-variant-name",
                      fieldLabel: "New base variant",
                      placeholder: "e.g. Full stack",
                      fileNameFor: resumeVariantFileName,
                      existingNames: baseResumeOptions.map((option) => option.fileName),
                      disabled: !editedResume || isSavingBaseResume,
                      onSave: (fileName) => saveCurrentAsBaseResume(fileName)
                    }}
                    applicationSync={resumeApplicationSync}
                    actions={[
                      {
                        key: "resume",
                        icon: <Download size={15} aria-hidden="true" />,
                        title: "Download .resume",
                        disabled: !editedResume,
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
                  <span className="document-primary-action">
                    <DocumentActionMenu
                      label={isPolishing ? "Working…" : "Polish"}
                      ariaLabel="Polish stages"
                      tooltip={polishInputsReady ? "Choose which AI stages to run" : polishGateHint}
                      icon={<Sparkles size={16} />}
                      tone="primary"
                      disabled={!polishInputsReady || isPolishing}
                    >
                      {({ close }) => (
                        <div className="document-action-panel polish-stage-menu">
                          <div className="document-action-panel__head">
                            <strong>Polish this resume</strong>
                            <span>Choose which AI stages to run. Your choice becomes the default.</span>
                          </div>
                          {POLISH_STAGE_ACTIONS.map(({ value, title, description, Icon }) => (
                            <button
                              key={value}
                              type="button"
                              className="document-action-row"
                              disabled={!polishStageReady[value]}
                              aria-current={polishStages === value || undefined}
                              onClick={() => {
                                startPolish(value);
                                close();
                              }}
                            >
                              <Icon size={15} aria-hidden="true" />
                              <span>
                                <strong>{title}</strong>
                                <small>{polishStageReady[value] ? description : polishStageBlocker(value)}</small>
                              </span>
                              {polishStages === value ? (
                                <Check className="polish-stage-menu__current" size={14} aria-hidden="true" />
                              ) : null}
                            </button>
                          ))}
                        </div>
                      )}
                    </DocumentActionMenu>
                    {polishStatus ? (
                      <span
                        className={`document-action-feedback${polishStatusIsError ? " document-action-feedback--error" : ""}`}
                        role={polishStatusIsError ? "alert" : "status"}
                        aria-live={polishStatusIsError ? "assertive" : "polite"}
                      >
                        <span>{polishStatus}</span>
                        <button type="button" onClick={() => setPolishStatus("")} aria-label="Dismiss Polish message">
                          <X size={13} aria-hidden="true" />
                        </button>
                      </span>
                    ) : null}
                  </span>
                </>
              )}
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
              providerMessage={coverProviderMessage}
              jobTarget={materialsJobTarget}
              preflight={coverLetterPreflight}
              result={coverLetterResult}
              slotAnswers={coverLetterSlotAnswers}
              onDetailChange={updateCoverLetterDetail}
              onSlotAnswerChange={updateCoverLetterSlotAnswer}
              onRestorePreTailor={() => {
                coverLetterEditor.restorePreTailor();
              }}
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
                onPreviewResume={(app) => handlePreviewApplicationDocument(app, "resume")}
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
            application={modalApplicationId ? applications.find((app) => app.id === modalApplicationId) ?? null : null}
            onClose={() => setIsApplicationModalOpen(false)}
            onSave={handleSaveApplicationFromModal}
            onDelete={handleDeleteApplication}
            onLoad={(app) => {
              setIsApplicationModalOpen(false);
              handleLoadApplication(app);
            }}
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
