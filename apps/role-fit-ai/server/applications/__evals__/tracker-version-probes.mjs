// applications.json versioning (D095): every older shape in fixtures/ migrates
// to the current version and is rewritten once; a current file holding a
// legacy shape fails closed; a newer file is refused untouched.
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ApplicationsStorageError } from "../schema.ts";
import {
  applicationsFilePath,
  invalidateApplicationsSnapshot,
  readApplications as readCachedApplications,
  writeApplications
} from "../storage.ts";
import { TRACKER_SCHEMA_VERSION } from "../trackerVersion.ts";
import { WorkspaceNewerError } from "../../../src/lib/workspaceBackupContract.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const readApplications = (dir) => {
  invalidateApplicationsSnapshot();
  return readCachedApplications(dir);
};
const plain = (value) => JSON.parse(JSON.stringify(value));

const expectations = {
  "tracker-v0-priority.json": (input, [record]) => {
    const { priority: _priority, ...rest } = input.applications[0];
    assert.deepEqual(record, rest, "only the retired priority is removed");
  },
  "tracker-v0-interested.json": (input, [record]) => {
    const raw = input.applications[0];
    assert.equal(record.status, "not_applying");
    assert.equal(record.notApplyingAt, raw.updatedAt, "the decision is dated by the last revision");
    for (const key of ["appliedAt", "resumeUsed", "resumeArtifacts", "attachments"]) {
      assert.equal(record[key], undefined, `${key} would imply a submission`);
    }
    assert.deepEqual(record.applicationAnswers, raw.applicationAnswers, "answers survive");
  },
  "tracker-v0-empty-applied-at.json": (input, [record]) => {
    const { appliedAt: _empty, ...rest } = input.applications[0];
    assert.deepEqual(record, rest, "an empty date reads as absent, never invented");
  },
  "tracker-v0-scalar-skip-reason.json": (input, [record]) => {
    const { notApplyingReason, ...rest } = input.applications[0];
    assert.deepEqual(record, { ...rest, notApplyingReasons: [notApplyingReason] });
  },
  "tracker-v0-fit-without-status.json": (input, [record]) => {
    const raw = input.applications[0];
    assert.deepEqual(record, {
      ...raw,
      fitAssessment: { ...raw.fitAssessment, result: { ...raw.fitAssessment.result, status: "ASSESSED" } }
    });
  },
  "tracker-v0-written-by-0.20.json": (input, records) => {
    assert.deepEqual(records, input.applications, "a current-shape unversioned file reads unchanged");
  }
};

const workspace = await mkdtemp(join(tmpdir(), "rolefit-tracker-version-"));
const filePath = applicationsFilePath(workspace);

async function assertRefused(bytes, ErrorType, label) {
  await writeFile(filePath, bytes, "utf8");
  await assert.rejects(readApplications(workspace), (error) => {
    assert.ok(error instanceof ErrorType, `${label}: ${error?.name}`);
    return true;
  });
  assert.equal(await readFile(filePath, "utf8"), bytes, `${label}: the file is left untouched`);
}

try {
  for (const [name, expect] of Object.entries(expectations)) {
    const text = await readFile(join(fixtures, name), "utf8");
    const input = JSON.parse(text);
    assert.equal(Object.hasOwn(input, "schemaVersion"), false, `${name} is an unversioned fixture`);
    await writeFile(filePath, text, "utf8");
    const records = plain(await readApplications(workspace));
    expect(input, records);

    const rewritten = await readFile(filePath, "utf8");
    const file = JSON.parse(rewritten);
    assert.deepEqual(Object.keys(file), ["schemaVersion", "savedAt", "applications"], `${name}: versioned envelope`);
    assert.equal(file.schemaVersion, TRACKER_SCHEMA_VERSION, `${name}: rewritten at the current version`);
    assert.deepEqual(file.applications, records, `${name}: the rewrite stores exactly the migrated records`);
    assert.deepEqual(plain(await readApplications(workspace)), records, `${name}: reads back the same`);
    assert.equal(await readFile(filePath, "utf8"), rewritten, `${name}: a current file is not rewritten on read`);

    // 0.20/0.21 ignore the version and drop it on their next save; that file
    // must read back losslessly here.
    const { schemaVersion: _version, ...downgraded } = file;
    await writeFile(filePath, JSON.stringify(downgraded), "utf8");
    assert.deepEqual(plain(await readApplications(workspace)), records, `${name}: survives a downgrade round trip`);

    // Migrations run only from the version that needs them.
    if (name !== "tracker-v0-written-by-0.20.json") {
      await assertRefused(
        JSON.stringify({ ...input, schemaVersion: TRACKER_SCHEMA_VERSION }),
        ApplicationsStorageError,
        `${name} stamped current`
      );
    }
  }

  const current = JSON.parse(await readFile(join(fixtures, "tracker-v0-written-by-0.20.json"), "utf8"));
  await writeApplications(workspace, current.applications);
  const written = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(written.schemaVersion, TRACKER_SCHEMA_VERSION, "every write stamps the current version");
  assert.deepEqual(written.applications, current.applications, "stamping changes nothing else");

  // A cached current snapshot never hides a newer file that replaced it.
  await readCachedApplications(workspace);
  await writeFile(filePath, JSON.stringify({ schemaVersion: TRACKER_SCHEMA_VERSION + 1, applications: [] }), "utf8");
  await assert.rejects(readCachedApplications(workspace), WorkspaceNewerError);

  // A rewrite that fails (a locked file) is not corrupt data: the migrated
  // records are still served. Read-only file (Windows) and directory (POSIX)
  // block the rename; root ignores both, so there only the records are checked.
  const unversioned = await readFile(join(fixtures, "tracker-v0-scalar-skip-reason.json"), "utf8");
  await writeFile(filePath, unversioned, "utf8");
  await chmod(filePath, 0o444);
  await chmod(workspace, 0o555);
  try {
    const served = plain(await readApplications(workspace));
    assert.deepEqual(served[0].notApplyingReasons, ["constraints"], "migrated records are served");
    if (process.getuid?.() !== 0) {
      assert.equal(await readFile(filePath, "utf8"), unversioned, "the failed rewrite left the file as it was");
    }
  } finally {
    await chmod(workspace, 0o755);
    await chmod(filePath, 0o644);
  }
  await rm(filePath, { force: true });

  // A newer file is refused before any record is read, whatever it holds.
  for (const newer of [
    { schemaVersion: TRACKER_SCHEMA_VERSION + 1, applications: current.applications },
    { schemaVersion: TRACKER_SCHEMA_VERSION + 1, applications: [{ id: "x", futureField: true }] },
    { schemaVersion: TRACKER_SCHEMA_VERSION + 7, records: "a different shape" }
  ]) {
    await assertRefused(JSON.stringify(newer), WorkspaceNewerError, `version ${newer.schemaVersion}`);
  }

  for (const [label, file] of [
    ["string version", { schemaVersion: "1", applications: current.applications }],
    ["zero version", { schemaVersion: 0, applications: current.applications }],
    ["negative version", { schemaVersion: -1, applications: current.applications }],
    ["fractional version", { schemaVersion: 1.5, applications: current.applications }],
    ["null version", { schemaVersion: null, applications: current.applications }],
    ["unknown top-level key", { schemaVersion: 1, savedAt: "x", applications: current.applications, extra: true }],
    ["non-string savedAt", { schemaVersion: 1, savedAt: 42, applications: current.applications }],
    ["missing list", { schemaVersion: 1 }]
  ]) {
    await assertRefused(JSON.stringify(file), ApplicationsStorageError, label);
  }
  await assertRefused("[]", ApplicationsStorageError, "array file");
} finally {
  invalidateApplicationsSnapshot();
  await rm(workspace, { recursive: true, force: true });
}

console.log("tracker-version probes passed");
