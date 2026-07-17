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
 * DistillProgress card, the progress-dock visibility check, JobMenu's
 * isExtractingLink prop, and the _myPhase presence memo), so returning them
 * keeps the interface small without leaking control back to App.
 *
 * jobUrl/jobDescription/importedJob/result/pipelineAiUsage/jobRawText/
 * autoTailorJob/polishStatus stay in App (it seeds/derives from them well
 * beyond this flow — jobTracking, autosave, presence, canPolish, etc.), so
 * their setters arrive via the args object.
 */
import { useRef, useState } from "react";
import type { ExtractedJobTracking } from "../lib/jobExtract";
import { extractJobPosting } from "../lib/jobExtract";
import { distillJobPosting, extractedFromAiOrLocal, type AiDistillFields } from "../lib/aiDistill";
import { classifyFailure, AI_UNAVAILABLE } from "../lib/failures";
import { useExtensionInbox, type ExtensionImport } from "./useExtensionInbox";
import type { StageState } from "../sections/PolishProgress";
import type { StageAiUsage } from "../lib/aiUsage";
import type { TailorMode } from "../lib/tailorScope";
import type { PolishedResume } from "../resumeEngine";
import type { ResumeData } from "../lib/resumeData";

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
  duplicateWarnNote: (url: string, text: string, facts: ExtractedJobTracking) => string | null;
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
  duplicateWarnNote,
  distillRequestFields,
  tailorModes,
  editedResume
}: UseJobIntakeArgs) {
  const [isExtractingLink, setIsExtractingLink] = useState(false);
  // Distill progress card (same vocabulary as PolishProgress). Driven by both
  // job-brief entry points (Extract-from-link and Distill-paste); the DONE card
  // reports whether the brief came from the AI or the local fallback.
  const [distillProgress, setDistillProgress] = useState<StageState>({ status: "idle" });
  const [distillProgressVisible, setDistillProgressVisible] = useState(false);
  // Which distill action the card's Retry should re-run (link, paste, or a
  // re-distill of an extension import). Stored as a tag, not a captured closure,
  // so Retry dispatches to the LIVE handler and picks up the current URL / paste
  // — a stored closure would re-run stale input the user has since edited. Null
  // only before any distill has run, so that card shows no Retry button.
  const [distillRetrySource, setDistillRetrySource] = useState<"link" | "paste" | "import" | null>(null);
  // Raw source text + url of the last extension import, so its card's Retry can
  // re-distill it through the CLIENT /api/distill path — the extension import is
  // event-driven with no action to re-run otherwise.
  const distillImportRef = useRef<{ text: string; url: string; distillAi: boolean } | null>(null);

  // DONE-card state for a distill run, calling out AI success vs local fallback.
  // The fallback shares the reason-line shape with the tailor/cover/review
  // fallbacks and uses the same uniform reason, so every fallback card in a flow
  // reads identically: a bold "AI unavailable" + "local brief shown". A
  // duplicate advisory (already applied to this job) outranks the provenance
  // tone and rides the same note line.
  const distillDoneState = (source: "ai" | "local", duplicateNote?: string | null): StageState => {
    const base: StageState =
      source === "ai"
        ? { status: "done", note: "Distilled with AI", noteTone: "ok" }
        : { status: "done", noteTone: "warn", errorHeadline: AI_UNAVAILABLE, note: "local brief shown" };
    if (!duplicateNote) return base;
    return { ...base, noteTone: "warn", note: `${base.note} · already tracked: ${duplicateNote}` };
  };

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
      const rawText = String(data.text ?? "");
      const { extracted, source, usage } = await distillJobPosting(rawText, {
        url,
        aiRequest: distillRequestFields()
      });
      const relevant = extracted.tailoringText;
      if (relevant.trim().length < 40) {
        setLinkStatus("Fetched the page, but found too little job text. Paste the description instead.");
        setDistillProgress({
          status: "failed",
          errorHeadline: "Missing input",
          error: "Too little job text on that page — paste the description instead."
        });
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
      setPipelineAiUsage(freshDistillUsage(usage));
      setJobRawText(relevant.trim() !== rawText.trim() ? rawText : "");
      const missing = compactManualReviewFields(extracted.manualReviewFields);
      setLinkStatus(
        `Distilled ${relevant.length.toLocaleString()} compact characters for tailoring and captured ${presentTrackingFields(
          extracted.tracking
        )}${missing ? `; add ${missing} manually if needed` : ""}.`
      );
      setDistillProgress(distillDoneState(source, duplicateWarnNote(url, rawText, extracted.tracking)));
    } catch (error) {
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
      const { extracted, source, usage } = await distillJobPosting(cleaned, {
        url: jobUrl.trim() || undefined,
        aiRequest: distillRequestFields()
      });
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
      setJobDescription(relevant);
      setImportedJob({
        url: jobUrl.trim(),
        tailoringText: relevant.trim(),
        tracking: extracted.tracking,
        manualReviewFields: extracted.manualReviewFields
      });
      setResult(null);
      applyCoverLetter("");
      setPipelineAiUsage(freshDistillUsage(usage));
      setJobRawText(relevant.trim() !== cleaned.trim() ? cleaned : "");
      const missing = compactManualReviewFields(extracted.manualReviewFields);
      setLinkStatus(
        `Distilled ${relevant.length.toLocaleString()} compact characters from the paste and captured ${presentTrackingFields(
          extracted.tracking
        )}${missing ? `; add ${missing} manually if needed` : ""}.`
      );
      setDistillProgress(distillDoneState(source, duplicateWarnNote(jobUrl.trim(), cleaned, extracted.tracking)));
    } catch (error) {
      // distillJobPosting is built to fall back to local rather than throw, so
      // this only fires on an unexpected error — surface it instead of leaving
      // the card stuck on "running".
      const message = error instanceof Error ? error.message.replace(/[.。]\s*$/, "") : "distillation failed";
      setLinkStatus(`Couldn't distill the paste: ${message}.`);
      const f = classifyFailure(error);
      setDistillProgress({ status: "failed", errorHeadline: f.headline, error: f.detail });
    } finally {
      setIsExtractingLink(false);
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
    const dupNote = duplicateWarnNote(trimmedUrl, rawTrimmed, localExtracted.tracking);
    setDistillProgress({
      status: "done",
      note: `AI distillation off — raw description imported${dupNote ? ` · already tracked: ${dupNote}` : ""}`,
      noteTone: dupNote ? "warn" : "ok"
    });
  }

  // Retry an extension-import distill by re-distilling its stored raw text
  // through the CLIENT /api/distill path — the extension import is event-driven
  // with nothing to re-run otherwise, so this gives its card a working Retry.
  // Imports made with AI distillation off re-run the deterministic raw-text
  // path instead: Retry must never fire an AI call the user opted out of.
  async function retryImportDistill() {
    const payload = distillImportRef.current;
    if (!payload || isExtractingLink) return;
    setIsExtractingLink(true);
    setDistillProgress({ status: "running" });
    setDistillProgressVisible(true);
    try {
      if (!payload.distillAi) {
        const rawTrimmed = payload.text.trim();
        if (rawTrimmed.length < 40) {
          setDistillProgress({
            status: "failed",
            errorHeadline: "Missing input",
            error: "Imported posting had too little job text — paste manually."
          });
          return;
        }
        applyRawImportedJob(rawTrimmed, payload.url);
        return;
      }
      const { extracted, source, usage } = await distillJobPosting(payload.text, {
        url: payload.url || undefined,
        aiRequest: distillRequestFields()
      });
      const relevant = extracted.tailoringText;
      if (relevant.trim().length < 40) {
        setDistillProgress({
          status: "failed",
          errorHeadline: "Missing input",
          error: "Imported posting had too little job text — paste manually."
        });
        return;
      }
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
      setDistillProgress(distillDoneState(source, duplicateWarnNote(payload.url, payload.text, extracted.tracking)));
    } catch (error) {
      const f = classifyFailure(error);
      setDistillProgress({ status: "failed", errorHeadline: f.headline, error: f.detail });
    } finally {
      setIsExtractingLink(false);
    }
  }

  // Auto-fill the job description from the browser extension inbox. The AI distill
  // runs HERE (client-side) with this tab's selected Distill provider; the
  // deterministic engine is the fallback.
  useExtensionInbox(
    async (item: ExtensionImport) => {
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
      distillImportRef.current = { text, url: (url || "").trim(), distillAi };

      // The user turned off AI distillation for this import (extension setting):
      // skip the AI request entirely and use the raw resolved text as the working
      // description, with tracking metadata from the deterministic engine only —
      // extractJobPosting is not an AI call.
      if (!distillAi) {
        const trimmedUrl = (url || "").trim();
        const rawTrimmed = text.trim();
        if (rawTrimmed.length < 40) {
          setPolishStatus("Extension import had too little job text — paste manually.");
          setDistillRetrySource("import");
          setDistillProgress({
            status: "failed",
            errorHeadline: "Missing input",
            error: "Imported posting had too little job text — paste manually."
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
            ? `Job imported from the browser extension — ${
                editedResume ? "set a section to Tailor" : "load a resume"
              } and it'll polish automatically.`
            : "Job imported from the browser extension."
        );
        return;
      }

      // The import distill shares the user distills' mutual exclusion (link/paste/
      // retry all early-return on isExtractingLink): claim the flag so a mid-import
      // "Distill paste" can't interleave and clobber this import's state — the
      // client distill is a full AI round-trip, so the window is real. If a user
      // distill is ALREADY in flight when the import lands, proceed without
      // claiming (delivery is once-only); overwriting the flag would let that
      // flow's finally unblock distills while this one is still running.
      const claimedDistillLock = !isExtractingLink;
      if (claimedDistillLock) setIsExtractingLink(true);
      try {
        // The client distill takes real time now (it always runs), so show the running
        // card while it works — otherwise the import lands with no visible progress.
        // (retrySource is set in each terminal branch below, before any card with Retry.)
        setDistillProgress({ status: "running" });
        setDistillProgressVisible(true);
        const { extracted, source, usage } = fields
          ? extractedFromAiOrLocal(fields as Partial<AiDistillFields>, text, url || undefined, distillRequestFields())
          : await distillJobPosting(text, {
              url: url || undefined,
              aiRequest: distillRequestFields()
            });
        const relevant = extracted.tailoringText;
        if (relevant.trim().length < 40) {
          setPolishStatus("Extension import had too little job text — paste manually.");
          setDistillRetrySource("import");
          setDistillProgress({
            status: "failed",
            errorHeadline: "Missing input",
            error: "Imported posting had too little job text — paste manually."
          });
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
        setPipelineAiUsage(freshDistillUsage(usage));
        setJobRawText(relevant.trim() !== text.trim() ? text : "");
        // Auto-tailor THIS import only, and always (re)set from the toggle so a
        // toggle-OFF import clears any stale intent a prior toggle-ON import left.
        setAutoTailorJob(autoTailor ? relevant.trim() : null);
        // The distill card now carries the AI-vs-local signal, so the status line just
        // covers import/auto-tailor context. The imported JD satisfies the
        // description-length gate; the only thing that can still defer the auto-polish
        // is a missing resume / Tailor section — say so rather than appearing to do nothing.
        // "import" keeps a Retry on the card that re-distills through the client path.
        setDistillRetrySource("import");
        setDistillProgress(distillDoneState(source, duplicateWarnNote(trimmedUrl, text, extracted.tracking)));
        setDistillProgressVisible(true);
        const readyToTailor =
          Boolean(editedResume) && Object.values(tailorModes).some((mode) => mode === "tailor");
        setPolishStatus(
          autoTailor && !readyToTailor
            ? `Job imported from the browser extension — ${
                editedResume ? "set a section to Tailor" : "load a resume"
              } and it'll polish automatically.`
            : "Job imported from the browser extension."
        );
      } finally {
        if (claimedDistillLock) setIsExtractingLink(false);
      }
    },
    () => {
      // Background server-side distill still running — surface it on the same card
      // the link/paste flows use (no Retry: an extension import has nothing to
      // re-run). Guard the running state so repeated polls don't churn renders.
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
    setDistillProgressVisible,
    distillRetry,
    handleManualJobDescriptionChange,
    handleExtractFromLink,
    handleDistillPaste
  };
}
