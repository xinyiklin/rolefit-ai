import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import {
  analyzeResumeText,
  draftCoverLetter,
  normalizePolishedResume,
  type PolishedResume,
  polishResume
} from "./resumeEngine";

import { describeProviderModel } from "./config/aiOptions";
import { useTemplates } from "./hooks/useTemplates";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useDocStyle } from "./hooks/useDocStyle";
import { useAiSettings } from "./hooks/useAiSettings";
import { useApplicationAnswers } from "./hooks/useApplicationAnswers";
import {
  useApplications,
  makeApplicationDraft,
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
import { useExtensionInbox } from "./hooks/useExtensionInbox";
import { useTabPresence } from "./hooks/useTabPresence";
import { activeSessionsSignature, type PresencePhase } from "./lib/tabPresence";
import { arrayBufferToBase64, sanitizeFileBase } from "./lib/downloads";
import { buildAiRequestFields, buildAuditRequestFields } from "./lib/aiRequest";
import { loadLastBaseResumeName, saveLastBaseResumeName } from "./lib/baseResumePrefs";
import { buildCandidateFactsContext, mergeHonestContext } from "./lib/candidateFacts";
import { extractJobPosting, type ExtractedJobTracking } from "./lib/jobExtract";
import { distillJobPosting, extractedFromAiOrLocal, type AiDistillFields } from "./lib/aiDistill";
import { buildResumeBlocks } from "./lib/resumeBlocks";
import { serializeResumeData, toTemplateSchema } from "./lib/resumeData";
import { buildTailorScope, defaultTailorModes, tailorScopeToText, type TailorMode } from "./lib/tailorScope";

import { AiMenu } from "./sections/AiMenu";
import { ReviewerSettings } from "./sections/ReviewerSettings";
import { Masthead } from "./sections/Masthead";
import { JobMenu } from "./sections/JobMenu";
import { PolishMenu } from "./sections/PolishMenu";
import { PolishProgress, DistillProgress, type PolishProgressState, type StageState } from "./sections/PolishProgress";
import { ActiveSessionsCard } from "./sections/ActiveSessionsCard";
import { ResumeMenu } from "./sections/ResumeMenu";
import { StudioPane } from "./sections/StudioPane";
import { ExportMenu } from "./sections/ExportRail";
import { ApplyDownloadDialog } from "./sections/ApplyDownloadDialog";
import { loadDefaultExportFormat, saveDefaultExportFormat, type ExportFormat } from "./lib/exportPrefs";
const PreviewOverlay = lazy(() => import("./sections/PreviewOverlay"));
import { ApplicationModal } from "./sections/ApplicationModal";
import { ResumePrintLayer } from "./sections/ResumePrintLayer";
import { ViewportGate } from "./sections/ViewportGate";
import { ResumeTab } from "./sections/tabs/ResumeTab";
import { MaterialsTab } from "./sections/tabs/MaterialsTab";
import { TrackerTab } from "./sections/tabs/TrackerTab";
import type { TrackerView } from "./sections/tabs/TrackerTab";
import { AnalyticsTab } from "./sections/tabs/AnalyticsTab";
import type {
  OutputTab,
  OutputTabDescriptor,
  ResumeBlock
} from "./sections/shared";

// ============ Types ============

type WorkspaceBaseResume = {
  exists: boolean;
  fileName?: string;
  label?: string;
  kind?: string;
  text?: string;
  paragraphs?: number;
  docxBase64?: string;
};

type BaseResumeOption = {
  fileName: string;
  label: string;
  kind: string;
};

type BaseResumeHistoryEntry = {
  key: string;
  originalName: string;
  kind: string;
  date: string;
};

// Recent versions are grouped by variant (one expandable group per variant),
// each capped server-side to its most recent entries.
type BaseResumeHistoryGroup = {
  variant: string;
  label: string;
  entries: BaseResumeHistoryEntry[];
};

type JobWorkspace = {
  path: string;
  baseResume: WorkspaceBaseResume;
  baseResumeOptions?: BaseResumeOption[];
  baseResumeHistory?: BaseResumeHistoryGroup[];
  files: string[];
};

type ImportedJobSnapshot = {
  url: string;
  tailoringText: string;
  tracking: ExtractedJobTracking;
  manualReviewFields: string[];
};

function normalizeResumeSnapshot(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function presentTrackingFields(tracking: ExtractedJobTracking) {
  const fields = [
    tracking.role || tracking.title ? "role" : "",
    tracking.company ? "company" : "",
    tracking.location ? "location" : "",
    tracking.jobType ? "job type" : "",
    tracking.salaryMin != null || tracking.salaryMax != null ? "compensation" : "",
    tracking.roleDescription ? "role summary" : ""
  ].filter(Boolean);
  if (!fields.length) return "no tracking fields";
  if (fields.length === 1) return fields[0];
  return `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
}

function compactManualReviewFields(fields: string[]) {
  const unique = [...new Set(fields)].filter((field) => field !== "job description");
  if (!unique.length) return "";
  if (unique.length === 1) return unique[0];
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

function definedTracking(tracking: ExtractedJobTracking) {
  return Object.fromEntries(
    Object.entries(tracking).filter(([, value]) => value !== undefined && value !== "" && value !== null)
  ) as ExtractedJobTracking;
}

// ============ App ============

function App() {
  // ----- Dialog system -----
  const { confirm } = useDialog();

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
  const [isExtractingLink, setIsExtractingLink] = useState(false);
  // Distill progress card (same vocabulary as PolishProgress). Driven by both
  // job-brief entry points (Extract-from-link and Distill-paste); the DONE card
  // reports whether the brief came from the AI or the local fallback.
  const [distillProgress, setDistillProgress] = useState<StageState>({ status: "idle" });
  const [distillProgressVisible, setDistillProgressVisible] = useState(false);
  // Which distill action the card's Retry should re-run (link or paste). Stored
  // as a tag, not a captured closure, so Retry dispatches to the LIVE handler and
  // picks up the current URL / paste — a stored closure would re-run stale input
  // the user has since edited. Null for the event-driven extension import, which
  // has nothing to re-run, so that card shows no Retry button.
  const [distillRetrySource, setDistillRetrySource] = useState<"link" | "paste" | null>(null);
  // Starts empty; the mount effect (loadWorkspace) auto-loads a workspace
  // base-resume when one exists, otherwise the editor stays blank.
  const [resumeText, setResumeText] = useState("");
  const [fileName, setFileName] = useState("");

  const [resumeBlocks, setResumeBlocks] = useState<ResumeBlock[]>([]);
  const [result, setResult] = useState<PolishedResume | null>(null);
  const [fileError, setFileError] = useState("");
  const [fileStatus, setFileStatus] = useState("");
  const [linkStatus, setLinkStatus] = useState("");
  const [isPolishing, setIsPolishing] = useState(false);
  // Per-stage progress state for the two-stage polish flow (Tailor / Review).
  // Shown in the PolishProgress component while a polish is in-flight or has
  // a failed stage. Reset to all-idle on every new polish run.
  const idleProgress = (): PolishProgressState => ({
    tailor: { status: "idle" },
    review: { status: "idle" }
  });
  const [polishProgress, setPolishProgress] = useState<PolishProgressState>(idleProgress);
  // True once a polish has been initiated — keeps PolishProgress visible after
  // the run completes (including failures) until the user dismisses it.
  const [polishProgressVisible, setPolishProgressVisible] = useState(false);
  // Aborts the in-flight polish fetch(es) when the user clicks Stop. Created per
  // run in handlePolish/retryStage; both stages share one controller so a Stop
  // during either tailor or review cancels the whole run.
  const polishAbortRef = useRef<AbortController | null>(null);
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
    aiProvider,
    apiKey,
    setApiKey,
    apiBaseUrl,
    setApiBaseUrl,
    selectedModel,
    setSelectedModel,
    cliReasoningEffort,
    setCliReasoningEffort,
    customModel,
    setCustomModel,
    handleProviderChange,
    auditProvider,
    auditSelectedModel,
    setAuditSelectedModel,
    auditCustomModel,
    setAuditCustomModel,
    auditCliReasoningEffort,
    setAuditCliReasoningEffort,
    auditApiBaseUrl,
    setAuditApiBaseUrl,
    auditApiKey,
    setAuditApiKey,
    handleAuditProviderChange,
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
  const [includeCoverLetter, setIncludeCoverLetter] = useState(false);
  const [activeOutputTab, setActiveOutputTab] = useState<OutputTab>("resume");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [baseResumeName, setBaseResumeName] = useState("");
  const [baseResumeOptions, setBaseResumeOptions] = useState<BaseResumeOption[]>([]);
  const [baseResumeHistory, setBaseResumeHistory] = useState<BaseResumeHistoryGroup[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [isSavingBaseResume, setIsSavingBaseResume] = useState(false);
  const [pipelineFilter, setPipelineFilter] = useState<"all" | ApplicationStatus>("all");
  const [trackerView, setTrackerView] = useState<TrackerView>("table");
  const [expandedApplicationId, setExpandedApplicationId] = useState<string | null>(null);
  // Saved-application resume PDF preview ({url,name} → open; null → closed).
  const [resumePreview, setResumePreview] = useState<{ url: string; name: string } | null>(null);
  const [isApplicationModalOpen, setIsApplicationModalOpen] = useState(false);
  // null → the modal is in "add" mode; an id → it edits that application.
  const [modalApplicationId, setModalApplicationId] = useState<string | null>(null);
  // Post-Apply download prompt: holds the just-applied role's label while open.
  const [applyDownloadPrompt, setApplyDownloadPrompt] = useState<{ label: string } | null>(null);
  // The user's remembered "download this format on Apply" choice (localStorage).
  const [defaultExportFormat, setDefaultExportFormat] = useState<ExportFormat | null>(loadDefaultExportFormat);
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

  // Derive a short job-label for the autosave context (role + company only —
  // never the full JD body). Evaluated inline; will be stable enough for the
  // 1200 ms debounce window.
  const _autosaveJobLabel = useMemo(() => {
    if (!jobDescription.trim()) return "";
    const { tracking } = extractJobPosting(jobDescription, { url: jobUrl });
    const parts = [tracking.role, tracking.company].filter(Boolean);
    return parts.join(" · ");
  }, [jobDescription, jobUrl]);

  // Debounced autosave to localStorage whenever the editor has unsaved edits.
  useAutosaveDraft({ editedResume, dirty: resumeEdited, jobLabel: _autosaveJobLabel });

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
  const otherSessionsSig = useMemo(() => activeSessionsSignature(otherSessions), [otherSessions]);
  const [dismissedSessionsSig, setDismissedSessionsSig] = useState<string | null>(null);
  const showActiveSessions = otherSessions.length > 0 && otherSessionsSig !== dismissedSessionsSig;

  // Auto-fill the job description from the browser extension inbox. AI distiller
  // first (server-side keys), deterministic engine as the fallback.
  useExtensionInbox(async (item) => {
    // The posting was AI-distilled server-side in the background (the hook polled
    // through the "distilling" state until the brief was ready). Use those
    // structured fields directly; fall back to the deterministic engine on the raw
    // text only when both the server's AI distill and a selected-provider retry
    // fail. The retry matters because extension imports cannot read the app tab's
    // localStorage settings, so the background server pass may have used a
    // different default provider than the one selected in the AI menu.
    const { text, url, fields, autoTailor } = item;
    const { extracted, source } = fields
      ? extractedFromAiOrLocal(fields as Partial<AiDistillFields>, text, url || undefined)
      : await distillJobPosting(text, {
          url: url || undefined,
          aiRequest: buildAiRequestFields({ aiProvider, apiKey, apiBaseUrl, selectedModel, customModel, cliReasoningEffort })
        });
    const relevant = extracted.tailoringText;
    if (relevant.trim().length < 40) {
      setPolishStatus("Extension import had too little job text — paste manually.");
      setDistillRetrySource(null);
      setDistillProgress({ status: "failed", error: "Imported posting had too little job text — paste manually." });
      setDistillProgressVisible(true);
      return;
    }
    const trimmedUrl = (url || "").trim();
    setJobUrl(trimmedUrl);
    setJobDescription(relevant);
    setImportedJob({
      url: trimmedUrl,
      tailoringText: relevant.trim(),
      tracking: extracted.tracking,
      manualReviewFields: extracted.manualReviewFields,
    });
    setResult(null);
    applyCoverLetter("");
    // Auto-tailor THIS import only, and always (re)set from the toggle so a
    // toggle-OFF import clears any stale intent a prior toggle-ON import left.
    setAutoTailorJob(autoTailor ? relevant.trim() : null);
    // The distill card now carries the AI-vs-local signal, so the status line just
    // covers import/auto-tailor context. The imported JD satisfies the
    // description-length gate; the only thing that can still defer the auto-polish
    // is a missing resume / Tailor section — say so rather than appearing to do nothing.
    setDistillRetrySource(null);
    setDistillProgress(distillDoneState(source));
    setDistillProgressVisible(true);
    const readyToTailor =
      Boolean(editedResume) && Object.values(tailorModes).some((mode) => mode === "tailor");
    setPolishStatus(
      autoTailor && !readyToTailor
        ? `Job imported from the browser extension — ${
            editedResume ? "set a section to Tailor" : "load a resume"
          } and it'll tailor automatically.`
        : "Job imported from the browser extension."
    );
  }, () => {
    // Background server-side distill still running — surface it on the same card
    // the link/paste flows use (no Retry: an extension import has nothing to
    // re-run). Guard the running state so repeated polls don't churn renders.
    setDistillRetrySource(null);
    setDistillProgress((prev) => (prev.status === "running" ? prev : { status: "running" }));
    setDistillProgressVisible(true);
  });

  // Warn before close/reload when there are unsaved edits OR a distill/tailor/
  // review is mid-flight (losing an in-progress run is as costly as losing edits).
  // Apply clears `resumeEdited` (markResumeClean) since the work is then persisted
  // and a copy exported; editing again re-arms it.
  useBeforeUnloadGuard(
    resumeEdited || isPolishing || distillProgress.status === "running"
  );

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
    findForTarget
  } = useApplications();

  const {
    answersResult,
    answersStatus,
    isGeneratingAnswers,
    handleGenerateAnswers,
    handleSaveAnswers
  } = useApplicationAnswers({
    resumeText,
    jobDescription,
    jobUrl,
    honestContext: requestHonestContext,
    customInstructions,
    aiRequest: { aiProvider, apiKey, apiBaseUrl, selectedModel, customModel, cliReasoningEffort },
    upsertApplication,
    findForTarget
  });

  // Distill the job once per (description, url, import) instead of on every
  // render. The full extractJobPosting parser is ~1500 LOC; running it in the
  // component body (the cover letter, materialsJobTarget, and the apply/export
  // callers below) re-parsed the JD on every keystroke-driven re-render.
  // Memoizing matches the debounce discipline the scoring path already uses,
  // with no behavior change.
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

  // On-demand cover letter (no full polish required). Generates from the CURRENT
  // resume; the polish path also feeds this state (see runTailorStage) so the
  // Materials view, Copy, and save-to-application all read one source.
  const {
    coverLetterText,
    applyCoverLetter,
    coverStatus,
    isGeneratingCover,
    handleGenerateCoverLetter
  } = useCoverLetter({
    currentResumeText,
    jobText: jobDescription,
    honestContext: requestHonestContext,
    customInstructions,
    aiRequest: { aiProvider, apiKey, apiBaseUrl, selectedModel, customModel, cliReasoningEffort },
    resumeText,
    jobCompany: jobTracking.company,
    jobRoleTitle: jobTracking.role
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

  const combinedJobText = jobDescription;

  // Debounce the live inputs so per-keystroke synchronous scoring doesn't jank
  // typing on large resumes. The polished `result` stays immediate.
  const debouncedResumeText = useDebouncedValue(resumeText);
  const debouncedCombinedJobText = useDebouncedValue(combinedJobText);
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
    combinedJobText,
    debouncedResumeText,
    debouncedCombinedJobText,
    debouncedCurrentResumeText,
    // Gate AI fit provenance on FREE edits only — accepting the AI's reviewed
    // suggestions keeps the verdict "AI-judged" (it describes that proposal).
    isEdited: resumeManuallyEdited,
    editedResume,
    result,
    resumeBlocks
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

  // ----- Handlers -----

  // `skipConfirm` is true on paths that PRESERVE the user's work (Save) or are
  // triggered on first mount before the user has made any edits. It is false on
  // explicit Reload, Load-version, and Restore actions where the user could have
  // unsaved edits they'd lose.
  async function applyWorkspaceBaseResume(baseResume: WorkspaceBaseResume, status: string, skipConfirm = false) {
    if (!baseResume.exists || !baseResume.text) return;

    if (!skipConfirm && resumeEdited) {
      if (!(await confirmReplaceEditor())) return;
      // User confirmed the replace — the autosaved draft of the old edits is
      // now superseded; clear it so the restore bar doesn't linger.
      clearAutosaveDraft();
      setPendingAutosaveDraft(null);
    }

    saveLastBaseResumeName(baseResume.fileName ?? "");
    setResumeText(baseResume.text);
    setFileName(baseResume.fileName ?? "base-resume");
    setBaseResumeName(baseResume.fileName ?? "");
    setResult(null);
    applyCoverLetter("");
    setFileError("");
    setPolishStatus("");
    resetExportStatuses();
    setTexStatus("");
    // Make the loaded base resume editable straight away (pre-polish).
    seedResumeEditor(baseResume.text, "");

    if (baseResume.kind === "docx" && baseResume.docxBase64) {
      setResumeBlocks(buildResumeBlocks(baseResume.text));
      setFileStatus(`${status} DOCX content parsed into the editor.`);
    } else {
      setResumeBlocks([]);
      setFileStatus(status);
    }
  }

  function updateWorkspaceState(workspace: JobWorkspace) {
    setWorkspacePath(workspace.path);
    setWorkspaceFiles(workspace.files ?? []);
    setBaseResumeName(workspace.baseResume?.exists ? workspace.baseResume.fileName ?? "" : "");
    setBaseResumeOptions(workspace.baseResumeOptions ?? []);
    // Only overwrite history when the response actually carries it. A partial
    // response (e.g. a caller that forgets the field) must not silently wipe the
    // Recent list — that was the "history disappears on save" bug.
    if (workspace.baseResumeHistory !== undefined) setBaseResumeHistory(workspace.baseResumeHistory);
  }

  async function loadWorkspace(applyBaseResume = false) {
    try {
      const response = await fetch("/api/workspace");
      const workspace = (await response.json()) as JobWorkspace & { error?: string };
      if (!response.ok) throw new Error(workspace.error ?? "Workspace check failed.");

      updateWorkspaceState(workspace);
      if (workspace.baseResume?.exists) {
        if (applyBaseResume) {
          const rememberedName = loadLastBaseResumeName();
          const availableBaseNames = new Set([
            workspace.baseResume.fileName ?? "",
            ...(workspace.baseResumeOptions ?? []).map((option) => option.fileName)
          ]);
          const rememberedExists = availableBaseNames.has(rememberedName);
          if (
            rememberedName &&
            rememberedExists &&
            rememberedName !== workspace.baseResume.fileName
          ) {
            await loadBaseResumeVersion(rememberedName);
            return;
          }
          if (rememberedName && !rememberedExists) {
            saveLastBaseResumeName("");
          }
          setWorkspaceStatus("");
          await applyWorkspaceBaseResume(workspace.baseResume, "");
          return;
        }
        setWorkspaceStatus("");
      } else {
        saveLastBaseResumeName("");
        setWorkspaceStatus("Local workspace ready. Save a base resume to use it automatically on startup.");
        if (applyBaseResume && workspace.baseResume?.text) {
          setResumeText(workspace.baseResume.text);
          seedResumeEditor(workspace.baseResume.text, "");
          setFileStatus("Loaded the starter template. Replace it with your own resume to get started.");
        }
      }
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Local workspace could not be checked.");
    }
  }

  async function saveBaseResume(payload: { fileName: string; fileBase64?: string; text?: string }) {
    setIsSavingBaseResume(true);
    setWorkspaceStatus("Saving base resume to the local workspace…");

    try {
      const response = await fetch("/api/workspace/base-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const workspace = (await response.json()) as Partial<JobWorkspace> & {
        baseResume?: WorkspaceBaseResume;
        error?: string;
      };
      if (!response.ok || !workspace.baseResume) {
        throw new Error(workspace.error ?? "Base resume save failed.");
      }

      updateWorkspaceState({
        path: workspace.path ?? workspacePath,
        baseResume: workspace.baseResume,
        baseResumeOptions: workspace.baseResumeOptions,
        baseResumeHistory: workspace.baseResumeHistory,
        files: workspace.files ?? workspaceFiles
      });
      // Save preserves the user's work — no confirm needed; also clear the
      // autosave since the edits are now persisted to the workspace file.
      clearAutosaveDraft();
      await applyWorkspaceBaseResume(workspace.baseResume, "", true);
      setWorkspaceStatus("Saved.");
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Base resume save failed.");
    } finally {
      setIsSavingBaseResume(false);
    }
  }

  async function removeBaseResume() {
    if (!baseResumeName) return;
    // Destructive + irreversible-looking action: confirm first. The server keeps
    // a timestamped backup in .trash, so this is recoverable, but a stray click
    // shouldn't wipe a base resume.
    if (
      !(await confirm({
        title: "Remove base resume?",
        message: `Remove the base resume "${baseResumeName}"? A backup is kept in job-search-workspace/.trash, and the resume text stays in the editor.`,
        confirmLabel: "Remove",
        tone: "danger"
      }))
    )
      return;
    setIsSavingBaseResume(true);
    setWorkspaceStatus("Removing the base resume from the local workspace…");
    try {
      const response = await fetch("/api/workspace/base-resume", { method: "DELETE" });
      const workspace = (await response.json()) as Partial<JobWorkspace> & { error?: string };
      if (!response.ok) throw new Error(workspace.error ?? "Base resume removal failed.");
      updateWorkspaceState({
        path: workspace.path ?? workspacePath,
        baseResume: workspace.baseResume ?? { exists: false },
        baseResumeOptions: workspace.baseResumeOptions,
        baseResumeHistory: workspace.baseResumeHistory,
        files: workspace.files ?? workspaceFiles
      });
      // Detach the file from the editor so the resume text is editable again,
      // but keep the current text so the user doesn't lose their draft.
      saveLastBaseResumeName("");
      setFileName("");
      setResumeBlocks([]);
      setFileStatus("");
      setWorkspaceStatus("Removed the base resume (backup saved in .trash). Save again to set a new one.");
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Base resume removal failed.");
    } finally {
      setIsSavingBaseResume(false);
    }
  }

  async function restoreBaseResume(key: string) {
    if (resumeEdited) {
      if (!(await confirmReplaceEditor())) return;
      clearAutosaveDraft();
      setPendingAutosaveDraft(null);
    }
    setIsSavingBaseResume(true);
    setWorkspaceStatus("Restoring from history…");
    try {
      const response = await fetch("/api/workspace/base-resume/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key })
      });
      const workspace = (await response.json()) as Partial<JobWorkspace> & {
        baseResume?: WorkspaceBaseResume;
        baseResumeHistory?: BaseResumeHistoryGroup[];
        error?: string;
      };
      if (!response.ok || !workspace.baseResume) {
        throw new Error(workspace.error ?? "Restore failed.");
      }
      updateWorkspaceState({
        path: workspace.path ?? workspacePath,
        baseResume: workspace.baseResume,
        baseResumeOptions: workspace.baseResumeOptions,
        baseResumeHistory: workspace.baseResumeHistory,
        files: workspace.files ?? workspaceFiles
      });
      await applyWorkspaceBaseResume(workspace.baseResume, "", true); // confirmed above
      setWorkspaceStatus("Restored.");
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setIsSavingBaseResume(false);
    }
  }

  async function saveCurrentAsBaseResume() {
    const targetName = baseResumeName || fileName || "base-resume.txt";
    let text = currentResumeText || resumeText;

    if (/\.tex$/i.test(targetName) && editedResume) {
      setIsSavingBaseResume(true);
      setWorkspaceStatus("Rendering current resume to LaTeX before saving…");
      try {
        text = await renderTexFromSchema(toTemplateSchema(editedResume), selectedTemplateId, {
          docStyle: docStyle.style
        });
      } catch (error) {
        setWorkspaceStatus(error instanceof Error ? error.message : "Current resume could not be rendered to LaTeX.");
        setIsSavingBaseResume(false);
        return;
      }
    }

    await saveBaseResume({ fileName: targetName, text });
  }

  async function loadBaseResumeVersion(fileName: string) {
    if (resumeEdited) {
      if (!(await confirmReplaceEditor())) return;
      clearAutosaveDraft();
      setPendingAutosaveDraft(null);
    }
    setIsSavingBaseResume(true);
    setWorkspaceStatus("Loading base resume version…");
    try {
      const response = await fetch("/api/workspace/base-resume/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName })
      });
      const workspace = (await response.json()) as Partial<JobWorkspace> & {
        baseResume?: WorkspaceBaseResume;
        error?: string;
      };
      if (!response.ok || !workspace.baseResume) {
        throw new Error(workspace.error ?? "Base resume load failed.");
      }
      updateWorkspaceState({
        path: workspace.path ?? workspacePath,
        baseResume: workspace.baseResume,
        baseResumeOptions: workspace.baseResumeOptions,
        baseResumeHistory: workspace.baseResumeHistory,
        files: workspace.files ?? workspaceFiles
      });
      await applyWorkspaceBaseResume(workspace.baseResume, "", true); // confirmed above
      setWorkspaceStatus("");
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Base resume load failed.");
    } finally {
      setIsSavingBaseResume(false);
    }
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (resumeEdited) {
      // Capture the input element before the await — the synthetic event may be
      // recycled by React and event.target will be null after an async boundary.
      const input = event.target;
      if (!(await confirmReplaceEditor())) {
        // Reset the file input so the same file can be chosen again later.
        input.value = "";
        return;
      }
      clearAutosaveDraft();
      setPendingAutosaveDraft(null);
    }

    setFileName(file.name);
    setFileError("");
    setFileStatus("");
    // Clear any stale "Load a resume before polishing." guard — uploading is
    // exactly the action that resolves it.
    setPolishStatus("");
    setResumeBlocks([]);
    setResult(null);
    applyCoverLetter("");

    if (/\.pdf$/i.test(file.name)) {
      setFileError(
        "PDF uploads are text-only and cannot preserve layout. Upload the original DOCX or TEX for format-preserving edits, or paste extracted PDF text."
      );
      return;
    }

    if (/\.docx$/i.test(file.name)) {
      try {
        const base64 = arrayBufferToBase64(await file.arrayBuffer());
        const response = await fetch("/api/import-resume-docx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docxBase64: base64 })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "DOCX import failed.");
        setResumeText(String(data.text ?? ""));
        setResumeBlocks(buildResumeBlocks(String(data.text ?? "")));
        seedResumeEditor(String(data.text ?? ""), "");
        setFileStatus("DOCX parsed into the editor.");
      } catch (error) {
        setFileError(
          error instanceof Error ? error.message : "DOCX import failed. Try saving the resume from Word as a fresh DOCX."
        );
      }
      return;
    }

    if (/\.tex$/i.test(file.name)) {
      // Keep the raw LaTeX as the working text so AI rewrites can preserve it in
      // place as .tex; parse it into the structured editor for interactive edits.
      const texText = await file.text();
      // The local parser bounds input at 200 KB (resumeData.ts MAX_LATEX_INPUT); a
      // larger file would parse to an empty editor while claiming success — surface it.
      if (texText.length > 200_000) {
        setFileError("This .tex file is too large to parse locally (over 200 KB). Paste the resume content directly instead.");
        return;
      }
      setResumeText(texText);
      setResumeBlocks([]);
      seedResumeEditor(texText, "");
      setFileStatus("LaTeX source loaded and parsed into the editor. Export as .tex or compile with Tectonic.");
      return;
    }

    if (!/\.(txt|md|csv)$/i.test(file.name)) {
      setFileError("Upload DOCX or TEX for format-preserving edits, or TXT, MD, or CSV for text-only polishing.");
      return;
    }

    try {
      const text = await file.text();
      setResumeText(text);
      setResumeBlocks([]);
      seedResumeEditor(text, "");
      setFileStatus("Text file loaded. Export uses the clean ATS PDF template or any LaTeX template.");
    } catch {
      setFileError("The file could not be read. Try pasting the resume text instead.");
    }
  }

  // ----- Polish flow (shared) -----
  // handlePolish and retryStage both run the two-stage polish (Tailor → Review)
  // against /api/polish. The per-run context (scoped resume text, local fallback,
  // common request body), the reviewer-attribution + merge helpers, and the two
  // stage runners are hoisted to component scope so the initial run and a
  // per-stage retry share ONE implementation. The two copies had drifted (e.g. a
  // stale provenance path in retry); consolidating removes that hazard.

  type PolishContext = {
    scopedResumeText: string;
    fallback: PolishedResume;
    commonBody: Record<string, unknown>;
  };

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
    // cited. The editable-only variant powers the gate and the LOCAL fallback,
    // which rewrites its input: feeding it editable-only keeps the deterministic
    // fallback from rewording an Include section (the read-only promise holds on
    // every path, not just the AI one).
    const scopedResumeText = tailorScopeToText(tailorScope);
    const editableResumeText = tailorScopeToText(tailorScope, true);
    // Gate on EDITABLE sections: a context-only scope (Include but nothing to
    // Tailor) has no targets, so it cannot be polished.
    if (!tailorScope.sections.length || editableResumeText.trim().length < 40) {
      setPolishStatus("Set at least one resume section to Tailor.");
      return null;
    }

    const fallbackBase = polishResume(editableResumeText, combinedJobText);
    const fallback = includeCoverLetter
      ? {
          ...fallbackBase,
          coverLetterText: draftCoverLetter(resumeText, combinedJobText, fallbackBase.polishedText, {
            company: jobTracking.company,
            roleTitle: jobTracking.role
          })
        }
      : fallbackBase;

    // Common request body shared by both stages.
    const commonBody = {
      ...buildAiRequestFields({ aiProvider, apiKey, apiBaseUrl, selectedModel, customModel, cliReasoningEffort }),
      ...buildAuditRequestFields({ auditProvider, auditApiKey, auditApiBaseUrl, auditSelectedModel, auditCustomModel, auditCliReasoningEffort }),
      tailorScope,
      jobText: jobDescription,
      includeCoverLetter,
      honestContext: requestHonestContext,
      customInstructions
    };

    return { scopedResumeText, fallback, commonBody };
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

  // Merge review data (aiScore, strictReview, reviewedBy) from a server response
  // into the current result, preferring any missing-skills the prior result held.
  // `fallback` is the base when there is no prior result (review-only with no tailor).
  function mergeReviewIntoResult(
    prev: PolishedResume | null,
    data: Record<string, unknown>,
    reviewedBy: string,
    fallback: PolishedResume
  ): PolishedResume {
    const base = prev ?? fallback;
    const prevMissing = base.missingRequiredSkills;
    const dataMissing = Array.isArray(data.missingRequiredSkills) ? data.missingRequiredSkills : undefined;
    return {
      ...base,
      aiScore: (data.aiScore as PolishedResume["aiScore"]) ?? undefined,
      strictReview: (data.strictReview as PolishedResume["strictReview"]) ?? undefined,
      reviewedBy: reviewedBy || undefined,
      missingRequiredSkills: (prevMissing?.length ? prevMissing : dataMissing) ?? undefined
    };
  }

  // Stage runner: Tailor. Sets progress.tailor=running, posts to /api/polish
  // with stages:"tailor", builds a result WITHOUT aiScore/strictReview (so the
  // fit verdict shows "Estimated"/local, not "AI-judged"). Returns the
  // server-sanitized suggestedChanges array on success, null on failure.
  async function runTailorStage(ctx: PolishContext, signal?: AbortSignal): Promise<PolishedResume["suggestedChanges"] | null> {
    const { scopedResumeText, fallback, commonBody } = ctx;
    setPolishProgress((prev) => ({ ...prev, tailor: { status: "running" }, review: { status: "idle" } }));
    try {
      const response = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...commonBody, stages: "tailor" }),
        signal
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error((data.error as string) ?? "AI tailor failed.");
      const suggestedChanges: PolishedResume["suggestedChanges"] = Array.isArray(data.suggestedChanges) ? data.suggestedChanges : [];
      if (!data.polishedText && !suggestedChanges.length) {
        throw new Error("AI response did not include usable resume suggestions.");
      }
      const scopedPolishedText = data.polishedText
        ? normalizePolishedResume(data.polishedText as string, scopedResumeText)
        : scopedResumeText;
      const analysis = analyzeResumeText(
        suggestedChanges.length ? currentResumeText || scopedPolishedText : scopedPolishedText,
        combinedJobText
      );
      const coverText = includeCoverLetter
        ? (data.coverLetterText as string | undefined) ||
          draftCoverLetter(scopedResumeText, combinedJobText, scopedPolishedText, {
            company: jobTracking.company,
            roleTitle: jobTracking.role
          })
        : undefined;
      setResult({
        ...analysis,
        polishedText: suggestedChanges.length ? currentResumeText || scopedPolishedText : scopedPolishedText,
        source: "ai",
        coverLetterText: coverText,
        strengths: Array.isArray(data.strengths) && data.strengths.length ? data.strengths as string[] : fallback.strengths,
        fixes: Array.isArray(data.fixes) && data.fixes.length ? data.fixes as string[] : fallback.fixes,
        changeSummary: Array.isArray(data.changeSummary) && data.changeSummary.length ? data.changeSummary as string[] : undefined,
        missingRequiredSkills: Array.isArray(data.missingRequiredSkills) && data.missingRequiredSkills.length
          ? data.missingRequiredSkills as PolishedResume["missingRequiredSkills"]
          : undefined,
        suggestedChanges,
        droppedSuggestions: (data.droppedSuggestions as PolishedResume["droppedSuggestions"]) ?? null,
        // Tailor-only: no AI review fields — useResumeAnalysis must see these
        // as undefined so the fit verdict shows "Estimated"/local, not "AI-judged".
        aiScore: undefined,
        strictReview: undefined,
        reviewedBy: undefined
      });
      // Feed the shared cover-letter state so Materials/Copy/save read one source
      // whether the letter came from the polish pass or on-demand generation.
      if (coverText) applyCoverLetter(coverText);
      setActiveOutputTab("resume");
      setPolishProgress((prev) => ({ ...prev, tailor: { status: "done" } }));
      return suggestedChanges;
    } catch (error) {
      // User clicked Stop — let the orchestrator handle the clean stop; do NOT
      // drop in the local fallback or mark the stage failed.
      if (signal?.aborted) throw error;
      setResult(fallback);
      // The local fallback carries a cover letter when one was requested; feed
      // it to the single-owner state so Materials/Copy/save still show it.
      if (fallback.coverLetterText) applyCoverLetter(fallback.coverLetterText);
      setActiveOutputTab("resume");
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      setPolishProgress((prev) => ({
        ...prev,
        tailor: { status: "failed", error: `AI unavailable: ${message}. Local analysis shown.` }
      }));
      return null;
    }
  }

  // Stage runner: Review. Sets progress.review=running, posts with stages:"review"
  // and the sanitized suggestedChanges (from the prior tailor, or [] for
  // review-only). Merges review data (aiScore, strictReview) into the current
  // result via setResult; for review-only with no prior result it synthesizes a
  // base result first so the verdict describes the displayed resume.
  async function runReviewStage(ctx: PolishContext, suggestions: PolishedResume["suggestedChanges"], signal?: AbortSignal): Promise<void> {
    const { scopedResumeText, fallback, commonBody } = ctx;
    setPolishProgress((prev) => ({ ...prev, review: { status: "running" } }));
    try {
      const response = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...commonBody, stages: "review", suggestedChanges: suggestions ?? [] }),
        signal
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error((data.error as string) ?? "AI review failed.");
      const reviewedBy = computePolishReviewedBy(data);
      setResult((prev) => {
        // review-only (no prior tailor): synthesize a base result first.
        if (!prev) {
          const baseAnalysis = analyzeResumeText(currentResumeText || scopedResumeText, combinedJobText);
          const baseResult: PolishedResume = {
            ...baseAnalysis,
            polishedText: currentResumeText || scopedResumeText,
            source: "ai",
            strengths: fallback.strengths,
            fixes: fallback.fixes,
            suggestedChanges: []
          };
          return mergeReviewIntoResult(baseResult, data, reviewedBy, fallback);
        }
        return mergeReviewIntoResult(prev, data, reviewedBy, fallback);
      });
      setActiveOutputTab("resume");
      setPolishProgress((prev) => ({ ...prev, review: { status: "done" } }));
    } catch (error) {
      // User clicked Stop — let the orchestrator handle the clean stop. The
      // existing result (e.g. a completed tailor in "both") is left intact.
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      setPolishProgress((prev) => ({
        ...prev,
        review: { status: "failed", error: `AI review unavailable: ${message}.` }
      }));
      // Keep the existing result — don't clobber a successful tailor result.
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

    const controller = new AbortController();
    polishAbortRef.current = controller;
    const { signal } = controller;
    setIsPolishing(true);
    setPolishProgress(idleProgress());
    setPolishProgressVisible(true);
    setPolishStatus("");
    resetExportStatuses();
    setTexStatus("");

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
          // Tailor failed — mark review as skipped/failed so the user knows.
          setPolishProgress((prev) => ({
            ...prev,
            review: { status: "failed", error: "Tailor failed — retry Tailor to enable Review." }
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

  // DONE-card state for a distill run, calling out AI success vs local fallback.
  const distillDoneState = (source: "ai" | "local"): StageState =>
    source === "ai"
      ? { status: "done", note: "Distilled with AI", noteTone: "ok" }
      : { status: "done", note: "AI unavailable — used local extraction", noteTone: "warn" };

  async function handleExtractFromLink() {
    const url = jobUrl.trim();
    if (!url || isExtractingLink) return;
    setIsExtractingLink(true);
    setDistillRetrySource("link");
    setDistillProgress({ status: "running" });
    setDistillProgressVisible(true);
    setLinkStatus("Fetching the posting…");
    try {
      const response = await fetch("/api/import-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not read that link.");
      // AI distiller (server-side keys) trims the scraped page to the parts worth
      // polishing and extracts tracker details; falls back to the deterministic
      // engine on any failure so a link import always produces a brief.
      setLinkStatus("Distilling the posting…");
      const { extracted, source } = await distillJobPosting(String(data.text ?? ""), {
        url,
        aiRequest: buildAiRequestFields({ aiProvider, apiKey, apiBaseUrl, selectedModel, customModel, cliReasoningEffort })
      });
      const relevant = extracted.tailoringText;
      if (relevant.trim().length < 40) {
        setLinkStatus("Fetched the page, but found too little job text. Paste the description instead.");
        setDistillProgress({ status: "failed", error: "Too little job text on that page — paste the description instead." });
        setImportedJob(null);
        return;
      }
      setJobDescription(relevant);
      setImportedJob({
        url,
        tailoringText: relevant.trim(),
        tracking: extracted.tracking,
        manualReviewFields: extracted.manualReviewFields
      });
      setResult(null);
      applyCoverLetter("");
      const missing = compactManualReviewFields(extracted.manualReviewFields);
      setLinkStatus(
        `Distilled ${relevant.length.toLocaleString()} compact characters for tailoring and captured ${presentTrackingFields(
          extracted.tracking
        )}${missing ? `; add ${missing} manually if needed` : ""}.`
      );
      setDistillProgress(distillDoneState(source));
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      setImportedJob(null);
      setLinkStatus(`Couldn't extract from the link: ${message}. Paste the description instead.`);
      setDistillProgress({ status: "failed", error: `Couldn't extract from the link: ${message}.` });
    } finally {
      setIsExtractingLink(false);
    }
  }

  // Distill whatever the user pasted into the Job posting box through the same
  // pipeline the link path uses. Covers JDs the server can't fetch (Workday
  // wd1 tenants, ADP, anything JS-only): user copies the visible page text from
  // their browser, pastes it in, and gets the structured brief plus tracking.
  async function handleDistillPaste() {
    const raw = jobDescription;
    if (!raw.trim() || isExtractingLink) return;
    // Strip HTML tags only if the paste looks tag-shaped (text from "View
    // source" or a copied editor block). Plain copy-paste from a rendered page
    // doesn't need this and passes through untouched.
    const looksLikeHtml = /<\/?[a-z][\s\S]{0,40}>/i.test(raw) && raw.split("<").length > 5;
    const cleaned = looksLikeHtml
      ? raw
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr|section|header|footer|article)>/gi, "\n")
          .replace(/<li[^>]*>/gi, "\n• ")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;|&#39;/gi, '"')
      : raw;
    if (cleaned.trim().length < 80) {
      setLinkStatus("Paste a bit more job text first — distillation needs a real description to work from.");
      return;
    }
    setIsExtractingLink(true);
    setDistillRetrySource("paste");
    setDistillProgress({ status: "running" });
    setDistillProgressVisible(true);
    setLinkStatus("Distilling the paste…");
    try {
      const { extracted, source } = await distillJobPosting(cleaned, {
        url: jobUrl.trim() || undefined,
        aiRequest: buildAiRequestFields({ aiProvider, apiKey, apiBaseUrl, selectedModel, customModel, cliReasoningEffort })
      });
      const relevant = extracted.tailoringText;
      if (relevant.trim().length < 40) {
        setLinkStatus("Couldn't find enough job-relevant text in the paste. Check that you copied the description, not just the page header.");
        setDistillProgress({ status: "failed", error: "Couldn't find enough job-relevant text in the paste." });
        return;
      }
      setJobDescription(relevant);
      setImportedJob({
        url: jobUrl.trim(),
        tailoringText: relevant.trim(),
        tracking: extracted.tracking,
        manualReviewFields: extracted.manualReviewFields
      });
      setResult(null);
      applyCoverLetter("");
      const missing = compactManualReviewFields(extracted.manualReviewFields);
      setLinkStatus(
        `Distilled ${relevant.length.toLocaleString()} compact characters from the paste and captured ${presentTrackingFields(
          extracted.tracking
        )}${missing ? `; add ${missing} manually if needed` : ""}.`
      );
      setDistillProgress(distillDoneState(source));
    } catch (error) {
      // distillJobPosting is built to fall back to local rather than throw, so
      // this only fires on an unexpected error — surface it instead of leaving
      // the card stuck on "running".
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "distillation failed";
      setLinkStatus(`Couldn't distill the paste: ${message}.`);
      setDistillProgress({ status: "failed", error: `Couldn't distill the paste: ${message}.` });
    } finally {
      setIsExtractingLink(false);
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
    const existing = findForTarget(jobUrl, jobDescription);
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

  // Apply button handler: if the user has opted to skip the dialog, commit
  // immediately; otherwise show the pre-apply dialog for format/base choice.
  function handleApply() {
    if (!jobUrl.trim() && !jobDescription.trim()) return;
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
    if (app.resumeData || app.polishedText) {
      const restoredResume = app.polishedText || (app.resumeData ? serializeResumeData(app.resumeData) : "");
      const restoredAnalysis = analyzeResumeText(restoredResume, app.jobDescription || "");
      setResumeText(restoredResume);
      setFileName("");
      setResumeBlocks([]);
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
        strengths: app.review?.verdictReason ? [app.review.verdictReason] : ["Loaded from pipeline snapshot."],
        fixes: app.review?.recommendation?.topEdits?.length
          ? app.review.recommendation.topEdits
          : ["Review against the current job text before sending again."],
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

  // Resolve the distill card's Retry to the live handler for the last action, so
  // it re-runs against the CURRENT url / paste rather than a stale captured one.
  const distillRetry =
    distillRetrySource === "link"
      ? handleExtractFromLink
      : distillRetrySource === "paste"
        ? handleDistillPaste
        : undefined;

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
            setJobDescription={setJobDescription}
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
          <AiMenu
            aiProvider={aiProvider}
            onProviderChange={handleProviderChange}
            apiKey={apiKey}
            setApiKey={setApiKey}
            apiBaseUrl={apiBaseUrl}
            setApiBaseUrl={setApiBaseUrl}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            customModel={customModel}
            setCustomModel={setCustomModel}
            cliReasoningEffort={cliReasoningEffort}
            setCliReasoningEffort={setCliReasoningEffort}
            reviewer={
              <ReviewerSettings
                auditProvider={auditProvider}
                onAuditProviderChange={handleAuditProviderChange}
                auditApiKey={auditApiKey}
                setAuditApiKey={setAuditApiKey}
                auditApiBaseUrl={auditApiBaseUrl}
                setAuditApiBaseUrl={setAuditApiBaseUrl}
                auditSelectedModel={auditSelectedModel}
                setAuditSelectedModel={setAuditSelectedModel}
                auditCustomModel={auditCustomModel}
                setAuditCustomModel={setAuditCustomModel}
                auditCliReasoningEffort={auditCliReasoningEffort}
                setAuditCliReasoningEffort={setAuditCliReasoningEffort}
              />
            }
          />
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

      {polishProgressVisible || distillProgressVisible || showActiveSessions ? (
        <div className="progress-dock" aria-label="Task progress">
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
          {distillProgressVisible ? (
            <DistillProgress
              state={distillProgress}
              onRetry={distillRetry}
              onDismiss={() => setDistillProgressVisible(false)}
            />
          ) : null}
          {showActiveSessions ? (
            <ActiveSessionsCard
              sessions={otherSessions}
              onDismiss={() => setDismissedSessionsSig(otherSessionsSig)}
            />
          ) : null}
        </div>
      ) : null}

      <div className="workspace-grid">
        <StudioPane
          activeOutputTab={activeOutputTab}
          setActiveOutputTab={setActiveOutputTab}
          outputTabs={outputTabs}
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
          onSkip={() => setApplyDownloadPrompt(null)}
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
