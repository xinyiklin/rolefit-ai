// The per-tab recovery-draft lifecycle both editors share: write this tab's
// draft, clear it, and resolve which draft to offer at mount. Only the payload
// shape differs between the resume and the cover letter, so each hook supplies
// its own parser and this module owns the storage rules — tab scoping, live
// siblings, orphan migration, and expiry.

import { getTabId, liveTabIds } from "./tabPresence";
import { keyForTab, tabIdFromKey, type AutosaveDraftKind } from "./autosaveDraftRegistry.ts";

// A recovered draft from a CLOSED tab is offered for at most this long. Older
// orphans are garbage-collected rather than resurfaced.
const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;

/** Every draft carries when it was written; recovery ranks orphans by it. */
export type StoredDraft = { savedAt: string };

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

// Mount recovery. Resolves the single draft (if any) to offer the user across
// all three loss modes, then garbage-collects dead-tab orphans:
//
//   - Reload (same tab): this tab's own key still holds its draft.
//   - Close + reopen / crash: a DIFFERENT, now-dead tab's draft is the most
//     recent orphan. We migrate it into this tab's own key (so the existing
//     restore/dismiss path, which clears this tab's key, cleans it up) and
//     return it.
//   - A LIVE sibling tab's active draft is never offered or deleted — liveness
//     comes from the presence registry's heartbeats.
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

    // Scan every draft key of this kind, classifying each as own / live-sibling
    // / orphan. The other kind's keys are invisible here by construction.
    const orphanKeys: string[] = [];
    let best: { key: string; draft: T } | null = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const ownerId = tabIdFromKey(kind, key);
      if (ownerId === null || key === myKey) continue;
      // A live sibling owns this draft — leave it strictly alone.
      if (ownerId !== "" && live.has(ownerId)) continue;

      const draft = parse(localStorage.getItem(key));
      const ageMs = draft ? now - new Date(draft.savedAt).getTime() : Infinity;
      if (!draft || !(ageMs < RECOVERY_TTL_MS)) {
        orphanKeys.push(key); // invalid or expired → reclaim
        continue;
      }
      if (!best || new Date(draft.savedAt).getTime() > new Date(best.draft.savedAt).getTime()) {
        best = { key, draft };
      }
    }

    // GC expired / invalid orphans regardless of which branch we return from.
    for (const key of orphanKeys) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }

    // Reload recovery wins: keep good sibling orphans in place for a future fresh
    // tab rather than claiming them on top of our own draft.
    if (own) return own;

    if (best) {
      // Migrate the orphan into our own key so restore/dismiss (which clears our
      // key) cleans it up, and a reload of THIS tab re-offers it. (best.key is
      // always a different tab's key — the scan loop skips our own.)
      try {
        localStorage.setItem(myKey, JSON.stringify(best.draft));
        localStorage.removeItem(best.key);
      } catch {
        // If the migrate write fails we still return the draft from memory; the
        // orphan stays put and may be offered again later. Acceptable.
      }
      return best.draft;
    }

    return null;
  } catch {
    return null;
  }
}
