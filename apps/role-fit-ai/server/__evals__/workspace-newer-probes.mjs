// A workspace file saved by a newer RoleFit (D095). Every route that reads or
// writes it answers 423 `workspace-newer` and leaves every workspace byte as
// it was. Each request is otherwise valid: the same request against a current
// tracker gets past the gate. Locks are per file, and restoring an older
// backup over a newer workspace keeps the newer one intact.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { serializeCoverLetterFile, COVER_LETTER_STYLE_DEFAULTS } from "@typeset/engine/lib/coverLetter.ts";
import {
  handleApplicationAttachmentFile,
  handleUploadApplicationAttachment
} from "../applications/attachmentRoutes.ts";
import {
  handleApplicationDocumentFile,
  handleSaveApplicationDocument
} from "../applications/documentRoutes.ts";
import {
  handleAppendApplicationAnswers,
  handleApplicationStatus,
  handleCommitApplication,
  handleDeleteApplication,
  handleListApplications,
  handleLogApplicationEvent,
  handleSaveApplications
} from "../applications/trackerRoutes.ts";
import { sanitizeApplications } from "../applications/schema.ts";
import { invalidateApplicationsSnapshot } from "../applications/storage.ts";
import { TRACKER_SCHEMA_VERSION } from "../applications/trackerVersion.ts";
import { handleExtensionRoutes } from "../extension/routes.ts";
import { WorkspaceBackupError, createWorkspaceBackup, restoreWorkspaceBackup } from "../workspaceBackup.ts";
import { handleWorkspacePreferences, writeStoredWorkspacePreferences } from "../workspacePreferences.ts";
import {
  WORKSPACE_BACKUP_FORMAT,
  WORKSPACE_BACKUP_SCHEMA_VERSION,
  WORKSPACE_NEWER_CODE,
  WORKSPACE_PREFERENCES_FILE_NAME,
  WORKSPACE_PREFERENCES_FORMAT,
  WORKSPACE_PREFERENCES_SCHEMA_VERSION
} from "../../src/lib/workspaceBackupContract.ts";
import { normalizeSettings } from "../../src/lib/settings.ts";

const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
process.env.EXTENSION_ALLOWED_ORIGINS = extensionOrigin;

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(join(here, "../applications/__evals__/fixtures/tracker-v0-written-by-0.20.json"), "utf8"));
const resumeSource = await readFile(join(here, "../starter.resume"), "utf8");
const pdfBytes = Buffer.from("%PDF-1.4\n% synthetic\n%%EOF\n", "latin1");
const savedAt = fixture.applications[0].updatedAt;
// A record with a saved document and attachment, so reads have files to serve.
const [record] = JSON.parse(JSON.stringify(sanitizeApplications([{
  ...fixture.applications[0],
  resumeArtifacts: { hasPdf: false, hasSource: true, fileName: "Resume.resume", savedAt },
  attachments: [{ fileName: "notes.pdf", label: "Notes", size: pdfBytes.byteLength, savedAt }]
}])));
assert.ok(record, "the seeded record is canonical");
const id = record.id;

class FakeResponse {
  status = 0;
  chunk = "";
  headers = new Map();
  setHeader(name, value) { this.headers.set(String(name).toLowerCase(), value); }
  writeHead(status) { this.status = status; }
  end(chunk = "") { this.chunk = String(chunk); }
  get json() { return JSON.parse(this.chunk); }
}

function request(method, payload, headers = {}) {
  const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
  req.method = method;
  req.headers = headers;
  return req;
}

async function call(handler, method, payload, headers) {
  const res = new FakeResponse();
  await handler(request(method, payload, headers), res);
  return res;
}

async function hashTree(root) {
  const hashes = {};
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else hashes[relative(root, path).replaceAll("\\", "/")] = createHash("sha256").update(await readFile(path)).digest("hex");
    }
  }
  await walk(root);
  return hashes;
}

const settings = normalizeSettings({});
const isolatedRoot = await mkdtemp(join(tmpdir(), "rolefit-workspace-newer-"));

async function seedWorkspace(dir, trackerVersion) {
  await mkdir(join(dir, "applications", id, "attachments"), { recursive: true });
  await mkdir(join(dir, "resumes"), { recursive: true });
  await mkdir(join(dir, "cover-letters"), { recursive: true });
  await writeFile(join(dir, "applications.json"), JSON.stringify({
    schemaVersion: trackerVersion,
    savedAt: fixture.savedAt,
    applications: [record]
  }, null, 2));
  await writeFile(join(dir, "applications", id, "resume.resume"), resumeSource);
  await writeFile(join(dir, "applications", id, "attachments", "notes.pdf"), pdfBytes);
  await writeStoredWorkspacePreferences(dir, { settings, lastBaseResume: "" }, "workspace", new Date("2026-10-01T00:00:00.000Z"));
}

// Every route that touches the tracker, each with a request that is otherwise valid.
const coverSource = serializeCoverLetterFile({
  header: { visible: true, name: "Synthetic Applicant", contact: [] },
  sections: [{ id: "cover", heading: "", type: "summary", items: [{
    id: "body", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "",
    bullets: [{ id: "paragraph", text: "Dear Hiring Team,\n\nSynthetic paragraph." }]
  }] }]
}, COVER_LETTER_STYLE_DEFAULTS);
const routes = (dir) => [
  ["list", (req, res) => handleListApplications(req, res, dir), "GET"],
  ["save", (req, res) => handleSaveApplications(req, res, dir), "PUT", {
    applications: [{ ...record, notes: "edited", updatedAt: "2026-10-02T00:00:00.000Z" }],
    mutations: [{ id, operation: "upsert", baseUpdatedAt: record.updatedAt }]
  }],
  ["status", (req, res) => handleApplicationStatus(req, res, id, dir), "POST", { status: "applied", baseUpdatedAt: record.updatedAt }],
  ["answers", (req, res) => handleAppendApplicationAnswers(req, res, id, dir), "POST", {
    answers: [{ question: "Salary expectation?", answer: "Open to discussing." }], baseUpdatedAt: record.updatedAt
  }],
  ["events", (req, res) => handleLogApplicationEvent(req, res, id, dir), "POST", { type: "followup", baseUpdatedAt: record.updatedAt }],
  ["document save", (req, res) => handleSaveApplicationDocument(req, res, id, "resume", dir), "POST", {
    sourceText: resumeSource, fileName: "Resume.resume", baseUpdatedAt: record.updatedAt
  }],
  ["document read", (req, res) => handleApplicationDocumentFile(req, res, id, "resume", "resume", dir), "GET"],
  ["attachment upload", (req, res) => handleUploadApplicationAttachment(req, res, id, dir), "POST", {
    fileName: "extra.pdf", dataBase64: pdfBytes.toString("base64"), baseUpdatedAt: record.updatedAt
  }],
  ["attachment read", (req, res) => handleApplicationAttachmentFile(req, res, id, "notes.pdf", dir), "GET"],
  ["attachment delete", (req, res) => handleApplicationAttachmentFile(req, res, id, "notes.pdf", dir), "DELETE", { baseUpdatedAt: record.updatedAt }],
  ["document delete", (req, res) => handleSaveApplicationDocument(req, res, id, "resume", dir), "DELETE", { baseUpdatedAt: record.updatedAt }],
  ["commit", (req, res) => handleCommitApplication(req, res, dir), "POST", {
    application: { title: "Synthetic role", company: "Example Co", status: "applied" },
    documents: { resume: { sourceText: resumeSource }, cover: { sourceText: coverSource } }
  }],
  ["delete", (req, res) => handleDeleteApplication(req, res, id, dir), "DELETE", { baseUpdatedAt: record.updatedAt }],
  ["extension analyze", (req, res) => handleExtensionRoutes(req, res, "/api/extension/analyze", dir), "POST", {
    text: "Synthetic posting text for a backend role.", url: "http://localhost/jobs/1"
  }, { origin: extensionOrigin }]
];

try {
  // Control: against a current tracker, each request succeeds on its own.
  for (const [index] of routes("").entries()) {
    const control = join(isolatedRoot, `control-${index}`, "workspace");
    await seedWorkspace(control, TRACKER_SCHEMA_VERSION);
    invalidateApplicationsSnapshot();
    const [label, handler, method, payload, headers] = routes(control)[index];
    const res = await call(handler, method, payload, headers);
    assert.ok(res.status >= 200 && res.status < 300, `control ${label}: ${res.status} ${res.chunk.slice(0, 200)}`);
  }

  // A newer tracker: every route refuses and nothing on disk changes.
  const newer = join(isolatedRoot, "newer", "workspace");
  await seedWorkspace(newer, TRACKER_SCHEMA_VERSION + 1);
  const before = await hashTree(newer);
  for (const [label, handler, method, payload, headers] of routes(newer)) {
    invalidateApplicationsSnapshot();
    const res = await call(handler, method, payload, headers);
    assert.equal(res.status, 423, `${label}: ${res.chunk.slice(0, 200)}`);
    assert.equal(res.json.code, WORKSPACE_NEWER_CODE, `${label} names the newer-workspace state`);
    assert.match(res.json.error, /newer version of RoleFit/, `${label} says to update`);
    assert.deepEqual(await hashTree(newer), before, `${label} left every workspace file unchanged`);
  }
  await assert.rejects(createWorkspaceBackup(newer), (error) => {
    assert.ok(error instanceof WorkspaceBackupError && error.status === 423, error?.message);
    assert.ok(error.message.length <= 240, "the companion shows the whole message");
    return true;
  });
  // The lock is per file: settings still save against a newer tracker.
  const preferencesGet = await call((req, res) => handleWorkspacePreferences(req, res, newer), "GET");
  assert.equal(preferencesGet.status, 200);
  const preferencesSave = await call((req, res) => handleWorkspacePreferences(req, res, newer), "POST", {
    settings, lastBaseResume: "", baseRevision: preferencesGet.json.revision
  });
  assert.equal(preferencesSave.status, 200, preferencesSave.chunk);
  const afterPreferences = await hashTree(newer);
  assert.deepEqual(
    Object.fromEntries(Object.entries(afterPreferences).filter(([path]) => path !== WORKSPACE_PREFERENCES_FILE_NAME)),
    Object.fromEntries(Object.entries(before).filter(([path]) => path !== WORKSPACE_PREFERENCES_FILE_NAME)),
    "a settings save touches only the preferences file"
  );

  // Newer preferences: reads report it, saves and backups refuse, the tracker still works.
  const newerPreferences = join(isolatedRoot, "newer-preferences", "workspace");
  await seedWorkspace(newerPreferences, TRACKER_SCHEMA_VERSION);
  await writeFile(join(newerPreferences, WORKSPACE_PREFERENCES_FILE_NAME), JSON.stringify({
    format: WORKSPACE_PREFERENCES_FORMAT,
    schemaVersion: WORKSPACE_PREFERENCES_SCHEMA_VERSION + 1,
    futureShape: { anything: true }
  }));
  const preferencesBefore = await hashTree(newerPreferences);
  const newerGet = await call((req, res) => handleWorkspacePreferences(req, res, newerPreferences), "GET");
  assert.equal(newerGet.status, 200);
  assert.equal(newerGet.json.newer, true, "the snapshot reports newer preferences");
  assert.equal(newerGet.json.exists, false);
  assert.equal(newerGet.json.invalid, undefined, "newer is not reported as corrupt");
  const newerSave = await call((req, res) => handleWorkspacePreferences(req, res, newerPreferences), "POST", {
    settings, lastBaseResume: "", baseRevision: null
  });
  assert.equal(newerSave.status, 423, newerSave.chunk);
  assert.equal(newerSave.json.code, WORKSPACE_NEWER_CODE);
  await assert.rejects(createWorkspaceBackup(newerPreferences), (error) => error instanceof WorkspaceBackupError && error.status === 423);
  assert.deepEqual(await hashTree(newerPreferences), preferencesBefore, "newer preferences stay unchanged");
  invalidateApplicationsSnapshot();
  const trackerList = await call((req, res) => handleListApplications(req, res, newerPreferences), "GET");
  assert.equal(trackerList.status, 200, "newer preferences do not lock the tracker");

  // Restore refuses a newer envelope and a newer embedded tracker, untouched.
  const target = join(isolatedRoot, "restore-target", "workspace");
  await seedWorkspace(target, TRACKER_SCHEMA_VERSION);
  const targetBefore = await hashTree(target);
  const backup = await createWorkspaceBackup(target);
  const trackerFile = backup.files.find((file) => file.path === "applications.json");
  const newerTrackerText = JSON.stringify({ schemaVersion: TRACKER_SCHEMA_VERSION + 1, applications: [] });
  const newerTrackerBytes = Buffer.from(newerTrackerText, "utf8");
  for (const [label, envelope] of [
    ["newer envelope", { format: WORKSPACE_BACKUP_FORMAT, schemaVersion: WORKSPACE_BACKUP_SCHEMA_VERSION + 1, future: true }],
    ["newer embedded tracker", {
      ...backup,
      files: [
        ...backup.files.filter((file) => file !== trackerFile && !file.path.startsWith("applications/")),
        {
          ...trackerFile,
          data: newerTrackerText,
          byteLength: newerTrackerBytes.byteLength,
          sha256: createHash("sha256").update(newerTrackerBytes).digest("hex")
        }
      ]
    }]
  ]) {
    await assert.rejects(restoreWorkspaceBackup(target, envelope, new Date(), 0), (error) => {
      assert.ok(error instanceof WorkspaceBackupError && error.status === 423, `${label}: ${error?.message}`);
      assert.match(error.message, /newer version of RoleFit/);
      return true;
    });
    assert.deepEqual(await hashTree(target), targetBefore, `${label}: the workspace is untouched`);
  }

  // An older backup restores over a newer workspace, which is kept intact aside.
  invalidateApplicationsSnapshot();
  const restored = await restoreWorkspaceBackup(newer, backup, new Date("2026-10-23T00:00:00.000Z"), 0);
  assert.equal(restored.previousWorkspaceKept, true);
  const safety = (await readdir(dirname(newer))).find((name) => name.startsWith("workspace.restore-backup-"));
  assert.ok(safety, "the newer workspace moved to the restore safety directory");
  assert.deepEqual(await hashTree(join(dirname(newer), safety)), afterPreferences, "the newer workspace is kept byte for byte");
  invalidateApplicationsSnapshot();
  const afterRestore = await call((req, res) => handleListApplications(req, res, newer), "GET");
  assert.equal(afterRestore.status, 200, "the restored workspace is current");
} finally {
  invalidateApplicationsSnapshot();
  await rm(isolatedRoot, { recursive: true, force: true });
}

console.log("workspace-newer probes passed");
