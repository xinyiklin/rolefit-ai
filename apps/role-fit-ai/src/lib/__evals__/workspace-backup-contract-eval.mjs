// Probes for the four parse*/validate boundary functions in
// src/lib/workspaceBackupContract.ts. Each function is a fail-closed gate on
// untrusted JSON (browser localStorage, a restored workspace file, or a
// portable backup someone hand-edited) — happy path plus malformed-input
// rejection (wrong types, unknown keys, null, truncated) for all four.
//
//   node src/lib/__evals__/workspace-backup-contract-eval.mjs

import assert from "node:assert/strict";

import {
  BROWSER_PREFERENCES_FORMAT,
  BROWSER_PREFERENCES_SCHEMA_VERSION,
  WORKSPACE_BACKUP_FORMAT,
  WORKSPACE_BACKUP_SCHEMA_VERSION,
  WORKSPACE_RESTORE_MARKER_FORMAT,
  WORKSPACE_RESTORE_MARKER_SCHEMA_VERSION,
  MAX_WORKSPACE_BACKUP_FILES,
  isManagedWorkspaceBackupPath,
  parsePortableBrowserPreferences,
  parseStoredBrowserPreferences,
  parseStoredWorkspaceRestoreMarker,
  parseWorkspaceBackupEnvelope
} from "../workspaceBackupContract.ts";

const RESTORED_AT = "2026-07-18T12:00:00.000Z";

// ── parseStoredWorkspaceRestoreMarker ───────────────────────────────────────

const validMarker = { format: WORKSPACE_RESTORE_MARKER_FORMAT, schemaVersion: WORKSPACE_RESTORE_MARKER_SCHEMA_VERSION, restoredAt: RESTORED_AT };
assert.deepEqual(parseStoredWorkspaceRestoreMarker(validMarker), validMarker, "a well-formed restore marker parses through unchanged");

for (const [name, bad] of [
  ["null", null],
  ["a string, not a record", "not-an-object"],
  ["an array", [validMarker]],
  ["missing restoredAt", { format: WORKSPACE_RESTORE_MARKER_FORMAT, schemaVersion: WORKSPACE_RESTORE_MARKER_SCHEMA_VERSION }],
  ["an unknown extra key", { ...validMarker, extra: true }],
  ["wrong format string", { ...validMarker, format: "some-other-format" }],
  ["wrong schemaVersion", { ...validMarker, schemaVersion: 2 }],
  ["non-string restoredAt", { ...validMarker, restoredAt: 12345 }],
  ["unparseable restoredAt", { ...validMarker, restoredAt: "not-a-date" }],
  ["truncated: only format", { format: WORKSPACE_RESTORE_MARKER_FORMAT }]
]) {
  assert.throws(() => parseStoredWorkspaceRestoreMarker(bad), `parseStoredWorkspaceRestoreMarker rejects ${name}`);
}

// ── parsePortableBrowserPreferences ─────────────────────────────────────────

const emptyPortable = { settings: {}, lastBaseResume: "" };
assert.deepEqual(parsePortableBrowserPreferences(emptyPortable), emptyPortable, "empty settings + empty lastBaseResume is valid (a fresh browser with nothing saved yet)");

const knownSettingPortable = {
  settings: { aiProvider: "openai", selectedModel: "gpt-5.6-terra", polishStages: "both", citizenshipStatus: "us-citizen" },
  lastBaseResume: "base-resume-sde.resume"
};
assert.deepEqual(
  parsePortableBrowserPreferences(knownSettingPortable),
  knownSettingPortable,
  "a settings bag of known, already-normalized keys/values round-trips unchanged"
);
// The legacy strictReview boolean is a MIGRATION field, not a stable value:
// normalizeSettings adds a derived polishStages key alongside it, so an input
// carrying bare legacy strictReview never round-trips — lock that as expected
// rejection here rather than accidentally treating it as "happy path".
assert.throws(
  () => parsePortableBrowserPreferences({ settings: { strictReview: true }, lastBaseResume: "" }),
  "a bare legacy strictReview value is migrated (polishStages added) rather than round-tripping unchanged, so it is rejected here by design"
);

for (const [name, bad] of [
  ["null", null],
  ["a string", "settings"],
  ["missing lastBaseResume", { settings: {} }],
  ["missing settings", { lastBaseResume: "" }],
  ["an unknown extra key", { settings: {}, lastBaseResume: "", extra: 1 }],
  ["settings as an array", { settings: [], lastBaseResume: "" }],
  ["settings as a string", { settings: "aiProvider=openai", lastBaseResume: "" }],
  // normalizeSettings silently drops an unrecognized provider value, so the
  // input/normalized key sets diverge and the strict round-trip check throws
  // — this is how the module catches "unsupported or invalid" settings values.
  ["an unsupported provider value normalizeSettings would strip", { settings: { aiProvider: "not-a-real-provider" }, lastBaseResume: "" }],
  ["an unrecognized settings key normalizeSettings would strip", { settings: { notARealSetting: true }, lastBaseResume: "" }],
  ["a wrong-typed known setting value normalizeSettings would strip", { settings: { strictReview: "yes" }, lastBaseResume: "" }],
  ["settings JSON over the 100,000-byte cap", { settings: { customInstructions: "x".repeat(150_000) }, lastBaseResume: "" }],
  ["lastBaseResume over 200 chars", { settings: {}, lastBaseResume: `base-resume-${"a".repeat(200)}.resume` }],
  ["lastBaseResume not matching the base-resume filename contract", { settings: {}, lastBaseResume: "../../etc/passwd" }],
  ["lastBaseResume with an unsupported extension", { settings: {}, lastBaseResume: "base-resume.pdf" }]
]) {
  assert.throws(() => parsePortableBrowserPreferences(bad), `parsePortableBrowserPreferences rejects ${name}`);
}

// ── parseStoredBrowserPreferences ───────────────────────────────────────────

const validStoredPrefs = {
  format: BROWSER_PREFERENCES_FORMAT,
  schemaVersion: BROWSER_PREFERENCES_SCHEMA_VERSION,
  updatedAt: RESTORED_AT,
  source: "mirror",
  settings: { aiProvider: "openai" },
  lastBaseResume: ""
};
assert.deepEqual(parseStoredBrowserPreferences(validStoredPrefs), validStoredPrefs, "a well-formed mirror preferences record parses through unchanged");
assert.deepEqual(
  parseStoredBrowserPreferences({ ...validStoredPrefs, source: "restore" }),
  { ...validStoredPrefs, source: "restore" },
  "source: 'restore' is the other valid enum value"
);

for (const [name, bad] of [
  ["null", null],
  ["an array", [validStoredPrefs]],
  ["an unknown extra key", { ...validStoredPrefs, extra: true }],
  ["missing source", { format: validStoredPrefs.format, schemaVersion: validStoredPrefs.schemaVersion, updatedAt: RESTORED_AT, settings: {}, lastBaseResume: "" }],
  ["wrong format string", { ...validStoredPrefs, format: "wrong-format" }],
  ["wrong schemaVersion", { ...validStoredPrefs, schemaVersion: 99 }],
  ["non-string updatedAt", { ...validStoredPrefs, updatedAt: null }],
  ["unparseable updatedAt", { ...validStoredPrefs, updatedAt: "yesterday" }],
  ["invalid source enum value", { ...validStoredPrefs, source: "backup" }],
  ["settings/lastBaseResume delegated-validation failure (bad settings)", { ...validStoredPrefs, settings: "not-a-record" }],
  ["truncated: only format+schemaVersion", { format: validStoredPrefs.format, schemaVersion: validStoredPrefs.schemaVersion }]
]) {
  assert.throws(() => parseStoredBrowserPreferences(bad), `parseStoredBrowserPreferences rejects ${name}`);
}

// ── parseWorkspaceBackupEnvelope ─────────────────────────────────────────────

function backupFile(overrides = {}) {
  return {
    path: "applications.json",
    encoding: "utf8",
    byteLength: 2,
    sha256: "a".repeat(64),
    data: "{}",
    ...overrides
  };
}

const validEnvelope = {
  format: WORKSPACE_BACKUP_FORMAT,
  schemaVersion: WORKSPACE_BACKUP_SCHEMA_VERSION,
  createdAt: RESTORED_AT,
  files: [backupFile()]
};
assert.deepEqual(parseWorkspaceBackupEnvelope(validEnvelope), validEnvelope, "a well-formed single-file envelope parses through unchanged");

const pdfFile = backupFile({
  path: "applications/acme-swe/resume.pdf",
  encoding: "base64",
  byteLength: 3,
  data: "AAA="
});
assert.deepEqual(
  parseWorkspaceBackupEnvelope({ ...validEnvelope, files: [backupFile(), pdfFile] }).files.map((f) => f.path),
  ["applications.json", "applications/acme-swe/resume.pdf"],
  "an application PDF (base64-encoded, per workspaceBackupEncodingForPath) is a managed path alongside applications.json"
);

const withBrowser = {
  ...validEnvelope,
  browser: { settings: { aiProvider: "openai" }, lastBaseResume: "" }
};
assert.deepEqual(parseWorkspaceBackupEnvelope(withBrowser), withBrowser, "the optional browser field delegates to parsePortableBrowserPreferences and round-trips");

for (const [name, bad] of [
  ["null", null],
  ["a string", "backup"],
  ["missing files", { format: validEnvelope.format, schemaVersion: validEnvelope.schemaVersion, createdAt: RESTORED_AT }],
  ["an unknown extra top-level key", { ...validEnvelope, extra: true }],
  ["wrong format string", { ...validEnvelope, format: "wrong-format" }],
  ["wrong schemaVersion", { ...validEnvelope, schemaVersion: 2 }],
  ["non-string createdAt", { ...validEnvelope, createdAt: 123 }],
  ["unparseable createdAt", { ...validEnvelope, createdAt: "not-a-date" }],
  ["files not an array", { ...validEnvelope, files: {} }],
  ["files over MAX_WORKSPACE_BACKUP_FILES", { ...validEnvelope, files: Array.from({ length: MAX_WORKSPACE_BACKUP_FILES + 1 }, (_, i) => backupFile({ path: "applications.json" })) }],
  ["an invalid browser field", { ...validEnvelope, browser: { settings: "nope", lastBaseResume: "" } }],
  ["truncated: only format", { format: validEnvelope.format }]
]) {
  assert.throws(() => parseWorkspaceBackupEnvelope(bad), `parseWorkspaceBackupEnvelope rejects ${name}`);
}

// File-record-level malformed input (each still wrapped in an otherwise-valid envelope).
for (const [name, badFile] of [
  ["missing a required file key", { path: "applications.json", encoding: "utf8", byteLength: 2, data: "{}" }],
  ["an unknown extra file key", backupFile({ extra: true })],
  ["a path outside the managed allowlist", backupFile({ path: "secrets.json" })],
  ["a path with a backslash", backupFile({ path: "applications\\acme\\resume.pdf" })],
  ["a path with a leading slash", backupFile({ path: "/applications.json" })],
  ["a path with a .. segment", backupFile({ path: "../applications.json" })],
  ["a duplicate path across two files", "DUPLICATE"],
  ["an encoding that mismatches the path's contract (pdf declared utf8)", { path: "applications/acme-swe/resume.pdf", encoding: "utf8", byteLength: 2, sha256: "a".repeat(64), data: "{}" }],
  ["an encoding value outside utf8/base64", backupFile({ encoding: "binary" })],
  ["a non-integer byteLength", backupFile({ byteLength: 1.5 })],
  ["a negative byteLength", backupFile({ byteLength: -1 })],
  ["byteLength over MAX_WORKSPACE_BACKUP_FILE_BYTES", backupFile({ byteLength: 10_000_001 })],
  ["a non-numeric byteLength", backupFile({ byteLength: "2" })],
  ["a malformed sha256 (too short)", backupFile({ sha256: "abc" })],
  ["a malformed sha256 (uppercase hex)", backupFile({ sha256: "A".repeat(64) })],
  ["a non-string data field", backupFile({ data: 123 })]
]) {
  const files = badFile === "DUPLICATE" ? [backupFile(), backupFile()] : [badFile];
  assert.throws(() => parseWorkspaceBackupEnvelope({ ...validEnvelope, files }), `parseWorkspaceBackupEnvelope rejects a file record with ${name}`);
}

// Total-bytes cap: declared byteLength sums across files trip the aggregate
// guard even though the actual `data` strings here are tiny — the contract
// trusts the declared byteLength for this early-exit accounting. Each file
// stays UNDER the per-file cap (10 MB) so this specifically exercises the
// aggregate 64 MB guard rather than tripping the per-file one first.
{
  const bigFiles = Array.from({ length: 8 }, (_, i) =>
    backupFile({ path: `base-resume-variant${i}.resume`, byteLength: 9_000_000 })
  ); // 8 x 9,000,000 = 72,000,000 > 64,000,000 aggregate cap
  assert.throws(
    () => parseWorkspaceBackupEnvelope({ ...validEnvelope, files: bigFiles }),
    "declared byteLength totals over the 64 MB aggregate cap are rejected even though every individual file is under the 10 MB per-file cap"
  );
}

// ── isManagedWorkspaceBackupPath sanity (used throughout the above) ─────────
assert.equal(isManagedWorkspaceBackupPath("applications.json"), true, "the tracker file is managed");
assert.equal(isManagedWorkspaceBackupPath("base-resume.resume"), true, "a root base resume is managed");
assert.equal(isManagedWorkspaceBackupPath("base-resume-fullstack.resume"), true, "a named root base resume is managed");
assert.equal(isManagedWorkspaceBackupPath("applications/acme-swe/resume.pdf"), true, "an application PDF is managed");
assert.equal(isManagedWorkspaceBackupPath("secrets.env"), false, "an arbitrary file is not managed");
assert.equal(isManagedWorkspaceBackupPath("../applications.json"), false, "a traversal path is never managed");

console.log("workspace-backup-contract probes passed");
