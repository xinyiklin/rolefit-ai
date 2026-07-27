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
  resume: "rolefit:draftAutosave",
  cover: "rolefit:coverDraftAutosave"
} as const;

export type AutosaveDraftKind = keyof typeof AUTOSAVE_PREFIX;

export const AUTOSAVE_DRAFT_KINDS: readonly AutosaveDraftKind[] = ["resume", "cover"];

// The bare resume prefix on its own is the LEGACY single-slot key from before
// per-tab isolation — still a recognized autosave key so an old orphaned draft
// is still discoverable/clearable. The cover-letter draft postdates per-tab
// isolation and has no legacy form.
const LEGACY_AUTOSAVE_KEY = AUTOSAVE_PREFIX.resume;

export function keyForTab(kind: AutosaveDraftKind, tabId: string): string {
  return `${AUTOSAVE_PREFIX[kind]}:${tabId}`;
}

// The tab id encoded in a draft key of THIS kind, or "" for the legacy bare
// key. Returns null for keys that aren't this kind's autosave keys at all.
export function tabIdFromKey(kind: AutosaveDraftKind, key: string): string | null {
  if (kind === "resume" && key === LEGACY_AUTOSAVE_KEY) return "";
  const prefix = AUTOSAVE_PREFIX[kind];
  if (key.startsWith(`${prefix}:`)) return key.slice(prefix.length + 1);
  return null;
}

function isAutosaveKey(key: string): boolean {
  return AUTOSAVE_DRAFT_KINDS.some((kind) => tabIdFromKey(kind, key) !== null);
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
