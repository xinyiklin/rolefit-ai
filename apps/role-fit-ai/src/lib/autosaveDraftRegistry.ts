// The tab-scoped storage-key knowledge for autosave recovery drafts, shared by
// useAutosaveDraft.ts (per-tab draft lifecycle: save/recover/clear-this-tab)
// and browserPrefsSync.ts (clear-every-tab after a workspace restore is
// adopted). Kept dependency-free — no React, no tabPresence, no resume
// serialization — so a lib module that must load before first render never
// pulls in the editor/document chain just to know which localStorage keys
// belong to autosave drafts.
// Each editor keeps its own recovery draft under its own prefix, so a resume
// draft and a cover-letter draft from the same tab never overwrite each other.
const AUTOSAVE_PREFIX = {
  // Resume drafts now store strict v1 editable source so hidden/absent header
  // structure and document style survive recovery.
  resume: "rolefit:draftAutosave:v2",
  // The structural-header finalization intentionally invalidates serialized
  // drafts created against the interim `.cover` v1 document shape.
  cover: "rolefit:coverDraftAutosave:v2"
} as const;
const RETIRED_COVER_AUTOSAVE_PREFIX = "rolefit:coverDraftAutosave";
const RETIRED_RESUME_AUTOSAVE_PREFIX = "rolefit:draftAutosave";

export type AutosaveDraftKind = keyof typeof AUTOSAVE_PREFIX;

export const AUTOSAVE_DRAFT_KINDS: readonly AutosaveDraftKind[] = ["resume", "cover"];

export function keyForTab(kind: AutosaveDraftKind, tabId: string): string {
  return `${AUTOSAVE_PREFIX[kind]}:${tabId}`;
}

// The tab id encoded in a draft key of THIS kind, or "" for the pre-tab resume
// key. Retired resume keys remain discoverable so recovery can migrate their
// payload into strict v1 source; retired cover drafts used an incompatible
// interim schema and remain clear-only.
export function tabIdFromKey(kind: AutosaveDraftKind, key: string): string | null {
  const prefix = AUTOSAVE_PREFIX[kind];
  if (key.startsWith(`${prefix}:`)) return key.slice(prefix.length + 1);
  if (kind === "resume") {
    if (key === RETIRED_RESUME_AUTOSAVE_PREFIX) return "";
    if (key.startsWith(`${RETIRED_RESUME_AUTOSAVE_PREFIX}:`)) {
      return key.slice(RETIRED_RESUME_AUTOSAVE_PREFIX.length + 1);
    }
  }
  return null;
}

function isAutosaveKey(key: string): boolean {
  return AUTOSAVE_DRAFT_KINDS.some((kind) => tabIdFromKey(kind, key) !== null)
    || key === RETIRED_COVER_AUTOSAVE_PREFIX
    || key.startsWith(`${RETIRED_COVER_AUTOSAVE_PREFIX}:`)
    || key === RETIRED_RESUME_AUTOSAVE_PREFIX
    || key.startsWith(`${RETIRED_RESUME_AUTOSAVE_PREFIX}:`);
}

// Clear EVERY tab's autosave draft, of every kind — this tab's own keys plus
// any sibling/orphan keys. Used only after a restored workspace is adopted: a
// restore supersedes every draft that existed before it, including a live
// sibling tab's in-flight edits, which is why this differs from the single-tab
// clear used by the ordinary Apply/Save paths.
export function clearAllAutosaveDrafts(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isAutosaveKey(key)) keys.push(key);
    }
    for (const key of keys) {
      try { localStorage.removeItem(key); } catch { /* ignore this one, keep clearing the rest */ }
    }
  } catch {
    // localStorage unavailable/blocked — no drafts to clear either way.
  }
}
