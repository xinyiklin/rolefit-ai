// Workspace preferences are canonical; browser storage is a fail-open cache.
// Every RoleFit client attached to the same local workspace adopts the server
// copy at boot and on window focus, while local edits are debounced back to the
// owner-only workspace-preferences.json file. Each write names the revision it
// was based on, so a client never replaces a newer record it has not seen.

import {
  hasStoredSettings,
  loadSettings,
  migrateStoredSettings,
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
import {
  applySettingEdits,
  changedSettingKeys,
  readSetting,
  rebaseSettings,
  sameSetting
} from "./workspacePreferencesRebase.ts";

const PREFERENCES_PUSH_DEBOUNCE_MS = 1500;
const ADOPT_FETCH_TIMEOUT_MS = 1500;
const ADOPTED_RESTORE_STAMP_KEY = "rolefit:adoptedRestoreStamp";
const PREFERENCES_PUSH_PENDING_KEY = "rolefit:workspace-preferences-pending";
const PREFERENCES_PENDING_EDITS_KEY = "rolefit:workspace-preferences-pending-edits";
export const WORKSPACE_PREFERENCES_APPLIED_EVENT = "rolefit:workspace-preferences-applied";
export const WORKSPACE_PREFERENCES_STATUS_EVENT = "rolefit:workspace-preferences-status";
export type WorkspacePreferencesStatus = "idle" | "saving" | "saved" | "error";

// Unpushed edits shared by this origin's tabs: values keyed by setting or
// setting entry, removed keys, an edited last base resume (null when unchanged),
// and the restore generation they were made after.
type PendingEdits = {
  settings: Record<string, unknown>;
  removed: string[];
  lastBaseResume: string | null;
  restoreStamp: string | null;
};

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let suppressPush = false;
let refreshStarted = false;
let adoptionGeneration = 0;
// The canonical revision this tab last adopted or wrote (null: none known).
let baseRevision: string | null = null;
// This tab's own view. The browser cache is shared by every tab of the origin,
// so writes and rebases use these snapshots, never a fresh cache read.
let knownSettings: PersistedSettings = loadSettings();
let knownLastBaseResume = loadLastBaseResumeName();
// What this tab's user changed since that revision. Saves that change nothing
// (page exit, first render) add nothing, so they never push.
const dirtySettingKeys = new Set<string>();
let dirtyLastBaseResume = false;
// The restore generation this tab's baseline includes. The adopted stamp in
// storage is shared, so another tab adopting a restore does not make this
// tab's pre-restore edits current.
let baselineRestoreStamp = readAdoptedRestoreStamp();

function hasPendingEdits(): boolean {
  return dirtySettingKeys.size > 0 || dirtyLastBaseResume;
}

function isPendingEdits(value: unknown): value is PendingEdits {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { settings, removed, lastBaseResume, restoreStamp } = value as Record<string, unknown>;
  return Boolean(settings) && typeof settings === "object" && !Array.isArray(settings)
    && Array.isArray(removed) && removed.every((key) => typeof key === "string")
    && (lastBaseResume === null || typeof lastBaseResume === "string")
    && (restoreStamp === null || typeof restoreStamp === "string");
}

// A marker without a valid edit record came from a build that marked every
// save, including unchanged page exits; it names no known edit. Edits made
// before the latest adopted restore are superseded by it.
function readPendingEdits(): PendingEdits | null {
  if (typeof localStorage === "undefined") return null;
  try {
    if (localStorage.getItem(PREFERENCES_PUSH_PENDING_KEY) !== "1") return null;
    const value = JSON.parse(localStorage.getItem(PREFERENCES_PENDING_EDITS_KEY) ?? "null") as unknown;
    return isPendingEdits(value) && value.restoreStamp === readAdoptedRestoreStamp() ? value : null;
  } catch {
    return null;
  }
}

function writePendingEdits(edits: PendingEdits | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (edits && (Object.keys(edits.settings).length || edits.removed.length || edits.lastBaseResume !== null)) {
      localStorage.setItem(PREFERENCES_PENDING_EDITS_KEY, JSON.stringify(edits));
      localStorage.setItem(PREFERENCES_PUSH_PENDING_KEY, "1");
    } else {
      localStorage.removeItem(PREFERENCES_PUSH_PENDING_KEY);
      localStorage.removeItem(PREFERENCES_PENDING_EDITS_KEY);
    }
  } catch {
    // The in-memory pending edits still get their normal bounded attempt.
  }
}

// Merge this tab's edits into the shared record without dropping another tab's.
// Pre-restore edits stay out of it; this tab's next write drops them.
function recordPendingEdits(): void {
  if (baselineRestoreStamp !== readAdoptedRestoreStamp()) return;
  const edits = readPendingEdits()
    ?? { settings: {}, removed: [], lastBaseResume: null, restoreStamp: baselineRestoreStamp };
  for (const key of dirtySettingKeys) {
    const { present, value } = readSetting(knownSettings, key);
    if (present) {
      edits.settings[key] = value;
      edits.removed = edits.removed.filter((removed) => removed !== key);
    } else {
      delete edits.settings[key];
      if (!edits.removed.includes(key)) edits.removed.push(key);
    }
  }
  if (dirtyLastBaseResume) edits.lastBaseResume = knownLastBaseResume;
  writePendingEdits(edits);
}

// After a write, release only edits that still hold the value that was sent;
// an edit made while the request was in flight stays pending.
function releasePostedEdits(posted: { settings: PersistedSettings; lastBaseResume: string }): void {
  const edits = readPendingEdits();
  for (const key of [...dirtySettingKeys]) {
    if (!sameSetting(knownSettings, posted.settings, key)) continue;
    dirtySettingKeys.delete(key);
    // The recorded entry is compared in place in the posted record, since some
    // settings resolve against siblings. A removed entry compares as its
    // default, which a reset's re-save sends.
    if (edits && sameSetting(recordedInPlace(edits, posted.settings, key), posted.settings, key)) {
      delete edits.settings[key];
      edits.removed = edits.removed.filter((removed) => removed !== key);
    }
  }
  if (dirtyLastBaseResume && knownLastBaseResume === posted.lastBaseResume) {
    dirtyLastBaseResume = false;
    if (edits && edits.lastBaseResume === posted.lastBaseResume) edits.lastBaseResume = null;
  }
  writePendingEdits(edits);
}

function recordedInPlace(edits: PendingEdits, posted: PersistedSettings, key: string): PersistedSettings {
  const recorded = Object.prototype.hasOwnProperty.call(edits.settings, key);
  return applySettingEdits(posted, recorded ? { [key]: edits.settings[key] } : {}, recorded ? [] : [key]);
}

// Clears a shared record that an adopted restore superseded; edits recorded
// after that restore stay.
function discardSupersededPendingEdits(): void {
  if (!readPendingEdits()) writePendingEdits(null);
}

// An unseen restore supersedes this tab's pre-restore edits.
function dropPendingEdits(): void {
  dirtySettingKeys.clear();
  dirtyLastBaseResume = false;
  discardSupersededPendingEdits();
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

type PostResult =
  | { status: "saved"; revision: string | null }
  | { status: "stale"; current: ServerPreferencesState | null }
  | { status: "failed" };

// Bounded like the adoption read, so a pending write cannot hold first render.
async function postPreferences(posted: { settings: PersistedSettings; lastBaseResume: string }): Promise<PostResult> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ADOPT_FETCH_TIMEOUT_MS) : null;
  try {
    const response = await fetch("/api/workspace/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...posted, baseRevision }),
      ...(controller ? { signal: controller.signal } : {})
    });
    const payload = await readJson(response) as Record<string, unknown> | null;
    if (response.status === 409 && payload?.stale === true) {
      return { status: "stale", current: payload.current ? parseServerPreferencesResponse(payload.current) : null };
    }
    if (!response.ok) return { status: "failed" };
    return { status: "saved", revision: typeof payload?.revision === "string" ? payload.revision : null };
  } catch {
    // The browser cache remains usable; the next local change or focus makes a
    // new bounded attempt rather than starting a background retry loop.
    return { status: "failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// A refused write rebases once onto the record the server returned, then
// retries against that revision. A second refusal leaves the edit pending.
async function pushPreferencesNow(): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const posted = { settings: knownSettings, lastBaseResume: knownLastBaseResume };
    const result = await postPreferences(posted);
    if (result.status === "failed") break;
    if (result.status === "saved") {
      baseRevision = result.revision;
      releasePostedEdits(posted);
      publishStatus("saved");
      return true;
    }
    const next = result.current ? rebaseOntoServer(result.current) : "stop";
    if (next === "stop") break;
    if (next === "done") {
      publishStatus("saved");
      return true;
    }
  }
  publishStatus("error");
  return false;
}

function noteLocalEdit(): void {
  recordPendingEdits();
  scheduleWorkspacePreferencesPush();
}

setSettingsSaveListener((settings) => {
  if (suppressPush) return;
  const changed = changedSettingKeys(knownSettings, settings);
  knownSettings = settings;
  if (!changed.length) return;
  for (const key of changed) dirtySettingKeys.add(key);
  noteLocalEdit();
});
setLastBaseResumeSaveListener((fileName) => {
  if (suppressPush) return;
  const changed = fileName !== knownLastBaseResume;
  knownLastBaseResume = fileName;
  if (!changed) return;
  dirtyLastBaseResume = true;
  noteLocalEdit();
});

// A tab can close during the debounce or while a write is in flight. Restore
// the interrupted edits with their values into this tab's view and cache (so
// the hook mounts from them); without a known revision the first write is
// refused and rebased onto whatever record exists by then.
const interruptedEdits = readPendingEdits();
if (interruptedEdits) {
  const keys = [...Object.keys(interruptedEdits.settings), ...interruptedEdits.removed];
  for (const key of keys) dirtySettingKeys.add(key);
  if (interruptedEdits.lastBaseResume !== null) dirtyLastBaseResume = true;
  suppressPush = true;
  try {
    saveSettings(applySettingEdits(knownSettings, interruptedEdits.settings, interruptedEdits.removed));
    if (interruptedEdits.lastBaseResume !== null) saveLastBaseResumeName(interruptedEdits.lastBaseResume);
  } finally {
    suppressPush = false;
  }
  knownSettings = loadSettings();
  knownLastBaseResume = loadLastBaseResumeName();
} else {
  writePendingEdits(null);
}

export type ServerPreferencesState =
  | { exists: false; invalid: boolean; restoreStamp: string | null }
  | {
      exists: true;
      source: "workspace" | "restore";
      updatedAt: string;
      revision?: string;
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
    ...(typeof value.revision === "string" ? { revision: value.revision } : {}),
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
  discardSupersededPendingEdits();
}

function hasLocalPreferences(): boolean {
  return hasStoredSettings() || Boolean(loadLastBaseResumeName());
}

function notifyPreferencesApplied(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WORKSPACE_PREFERENCES_APPLIED_EVENT));
}

// Make a canonical record this tab's baseline without treating it as an edit.
// The live hook reconciles only when the visible settings actually changed.
function applyCanonical(
  settings: PersistedSettings,
  lastBaseResume: string,
  server: Extract<ServerPreferencesState, { exists: true }>,
  decision: Extract<AdoptionDecision, { action: "adopt" }>
): void {
  const visibleChange = changedSettingKeys(knownSettings, settings).length > 0 || lastBaseResume !== knownLastBaseResume;
  suppressPush = true;
  try {
    saveSettings(settings);
    saveLastBaseResumeName(lastBaseResume);
    knownSettings = loadSettings();
    knownLastBaseResume = loadLastBaseResumeName();
    baseRevision = server.revision ?? null;
    // A record without a restore marker names no newer restore.
    if (server.restoreStamp !== null) baselineRestoreStamp = server.restoreStamp;
    if (decision.clearDrafts) adoptWorkspaceRestoreDrafts();
    if (decision.writeStamp) writeAdoptedRestoreStamp(decision.writeStamp);
    if (visibleChange) notifyPreferencesApplied();
  } finally {
    suppressPush = false;
  }
}

// "retry" writes again against the rebased revision; "done" has nothing left
// to write; "stop" must not retry.
function rebaseOntoServer(server: ServerPreferencesState): "retry" | "done" | "stop" {
  if (!server.exists) {
    if (server.invalid) return "stop";
    baseRevision = null;
    return "retry";
  }
  const decision = decideAdoption(server, { adoptedRestoreStamp: readAdoptedRestoreStamp() });
  if (decision.action !== "adopt") return "stop";
  // An older companion server may still return pre-Profile settings.
  const serverSettings = normalizeSettings(migrateStoredSettings(server.settings));
  // A restore this tab has not seen replaces its pre-restore edits, as it
  // replaces drafts, even when another tab already acknowledged it.
  if (decision.clearDrafts || (server.restoreStamp !== null && server.restoreStamp !== baselineRestoreStamp)) {
    dropPendingEdits();
    applyCanonical(serverSettings, server.lastBaseResume, server, decision);
    return "done";
  }
  applyCanonical(
    rebaseSettings(serverSettings, knownSettings, dirtySettingKeys),
    dirtyLastBaseResume ? knownLastBaseResume : server.lastBaseResume,
    server,
    decision
  );
  return hasPendingEdits() ? "retry" : "done";
}

export async function adoptWorkspacePreferences(): Promise<void> {
  if (typeof fetch === "undefined") return;
  const generation = ++adoptionGeneration;
  // Do not let a focus refresh replace a just-edited local snapshot that is
  // still inside the debounce window. Commit it first; if that fails, retain
  // the local state and retry later instead of adopting older server data.
  if (pushTimer !== null || hasPendingEdits()) {
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
  if (generation !== adoptionGeneration || pushTimer !== null || hasPendingEdits()) {
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
    baseRevision = null;
    baselineRestoreStamp = decision.writeStamp;
    adoptWorkspaceRestoreDrafts();
    writeAdoptedRestoreStamp(decision.writeStamp);
    return;
  }
  if (decision.action === "noop") {
    baseRevision = null;
    // A pre-existing browser cache seeds a new workspace once. Thereafter the
    // workspace copy becomes authoritative for all origins.
    if (!server.exists && hasLocalPreferences() && !await pushPreferencesNow()) {
      scheduleWorkspacePreferencesPush();
    }
    return;
  }
  if (!server.exists) return;

  // An older companion server may still return pre-Profile settings.
  applyCanonical(
    normalizeSettings(migrateStoredSettings(server.settings)),
    server.lastBaseResume,
    server,
    decision
  );
  publishStatus("saved");
}

export function startWorkspacePreferencesRefresh(): void {
  if (refreshStarted || typeof window === "undefined") return;
  refreshStarted = true;
  window.addEventListener("focus", () => {
    void adoptWorkspacePreferences();
  });
}
