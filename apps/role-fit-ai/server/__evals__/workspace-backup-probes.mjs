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
import { writeStoredWorkspacePreferences } from "../workspacePreferences.ts";
import { writeApplications } from "../applications/storage.ts";
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
  WORKSPACE_PREFERENCES_FILE_NAME,
  MAX_WORKSPACE_BACKUP_BYTES,
  MAX_WORKSPACE_BACKUP_FILES,
  WORKSPACE_RESTORE_MARKER_FILE_NAME,
  parseStoredWorkspaceRestoreMarker,
  parseWorkspaceBackupEnvelope
} from "../../src/lib/workspaceBackupContract.ts";
import {
  COVER_LETTER_STYLE_DEFAULTS,
  coverLetterResumeData,
  serializeCoverLetterFile
} from "@typeset/engine/lib/coverLetter.ts";

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
  const base = await readFile(join(directory, "resumes", "default.resume"), "utf8");
  return { names, base };
}

try {
  await mkdir(join(sourceDir, "resumes", ".trash"), { recursive: true });
  await mkdir(join(sourceDir, "applications", "application-1", "attachments"), { recursive: true });

  const portableResume = JSON.parse(starterText);
  portableResume.document.header.name = "Portable Candidate";
  const portableResumeText = JSON.stringify(portableResume, null, 2);
  await writeFile(join(sourceDir, "resumes", "default.resume"), portableResumeText, "utf8");
  await writeFile(
    join(sourceDir, "resumes", ".trash", "2026-07-19T12-00-00-000Z__default.resume"),
    starterText,
    "utf8"
  );
  await writeApplications(sourceDir, [{
    id: "application-1",
    title: "Portable role",
    jobUrl: "",
    status: "applied",
    createdAt: fixedDate.toISOString(),
    updatedAt: fixedDate.toISOString(),
    resumeArtifacts: {
      hasPdf: false,
      hasSource: true,
      fileName: "Portable_Resume.resume",
      savedAt: fixedDate.toISOString()
    },
    coverLetterArtifacts: {
      hasPdf: false,
      hasSource: true,
      fileName: "Portable_Cover_Letter.cover",
      savedAt: fixedDate.toISOString()
    },
    attachments: [{
      fileName: "writing sample.pdf",
      label: "Writing sample",
      size: 21,
      contentType: "application/pdf",
      savedAt: fixedDate.toISOString()
    }]
  }]);
  await writeFile(join(sourceDir, "applications", "application-1", "resume.resume"), portableResumeText, "utf8");
  const portableCoverText = serializeCoverLetterFile(
    coverLetterResumeData(["Dear Hiring Team,"], {
      visible: true,
      name: "Portable Candidate",
      contact: ["portable@example.test"]
    }),
    COVER_LETTER_STYLE_DEFAULTS
  );
  await writeFile(join(sourceDir, "applications", "application-1", "cover.cover"), portableCoverText, "utf8");
  await writeFile(
    join(sourceDir, "applications", "application-1", "attachments", "writing sample.pdf"),
    "%PDF-1.7\nattachment",
    "utf8"
  );
  await writeFile(join(sourceDir, "notes-private.txt"), "not app-managed", "utf8");
  try {
    await symlink(
      join(sourceDir, "resumes", "default.resume"),
      join(sourceDir, "resumes", "linked.resume")
    );
  } catch (error) {
    // Windows requires Developer Mode or an elevated token for symlinks. The
    // rest of the backup contract remains testable when that capability is
    // unavailable; non-symlink files still exercise the managed-path allowlist.
    if (!error || error.code !== "EPERM") throw error;
  }

  const backup = await createWorkspaceBackup(sourceDir, fixedDate);
  assert.equal(backup.format, "rolefit-workspace-backup");
  assert.equal(backup.schemaVersion, 1);
  assert.deepEqual(
    backup.files.map((file) => file.path),
    [
      "applications.json",
      "applications/application-1/attachments/writing sample.pdf",
      "applications/application-1/cover.cover",
      "applications/application-1/resume.resume",
      "resumes/.trash/2026-07-19T12-00-00-000Z__default.resume",
      "resumes/default.resume"
    ],
    "export contains every app-managed file and excludes arbitrary files and symlinks"
  );
  assert.equal(backup.files.find((file) => file.path.endsWith("resume.resume"))?.encoding, "utf8");
  assert.equal(backup.files.find((file) => file.path.endsWith("cover.cover"))?.encoding, "utf8");
  assert.equal(backup.files.find((file) => file.path === "applications.json")?.encoding, "utf8");

  const withPreferences = parseWorkspaceBackupEnvelope({
    ...backup,
    preferences: {
      settings: { autoPolishResume: true, honestContext: "Grounded experience only" },
      lastBaseResume: "default.resume"
    }
  });
  assert.equal(withPreferences.preferences?.settings.autoPolishResume, true, "portable workspace preferences survive contract parsing");
  assert.throws(
    () => parseWorkspaceBackupEnvelope({
      ...backup,
      preferences: { settings: { autoPolishResume: true, credential: "must-not-travel" }, lastBaseResume: "default.resume" }
    }),
    /unsupported or invalid values/,
    "portable preferences reject settings outside the owned allowlist"
  );
  assert.throws(
    () => parseWorkspaceBackupEnvelope({
      ...backup,
      preferences: { settings: { autoPolishResume: true }, lastBaseResume: "../private.resume" }
    }),
    /selected base resume is invalid/,
    "portable preferences reject non-managed base-resume names"
  );

  await mkdir(targetDir, { recursive: true });
  await mkdir(join(targetDir, "resumes"), { recursive: true });
  await writeFile(join(targetDir, "resumes", "default.resume"), starterText, "utf8");
  await writeFile(join(targetDir, "keep-me.txt"), "previous unknown workspace file", "utf8");

  const result = await restoreWorkspaceBackup(targetDir, withPreferences, fixedDate);
  assert.equal(result.restoredFiles, 6);
  assert.equal(result.previousWorkspaceKept, true);
  assert.equal(JSON.parse(await readFile(join(targetDir, "resumes", "default.resume"), "utf8")).document.header.name, "Portable Candidate");
  assert.equal(await readFile(join(targetDir, "applications", "application-1", "resume.resume"), "utf8"), portableResumeText);
  assert.equal(await readFile(join(targetDir, "applications", "application-1", "cover.cover"), "utf8"), portableCoverText);
  assert.equal(
    await readFile(join(targetDir, "applications", "application-1", "attachments", "writing sample.pdf"), "utf8"),
    "%PDF-1.7\nattachment"
  );
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

  // The restore stages canonical workspace preferences beside the resumes;
  // the file is portable through the envelope but never listed as a managed file.
  const restoredPreferences = JSON.parse(await readFile(join(targetDir, WORKSPACE_PREFERENCES_FILE_NAME), "utf8"));
  assert.equal(restoredPreferences.source, "restore", "restore writes workspace preferences with source:restore");
  assert.equal(restoredPreferences.format, "rolefit-workspace-preferences");
  assert.equal(restoredPreferences.schemaVersion, 1);
  assert.equal(restoredPreferences.settings.autoPolishResume, true, "restored preferences carry the envelope settings");
  assert.equal(restoredPreferences.lastBaseResume, "default.resume");
  const restoredMarker = parseStoredWorkspaceRestoreMarker(
    JSON.parse(await readFile(join(targetDir, WORKSPACE_RESTORE_MARKER_FILE_NAME), "utf8"))
  );
  assert.equal(restoredMarker.restoredAt, fixedDate.toISOString(), "every restore records its generation independently");

  // A backup without optional workspace preferences still records the restore so
  // the next browser load can clear recovery drafts from the previous workspace.
  const noBrowserTarget = join(isolatedRoot, "no-browser-target");
  await mkdir(join(noBrowserTarget, "resumes"), { recursive: true });
  await writeFile(join(noBrowserTarget, "resumes", "default.resume"), starterText, "utf8");
  await restoreWorkspaceBackup(noBrowserTarget, backup, fixedDate);
  await assert.rejects(
    () => readFile(join(noBrowserTarget, WORKSPACE_PREFERENCES_FILE_NAME), "utf8"),
    (error) => error && error.code === "ENOENT",
    "a preference-less restore does not invent workspace preferences"
  );
  const noBrowserMarker = parseStoredWorkspaceRestoreMarker(
    JSON.parse(await readFile(join(noBrowserTarget, WORKSPACE_RESTORE_MARKER_FILE_NAME), "utf8"))
  );
  assert.equal(noBrowserMarker.restoredAt, fixedDate.toISOString(), "a preference-less restore still records its generation");

  const beforeFailedRestore = await snapshot(targetDir);

  // A live Drafting Desk tab blocks restore with a 409 before any staging.
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, withPreferences, fixedDate, 1),
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
    () => restoreWorkspaceBackup(targetDir, withPreferences, fixedDate, () => ++presenceChecks === 1 ? 0 : 1),
    (error) => error instanceof WorkspaceBackupError && error.status === 409,
    "a tab appearing during staging blocks the replacement boundary"
  );
  assert.equal(presenceChecks, 2, "restore checks presence both before staging and before replacement");
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "a late presence refusal leaves the active workspace unchanged");

  let postRenamePresenceChecks = 0;
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, withPreferences, fixedDate, () => ++postRenamePresenceChecks < 3 ? 0 : 1),
    (error) => error instanceof WorkspaceBackupError && error.status === 409,
    "a tab arriving after the previous workspace rename triggers rollback"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "post-rename presence restores the previous active workspace");

  let postInstallPresenceChecks = 0;
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, withPreferences, fixedDate, () => ++postInstallPresenceChecks < 4 ? 0 : 1),
    (error) => error instanceof WorkspaceBackupError && error.status === 409,
    "a tab arriving while the staged workspace is installed still triggers rollback"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "post-install presence restores the previous active workspace");

  const badChecksum = structuredClone(withPreferences);
  badChecksum.files[0].sha256 = "0".repeat(64);
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, badChecksum, fixedDate),
    (error) => error instanceof WorkspaceBackupError && /integrity check/.test(error.message),
    "checksum mismatch is rejected"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "checksum failure leaves active workspace unchanged");

  const missingManagedFile = {
    ...withPreferences,
    files: withPreferences.files.filter(
      (file) => file.path !== "applications/application-1/attachments/writing sample.pdf"
    )
  };
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, missingManagedFile, fixedDate),
    (error) => error instanceof WorkspaceBackupError && /tracker and saved document files do not match/.test(error.message),
    "schema v1 rejects tracker metadata whose saved file is absent"
  );
  const attachmentFile = withPreferences.files.find(
    (file) => file.path === "applications/application-1/attachments/writing sample.pdf"
  );
  assert.ok(attachmentFile);
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, {
      ...withPreferences,
      files: [
        ...withPreferences.files,
        { ...attachmentFile, path: "applications/orphan/attachments/writing sample.pdf" }
      ]
    }, fixedDate),
    (error) => error instanceof WorkspaceBackupError && /tracker and saved document files do not match/.test(error.message),
    "schema v1 rejects saved files for an untracked application"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "application-file mismatch leaves active workspace unchanged");

  const invalidTracker = replaceEntry(
    withPreferences,
    "applications.json",
    JSON.stringify({ applications: [{ invalid: true }] })
  );
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, invalidTracker, fixedDate),
    (error) => error instanceof WorkspaceBackupError && /tracker data is invalid/.test(error.message),
    "invalid tracker data is rejected after integrity validation"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "tracker validation failure leaves active workspace unchanged");

  const invalidResume = replaceEntry(withPreferences, "resumes/default.resume", "{" + "x".repeat(100));
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, invalidResume, fixedDate),
    (error) => error instanceof WorkspaceBackupError && /base-resume file/.test(error.message),
    "invalid strict resume data is rejected"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "resume validation failure leaves active workspace unchanged");

  const invalidPdf = replaceEntry(
    withPreferences,
    "applications/application-1/attachments/writing sample.pdf",
    "not a pdf"
  );
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, invalidPdf, fixedDate),
    (error) => error instanceof WorkspaceBackupError && /invalid saved application PDF/.test(error.message),
    "invalid PDF data is rejected"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "PDF validation failure leaves active workspace unchanged");

  const invalidApplicationResume = replaceEntry(
    withPreferences,
    "applications/application-1/resume.resume",
    "{\"format\":\"wrong\"}"
  );
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, invalidApplicationResume, fixedDate),
    (error) => error instanceof WorkspaceBackupError && /invalid saved application .resume file/.test(error.message),
    "invalid strict application resume source is rejected"
  );
  assert.deepEqual(
    await snapshot(targetDir),
    beforeFailedRestore,
    "application resume validation failure leaves active workspace unchanged"
  );

  const invalidCover = replaceEntry(withPreferences, "applications/application-1/cover.cover", "{\"format\":\"wrong\"}");
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, invalidCover, fixedDate),
    (error) => error instanceof WorkspaceBackupError && /invalid saved application .cover file/.test(error.message),
    "invalid strict cover-letter source is rejected"
  );
  assert.deepEqual(await snapshot(targetDir), beforeFailedRestore, "cover-letter validation failure leaves active workspace unchanged");

  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, { ...withPreferences, files: [...withPreferences.files, withPreferences.files[0]] }, fixedDate),
    /duplicate file path/,
    "duplicate paths are rejected"
  );
  await assert.rejects(
    () => restoreWorkspaceBackup(targetDir, {
      ...withPreferences,
      files: [{ ...withPreferences.files[0], path: "../outside.resume" }]
    }, fixedDate),
    /unsupported file path/,
    "path traversal is rejected"
  );

  // --- Workspace preferences <-> backup envelope ---
  const prefsDir = join(isolatedRoot, "prefs-workspace");
  await mkdir(join(prefsDir, "resumes"), { recursive: true });
  await writeFile(join(prefsDir, "resumes", "default.resume"), portableResumeText, "utf8");

  // No preferences yet: backup omits them and never lists the preferences file.
  const withoutPreferences = await createWorkspaceBackup(prefsDir, fixedDate);
  assert.equal(withoutPreferences.preferences, undefined, "backup omits preferences when no preference file exists");
  assert.ok(
    !withoutPreferences.files.some((file) => file.path === WORKSPACE_PREFERENCES_FILE_NAME),
    "workspace preferences are never listed as a backed-up file"
  );

  // Valid preferences are folded into the envelope but still excluded from files.
  await writeStoredWorkspacePreferences(
    prefsDir,
    { settings: { autoPolishCoverLetter: true, honestContext: "" }, lastBaseResume: "default.resume" },
    "workspace",
    fixedDate
  );
  const withStoredPreferences = await createWorkspaceBackup(prefsDir, fixedDate);
  assert.equal(withStoredPreferences.preferences?.settings.autoPolishCoverLetter, true, "valid preferences are folded into the envelope");
  assert.equal(withStoredPreferences.preferences?.lastBaseResume, "default.resume");
  assert.ok(
    !withStoredPreferences.files.some((file) => file.path === WORKSPACE_PREFERENCES_FILE_NAME),
    "present preferences are still excluded from the backed-up file list"
  );

  // Corrupt preferences must not block backing up resumes: they are omitted.
  await writeFile(join(prefsDir, WORKSPACE_PREFERENCES_FILE_NAME), "{ not valid json", "utf8");
  const corruptPreferences = await createWorkspaceBackup(prefsDir, fixedDate);
  assert.equal(corruptPreferences.preferences, undefined, "corrupt preferences are skipped and do not block the backup");
  assert.equal(corruptPreferences.files.length, withStoredPreferences.files.length, "resume files still back up with corrupt preferences present");

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
