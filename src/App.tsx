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
import { loadSettings, saveSettings } from "./lib/settings";

import {
  providerOptions,
  roleAppliedOptions
} from "./config/aiOptions";
import { useTemplates } from "./hooks/useTemplates";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useApplications, type Application, type ApplicationStatus } from "./hooks/useApplications";
import { arrayBufferToBase64, buildResumeFileName, downloadBlob, extractApplicantName } from "./lib/downloads";
import { inferApplicationTitle, inferCompanyFromUrl, isLikelyJobUrl } from "./lib/jobTarget";
import { blocksToText, buildResumeBlocks } from "./lib/resumeBlocks";
import { describeResumeFormat, looksLikeLatex } from "./lib/resumeFormat";

import { AiMenu } from "./sections/AiMenu";
import { Masthead } from "./sections/Masthead";
import { PolishMenu } from "./sections/PolishMenu";
import { SourcesPane, type AiProviderValue } from "./sections/SourcesPane";
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

// ============ App ============

function App() {
  // ----- State -----
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
  const [isPolishing, setIsPolishing] = useState(false);
  const [polishStatus, setPolishStatus] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");
  const [texStatus, setTexStatus] = useState("");
  const [isDownloadingTex, setIsDownloadingTex] = useState(false);
  const [isRenderingLatexPdf, setIsRenderingLatexPdf] = useState(false);
  const [isOpeningOverleaf, setIsOpeningOverleaf] = useState(false);
  // Restore auto-saved preferences once on mount (API key is never persisted).
  const saved = useMemo(() => loadSettings(), []);
  const [aiProvider, setAiProvider] = useState<AiProviderValue>(saved.aiProvider ?? "claude-cli");
  const [apiKey, setApiKey] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState(saved.apiBaseUrl ?? "");
  const [selectedModel, setSelectedModel] = useState(saved.selectedModel ?? "opus");
  const [cliReasoningEffort, setCliReasoningEffort] = useState(saved.cliReasoningEffort ?? "");
  const [customModel, setCustomModel] = useState(saved.customModel ?? "");
  const [includeCoverLetter, setIncludeCoverLetter] = useState(false);
  const [strictReview, setStrictReview] = useState(true);
  const [preserveFormat, setPreserveFormat] = useState(true);
  const [roleAppliedAs, setRoleAppliedAs] = useState<string>(saved.roleAppliedAs ?? "Early Career");
  const [honestContext, setHonestContext] = useState(saved.honestContext ?? "");
  const [customInstructions, setCustomInstructions] = useState(saved.customInstructions ?? "");
  const [activeOutputTab, setActiveOutputTab] = useState<OutputTab>("resume");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [baseResumeName, setBaseResumeName] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [isSavingBaseResume, setIsSavingBaseResume] = useState(false);
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
    renderPdf
  } = useTemplates();

  const {
    applications,
    isLoading: isApplicationsLoading,
    error: applicationsError,
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

  // Auto-save preferences (AI selection + polish inputs) so they survive reloads.
  // Debounced so the free-text fields (honest context, custom instructions)
  // don't serialize + write localStorage on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      saveSettings({
        aiProvider,
        selectedModel,
        customModel,
        cliReasoningEffort,
        apiBaseUrl,
        roleAppliedAs,
        honestContext,
        customInstructions
      });
    }, 400);
    return () => clearTimeout(id);
  }, [
    aiProvider,
    selectedModel,
    customModel,
    cliReasoningEffort,
    apiBaseUrl,
    roleAppliedAs,
    honestContext,
    customInstructions
  ]);

  // ----- Derived (memos) -----
  // The job field is one box: a pasted link OR a description. When it holds a
  // bare URL we surface it as the job URL (for the prompt hint, company
  // inference, and pipeline tracking); otherwise it's treated as job text.
  const jobUrl = useMemo(() => {
    const trimmed = jobDescription.trim();
    return isLikelyJobUrl(trimmed) ? trimmed : "";
  }, [jobDescription]);

  const jobTextForPolish = useMemo(() => (jobUrl ? "" : jobDescription), [jobDescription, jobUrl]);
  const jobUrlOnlyStatus = jobUrl
    ? "Paste the full job description before polishing. A bare link can be tracked, but it is not enough for tailoring."
    : "";

  const canPolish = useMemo(() => {
    return resumeText.trim().length > 80 && jobTextForPolish.trim().length > 40;
  }, [jobTextForPolish, resumeText]);

  const combinedJobText = useMemo(() => {
    return jobTextForPolish;
  }, [jobTextForPolish]);

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
  const resumeReady = resumeText.trim().length > 80;
  const resumeSourceFormat = describeResumeFormat(fileName, Boolean(sourceDocx), resumeText);
  const jobReady = jobTextForPolish.trim().length > 40;
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
    setWorkspaceStatus("Removing the base resume from the local workspace...");
    try {
      const response = await fetch("/api/workspace/base-resume", { method: "DELETE" });
      const workspace = (await response.json()) as Partial<JobWorkspace> & { error?: string };
      if (!response.ok) throw new Error(workspace.error ?? "Base resume removal failed.");
      updateWorkspaceState({
        path: workspace.path ?? workspacePath,
        baseResume: workspace.baseResume ?? { exists: false },
        files: workspace.files ?? workspaceFiles
      });
      // Detach the file from the editor so the resume text is editable again,
      // but keep the current text so the user doesn't lose their draft.
      setFileName("");
      setSourceDocx(null);
      setResumeBlocks([]);
      setFileStatus("");
      setWorkspaceStatus("Removed the base resume (backup saved in .trash). Save again to set a new one.");
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Base resume removal failed.");
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

    // Keep .tex as raw LaTeX so the source format stays "LaTeX" and Preserve
    // format can rewrite it in place. Flattening to plain text (and renaming to
    // .txt) here is what previously destroyed the formatting.
    if (!/\.(txt|md|csv|tex)$/i.test(file.name)) {
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
      // Keep the raw LaTeX as the working text so Preserve format rewrites it in
      // place as .tex. The editor shows LaTeX markup; export stays .tex/Overleaf.
      setResumeText(await file.text());
      setResumeBlocks([]);
      setFileStatus("LaTeX source loaded. Keep “Preserve format” on to rewrite in place; export as .tex or via Overleaf.");
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
    if (jobUrl && !jobTextForPolish.trim()) {
      setPolishStatus("Paste the full job description before polishing. A link alone is only useful for tracking.");
      return;
    }

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
          // A bare link is kept only as tracking/prompt metadata. Polishing
          // requires pasted job text so the AI is not tailoring from a URL slug.
          jobText: jobTextForPolish,
          jobUrl,
          provider: aiProvider,
          apiKey,
          apiBaseUrl,
          model,
          reasoningEffort: cliReasoningEffort,
          preserveFormat,
          sourceFormat: resumeSourceFormat,
          includeCoverLetter,
          strictReview,
          roleAppliedAs,
          honestContext,
          customInstructions
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "AI polish failed.");
      if (!data.polishedText) throw new Error("AI response did not include polished resume text.");

      // For a preserved LaTeX source the model returns the full edited .tex —
      // keep it verbatim. normalizePolishedResume reflows section text and would
      // shred the LaTeX commands.
      const latexInPlace = resumeSourceFormat === "LaTeX" && preserveFormat && looksLikeLatex(String(data.polishedText));
      const polishedText = latexInPlace
        ? String(data.polishedText).trim()
        : normalizePolishedResume(data.polishedText, resumeText);
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

  // Name downloads after the applicant (+ company when a job link gives one):
  // Xinyi_Lin_Stripe_Resume.pdf → Xinyi_Lin_Resume.pdf → Resume.pdf.
  function resumeDownloadName(ext: string): string {
    return buildResumeFileName(
      extractApplicantName(result?.polishedText || resumeText),
      inferCompanyFromUrl(jobUrl),
      ext
    );
  }

  function handleDownloadPdf() {
    if (!result) return;
    const blob = createResumePdfBlob(result.polishedText, resumeText);
    const fileName = resumeDownloadName("pdf");
    downloadBlob(blob, fileName);
    setDownloadStatus(`Downloaded ${fileName} using the clean ATS template.`);
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
      const fileName = resumeDownloadName("docx");
      downloadBlob(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }),
        fileName
      );
      const appended = Number(data.appendedParagraphs ?? 0);
      setDownloadStatus(
        appended
          ? `Downloaded ${fileName}. Added ${appended} extra paragraph${appended === 1 ? "" : "s"} because the polished text was longer than the source layout.`
          : `Downloaded ${fileName} using the uploaded DOCX structure.`
      );
    } catch (error) {
      setDownloadStatus(
        error instanceof Error ? error.message : "DOCX export failed. Use the PDF export or copy the polished text."
      );
    }
  }

  async function handleDownloadTex() {
    if (!result) return;
    // In-place: the polished text already is the user's edited .tex — download it
    // directly so the original LaTeX layout is kept (no template re-render).
    if (resumeSourceFormat === "LaTeX" && looksLikeLatex(result.polishedText)) {
      const fileName = resumeDownloadName("tex");
      downloadBlob(new Blob([result.polishedText], { type: "application/x-tex" }), fileName);
      setTexStatus(`Downloaded ${fileName} — your original LaTeX, edited in place. Paste into Overleaf or your LaTeX editor.`);
      return;
    }
    setIsDownloadingTex(true);
    setTexStatus("Rendering LaTeX source...");
    try {
      const tex = await renderTex(result.polishedText, selectedTemplateId);
      const templateLabel = selectedTemplate?.name ?? selectedTemplateId;
      const fileName = resumeDownloadName("tex");
      downloadBlob(new Blob([tex], { type: "application/x-tex" }), fileName);
      setTexStatus(
        `Downloaded ${fileName} using the ${templateLabel} template. Paste into Overleaf or your local LaTeX editor.`
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
    const latexInPlace = resumeSourceFormat === "LaTeX" && looksLikeLatex(result.polishedText);
    setIsRenderingLatexPdf(true);
    setTexStatus(
      latexInPlace ? "Compiling your edited LaTeX → PDF with Tectonic..." : "Compiling LaTeX → PDF with Tectonic..."
    );
    try {
      const outcome = latexInPlace
        ? await renderPdf(result.polishedText, undefined, { rawTex: true })
        : await renderPdf(result.polishedText, selectedTemplateId);
      if ("error" in outcome) {
        setTexStatus(
          outcome.missingTectonic
            ? "Tectonic is not installed. Install with `brew install tectonic` to enable in-app LaTeX PDF rendering."
            : `LaTeX PDF compile failed: ${outcome.error}`
        );
        return;
      }
      const fileName = resumeDownloadName("pdf");
      downloadBlob(outcome.pdf, fileName);
      setTexStatus(
        latexInPlace
          ? `Downloaded ${fileName} compiled from your edited LaTeX via Tectonic (in place, no template).`
          : `Downloaded ${fileName} rendered via Tectonic + ${selectedTemplate?.name ?? selectedTemplateId}.`
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
      setTexStatus("Popup blocked. Allow popups for localhost:5181 and try again.");
      return;
    }

    const latexInPlace = resumeSourceFormat === "LaTeX" && looksLikeLatex(result.polishedText);
    setIsOpeningOverleaf(true);
    setTexStatus("Preparing .tex for Overleaf...");
    try {
      const tex = latexInPlace ? result.polishedText : await renderTex(result.polishedText, selectedTemplateId);
      const templateLabel = latexInPlace ? "Original LaTeX" : selectedTemplate?.name ?? "Resume";
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
    setCliReasoningEffort("");
    setCustomModel("");
  }

  function handleNextRole() {
    setJobDescription("");
    setResult(null);
    setLinkStatus("");
    setPolishStatus("");
    setDownloadStatus("");
    setTexStatus("");
    // Honest context + custom instructions are remembered prefs, not per-role; keep them.
    setCopied(false);
    setCoverCopied(false);
    setActiveOutputTab("resume");
  }

  function handleTrackInPipeline(resumeUsed: "tailored" | "base" = "tailored") {
    if (!jobUrl.trim() && !jobDescription.trim()) return;
    const title = inferApplicationTitle(jobUrl, jobDescription);
    const company = inferCompanyFromUrl(jobUrl);
    const now = new Date().toISOString();
    const sr = result?.strictReview;
    // Record the resume that actually went out: the tailored draft, or the
    // original/base resume the user submitted instead.
    const usedBase = resumeUsed === "base" || !result?.polishedText;
    const sentResume = usedBase ? resumeText : result?.polishedText ?? "";
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
      polishedText: sentResume,
      resumeUsed: usedBase ? "base" : "tailored",
      coverLetterText: result?.coverLetterText ?? "",
      // Snapshot the recruiter review so the pipeline keeps the verdict,
      // interview risks, and gaps for this application.
      review: sr
        ? {
            verdict: sr.verdict,
            verdictReason: sr.verdictReason,
            riskFlags: sr.riskFlags.map((r) => ({ risk: r.risk, suggestion: r.suggestion })),
            gaps: sr.gaps.map((g) => ({ gap: g.gap, severity: g.severity })),
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
    setTexStatus(`Tracked "${title}" in the pipeline (${usedBase ? "original" : "tailored"} resume).`);
    setActiveOutputTab("pipeline");
    setExpandedApplicationId(app.id);
  }

  function handleLoadApplication(app: Application) {
    // One field now: prefer the saved description, fall back to the saved link.
    setJobDescription(app.jobDescription || app.jobUrl || "");
    if (app.polishedText) {
      const restoredResume = app.polishedText;
      const restoredAnalysis = analyzeResumeText(restoredResume, app.jobDescription || "");
      setResumeText(restoredResume);
      setFileName("");
      setSourceDocx(null);
      setResumeBlocks([]);
      setFileStatus("Loaded the tracked resume snapshot into the editor. Save it as base if you want it at startup.");
      setResult({
        ...restoredAnalysis,
        polishedText: restoredResume,
        coverLetterText: app.coverLetterText || undefined,
        strengths: app.review?.verdictReason ? [app.review.verdictReason] : ["Loaded from pipeline snapshot."],
        fixes: app.review?.recommendation?.topEdits?.length
          ? app.review.recommendation.topEdits
          : ["Review against the current job text before sending again."]
      });
      setLinkStatus(`Loaded "${app.title}" and its saved resume snapshot from pipeline.`);
    } else {
      setLinkStatus(`Loaded "${app.title}" job target from pipeline.`);
      setResult(null);
    }
    setPolishStatus("");
    setDownloadStatus("");
    setTexStatus("");
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
          />
        }
        polishControl={
          <PolishMenu
            roleAppliedAs={roleAppliedAs}
            setRoleAppliedAs={setRoleAppliedAs}
            roleAppliedOptions={roleAppliedOptions}
            honestContext={honestContext}
            setHonestContext={setHonestContext}
            customInstructions={customInstructions}
            setCustomInstructions={setCustomInstructions}
          />
        }
      />

      <div className="workspace-grid">
        <SourcesPane
          jobDescription={jobDescription}
          setJobDescription={setJobDescription}
          linkStatus={jobUrlOnlyStatus || linkStatus}
          jobReady={jobReady}
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
          onRemoveBaseResume={removeBaseResume}
          onLoadWorkspace={loadWorkspace}
          onFileUpload={handleFileUpload}
          onUpdateResumeBlock={updateResumeBlock}
          onSyncBlocksFromText={syncBlocksFromText}
          includeCoverLetter={includeCoverLetter}
          setIncludeCoverLetter={setIncludeCoverLetter}
          strictReview={strictReview}
          setStrictReview={setStrictReview}
          preserveFormat={preserveFormat}
          setPreserveFormat={setPreserveFormat}
          resumeSourceFormat={resumeSourceFormat}
          canPolish={canPolish}
          isPolishing={isPolishing}
          polishStatus={polishStatus}
          onPolish={handlePolish}
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
              applicationsError={applicationsError}
              isApplicationsLoading={isApplicationsLoading}
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
