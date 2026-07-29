import { useEffect, useRef, useState } from "react";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import type { DocStyle } from "@typeset/engine/lib/documentStyle.ts";
import { serializeResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import type { StageAiUsage } from "../lib/aiUsage";
import {
  parseResumeAutosaveDraft,
  type AutosavedDraft
} from "../lib/resumeAutosaveDraft.ts";
import { clearTabDraft, recoverTabDraft, saveTabDraft } from "../lib/autosaveDraftStorage.ts";

export { parseResumeAutosaveDraft };
export type { AutosavedDraft };

// The RESUME recovery draft. Tab scoping, live-sibling protection, orphan
// migration, and expiry live in lib/autosaveDraftStorage.ts, which the cover
// letter's draft shares; only the payload below is resume-specific.
// Stores strict editable resume source, a timestamp, a light job-target label,
// and optional recovery-only raw job text / AI-usage snapshot. API keys and
// provider credentials are never stored here.

// Clear THIS tab's resume draft (call on Apply / base-resume Save so a
// recovered draft doesn't reappear after the edits are safely persisted
// elsewhere).
export function clearAutosaveDraft(): void {
  clearTabDraft("resume");
}

export function recoverAutosaveDraft(): AutosavedDraft | null {
  return recoverTabDraft("resume", parseResumeAutosaveDraft);
}

type UseAutosaveDraftArgs = {
  editedResume: ResumeData | null;
  docStyle: DocStyle;
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

export function useAutosaveDraft({ editedResume, docStyle, dirty, jobLabel, pipelineAiUsage, jobRawText, getJobKeyHash }: UseAutosaveDraftArgs): DraftAutosaveState {
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
      try {
        const resumeSource = serializeResumeFile(editedResume, docStyle);
        const {
          pipelineAiUsage: usage,
          jobRawText: rawText,
          getJobKeyHash: getHash
        } = latestExtras.current;
        const saved = saveTabDraft("resume", {
          resumeSource,
          savedAt: new Date().toISOString(),
          jobLabel,
          ...(usage && Object.keys(usage).length
            ? { pipelineAiUsage: usage }
            : {}),
          ...(rawText ? { jobRawText: rawText } : {}),
          ...(getHash ? { jobKeyHash: getHash() } : {})
        });
        setState(saved ? "saved" : "error");
      } catch {
        // Invalid in-memory document state must not escape an async timer or
        // advertise a recovery draft the strict parser cannot reopen.
        setState("error");
      }
    }, 1200);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [editedResume, docStyle, dirty, jobLabel]);

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
