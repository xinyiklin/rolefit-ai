// Workspace preferences are canonical; browser storage is a fail-open cache.
// Every RoleFit client attached to the same local workspace adopts the server
// copy at boot and on window focus, while local edits are debounced back to the
// owner-only workspace-preferences.json file.

import {
  hasStoredSettings,
  loadSettings,
  normalizeSettings,
  saveSettings,
  setSettingsSaveListener,
  type PersistedSettings
} from "./settings.ts";
import {
  loadLastBaseResumeName,
  saveLastBaseResumeName,
  setLastBaseResumeSaveListener
} from "./baseResumePrefs.ts";
import { adoptWorkspaceRestoreDrafts } from "./autosaveDraftRegistry.ts";

const PREFERENCES_PUSH_DEBOUNCE_MS = 1500;
const ADOPT_FETCH_TIMEOUT_MS = 1500;
const ADOPTED_RESTORE_STAMP_KEY = "rolefit:adoptedRestoreStamp";
const PREFERENCES_PUSH_PENDING_KEY = "rolefit:workspace-preferences-pending";
export const WORKSPACE_PREFERENCES_APPLIED_EVENT = "rolefit:workspace-preferences-applied";
export const WORKSPACE_PREFERENCES_STATUS_EVENT = "rolefit:workspace-preferences-status";
export type WorkspacePreferencesStatus = "idle" | "saving" | "saved" | "error";

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let suppressPush = false;
let refreshStarted = false;
let pendingSettings: PersistedSettings | null = null;
let pendingLastBaseResume: string | null = null;
let adoptionGeneration = 0;

function workspacePreferencesPushIsPending(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(PREFERENCES_PUSH_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

function markWorkspacePreferencesPushPending(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREFERENCES_PUSH_PENDING_KEY, "1");
  } catch {
    // The in-memory pending snapshots still get their normal bounded attempt.
  }
}

function clearWorkspacePreferencesPushPending(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(PREFERENCES_PUSH_PENDING_KEY);
  } catch {
    // A stale marker only causes one idempotent write on the next boot.
  }
}

// A tab can close during the debounce or while a write is in flight. Restore
// that interrupted write from the fail-open cache before any canonical GET can
// replace it with the older workspace snapshot.
if (workspacePreferencesPushIsPending()) {
  pendingSettings = normalizeSettings(loadSettings());
  pendingLastBaseResume = loadLastBaseResumeName();
}

function publishStatus(status: WorkspacePreferencesStatus): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WORKSPACE_PREFERENCES_STATUS_EVENT, { detail: status }));
}

export function scheduleWorkspacePreferencesPush(): void {
  if (suppressPush || typeof fetch === "undefined") return;
  publishStatus("saving");
  if (pushTimer !== null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushPreferencesNow();
  }, PREFERENCES_PUSH_DEBOUNCE_MS);
}

async function pushPreferencesNow(): Promise<boolean> {
  const settingsSnapshot = pendingSettings;
  const lastBaseResumeSnapshot = pendingLastBaseResume;
  try {
    const response = await fetch("/api/workspace/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: settingsSnapshot ?? normalizeSettings(loadSettings()),
        lastBaseResume: lastBaseResumeSnapshot ?? loadLastBaseResumeName()
      })
    });
    if (!response.ok) {
      publishStatus("error");
      return false;
    }
    if (pendingSettings === settingsSnapshot) pendingSettings = null;
    if (pendingLastBaseResume === lastBaseResumeSnapshot) pendingLastBaseResume = null;
    if (pendingSettings === null && pendingLastBaseResume === null) {
      clearWorkspacePreferencesPushPending();
    }
    publishStatus("saved");
    return true;
  } catch {
    // The browser cache remains usable; the next local change schedules a new
    // bounded attempt rather than starting a background retry loop.
    publishStatus("error");
    return false;
  }
}

setSettingsSaveListener((settings) => {
  if (suppressPush) return;
  pendingSettings = settings;
  markWorkspacePreferencesPushPending();
  scheduleWorkspacePreferencesPush();
});
setLastBaseResumeSaveListener((fileName) => {
  if (suppressPush) return;
  pendingLastBaseResume = fileName;
  markWorkspacePreferencesPushPending();
  scheduleWorkspacePreferencesPush();
});

export type ServerPreferencesState =
  | { exists: false; invalid: boolean; restoreStamp: string | null }
  | {
      exists: true;
      source: "workspace" | "restore";
      updatedAt: string;
      settings: Record<string, unknown>;
      lastBaseResume: string;
      restoreStamp: string | null;
    };

export type LocalAdoptionState = {
  adoptedRestoreStamp: string | null;
};

export type AdoptionDecision =
  | { action: "noop" }
  | { action: "clear-drafts"; writeStamp: string }
  | { action: "adopt"; clearDrafts: boolean; writeStamp: string | null };

// A new restore generation clears pre-restore drafts. Otherwise, an existing
// workspace record always wins over the browser cache—the key change from the
// former origin-owned mirror contract.
export function decideAdoption(server: ServerPreferencesState, local: LocalAdoptionState): AdoptionDecision {
  const unseenRestoreStamp = server.restoreStamp !== null && server.restoreStamp !== local.adoptedRestoreStamp
    ? server.restoreStamp
    : null;
  if (!server.exists) {
    return unseenRestoreStamp
      ? { action: "clear-drafts", writeStamp: unseenRestoreStamp }
      : { action: "noop" };
  }
  return {
    action: "adopt",
    clearDrafts: Boolean(unseenRestoreStamp),
    writeStamp: unseenRestoreStamp
      ? unseenRestoreStamp
      : server.source === "restore"
        ? server.restoreStamp ?? server.updatedAt
        : null
  };
}

export function parseServerPreferencesResponse(payload: unknown): ServerPreferencesState {
  if (!payload || typeof payload !== "object") {
    return { exists: false, invalid: true, restoreStamp: null };
  }
  const value = payload as Record<string, unknown>;
  const explicitRestoreStamp = typeof value.restoreStamp === "string" && Number.isFinite(Date.parse(value.restoreStamp))
    ? value.restoreStamp
    : null;
  if (value.exists !== true) {
    return {
      exists: false,
      invalid: value.exists !== false || value.invalid === true,
      restoreStamp: explicitRestoreStamp
    };
  }
  if (
    (value.source !== "workspace" && value.source !== "restore")
    || typeof value.updatedAt !== "string"
    || !Number.isFinite(Date.parse(value.updatedAt))
    || !value.settings || typeof value.settings !== "object" || Array.isArray(value.settings)
    || typeof value.lastBaseResume !== "string"
  ) {
    return { exists: false, invalid: true, restoreStamp: explicitRestoreStamp };
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
    // Re-adopting the same restore later is idempotent.
  }
}

function hasLocalPreferences(): boolean {
  return hasStoredSettings() || Boolean(loadLastBaseResumeName());
}

function notifyPreferencesApplied(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WORKSPACE_PREFERENCES_APPLIED_EVENT));
}

export async function adoptWorkspacePreferences(): Promise<void> {
  if (typeof fetch === "undefined") return;
  const generation = ++adoptionGeneration;
  // Do not let a focus refresh replace a just-edited local snapshot that is
  // still inside the debounce window. Commit it first; if that fails, retain
  // the local state and retry later instead of adopting older server data.
  if (pushTimer !== null || pendingSettings !== null || pendingLastBaseResume !== null) {
    if (pushTimer !== null) clearTimeout(pushTimer);
    pushTimer = null;
    if (!await pushPreferencesNow()) {
      scheduleWorkspacePreferencesPush();
      return;
    }
    if (generation !== adoptionGeneration) return;
  }
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ADOPT_FETCH_TIMEOUT_MS) : null;
  let server: ServerPreferencesState;
  try {
    const response = await fetch("/api/workspace/preferences", {
      ...(controller ? { signal: controller.signal } : {})
    });
    if (!response.ok) return;
    server = parseServerPreferencesResponse(await response.json());
  } catch {
    return;
  } finally {
    if (timer) clearTimeout(timer);
  }

  // Only the newest refresh may adopt. A local edit that arrived while the GET
  // was in flight keeps its pending push and wins over this older server read.
  if (
    generation !== adoptionGeneration
    || pushTimer !== null
    || pendingSettings !== null
    || pendingLastBaseResume !== null
  ) {
    return;
  }

  // A corrupt canonical record is not an empty workspace. Keep the browser
  // cache usable, surface the storage failure, and require explicit repair or
  // restore instead of silently overwriting the file with one origin's cache.
  if (!server.exists && server.invalid) {
    publishStatus("error");
    return;
  }

  const decision = decideAdoption(server, { adoptedRestoreStamp: readAdoptedRestoreStamp() });
  if (decision.action === "clear-drafts") {
    adoptWorkspaceRestoreDrafts();
    writeAdoptedRestoreStamp(decision.writeStamp);
    return;
  }
  if (decision.action === "noop") {
    // A pre-existing browser cache seeds a new workspace once. Thereafter the
    // workspace copy becomes authoritative for all origins.
    if (!server.exists && hasLocalPreferences() && !await pushPreferencesNow()) {
      scheduleWorkspacePreferencesPush();
    }
    return;
  }
  if (!server.exists) return;

  suppressPush = true;
  try {
    saveSettings(normalizeSettings(server.settings));
    saveLastBaseResumeName(server.lastBaseResume);
    if (decision.clearDrafts) adoptWorkspaceRestoreDrafts();
    if (decision.writeStamp) writeAdoptedRestoreStamp(decision.writeStamp);
    notifyPreferencesApplied();
    publishStatus("saved");
  } finally {
    suppressPush = false;
  }
}

export function startWorkspacePreferencesRefresh(): void {
  if (refreshStarted || typeof window === "undefined") return;
  refreshStarted = true;
  window.addEventListener("focus", () => {
    void adoptWorkspacePreferences();
  });
}
