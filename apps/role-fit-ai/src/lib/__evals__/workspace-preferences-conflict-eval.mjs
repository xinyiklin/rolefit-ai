// Stale-client protection for workspace preferences: the real sync module
// against the real preferences route in an isolated temporary workspace.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleWorkspacePreferences, writeStoredWorkspacePreferences } from "../../../server/workspacePreferences.ts";
import { WORKSPACE_PREFERENCES_FILE_NAME } from "../workspaceBackupContract.ts";
import { clearStoredSettings, loadSettings, saveSettings } from "../settings.ts";
import { saveLastBaseResumeName } from "../baseResumePrefs.ts";
import { materializeAiSettings } from "../aiSettingsPersistence.ts";
import { changedSettingKeys } from "../workspacePreferencesRebase.ts";

const PENDING = "rolefit:workspace-preferences-pending";
const EDITS = "rolefit:workspace-preferences-pending-edits";
const SETTINGS = "rolefit:settings";
const cache = new Map();
globalThis.localStorage = {
  get length() { return cache.size; },
  key(index) { return [...cache.keys()][index] ?? null; },
  getItem(key) { return cache.has(key) ? cache.get(key) : null; },
  setItem(key, value) { cache.set(key, String(value)); },
  removeItem(key) { cache.delete(key); }
};
globalThis.window = new EventTarget();
// Node's real BroadcastChannel would keep this probe alive; tab presence falls back to storage.
globalThis.BroadcastChannel = undefined;

// Debounce timers run only when a probe flushes them; a reload drops them with the page.
const timers = new Map();
let nextTimer = 0;
globalThis.setTimeout = (callback) => { nextTimer += 1; timers.set(nextTimer, callback); return nextTimer; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
// Runs pending debounces and waits for the push they start to settle.
async function flushTimers() {
  const pending = [...timers.values()];
  timers.clear();
  if (!pending.length) return;
  const settled = new Promise((resolve) => {
    const onStatus = (event) => {
      if (event.detail !== "saved" && event.detail !== "error") return;
      window.removeEventListener("rolefit:workspace-preferences-status", onStatus);
      resolve(event.detail);
    };
    window.addEventListener("rolefit:workspace-preferences-status", onStatus);
  });
  for (const callback of pending) callback();
  return settled;
}

const root = await mkdtemp(join(tmpdir(), "rolefit-preferences-conflict-"));
const workspace = join(root, "workspace");
const file = join(workspace, WORKSPACE_PREFERENCES_FILE_NAME);
let posts = 0;
// Runs just before a POST reaches the server: an in-flight edit or another writer.
let beforePost = null;

globalThis.fetch = async (_url, options = {}) => {
  const method = options.method ?? "GET";
  if (method === "POST") {
    posts += 1;
    if (beforePost) await beforePost();
  }
  const req = Readable.from(options.body ? [options.body] : []);
  req.method = method;
  let status = 0;
  let body = "";
  await handleWorkspacePreferences(req, {
    writeHead(code) { status = code; },
    end(chunk = "") { body = String(chunk); }
  }, workspace);
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body) };
};

let boot = 0;
async function reloadClient() {
  timers.clear();
  boot += 1;
  const sync = await import(`../workspacePreferencesSync.ts?boot=${boot}`);
  await sync.adoptWorkspacePreferences();
  return sync;
}

const readRecord = async () => JSON.parse(await readFile(file, "utf8"));
async function writeExternal(patch) {
  const record = await readRecord();
  record.settings = { ...record.settings, ...patch };
  await writeFile(file, JSON.stringify(record), "utf8");
}
const pageExit = () => saveSettings(materializeAiSettings(loadSettings()));

assert.deepEqual(
  changedSettingKeys(
    { stageCustomInstructions: { "resume-polish": "A", "cover-polish": "B" } },
    { stageCustomInstructions: { "cover-polish": "B", "resume-polish": "A" }, boldBulletKeywords: true }
  ),
  [],
  "key order and an absent setting's default value are not edits"
);
assert.deepEqual(changedSettingKeys({ major: "Physics" }, { major: "Math" }), ["major"]);
assert.deepEqual(
  changedSettingKeys(
    { excludedResumeVariants: { "a.resume": true } },
    { excludedResumeVariants: { "a.resume": true, "b.resume": true }, excludedCoverLetterVariants: {} }
  ),
  ["excludedResumeVariants.b.resume"],
  "a variant exclusion is its own setting entry, and an empty pool is no edit"
);

try {
  await mkdir(workspace, { recursive: true });
  await writeStoredWorkspacePreferences(
    workspace,
    { settings: { profileBackground: "Original" }, lastBaseResume: "base.resume" },
    "workspace",
    new Date("2026-09-29T12:00:00.000Z")
  );

  let sync = await reloadClient();
  assert.equal(loadSettings().profileBackground, "Original");
  pageExit();
  saveSettings(loadSettings());
  await flushTimers();
  assert.equal(cache.has(PENDING), false, "a page exit or first render with no edits leaves no pending marker");
  assert.equal(posts, 0, "an unchanged save never writes the canonical record");

  // Outside edits below leave updatedAt untouched, as a hand edit or script may.
  // The 2026-09-29 incident: an external edit, then the stale client exits and reloads.
  await writeExternal({ profileBackground: "External edit" });
  pageExit();
  sync = await reloadClient();
  assert.equal((await readRecord()).settings.profileBackground, "External edit", "a stale client's reload cannot replace a newer record");
  assert.equal(loadSettings().profileBackground, "External edit", "the reloaded client adopts the newer record");
  assert.equal(posts, 0);

  // An edit interrupted inside the debounce is still written on the next boot,
  // from its recorded value even after another tab rewrote the shared cache.
  const beforeEdit = cache.get(SETTINGS);
  saveSettings({ ...loadSettings(), customInstructions: "Interrupted edit" });
  assert.equal(cache.get(PENDING), "1", "a real edit records a pending write");
  pageExit();
  cache.set(SETTINGS, beforeEdit);
  sync = await reloadClient();
  assert.equal((await readRecord()).settings.customInstructions, "Interrupted edit", "the interrupted edit is recovered");
  assert.equal((await readRecord()).settings.profileBackground, "External edit");
  assert.equal(cache.has(PENDING), false);

  // A stale pending snapshot is rebased onto the newer record instead of replacing it.
  saveSettings({ ...loadSettings(), customInstructions: "Mine" });
  await writeExternal({ profileBackground: "Their newer Background", customInstructions: "Theirs", major: "Physics" });
  pageExit();
  sync = await reloadClient();
  let stored = (await readRecord()).settings;
  assert.equal(stored.customInstructions, "Mine", "the setting this client's user changed keeps the user's value");
  assert.equal(stored.profileBackground, "Their newer Background", "settings this client did not change keep the newer values");
  assert.equal(stored.major, "Physics");
  assert.equal((await readRecord()).lastBaseResume, "base.resume");
  assert.deepEqual(loadSettings(), stored, "the client shows exactly what was saved");

  // An ordinary debounced edit against a record changed while this client was open.
  let applied = 0;
  window.addEventListener(sync.WORKSPACE_PREFERENCES_APPLIED_EVENT, () => { applied += 1; });
  await writeExternal({ profileBackground: "Changed while open" });
  saveSettings({ ...loadSettings(), major: "Mathematics" });
  await flushTimers();
  stored = (await readRecord()).settings;
  assert.equal(stored.profileBackground, "Changed while open", "an ordinary save cannot overwrite a newer unseen setting");
  assert.equal(stored.major, "Mathematics");
  assert.equal(applied, 1, "the live settings hook is told to reconcile with the merged record");
  assert.equal(loadSettings().profileBackground, "Changed while open");
  assert.equal(cache.has(PENDING), false);

  // Another tab of this origin rewrites the shared cache before this tab's push.
  saveSettings({ ...loadSettings(), major: "This tab's edit" });
  cache.set(SETTINGS, JSON.stringify({ ...loadSettings(), major: "Mathematics" }));
  await flushTimers();
  assert.equal((await readRecord()).settings.major, "This tab's edit", "a push sends this tab's own view, not another tab's cache");

  // An edited last base resume survives a rebase; other settings take the newer record.
  saveLastBaseResumeName("mine.resume");
  await writeExternal({ profileBackground: "Changed again" });
  await flushTimers();
  assert.equal((await readRecord()).lastBaseResume, "mine.resume");
  assert.equal((await readRecord()).settings.profileBackground, "Changed again");

  // An edit made while a write is in flight stays pending and is written next.
  beforePost = () => {
    beforePost = null;
    saveSettings({ ...loadSettings(), customInstructions: "During flight" });
  };
  saveSettings({ ...loadSettings(), major: "Before flight" });
  await flushTimers();
  assert.equal((await readRecord()).settings.major, "Before flight");
  assert.equal(cache.get(PENDING), "1", "the in-flight edit is still pending");
  await flushTimers();
  assert.equal((await readRecord()).settings.customInstructions, "During flight");
  assert.equal(cache.has(PENDING), false);

  // A record that changes before every attempt stops after one rebase and retry.
  const postsBeforeBound = posts;
  let bump = 0;
  beforePost = () => writeExternal({ major: `Racing writer ${bump += 1}` });
  saveSettings({ ...loadSettings(), customInstructions: "Contended" });
  assert.equal(await flushTimers(), "error");
  assert.equal(posts - postsBeforeBound, 2, "a persistently stale write is attempted at most twice");
  assert.equal(cache.get(PENDING), "1", "the contended edit remains pending");
  beforePost = null;
  await sync.adoptWorkspacePreferences();
  assert.equal((await readRecord()).settings.customInstructions, "Contended", "the next focus writes the pending edit");
  assert.equal((await readRecord()).settings.major, "Racing writer 2");

  // Settings reset clears every setting this tab knew; the hook then re-saves
  // its materialized defaults, which must not leave removals pending.
  clearStoredSettings();
  saveSettings(materializeAiSettings({}));
  await flushTimers();
  assert.equal((await readRecord()).settings.customInstructions, "", "a reset writes the cleared settings");
  assert.equal(cache.has(PENDING), false, "a reset and its default re-save leave no pending removals");
  await writeExternal({ customInstructions: "Set elsewhere after the reset" });
  sync = await reloadClient();
  assert.equal(
    (await readRecord()).settings.customInstructions,
    "Set elsewhere after the reset",
    "a reload after a reset cannot delete a newer outside value"
  );

  // When the boot write fails, the recovered edit is what the hook mounts from.
  const cacheBeforeRecovery = cache.get(SETTINGS);
  saveSettings({ ...loadSettings(), major: "Recovered offline" });
  cache.set(SETTINGS, cacheBeforeRecovery);
  beforePost = () => { throw new Error("server unavailable"); };
  sync = await reloadClient();
  assert.equal(loadSettings().major, "Recovered offline", "a failed boot write still restores the recorded edit into the cache");
  beforePost = null;
  await sync.adoptWorkspacePreferences();
  assert.equal((await readRecord()).settings.major, "Recovered offline");
  assert.equal(cache.has(PENDING), false);

  // An unseen restore wins over edits made before it.
  saveSettings({ ...loadSettings(), customInstructions: "Pre-restore edit" });
  await writeStoredWorkspacePreferences(
    workspace,
    { settings: { profileBackground: "Restored" }, lastBaseResume: "restored.resume" },
    "restore",
    new Date("2026-09-30T12:00:00.000Z")
  );
  await flushTimers();
  const restored = await readRecord();
  assert.equal(restored.source, "restore", "pre-restore edits never overwrite an unseen restore");
  assert.deepEqual(restored.settings, { profileBackground: "Restored" });
  assert.deepEqual(loadSettings(), { profileBackground: "Restored" }, "the client adopts the restore");
  assert.equal(cache.has(PENDING), false, "the dropped pre-restore edit leaves no pending write");

  // A marker from the build that marked every save names no edit and is discarded.
  const beforeLegacy = await readFile(file, "utf8");
  const postsBeforeLegacy = posts;
  saveSettings({ profileBackground: "Stale cached copy" });
  cache.delete("rolefit:workspace-preferences-pending-edits");
  cache.set(PENDING, "1");
  sync = await reloadClient();
  assert.equal(posts, postsBeforeLegacy, "a legacy pending marker never replays its stale cache");
  assert.equal(await readFile(file, "utf8"), beforeLegacy);
  assert.equal(cache.has(PENDING), false);
  assert.equal(loadSettings().profileBackground, "Restored");

  // An edit record from an earlier development build is invalid and discarded too.
  cache.set(PENDING, "1");
  cache.set(EDITS, JSON.stringify({ settingKeys: ["profileBackground"], lastBaseResume: false, baseUpdatedAt: null }));
  saveSettings({ profileBackground: "Stale cached copy" });
  cache.set(EDITS, JSON.stringify({ settingKeys: ["profileBackground"], lastBaseResume: false, baseUpdatedAt: null }));
  sync = await reloadClient();
  assert.equal(posts, postsBeforeLegacy);
  assert.equal(loadSettings().profileBackground, "Restored");

  // Per-stage instructions rebase entry by entry, including removals.
  await writeExternal({ stageCustomInstructions: { "resume-polish": "Resume A", "cover-polish": "Cover A" } });
  sync = await reloadClient();
  saveSettings({ ...loadSettings(), stageCustomInstructions: { "resume-polish": "Resume mine", "cover-polish": "Cover A" } });
  await writeExternal({ stageCustomInstructions: { "resume-polish": "Resume A", "cover-polish": "Cover theirs" } });
  await flushTimers();
  assert.deepEqual(
    (await readRecord()).settings.stageCustomInstructions,
    { "resume-polish": "Resume mine", "cover-polish": "Cover theirs" },
    "one stage's edit keeps another stage's newer instructions"
  );
  saveSettings({ ...loadSettings(), stageCustomInstructions: { "cover-polish": "Cover theirs" } });
  await writeExternal({ stageCustomInstructions: { "resume-polish": "Resume mine", "cover-polish": "Cover newest" } });
  await flushTimers();
  assert.deepEqual(
    (await readRecord()).settings.stageCustomInstructions,
    { "cover-polish": "Cover newest" },
    "a removed stage entry stays removed without dropping another stage's edit"
  );
  assert.equal(cache.has(PENDING), false);

  // Variant exclusions rebase per variant, the same way.
  await writeExternal({ excludedResumeVariants: { "old-draft.resume": true } });
  sync = await reloadClient();
  saveSettings({ ...loadSettings(), excludedResumeVariants: { "old-draft.resume": true, "experiment.resume": true } });
  await writeExternal({ excludedResumeVariants: { "old-draft.resume": true, "growth.resume": true } });
  await flushTimers();
  assert.deepEqual(
    (await readRecord()).settings.excludedResumeVariants,
    { "old-draft.resume": true, "growth.resume": true, "experiment.resume": true },
    "one tab's exclusion keeps another tab's newer exclusion"
  );
  saveSettings({ ...loadSettings(), excludedResumeVariants: { "growth.resume": true, "experiment.resume": true } });
  await writeExternal({
    excludedResumeVariants: { "old-draft.resume": true, "growth.resume": true, "experiment.resume": true, "newest.resume": true }
  });
  await flushTimers();
  assert.deepEqual(
    (await readRecord()).settings.excludedResumeVariants,
    { "growth.resume": true, "experiment.resume": true, "newest.resume": true },
    "a re-included variant stays eligible without dropping another tab's exclusion"
  );
  assert.equal(cache.has(PENDING), false);
  const beforeMalformed = await readFile(file, "utf8");
  const malformed = await fetch("/api/workspace/preferences", {
    method: "POST",
    body: JSON.stringify({ settings: { excludedResumeVariants: ["growth.resume"] }, lastBaseResume: "", baseRevision: null })
  });
  assert.equal(malformed.status, 400, "the route rejects an exclusion list that is not a record");
  assert.equal(await readFile(file, "utf8"), beforeMalformed, "a rejected exclusion write leaves the record untouched");

  // Another tab acknowledges a restore while this tab still holds pre-restore edits.
  saveSettings({ ...loadSettings(), customInstructions: "Suspended tab edit" });
  await writeStoredWorkspacePreferences(
    workspace,
    { settings: { profileBackground: "Second restore" }, lastBaseResume: "restored.resume" },
    "restore",
    new Date("2026-10-01T12:00:00.000Z")
  );
  const secondRestore = await (await fetch("/api/workspace/preferences")).json();
  cache.set("rolefit:adoptedRestoreStamp", secondRestore.restoreStamp);
  cache.delete(PENDING);
  cache.delete(EDITS);
  await flushTimers();
  const afterSecondRestore = await readRecord();
  assert.equal(afterSecondRestore.source, "restore", "a restore another tab acknowledged still drops this tab's pre-restore edits");
  assert.deepEqual(afterSecondRestore.settings, { profileBackground: "Second restore" });
  assert.deepEqual(loadSettings(), { profileBackground: "Second restore" });
  assert.equal(cache.has(PENDING), false);

  // Settings that resolve against a sibling are released once saved.
  saveSettings({ ...loadSettings(), resumePolishProvider: "codex-cli", resumePolishSelectedModel: "gpt-6.1-sol" });
  await flushTimers();
  saveSettings({ ...loadSettings(), resumePolishSelectedModel: "gpt-6-astra" });
  await flushTimers();
  assert.equal((await readRecord()).settings.resumePolishSelectedModel, "gpt-6-astra");
  assert.equal(cache.has(PENDING), false, "a saved model-only edit on a non-default provider leaves no pending record");
  saveSettings({ ...loadSettings(), availabilityNotice: "specific-date", availabilityDate: "2026-11-01" });
  await flushTimers();
  saveSettings({ ...loadSettings(), availabilityDate: "2026-12-01" });
  await flushTimers();
  assert.equal((await readRecord()).settings.availabilityDate, "2026-12-01");
  assert.equal(cache.has(PENDING), false, "a saved date-only edit leaves no pending record");

  // A tab closes with an unpushed edit; a restore is then adopted by another tab.
  beforePost = () => { throw new Error("server unavailable"); };
  saveSettings({ ...loadSettings(), customInstructions: "Closed before restore" });
  assert.equal(await flushTimers(), "error");
  beforePost = null;
  await writeStoredWorkspacePreferences(
    workspace,
    { settings: { profileBackground: "Third restore" }, lastBaseResume: "restored.resume" },
    "restore",
    new Date("2026-10-02T12:00:00.000Z")
  );
  const thirdRestore = await (await fetch("/api/workspace/preferences")).json();
  cache.set("rolefit:adoptedRestoreStamp", thirdRestore.restoreStamp);
  sync = await reloadClient();
  assert.deepEqual(
    (await readRecord()).settings,
    { profileBackground: "Third restore" },
    "a recorded pre-restore edit is not recovered after another tab adopted the restore"
  );
  assert.deepEqual(loadSettings(), { profileBackground: "Third restore" });
  assert.equal(cache.has(PENDING), false);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("workspace preferences conflict probes passed");
