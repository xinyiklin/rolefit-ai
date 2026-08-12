// Shared same-tab recovery storage for resume and cover-letter drafts. Each
// hook supplies its parser; this module owns isolation and expiry.

import { getTabId, liveTabIds } from "./tabPresence.ts";
import { keyForTab, tabIdFromKey, type AutosaveDraftKind } from "./autosaveDraftRegistry.ts";

// localStorage has no native TTL, so recovery enforces one on read.
const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;

export type StoredDraft = { savedAt: string };

function draftIsFresh(draft: StoredDraft | null, now: number): boolean {
  if (!draft) return false;
  const savedAt = Date.parse(draft.savedAt);
  return Number.isFinite(savedAt) && now - savedAt < RECOVERY_TTL_MS;
}

export function saveTabDraft<T extends StoredDraft>(kind: AutosaveDraftKind, draft: T): boolean {
  try {
    localStorage.setItem(keyForTab(kind, getTabId()), JSON.stringify(draft));
    return true;
  } catch {
    // localStorage may be full or blocked. The hooks expose this failure beside
    // the document title without logging private document content.
    return false;
  }
}

// Clear THIS tab's draft of one kind (call once its content is safely persisted
// elsewhere — Apply, a workspace save, or an explicit dismiss).
export function clearTabDraft(kind: AutosaveDraftKind): void {
  try {
    localStorage.removeItem(keyForTab(kind, getTabId()));
  } catch {
    // No-op.
  }
}

// Offer only this tab's fresh entry. Reclaim invalid or expired dead-tab data;
// leave fresh and live-sibling entries untouched.
export function recoverTabDraft<T extends StoredDraft>(
  kind: AutosaveDraftKind,
  parse: (raw: string | null) => T | null
): T | null {
  try {
    const myId = getTabId();
    const myKey = keyForTab(kind, myId);
    const own = parse(localStorage.getItem(myKey));
    const now = Date.now();
    const live = liveTabIds(now);

    // The other document kind and all non-recovery localStorage are invisible
    // here by construction. Collect before removing so iteration stays stable.
    const expiredKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const ownerId = tabIdFromKey(kind, key);
      if (ownerId === null || key === myKey) continue;
      if (live.has(ownerId)) continue;

      const draft = parse(localStorage.getItem(key));
      if (!draftIsFresh(draft, now)) expiredKeys.push(key);
    }
    for (const key of expiredKeys) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }

    if (!draftIsFresh(own, now)) {
      // Invalid/expired current-tab data is one exact recovery key, not a
      // localStorage-wide wipe.
      if (localStorage.getItem(myKey) !== null) localStorage.removeItem(myKey);
      return null;
    }
    return own;
  } catch {
    return null;
  }
}
