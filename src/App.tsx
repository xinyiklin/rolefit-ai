import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

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
import { arrayBufferToBase64 } from "./lib/downloads";
import { buildAiRequestFields, buildAuditRequestFields } from "./lib/aiRequest";
import { extractJobPosting, type ExtractedJobTracking } from "./lib/jobExtract";
import { buildResumeBlocks } from "./lib/resumeBlocks";
import { serializeResumeData, toTemplateSchema } from "./lib/resumeData";
import { buildTailorScope, defaultTailorSectionIds, tailorScopeToText } from "./lib/tailorScope";

import { AiMenu } from "./sections/AiMenu";
import { ReviewerSettings } from "./sections/ReviewerSettings";
import { Masthead } from "./sections/Masthead";
import { JobMenu } from "./sections/JobMenu";
import { PolishMenu } from "./sections/PolishMenu";
import { ResumeMenu } from "./sections/ResumeMenu";
import { StudioPane } from "./sections/StudioPane";
import { ExportMenu } from "./sections/ExportRail";
import { ApplyDownloadDialog } from "./sections/ApplyDownloadDialog";
import { loadDefaultExportFormat, saveDefaultExportFormat, type ExportFormat } from "./lib/exportPrefs";
const PreviewOverlay = lazy(() => import("./sections/PreviewOverlay"));
import { ApplicationModal } from "./sections/ApplicationModal";
import { ResumePrintLayer } from "./sections/ResumePrintLayer";
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

type JobWorkspace = {
  path: string;
  baseResume: WorkspaceBaseResume;
  baseResumeOptions?: BaseResumeOption[];
  baseResumeHistory?: BaseResumeHistoryEntry[];
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
  // ----- State -----
  const [jobDescription, setJobDescription] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [importedJob, setImportedJob] = useState<ImportedJobSnapshot | null>(null);
  const [isExtractingLink, setIsExtractingLink] = useState(false);
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
  const [, setPolishStatus] = useState("");
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
    customInstructions,
    setCustomInstructions
  } = ai;
  const [includeCoverLetter, setIncludeCoverLetter] = useState(false);
  // Default OFF: strict review fires a second, slow `claude -p` audit pass after
  // the rewrite, roughly doubling polish latency. Opt in via the Options menu
  // toggle when you want the skeptical recruiter audit.
  const [strictReview, setStrictReview] = useState(false);
  const [activeOutputTab, setActiveOutputTab] = useState<OutputTab>("resume");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [baseResumeName, setBaseResumeName] = useState("");
  const [baseResumeOptions, setBaseResumeOptions] = useState<BaseResumeOption[]>([]);
  const [baseResumeHistory, setBaseResumeHistory] = useState<BaseResumeHistoryEntry[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [isSavingBaseResume, setIsSavingBaseResume] = useState(false);
  const [pipelineFilter, setPipelineFilter] = useState<"all" | ApplicationStatus>("all");
  const [trackerView, setTrackerView] = useState<TrackerView>("table");
  const [expandedApplicationId, setExpandedApplicationId] = useState<string | null>(null);
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
    serializedResume,
    seed: seedResumeEditor,
    seedData: seedResumeData,
    actions: resumeEditorActions
  } = useResumeEditor();
  const currentResumeText = serializedResume || result?.polishedText || "";
  const [tailorSectionIds, setTailorSectionIds] = useState<string[]>([]);
  // User typography for the HTML resume page (Format menu): persisted CSS vars
  // applied to the editor and the print mirror.
  const docStyle = useDocStyle();

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
    honestContext,
    customInstructions,
    aiRequest: { aiProvider, apiKey, apiBaseUrl, selectedModel, customModel, cliReasoningEffort },
    upsertApplication,
    findForTarget
  });

  // ----- Effects -----
  useEffect(() => {
    void loadWorkspace(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumeSectionIdsKey = editedResume?.sections.map((section) => section.id).join("|") ?? "";
  useEffect(() => {
    if (!editedResume) {
      setTailorSectionIds([]);
      return;
    }
    const validIds = new Set(editedResume.sections.map((section) => section.id));
    setTailorSectionIds((current) => {
      const preserved = current.filter((id) => validIds.has(id));
      return preserved.length ? preserved : defaultTailorSectionIds(editedResume);
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

  // ----- Derived (memos) -----
  // The job link has its own field now: the description textarea holds the text
  // we tailor against, while `jobUrl` is optional metadata saved with the
  // application for pipeline tracking only — it is never sent to the model.
  const canPolish = useMemo(() => {
    return Boolean(editedResume && tailorSectionIds.length > 0 && jobDescription.trim().length > 40);
  }, [editedResume, jobDescription, tailorSectionIds.length]);

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
    resultSourceLabel
  } = useResumeAnalysis({
    resumeText,
    combinedJobText,
    debouncedResumeText,
    debouncedCombinedJobText,
    debouncedCurrentResumeText,
    isEdited: resumeEdited,
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
    jobReady
      ? (() => {
          const t = currentJobTracking();
          return t.role || t.company ? { role: t.role, company: t.company } : undefined;
        })()
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
    : !editedResume || !tailorSectionIds.length
    ? "Load a resume and select at least one resume section to tailor."
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

  function applyWorkspaceBaseResume(baseResume: WorkspaceBaseResume, status: string) {
    if (!baseResume.exists || !baseResume.text) return;

    setResumeText(baseResume.text);
    setFileName(baseResume.fileName ?? "base-resume");
    setBaseResumeName(baseResume.fileName ?? "");
    setResult(null);
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
    setBaseResumeHistory(workspace.baseResumeHistory ?? []);
  }

  async function loadWorkspace(applyBaseResume = false) {
    try {
      const response = await fetch("/api/workspace");
      const workspace = (await response.json()) as JobWorkspace & { error?: string };
      if (!response.ok) throw new Error(workspace.error ?? "Workspace check failed.");

      updateWorkspaceState(workspace);
      if (workspace.baseResume?.exists) {
        setWorkspaceStatus(`Local workspace ready with ${workspace.baseResume.fileName}.`);
        if (applyBaseResume) {
          applyWorkspaceBaseResume(
            workspace.baseResume,
            `Auto-loaded ${workspace.baseResume.fileName} from the local workspace.`
          );
        }
      } else {
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
        files: workspace.files ?? workspaceFiles
      });
      applyWorkspaceBaseResume(
        workspace.baseResume,
        `Saved and loaded ${workspace.baseResume.fileName} as the base resume.`
      );
      setWorkspaceStatus(`Saved ${workspace.baseResume.fileName} in the local workspace.`);
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
    const confirmed = window.confirm(
      `Remove the base resume "${baseResumeName}"?\n\nA backup is kept in job-search-workspace/.trash, and the resume text stays in the editor.`
    );
    if (!confirmed) return;
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
        files: workspace.files ?? workspaceFiles
      });
      // Detach the file from the editor so the resume text is editable again,
      // but keep the current text so the user doesn't lose their draft.
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
        baseResumeHistory?: BaseResumeHistoryEntry[];
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
      applyWorkspaceBaseResume(workspace.baseResume, `Restored ${workspace.baseResume.fileName} from history.`);
      setWorkspaceStatus(`Restored ${workspace.baseResume.fileName} from history.`);
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
      applyWorkspaceBaseResume(workspace.baseResume, `Loaded ${workspace.baseResume.fileName} into the editor.`);
      setWorkspaceStatus(`Loaded ${workspace.baseResume.fileName}.`);
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Base resume load failed.");
    } finally {
      setIsSavingBaseResume(false);
    }
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setFileError("");
    setFileStatus("");
    setResumeBlocks([]);
    setResult(null);

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

  async function handlePolish() {
    if (!editedResume) {
      setPolishStatus("Load a resume before polishing.");
      return;
    }
    const selectedIds = tailorSectionIds.length ? tailorSectionIds : defaultTailorSectionIds(editedResume);
    const tailorScope = buildTailorScope(editedResume, selectedIds);
    const scopedResumeText = tailorScopeToText(tailorScope);
    if (!tailorScope.sections.length || scopedResumeText.trim().length < 40) {
      setPolishStatus("Select at least one editable resume section to tailor.");
      return;
    }

    const fallbackBase = polishResume(scopedResumeText, combinedJobText);
    const fallback = includeCoverLetter
      ? { ...fallbackBase, coverLetterText: draftCoverLetter(resumeText, combinedJobText, fallbackBase.polishedText) }
      : fallbackBase;

    setIsPolishing(true);
    setPolishStatus(
      strictReview
        ? includeCoverLetter
          ? "Drafting targeted suggestions, strict review, and cover letter…"
          : "Drafting targeted suggestions and strict review…"
        : includeCoverLetter
          ? "Drafting targeted suggestions and cover letter…"
          : "Drafting targeted suggestions…"
    );
    resetExportStatuses();
    setTexStatus("");

    try {
      const response = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildAiRequestFields({
            aiProvider,
            apiKey,
            apiBaseUrl,
            selectedModel,
            customModel,
            cliReasoningEffort
          }),
          ...buildAuditRequestFields({
            auditProvider,
            auditApiKey,
            auditApiBaseUrl,
            auditSelectedModel,
            auditCustomModel,
            auditCliReasoningEffort
          }),
          tailorScope,
          jobText: jobDescription,
          includeCoverLetter,
          strictReview,
          honestContext,
          customInstructions
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "AI polish failed.");
      const suggestedChanges = Array.isArray(data.suggestedChanges) ? data.suggestedChanges : [];
      if (!data.polishedText && !suggestedChanges.length) {
        throw new Error("AI response did not include usable resume suggestions.");
      }

      const scopedPolishedText = data.polishedText
        ? normalizePolishedResume(data.polishedText, scopedResumeText)
        : scopedResumeText;
      const analysis = analyzeResumeText(suggestedChanges.length ? currentResumeText || scopedPolishedText : scopedPolishedText, combinedJobText);
      // Reviewer attribution: only when a DIFFERENT provider/model ran the audit
      // (an override). The server echoes the audit identity when strict review ran.
      const reviewedBy =
        data.auditProvider && (data.auditProvider !== data.provider || (data.auditModel || "") !== (data.model || ""))
          ? describeProviderModel(data.auditProvider, data.auditModel)
          : "";
      setResult({
        ...analysis,
        polishedText: suggestedChanges.length ? currentResumeText || scopedPolishedText : scopedPolishedText,
        source: "ai",
        coverLetterText: includeCoverLetter
          ? data.coverLetterText || draftCoverLetter(scopedResumeText, combinedJobText, scopedPolishedText)
          : undefined,
        strengths: data.strengths?.length ? data.strengths : fallback.strengths,
        fixes: data.fixes?.length ? data.fixes : fallback.fixes,
        changeSummary: Array.isArray(data.changeSummary) && data.changeSummary.length ? data.changeSummary : undefined,
        missingRequiredSkills: data.missingRequiredSkills?.length ? data.missingRequiredSkills : undefined,
        suggestedChanges,
        aiScore: data.aiScore ?? undefined,
        strictReview: data.strictReview ?? undefined,
        reviewedBy: reviewedBy || undefined
      });
      // Land where the user acts: the editor, with the recruiter review docked
      // beside it as actionable edit cards.
      setActiveOutputTab("resume");
      setPolishStatus(
        reviewedBy
          ? `Suggestions ready — drafted with ${describeProviderModel(data.provider, data.model)}, reviewed by ${reviewedBy}.`
          : `${data.strictReview ? "Recruiter-reviewed suggestions" : "Suggestions"} ready${data.model ? ` using ${data.model}` : ""}.`
      );
    } catch (error) {
      setResult(fallback);
      setActiveOutputTab("resume");
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      setPolishStatus(`AI unavailable: ${message}. Local engine analysis is shown; your editor was not replaced.`);
    } finally {
      setIsPolishing(false);
    }
  }

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

  function currentJobTracking(): ExtractedJobTracking {
    const fresh = extractJobPosting(jobDescription, { url: jobUrl }).tracking;
    const imported =
      importedJob &&
      importedJob.url === jobUrl.trim() &&
      importedJob.tailoringText === jobDescription.trim()
        ? importedJob.tracking
        : null;
    return imported ? { ...definedTracking(fresh), ...definedTracking(imported) } : definedTracking(fresh);
  }

  async function handleExtractFromLink() {
    const url = jobUrl.trim();
    if (!url || isExtractingLink) return;
    setIsExtractingLink(true);
    setLinkStatus("Fetching the posting…");
    try {
      const response = await fetch("/api/import-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not read that link.");
      // Local distiller trims the scraped page to the parts worth polishing
      // against while extracting tracker-only details separately.
      const extracted = extractJobPosting(String(data.text ?? ""), { url });
      const relevant = extracted.tailoringText;
      if (relevant.trim().length < 40) {
        setLinkStatus("Fetched the page, but found too little job text. Paste the description instead.");
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
      const missing = compactManualReviewFields(extracted.manualReviewFields);
      setLinkStatus(
        `Extracted ${relevant.length.toLocaleString()} compact characters for tailoring and captured ${presentTrackingFields(
          extracted.tracking
        )}${missing ? `; add ${missing} manually if needed` : ""}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      setImportedJob(null);
      setLinkStatus(`Couldn't extract from the link: ${message}. Paste the description instead.`);
    } finally {
      setIsExtractingLink(false);
    }
  }

  // Distill whatever the user pasted into the Job posting box through the same
  // pipeline the link path uses. Covers JDs the server can't fetch (Workday
  // wd1 tenants, ADP, anything JS-only): user copies the visible page text from
  // their browser, pastes it in, and gets the structured brief plus tracking.
  function handleDistillPaste() {
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
    const extracted = extractJobPosting(cleaned, { url: jobUrl.trim() || undefined });
    const relevant = extracted.tailoringText;
    if (relevant.trim().length < 40) {
      setLinkStatus("Couldn't find enough job-relevant text in the paste. Check that you copied the description, not just the page header.");
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
    const missing = compactManualReviewFields(extracted.manualReviewFields);
    setLinkStatus(
      `Distilled ${relevant.length.toLocaleString()} compact characters from the paste and captured ${presentTrackingFields(
        extracted.tracking
      )}${missing ? `; add ${missing} manually if needed` : ""}.`
    );
  }

  function handleApply() {
    if (!jobUrl.trim() && !jobDescription.trim()) return;
    const sr = result?.strictReview;
    // Apply always sends the final draft in the resume editor — the editor model
    // is the export/pipeline source of truth, so there's no "which resume?" prompt.
    // We still record whether that draft reflects accepted AI changes (tailored)
    // or is the untouched base, for honest pipeline display.
    const hasStructuredSuggestions = Boolean(result?.suggestedChanges?.length);
    const acceptedStructuredSuggestions =
      hasStructuredSuggestions &&
      Boolean(result?.polishedText) &&
      normalizeResumeSnapshot(currentResumeText) !== normalizeResumeSnapshot(result?.polishedText ?? "");
    const usedBase = !result?.polishedText || (hasStructuredSuggestions && !acceptedStructuredSuggestions);
    const sentResume = currentResumeText || resumeText || result?.polishedText || "";
    const existing = findForTarget(jobUrl, jobDescription);
    const now = new Date().toISOString();
    // Apply marks the role as submitted, but never regresses a role that's
    // already further along (interviewing/offer/etc.) on re-apply.
    const status: ApplicationStatus =
      existing && existing.status && existing.status !== "interested" ? existing.status : "applied";
    const draft = makeApplicationDraft(jobUrl, jobDescription, currentJobTracking());
    const app: Application = {
      ...draft,
      id: existing?.id ?? draft.id,
      // Keep the original applied date on re-apply; stamp it now the first time.
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
      coverLetterText: result?.coverLetterText ?? "",
      missingRequiredSkills: result?.missingRequiredSkills?.length ? result.missingRequiredSkills : undefined,
      // Snapshot the recruiter review so the pipeline keeps the verdict,
      // interview risks, and gaps for this application.
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
    setTexStatus(`Applied — saved "${existing?.title || app.title}" to Applications (${usedBase ? "original" : "tailored"} resume).`);
    setActiveOutputTab("applications");
    setExpandedApplicationId(existing?.id ?? app.id);
    // Snapshot the resume that went out (.tex always, PDF when Tectonic is
    // available) to the workspace so the detail modal can re-download it later.
    void saveAppliedResumeArtifacts(existing?.id ?? app.id, existing?.title || app.title);
    // Offer to download a copy of the resume that just went out, in the user's
    // preferred format (only when there is a renderable resume to export).
    if (canExportResume) setApplyDownloadPrompt({ label: existing?.title || app.title });
  }

  // Dispatch the post-Apply download to the matching export handler, passing the
  // file name the user chose in the prompt (export handlers sanitize + re-attach
  // the extension; an empty name falls back to the system name). When the user
  // opts in, remember the chosen format as their default for next time.
  function handleApplyDownloadPick(format: ExportFormat, makeDefault: boolean, fileBaseName: string) {
    if (makeDefault) {
      saveDefaultExportFormat(format);
      setDefaultExportFormat(format);
    }
    const base = fileBaseName || undefined;
    setApplyDownloadPrompt(null);
    if (format === "pdf-latex") void handleDownloadLatexPdf(base);
    else if (format === "pdf-clean") handlePrintResume(base);
    else handleDownloadTex(base);
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

  function handleLoadApplication(app: Application) {
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
      seedResumeEditor("");
    }
    setPolishStatus("");
    resetExportStatuses();
    setTexStatus("");
    setActiveOutputTab("resume");
  }

  function handleDeleteApplication(id: string, title: string) {
    if (!window.confirm(`Delete "${title}" from the pipeline?`)) return;
    removeApplication(id);
    if (modalApplicationId === id) setIsApplicationModalOpen(false);
  }

  // Double-click in any tracker view opens the full detail modal for that role.
  function handleOpenApplicationDetail(application: Application) {
    setModalApplicationId(application.id);
    setExpandedApplicationId(application.id);
    setIsApplicationModalOpen(true);
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
      <Masthead
        onApply={handleApply}
        applyDisabled={!jobUrl.trim() && !jobDescription.trim()}
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
            strictReview={strictReview}
            setStrictReview={setStrictReview}
            honestContext={honestContext}
            setHonestContext={setHonestContext}
            customInstructions={customInstructions}
            setCustomInstructions={setCustomInstructions}
            open={polishMenuOpen}
            onOpenChange={setPolishMenuOpen}
            honestContextRef={honestContextTextareaRef}
          />
        }
      />

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
              result={result}
              resumeDiff={resumeDiff}
              docStyle={docStyle}
              tailorSectionIds={tailorSectionIds}
              setTailorSectionIds={setTailorSectionIds}
              onAddHonestContext={handleAddHonestContext}
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
              onDelete={handleDeleteApplication}
              onAddApplication={handleAddApplication}
            />
          ) : null}

          {activeOutputTab === "materials" ? (
            <MaterialsTab
              result={result}
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
      />

      {applyDownloadPrompt ? (
        <ApplyDownloadDialog
          label={applyDownloadPrompt.label}
          tectonicAvailable={tectonic.available}
          defaultFormat={defaultExportFormat}
          defaultFileBaseName={resumeDownloadName("pdf").replace(/\.pdf$/i, "")}
          onDownload={handleApplyDownloadPick}
          onSkip={() => setApplyDownloadPrompt(null)}
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
