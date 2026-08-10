/**
 * The COVER LETTER recovery draft — the resume's `useAutosaveDraft` behavior for
 * the other editor, so both pages recover the same way after a reload, crash, or
 * accidental close instead of one of them merely warning that it is unsaved.
 *
 * The payload is the serialized `.cover` file the editor already computes for
 * its dirty check, so a restore brings back the document AND its style rather
 * than flattened text. Tab scoping, live-sibling protection, orphan migration,
 * and expiry are shared with the resume draft (lib/autosaveDraftStorage.ts).
 * No job description body, API key, or provider credential is ever stored.
 */
import { useMemo } from "react";

import { parseCoverLetterFile } from "@typeset/engine/lib/coverLetter.ts";
import { clearTabDraft, recoverTabDraft, saveTabDraft } from "../lib/autosaveDraftStorage.ts";
import type { DraftAutosaveState } from "./useAutosaveDraft";
import { useDebouncedRecoveryDraft } from "./useDebouncedRecoveryDraft.ts";

export type CoverLetterAutosavedDraft = {
  // Serialized `.cover` payload (document + style), the same format the
  // workspace and the file download use.
  coverPayload: string;
  // The document title at the time of the save, restored with the letter so the
  // recovered draft keeps its name.
  documentTitle: string;
  savedAt: string;
  // Light label for the job target — only the analyzed role/company strings,
  // never the full JD body.
  jobLabel: string;
};

function parseDraft(raw: string | null): CoverLetterAutosavedDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CoverLetterAutosavedDraft>;
    if (typeof parsed.coverPayload !== "string" || !parsed.coverPayload.trim()) return null;
    parseCoverLetterFile(parsed.coverPayload);
    if (typeof parsed.savedAt !== "string") return null;
    if (!Number.isFinite(Date.parse(parsed.savedAt))) return null;
    return {
      coverPayload: parsed.coverPayload,
      documentTitle: typeof parsed.documentTitle === "string" ? parsed.documentTitle : "",
      savedAt: parsed.savedAt,
      jobLabel: typeof parsed.jobLabel === "string" ? parsed.jobLabel : ""
    };
  } catch {
    return null;
  }
}

export function clearCoverLetterAutosaveDraft(): void {
  clearTabDraft("cover");
}

export function recoverCoverLetterAutosaveDraft(): CoverLetterAutosavedDraft | null {
  return recoverTabDraft("cover", parseDraft);
}

type UseCoverLetterAutosaveDraftArgs = {
  // The editor's serialized `.cover` payload, or null when no document is loaded.
  payload: string | null;
  documentTitle: string;
  recoveryDirty: boolean;
  jobLabel: string;
};

// Same 1200 ms debounce as the resume draft, so the two editors report their
// recovery state on the same rhythm.
export function useCoverLetterAutosaveDraft({
  payload,
  documentTitle,
  recoveryDirty,
  jobLabel
}: UseCoverLetterAutosaveDraftArgs): DraftAutosaveState {
  const revision = useMemo(
    () => ({ payload, documentTitle, recoveryDirty, jobLabel }),
    [documentTitle, jobLabel, payload, recoveryDirty]
  );
  return useDebouncedRecoveryDraft({
    shouldSave: payload !== null && recoveryDirty,
    revision,
    save: () =>
      payload !== null &&
      saveTabDraft("cover", {
        coverPayload: payload,
        documentTitle,
        savedAt: new Date().toISOString(),
        jobLabel
      })
  });
}
