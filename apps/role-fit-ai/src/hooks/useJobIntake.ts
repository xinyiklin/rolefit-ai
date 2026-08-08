/**
 * useJobIntake — the job-analysis/import flows, extracted from App.tsx:
 * It owns link analysis, pasted-posting analysis, the browser-extension inbox
 * import, each entry point's Retry, and the manual-edit handler. Every Job
 * analysis provenance write (`pipelineAiUsage["job-analysis"]` and jobRawText)
 * lives in this one module.
 *
 * State ownership: jobAnalysisProgress/jobAnalysisProgressVisible/jobAnalysisRetrySource/
 * isExtractingLink are OWNED here (not passed in) because every mutator of
 * them is one of these handlers — App only READS them for render (the
 * shared AI workflow, Prepare's source controls, the progress-dock visibility
 * check, and the _myPhase presence memo), so returning them keeps the
 * interface small without leaking control back to App.
 *
 * jobUrl/jobDescription/importedJob/result/pipelineAiUsage/jobRawText/
 * polishStatus stay in App (it seeds/derives from them well
 * beyond this flow — jobTracking, autosave, presence, canPolish, etc.), so
 * their setters arrive via the args object.
 */
import { useEffect, useRef, useState } from "react";
import type { ExtractedJobTracking } from "../lib/jobExtract";
import { extractJobPosting } from "../lib/jobExtract";
import {
  analyzeJobPosting,
  type JobAnalysisResult
} from "../lib/aiJobAnalysis";
import { classifyFailure } from "../lib/failures";
import { useExtensionInbox, type ExtensionImport } from "./useExtensionInbox";
import {
  workflowInputFingerprint,
  workflowRequestIsCurrent,
  type AiStageState as StageState
} from "../lib/aiWorkflow";
import type { StageAiUsage } from "../lib/aiUsage";
import type { PolishedResume } from "../resumeEngine";
import type { ProviderReadiness } from "./useAvailableProviders";
import {
  buildPreparedJobBrief,
  reconcilePreparedJobManualReviewFields,
  type PreparedJobBrief
} from "../lib/preparedJobBrief";

export type ImportedJobSnapshot = {
  url: string;
  // Immutable source identity for this prepared snapshot. It lets App
  // distinguish "Prepare again" from unrelated fresh intake without comparing
  // the analyzed projection.
  sourceText: string;
  tailoringText: string;
  tracking: ExtractedJobTracking;
  brief: PreparedJobBrief;
  manualReviewFields: string[];
};

function importedJobSnapshot(
  url: string,
  tailoringText: string,
  extracted: ReturnType<typeof extractJobPosting>,
  sourceText: string
): ImportedJobSnapshot {
  const brief = buildPreparedJobBrief(extracted.tailoringText, sourceText);
  return {
    url,
    sourceText: sourceText.trim(),
    tailoringText: tailoringText.trim(),
    tracking: extracted.tracking,
    brief,
    manualReviewFields: reconcilePreparedJobManualReviewFields(
      extracted.tracking,
      brief,
      extracted.manualReviewFields
    )
  };
}

function presentTrackingFields(tracking: ExtractedJobTracking) {
  const fields = [
    tracking.role || tracking.title ? "role" : "",
    tracking.company ? "company" : "",
    tracking.location ? "location" : "",
    tracking.jobType ? "job type" : "",
    tracking.salaryMin != null || tracking.salaryMax != null ? "compensation" : "",
    tracking.roleDescription ? "role context" : ""
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

type UseJobIntakeArgs = {
  jobUrl: string;
  setJobUrl: (value: string) => void;
  jobDescription: string;
  setJobDescription: (value: string) => void;
  setImportedJob: (value: ImportedJobSnapshot | null) => void;
  setResult: (value: PolishedResume | null) => void;
  resetCoverWorkflow: () => void;
  setPipelineAiUsage: (updater: (prev: Record<string, StageAiUsage>) => Record<string, StageAiUsage>) => void;
  setJobRawText: (value: string) => void;
  setPolishStatus: (value: string) => void;
  setLinkStatus: (value: string) => void;
  confirmDuplicateBeforeJobAnalysis: (
    url: string,
    text: string,
    facts: ExtractedJobTracking
  ) => Promise<{ proceed: boolean; note: string | null }>;
  confirmDuplicateAfterJobAnalysis: (
    url: string,
    text: string,
    facts: ExtractedJobTracking
  ) => Promise<{ proceed: boolean; note: string | null }>;
  jobAnalysisRequestFields: () => Record<string, unknown>;
  ensureProviderReady: () => Promise<ProviderReadiness>;
  extensionImportsReady: boolean;
  onExtensionPrepareStarted: () => void;
  onExtensionJobReceived: () => void;
};

export function useJobIntake({
  jobUrl,
  setJobUrl,
  jobDescription,
  setJobDescription,
  setImportedJob,
  setResult,
  resetCoverWorkflow,
  setPipelineAiUsage,
  setJobRawText,
  setPolishStatus,
  setLinkStatus,
  confirmDuplicateBeforeJobAnalysis,
  confirmDuplicateAfterJobAnalysis,
  jobAnalysisRequestFields,
  ensureProviderReady,
  extensionImportsReady,
  onExtensionPrepareStarted,
  onExtensionJobReceived
}: UseJobIntakeArgs) {
  const [isExtractingLink, setIsExtractingLink] = useState(false);
  const [extensionImportPhase, setExtensionImportPhase] = useState<"receiving" | "preparing" | null>(null);
  // Job analysis progress row in the shared AI workflow. Driven by both
  // job-analysis entry points (link and pasted posting); the DONE card
  // reports whether the brief came from the AI or the local fallback.
  const [jobAnalysisProgress, setJobAnalysisProgress] = useState<StageState>({ status: "idle" });
  const [jobAnalysisProgressVisible, setJobAnalysisProgressVisible] = useState(false);
  // Which job analysis action the card's Retry should re-run (link, paste, or a
  // reanalyze of an extension import). Stored as a tag, not a captured closure,
  // so Retry dispatches to the LIVE handler and picks up the current URL / paste
  // — a stored closure would re-run stale input the user has since edited. Null
  // only before any job analysis has run, so that card shows no Retry button.
  const [jobAnalysisRetrySource, setJobAnalysisRetrySource] = useState<"link" | "paste" | "import" | null>(null);
  // Raw source text + url of the last extension import, so its card's Retry can
  // reanalyze it through the CLIENT /api/job-analysis path — the extension import is
  // event-driven with no action to re-run otherwise.
  const jobAnalysisImportRef = useRef<{
    text: string;
    url: string;
  } | null>(null);
  // A once-only extension delivery cannot be put back into the server inbox,
  // so serialize every job analysis in memory. User actions reject while busy;
  // extension deliveries wait for the active run, retaining their captured
  // payload until they own the lock.
  const jobAnalysisBusyRef = useRef(false);
  const jobAnalysisSettledRef = useRef<Promise<void>>(Promise.resolve());
  const jobAnalysisGenerationRef = useRef(0);
  const jobAnalysisAbortRef = useRef<AbortController | null>(null);
  // Job analysis consumes only the job source and its stage-local AI settings.
  // Resume/workspace bootstrap and Tailor-mode reconciliation may finish after
  // a fresh extension tab claims its import; neither changes the in-flight
  // Job analysis request, so neither belongs in its stale-input guard.
  const jobAnalysisInputFingerprint = workflowInputFingerprint({
    jobUrl,
    jobDescription,
    aiRequest: jobAnalysisRequestFields()
  });
  const jobAnalysisInputFingerprintRef = useRef(jobAnalysisInputFingerprint);
  jobAnalysisInputFingerprintRef.current = jobAnalysisInputFingerprint;

  function startJobAnalysisRequest() {
    jobAnalysisGenerationRef.current += 1;
    jobAnalysisAbortRef.current?.abort();
    const controller = new AbortController();
    jobAnalysisAbortRef.current = controller;
    const generation = jobAnalysisGenerationRef.current;
    const fingerprint = jobAnalysisInputFingerprintRef.current;
    return {
      controller,
      signal: controller.signal,
      isCurrent: () => workflowRequestIsCurrent(
        generation,
        jobAnalysisGenerationRef.current,
        fingerprint,
        jobAnalysisInputFingerprintRef.current,
        controller.signal
      )
    };
  }

  function finishJobAnalysisRequest(controller: AbortController) {
    if (jobAnalysisAbortRef.current === controller) jobAnalysisAbortRef.current = null;
  }

  useEffect(() => {
    if (!jobAnalysisAbortRef.current) return;
    jobAnalysisGenerationRef.current += 1;
    jobAnalysisAbortRef.current.abort();
    jobAnalysisAbortRef.current = null;
    setJobAnalysisProgress({
      status: "stopped",
      errorHeadline: "Inputs changed",
      error: "The active Job analysis was cancelled before it could replace the current job target."
    });
    setJobAnalysisProgressVisible(true);
    setLinkStatus("Job inputs changed. Prepare the current posting again.");
  }, [jobAnalysisInputFingerprint, setLinkStatus]);

  useEffect(() => () => {
    jobAnalysisGenerationRef.current += 1;
    jobAnalysisAbortRef.current?.abort();
    jobAnalysisAbortRef.current = null;
  }, []);

  function claimJobAnalysisRun(): () => void {
    jobAnalysisBusyRef.current = true;
    let resolve!: () => void;
    jobAnalysisSettledRef.current = new Promise<void>((done) => {
      resolve = done;
    });
    return () => {
      jobAnalysisBusyRef.current = false;
      resolve();
    };
  }

  function tryClaimJobAnalysisRun(): (() => void) | null {
    return jobAnalysisBusyRef.current ? null : claimJobAnalysisRun();
  }

  async function waitAndClaimJobAnalysisRun(): Promise<() => void> {
    while (jobAnalysisBusyRef.current) await jobAnalysisSettledRef.current;
    return claimJobAnalysisRun();
  }

  function jobAnalysisTerminalState(result: JobAnalysisResult, duplicateNote?: string | null): StageState {
    if (result.failure) {
      return {
        status: "failed",
        errorHeadline: result.failure.headline,
        error: `${result.failure.detail}. A local brief is available, but the pipeline stopped before the next stage.`
      };
    }
    const base: StageState = result.source === "ai"
      ? { status: "done", note: "Analyzed with AI", noteTone: "ok" }
      : { status: "done", note: "Local extraction used; no AI request was made", noteTone: "info" };
    if (!duplicateNote) return base;
    return { ...base, noteTone: "warn", note: `${base.note} · Already tracked: ${duplicateNote}` };
  }

  function duplicateStoppedState(phase: "before" | "after"): StageState {
    return {
      status: "stopped",
      errorHeadline: "Duplicate application found",
      error: phase === "before"
        ? "Pipeline stopped before Job analysis. No AI request was made."
        : "Job analysis completed. Tailor and Review were not run."
    };
  }

  function dismissJobAnalysisProgress() {
    setJobAnalysisProgressVisible(false);
  }

  // Prepare's direct-typing path (manual edits to the description textarea) —
  // NOT used by the job analysis entry points above, which call the raw
  // setJobDescription and set pipelineAiUsage["job-analysis"] to their own real usage.
  // A manual edit means whatever job analysis result was showing no longer describes
  // the text on screen, and there is no separate raw version to remember.
  // (Deliberately does NOT drop tailor/review/cover: a manual edit keeps the
  // polish result on screen, so its attribution still describes that output.)
  function handleManualJobDescriptionChange(value: string) {
    setJobDescription(value);
    // Typing or replacing source starts fresh intake immediately. Clear the
    // prepared snapshot so App also releases any restored/applied application
    // link before a document can be saved against the wrong posting.
    setImportedJob(null);
    setPipelineAiUsage((prev) => ({ ...prev, "job-analysis": { source: "none" } }));
    setJobRawText("");
  }

  // Fresh-import usage reset: every import path below clears the polish result
  // (setResult(null)), so the PREVIOUS job's tailor/review/cover attribution is
  // now orphaned — commitApply snapshots pipelineAiUsage onto the Application,
  // and a stale row would record job A's providers on an unpolished job B.
  // Mirrors handlePolish's fresh-run delete (usePolishPipeline) and
  // handleLoadApplication's whole-map replace (App).
  const freshJobAnalysisUsage = (usage: StageAiUsage) => (prev: Record<string, StageAiUsage>) => {
    const next: Record<string, StageAiUsage> = { ...prev, "job-analysis": usage };
    delete next.tailor;
    delete next.review;
    delete next.cover;
    return next;
  };

  async function handleExtractFromLink() {
    const url = jobUrl.trim();
    if (!url) return;
    const readinessInputFingerprint = jobAnalysisInputFingerprintRef.current;
    const readiness = await ensureProviderReady();
    if (readinessInputFingerprint !== jobAnalysisInputFingerprintRef.current) {
      setLinkStatus("Job inputs changed while AI setup was being checked. Prepare the current posting again.");
      return;
    }
    if (!readiness.ready) {
      setLinkStatus(readiness.message);
      // Point the failed card's Retry at THIS action — without it the button
      // would re-dispatch whatever job analysis ran previously (or be absent).
      setJobAnalysisRetrySource("link");
      setJobAnalysisProgress({ status: "failed", errorHeadline: "Provider unavailable", error: readiness.message });
      setJobAnalysisProgressVisible(true);
      return;
    }
    const releaseJobAnalysisRun = tryClaimJobAnalysisRun();
    if (!releaseJobAnalysisRun) return;
    const request = startJobAnalysisRequest();
    setIsExtractingLink(true);
    setJobAnalysisRetrySource("link");
    setJobAnalysisProgress({ status: "running" });
    setJobAnalysisProgressVisible(true);
    setLinkStatus("Fetching the posting…");
    try {
      const response = await fetch("/api/import-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: request.signal
      });
      const data = await response.json();
      if (!request.isCurrent()) return;
      if (!response.ok) throw new Error(data.error ?? "Could not read that link.");
      // AI job analyzer (server-side keys) trims the scraped page to the parts worth
      // polishing and extracts tracker details; falls back to the deterministic
      // engine on any failure so a link import always produces a brief.
      setLinkStatus("Preparing job details…");
      const rawText = String(data.text ?? "");
      const localExtracted = extractJobPosting(rawText, { url });
      const duplicateBefore = await confirmDuplicateBeforeJobAnalysis(url, rawText, localExtracted.tracking);
      if (!request.isCurrent()) return;
      if (!duplicateBefore.proceed) {
        applyRawImportedJob(rawText.trim(), url);
        setJobAnalysisProgress(duplicateStoppedState("before"));
        setLinkStatus("Preparation stopped because this application is already tracked.");
        return;
      }
      const result = await analyzeJobPosting(rawText, {
        url,
        aiRequest: jobAnalysisRequestFields(),
        localExtracted,
        signal: request.signal
      });
      if (!request.isCurrent()) return;
      const { extracted, usage } = result;
      const relevant = extracted.tailoringText;
      if (relevant.trim().length < 40) {
        setLinkStatus("Fetched the page, but found too little job text. Paste the description instead.");
        setJobAnalysisProgress({
          status: "failed",
          errorHeadline: "Missing input",
          error: "Too little job text was found on that page. Paste the description instead."
        });
        setImportedJob(null);
        return;
      }
      const duplicateAfter = result.failure
        ? duplicateBefore
        : await confirmDuplicateAfterJobAnalysis(url, rawText, extracted.tracking);
      if (!request.isCurrent()) return;
      setJobDescription(relevant);
      setImportedJob(importedJobSnapshot(url, relevant, extracted, rawText));
      setResult(null);
      resetCoverWorkflow();
      setPipelineAiUsage(freshJobAnalysisUsage(usage));
      setJobRawText(rawText);
      if (!duplicateAfter.proceed) {
        setJobAnalysisProgress(duplicateStoppedState("after"));
        setLinkStatus("Job details were prepared, then the workflow stopped because this application is already tracked.");
        return;
      }
      const missing = compactManualReviewFields(extracted.manualReviewFields);
      setLinkStatus(result.failure
        ? `${result.failure.headline}: ${result.failure.detail}. A local brief is available; preparation stopped.`
        : `Prepared ${relevant.length.toLocaleString()} compact characters for tailoring and captured ${presentTrackingFields(
            extracted.tracking
          )}${missing ? `; add ${missing} manually if needed` : ""}.`);
      setJobAnalysisProgress(jobAnalysisTerminalState(result, duplicateAfter.note));
    } catch (error) {
      if (!request.isCurrent()) return;
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      setImportedJob(null);
      setLinkStatus(`Couldn't extract from the link: ${message}. Paste the description instead.`);
      const f = classifyFailure(error);
      setJobAnalysisProgress({
        status: "failed",
        errorHeadline: f.headline,
        error: `${f.detail}. Paste the description instead.`
      });
    } finally {
      finishJobAnalysisRequest(request.controller);
      setIsExtractingLink(false);
      releaseJobAnalysisRun();
    }
  }

  // Analyze whatever the user pasted into the Job posting box through the same
  // pipeline the link path uses. Covers JDs the server can't fetch (Workday
  // wd1 tenants, ADP, anything JS-only): user copies the visible page text from
  // their browser, pastes it in, and gets the structured brief plus tracking.
  async function handleAnalyzePaste(sourceOverride?: string) {
    const raw = sourceOverride ?? jobDescription;
    if (!raw.trim() || jobAnalysisBusyRef.current) return;
    const readinessInputFingerprint = jobAnalysisInputFingerprintRef.current;
    const readiness = await ensureProviderReady();
    if (readinessInputFingerprint !== jobAnalysisInputFingerprintRef.current) {
      setLinkStatus("Job inputs changed while AI setup was being checked. Prepare the current posting again.");
      return;
    }
    if (!readiness.ready) {
      setLinkStatus(readiness.message);
      // Point the failed card's Retry at THIS action (see handleExtractFromLink).
      setJobAnalysisRetrySource("paste");
      setJobAnalysisProgress({ status: "failed", errorHeadline: "Provider unavailable", error: readiness.message });
      setJobAnalysisProgressVisible(true);
      return;
    }
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
      setLinkStatus("Paste a bit more job text first. Preparation needs a real description to work from.");
      return;
    }
    const releaseJobAnalysisRun = tryClaimJobAnalysisRun();
    if (!releaseJobAnalysisRun) return;
    const request = startJobAnalysisRequest();
    setIsExtractingLink(true);
    setJobAnalysisRetrySource("paste");
    setJobAnalysisProgress({ status: "running" });
    setJobAnalysisProgressVisible(true);
    setLinkStatus("Preparing the pasted posting…");
    try {
      const trimmedUrl = jobUrl.trim();
      const localExtracted = extractJobPosting(cleaned, { url: trimmedUrl || undefined });
      const duplicateBefore = await confirmDuplicateBeforeJobAnalysis(trimmedUrl, cleaned, localExtracted.tracking);
      if (!request.isCurrent()) return;
      if (!duplicateBefore.proceed) {
        applyRawImportedJob(cleaned.trim(), trimmedUrl);
        setJobAnalysisProgress(duplicateStoppedState("before"));
        setLinkStatus("Preparation stopped because this application is already tracked.");
        return;
      }
      const result = await analyzeJobPosting(cleaned, {
        url: jobUrl.trim() || undefined,
        aiRequest: jobAnalysisRequestFields(),
        localExtracted,
        signal: request.signal
      });
      if (!request.isCurrent()) return;
      const { extracted, usage } = result;
      const relevant = extracted.tailoringText;
      if (relevant.trim().length < 40) {
        setLinkStatus("Couldn't find enough job-relevant text in the paste. Check that you copied the description, not just the page header.");
        setJobAnalysisProgress({
          status: "failed",
          errorHeadline: "Missing input",
          error: "Couldn't find enough job-relevant text in the paste."
        });
        return;
      }
      const duplicateAfter = result.failure
        ? duplicateBefore
        : await confirmDuplicateAfterJobAnalysis(trimmedUrl, cleaned, extracted.tracking);
      if (!request.isCurrent()) return;
      setJobDescription(relevant);
      setImportedJob(importedJobSnapshot(trimmedUrl, relevant, extracted, cleaned));
      setResult(null);
      resetCoverWorkflow();
      setPipelineAiUsage(freshJobAnalysisUsage(usage));
      setJobRawText(cleaned);
      if (!duplicateAfter.proceed) {
        setJobAnalysisProgress(duplicateStoppedState("after"));
        setLinkStatus("Job details were prepared, then the workflow stopped because this application is already tracked.");
        return;
      }
      const missing = compactManualReviewFields(extracted.manualReviewFields);
      setLinkStatus(result.failure
        ? `${result.failure.headline}: ${result.failure.detail}. A local brief is available; preparation stopped.`
        : `Prepared ${relevant.length.toLocaleString()} compact characters from the paste and captured ${presentTrackingFields(
            extracted.tracking
          )}${missing ? `; add ${missing} manually if needed` : ""}.`);
      setJobAnalysisProgress(jobAnalysisTerminalState(result, duplicateAfter.note));
    } catch (error) {
      if (!request.isCurrent()) return;
      // analyzeJobPosting is built to fall back to local rather than throw, so
      // this only fires on an unexpected error — surface it instead of leaving
      // the card stuck on "running".
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "job analysis failed";
      setLinkStatus(`Couldn't prepare the pasted posting: ${message}.`);
      const f = classifyFailure(error);
      setJobAnalysisProgress({ status: "failed", errorHeadline: f.headline, error: f.detail });
    } finally {
      finishJobAnalysisRequest(request.controller);
      setIsExtractingLink(false);
      releaseJobAnalysisRun();
    }
  }

  // Preserve the captured source when a duplicate gate stops before Job analysis.
  // Normal extension intake always goes through provider-backed AI job analysis;
  // this raw snapshot is only the pre-analysis duplicate-stop view.
  function applyRawImportedJob(rawTrimmed: string, trimmedUrl: string) {
    const localExtracted = extractJobPosting(rawTrimmed, { url: trimmedUrl || undefined });
    setJobUrl(trimmedUrl);
    setJobDescription(rawTrimmed);
    setImportedJob(importedJobSnapshot(trimmedUrl, rawTrimmed, localExtracted, rawTrimmed));
    setResult(null);
    resetCoverWorkflow();
    setPipelineAiUsage(freshJobAnalysisUsage({ source: "none", completedAt: new Date().toISOString() }));
    setJobRawText(rawTrimmed);
    setJobAnalysisProgress({
      status: "done",
      note: "Raw description retained for duplicate review",
      noteTone: "info"
    });
  }

  // Retry an extension-import analysis by re-running provider-backed AI job analysis
  // against its stored raw text. The extension import is event-driven, so this
  // gives its card a working retry after a provider or request failure.
  async function retryImportedJobAnalysis() {
    const payload = jobAnalysisImportRef.current;
    if (!payload) return;
    const readiness = await ensureProviderReady();
    if (!readiness.ready) {
      setJobAnalysisRetrySource("import");
      setJobAnalysisProgress({ status: "failed", errorHeadline: "Provider unavailable", error: readiness.message });
      setJobAnalysisProgressVisible(true);
      setPolishStatus(`The extension posting could not be prepared: ${readiness.message}`);
      return;
    }
    const releaseJobAnalysisRun = tryClaimJobAnalysisRun();
    if (!releaseJobAnalysisRun) return;
    const request = startJobAnalysisRequest();
    setIsExtractingLink(true);
    setJobAnalysisRetrySource("import");
    setJobAnalysisProgress({ status: "running" });
    setJobAnalysisProgressVisible(true);
    try {
      const rawTrimmed = payload.text.trim();
      if (rawTrimmed.length < 40) {
        setJobAnalysisProgress({
          status: "failed",
          errorHeadline: "Missing input",
          error: "The imported posting had too little job text. Paste it manually."
        });
        return;
      }
      const localExtracted = extractJobPosting(payload.text, { url: payload.url || undefined });
      const duplicateBefore = await confirmDuplicateBeforeJobAnalysis(payload.url, payload.text, localExtracted.tracking);
      if (!request.isCurrent()) return;
      if (!duplicateBefore.proceed) {
        applyRawImportedJob(rawTrimmed, payload.url);
        setJobAnalysisProgress(duplicateStoppedState("before"));
        setPolishStatus("Preparation stopped because this application is already tracked.");
        return;
      }
      const result = await analyzeJobPosting(payload.text, {
        url: payload.url || undefined,
        aiRequest: jobAnalysisRequestFields(),
        localExtracted,
        signal: request.signal
      });
      if (!request.isCurrent()) return;
      const { extracted, usage } = result;
      const relevant = extracted.tailoringText;
      if (relevant.trim().length < 40) {
        setJobAnalysisProgress({
          status: "failed",
          errorHeadline: "Missing input",
          error: "The imported posting had too little job text. Paste it manually."
        });
        return;
      }
      const duplicateAfter = result.failure
        ? duplicateBefore
        : await confirmDuplicateAfterJobAnalysis(payload.url, payload.text, extracted.tracking);
      if (!request.isCurrent()) return;
      // Keep jobUrl in sync (payload.url is already trimmed) so the jobTracking
      // memo's importedJob.url === jobUrl.trim() guard holds after the retry.
      setJobUrl(payload.url);
      setJobDescription(relevant);
      setImportedJob(importedJobSnapshot(payload.url, relevant, extracted, payload.text));
      setResult(null);
      resetCoverWorkflow();
      setPipelineAiUsage(freshJobAnalysisUsage(usage));
      setJobRawText(payload.text);
      if (!duplicateAfter.proceed) {
        setJobAnalysisProgress(duplicateStoppedState("after"));
        setPolishStatus("Job details were prepared, then the workflow stopped because this application is already tracked.");
        return;
      }
      setJobAnalysisProgress(jobAnalysisTerminalState(result, duplicateAfter.note));
      setPolishStatus(result.failure
        ? `${result.failure.headline}: ${result.failure.detail}. A local brief was loaded; Tailor and Review were not run.`
        : "Application prepared from the browser extension.");
    } catch (error) {
      if (!request.isCurrent()) return;
      const f = classifyFailure(error);
      setJobAnalysisProgress({ status: "failed", errorHeadline: f.headline, error: f.detail });
      setPolishStatus(`The extension posting could not be prepared: ${f.detail}. Retry from the workflow card.`);
    } finally {
      finishJobAnalysisRequest(request.controller);
      setIsExtractingLink(false);
      releaseJobAnalysisRun();
    }
  }

  // Auto-fill the job description from the browser extension inbox. Provider
  // readiness is required before the tab runs AI job analysis; its deterministic
  // brief is retained only when that AI request fails.
  useExtensionInbox(
    async (item: ExtensionImport) => {
      onExtensionJobReceived();
      setExtensionImportPhase("preparing");
      const { text, url } = item;
      const trimmedUrl = url.trim();
      const rawTrimmed = text.trim();
      jobAnalysisImportRef.current = { text, url: trimmedUrl };
      setJobAnalysisRetrySource("import");
      const readiness = await ensureProviderReady();
      if (!readiness.ready) {
        setJobAnalysisProgress({ status: "failed", errorHeadline: "Provider unavailable", error: readiness.message });
        setJobAnalysisProgressVisible(true);
        setPolishStatus(`The extension posting could not be prepared: ${readiness.message}`);
        setExtensionImportPhase(null);
        return;
      }
      const releaseJobAnalysisRun = await waitAndClaimJobAnalysisRun();
      const request = startJobAnalysisRequest();
      setIsExtractingLink(true);
      try {
        const localExtracted = extractJobPosting(rawTrimmed, { url: trimmedUrl || undefined });
        const duplicateBefore = await confirmDuplicateBeforeJobAnalysis(trimmedUrl, rawTrimmed, localExtracted.tracking);
        if (!request.isCurrent()) return;
        if (!duplicateBefore.proceed) {
          if (rawTrimmed.length >= 40) applyRawImportedJob(rawTrimmed, trimmedUrl);
          setJobAnalysisProgress(duplicateStoppedState("before"));
          setJobAnalysisProgressVisible(true);
          setPolishStatus("Preparation stopped because this application is already tracked.");
          return;
        }

        setJobAnalysisProgress({ status: "running" });
        setJobAnalysisProgressVisible(true);
        const result = await analyzeJobPosting(text, {
          url: trimmedUrl || undefined,
          aiRequest: jobAnalysisRequestFields(),
          localExtracted,
          signal: request.signal
        });
        if (!request.isCurrent()) return;
        const { extracted, usage } = result;
        const relevant = extracted.tailoringText;
        if (relevant.trim().length < 40) {
          setPolishStatus("The extension posting had too little job text. Paste it manually.");
          setJobAnalysisRetrySource("import");
          setJobAnalysisProgress({
            status: "failed",
            errorHeadline: "Missing input",
            error: "The imported posting had too little job text. Paste it manually."
          });
          setJobAnalysisProgressVisible(true);
          return;
        }
        const duplicateAfter = result.failure
          ? duplicateBefore
          : await confirmDuplicateAfterJobAnalysis(trimmedUrl, text, extracted.tracking);
        if (!request.isCurrent()) return;
        setJobUrl(trimmedUrl);
        setJobDescription(relevant);
        setImportedJob(importedJobSnapshot(trimmedUrl, relevant, extracted, text));
        setResult(null);
        resetCoverWorkflow();
        setPipelineAiUsage(freshJobAnalysisUsage(usage));
        setJobRawText(text);
        if (!duplicateAfter.proceed) {
          setJobAnalysisRetrySource("import");
          setJobAnalysisProgress(duplicateStoppedState("after"));
          setJobAnalysisProgressVisible(true);
          setPolishStatus("Job details were prepared, then the workflow stopped because this application is already tracked.");
          return;
        }
        // A successful or locally-fallback job analysis stops here. Tailor remains an
        // explicit action in Prepare.
        const terminalState = jobAnalysisTerminalState(result, duplicateAfter.note);
        setJobAnalysisRetrySource("import");
        setJobAnalysisProgress(terminalState);
        setJobAnalysisProgressVisible(true);
        setPolishStatus(result.failure
          ? `${result.failure.headline}: ${result.failure.detail}. A local brief was loaded; Tailor and Review were not run.`
          : "Application prepared from the browser extension.");
      } catch (error) {
        if (!request.isCurrent()) return;
        const failure = classifyFailure(error);
        setJobAnalysisRetrySource("import");
        setJobAnalysisProgress({ status: "failed", errorHeadline: failure.headline, error: failure.detail });
        setJobAnalysisProgressVisible(true);
        setPolishStatus(`The extension posting could not be prepared: ${failure.detail}. Retry from the workflow card.`);
      } finally {
        finishJobAnalysisRequest(request.controller);
        setIsExtractingLink(false);
        setExtensionImportPhase(null);
        releaseJobAnalysisRun();
      }
    },
    () => {
      onExtensionPrepareStarted();
      setExtensionImportPhase("receiving");
      // Background server-side preparation is still running — surface it on the
      // same card the link/paste flows use. Guard the running state so repeated
      // polls don't churn renders.
      if (jobAnalysisBusyRef.current) return;
      setJobAnalysisRetrySource(null);
      setJobAnalysisProgress((prev) => (prev.status === "running" ? prev : { status: "running" }));
      setJobAnalysisProgressVisible(true);
    },
    extensionImportsReady
  );

  // Resolve the job analysis card's Retry to the live handler for the last action, so
  // it re-runs against the CURRENT url / paste rather than a stale captured one.
  const jobAnalysisRetry =
    jobAnalysisRetrySource === "link"
      ? handleExtractFromLink
      : jobAnalysisRetrySource === "paste"
        ? handleAnalyzePaste
        : jobAnalysisRetrySource === "import"
          ? retryImportedJobAnalysis
          : undefined;

  return {
    isExtractingLink,
    extensionImportPhase,
    jobAnalysisProgress,
    jobAnalysisProgressVisible,
    dismissJobAnalysisProgress,
    jobAnalysisRetry,
    handleManualJobDescriptionChange,
    handleExtractFromLink,
    handleAnalyzePaste
  };
}
