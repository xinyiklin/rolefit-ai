// Workspace backup/restore now lives in the Electron companion. The browser's
// remaining responsibility is a pure decision (adopt or ignore whatever
// preference state the server reports) plus a tab-registry clear that must not
// duplicate storage-key knowledge already owned elsewhere. This eval probes
// that decision logic directly — no React, no DOM, no localStorage needed for
// the decision itself — and, with a minimal in-memory localStorage polyfill,
// the one storage side effect (adoptWorkspaceRestoreDrafts) it can trigger.

import assert from "node:assert/strict";
import {
  decideAdoption,
  parseServerPreferencesResponse
} from "../../lib/workspacePreferencesSync.ts";
import {
  adoptWorkspaceRestoreDrafts,
  keyForTab,
  tabIdFromKey
} from "../../lib/autosaveDraftRegistry.ts";
import { subscribeWorkspaceRestoreAdoption } from "../../lib/tabPresence.ts";

const RESTORE_STAMP = "2026-07-18T12:00:00.000Z";
const NEWER_RESTORE_STAMP = "2026-07-20T09:30:00.000Z";

function serverRestore(updatedAt) {
  return {
    exists: true,
    source: "restore",
    updatedAt,
    settings: { aiProvider: "openai" },
    lastBaseResume: "default.resume",
    restoreStamp: updatedAt
  };
}
function serverWorkspace(updatedAt = RESTORE_STAMP) {
  return {
    exists: true,
    source: "workspace",
    updatedAt,
    settings: { aiProvider: "anthropic" },
    lastBaseResume: "",
    restoreStamp: null
  };
}

// --- decideAdoption ---------------------------------------------------------

// a. A restore this origin has not adopted yet always wins, and clears every
//    autosave draft (they belong to the pre-restore world).
assert.deepEqual(
  decideAdoption(serverRestore(NEWER_RESTORE_STAMP), { adoptedRestoreStamp: RESTORE_STAMP }),
  { action: "adopt", clearDrafts: true, writeStamp: NEWER_RESTORE_STAMP },
  "an unseen restore adopts and clears drafts even when this origin already has local settings"
);
assert.deepEqual(
  decideAdoption(serverRestore(RESTORE_STAMP), { adoptedRestoreStamp: null }),
  { action: "adopt", clearDrafts: true, writeStamp: RESTORE_STAMP },
  "a first-ever restore adopts and clears drafts regardless of local settings"
);

// An already-adopted restore remains canonical but does not clear drafts again.
assert.deepEqual(
  decideAdoption(serverRestore(RESTORE_STAMP), { adoptedRestoreStamp: RESTORE_STAMP }),
  { action: "adopt", clearDrafts: false, writeStamp: RESTORE_STAMP },
  "an already-adopted restore still refreshes the browser cache without clearing drafts"
);

// The workspace record wins regardless of whether this origin has cache data.
assert.deepEqual(
  decideAdoption(serverWorkspace(), { adoptedRestoreStamp: null }),
  { action: "adopt", clearDrafts: false, writeStamp: null },
  "canonical workspace preferences replace any origin-specific cache without a restore stamp"
);

// No server state at all is always a no-op.
assert.deepEqual(
  decideAdoption({ exists: false, restoreStamp: null }, { adoptedRestoreStamp: null }),
  { action: "noop" },
  "no server preferences at all is a no-op even with nothing local"
);

assert.deepEqual(
  decideAdoption(
    { exists: false, restoreStamp: NEWER_RESTORE_STAMP },
    { adoptedRestoreStamp: RESTORE_STAMP }
  ),
  { action: "clear-drafts", writeStamp: NEWER_RESTORE_STAMP },
  "a restore marker without preferences clears stale drafts without replacing local preferences"
);

assert.deepEqual(
  decideAdoption(
    { ...serverWorkspace(), restoreStamp: NEWER_RESTORE_STAMP },
    { adoptedRestoreStamp: RESTORE_STAMP }
  ),
  { action: "adopt", clearDrafts: true, writeStamp: NEWER_RESTORE_STAMP },
  "a later workspace write does not hide an unseen restore generation"
);

// --- parseServerPreferencesResponse (malformed/invalid payload) ------------

const malformedPayloads = [
  null,
  undefined,
  "not an object",
  {},
  { exists: true }, // missing source/updatedAt/settings/lastBaseResume
  { exists: true, source: "backup", updatedAt: RESTORE_STAMP, settings: {}, lastBaseResume: "" }, // invalid source enum
  { exists: true, source: "workspace", updatedAt: "not-a-date", settings: {}, lastBaseResume: "" },
  { exists: true, source: "workspace", updatedAt: RESTORE_STAMP, settings: null, lastBaseResume: "" },
  { exists: true, source: "workspace", updatedAt: RESTORE_STAMP, settings: [], lastBaseResume: "" },
  { exists: true, source: "workspace", updatedAt: RESTORE_STAMP, settings: {}, lastBaseResume: 42 }
];
for (const payload of malformedPayloads) {
  assert.deepEqual(
    parseServerPreferencesResponse(payload),
    { exists: false, invalid: true, restoreStamp: null },
    `malformed payload stays distinguishable from a missing file: ${JSON.stringify(payload)}`
  );
}
assert.deepEqual(
  parseServerPreferencesResponse({ exists: false }),
  { exists: false, invalid: false, restoreStamp: null },
  "an explicit missing-file response remains seedable"
);
assert.deepEqual(
  parseServerPreferencesResponse({ exists: false, invalid: true }),
  { exists: false, invalid: true, restoreStamp: null },
  "an invalid canonical file remains fail-closed"
);

const validRestore = {
  exists: true,
  source: "restore",
  updatedAt: RESTORE_STAMP,
  settings: { aiProvider: "openai" },
  lastBaseResume: "default.resume",
  restoreStamp: RESTORE_STAMP
};
assert.deepEqual(parseServerPreferencesResponse(validRestore), validRestore, "a well-formed restore payload parses through unchanged");
assert.deepEqual(
  parseServerPreferencesResponse({ exists: false, restoreStamp: NEWER_RESTORE_STAMP }),
  { exists: false, invalid: false, restoreStamp: NEWER_RESTORE_STAMP },
  "a marker-only response survives parsing so drafts can be cleared"
);

// --- autosaveDraftRegistry (the shared draft-clearing seam) ----------------

assert.equal(keyForTab("resume", "tab-1"), "rolefit:draftAutosave:v2:tab-1", "keyForTab namespaces by tab id");
assert.equal(
  keyForTab("cover", "tab-1"),
  "rolefit:coverDraftAutosave:v2:tab-1",
  "each editor's draft has its own key, so one document's draft cannot overwrite the other's"
);
assert.equal(tabIdFromKey("resume", "rolefit:draftAutosave:v2:tab-1"), "tab-1", "tabIdFromKey recovers the owning tab id");
assert.equal(tabIdFromKey("cover", "rolefit:coverDraftAutosave:v2:tab-1"), "tab-1", "the cover key resolves its owning tab too");
assert.equal(tabIdFromKey("resume", "rolefit:draftAutosave"), null, "the retired pre-tab resume key is ignored at runtime");
assert.equal(tabIdFromKey("resume", "rolefit:draftAutosave:tab-1"), null, "retired tab-scoped resume drafts are ignored at runtime");
assert.equal(tabIdFromKey("cover", "rolefit:draftAutosave"), null, "the retired resume key never belongs to the cover letter");
assert.equal(
  tabIdFromKey("resume", "rolefit:coverDraftAutosave:v2:tab-1"),
  null,
  "resume recovery never claims a cover-letter draft"
);
assert.equal(tabIdFromKey("resume", "rolefit:settings"), null, "an unrelated key is not mistaken for an autosave key");

// adoptWorkspaceRestoreDrafts needs a localStorage — polyfill a minimal in-memory one
// (Node has none) rather than mocking the whole browser to exercise the one
// real side effect this eval can drive directly.
class FakeStorage {
  constructor() { this.entries = new Map(); }
  get length() { return this.entries.size; }
  key(i) { return Array.from(this.entries.keys())[i] ?? null; }
  getItem(key) { return this.entries.has(key) ? this.entries.get(key) : null; }
  setItem(key, value) { this.entries.set(key, String(value)); }
  removeItem(key) { this.entries.delete(key); }
}
globalThis.localStorage = new FakeStorage();
globalThis.sessionStorage = new FakeStorage();
const channelMessages = [];
const channelListeners = new Set();
globalThis.BroadcastChannel = class {
  postMessage(message) { channelMessages.push(message); }
  addEventListener(type, listener) {
    if (type === "message") channelListeners.add(listener);
  }
  removeEventListener(type, listener) {
    if (type === "message") channelListeners.delete(listener);
  }
};
const windowListeners = new Map();
globalThis.window = {
  addEventListener(type, listener) {
    const listeners = windowListeners.get(type) ?? new Set();
    listeners.add(listener);
    windowListeners.set(type, listeners);
  },
  removeEventListener(type, listener) {
    windowListeners.get(type)?.delete(listener);
  }
};
sessionStorage.setItem("rolefit:tabId", "tab-a");
localStorage.setItem("rolefit:tabPresence", JSON.stringify({
  "tab-a": { jobLabel: "Current", phase: "idle", updatedAt: Date.now() },
  "tab-b": { jobLabel: "Sibling", phase: "editing", updatedAt: Date.now() }
}));
localStorage.setItem("rolefit:draftAutosave:v2:tab-a", "{}");
localStorage.setItem("rolefit:draftAutosave:v2:tab-b", "{}");
localStorage.setItem("rolefit:draftAutosave:v2:dead-tab", "{}");
localStorage.setItem("rolefit:draftAutosave:tab-a", "{}"); // retired structured-lossy draft
localStorage.setItem("rolefit:draftAutosave", "{}"); // legacy orphan
localStorage.setItem("rolefit:coverDraftAutosave:tab-a", "{}");
localStorage.setItem("rolefit:coverDraftAutosave:v2:tab-b", "{}");
localStorage.setItem("rolefit:coverDraftAutosave:v2:dead-tab", "{}");
localStorage.setItem("rolefit:settings", "{}"); // unrelated key, must survive
localStorage.setItem("rolefit:adoptedRestoreStamp", RESTORE_STAMP); // unrelated key, must survive

adoptWorkspaceRestoreDrafts();

assert.equal(localStorage.getItem("rolefit:draftAutosave:v2:tab-a"), null, "workspace adoption clears this tab's draft");
assert.equal(
  localStorage.getItem("rolefit:draftAutosave:v2:tab-b"),
  "{}",
  "workspace adoption preserves a live sibling tab's resume recovery draft"
);
assert.equal(localStorage.getItem("rolefit:draftAutosave:tab-a"), "{}", "workspace adoption ignores retired resume keys");
assert.equal(localStorage.getItem("rolefit:draftAutosave"), "{}", "workspace adoption ignores the retired orphan key");
assert.equal(
  localStorage.getItem("rolefit:coverDraftAutosave:tab-a"),
  "{}",
  "workspace adoption ignores retired cover-letter keys"
);
assert.equal(
  localStorage.getItem("rolefit:coverDraftAutosave:v2:tab-b"),
  "{}",
  "workspace adoption preserves a live sibling tab's cover-letter recovery draft"
);
assert.equal(
  localStorage.getItem("rolefit:draftAutosave:v2:dead-tab"),
  null,
  "workspace adoption clears a dead tab's resume orphan"
);
assert.equal(
  localStorage.getItem("rolefit:coverDraftAutosave:v2:dead-tab"),
  null,
  "workspace adoption clears a dead tab's cover-letter orphan"
);
assert.equal(
  channelMessages.some(
    (message) =>
      message?.type === "workspace-restore-adopted" &&
      typeof message.eventId === "string" &&
      message.sourceTabId === "tab-a"
  ),
  true,
  "workspace adoption publishes a restore-generation event for live siblings"
);
let adoptionCallbacks = 0;
const unsubscribe = subscribeWorkspaceRestoreAdoption(() => {
  adoptionCallbacks += 1;
});
const duplicatedEvent = {
  type: "workspace-restore-adopted",
  eventId: "restore-event-1",
  sourceTabId: "tab-b",
  adoptedAt: Date.now()
};
for (const listener of channelListeners) {
  listener({ data: duplicatedEvent });
}
for (const listener of windowListeners.get("storage") ?? []) {
  listener({
    key: "rolefit:workspaceRestoreAdoption",
    newValue: JSON.stringify(duplicatedEvent)
  });
}
assert.equal(
  adoptionCallbacks,
  1,
  "one restore event delivered by storage and BroadcastChannel invokes its subscriber exactly once"
);
unsubscribe();
assert.equal(localStorage.getItem("rolefit:settings"), "{}", "workspace adoption never touches unrelated settings storage");
assert.equal(localStorage.getItem("rolefit:adoptedRestoreStamp"), RESTORE_STAMP, "workspace adoption never touches the adopted-restore-stamp marker");
delete globalThis.localStorage;
delete globalThis.sessionStorage;
delete globalThis.BroadcastChannel;
delete globalThis.window;

console.log("workspace backup lifecycle probes: PASS");
