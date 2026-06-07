import { useEffect, useMemo, useState, type ChangeEvent } from "react";

import {
  analyzeResumeText,
  draftCoverLetter,
  normalizePolishedResume,
  type PolishedResume,
  polishResume
} from "./resumeEngine";

import { describeProviderModel, roleAppliedOptions } from "./config/aiOptions";
import { useTemplates } from "./hooks/useTemplates";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
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
import { useResumeExport } from "./hooks/useResumeExport";
import { arrayBufferToBase64 } from "./lib/downloads";
import { buildAiRequestFields, buildAuditRequestFields } from "./lib/aiRequest";
import { extractRelevantJobText } from "./lib/jobExtract";
import { blocksToText, buildResumeBlocks } from "./lib/resumeBlocks";
import { describeResumeFormat, looksLikeLatex } from "./lib/resumeFormat";

import { AiMenu } from "./sections/AiMenu";
import { ReviewerSettings } from "./sections/ReviewerSettings";
import { Masthead } from "./sections/Masthead";
import { PolishMenu } from "./sections/PolishMenu";
import { SourcesPane } from "./sections/SourcesPane";
import { StudioPane } from "./sections/StudioPane";
import { ExportRail } from "./sections/ExportRail";
import { ResumePrintLayer } from "./sections/ResumePrintLayer";
import { ResumeTab } from "./sections/tabs/ResumeTab";
import { ReviewTab } from "./sections/tabs/ReviewTab";
import { StrictReviewTab } from "./sections/tabs/StrictReviewTab";
import { CoverLetterTab } from "./sections/tabs/CoverLetterTab";
import { PipelineTab } from "./sections/tabs/PipelineTab";
import { ApplicationQuestionsTab } from "./sections/tabs/ApplicationQuestionsTab";
import type {
  OutputTab,
  OutputTabDescriptor,
  ResumeBlock,
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
  const [jobUrl, setJobUrl] = useState("");
  const [isExtractingLink, setIsExtractingLink] = useState(false);
  // Starts empty; the mount effect (loadWorkspace) auto-loads a workspace
  // base-resume when one exists, otherwise the editor stays blank.
  const [resumeText, setResumeText] = useState("");
  const [fileName, setFileName] = useState("");
  const [sourceDocx, setSourceDocx] = useState<SourceDocx | null>(null);
  const [resumeBlocks, setResumeBlocks] = useState<ResumeBlock[]>([]);
  const [result, setResult] = useState<PolishedResume | null>(null);
  const [fileError, setFileError] = useState("");
  const [fileStatus, setFileStatus] = useState("");
  const [linkStatus, setLinkStatus] = useState("");
  const [isPolishing, setIsPolishing] = useState(false);
  const [polishStatus, setPolishStatus] = useState("");
  // Resume export (copy/print/DOCX/LaTeX/Overleaf) state + handlers live in
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
    roleAppliedAs,
    setRoleAppliedAs,
    honestContext,
    setHonestContext,
    customInstructions,
    setCustomInstructions
  } = ai;
  const [includeCoverLetter, setIncludeCoverLetter] = useState(false);
  const [strictReview, setStrictReview] = useState(true);
  const [preserveFormat, setPreserveFormat] = useState(true);
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

  // ----- Derived (memos) -----
  // The job link has its own field now: the description textarea holds the text
  // we tailor against, while `jobUrl` is optional metadata saved with the
  // application for pipeline tracking only — it is never sent to the model.
  const canPolish = useMemo(() => {
    return resumeText.trim().length > 80 && jobDescription.trim().length > 40;
  }, [jobDescription, resumeText]);

  const combinedJobText = jobDescription;

  // Debounce the live inputs so per-keystroke synchronous scoring doesn't jank
  // typing on large resumes. The polished `result` stays immediate.
  const debouncedResumeText = useDebouncedValue(resumeText);
  const debouncedCombinedJobText = useDebouncedValue(combinedJobText);

  // Every score/diff/match derivation the UI shows is pure (read-only) and lives
  // in useResumeAnalysis, so it stays decoupled from App's setters.
  const {
    currentAnalysis,
    resumeBulletCount,
    matchBreakdown,
    resumeDiff,
    fitComparison,
    blockStats,
    scoreSource,
    headlineScore,
    scoreContext,
    resultSourceLabel
  } = useResumeAnalysis({
    resumeText,
    combinedJobText,
    debouncedResumeText,
    debouncedCombinedJobText,
    result,
    resumeBlocks
  });

  // ----- Derived (non-memo) -----
  const resumeReady = resumeText.trim().length > 80;
  const resumeSourceFormat = describeResumeFormat(fileName, Boolean(sourceDocx), resumeText);
  const jobReady = jobDescription.trim().length > 40;
  const outputReady = Boolean(result);
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;
  const outputTabs: OutputTabDescriptor[] = [
    { id: "resume", label: "Resume" },
    { id: "strict", label: "Strict review", badge: result?.strictReview?.verdict ? "•" : undefined },
    { id: "review", label: "Review", badge: headlineScore ?? undefined },
    { id: "cover", label: "Cover letter" },
    {
      id: "questions",
      label: "Questions",
      badge: answersResult
        ? (answersResult.answers.length + answersResult.roleDescriptions.length) || undefined
        : undefined
    },
    { id: "pipeline", label: "Pipeline", badge: applications.length || undefined }
  ];

  // ----- Resume export (copy / print / DOCX / LaTeX / Overleaf) -----
  const {
    copied,
    coverCopied,
    downloadStatus,
    isDownloadingTex,
    isRenderingLatexPdf,
    isOpeningOverleaf,
    resetStatuses: resetExportStatuses,
    handleCopy,
    handleCopyCoverLetter,
    handlePrintResume,
    handleDownloadDocx,
    handleDownloadTex,
    handleDownloadLatexPdf,
    handleOpenInOverleaf
  } = useResumeExport({
    result,
    sourceDocx,
    jobUrl,
    resumeText,
    resumeSourceFormat,
    selectedTemplateId,
    selectedTemplate,
    renderTex,
    renderPdf,
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
    const fallbackBase = polishResume(resumeText, combinedJobText);
    const fallback = includeCoverLetter
      ? { ...fallbackBase, coverLetterText: draftCoverLetter(resumeText, combinedJobText, fallbackBase.polishedText) }
      : fallbackBase;

    setIsPolishing(true);
    setPolishStatus(includeCoverLetter ? "Polishing resume and drafting cover letter..." : "Polishing with AI...");
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
          resumeText,
          jobText: jobDescription,
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
      // Reviewer attribution: only when a DIFFERENT provider/model ran the audit
      // (an override). The server echoes the audit identity when strict review ran.
      const reviewedBy =
        data.auditProvider && (data.auditProvider !== data.provider || (data.auditModel || "") !== (data.model || ""))
          ? describeProviderModel(data.auditProvider, data.auditModel)
          : "";
      setResult({
        ...analysis,
        polishedText,
        source: "ai",
        coverLetterText: includeCoverLetter
          ? data.coverLetterText || draftCoverLetter(resumeText, combinedJobText, polishedText)
          : undefined,
        strengths: data.strengths?.length ? data.strengths : fallback.strengths,
        fixes: data.fixes?.length ? data.fixes : fallback.fixes,
        missingRequiredSkills: data.missingRequiredSkills?.length ? data.missingRequiredSkills : undefined,
        aiScore: data.aiScore ?? undefined,
        strictReview: data.strictReview ?? undefined,
        reviewedBy: reviewedBy || undefined
      });
      setActiveOutputTab(strictReview && data.strictReview ? "strict" : "resume");
      setPolishStatus(
        reviewedBy
          ? `Strict review complete — polished with ${describeProviderModel(data.provider, data.model)}, reviewed by ${reviewedBy}.`
          : `${strictReview ? "Strict review" : "AI polish"} complete${data.model ? ` using ${data.model}` : ""}.`
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
    resetExportStatuses();
    setTexStatus("");
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
      // Local distiller trims the scraped page to the parts worth polishing against.
      const relevant = extractRelevantJobText(String(data.text ?? ""));
      if (relevant.trim().length < 40) {
        setLinkStatus("Fetched the page, but found too little job text. Paste the description instead.");
        return;
      }
      setJobDescription(relevant);
      setResult(null);
      setLinkStatus(
        `Extracted ${relevant.length.toLocaleString()} characters into the job description below — review before polishing.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      setLinkStatus(`Couldn't extract from the link: ${message}. Paste the description instead.`);
    } finally {
      setIsExtractingLink(false);
    }
  }

  function handleNextRole() {
    setJobDescription("");
    setJobUrl("");
    setResult(null);
    setLinkStatus("");
    setPolishStatus("");
    // Honest context + custom instructions are remembered prefs, not per-role; keep them.
    resetExportStatuses();
    setTexStatus("");
    setActiveOutputTab("resume");
  }

  function handleTrackInPipeline(resumeUsed: "tailored" | "base" = "tailored") {
    if (!jobUrl.trim() && !jobDescription.trim()) return;
    const sr = result?.strictReview;
    // Record the resume that actually went out: the tailored draft, or the
    // original/base resume the user submitted instead.
    const usedBase = resumeUsed === "base" || !result?.polishedText;
    const sentResume = usedBase ? resumeText : result?.polishedText ?? "";
    const existing = findForTarget(jobUrl, jobDescription);
    const draft = makeApplicationDraft(jobUrl, jobDescription);
    const app: Application = {
      ...draft,
      id: existing?.id ?? draft.id,
      fitScore: headlineScore ?? result?.score.overall ?? null,
      baseFitScore: fitComparison?.base ?? null,
      tailoredFitScore: fitComparison?.tailored ?? null,
      fitScoreSource: fitComparison?.source ?? null,
      templateId: selectedTemplateId,
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
    setTexStatus(`Tracked "${existing?.title || app.title}" in the pipeline (${usedBase ? "original" : "tailored"} resume).`);
    setActiveOutputTab("pipeline");
    setExpandedApplicationId(existing?.id ?? app.id);
  }

  function handleLoadApplication(app: Application) {
    // Description and link are separate fields: restore each from its own slot.
    setJobDescription(app.jobDescription || "");
    setJobUrl(app.jobUrl || "");
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
      setLinkStatus(`Loaded "${app.title}" and its saved resume snapshot from pipeline.`);
    } else {
      setLinkStatus(`Loaded "${app.title}" job target from pipeline.`);
      setResult(null);
    }
    setPolishStatus("");
    resetExportStatuses();
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
        headlineScore={headlineScore}
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
          jobUrl={jobUrl}
          setJobUrl={setJobUrl}
          onExtractFromLink={handleExtractFromLink}
          isExtractingLink={isExtractingLink}
          linkStatus={linkStatus}
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
          headlineScore={headlineScore}
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
              onPrintResume={handlePrintResume}
              onDownloadDocx={handleDownloadDocx}
              onTrack={handleTrackInPipeline}
            />
          }
        >
          {activeOutputTab === "resume" ? (
            <ResumeTab
              result={result}
              resultSourceLabel={resultSourceLabel}
              scoreContext={scoreContext}
              sourceText={resumeText}
            />
          ) : null}

          {activeOutputTab === "review" ? (
            <ReviewTab
              scoreSource={scoreSource}
              scoreContext={scoreContext}
              headlineScore={headlineScore}
              fitComparison={fitComparison}
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

          {activeOutputTab === "questions" ? (
            <ApplicationQuestionsTab
              result={answersResult}
              status={answersStatus}
              isGenerating={isGeneratingAnswers}
              canGenerate={resumeText.trim().length >= 80 && jobDescription.trim().length >= 40}
              canSave={Boolean(jobUrl.trim() || jobDescription.trim())}
              onGenerate={handleGenerateAnswers}
              onSaveAnswers={handleSaveAnswers}
            />
          ) : null}
        </StudioPane>
      </div>

      {result?.polishedText ? (
        <ResumePrintLayer polishedText={result.polishedText} sourceText={resumeText} />
      ) : null}
    </div>
  );
}

export default App;
