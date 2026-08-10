// The tab-scoped storage-key knowledge for autosave recovery drafts, shared by
// useAutosaveDraft.ts (per-tab draft lifecycle: save/recover/clear-this-tab)
// and workspacePreferencesSync.ts (adopt a workspace restore without deleting a live
// sibling's work).
// Each editor keeps its own recovery draft under its own prefix, so a resume
// draft and a cover-letter draft from the same tab never overwrite each other.
import {
  getTabId,
  liveTabIds,
  publishWorkspaceRestoreAdoption
} from "./tabPresence.ts";

const AUTOSAVE_PREFIX = {
  // Resume drafts now store strict v1 editable source so hidden/absent header
  // structure and document style survive recovery.
  resume: "rolefit:draftAutosave:v2",
  // The structural-header finalization intentionally invalidates serialized
  // drafts created against the interim `.cover` v1 document shape.
  cover: "rolefit:coverDraftAutosave:v2"
} as const;

export type AutosaveDraftKind = keyof typeof AUTOSAVE_PREFIX;

export const AUTOSAVE_DRAFT_KINDS: readonly AutosaveDraftKind[] = ["resume", "cover"];

export function keyForTab(kind: AutosaveDraftKind, tabId: string): string {
  return `${AUTOSAVE_PREFIX[kind]}:${tabId}`;
}

// The tab id encoded in a current draft key of THIS kind.
export function tabIdFromKey(kind: AutosaveDraftKind, key: string): string | null {
  const prefix = AUTOSAVE_PREFIX[kind];
  if (key.startsWith(`${prefix}:`)) return key.slice(prefix.length + 1);
  return null;
}

function isAutosaveKey(key: string): boolean {
  return AUTOSAVE_DRAFT_KINDS.some((kind) => tabIdFromKey(kind, key) !== null);
}

// Adopt a restored workspace without crossing a live session boundary. This
// tab's pre-restore drafts and dead-tab orphans are stale; a live sibling's
// in-flight edits remain owned by that sibling and are explicitly notified.
export function adoptWorkspaceRestoreDrafts(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const currentTabId = getTabId();
    const live = liveTabIds(Date.now());
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isAutosaveKey(key)) continue;
      const ownerId = AUTOSAVE_DRAFT_KINDS
        .map((kind) => tabIdFromKey(kind, key))
        .find((candidate) => candidate !== null);
      if (ownerId !== currentTabId && ownerId && live.has(ownerId)) continue;
      keys.push(key);
    }
    for (const key of keys) {
      try { localStorage.removeItem(key); } catch { /* ignore this one, keep clearing the rest */ }
    }
  } catch {
    // localStorage unavailable/blocked — no drafts to clear either way.
  } finally {
    publishWorkspaceRestoreAdoption();
  }
}
