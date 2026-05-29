import { useEffect, useMemo, useState, type ChangeEvent } from "react";

import { createResumePdfBlob } from "./pdfResume";
import {
  analyzeMatchBreakdown,
  analyzeResumeText,
  buildResumeDiff,
  draftCoverLetter,
  normalizePolishedResume,
  type PolishedResume,
  polishResume
} from "./resumeEngine";
import { sampleResume } from "./samples";

import { useTemplates } from "./hooks/useTemplates";
import { useApplications, type Application, type ApplicationStatus } from "./hooks/useApplications";

import { Masthead } from "./sections/Masthead";
import {
  SourcesPane,
  type AiProviderValue,
  type ModelOption,
  type ProviderOption,
  type RoleOption
} from "./sections/SourcesPane";
import { StudioPane } from "./sections/StudioPane";
import { ExportRail } from "./sections/ExportRail";
import { ResumeTab } from "./sections/tabs/ResumeTab";
import { ReviewTab } from "./sections/tabs/ReviewTab";
import { StrictReviewTab } from "./sections/tabs/StrictReviewTab";
import { CoverLetterTab } from "./sections/tabs/CoverLetterTab";
import { PipelineTab } from "./sections/tabs/PipelineTab";
import type {
  OutputTab,
  OutputTabDescriptor,
  ResumeBlock,
  ResumeBlockKind,
  SourceDocx
} from "./sections/shared";

// ============ Constants ============

const providerOptions: readonly ProviderOption[] = [
  { value: "claude-cli", label: "Claude Max · CLI (recommended)", baseUrl: "", model: "opus" },
  { value: "codex-cli", label: "Codex Plus · CLI", baseUrl: "", model: "" },
  { value: "openai", label: "OpenAI", baseUrl: "", model: "" },
  { value: "anthropic", label: "Claude", baseUrl: "", model: "claude-sonnet-4-6" },
  { value: "gemini", label: "Gemini", baseUrl: "", model: "gemini-3.5-flash" },
  {
    value: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4.6"
  },
  {
    value: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile"
  },
  {
    value: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    model: "openai/gpt-oss-20b"
  },
  {
    value: "mistral",
    label: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-large-latest"
  },
  {
    value: "local",
    label: "Local / custom",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2"
  }
];

const customModelOption: ModelOption = { value: "custom", label: "Custom model" };

const modelOptionsByProvider: Record<AiProviderValue, readonly ModelOption[]> = {
  openai: [
    { value: "", label: "Server default" },
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { value: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
    customModelOption
  ],
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
    customModelOption
  ],
  gemini: [
    { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
    customModelOption
  ],
  openrouter: [
    { value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
    { value: "openai/gpt-5.5", label: "GPT-5.5" },
    { value: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    customModelOption
  ],
  groq: [
    { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
    { value: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
    { value: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
    customModelOption
  ],
  together: [
    { value: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
    customModelOption
  ],
  mistral: [
    { value: "mistral-large-latest", label: "Mistral Large" },
    { value: "mistral-medium-latest", label: "Mistral Medium" },
    { value: "mistral-small-latest", label: "Mistral Small" },
    customModelOption
  ],
  local: [
    { value: "llama3.2", label: "Llama 3.2" },
    { value: "llama3.1", label: "Llama 3.1" },
    { value: "local-model", label: "Local model" },
    customModelOption
  ],
  "claude-cli": [
    { value: "", label: "Subscription default" },
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" },
    { value: "haiku", label: "Haiku" },
    customModelOption
  ],
  "codex-cli": [
    { value: "", label: "Subscription default" },
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "o3", label: "o3" },
    customModelOption
  ]
};

const roleAppliedOptions: readonly RoleOption[] = [
  { value: "New Grad", label: "New Grad" },
  { value: "Early Career", label: "Early Career" },
  { value: "SWE I", label: "SWE I" },
  { value: "SWE II", label: "SWE II" },
  { value: "Senior", label: "Senior" },
  { value: "Other", label: "Other" }
];

// ============ Pure helpers ============

function classifyResumeLine(line: string, index: number): ResumeBlockKind {
  const trimmed = line.trim();
  if (index <= 1 && /@|linkedin|github|\b\d{3}[-.)\s]?\d{3}[-.\s]?\d{4}\b/i.test(trimmed)) return "contact";
  if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(trimmed)) return "bullet";
  if (trimmed.length <= 42 && /^[A-Z0-9/&,\- ]+$/.test(trimmed) && /[A-Z]/.test(trimmed)) return "section";
  return "text";
}

function buildResumeBlocks(text: string): ResumeBlock[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `${index}-${line.slice(0, 24).replace(/[^a-z0-9]+/gi, "-")}`,
      kind: classifyResumeLine(line, index),
      text: line
    }));
}

function blocksToText(blocks: ResumeBlock[]) {
  return blocks
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n");
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function inferApplicationTitle(url: string, jobDescription: string) {
  try {
    if (url) {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, "") + (u.pathname && u.pathname !== "/" ? u.pathname.slice(0, 30) : "");
    }
  } catch {
    // fall through
  }
  const firstLine = jobDescription
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 6);
  if (firstLine) return firstLine.slice(0, 80);
  return "Untitled role";
}

function inferCompanyFromUrl(url: string) {
  try {
    if (!url) return "";
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const cleaned = host
      .replace(/^(jobs|careers|apply|hire|boards|workday|smartrecruiters|lever|greenhouse)\./, "")
      .replace(/\.(com|io|co|net|ai|app|dev|org)$/, "");
    const first = cleaned.split(".")[0];
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
  } catch {
    return "";
  }
}

// ============ Types ============

type WorkspaceBaseResume = {
  exists: boolean;
  fileName?: string;
  kind?: string;
  text?: string;
  paragraphs?: number;
  docxBase64?: string;
};

type JobWorkspace = {
  path: string;
  baseResume: WorkspaceBaseResume;
  files: string[];
};

// ============ Hooks (local) ============

// Defers a fast-changing value so expensive derivations don't recompute on
// every keystroke. Used for the live pre-polish analysis only.
function useDebouncedValue<T>(value: T, delayMs = 280): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

// ============ App ============

function App() {
  // ----- State -----
  const [jobUrl, setJobUrl] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [resumeText, setResumeText] = useState(sampleResume);
  const [fileName, setFileName] = useState("");
  const [sourceDocx, setSourceDocx] = useState<SourceDocx | null>(null);
  const [resumeBlocks, setResumeBlocks] = useState<ResumeBlock[]>([]);
  const [result, setResult] = useState<PolishedResume | null>(null);
  const [copied, setCopied] = useState(false);
  const [coverCopied, setCoverCopied] = useState(false);
  const [fileError, setFileError] = useState("");
  const [fileStatus, setFileStatus] = useState("");
  const [linkStatus, setLinkStatus] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [polishStatus, setPolishStatus] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");
  const [texStatus, setTexStatus] = useState("");
  const [isDownloadingTex, setIsDownloadingTex] = useState(false);
  const [isRenderingLatexPdf, setIsRenderingLatexPdf] = useState(false);
  const [isOpeningOverleaf, setIsOpeningOverleaf] = useState(false);
  const [aiProvider, setAiProvider] = useState<AiProviderValue>("claude-cli");
  const [apiKey, setApiKey] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [selectedModel, setSelectedModel] = useState("opus");
  const [customModel, setCustomModel] = useState("");
  const [includeCoverLetter, setIncludeCoverLetter] = useState(false);
  const [strictReview, setStrictReview] = useState(true);
  const [lastImportedUrl, setLastImportedUrl] = useState("");
  const [roleAppliedAs, setRoleAppliedAs] = useState<string>("Early Career");
  const [honestContext, setHonestContext] = useState("");
  const [activeOutputTab, setActiveOutputTab] = useState<OutputTab>("resume");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [baseResumeName, setBaseResumeName] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [isSavingBaseResume, setIsSavingBaseResume] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pipelineFilter, setPipelineFilter] = useState<"all" | ApplicationStatus>("all");
  const [expandedApplicationId, setExpandedApplicationId] = useState<string | null>(null);

  // ----- Hooks -----
  const {
    templates,
    selectedTemplateId,
    setSelectedTemplateId,
    tectonic,
    templatesError,
    renderTex,
    renderPdf,
    importTex
  } = useTemplates();

  const {
    applications,
    upsert: upsertApplication,
    updateStatus: updateApplicationStatus,
    updateNotes: updateApplicationNotes,
    updateField: updateApplicationField,
    remove: removeApplication,
    storagePath: applicationsPath
  } = useApplications();

  // ----- Effects -----
  useEffect(() => {
    void loadWorkspace(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Derived (memos) -----
  const canPolish = useMemo(() => {
    return resumeText.trim().length > 80 && (jobDescription.trim().length > 40 || jobUrl.trim().length > 8);
  }, [jobDescription, jobUrl, resumeText]);

  const combinedJobText = useMemo(() => {
    return [jobDescription, jobUrl.replace(/[-_/?.=&]+/g, " ")].filter(Boolean).join("\n");
  }, [jobDescription, jobUrl]);

  // Debounce the live inputs so per-keystroke synchronous scoring doesn't jank
  // typing on large resumes. The polished `result` stays immediate.
  const debouncedResumeText = useDebouncedValue(resumeText);
  const debouncedCombinedJobText = useDebouncedValue(combinedJobText);

  const currentAnalysis = useMemo(() => {
    return debouncedResumeText.trim() && debouncedCombinedJobText.trim()
      ? analyzeResumeText(debouncedResumeText, debouncedCombinedJobText)
      : null;
  }, [debouncedCombinedJobText, debouncedResumeText]);

  const resumeBulletCount = useMemo(() => {
    return resumeText.split("\n").filter((line) => /^\s*[-*•]\s+/.test(line)).length;
  }, [resumeText]);

  const matchBreakdown = useMemo(() => {
    const sourceText = result?.polishedText ?? debouncedResumeText;
    const jobText = result ? combinedJobText : debouncedCombinedJobText;
    return jobText.trim() ? analyzeMatchBreakdown(sourceText, jobText) : [];
  }, [combinedJobText, debouncedCombinedJobText, debouncedResumeText, result]);

  const resumeDiff = useMemo(
    () => (result ? buildResumeDiff(resumeText, result.polishedText) : null),
    [result, resumeText]
  );

  const blockStats = useMemo(() => {
    return resumeBlocks.reduce(
      (stats, block) => {
        stats[block.kind] += 1;
        return stats;
      },
      { contact: 0, section: 0, bullet: 0, text: 0 } as Record<ResumeBlockKind, number>
    );
  }, [resumeBlocks]);

  // ----- Derived (non-memo) -----
  const scoreSource = result ?? currentAnalysis;
  const scoreContext = result
    ? "Polished resume score"
    : currentAnalysis
    ? "Live draft score"
    : "Awaiting resume and job target";
  const resultSourceLabel = result?.source === "local" ? "Local engine" : result?.source === "ai" ? "AI" : "";
  const selectedProviderOption = providerOptions.find((option) => option.value === aiProvider);
  const currentModelOptions = modelOptionsByProvider[aiProvider];
  const customModelPlaceholder = selectedProviderOption?.model || "model-id";
  const resumeReady = resumeText.trim().length > 80;
  const jobReady = jobDescription.trim().length > 40 || jobUrl.trim().length > 8;
  const outputReady = Boolean(result);
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;
  const outputTabs: OutputTabDescriptor[] = [
    { id: "resume", label: "Resume" },
    { id: "strict", label: "Strict review", badge: result?.strictReview?.verdict ? "•" : undefined },
    { id: "review", label: "Review", badge: scoreSource?.score.overall ?? undefined },
    { id: "cover", label: "Cover letter" },
    { id: "pipeline", label: "Pipeline", badge: applications.length || undefined }
  ];

  // ----- Handlers -----

  function applyWorkspaceBaseResume(baseResume: WorkspaceBaseResume, status: string) {
    if (!baseResume.exists || !baseResume.text) return;

    setResumeText(baseResume.text);
    setFileName(baseResume.fileName ?? "base-resume");
    setBaseResumeName(baseResume.fileName ?? "");
    setResult(null);
    setFileError("");
    setPolishStatus("");
    setDownloadStatus("");
    setTexStatus("");

    if (baseResume.kind === "docx" && baseResume.docxBase64) {
      setSourceDocx({
        name: baseResume.fileName ?? "base-resume.docx",
        base64: baseResume.docxBase64,
        paragraphs: Number(baseResume.paragraphs ?? 0)
      });
      setResumeBlocks(buildResumeBlocks(baseResume.text));
      setFileStatus(`${status} Format-preserving DOCX export is available.`);
    } else {
      setSourceDocx(null);
      setResumeBlocks([]);
      setFileStatus(`${status} Text export uses the clean ATS PDF template.`);
    }
  }

  function updateWorkspaceState(workspace: JobWorkspace) {
    setWorkspacePath(workspace.path);
    setWorkspaceFiles(workspace.files ?? []);
    setBaseResumeName(workspace.baseResume?.exists ? workspace.baseResume.fileName ?? "" : "");
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
      }
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Local workspace could not be checked.");
    }
  }

  async function saveBaseResume(payload: { fileName: string; fileBase64?: string; text?: string }) {
    setIsSavingBaseResume(true);
    setWorkspaceStatus("Saving base resume to the local workspace...");

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

  async function handleBaseResumeUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (/\.pdf$/i.test(file.name)) {
      setWorkspaceStatus("Save a DOCX, TXT, MD, CSV, or TEX as the base resume. PDF is text-only in this app.");
      return;
    }

    if (/\.docx$/i.test(file.name)) {
      await saveBaseResume({ fileName: file.name, fileBase64: arrayBufferToBase64(await file.arrayBuffer()) });
      return;
    }

    if (/\.tex$/i.test(file.name)) {
      try {
        const tex = await file.text();
        const text = await importTex(tex);
        await saveBaseResume({ fileName: file.name.replace(/\.tex$/i, ".txt"), text });
      } catch (error) {
        setWorkspaceStatus(error instanceof Error ? error.message : "TEX parse failed.");
      }
      return;
    }

    if (!/\.(txt|md|csv)$/i.test(file.name)) {
      setWorkspaceStatus("Save a DOCX, TXT, MD, CSV, or TEX resume as the base resume.");
      return;
    }

    await saveBaseResume({ fileName: file.name, text: await file.text() });
  }

  async function saveCurrentAsBaseResume() {
    if (sourceDocx) {
      try {
        setIsSavingBaseResume(true);
        setWorkspaceStatus("Preparing edited DOCX as the base resume...");
        const response = await fetch("/api/export-resume-docx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docxBase64: sourceDocx.base64, polishedText: resumeText })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "DOCX export failed.");
        await saveBaseResume({ fileName: sourceDocx.name, fileBase64: String(data.docxBase64 ?? "") });
      } catch (error) {
        setWorkspaceStatus(
          error instanceof Error ? error.message : "Edited DOCX could not be saved as base resume."
        );
      } finally {
        setIsSavingBaseResume(false);
      }
      return;
    }

    await saveBaseResume({ fileName: fileName || "base-resume.txt", text: resumeText });
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setFileError("");
    setFileStatus("");
    setSourceDocx(null);
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
        setSourceDocx({ name: file.name, base64, paragraphs: Number(data.paragraphs ?? 0) });
        setFileStatus(
          "DOCX loaded. Format-preserving DOCX export will reuse the original file structure; preview complex templates before sending."
        );
      } catch (error) {
        setFileError(
          error instanceof Error ? error.message : "DOCX import failed. Try saving the resume from Word as a fresh DOCX."
        );
      }
      return;
    }

    if (/\.tex$/i.test(file.name)) {
      try {
        const tex = await file.text();
        const text = await importTex(tex);
        setResumeText(text);
        setResumeBlocks([]);
        setFileStatus("LaTeX resume parsed. Polish, then re-render with any template via the Export bar.");
      } catch (error) {
        setFileError(error instanceof Error ? error.message : "LaTeX import failed. Paste the resume text instead.");
      }
      return;
    }

    if (!/\.(txt|md|csv)$/i.test(file.name)) {
      setFileError("Upload DOCX or TEX for format-preserving edits, or TXT, MD, or CSV for text-only polishing.");
      return;
    }

    try {
      setResumeText(await file.text());
      setResumeBlocks([]);
      setFileStatus("Text file loaded. Export uses the clean ATS PDF template or any LaTeX template.");
    } catch {
      setFileError("The file could not be read. Try pasting the resume text instead.");
    }
  }

  async function handlePolish() {
    const model = selectedModel === "custom" ? customModel.trim() : selectedModel;
    const fallbackBase = polishResume(resumeText, combinedJobText);
    const fallback = includeCoverLetter
      ? { ...fallbackBase, coverLetterText: draftCoverLetter(resumeText, combinedJobText, fallbackBase.polishedText) }
      : fallbackBase;

    setIsPolishing(true);
    setPolishStatus(includeCoverLetter ? "Polishing resume and drafting cover letter..." : "Polishing with AI...");
    setCopied(false);
    setCoverCopied(false);
    setDownloadStatus("");
    setTexStatus("");

    try {
      const response = await fetch("/api/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeText,
          jobText: jobDescription,
          jobUrl,
          provider: aiProvider,
          apiKey,
          apiBaseUrl,
          model,
          preserveFormat: Boolean(sourceDocx),
          includeCoverLetter,
          strictReview,
          roleAppliedAs,
          honestContext
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "AI polish failed.");
      if (!data.polishedText) throw new Error("AI response did not include polished resume text.");

      const polishedText = normalizePolishedResume(data.polishedText, resumeText);
      const analysis = analyzeResumeText(polishedText, combinedJobText);
      setResult({
        ...analysis,
        polishedText,
        source: "ai",
        coverLetterText: includeCoverLetter
          ? data.coverLetterText || draftCoverLetter(resumeText, combinedJobText, polishedText)
          : undefined,
        strengths: data.strengths?.length ? data.strengths : fallback.strengths,
        fixes: data.fixes?.length ? data.fixes : fallback.fixes,
        strictReview: data.strictReview ?? undefined
      });
      setActiveOutputTab(strictReview && data.strictReview ? "strict" : "resume");
      setPolishStatus(
        `${strictReview ? "Strict review" : "AI polish"} complete${data.model ? ` using ${data.model}` : ""}.`
      );
    } catch (error) {
      setResult(fallback);
      setActiveOutputTab("resume");
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      setPolishStatus(`AI unavailable: ${message}. Returned local engine draft instead.`);
    } finally {
      setIsPolishing(false);
    }
  }

  async function importJobLink() {
    if (!jobUrl.trim()) return;
    setIsImporting(true);
    setLinkStatus("Fetching job text...");
    try {
      const response = await fetch("/api/import-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: jobUrl })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Job import failed.");
      const text = String(data.text ?? "").trim();
      if (!text) {
        setLinkStatus("Found the page but could not extract job text. Paste it manually.");
        return;
      }
      setJobDescription(text);
      setLinkStatus("Imported readable job text. Review it before polishing.");
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "import failed";
      setLinkStatus(`Could not import: ${message}. Paste the description manually.`);
    } finally {
      setIsImporting(false);
    }
  }

  async function handleCopy() {
    if (!result?.polishedText) return;
    await navigator.clipboard.writeText(result.polishedText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function handleCopyCoverLetter() {
    if (!result?.coverLetterText) return;
    await navigator.clipboard.writeText(result.coverLetterText);
    setCoverCopied(true);
    window.setTimeout(() => setCoverCopied(false), 1800);
  }

  function handleDownloadPdf() {
    if (!result) return;
    const blob = createResumePdfBlob(result.polishedText, resumeText);
    downloadBlob(blob, "polished-sde-resume.pdf");
    setDownloadStatus("Downloaded polished-sde-resume.pdf with the SDE resume template.");
  }

  async function handleDownloadDocx() {
    if (!result || !sourceDocx) return;
    try {
      const response = await fetch("/api/export-resume-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docxBase64: sourceDocx.base64, polishedText: result.polishedText })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "DOCX export failed.");
      const byteCharacters = window.atob(String(data.docxBase64 ?? ""));
      const bytes = new Uint8Array(byteCharacters.length);
      for (let index = 0; index < byteCharacters.length; index += 1) {
        bytes[index] = byteCharacters.charCodeAt(index);
      }
      downloadBlob(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }),
        "polished-resume.docx"
      );
      const appended = Number(data.appendedParagraphs ?? 0);
      setDownloadStatus(
        appended
          ? `Downloaded polished-resume.docx. Added ${appended} extra paragraph${appended === 1 ? "" : "s"} because the polished text was longer than the source layout.`
          : "Downloaded polished-resume.docx using the uploaded DOCX structure."
      );
    } catch (error) {
      setDownloadStatus(
        error instanceof Error ? error.message : "DOCX export failed. Use the PDF export or copy the polished text."
      );
    }
  }

  async function handleDownloadTex() {
    if (!result) return;
    setIsDownloadingTex(true);
    setTexStatus("Rendering LaTeX source...");
    try {
      const tex = await renderTex(result.polishedText, selectedTemplateId);
      const templateLabel = selectedTemplate?.name ?? selectedTemplateId;
      const fileSafe = (selectedTemplate?.id ?? "resume").replace(/[^a-z0-9]+/gi, "-");
      downloadBlob(new Blob([tex], { type: "application/x-tex" }), `polished-resume-${fileSafe}.tex`);
      setTexStatus(
        `Downloaded polished-resume-${fileSafe}.tex using the ${templateLabel} template. Paste into Overleaf or your local LaTeX editor.`
      );
    } catch (error) {
      setTexStatus(error instanceof Error ? error.message : "TEX render failed.");
    } finally {
      setIsDownloadingTex(false);
    }
  }

  async function handleDownloadLatexPdf() {
    if (!result) return;
    if (!tectonic.available) {
      setTexStatus(
        "Tectonic is not installed. Install with `brew install tectonic` to enable in-app LaTeX PDF rendering."
      );
      return;
    }
    setIsRenderingLatexPdf(true);
    setTexStatus("Compiling LaTeX → PDF with Tectonic...");
    try {
      const outcome = await renderPdf(result.polishedText, selectedTemplateId);
      if ("error" in outcome) {
        setTexStatus(
          outcome.missingTectonic
            ? "Tectonic is not installed. Install with `brew install tectonic` to enable in-app LaTeX PDF rendering."
            : `LaTeX PDF compile failed: ${outcome.error}`
        );
        return;
      }
      const fileSafe = (selectedTemplate?.id ?? "resume").replace(/[^a-z0-9]+/gi, "-");
      downloadBlob(outcome.pdf, `polished-resume-${fileSafe}.pdf`);
      setTexStatus(
        `Downloaded polished-resume-${fileSafe}.pdf rendered via Tectonic + ${selectedTemplate?.name ?? selectedTemplateId}.`
      );
    } catch (error) {
      setTexStatus(error instanceof Error ? error.message : "LaTeX PDF render failed.");
    } finally {
      setIsRenderingLatexPdf(false);
    }
  }

  async function handleOpenInOverleaf() {
    if (!result) return;
    const overleafWindow = window.open("about:blank", "_blank");
    if (!overleafWindow) {
      setTexStatus("Popup blocked. Allow popups for localhost:5174 and try again.");
      return;
    }

    setIsOpeningOverleaf(true);
    setTexStatus("Preparing .tex for Overleaf...");
    try {
      const tex = await renderTex(result.polishedText, selectedTemplateId);
      const templateLabel = selectedTemplate?.name ?? "Resume";
      const snipName = `Polished resume — ${templateLabel}`;

      // Build the auto-submitting form via DOM APIs so correctness never depends
      // on a hand-rolled HTML escaper. Values are assigned, not interpolated.
      const doc = overleafWindow.document;
      doc.title = "Opening in Overleaf…";
      doc.body.style.cssText = "font-family:system-ui;color:#555;padding:24px";
      doc.body.textContent = "Sending polished resume to Overleaf…";

      const form = doc.createElement("form");
      form.action = "https://www.overleaf.com/docs";
      form.method = "POST";
      form.enctype = "application/x-www-form-urlencoded";

      const snip = doc.createElement("textarea");
      snip.name = "snip";
      snip.value = tex;

      const snipNameInput = doc.createElement("input");
      snipNameInput.type = "hidden";
      snipNameInput.name = "snip_name";
      snipNameInput.value = snipName;

      const engineInput = doc.createElement("input");
      engineInput.type = "hidden";
      engineInput.name = "engine";
      engineInput.value = "pdflatex";

      form.append(snip, snipNameInput, engineInput);
      doc.body.append(form);
      form.submit();

      setTexStatus(`Opened ${templateLabel} in Overleaf. Hit Compile in the new tab to generate the PDF.`);
    } catch (error) {
      overleafWindow.close();
      setTexStatus(error instanceof Error ? error.message : "Open in Overleaf failed.");
    } finally {
      setIsOpeningOverleaf(false);
    }
  }

  function updateResumeBlock(id: string, text: string) {
    const nextBlocks = resumeBlocks.map((block) => (block.id === id ? { ...block, text } : block));
    setResumeBlocks(nextBlocks);
    setResumeText(blocksToText(nextBlocks));
    setResult(null);
  }

  function syncBlocksFromText() {
    const nextBlocks = buildResumeBlocks(resumeText);
    setResumeBlocks(nextBlocks);
    setFileStatus(`${nextBlocks.length} resume blocks synced from the text draft.`);
  }

  async function loadResume() {
    if (baseResumeName) {
      await loadWorkspace(true);
      return;
    }
    setResumeText("");
    setFileName("");
    setSourceDocx(null);
    setResumeBlocks([]);
    setResult(null);
    setActiveOutputTab("resume");
    setFileError("");
    setFileStatus("No base resume is saved yet. Upload a resume or save one in the local workspace to make it the startup default.");
    setPolishStatus("");
    setDownloadStatus("");
    setTexStatus("");
  }

  function handleProviderChange(value: AiProviderValue) {
    const option = providerOptions.find((item) => item.value === value);
    setAiProvider(value);
    setApiBaseUrl(option?.baseUrl ?? "");
    setSelectedModel(option?.model ?? "");
    setCustomModel("");
  }

  function maybeAutoImportJobLink() {
    const trimmed = jobUrl.trim();
    if (!trimmed || trimmed.length < 12 || trimmed === lastImportedUrl || isImporting) return;
    try {
      const parsed = new URL(trimmed);
      if (!["http:", "https:"].includes(parsed.protocol)) return;
    } catch {
      return;
    }
    setLastImportedUrl(trimmed);
    void importJobLink();
  }

  function handleNextRole() {
    setJobUrl("");
    setJobDescription("");
    setResult(null);
    setLinkStatus("");
    setPolishStatus("");
    setDownloadStatus("");
    setTexStatus("");
    setHonestContext("");
    setLastImportedUrl("");
    setCopied(false);
    setCoverCopied(false);
    setActiveOutputTab("resume");
  }

  function handleTrackInPipeline() {
    if (!jobUrl.trim() && !jobDescription.trim()) return;
    const title = inferApplicationTitle(jobUrl, jobDescription);
    const company = inferCompanyFromUrl(jobUrl);
    const now = new Date().toISOString();
    const app: Application = {
      id: crypto.randomUUID(),
      title,
      company,
      role: "",
      source: "",
      jobUrl: jobUrl.trim(),
      jobDescription: jobDescription.trim(),
      status: "interested",
      createdAt: now,
      updatedAt: now,
      fitScore: result?.score.overall ?? null,
      templateId: selectedTemplateId,
      polishedText: result?.polishedText ?? "",
      coverLetterText: result?.coverLetterText ?? ""
    };
    upsertApplication(app);
    setTexStatus(`Tracked "${title}" in pipeline.`);
    setActiveOutputTab("pipeline");
    setExpandedApplicationId(app.id);
  }

  function handleLoadApplication(app: Application) {
    setJobUrl(app.jobUrl ?? "");
    setJobDescription(app.jobDescription ?? "");
    setLastImportedUrl(app.jobUrl ?? "");
    setLinkStatus(`Loaded "${app.title}" from pipeline.`);
    setPolishStatus("");
    setDownloadStatus("");
    setTexStatus("");
    setResult(null);
    setActiveOutputTab("resume");
  }

  function handleDeleteApplication(id: string, title: string) {
    if (!window.confirm(`Delete "${title}" from the pipeline?`)) return;
    removeApplication(id);
  }

  // ----- Render -----

  return (
    <div className="app-shell">
      <Masthead
        resumeReady={resumeReady}
        jobReady={jobReady}
        outputReady={outputReady}
        resumeBulletCount={resumeBulletCount}
        scoreSource={scoreSource}
        baseResumeName={baseResumeName}
        onLoadResume={loadResume}
        onNextRole={handleNextRole}
        nextRoleDisabled={!jobUrl && !jobDescription && !result && !linkStatus}
      />

      <div className="workspace-grid">
        <SourcesPane
          jobUrl={jobUrl}
          setJobUrl={setJobUrl}
          jobDescription={jobDescription}
          setJobDescription={setJobDescription}
          isImporting={isImporting}
          linkStatus={linkStatus}
          jobReady={jobReady}
          onMaybeAutoImport={maybeAutoImportJobLink}
          baseResumeName={baseResumeName}
          workspacePath={workspacePath}
          workspaceStatus={workspaceStatus}
          isSavingBaseResume={isSavingBaseResume}
          fileName={fileName}
          fileError={fileError}
          fileStatus={fileStatus}
          sourceDocx={sourceDocx}
          resumeBlocks={resumeBlocks}
          blockStats={blockStats}
          resumeText={resumeText}
          setResumeText={setResumeText}
          setResult={setResult}
          resumeReady={resumeReady}
          onBaseResumeUpload={handleBaseResumeUpload}
          onSaveCurrentAsBase={saveCurrentAsBaseResume}
          onLoadWorkspace={loadWorkspace}
          onFileUpload={handleFileUpload}
          onUpdateResumeBlock={updateResumeBlock}
          onSyncBlocksFromText={syncBlocksFromText}
          includeCoverLetter={includeCoverLetter}
          setIncludeCoverLetter={setIncludeCoverLetter}
          strictReview={strictReview}
          setStrictReview={setStrictReview}
          roleAppliedAs={roleAppliedAs}
          setRoleAppliedAs={setRoleAppliedAs}
          honestContext={honestContext}
          setHonestContext={setHonestContext}
          showAdvanced={showAdvanced}
          setShowAdvanced={setShowAdvanced}
          canPolish={canPolish}
          isPolishing={isPolishing}
          polishStatus={polishStatus}
          onPolish={handlePolish}
          roleAppliedOptions={roleAppliedOptions}
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
          providerOptions={providerOptions}
          currentModelOptions={currentModelOptions}
          selectedProviderOption={selectedProviderOption}
          customModelPlaceholder={customModelPlaceholder}
        />

        <StudioPane
          activeOutputTab={activeOutputTab}
          setActiveOutputTab={setActiveOutputTab}
          outputTabs={outputTabs}
          scoreSource={scoreSource}
          footer={
            <ExportRail
              templates={templates}
              templatesError={templatesError}
              selectedTemplateId={selectedTemplateId}
              setSelectedTemplateId={setSelectedTemplateId}
              selectedTemplate={selectedTemplate}
              tectonic={tectonic}
              result={result}
              jobUrl={jobUrl}
              jobDescription={jobDescription}
              hasSourceDocx={Boolean(sourceDocx)}
              copied={copied}
              isDownloadingTex={isDownloadingTex}
              isOpeningOverleaf={isOpeningOverleaf}
              isRenderingLatexPdf={isRenderingLatexPdf}
              texStatus={texStatus}
              downloadStatus={downloadStatus}
              onCopy={handleCopy}
              onDownloadTex={handleDownloadTex}
              onOpenInOverleaf={handleOpenInOverleaf}
              onDownloadLatexPdf={handleDownloadLatexPdf}
              onDownloadPdf={handleDownloadPdf}
              onDownloadDocx={handleDownloadDocx}
              onTrack={handleTrackInPipeline}
            />
          }
        >
          {activeOutputTab === "resume" ? (
            <ResumeTab result={result} resultSourceLabel={resultSourceLabel} scoreContext={scoreContext} />
          ) : null}

          {activeOutputTab === "review" ? (
            <ReviewTab
              scoreSource={scoreSource}
              scoreContext={scoreContext}
              resumeBulletCount={resumeBulletCount}
              matchBreakdown={matchBreakdown}
              resumeDiff={resumeDiff}
              result={result}
            />
          ) : null}

          {activeOutputTab === "strict" ? <StrictReviewTab result={result} /> : null}

          {activeOutputTab === "pipeline" ? (
            <PipelineTab
              applications={applications}
              applicationsPath={applicationsPath}
              pipelineFilter={pipelineFilter}
              setPipelineFilter={setPipelineFilter}
              expandedApplicationId={expandedApplicationId}
              setExpandedApplicationId={setExpandedApplicationId}
              onUpdateStatus={updateApplicationStatus}
              onUpdateField={updateApplicationField}
              onUpdateNotes={updateApplicationNotes}
              onLoad={handleLoadApplication}
              onDelete={handleDeleteApplication}
            />
          ) : null}

          {activeOutputTab === "cover" ? (
            <CoverLetterTab
              result={result}
              includeCoverLetter={includeCoverLetter}
              coverCopied={coverCopied}
              onCopy={handleCopyCoverLetter}
              onEnable={() => setIncludeCoverLetter(true)}
            />
          ) : null}
        </StudioPane>
      </div>
    </div>
  );
}

export default App;
