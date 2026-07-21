// The tab-scoped storage-key knowledge for autosave recovery drafts, shared by
// useAutosaveDraft.ts (per-tab draft lifecycle: save/recover/clear-this-tab)
// and browserPrefsSync.ts (clear-every-tab after a workspace restore is
// adopted). Kept dependency-free — no React, no tabPresence, no resume
// serialization — so a lib module that must load before first render never
// pulls in the editor/document chain just to know which localStorage keys
// belong to autosave drafts.
const AUTOSAVE_PREFIX = "rolefit:draftAutosave";
// The bare prefix on its own is the LEGACY single-slot key from before per-tab
// isolation — still a recognized autosave key so an old orphaned draft is
// still discoverable/clearable.
const LEGACY_AUTOSAVE_KEY = AUTOSAVE_PREFIX;

export function keyForTab(tabId: string): string {
  return `${AUTOSAVE_PREFIX}:${tabId}`;
}

// The tab id encoded in an autosave key, or "" for the legacy bare key. Returns
// null for keys that aren't autosave keys at all.
export function tabIdFromKey(key: string): string | null {
  if (key === LEGACY_AUTOSAVE_KEY) return "";
  if (key.startsWith(`${AUTOSAVE_PREFIX}:`)) return key.slice(AUTOSAVE_PREFIX.length + 1);
  return null;
}

// Clear EVERY tab's autosave draft — this tab's own key plus any sibling/orphan
// keys. Used only after a restored workspace is adopted: a restore supersedes
// every draft that existed before it, including a live sibling tab's in-flight
// edits, which is why this differs from the single-tab clear used by the
// ordinary Apply/Save paths.
export function clearAllAutosaveDrafts(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && tabIdFromKey(key) !== null) keys.push(key);
    }
    for (const key of keys) {
      try { localStorage.removeItem(key); } catch { /* ignore this one, keep clearing the rest */ }
    }
  } catch {
    // localStorage unavailable/blocked — no drafts to clear either way.
  }
}
