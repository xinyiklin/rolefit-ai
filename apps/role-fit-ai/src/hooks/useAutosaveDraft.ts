import { useEffect, useMemo, useRef } from "react";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import type { DocStyle } from "@typeset/engine/lib/documentStyle.ts";
import { serializeResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import type { StageAiUsage } from "../lib/aiUsage";
import type { ResumeOrigin } from "../lib/resumeOrigin.ts";
import {
  parseResumeAutosaveDraft,
  type AutosavedDraft
} from "../lib/resumeAutosaveDraft.ts";
import { clearTabDraft, recoverTabDraft, saveTabDraft } from "../lib/autosaveDraftStorage.ts";
import {
  useDebouncedRecoveryDraft,
  type DraftAutosaveState
} from "./useDebouncedRecoveryDraft.ts";

export { parseResumeAutosaveDraft };
export type { AutosavedDraft };

// The RESUME recovery draft. Tab scoping, live-sibling protection, orphan
// migration, and expiry live in lib/autosaveDraftStorage.ts, which the cover
// letter's draft shares; only the payload below is resume-specific.
// Stores strict editable resume source, its applicant-ownership origin, a
// timestamp, a light job-target label, and optional recovery-only raw job text /
// AI-usage snapshot. API keys and provider credentials are never stored here.

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
  resumeOrigin: ResumeOrigin;
  // A short label for the current job target (role + company) — stored as
  // context only, never the full JD body.
  jobLabel: string;
  // Current per-stage AI usage + raw pre-analysis JD text, saved ALONGSIDE the
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
export type { DraftAutosaveState };

export function useAutosaveDraft({ editedResume, docStyle, dirty, resumeOrigin, jobLabel, pipelineAiUsage, jobRawText, getJobKeyHash }: UseAutosaveDraftArgs): DraftAutosaveState {
  // Latest usage/raw-text read inside the debounced write without re-triggering
  // the effect (and its debounce reset) on every Job analysis/Polish/check tick —
  // only document/job-label/origin changes should reschedule the write.
  const latestExtras = useRef({ pipelineAiUsage, jobRawText, getJobKeyHash });
  latestExtras.current = { pipelineAiUsage, jobRawText, getJobKeyHash };
  const revision = useMemo(
    () => ({ editedResume, docStyle, jobLabel, resumeOrigin }),
    [docStyle, editedResume, jobLabel, resumeOrigin]
  );
  return useDebouncedRecoveryDraft({
    shouldSave: dirty && editedResume !== null,
    revision,
    save: () => {
      if (!editedResume) return false;
      const resumeSource = serializeResumeFile(editedResume, docStyle);
      const {
        pipelineAiUsage: usage,
        jobRawText: rawText,
        getJobKeyHash: getHash
      } = latestExtras.current;
      return saveTabDraft("resume", {
        resumeSource,
        resumeOrigin,
        savedAt: new Date().toISOString(),
        jobLabel,
        ...(usage && Object.keys(usage).length ? { pipelineAiUsage: usage } : {}),
        ...(rawText ? { jobRawText: rawText } : {}),
        ...(getHash ? { jobKeyHash: getHash() } : {})
      });
    }
  });
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
