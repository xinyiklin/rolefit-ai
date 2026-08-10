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

function response(honestContext, updatedAt) {
  return {
    ok: true,
    async json() {
      return {
        exists: true,
        source: "workspace",
        updatedAt,
        settings: { honestContext },
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
assert.equal(loadSettings().honestContext, "newer workspace state");

pendingGets[0](response("older workspace state", "2026-08-09T14:00:00.000Z"));
await older;
assert.equal(
  loadSettings().honestContext,
  "newer workspace state",
  "an older reordered response cannot overwrite the latest adopted workspace state"
);

const staleRead = adoptWorkspacePreferences();
assert.equal(pendingGets.length, 3);
saveSettings({ honestContext: "local edit during refresh" });
assert.equal(
  cache.get("rolefit:workspace-preferences-pending"),
  "1",
  "a cached local edit records that canonical workspace preferences still need a write"
);
pendingGets[2](response("server state before local edit", "2026-08-09T15:30:00.000Z"));
await staleRead;
assert.equal(
  loadSettings().honestContext,
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
  loadSettings().honestContext,
  "local edit during refresh",
  "a corrupt canonical record leaves the fail-open browser cache usable"
);

const settingsHook = readFileSync(new URL("../../hooks/useAiSettings.ts", import.meta.url), "utf8");
const syncSource = readFileSync(new URL("../workspacePreferencesSync.ts", import.meta.url), "utf8");
assert.match(
  settingsHook,
  /adoptedSettingsFingerprintRef\.current = JSON\.stringify\(materializeAiSettings\(next\)\)/,
  "focus adoption records the exact live settings snapshot it applied"
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
  /if \(workspacePreferencesPushIsPending\(\)\) \{[\s\S]{0,220}?pendingSettings = normalizeSettings\(loadSettings\(\)\)/,
  "a reload restores an interrupted canonical write from the browser cache before adoption"
);
assert.match(
  settingsHook,
  /window\.addEventListener\("pagehide", persistLatestSettings\)/,
  "page exit synchronously saves the latest rendered settings into the recovery cache"
);

console.log("workspace preferences synchronization probes passed");
