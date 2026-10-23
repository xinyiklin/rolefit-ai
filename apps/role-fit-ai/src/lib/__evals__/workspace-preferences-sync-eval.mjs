import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { loadSettings, saveSettings } from "../settings.ts";

const cache = new Map();
globalThis.localStorage = {
  getItem(key) {
    return cache.has(key) ? cache.get(key) : null;
  },
  setItem(key, value) {
    cache.set(key, String(value));
  },
  removeItem(key) {
    cache.delete(key);
  }
};
globalThis.window = new EventTarget();

const pendingGets = [];
globalThis.fetch = () => new Promise((resolve) => pendingGets.push(resolve));

const { adoptWorkspacePreferences } = await import("../workspacePreferencesSync.ts");

function response(profileBackground, updatedAt) {
  return {
    ok: true,
    async json() {
      return {
        exists: true,
        source: "workspace",
        updatedAt,
        settings: { profileBackground },
        lastBaseResume: "",
        restoreStamp: null
      };
    }
  };
}

const older = adoptWorkspacePreferences();
const newer = adoptWorkspacePreferences();
assert.equal(pendingGets.length, 2, "overlapping refreshes issue independent bounded reads");

pendingGets[1](response("newer workspace state", "2026-08-09T15:00:00.000Z"));
await newer;
assert.equal(loadSettings().profileBackground, "newer workspace state");

pendingGets[0](response("older workspace state", "2026-08-09T14:00:00.000Z"));
await older;
assert.equal(
  loadSettings().profileBackground,
  "newer workspace state",
  "an older reordered response cannot overwrite the latest adopted workspace state"
);

const staleRead = adoptWorkspacePreferences();
assert.equal(pendingGets.length, 3);
saveSettings({ profileBackground: "local edit during refresh" });
assert.equal(
  cache.get("rolefit:workspace-preferences-pending"),
  "1",
  "a cached local edit records that canonical workspace preferences still need a write"
);
pendingGets[2](response("server state before local edit", "2026-08-09T15:30:00.000Z"));
await staleRead;
assert.equal(
  loadSettings().profileBackground,
  "local edit during refresh",
  "a local edit that arrives during a refresh wins over the in-flight server read"
);

// Flush the pending local edit so this standalone eval leaves no debounce timer.
globalThis.fetch = async (_url, options) => options?.method === "POST"
  ? { ok: true }
  : response("local edit during refresh", "2026-08-09T16:00:00.000Z");
await adoptWorkspacePreferences();
assert.equal(
  cache.has("rolefit:workspace-preferences-pending"),
  false,
  "a successful canonical write clears the pending marker"
);

let invalidGetCount = 0;
let invalidPostCount = 0;
globalThis.fetch = async (_url, options) => {
  if (options?.method === "POST") {
    invalidPostCount += 1;
    return { ok: true };
  }
  invalidGetCount += 1;
  return {
    ok: true,
    async json() {
      return { exists: false, invalid: true, restoreStamp: null };
    }
  };
};
await adoptWorkspacePreferences();
assert.equal(invalidGetCount, 1);
assert.equal(invalidPostCount, 0, "a corrupt canonical record is never overwritten from one browser cache");
assert.equal(
  loadSettings().profileBackground,
  "local edit during refresh",
  "a corrupt canonical record leaves the fail-open browser cache usable"
);

// Preferences saved by a newer RoleFit (D095): never written over, reported
// as "newer" rather than as a failed save, and kept through a debounced edit.
const {
  WORKSPACE_PREFERENCES_STATUS_EVENT,
  scheduleWorkspacePreferencesPush,
  parseServerPreferencesResponse,
  workspacePreferencesStatus
} = await import("../workspacePreferencesSync.ts");
const statuses = [];
window.addEventListener(WORKSPACE_PREFERENCES_STATUS_EVENT, (event) => statuses.push(event.detail));
assert.deepEqual(
  parseServerPreferencesResponse({ exists: false, newer: true, restoreStamp: null }),
  { exists: false, invalid: true, newer: true, restoreStamp: null },
  "a newer file takes every invalid-file path"
);
let newerPostCount = 0;
globalThis.fetch = async (_url, options) => {
  if (options?.method === "POST") {
    newerPostCount += 1;
    return { ok: false, status: 423, async json() { return { error: "newer", code: "workspace-newer" }; } };
  }
  return { ok: true, async json() { return { exists: false, newer: true, restoreStamp: null }; } };
};
await adoptWorkspacePreferences();
assert.equal(newerPostCount, 0, "newer preferences are never overwritten from the browser cache");
assert.equal(statuses.at(-1), "newer");
// Boot adoption finishes before React mounts, so the hook starts from this.
assert.equal(workspacePreferencesStatus(), "newer", "a listener that mounts later still sees newer preferences");
// A refused write (the file became newer after it was read) reports the same.
globalThis.fetch = async (_url, options) => options?.method === "POST"
  ? (newerPostCount += 1, { ok: false, status: 423, async json() { return { error: "newer", code: "workspace-newer" }; } })
  : { ok: true, async json() { return { exists: false, restoreStamp: null }; } };
await adoptWorkspacePreferences();
assert.equal(newerPostCount, 1, "a missing record is seeded from the cache once");
assert.equal(statuses.at(-1), "newer", "a 423 save reports newer, not a failed save");
scheduleWorkspacePreferencesPush();
assert.equal(statuses.at(-1), "newer", "a later edit does not hide the newer state while it waits");

// A companion server still running pre-Profile code returns experience rows;
// adopting them must convert, not drop, them before the next write-back.
globalThis.fetch = async (_url, options) => options?.method === "POST"
  ? { ok: true }
  : {
      ok: true,
      async json() {
        return {
          exists: true,
          source: "workspace",
          updatedAt: "2026-09-28T12:00:00.000Z",
          settings: { honestContext: "Tutor.", experienceProfile: [{ category: "research" }] },
          lastBaseResume: "",
          restoreStamp: null
        };
      }
    };
await adoptWorkspacePreferences();
assert.deepEqual(
  loadSettings(),
  { profileBackground: "Tutor.\n\n## Experience by type\n- Research / lab: experience declared" },
  "adopting pre-Profile server settings renames the Background and migrates their experience rows"
);

const settingsHook = readFileSync(new URL("../../hooks/useAiSettings.ts", import.meta.url), "utf8");
const syncSource = readFileSync(new URL("../workspacePreferencesSync.ts", import.meta.url), "utf8");
assert.match(
  settingsHook,
  /committedSettingsRef\.current = materializeAiSettings\(adopted\);\n\s*adoptedSettingsFingerprintRef\.current = JSON\.stringify\(committedSettingsRef\.current\)/,
  "focus adoption records the exact canonical settings snapshot it applied"
);
assert.match(
  settingsHook,
  /const unsaved = changedSettingKeys\(committedSettingsRef\.current, latestSettingsRef\.current\);\n\s*const next = unsaved\.length \? rebaseSettings\(adopted, latestSettingsRef\.current, unsaved\) : adopted;/,
  "adoption keeps rendered edits still inside the UI debounce"
);
assert.match(
  settingsHook,
  /committedSettingsRef\.current = nextSettings;\n\s*saveSettings\(nextSettings\);/,
  "each debounced save advances the committed snapshot"
);
assert.match(
  settingsHook,
  /adoptedSettingsFingerprintRef\.current = null;[\s\S]{0,120}?adoptedFingerprint === JSON\.stringify\(nextSettings\)/,
  "the adoption skip is consumed only by an identical rendered snapshot"
);
assert.doesNotMatch(
  settingsHook,
  /skipNextSaveRef/,
  "an unchanged focus refresh cannot leave a one-shot skip armed for the user's next edit"
);
assert.match(
  syncSource,
  /const interruptedEdits = readPendingEdits\(\);\nif \(interruptedEdits\) \{[\s\S]{0,400}?saveSettings\(applySettingEdits\(knownSettings, interruptedEdits\.settings, interruptedEdits\.removed\)\)/,
  "a reload restores an interrupted edit, with its recorded values, before adoption"
);
assert.match(
  settingsHook,
  /window\.addEventListener\("pagehide", persistLatestSettings\)/,
  "page exit synchronously saves the latest rendered settings into the recovery cache"
);

console.log("workspace preferences synchronization probes passed");
