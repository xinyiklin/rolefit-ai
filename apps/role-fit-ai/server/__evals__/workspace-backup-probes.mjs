import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertWorkspaceBackupCapacity,
  createWorkspaceBackup,
  restoreWorkspaceBackup,
  WorkspaceBackupError
} from "../workspaceBackup.ts";
import { writeStoredBrowserPreferences } from "../browserPreferences.ts";
import { countActiveTabs, isValidPresenceTabId } from "../presence.ts";
import { withWorkspaceLock } from "../workspace.ts";
import {
  beginWorkspaceRestore,
  endWorkspaceRestore,
  noteWorkspacePresenceAttempt,
  workspaceRestoreHadPresenceAttempt,
  WorkspaceRestoreConflictError
} from "../workspaceRestoreGate.ts";
import {
  BROWSER_PREFERENCES_FILE_NAME,
  MAX_WORKSPACE_BACKUP_BYTES,
  MAX_WORKSPACE_BACKUP_FILES,
  WORKSPACE_RESTORE_MARKER_FILE_NAME,
  parseStoredWorkspaceRestoreMarker,
  parseWorkspaceBackupEnvelope
} from "../../src/lib/workspaceBackupContract.ts";

const appRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const starterText = await readFile(join(appRoot, "server", "starter.resume"), "utf8");
const isolatedRoot = await mkdtemp(join(tmpdir(), "rolefit-workspace-backup-"));
const sourceDir = join(isolatedRoot, "source-workspace");
const targetDir = join(isolatedRoot, "target-workspace");
const fixedDate = new Date("2026-07-20T12:00:00.000Z");

function digest(data) {
  return createHash("sha256").update(data).digest("hex");
}

function replaceEntry(envelope, path, data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  return {
    ...envelope,
    files: envelope.files.map((file) => file.path === path
      ? {
          ...file,
          byteLength: buffer.length,
          sha256: digest(buffer),
          data: buffer.toString(file.encoding === "base64" ? "base64" : "utf8")
        }
      : file)
  };
}

async function snapshot(directory) {
  const names = (await readdir(directory, { withFileTypes: true }))
    .map((entry) => `${entry.isDirectory() ? "d" : "f"}:${entry.name}`)
    .sort();
  const base = await readFile(join(directory, "base-resume.resume"), "utf8");
  return { names, base };
}

try {
  await mkdir(join(sourceDir, ".trash"), { recursive: true });
  await mkdir(join(sourceDir, "applications", "application-1"), { recursive: true });

  const portableResume = JSON.parse(starterText);
  portableResume.document.name = "Portable Candidate";
  const portableResumeText = JSON.stringify(portableResume, null, 2);
  await writeFile(join(sourceDir, "base-resume.resume"), portableResumeText, "utf8");
  await writeFile(
    join(sourceDir, ".trash", "2026-07-19T12-00-00-000Z__base-resume.resume"),
    starterText,
    "utf8"
  );
  await writeFile(
    join(sourceDir, "applications.json"),
    JSON.stringify({ savedAt: fixedDate.toISOString(), applications: [] }, null, 2),
    "utf8"
  );
  await writeFile(join(sourceDir, "applications", "application-1", "resume.pdf"), "%PDF-1.7\nportable", "utf8");
  await writeFile(join(sourceDir, "notes-private.txt"), "not app-managed", "utf8");
  await symlink(join(sourceDir, "base-resume.resume"), join(sourceDir, "base-resume-linked.resume"));

  const backup = await createWorkspaceBackup(sourceDir, fixedDate);
  assert.equal(backup.format, "rolefit-workspace-backup");
  assert.equal(backup.schemaVersion, 1);
  assert.deepEqual(
    backup.files.map((file) => file.path),
    [
      ".trash/2026-07-19T12-00-00-000Z__base-resume.resume",
      "applications.json",
      "applications/application-1/resume.pdf",
      "base-resume.resume"
    ],
    "export contains every app-managed file and excludes arbitrary files and symlinks"
  );
  assert.equal(backup.files.find((file) => file.path.endsWith("resume.pdf"))?.encoding, "base64");
  assert.equal(backup.files.find((file) => file.path === "applications.json")?.encoding, "utf8");

  const withBrowser = parseWorkspaceBackupEnvelope({
    ...backup,
    browser: {
      settings: { polishStages: "both", honestContext: "Grounded experience only" },
      lastBaseResume: "base-resume.resume"
    }
  });
  assert.equal(withBrowser.browser?.settings.polishStages, "both", "portable browser preferences survive contract parsing");
  assert.throws(
    () => parseWorkspaceBackupEnvelope({
      ...backup,
      browser: { settings: { polishStages: "both", credential: "must-not-travel" }, lastBaseResume: "base-resume.resume" }
    }),
    /unsupported or invalid values/,
    "portable preferences reject settings outside the owned allowlist"
  );
  assert.throws(
    () => parseWorkspaceBackupEnvelope({
      ...backup,
      browser: { settings: { polishStages: "both" }, lastBaseResume: "../private.resume" }
    }),
    /selected base resume is invalid/,
    "portable preferences reject non-managed base-resume names"
  );

  await mkdir(targetDir, { recursive: true });
  await writeFile(join(targetDir, "base-resume.resume"), starterText, "utf8");
  await writeFile(join(targetDir, "keep-me.txt"), "previous unknown workspace file", "utf8");

  const result = await restoreWorkspaceBackup(targetDir, withBrowser, fixedDate);
  assert.equal(result.restoredFiles, 4);
  assert.equal(result.previousWorkspaceKept, true);
  assert.equal(JSON.parse(await readFile(join(targetDir, "base-resume.resume"), "utf8")).document.name, "Portable Candidate");
  assert.equal(await readFile(join(targetDir, "applications", "application-1", "resume.pdf"), "utf8"), "%PDF-1.7\nportable");
  const siblings = await readdir(isolatedRoot);
  const safetyCopy = siblings.find((name) => name.startsWith("target-workspace.restore-backup-"));
  assert.ok(safetyCopy, "restore retains the complete previous workspace as a sibling safety copy");
  assert.equal(
    await readFile(join(isolatedRoot, safetyCopy, "keep-me.txt"), "utf8"),
    "previous unknown workspace file",
    "unmanaged previous files remain recoverable"
  );

  const roundTrip = await createWorkspaceBackup(targetDir, fixedDate);
  assert.deepEqual(
    roundTrip.files.map(({ path, byteLength, sha256 }) => ({ path, byteLength, sha256 })),
    backup.files.map(({ path, byteLength, sha256 }) => ({ path, byteLength, sha256 })),
    "backup -> restore -> backup preserves every managed byte"
  );

  // The restore staged envelope.browser into the new workspace as a
  // source:"restore" mirror. It sits beside the resumes and is not a listed file.
  const restoredMirror = JSON.parse(await readFile(join(targetDir, BROWSER_PREFERENCES_FILE_NAME), "utf8"));
  assert.equal(restoredMirror.source, "restore", "restore writes the browser-preferences mirror with source:restore");
  assert.equal(restoredMirror.format, "rolefit-browser-preferences");
  assert.equal(restoredMirror.schemaVersion, 1);
  assert.equal(restoredMirror.settings.polishStages, "both", "the restored mirror carries the envelope's browser settings");
  assert.equal(restoredMirror.lastBaseResume, "base-resume.resume");
  const restoredMarker = parseStoredWorkspaceRestoreMarker(
    JSON.parse(await readFile(join(targetDir, WORKSPACE_RESTORE_MARKER_FILE_NAME), "utf8"))
  );
  assert.equal(restoredMarker.restoredAt, fixedDate.toISOString(), "every restore records its generation independently");

  // A backup without optional browser preferences still records the restore so
  // the next browser load can clear recovery drafts from the previous workspace.
  const noBrowserTarget = join(isolatedRoot, "no-browser-target");
  await mkdir(noBrowserTarget, { recursive: true });
  await writeFile(join(noBrowserTarget, "base-resume.resume"), starterText, "utf8");
  await restoreWorkspaceBackup(noBrowserTarget, backup, fixedDate);
  await assert.rejects(
    () => readFile(join(noBrowserTarget, BROWSER_PREFERENCES_FILE_NAME), "utf8"),
    (error) => error && error.code === "ENOENT",
    "a preference-less restore does not invent browser preferences"
  );
  const noBrowserMarker = parseStoredWorkspaceRestoreMarker(
    JSON.parse(await readFile(join(noBrowserTarget, WORKSPACE_RESTORE_MARKER_FILE_NAME), "utf8"))
  );
  assert.equal(noBrowserMarker.restoredAt, fixedDate.toISOString(), "a preference-less restore still records its generation");

  const beforeFailedRestore = await snapshot(targetDir);

  // A live Drafting Desk tab blocks restore with a 409 before any staging.
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, withBrowser, fixedDate, 1),
    (error) => error instanceof WorkspaceBackupError
      && error.status === 409
      && /Close RoleFit browser tabs/.test(error.message),
    "a live browser tab blocks restore with a 409-classed error"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "the presence gate rejects before touching the active workspace");

  // Presence is read again after staging, immediately before replacement. A tab
  // that appears during a queued/slow restore must leave the active workspace intact.
  let presenceChecks = 0;
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, withBrowser, fixedDate, () => ++presenceChecks === 1 ? 0 : 1),
    (error) => error instanceof WorkspaceBackupError && error.status === 409,
    "a tab appearing during staging blocks the replacement boundary"
  );
  assert.equal(presenceChecks, 2, "restore checks presence both before staging and before replacement");
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "a late presence refusal leaves the active workspace unchanged");

  let postRenamePresenceChecks = 0;
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, withBrowser, fixedDate, () => ++postRenamePresenceChecks < 3 ? 0 : 1),
    (error) => error instanceof WorkspaceBackupError && error.status === 409,
    "a tab arriving after the previous workspace rename triggers rollback"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "post-rename presence restores the previous active workspace");

  let postInstallPresenceChecks = 0;
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, withBrowser, fixedDate, () => ++postInstallPresenceChecks < 4 ? 0 : 1),
    (error) => error instanceof WorkspaceBackupError && error.status === 409,
    "a tab arriving while the staged workspace is installed still triggers rollback"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "post-install presence restores the previous active workspace");

  const badChecksum = structuredClone(withBrowser);
  badChecksum.files[0].sha256 = "0".repeat(64);
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, badChecksum, fixedDate),
    (error) => error instanceof WorkspaceBackupError && /integrity check/.test(error.message),
    "checksum mismatch is rejected"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "checksum failure leaves active workspace unchanged");

  const invalidTracker = replaceEntry(
    withBrowser,
    "applications.json",
    JSON.stringify({ applications: [{ invalid: true }] })
  );
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, invalidTracker, fixedDate),
    (error) => error instanceof WorkspaceBackupError && /tracker data is invalid/.test(error.message),
    "invalid tracker data is rejected after integrity validation"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "tracker validation failure leaves active workspace unchanged");

  const invalidResume = replaceEntry(withBrowser, "base-resume.resume", "{" + "x".repeat(100));
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, invalidResume, fixedDate),
    (error) => error instanceof WorkspaceBackupError && /base-resume file/.test(error.message),
    "invalid strict resume data is rejected"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "resume validation failure leaves active workspace unchanged");

  const invalidPdf = replaceEntry(withBrowser, "applications/application-1/resume.pdf", "not a pdf");
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, invalidPdf, fixedDate),
    (error) => error instanceof WorkspaceBackupError && /invalid saved application PDF/.test(error.message),
    "invalid PDF data is rejected"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "PDF validation failure leaves active workspace unchanged");

  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, { ...withBrowser, files: [...withBrowser.files, withBrowser.files[0]] }, fixedDate),
    /duplicate file path/,
    "duplicate paths are rejected"
  );
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, {
      ...withBrowser,
      files: [{ ...withBrowser.files[0], path: "../outside.resume" }]
    }, fixedDate),
    /unsupported file path/,
    "path traversal is rejected"
  );

  // --- Browser-preferences mirror <-> backup envelope ---
  const prefsDir = join(isolatedRoot, "prefs-workspace");
  await mkdir(prefsDir, { recursive: true });
  await writeFile(join(prefsDir, "base-resume.resume"), portableResumeText, "utf8");

  // No mirror yet: backup omits browser and never lists the mirror file.
  const withoutMirror = await createWorkspaceBackup(prefsDir, fixedDate);
  assert.equal(withoutMirror.browser, undefined, "backup omits browser when no mirror file exists");
  assert.ok(
    !withoutMirror.files.some((file) => file.path === BROWSER_PREFERENCES_FILE_NAME),
    "the browser-preferences mirror is never listed as a backed-up file"
  );

  // A valid mirror is folded into envelope.browser but still excluded from files.
  await writeStoredBrowserPreferences(
    prefsDir,
    { settings: { polishStages: "review", honestContext: "" }, lastBaseResume: "base-resume.resume" },
    "mirror",
    fixedDate
  );
  const withMirror = await createWorkspaceBackup(prefsDir, fixedDate);
  assert.equal(withMirror.browser?.settings.polishStages, "review", "a valid mirror is folded into envelope.browser");
  assert.equal(withMirror.browser?.lastBaseResume, "base-resume.resume");
  assert.ok(
    !withMirror.files.some((file) => file.path === BROWSER_PREFERENCES_FILE_NAME),
    "a present mirror is still excluded from the backed-up file list"
  );

  // A corrupt mirror must not block backing up resumes: browser is omitted.
  await writeFile(join(prefsDir, BROWSER_PREFERENCES_FILE_NAME), "{ not valid json", "utf8");
  const corruptMirror = await createWorkspaceBackup(prefsDir, fixedDate);
  assert.equal(corruptMirror.browser, undefined, "a corrupt mirror is skipped and does not block the backup");
  assert.equal(corruptMirror.files.length, withMirror.files.length, "resume files still back up with a corrupt mirror present");

  // Capacity checks are explicit pre-allocation boundaries, not a final parser
  // pass after all file bodies have already accumulated in memory.
  assert.doesNotThrow(() => assertWorkspaceBackupCapacity(MAX_WORKSPACE_BACKUP_FILES, MAX_WORKSPACE_BACKUP_BYTES));
  assert.throws(
    () => assertWorkspaceBackupCapacity(MAX_WORKSPACE_BACKUP_FILES + 1, 0),
    (error) => error instanceof WorkspaceBackupError && error.status === 413 && /too many managed files/.test(error.message)
  );
  assert.throws(
    () => assertWorkspaceBackupCapacity(1, MAX_WORKSPACE_BACKUP_BYTES + 1),
    (error) => error instanceof WorkspaceBackupError && error.status === 413 && /64 MB limit/.test(error.message)
  );

  // --- Presence tab-id contract ---
  assert.equal(isValidPresenceTabId("tab_ABC-123"), true, "allowed-charset tab ids validate");
  assert.equal(isValidPresenceTabId("a".repeat(64)), true, "64-char tab ids are the upper bound");
  assert.equal(isValidPresenceTabId(""), false, "empty tab ids are rejected");
  assert.equal(isValidPresenceTabId("a".repeat(65)), false, "over-length tab ids are rejected");
  assert.equal(isValidPresenceTabId("tab id"), false, "whitespace is rejected");
  assert.equal(isValidPresenceTabId("tab/../etc"), false, "path and charset violations are rejected");
  assert.equal(countActiveTabs(), 0, "no presence beats have been recorded in this probe process");

  // A request queued before a restore began must not wake afterward and write
  // its stale pre-restore state over the newly installed generation.
  let releaseQueue;
  const queueBlocker = withWorkspaceLock(() => new Promise((resolve) => { releaseQueue = resolve; }));
  await Promise.resolve();
  const staleQueuedWrite = withWorkspaceLock(async () => "must-not-run");
  const restoreToken = beginWorkspaceRestore();
  noteWorkspacePresenceAttempt();
  assert.equal(workspaceRestoreHadPresenceAttempt(), true, "a tab arrival attempt is visible to the active restore");
  releaseQueue();
  await queueBlocker;
  await assert.rejects(
    staleQueuedWrite,
    (error) => error instanceof WorkspaceRestoreConflictError && error.status === 409,
    "a storage request queued across a restore generation is rejected"
  );
  endWorkspaceRestore(restoreToken);

  console.log("workspace backup probes: PASS");
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
