import { useEffect, useRef } from "react";
import { serializeResumeData, type ResumeData } from "../lib/resumeData";
import { getTabId, liveTabIds } from "../lib/tabPresence";
import type { StageAiUsage } from "../lib/aiUsage";

// localStorage key PREFIX for the autosaved draft. Each tab namespaces its draft
// under `${AUTOSAVE_PREFIX}:${tabId}` so concurrent tabs (independent tailoring
// sessions) never clobber one another's live draft. The bare prefix on its own
// is the LEGACY single-slot key from before per-tab isolation — still honored as
// a recoverable orphan so an in-flight draft survives the upgrade.
// Stores ONLY the user's own serialized resume text + a timestamp + a light
// job-target label. NO job description body, NO API keys, NO secrets.
const AUTOSAVE_PREFIX = "rolefit:draftAutosave";
const LEGACY_AUTOSAVE_KEY = AUTOSAVE_PREFIX;

// A recovered draft from a CLOSED tab is offered for at most this long. Older
// orphans are garbage-collected rather than resurfaced.
const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;

export type AutosavedDraft = {
  // Serialized resume text (plain text, same format as export/scoring).
  resumeText: string;
  // ISO timestamp of the last autosave.
  savedAt: string;
  // Light label for the job target — only the distilled role/company strings,
  // never the full JD body.
  jobLabel: string;
  // Per-stage AI usage snapshot and raw pre-distill JD text, carried so a
  // reload doesn't lose them while the resume draft itself is being recovered.
  // Both optional/omittable: an older saved draft (or one from a session that
  // never captured them) simply restores without these fields.
  pipelineAiUsage?: Record<string, StageAiUsage>;
  jobRawText?: string;
  // Compact hash of the job target's identity (URL + text prefix — see
  // useDuplicateGuard). Restores gate the provenance fields on it, because the
  // jobLabel alone (role · company) collides across reposts of the same role.
  // No JD text is stored, only the hash.
  jobKeyHash?: string;
};

function keyForTab(tabId: string): string {
  return `${AUTOSAVE_PREFIX}:${tabId}`;
}

// The tab id encoded in an autosave key, or "" for the legacy bare key. Returns
// null for keys that aren't autosave keys at all.
function tabIdFromKey(key: string): string | null {
  if (key === LEGACY_AUTOSAVE_KEY) return "";
  if (key.startsWith(`${AUTOSAVE_PREFIX}:`)) return key.slice(AUTOSAVE_PREFIX.length + 1);
  return null;
}

function parseDraft(raw: string | null): AutosavedDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AutosavedDraft>;
    if (typeof parsed.resumeText !== "string" || !parsed.resumeText.trim()) return null;
    if (typeof parsed.savedAt !== "string") return null;
    if (!Number.isFinite(Date.parse(parsed.savedAt))) return null;
    return {
      resumeText: parsed.resumeText,
      savedAt: parsed.savedAt,
      jobLabel: typeof parsed.jobLabel === "string" ? parsed.jobLabel : "",
      ...(parsed.pipelineAiUsage && typeof parsed.pipelineAiUsage === "object"
        ? { pipelineAiUsage: parsed.pipelineAiUsage }
        : {}),
      ...(typeof parsed.jobRawText === "string" ? { jobRawText: parsed.jobRawText } : {}),
      ...(typeof parsed.jobKeyHash === "string" ? { jobKeyHash: parsed.jobKeyHash } : {})
    };
  } catch {
    return null;
  }
}

// Write THIS tab's draft. Called inside a debounce, so all serialization happens
// off the hot render path.
function saveAutosaveDraft(draft: AutosavedDraft): void {
  try {
    localStorage.setItem(keyForTab(getTabId()), JSON.stringify(draft));
  } catch {
    // localStorage may be full or blocked — fail silently, never throw.
  }
}

// Clear THIS tab's draft (call on Apply / base-resume Save so a recovered draft
// doesn't reappear after the edits are safely persisted elsewhere).
export function clearAutosaveDraft(): void {
  try {
    localStorage.removeItem(keyForTab(getTabId()));
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
export function recoverAutosaveDraft(): AutosavedDraft | null {
  try {
    const myId = getTabId();
    const myKey = keyForTab(myId);
    const own = parseDraft(localStorage.getItem(myKey));

    const now = Date.now();
    const live = liveTabIds(now);

    // Scan every autosave key, classifying each as own / live-sibling / orphan.
    const orphanKeys: string[] = [];
    let best: { key: string; draft: AutosavedDraft } | null = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const ownerId = tabIdFromKey(key);
      if (ownerId === null || key === myKey) continue;
      // A live sibling owns this draft — leave it strictly alone.
      if (ownerId !== "" && live.has(ownerId)) continue;

      const draft = parseDraft(localStorage.getItem(key));
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

type UseAutosaveDraftArgs = {
  editedResume: ResumeData | null;
  dirty: boolean;
  // A short label for the current job target (role + company) — stored as
  // context only, never the full JD body.
  jobLabel: string;
  // Current per-stage AI usage + raw pre-distill JD text, saved ALONGSIDE the
  // resume draft (not a separate trigger — the effect still only fires off
  // dirty/editedResume changes, so these just ride along with whichever
  // resume-edit write already happens).
  pipelineAiUsage?: Record<string, StageAiUsage>;
  jobRawText?: string;
  // Lazy getter (not a value) so the caller can supply it regardless of hook
  // declaration order; invoked only inside the debounced write.
  getJobKeyHash?: () => string;
};

// Debounced autosave: whenever the editor has unsaved edits, write the
// serialized resume to localStorage so a reload / crash / close can recover.
// 1200 ms debounce balances responsiveness against write frequency.
export function useAutosaveDraft({ editedResume, dirty, jobLabel, pipelineAiUsage, jobRawText, getJobKeyHash }: UseAutosaveDraftArgs): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest usage/raw-text read inside the debounced write without re-triggering
  // the effect (and its debounce reset) on every distill/tailor/review tick —
  // only dirty/editedResume/jobLabel changes should reschedule the write.
  const latestExtras = useRef({ pipelineAiUsage, jobRawText, getJobKeyHash });
  latestExtras.current = { pipelineAiUsage, jobRawText, getJobKeyHash };

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
      const { pipelineAiUsage: usage, jobRawText: rawText, getJobKeyHash: getHash } = latestExtras.current;
      saveAutosaveDraft({
        resumeText,
        savedAt: new Date().toISOString(),
        jobLabel,
        ...(usage && Object.keys(usage).length ? { pipelineAiUsage: usage } : {}),
        ...(rawText ? { jobRawText: rawText } : {}),
        ...(getHash ? { jobKeyHash: getHash() } : {})
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
