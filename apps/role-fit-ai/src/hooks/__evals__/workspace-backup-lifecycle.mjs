// Workspace backup/restore now lives in the Electron companion. The browser's
// remaining responsibility is a pure decision (adopt or ignore whatever
// preference state the server reports) plus a tab-registry clear that must not
// duplicate storage-key knowledge already owned elsewhere. This eval probes
// that decision logic directly — no React, no DOM, no localStorage needed for
// the decision itself — and, with a minimal in-memory localStorage polyfill,
// the one storage side effect (clearAllAutosaveDrafts) it can trigger.

import assert from "node:assert/strict";
import {
  decideAdoption,
  parseServerPreferencesResponse
} from "../../lib/browserPrefsSync.ts";
import {
  clearAllAutosaveDrafts,
  keyForTab,
  tabIdFromKey
} from "../../lib/autosaveDraftRegistry.ts";

const RESTORE_STAMP = "2026-07-18T12:00:00.000Z";
const NEWER_RESTORE_STAMP = "2026-07-20T09:30:00.000Z";

function serverRestore(updatedAt) {
  return {
    exists: true,
    source: "restore",
    updatedAt,
    settings: { aiProvider: "openai" },
    lastBaseResume: "base-resume.resume",
    restoreStamp: updatedAt
  };
}
function serverMirror(updatedAt = RESTORE_STAMP) {
  return {
    exists: true,
    source: "mirror",
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
  decideAdoption(serverRestore(NEWER_RESTORE_STAMP), { hasLocalSettings: true, adoptedRestoreStamp: RESTORE_STAMP }),
  { action: "adopt", clearDrafts: true, writeStamp: NEWER_RESTORE_STAMP },
  "an unseen restore adopts and clears drafts even when this origin already has local settings"
);
assert.deepEqual(
  decideAdoption(serverRestore(RESTORE_STAMP), { hasLocalSettings: false, adoptedRestoreStamp: null }),
  { action: "adopt", clearDrafts: true, writeStamp: RESTORE_STAMP },
  "a first-ever restore adopts and clears drafts regardless of local settings"
);

// Already-adopted restore falls through to rule (b)/(c) instead of re-clearing.
assert.deepEqual(
  decideAdoption(serverRestore(RESTORE_STAMP), { hasLocalSettings: true, adoptedRestoreStamp: RESTORE_STAMP }),
  { action: "noop" },
  "a restore already adopted, with local settings present, is a no-op"
);
assert.deepEqual(
  decideAdoption(serverRestore(RESTORE_STAMP), { hasLocalSettings: false, adoptedRestoreStamp: RESTORE_STAMP }),
  { action: "adopt", clearDrafts: false, writeStamp: RESTORE_STAMP },
  "a restore already adopted, but with local settings now missing (cleared storage / new origin), re-adopts without clearing drafts and rewrites the same stamp"
);

// b. An origin with no local preferences of its own adopts a mirror for
//    continuity, without touching drafts or writing a restore stamp.
assert.deepEqual(
  decideAdoption(serverMirror(), { hasLocalSettings: false, adoptedRestoreStamp: null }),
  { action: "adopt", clearDrafts: false, writeStamp: null },
  "a mirror adopts for an origin with no local settings, without a stamp write"
);

// c. An origin with its own local settings ignores a mirror outright.
assert.deepEqual(
  decideAdoption(serverMirror(), { hasLocalSettings: true, adoptedRestoreStamp: null }),
  { action: "noop" },
  "a mirror is ignored when this origin already has local settings"
);

// No server state at all is always a no-op.
assert.deepEqual(
  decideAdoption({ exists: false, restoreStamp: null }, { hasLocalSettings: false, adoptedRestoreStamp: null }),
  { action: "noop" },
  "no server preferences at all is a no-op even with nothing local"
);

assert.deepEqual(
  decideAdoption(
    { exists: false, restoreStamp: NEWER_RESTORE_STAMP },
    { hasLocalSettings: true, adoptedRestoreStamp: RESTORE_STAMP }
  ),
  { action: "clear-drafts", writeStamp: NEWER_RESTORE_STAMP },
  "a restore marker without preferences clears stale drafts without replacing local preferences"
);

assert.deepEqual(
  decideAdoption(
    { ...serverMirror(), restoreStamp: NEWER_RESTORE_STAMP },
    { hasLocalSettings: true, adoptedRestoreStamp: RESTORE_STAMP }
  ),
  { action: "clear-drafts", writeStamp: NEWER_RESTORE_STAMP },
  "a later mirror does not hide an unseen restore generation from another origin"
);

// --- parseServerPreferencesResponse (malformed/invalid payload) ------------

const invalidPayloads = [
  null,
  undefined,
  "not an object",
  {},
  { exists: false },
  { exists: false, invalid: true },
  { exists: true }, // missing source/updatedAt/settings/lastBaseResume
  { exists: true, source: "backup", updatedAt: RESTORE_STAMP, settings: {}, lastBaseResume: "" }, // invalid source enum
  { exists: true, source: "mirror", updatedAt: "not-a-date", settings: {}, lastBaseResume: "" },
  { exists: true, source: "mirror", updatedAt: RESTORE_STAMP, settings: null, lastBaseResume: "" },
  { exists: true, source: "mirror", updatedAt: RESTORE_STAMP, settings: [], lastBaseResume: "" },
  { exists: true, source: "mirror", updatedAt: RESTORE_STAMP, settings: {}, lastBaseResume: 42 }
];
for (const payload of invalidPayloads) {
  assert.deepEqual(
    parseServerPreferencesResponse(payload),
    { exists: false, restoreStamp: null },
    `malformed payload coerces to exists:false: ${JSON.stringify(payload)}`
  );
}

const validRestore = {
  exists: true,
  source: "restore",
  updatedAt: RESTORE_STAMP,
  settings: { aiProvider: "openai" },
  lastBaseResume: "base-resume.resume",
  restoreStamp: RESTORE_STAMP
};
assert.deepEqual(parseServerPreferencesResponse(validRestore), validRestore, "a well-formed restore payload parses through unchanged");
assert.deepEqual(
  parseServerPreferencesResponse({ exists: false, restoreStamp: NEWER_RESTORE_STAMP }),
  { exists: false, restoreStamp: NEWER_RESTORE_STAMP },
  "a marker-only response survives parsing so drafts can be cleared"
);

// --- autosaveDraftRegistry (the shared draft-clearing seam) ----------------

assert.equal(keyForTab("tab-1"), "rolefit:draftAutosave:tab-1", "keyForTab namespaces by tab id");
assert.equal(tabIdFromKey("rolefit:draftAutosave:tab-1"), "tab-1", "tabIdFromKey recovers the owning tab id");
assert.equal(tabIdFromKey("rolefit:draftAutosave"), "", "the bare legacy key is recognized with the empty-string tab id");
assert.equal(tabIdFromKey("rolefit:settings"), null, "an unrelated key is not mistaken for an autosave key");

// clearAllAutosaveDrafts needs a localStorage — polyfill a minimal in-memory one
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
localStorage.setItem("rolefit:draftAutosave:tab-a", "{}");
localStorage.setItem("rolefit:draftAutosave:tab-b", "{}");
localStorage.setItem("rolefit:draftAutosave", "{}"); // legacy orphan
localStorage.setItem("rolefit:settings", "{}"); // unrelated key, must survive
localStorage.setItem("rolefit:adoptedRestoreStamp", RESTORE_STAMP); // unrelated key, must survive

clearAllAutosaveDrafts();

assert.equal(localStorage.getItem("rolefit:draftAutosave:tab-a"), null, "clearAllAutosaveDrafts clears this tab's draft");
assert.equal(localStorage.getItem("rolefit:draftAutosave:tab-b"), null, "clearAllAutosaveDrafts clears a sibling tab's draft too");
assert.equal(localStorage.getItem("rolefit:draftAutosave"), null, "clearAllAutosaveDrafts clears the legacy orphan key");
assert.equal(localStorage.getItem("rolefit:settings"), "{}", "clearAllAutosaveDrafts never touches unrelated settings storage");
assert.equal(localStorage.getItem("rolefit:adoptedRestoreStamp"), RESTORE_STAMP, "clearAllAutosaveDrafts never touches the adopted-restore-stamp marker");
delete globalThis.localStorage;

console.log("workspace backup lifecycle probes: PASS");
