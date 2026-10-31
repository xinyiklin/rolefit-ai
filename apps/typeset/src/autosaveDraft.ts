import { parseResumeFile, type ParsedResumeFile } from "@typeset/engine/lib/resumeFile.ts";

export const AUTOSAVE_KEY = "typeset-resume.autosave.v2";
export const DOCUMENT_TITLE_KEY = "typeset-resume.documentTitle.v1";
// The most recent draft the strict parser refused (one slot). The starter
// resume autosaves over AUTOSAVE_KEY within a second of opening, so the
// refused bytes move here first.
export const UNREADABLE_AUTOSAVE_KEY = "typeset-resume.autosave.v2.unreadable";

export type AutosavedDraft =
  | { kind: "none" }
  // Storage refused to be read (blocked site data), so no draft was read.
  | { kind: "unavailable" }
  | { kind: "restored"; parsed: ParsedResumeFile; title: string | null }
  // `kept` is false when storage refused the copy, so the draft will be lost.
  | { kind: "unreadable"; kept: boolean };

type DraftStorage = Pick<Storage, "getItem" | "setItem">;

// Tabs share one draft slot. A `storage` event names another tab's write, so a
// different draft or title (or a cleared store) means this tab's work is no
// longer kept. A title-only rename re-saves identical draft bytes, which fires
// no event, so the title key must be checked on its own.
export function draftReplacedElsewhere(
  event: Pick<StorageEvent, "key" | "newValue">,
  lastWrittenDraft: string | null,
  lastWrittenTitle: string | null
): boolean {
  if (event.key === null) return true;
  if (event.key === AUTOSAVE_KEY) return event.newValue !== lastWrittenDraft;
  return event.key === DOCUMENT_TITLE_KEY && event.newValue !== lastWrittenTitle;
}

// Browser drafts and disk files share one strict validation path so corrupt or
// manually edited state never reaches the editor reducer. Storage is opened
// here because blocked site data throws on the `localStorage` getter itself.
export function restoreAutosavedDraft(openStorage: () => DraftStorage): AutosavedDraft {
  let storage: DraftStorage;
  let autosave: string | null;
  let title: string | null;
  try {
    storage = openStorage();
    autosave = storage.getItem(AUTOSAVE_KEY);
    title = storage.getItem(DOCUMENT_TITLE_KEY);
  } catch {
    return { kind: "unavailable" };
  }
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
  return { kind: "restored", parsed, title };
}
