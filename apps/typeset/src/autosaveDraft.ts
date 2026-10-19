import { parseResumeFile, type ParsedResumeFile } from "@typeset/engine/lib/resumeFile.ts";

export const AUTOSAVE_KEY = "typeset-resume.autosave.v2";
export const DOCUMENT_TITLE_KEY = "typeset-resume.documentTitle.v1";
// The most recent draft the strict parser refused (one slot). The starter
// resume autosaves over AUTOSAVE_KEY within a second of opening, so the
// refused bytes move here first.
export const UNREADABLE_AUTOSAVE_KEY = "typeset-resume.autosave.v2.unreadable";

export type AutosavedDraft =
  | { kind: "none" }
  | { kind: "restored"; parsed: ParsedResumeFile; title: string | null }
  // `kept` is false when storage refused the copy, so the draft will be lost.
  | { kind: "unreadable"; kept: boolean };

type DraftStorage = Pick<Storage, "getItem" | "setItem">;

// Tabs share one draft slot. A `storage` event names another tab's write, so a
// different draft (or a cleared store) means this tab's work is no longer kept.
export function draftReplacedElsewhere(
  event: Pick<StorageEvent, "key" | "newValue">,
  lastWrittenDraft: string | null
): boolean {
  return event.key === null || (event.key === AUTOSAVE_KEY && event.newValue !== lastWrittenDraft);
}

// Browser drafts and disk files share one strict validation path so corrupt or
// manually edited state never reaches the editor reducer.
export function restoreAutosavedDraft(storage: DraftStorage): AutosavedDraft {
  const autosave = storage.getItem(AUTOSAVE_KEY);
  if (!autosave) return { kind: "none" };
  let parsed: ParsedResumeFile;
  try {
    parsed = parseResumeFile(autosave);
  } catch {
    try {
      storage.setItem(UNREADABLE_AUTOSAVE_KEY, autosave);
    } catch {
      return { kind: "unreadable", kept: false };
    }
    return { kind: "unreadable", kept: true };
  }
  return { kind: "restored", parsed, title: storage.getItem(DOCUMENT_TITLE_KEY) };
}
