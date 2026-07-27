import { useEffect, useRef, useState } from "react";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { serializeResumeData } from "../lib/resumeText";
import type { StageAiUsage } from "../lib/aiUsage";
import { clearTabDraft, recoverTabDraft, saveTabDraft } from "../lib/autosaveDraftStorage.ts";

// The RESUME recovery draft. Tab scoping, live-sibling protection, orphan
// migration, and expiry live in lib/autosaveDraftStorage.ts, which the cover
// letter's draft shares; only the payload below is resume-specific.
// Stores the user's serialized resume text, timestamp, light job-target label,
// and optional recovery-only raw job text / AI-usage snapshot. API keys and
// provider credentials are never stored here.

export type AutosavedDraft = {
  // Serialized resume text (plain text, same format as export/scoring).
  resumeText: string;
  // ISO timestamp of the last autosave.
  savedAt: string;
  // Light label for the job target — only the distilled role/company strings,
  // never the full JD body.
  jobLabel: string;
  // Per-stage AI usage snapshot and raw pre-distill JD text, carried so a
  // reload doesn't lose them while the resume draft itself is being recovered.
  // Both optional/omittable: an older saved draft (or one from a session that
  // never captured them) simply restores without these fields.
  pipelineAiUsage?: Record<string, StageAiUsage>;
  jobRawText?: string;
  // Compact hash of the job target's identity (URL + text prefix — see
  // useDuplicateGuard). Restores gate the provenance fields on it, because the
  // jobLabel alone (role · company) collides across reposts of the same role.
  // No JD text is stored, only the hash.
  jobKeyHash?: string;
};

function parseDraft(raw: string | null): AutosavedDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AutosavedDraft>;
    if (typeof parsed.resumeText !== "string" || !parsed.resumeText.trim()) return null;
    if (typeof parsed.savedAt !== "string") return null;
    if (!Number.isFinite(Date.parse(parsed.savedAt))) return null;
    return {
      resumeText: parsed.resumeText,
      savedAt: parsed.savedAt,
      jobLabel: typeof parsed.jobLabel === "string" ? parsed.jobLabel : "",
      ...(parsed.pipelineAiUsage && typeof parsed.pipelineAiUsage === "object"
        ? { pipelineAiUsage: parsed.pipelineAiUsage }
        : {}),
      ...(typeof parsed.jobRawText === "string" ? { jobRawText: parsed.jobRawText } : {}),
      ...(typeof parsed.jobKeyHash === "string" ? { jobKeyHash: parsed.jobKeyHash } : {})
    };
  } catch {
    return null;
  }
}

// Clear THIS tab's resume draft (call on Apply / base-resume Save so a
// recovered draft doesn't reappear after the edits are safely persisted
// elsewhere).
export function clearAutosaveDraft(): void {
  clearTabDraft("resume");
}

export function recoverAutosaveDraft(): AutosavedDraft | null {
  return recoverTabDraft("resume", parseDraft);
}

type UseAutosaveDraftArgs = {
  editedResume: ResumeData | null;
  dirty: boolean;
  // A short label for the current job target (role + company) — stored as
  // context only, never the full JD body.
  jobLabel: string;
  // Current per-stage AI usage + raw pre-distill JD text, saved ALONGSIDE the
  // resume draft (not a separate trigger — the effect still only fires off
  // dirty/editedResume changes, so these just ride along with whichever
  // resume-edit write already happens).
  pipelineAiUsage?: Record<string, StageAiUsage>;
  jobRawText?: string;
  // Lazy getter (not a value) so the caller can supply it regardless of hook
  // declaration order; invoked only inside the debounced write.
  getJobKeyHash?: () => string;
};

// Debounced autosave: whenever the editor has unsaved edits, write the
// serialized resume to localStorage so a reload / crash / close can recover.
// 1200 ms debounce balances responsiveness against write frequency.
export type DraftAutosaveState = "idle" | "pending" | "saved" | "error";

export function useAutosaveDraft({ editedResume, dirty, jobLabel, pipelineAiUsage, jobRawText, getJobKeyHash }: UseAutosaveDraftArgs): DraftAutosaveState {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<DraftAutosaveState>("idle");
  // Latest usage/raw-text read inside the debounced write without re-triggering
  // the effect (and its debounce reset) on every distill/tailor/review tick —
  // only dirty/editedResume/jobLabel changes should reschedule the write.
  const latestExtras = useRef({ pipelineAiUsage, jobRawText, getJobKeyHash });
  latestExtras.current = { pipelineAiUsage, jobRawText, getJobKeyHash };

  useEffect(() => {
    // Only autosave when there are actual unsaved edits.
    if (!dirty || !editedResume) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setState("idle");
      return;
    }

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setState("pending");
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const resumeText = serializeResumeData(editedResume);
      // Nothing to persist (all content deleted): settle the indicator instead
      // of leaving it on "pending" for a save that will never happen.
      if (!resumeText.trim()) {
        setState("idle");
        return;
      }
      const { pipelineAiUsage: usage, jobRawText: rawText, getJobKeyHash: getHash } = latestExtras.current;
      const saved = saveTabDraft("resume", {
        resumeText,
        savedAt: new Date().toISOString(),
        jobLabel,
        ...(usage && Object.keys(usage).length ? { pipelineAiUsage: usage } : {}),
        ...(rawText ? { jobRawText: rawText } : {}),
        ...(getHash ? { jobKeyHash: getHash() } : {})
      });
      setState(saved ? "saved" : "error");
    }, 1200);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [editedResume, dirty, jobLabel]);

  return state;
}

// beforeunload guard: warn before closing when there are unsaved edits.
// Uses a ref to track the latest dirty value so the handler doesn't need to
// be re-registered on every dirty change.
export function useBeforeUnloadGuard(dirty: boolean): void {
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      // Setting returnValue triggers the browser's built-in "Leave?" dialog.
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);
}
