import { useEffect, useRef } from "react";
import { serializeResumeData, type ResumeData } from "../lib/resumeData";

// localStorage key for the autosaved draft.
// Stores ONLY the user's own serialized resume text + a timestamp + a light
// job-target label. NO job description body, NO API keys, NO secrets.
export const AUTOSAVE_KEY = "rolefit:draftAutosave";

export type AutosavedDraft = {
  // Serialized resume text (plain text, same format as export/scoring).
  resumeText: string;
  // ISO timestamp of the last autosave.
  savedAt: string;
  // Light label for the job target — only the distilled role/company strings,
  // never the full JD body.
  jobLabel: string;
};

// Write a draft to localStorage. Called inside a debounce, so all
// serialization happens off the hot render path.
export function saveAutosaveDraft(draft: AutosavedDraft): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(draft));
  } catch {
    // localStorage may be full or blocked — fail silently, never throw.
  }
}

// Read the saved draft. Returns null if nothing is stored or the stored value
// is malformed.
export function loadAutosaveDraft(): AutosavedDraft | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AutosavedDraft>;
    if (typeof parsed.resumeText !== "string" || !parsed.resumeText.trim()) return null;
    if (typeof parsed.savedAt !== "string") return null;
    return {
      resumeText: parsed.resumeText,
      savedAt: parsed.savedAt,
      jobLabel: typeof parsed.jobLabel === "string" ? parsed.jobLabel : ""
    };
  } catch {
    return null;
  }
}

// Clear the autosave (call on Apply / base-resume Save so recovered draft
// doesn't reappear after the edits are safely persisted elsewhere).
export function clearAutosaveDraft(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // No-op.
  }
}

type UseAutosaveDraftArgs = {
  editedResume: ResumeData | null;
  dirty: boolean;
  // A short label for the current job target (role + company) — stored as
  // context only, never the full JD body.
  jobLabel: string;
};

// Debounced autosave: whenever the editor has unsaved edits, write the
// serialized resume to localStorage so a reload / crash / close can recover.
// 1200 ms debounce balances responsiveness against write frequency.
export function useAutosaveDraft({ editedResume, dirty, jobLabel }: UseAutosaveDraftArgs): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Only autosave when there are actual unsaved edits.
    if (!dirty || !editedResume) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const resumeText = serializeResumeData(editedResume);
      if (!resumeText.trim()) return;
      saveAutosaveDraft({
        resumeText,
        savedAt: new Date().toISOString(),
        jobLabel
      });
    }, 1200);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [editedResume, dirty, jobLabel]);
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
