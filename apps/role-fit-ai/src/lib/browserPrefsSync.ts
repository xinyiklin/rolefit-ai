// Browser <-> companion preference mirror.
//
// The Electron companion now owns the backup/restore UI and the workspace-
// resident copy of allowlisted browser preferences. This module is the
// browser's half of that contract:
//
//   1. Mirror allowlisted local preferences (settings + last selected base
//      resume) to the server on every change, so a companion-driven backup can
//      include them (scheduleMirrorPush).
//   2. On boot, adopt whatever the server holds: either a restore the
//      companion staged, or — when THIS origin has no local preferences of its
//      own yet — the last mirrored/restored state, so switching origins/ports
//      doesn't look like a blank install (adoptWorkspacePreferences).
//
// Import-cycle note: this module needs loadSettings/normalizeSettings from
// settings.ts and loadLastBaseResumeName from baseResumePrefs.ts. Those two
// modules' saveX() functions need to call back into this module (to schedule a
// mirror push) after a successful write — a direct import of this module from
// either would import loadSettings/loadLastBaseResumeName straight back out of
// this file and cycle. Each exposes a settable listener instead
// (setSettingsSaveListener / setLastBaseResumeSaveListener); this module is the
// one side that knows about both stores, so it registers itself as that
// listener below, on load. Whatever entry point imports this file first
// (main.tsx, ahead of any save call) wires the mirror before it's needed.

import {
  hasStoredSettings,
  loadSettings,
  normalizeSettings,
  saveSettings,
  setSettingsSaveListener
} from "./settings.ts";
import {
  loadLastBaseResumeName,
  saveLastBaseResumeName,
  setLastBaseResumeSaveListener
} from "./baseResumePrefs.ts";
import { clearAllAutosaveDrafts } from "./autosaveDraftRegistry.ts";

const MIRROR_PUSH_DEBOUNCE_MS = 1500;
const ADOPT_FETCH_TIMEOUT_MS = 1500;
// Distinct from applications.json / workspace storage — this is a browser-only
// marker of which server-side "restore" this origin has already adopted, so a
// reload doesn't re-clear drafts for a restore it already applied.
const ADOPTED_RESTORE_STAMP_KEY = "rolefit:adoptedRestoreStamp";

// ---------------------------------------------------------------------------
// 1. Mirror push
// ---------------------------------------------------------------------------

let mirrorPushTimer: ReturnType<typeof setTimeout> | null = null;
// Set for the duration of adoptWorkspacePreferences()'s own saveSettings/
// saveLastBaseResumeName calls, so adopting on boot doesn't immediately
// schedule a pointless push of the exact data just pulled.
let suppressMirrorPush = false;

// Debounced, fire-and-forget mirror of the current settings + last base resume
// to the server. Failures are silent-but-bounded: nothing retries on a timer,
// so a down/unreachable server never becomes a retry storm — the next local
// settings/base-resume change simply reschedules a fresh attempt.
export function scheduleMirrorPush(): void {
  if (suppressMirrorPush) return;
  if (typeof fetch === "undefined") return;
  if (mirrorPushTimer !== null) clearTimeout(mirrorPushTimer);
  mirrorPushTimer = setTimeout(() => {
    mirrorPushTimer = null;
    void pushPreferencesNow();
  }, MIRROR_PUSH_DEBOUNCE_MS);
}

async function pushPreferencesNow(): Promise<void> {
  try {
    await fetch("/api/workspace/browser-preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: normalizeSettings(loadSettings()),
        lastBaseResume: loadLastBaseResumeName()
      })
    });
  } catch {
    // Fire-and-forget — see the module comment above.
  }
}

setSettingsSaveListener(scheduleMirrorPush);
setLastBaseResumeSaveListener(scheduleMirrorPush);

// ---------------------------------------------------------------------------
// 2. Adoption decision (pure — probed directly by the offline eval)
// ---------------------------------------------------------------------------

export type ServerPreferencesState =
  | { exists: false; restoreStamp: string | null }
  | {
      exists: true;
      source: "mirror" | "restore";
      updatedAt: string;
      settings: Record<string, unknown>;
      lastBaseResume: string;
      restoreStamp: string | null;
    };

export type LocalAdoptionState = {
  // No "rolefit:settings" key AND no stored last base resume — i.e. this
  // origin has never saved anything of its own yet.
  hasLocalSettings: boolean;
  // The updatedAt of the last server "restore" this origin has already
  // adopted, or null if it has never adopted one.
  adoptedRestoreStamp: string | null;
};

export type AdoptionDecision =
  | { action: "noop" }
  | { action: "clear-drafts"; writeStamp: string }
  | { action: "adopt"; clearDrafts: boolean; writeStamp: string | null };

// a. A restore this origin hasn't adopted yet wins outright: apply it and
//    clear every autosave draft, which belongs to the pre-restore world.
// b. Otherwise, an origin with no local preferences of its own (new
//    companion port, or storage was cleared) adopts whatever the server has —
//    mirror or restore — for continuity, without touching drafts, and without
//    writing the restore stamp unless the adopted state actually is a restore.
// c. Anything else (an origin that already has its own preferences, or a
//    restore it already adopted) is a no-op.
export function decideAdoption(server: ServerPreferencesState, local: LocalAdoptionState): AdoptionDecision {
  if (server.restoreStamp && server.restoreStamp !== local.adoptedRestoreStamp) {
    return server.exists && server.source === "restore"
      ? { action: "adopt", clearDrafts: true, writeStamp: server.restoreStamp }
      : { action: "clear-drafts", writeStamp: server.restoreStamp };
  }
  if (!server.exists) return { action: "noop" };
  if (!local.hasLocalSettings) {
    return {
      action: "adopt",
      clearDrafts: false,
      writeStamp: server.source === "restore" ? server.restoreStamp ?? server.updatedAt : null
    };
  }
  return { action: "noop" };
}

// ---------------------------------------------------------------------------
// 3. Boot-time fetch + apply
// ---------------------------------------------------------------------------

// Defensive coercion, not validation — an unexpected shape (server not yet
// updated, a proxy stripping fields, hand-edited response in a debugger) is
// treated as "nothing to adopt" rather than thrown. Exported (alongside
// decideAdoption) so the offline eval can probe malformed-payload handling
// directly instead of mocking fetch.
export function parseServerPreferencesResponse(payload: unknown): ServerPreferencesState {
  if (!payload || typeof payload !== "object") return { exists: false, restoreStamp: null };
  const value = payload as Record<string, unknown>;
  const explicitRestoreStamp = typeof value.restoreStamp === "string" && Number.isFinite(Date.parse(value.restoreStamp))
    ? value.restoreStamp
    : null;
  if (value.exists !== true) return { exists: false, restoreStamp: explicitRestoreStamp };
  if (
    (value.source !== "mirror" && value.source !== "restore")
    || typeof value.updatedAt !== "string"
    || !Number.isFinite(Date.parse(value.updatedAt))
    || !value.settings || typeof value.settings !== "object" || Array.isArray(value.settings)
    || typeof value.lastBaseResume !== "string"
  ) {
    return { exists: false, restoreStamp: explicitRestoreStamp };
  }
  const restoreStamp = explicitRestoreStamp ?? (value.source === "restore" ? value.updatedAt : null);
  return {
    exists: true,
    source: value.source,
    updatedAt: value.updatedAt,
    settings: value.settings as Record<string, unknown>,
    lastBaseResume: value.lastBaseResume,
    restoreStamp
  };
}

function readAdoptedRestoreStamp(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(ADOPTED_RESTORE_STAMP_KEY);
  } catch {
    return null;
  }
}

function writeAdoptedRestoreStamp(stamp: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ADOPTED_RESTORE_STAMP_KEY, stamp);
  } catch {
    // Storage unavailable — the next boot just re-adopts the same restore,
    // which is idempotent (same settings/lastBaseResume, one extra draft clear).
  }
}

function hasLocalPreferences(): boolean {
  return hasStoredSettings() || Boolean(loadLastBaseResumeName());
}

// Boot-time preference adoption. Fails open: any fetch error, timeout, or
// malformed response leaves local preferences untouched and the caller
// continues to first render — this is a convenience sync, never a hard
// dependency for boot. Call once, before first render, after any pre-render
// storage migration (see main.tsx).
export async function adoptWorkspacePreferences(): Promise<void> {
  if (typeof fetch === "undefined") return;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ADOPT_FETCH_TIMEOUT_MS) : null;
  let server: ServerPreferencesState;
  try {
    const response = await fetch("/api/workspace/browser-preferences", {
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!response.ok) return;
    server = parseServerPreferencesResponse(await response.json());
  } catch {
    return;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const decision = decideAdoption(server, {
    hasLocalSettings: hasLocalPreferences(),
    adoptedRestoreStamp: readAdoptedRestoreStamp()
  });
  if (decision.action === "noop") return;

  if (decision.action === "clear-drafts") {
    clearAllAutosaveDrafts();
    writeAdoptedRestoreStamp(decision.writeStamp);
    return;
  }
  if (!server.exists) return;

  suppressMirrorPush = true;
  try {
    saveSettings(normalizeSettings(server.settings));
    saveLastBaseResumeName(server.lastBaseResume);
    if (decision.clearDrafts) clearAllAutosaveDrafts();
    if (decision.writeStamp) writeAdoptedRestoreStamp(decision.writeStamp);
  } finally {
    suppressMirrorPush = false;
  }
}
