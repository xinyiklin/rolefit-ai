/**
 * useJobIntake — the job-brief distill/import flows, extracted from App.tsx:
 * Extract-from-link, Distill-paste, the browser-extension inbox import (both
 * the AI-off raw path and the AI-distill path), each entry point's Retry, and
 * the manual-edit handler — every distill-provenance write (pipelineAiUsage.
 * distill + jobRawText) lives in this one module.
 *
 * State ownership: distillProgress/distillProgressVisible/distillRetrySource/
 * isExtractingLink are OWNED here (not passed in) because every mutator of
 * them is one of these handlers — App only READS them for render (the
 * shared AI workflow, the progress-dock visibility check, JobMenu's
 * isExtractingLink prop, and the _myPhase presence memo), so returning them
 * keeps the interface small without leaking control back to App.
 *
 * jobUrl/jobDescription/importedJob/result/pipelineAiUsage/jobRawText/
 * autoTailorJob/polishStatus stay in App (it seeds/derives from them well
 * beyond this flow — jobTracking, autosave, presence, canPolish, etc.), so
 * their setters arrive via the args object.
 */
import { useEffect, useRef, useState } from "react";
import type { ExtractedJobTracking } from "../lib/jobExtract";
import { extractJobPosting } from "../lib/jobExtract";
import {
  distillJobPosting,
  extractedFromAiOrLocal,
  type AiDistillFields,
  type DistillResult
} from "../lib/aiDistill";
import { classifyFailure } from "../lib/failures";
import { useExtensionInbox, type ExtensionImport } from "./useExtensionInbox";
import {
  workflowInputFingerprint,
  workflowRequestIsCurrent,
  workflowStageCanAdvance,
  type AiStageState as StageState
} from "../lib/aiWorkflow";
import type { StageAiUsage } from "../lib/aiUsage";
import type { TailorMode } from "../lib/tailorScope";
import type { PolishedResume } from "../resumeEngine";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";

export type ImportedJobSnapshot = {
  url: string;
  tailoringText: string;
  tracking: ExtractedJobTracking;
  manualReviewFields: string[];
};

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

type UseJobIntakeArgs = {
  jobUrl: string;
  setJobUrl: (value: string) => void;
  jobDescription: string;
  setJobDescription: (value: string) => void;
  setImportedJob: (value: ImportedJobSnapshot | null) => void;
  setResult: (value: PolishedResume | null) => void;
  applyCoverLetter: (text: string) => void;
  setPipelineAiUsage: (updater: (prev: Record<string, StageAiUsage>) => Record<string, StageAiUsage>) => void;
  setJobRawText: (value: string) => void;
  setAutoTailorJob: (value: string | null) => void;
  setPolishStatus: (value: string) => void;
  setLinkStatus: (value: string) => void;
  confirmDuplicateBeforeDistill: (
    url: string,
    text: string,
    facts: ExtractedJobTracking
  ) => Promise<{ proceed: boolean; note: string | null }>;
  confirmDuplicateAfterDistill: (
    url: string,
    text: string,
    facts: ExtractedJobTracking
  ) => Promise<{ proceed: boolean; note: string | null }>;
  distillRequestFields: () => Record<string, unknown>;
  tailorModes: Record<string, TailorMode>;
  editedResume: ResumeData | null;
};

export function useJobIntake({
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
  confirmDuplicateBeforeDistill,
  confirmDuplicateAfterDistill,
  distillRequestFields,
  tailorModes,
  editedResume
}: UseJobIntakeArgs) {
  const [isExtractingLink, setIsExtractingLink] = useState(false);
  // Distill progress row in the shared AI workflow. Driven by both
  // job-brief entry points (Extract-from-link and Distill-paste); the DONE card
  // reports whether the brief came from the AI or the local fallback.
  const [distillProgress, setDistillProgress] = useState<StageState>({ status: "idle" });
  const [distillProgressVisible, setDistillProgressVisible] = useState(false);
  const [distillContinuesToPolish, setDistillContinuesToPolish] = useState(false);
  // Which distill action the card's Retry should re-run (link, paste, or a
  // re-distill of an extension import). Stored as a tag, not a captured closure,
  // so Retry dispatches to the LIVE handler and picks up the current URL / paste
  // — a stored closure would re-run stale input the user has since edited. Null
  // only before any distill has run, so that card shows no Retry button.
  const [distillRetrySource, setDistillRetrySource] = useState<"link" | "paste" | "import" | null>(null);
  // Raw source text + url of the last extension import, so its card's Retry can
  // re-distill it through the CLIENT /api/distill path — the extension import is
  // event-driven with no action to re-run otherwise.
  const distillImportRef = useRef<{
    text: string;
    url: string;
    distillAi: boolean;
    autoTailor: boolean;
  } | null>(null);
  // A once-only extension delivery cannot be put back into the server inbox,
  // so serialize every distill in memory. User actions reject while busy;
  // extension deliveries wait for the active run, retaining their captured
  // payload until they own the lock.
  const distillBusyRef = useRef(false);
  const distillSettledRef = useRef<Promise<void>>(Promise.resolve());
  const distillGenerationRef = useRef(0);
  const distillAbortRef = useRef<AbortController | null>(null);
  const distillInputFingerprint = workflowInputFingerprint({
    jobUrl,
    jobDescription,
    editedResume,
    tailorModes,
    aiRequest: distillRequestFields()
  });
  const distillInputFingerprintRef = useRef(distillInputFingerprint);
  distillInputFingerprintRef.current = distillInputFingerprint;

  function startDistillRequest() {
    distillGenerationRef.current += 1;
    distillAbortRef.current?.abort();
    const controller = new AbortController();
    distillAbortRef.current = controller;
    const generation = distillGenerationRef.current;
    const fingerprint = distillInputFingerprintRef.current;
    return {
      controller,
      signal: controller.signal,
      isCurrent: () => workflowRequestIsCurrent(
        generation,
        distillGenerationRef.current,
        fingerprint,
        distillInputFingerprintRef.current,
        controller.signal
      )
    };
  }

  function finishDistillRequest(controller: AbortController) {
    if (distillAbortRef.current === controller) distillAbortRef.current = null;
  }

  useEffect(() => {
    if (!distillAbortRef.current) return;
    distillGenerationRef.current += 1;
    distillAbortRef.current.abort();
    distillAbortRef.current = null;
    setAutoTailorJob(null);
    setDistillProgress({
      status: "stopped",
      errorHeadline: "Inputs changed",
      error: "The active Distill was cancelled before it could replace the current job target."
    });
    setDistillProgressVisible(true);
    setLinkStatus("Job or resume inputs changed. Start Distill again for the current target.");
  }, [distillInputFingerprint, setAutoTailorJob, setLinkStatus]);

  useEffect(() => () => {
    distillGenerationRef.current += 1;
    distillAbortRef.current?.abort();
    distillAbortRef.current = null;
  }, []);

  function claimDistillRun(): () => void {
    distillBusyRef.current = true;
    let resolve!: () => void;
    distillSettledRef.current = new Promise<void>((done) => {
      resolve = done;
    });
    return () => {
      distillBusyRef.current = false;
      resolve();
    };
  }

  function tryClaimDistillRun(): (() => void) | null {
    return distillBusyRef.current ? null : claimDistillRun();
  }

  async function waitAndClaimDistillRun(): Promise<() => void> {
    while (distillBusyRef.current) await distillSettledRef.current;
    return claimDistillRun();
  }

  function distillTerminalState(result: DistillResult, duplicateNote?: string | null): StageState {
    if (result.failure) {
      return {
        status: "failed",
        errorHeadline: result.failure.headline,
        error: `${result.failure.detail}. A local brief is available, but the pipeline stopped before the next stage.`
      };
    }
    const base: StageState = result.source === "ai"
      ? { status: "done", note: "Distilled with AI", noteTone: "ok" }
      : { status: "done", note: "Local extraction used; no AI request was made", noteTone: "info" };
    if (!duplicateNote) return base;
    return { ...base, noteTone: "warn", note: `${base.note} · Already tracked: ${duplicateNote}` };
  }

  function duplicateStoppedState(phase: "before" | "after"): StageState {
    return {
      status: "stopped",
      errorHeadline: "Duplicate application found",
      error: phase === "before"
        ? "Pipeline stopped before Distill. No AI request was made."
        : "Distill completed. Tailor and Review were not run."
    };
  }

  function dismissDistillProgress() {
    setDistillProgressVisible(false);
    setDistillContinuesToPolish(false);
  }

  // JobMenu's direct-typing path (manual edits to the description textarea) —
  // NOT used by the distill entry points above, which call the raw
  // setJobDescription and set pipelineAiUsage.distill to their own real usage.
  // A manual edit means whatever distill result was showing no longer describes
  // the text on screen, and there is no separate raw version to remember.
  // (Deliberately does NOT drop tailor/review/cover: a manual edit keeps the
  // polish result on screen, so its attribution still describes that output.)
  function handleManualJobDescriptionChange(value: string) {
    setJobDescription(value);
    setPipelineAiUsage((prev) => ({ ...prev, distill: { source: "none" } }));
    setJobRawText("");
  }

  // Fresh-import usage reset: every import path below clears the polish result
  // (setResult(null)), so the PREVIOUS job's tailor/review/cover attribution is
  // now orphaned — commitApply snapshots pipelineAiUsage onto the Application,
  // and a stale row would record job A's providers on an unpolished job B.
  // Mirrors handlePolish's fresh-run delete (usePolishPipeline) and
  // handleLoadApplication's whole-map replace (App).
  const freshDistillUsage = (usage: StageAiUsage) => (prev: Record<string, StageAiUsage>) => {
    const next: Record<string, StageAiUsage> = { ...prev, distill: usage };
    delete next.tailor;
    delete next.review;
    delete next.cover;
    return next;
  };

  async function handleExtractFromLink() {
    const url = jobUrl.trim();
    if (!url) return;
    const releaseDistillRun = tryClaimDistillRun();
    if (!releaseDistillRun) return;
    const request = startDistillRequest();
    setIsExtractingLink(true);
    setDistillRetrySource("link");
    setDistillContinuesToPolish(false);
    setDistillProgress({ status: "running" });
    setDistillProgressVisible(true);
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
      // AI distiller (server-side keys) trims the scraped page to the parts worth
      // polishing and extracts tracker details; falls back to the deterministic
      // engine on any failure so a link import always produces a brief.
      setLinkStatus("Distilling the posting…");
      const rawText = String(data.text ?? "");
      const localExtracted = extractJobPosting(rawText, { url });
      const duplicateBefore = await confirmDuplicateBeforeDistill(url, rawText, localExtracted.tracking);
      if (!request.isCurrent()) return;
      if (!duplicateBefore.proceed) {
        applyRawImportedJob(rawText.trim(), url);
        setDistillProgress(duplicateStoppedState("before"));
        setLinkStatus("Import stopped because this application is already tracked.");
        return;
      }
      const result = await distillJobPosting(rawText, {
        url,
        aiRequest: distillRequestFields(),
        localExtracted,
        signal: request.signal
      });
      if (!request.isCurrent()) return;
      const { extracted, usage } = result;
      const relevant = extracted.tailoringText;
      if (relevant.trim().length < 40) {
        setLinkStatus("Fetched the page, but found too little job text. Paste the description instead.");
        setDistillProgress({
          status: "failed",
          errorHeadline: "Missing input",
          error: "Too little job text was found on that page. Paste the description instead."
        });
        setImportedJob(null);
        return;
      }
      const duplicateAfter = result.failure
        ? duplicateBefore
        : await confirmDuplicateAfterDistill(url, rawText, extracted.tracking);
      if (!request.isCurrent()) return;
      setJobDescription(relevant);
      setImportedJob({
        url,
        tailoringText: relevant.trim(),
        tracking: extracted.tracking,
        manualReviewFields: extracted.manualReviewFields
      });
      setResult(null);
      applyCoverLetter("");
      setPipelineAiUsage(freshDistillUsage(usage));
      setJobRawText(relevant.trim() !== rawText.trim() ? rawText : "");
      if (!duplicateAfter.proceed) {
        setDistillProgress(duplicateStoppedState("after"));
        setLinkStatus("Distill completed, then the pipeline stopped because this application is already tracked.");
        return;
      }
      const missing = compactManualReviewFields(extracted.manualReviewFields);
      setLinkStatus(result.failure
        ? `${result.failure.headline}: ${result.failure.detail}. A local brief was loaded; the pipeline stopped.`
        : `Distilled ${relevant.length.toLocaleString()} compact characters for tailoring and captured ${presentTrackingFields(
            extracted.tracking
          )}${missing ? `; add ${missing} manually if needed` : ""}.`);
      setDistillProgress(distillTerminalState(result, duplicateAfter.note));
    } catch (error) {
      if (!request.isCurrent()) return;
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "request failed";
      setImportedJob(null);
      setLinkStatus(`Couldn't extract from the link: ${message}. Paste the description instead.`);
      const f = classifyFailure(error);
      setDistillProgress({
        status: "failed",
        errorHeadline: f.headline,
        error: `${f.detail}. Paste the description instead.`
      });
    } finally {
      finishDistillRequest(request.controller);
      setIsExtractingLink(false);
      releaseDistillRun();
    }
  }

  // Distill whatever the user pasted into the Job posting box through the same
  // pipeline the link path uses. Covers JDs the server can't fetch (Workday
  // wd1 tenants, ADP, anything JS-only): user copies the visible page text from
  // their browser, pastes it in, and gets the structured brief plus tracking.
  async function handleDistillPaste() {
    const raw = jobDescription;
    if (!raw.trim() || distillBusyRef.current) return;
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
      setLinkStatus("Paste a bit more job text first. Distillation needs a real description to work from.");
      return;
    }
    const releaseDistillRun = tryClaimDistillRun();
    if (!releaseDistillRun) return;
    const request = startDistillRequest();
    setIsExtractingLink(true);
    setDistillRetrySource("paste");
    setDistillContinuesToPolish(false);
    setDistillProgress({ status: "running" });
    setDistillProgressVisible(true);
    setLinkStatus("Distilling the paste…");
    try {
      const trimmedUrl = jobUrl.trim();
      const localExtracted = extractJobPosting(cleaned, { url: trimmedUrl || undefined });
      const duplicateBefore = await confirmDuplicateBeforeDistill(trimmedUrl, cleaned, localExtracted.tracking);
      if (!request.isCurrent()) return;
      if (!duplicateBefore.proceed) {
        applyRawImportedJob(cleaned.trim(), trimmedUrl);
        setDistillProgress(duplicateStoppedState("before"));
        setLinkStatus("Distill stopped because this application is already tracked.");
        return;
      }
      const result = await distillJobPosting(cleaned, {
        url: jobUrl.trim() || undefined,
        aiRequest: distillRequestFields(),
        localExtracted,
        signal: request.signal
      });
      if (!request.isCurrent()) return;
      const { extracted, usage } = result;
      const relevant = extracted.tailoringText;
      if (relevant.trim().length < 40) {
        setLinkStatus("Couldn't find enough job-relevant text in the paste. Check that you copied the description, not just the page header.");
        setDistillProgress({
          status: "failed",
          errorHeadline: "Missing input",
          error: "Couldn't find enough job-relevant text in the paste."
        });
        return;
      }
      const duplicateAfter = result.failure
        ? duplicateBefore
        : await confirmDuplicateAfterDistill(trimmedUrl, cleaned, extracted.tracking);
      if (!request.isCurrent()) return;
      setJobDescription(relevant);
      setImportedJob({
        url: trimmedUrl,
        tailoringText: relevant.trim(),
        tracking: extracted.tracking,
        manualReviewFields: extracted.manualReviewFields
      });
      setResult(null);
      applyCoverLetter("");
      setPipelineAiUsage(freshDistillUsage(usage));
      setJobRawText(relevant.trim() !== cleaned.trim() ? cleaned : "");
      if (!duplicateAfter.proceed) {
        setDistillProgress(duplicateStoppedState("after"));
        setLinkStatus("Distill completed, then the pipeline stopped because this application is already tracked.");
        return;
      }
      const missing = compactManualReviewFields(extracted.manualReviewFields);
      setLinkStatus(result.failure
        ? `${result.failure.headline}: ${result.failure.detail}. A local brief was loaded; the pipeline stopped.`
        : `Distilled ${relevant.length.toLocaleString()} compact characters from the paste and captured ${presentTrackingFields(
            extracted.tracking
          )}${missing ? `; add ${missing} manually if needed` : ""}.`);
      setDistillProgress(distillTerminalState(result, duplicateAfter.note));
    } catch (error) {
      if (!request.isCurrent()) return;
      // distillJobPosting is built to fall back to local rather than throw, so
      // this only fires on an unexpected error — surface it instead of leaving
      // the card stuck on "running".
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "distillation failed";
      setLinkStatus(`Couldn't distill the paste: ${message}.`);
      const f = classifyFailure(error);
      setDistillProgress({ status: "failed", errorHeadline: f.headline, error: f.detail });
    } finally {
      finishDistillRequest(request.controller);
      setIsExtractingLink(false);
      releaseDistillRun();
    }
  }

  // Shared by the extension-import AI-off branch and its Retry: use the RAW
  // resolved text as the working job description (no AI request — the user
  // turned AI distillation off in the extension), with tracking metadata from
  // the deterministic engine only. The working JD IS the raw text here, so
  // jobRawText stays cleared (no separate pre-distill version to remember).
  function applyRawImportedJob(rawTrimmed: string, trimmedUrl: string) {
    const localExtracted = extractJobPosting(rawTrimmed, { url: trimmedUrl || undefined });
    setJobUrl(trimmedUrl);
    setJobDescription(rawTrimmed);
    setImportedJob({
      url: trimmedUrl,
      tailoringText: rawTrimmed,
      tracking: localExtracted.tracking,
      manualReviewFields: localExtracted.manualReviewFields
    });
    setResult(null);
    applyCoverLetter("");
    setPipelineAiUsage(freshDistillUsage({ source: "none", completedAt: new Date().toISOString() }));
    setJobRawText("");
    setDistillProgress({
      status: "done",
      note: "AI distillation off · Raw description imported",
      noteTone: "info"
    });
  }

  // Retry an extension-import distill by re-distilling its stored raw text
  // through the CLIENT /api/distill path — the extension import is event-driven
  // with nothing to re-run otherwise, so this gives its card a working Retry.
  // Imports made with AI distillation off re-run the deterministic raw-text
  // path instead: Retry must never fire an AI call the user opted out of.
  async function retryImportDistill() {
    const payload = distillImportRef.current;
    if (!payload) return;
    const releaseDistillRun = tryClaimDistillRun();
    if (!releaseDistillRun) return;
    const request = startDistillRequest();
    setIsExtractingLink(true);
    setDistillContinuesToPolish(payload.autoTailor);
    setDistillProgress({ status: "running" });
    setDistillProgressVisible(true);
    try {
      if (!payload.distillAi) {
        const rawTrimmed = payload.text.trim();
        if (rawTrimmed.length < 40) {
          setDistillProgress({
            status: "failed",
            errorHeadline: "Missing input",
            error: "The imported posting had too little job text. Paste it manually."
          });
          return;
        }
        const localExtracted = extractJobPosting(rawTrimmed, { url: payload.url || undefined });
        const duplicate = await confirmDuplicateBeforeDistill(payload.url, rawTrimmed, localExtracted.tracking);
        if (!request.isCurrent()) return;
        applyRawImportedJob(rawTrimmed, payload.url);
        if (!duplicate.proceed) {
          setAutoTailorJob(null);
          setDistillProgress(duplicateStoppedState("before"));
          return;
        }
        setAutoTailorJob(payload.autoTailor ? rawTrimmed : null);
        return;
      }
      const localExtracted = extractJobPosting(payload.text, { url: payload.url || undefined });
      const duplicateBefore = await confirmDuplicateBeforeDistill(payload.url, payload.text, localExtracted.tracking);
      if (!request.isCurrent()) return;
      if (!duplicateBefore.proceed) {
        applyRawImportedJob(payload.text.trim(), payload.url);
        setAutoTailorJob(null);
        setDistillProgress(duplicateStoppedState("before"));
        return;
      }
      const result = await distillJobPosting(payload.text, {
        url: payload.url || undefined,
        aiRequest: distillRequestFields(),
        localExtracted,
        signal: request.signal
      });
      if (!request.isCurrent()) return;
      const { extracted, usage } = result;
      const relevant = extracted.tailoringText;
      if (relevant.trim().length < 40) {
        setDistillProgress({
          status: "failed",
          errorHeadline: "Missing input",
          error: "The imported posting had too little job text. Paste it manually."
        });
        return;
      }
      const duplicateAfter = result.failure
        ? duplicateBefore
        : await confirmDuplicateAfterDistill(payload.url, payload.text, extracted.tracking);
      if (!request.isCurrent()) return;
      // Keep jobUrl in sync (payload.url is already trimmed) so the jobTracking
      // memo's importedJob.url === jobUrl.trim() guard holds after the retry.
      setJobUrl(payload.url);
      setJobDescription(relevant);
      setImportedJob({
        url: payload.url,
        tailoringText: relevant.trim(),
        tracking: extracted.tracking,
        manualReviewFields: extracted.manualReviewFields
      });
      setResult(null);
      applyCoverLetter("");
      setPipelineAiUsage(freshDistillUsage(usage));
      setJobRawText(relevant.trim() !== payload.text.trim() ? payload.text : "");
      if (!duplicateAfter.proceed) {
        setAutoTailorJob(null);
        setDistillProgress(duplicateStoppedState("after"));
        return;
      }
      const terminalState = distillTerminalState(result, duplicateAfter.note);
      setAutoTailorJob(payload.autoTailor && workflowStageCanAdvance(terminalState) ? relevant.trim() : null);
      setDistillProgress(terminalState);
    } catch (error) {
      if (!request.isCurrent()) return;
      const f = classifyFailure(error);
      setDistillProgress({ status: "failed", errorHeadline: f.headline, error: f.detail });
    } finally {
      finishDistillRequest(request.controller);
      setIsExtractingLink(false);
      releaseDistillRun();
    }
  }

  // Auto-fill the job description from the browser extension inbox. The AI distill
  // runs HERE (client-side) with this tab's selected Distill provider; the
  // deterministic engine is the fallback.
  useExtensionInbox(
    async (item: ExtensionImport) => {
      const releaseDistillRun = await waitAndClaimDistillRun();
      const request = startDistillRequest();
      setIsExtractingLink(true);
      try {
      // The server only PREPARED the raw text in the background (the hook polled
      // through the "distilling" state until it was ready); it deliberately did not
      // AI-distill, because the background pass can't read this tab's localStorage AI
      // settings and would otherwise use the env-default provider. So distill here
      // with distillRequestFields() to honor the tab's Distill selection. `fields`
      // arrives null from the current server; the extractedFromAiOrLocal branch is
      // kept only as defensive back-compat (an older server that still sends fields).
      const { text, url, fields, autoTailor, distillAi } = item;
      // Remember the raw import (incl. its distillAi choice, so Retry can never
      // fire an AI call the user opted out of) for the card's Retry below.
      // Store the URL trimmed so a retry keeps importedJob.url === jobUrl.trim()
      // and the jobTracking memo uses the AI tracking, not a deterministic re-parse.
      const trimmedUrl = (url || "").trim();
      const rawTrimmed = text.trim();
      distillImportRef.current = { text, url: trimmedUrl, distillAi, autoTailor };
      setDistillContinuesToPolish(autoTailor);

      const localExtracted = extractJobPosting(rawTrimmed, { url: trimmedUrl || undefined });
      const duplicateBefore = await confirmDuplicateBeforeDistill(trimmedUrl, rawTrimmed, localExtracted.tracking);
      if (!request.isCurrent()) return;
      if (!duplicateBefore.proceed) {
        if (rawTrimmed.length >= 40) applyRawImportedJob(rawTrimmed, trimmedUrl);
        setAutoTailorJob(null);
        setDistillRetrySource("import");
        setDistillProgress(duplicateStoppedState("before"));
        setDistillProgressVisible(true);
        setPolishStatus("Extension import stopped because this application is already tracked.");
        return;
      }

      // The user turned off AI distillation for this import (extension setting):
      // skip the AI request entirely and use the raw resolved text as the working
      // description, with tracking metadata from the deterministic engine only —
      // extractJobPosting is not an AI call.
      if (!distillAi) {
        if (rawTrimmed.length < 40) {
          setPolishStatus("The extension import had too little job text. Paste it manually.");
          setDistillRetrySource("import");
          setDistillProgress({
            status: "failed",
            errorHeadline: "Missing input",
            error: "The imported posting had too little job text. Paste it manually."
          });
          setDistillProgressVisible(true);
          return;
        }
        applyRawImportedJob(rawTrimmed, trimmedUrl);
        setAutoTailorJob(autoTailor ? rawTrimmed : null);
        setDistillRetrySource("import");
        setDistillProgressVisible(true);
        const readyToTailorRaw =
          Boolean(editedResume) && Object.values(tailorModes).some((mode) => mode === "tailor");
        setPolishStatus(
          autoTailor && !readyToTailorRaw
            ? `Job imported from the browser extension. ${
                editedResume ? "set a section to Tailor" : "load a resume"
              } and it'll polish automatically.`
            : "Job imported from the browser extension."
        );
        return;
      }

        // The client distill takes real time now (it always runs), so show the running
        // card while it works — otherwise the import lands with no visible progress.
        // (retrySource is set in each terminal branch below, before any card with Retry.)
        setDistillProgress({ status: "running" });
        setDistillProgressVisible(true);
        const result = fields
          ? extractedFromAiOrLocal(fields as Partial<AiDistillFields>, text, url || undefined, distillRequestFields())
          : await distillJobPosting(text, {
              url: url || undefined,
              aiRequest: distillRequestFields(),
              signal: request.signal
            });
        if (!request.isCurrent()) return;
        const { extracted, usage } = result;
        const relevant = extracted.tailoringText;
        if (relevant.trim().length < 40) {
          setPolishStatus("The extension import had too little job text. Paste it manually.");
          setDistillRetrySource("import");
          setDistillProgress({
            status: "failed",
            errorHeadline: "Missing input",
            error: "The imported posting had too little job text. Paste it manually."
          });
          setDistillProgressVisible(true);
          return;
        }
        const duplicateAfter = result.failure
          ? duplicateBefore
          : await confirmDuplicateAfterDistill(trimmedUrl, text, extracted.tracking);
        if (!request.isCurrent()) return;
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
        setPipelineAiUsage(freshDistillUsage(usage));
        setJobRawText(relevant.trim() !== text.trim() ? text : "");
        if (!duplicateAfter.proceed) {
          setAutoTailorJob(null);
          setDistillRetrySource("import");
          setDistillProgress(duplicateStoppedState("after"));
          setDistillProgressVisible(true);
          setPolishStatus("Distill completed, then the pipeline stopped because this application is already tracked.");
          return;
        }
        // Auto-tailor only when Distill itself succeeded. A local fallback is
        // still loaded for inspection, but cannot silently advance the workflow.
        const terminalState = distillTerminalState(result, duplicateAfter.note);
        setAutoTailorJob(autoTailor && workflowStageCanAdvance(terminalState) ? relevant.trim() : null);
        // The distill card now carries the AI-vs-local signal, so the status line just
        // covers import/auto-tailor context. The imported JD satisfies the
        // description-length gate; the only thing that can still defer the auto-polish
        // is a missing resume / Tailor section — say so rather than appearing to do nothing.
        // "import" keeps a Retry on the card that re-distills through the client path.
        setDistillRetrySource("import");
        setDistillProgress(terminalState);
        setDistillProgressVisible(true);
        const readyToTailor =
          Boolean(editedResume) && Object.values(tailorModes).some((mode) => mode === "tailor");
        setPolishStatus(result.failure
          ? `${result.failure.headline}: ${result.failure.detail}. A local brief was loaded; Tailor and Review were not run.`
          : autoTailor && !readyToTailor
            ? `Job imported from the browser extension. ${
                editedResume ? "set a section to Tailor" : "load a resume"
              } and it'll polish automatically.`
            : "Job imported from the browser extension.");
      } catch (error) {
        if (!request.isCurrent()) return;
        const failure = classifyFailure(error);
        setAutoTailorJob(null);
        setDistillRetrySource("import");
        setDistillProgress({ status: "failed", errorHeadline: failure.headline, error: failure.detail });
        setDistillProgressVisible(true);
        setPolishStatus(`Extension import could not be distilled: ${failure.detail}. Retry from the workflow card.`);
      } finally {
        finishDistillRequest(request.controller);
        setIsExtractingLink(false);
        releaseDistillRun();
      }
    },
    () => {
      // Background server-side distill still running — surface it on the same card
      // the link/paste flows use (no Retry: an extension import has nothing to
      // re-run). Guard the running state so repeated polls don't churn renders.
      if (distillBusyRef.current) return;
      setDistillRetrySource(null);
      setDistillProgress((prev) => (prev.status === "running" ? prev : { status: "running" }));
      setDistillProgressVisible(true);
    }
  );

  // Resolve the distill card's Retry to the live handler for the last action, so
  // it re-runs against the CURRENT url / paste rather than a stale captured one.
  const distillRetry =
    distillRetrySource === "link"
      ? handleExtractFromLink
      : distillRetrySource === "paste"
        ? handleDistillPaste
        : distillRetrySource === "import"
          ? retryImportDistill
          : undefined;

  return {
    isExtractingLink,
    distillProgress,
    distillProgressVisible,
    distillContinuesToPolish,
    dismissDistillProgress,
    distillRetry,
    handleManualJobDescriptionChange,
    handleExtractFromLink,
    handleDistillPaste
  };
}
