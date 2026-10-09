// Probes for the validated tracker snapshot (storage.ts) and the revision
// protocol on GET/PUT /api/applications (trackerRoutes.ts): 304 for a current
// revision, sparse PUT responses only for a matching base revision, revision on
// 409, and full re-validation after any outside change to applications.json.
// Offline, synthetic data only.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { handleListApplications, handleSaveApplications } from "../trackerRoutes.ts";
import { sanitizeApplications } from "../schema.ts";
import {
  applicationsFilePath,
  invalidateApplicationsSnapshot,
  readApplications,
  readApplicationsSnapshot,
  writeApplications
} from "../storage.ts";

class FakeResponse {
  status = 0;
  headers = {};
  chunk = "";
  writeHead(status, headers) {
    this.status = status;
    if (headers) this.headers = headers;
  }
  end(chunk = "") {
    this.chunk = chunk;
  }
  get json() {
    return JSON.parse(String(this.chunk));
  }
}

const require = createRequire(import.meta.url);
const workspaceDir = await mkdtemp(join(tmpdir(), "rolefit-tracker-revision-"));
const record = (id, overrides = {}) => ({
  id,
  title: `Engineer at ${id}`,
  company: id,
  role: "Engineer",
  status: "applied",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  appliedAt: "2026-07-01T00:00:00.000Z",
  notes: "",
  ...overrides
});
const later = (iso, seconds = 1) => new Date(Date.parse(iso) + seconds * 1000).toISOString();

async function list(ifNoneMatch) {
  const res = new FakeResponse();
  await handleListApplications({ method: "GET", headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {} }, res, workspaceDir);
  return res;
}

async function save(applications, mutations, baseRevision) {
  const req = Readable.from([JSON.stringify({ applications, mutations, ...(baseRevision !== undefined ? { baseRevision } : {}) })]);
  req.method = "PUT";
  req.headers = {};
  const res = new FakeResponse();
  await handleSaveApplications(req, res, workspaceDir);
  return res;
}

try {
  // An absent tracker still has a stable revision.
  const empty = await list();
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.applications, []);
  const r0 = empty.json.revision;
  assert.equal(typeof r0, "string");
  assert.equal(empty.headers.ETag, `"${r0}"`, "GET sends the revision as an ETag");
  const unchanged = await list(`"${r0}"`);
  assert.equal(unchanged.status, 304, "a current revision gets 304");
  assert.equal(unchanged.chunk, "", "304 sends no body");

  // A matching base revision gets only the upserted records and the id order.
  const a = record("alpha");
  const created = await save([a], [{ id: "alpha", operation: "upsert", baseUpdatedAt: null }], r0);
  assert.equal(created.status, 200);
  assert.deepEqual(created.json.order, ["alpha"]);
  assert.deepEqual(created.json.applications.map((entry) => entry.id), ["alpha"]);
  const r1 = created.json.revision;
  assert.notEqual(r1, r0, "every write mints a new revision");

  const b = record("bravo");
  const c = record("charlie");
  const second = await save([c, b], [
    { id: "charlie", operation: "upsert", baseUpdatedAt: null },
    { id: "bravo", operation: "upsert", baseUpdatedAt: null }
  ], r1);
  const r2 = second.json.revision;
  assert.deepEqual(second.json.order, ["charlie", "bravo", "alpha"], "new records are prepended in request order");
  assert.deepEqual(second.json.applications.map((entry) => entry.id).sort(), ["bravo", "charlie"], "only upserted records return");

  const editedB = { ...b, notes: "Phone screen", updatedAt: later(b.updatedAt) };
  const edit = await save([editedB], [{ id: "bravo", operation: "upsert", baseUpdatedAt: b.updatedAt }], r2);
  assert.deepEqual(edit.json.order, ["charlie", "bravo", "alpha"], "an edit keeps its position");
  assert.deepEqual(edit.json.applications.map((entry) => [entry.id, entry.notes]), [["bravo", "Phone screen"]]);
  const r3 = edit.json.revision;

  // Another tab still holding r2 learns the whole tracker on its next save.
  const stale = await save([], [{ id: "alpha", operation: "delete", baseUpdatedAt: a.updatedAt }], r2);
  assert.equal(stale.status, 200);
  assert.equal(stale.json.order, undefined, "a stale base revision gets the full tracker");
  assert.deepEqual(stale.json.applications.map((entry) => [entry.id, entry.notes]), [["charlie", ""], ["bravo", "Phone screen"]]);
  const r4 = stale.json.revision;
  assert.notEqual(r4, r3);
  const noBase = await save([{ ...c, notes: "x", updatedAt: later(c.updatedAt) }], [{ id: "charlie", operation: "upsert", baseUpdatedAt: c.updatedAt }]);
  assert.equal(noBase.json.order, undefined, "no base revision gets the full tracker");
  const r5 = noBase.json.revision;
  assert.equal((await list(`"${r3}"`)).status, 200, "a stale revision is answered in full");

  // A conflict carries the revision of the snapshot it returns.
  const conflict = await save([{ ...b, notes: "late", updatedAt: later(b.updatedAt, 5) }], [{ id: "bravo", operation: "upsert", baseUpdatedAt: b.updatedAt }], r5);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.revision, r5, "409 carries the current revision");
  assert.equal(conflict.json.applications.length, 2);

  // Unchanged records keep their validated, frozen objects through a write.
  const before = await readApplications(workspaceDir);
  assert.ok(Object.isFrozen(before[0]), "cached records are frozen");
  assert.throws(() => { before[0].notes = "mutated"; }, TypeError, "an in-place edit of a cached record throws");
  const changed = { ...before[1], notes: "Onsite", updatedAt: later(before[1].updatedAt) };
  const written = await writeApplications(workspaceDir, [before[0], changed]);
  assert.equal(written[0], before[0], "an unchanged validated record is written as-is");
  assert.notEqual(written[1], changed, "a new record is sanitized into a new object");
  assert.equal((await readApplicationsSnapshot(workspaceDir)).applications, written, "a write becomes the cached snapshot");

  // Outside edits are detected — including one that keeps the byte size.
  const path = applicationsFilePath(workspaceDir);
  const cached = await readApplicationsSnapshot(workspaceDir);
  const text = await readFile(path, "utf8");
  const sameSize = text.replace('"Onsite"', '"Offsit"');
  assert.equal(sameSize.length, text.length);
  await writeFile(path, sameSize, "utf8");
  const reread = await readApplicationsSnapshot(workspaceDir);
  assert.notEqual(reread.revision, cached.revision, "an outside same-size edit mints a new revision");
  assert.equal(reread.applications[1].notes, "Offsit", "the outside edit is read");

  // An invalid outside edit fails closed on GET and PUT, then recovers.
  await writeFile(path, text.replace('"status": "applied"', '"status": "bogus"'), "utf8");
  assert.equal((await list()).status, 500, "an invalid outside edit fails closed");
  const blocked = await save([record("delta")], [{ id: "delta", operation: "upsert", baseUpdatedAt: null }], reread.revision);
  assert.equal(blocked.status, 500, "a save over an invalid file is refused");
  assert.equal(await readFile(path, "utf8"), text.replace('"status": "applied"', '"status": "bogus"'), "the invalid file is untouched");
  await writeFile(path, text, "utf8");
  assert.equal((await list()).status, 200, "a repaired file loads again");

  // Restore drops the cache: the same file is validated again under a new revision.
  const settled = (await list()).json.revision;
  invalidateApplicationsSnapshot();
  assert.notEqual((await list()).json.revision, settled, "invalidation forces a fresh validated read");

  // A removed file reads as an empty tracker under a new revision.
  await unlink(path);
  const removed = await list();
  assert.deepEqual(removed.json.applications, []);
  assert.notEqual(removed.json.revision, settled);

  // An outside writer that replaces the file between this server's rename and
  // its confirming stat must not be cached as this write, paired with this
  // write's revision, or erased by the next save.
  const seeded = await save([record("ours1")], [{ id: "ours1", operation: "upsert", baseUpdatedAt: null }], removed.json.revision);
  const fsp = require("node:fs/promises");
  const realRename = fsp.rename;
  fsp.rename = async (from, to) => {
    await realRename(from, to);
    if (to !== path) return;
    fsp.rename = realRename;
    syncBuiltinESMExports();
    const outside = `${path}.outside.tmp`;
    await writeFile(outside, JSON.stringify({ applications: sanitizeApplications([record("outside")]) }), "utf8");
    await realRename(outside, path);
  };
  syncBuiltinESMExports();
  try {
    const raced = await save([record("ours2")], [{ id: "ours2", operation: "upsert", baseUpdatedAt: null }], seeded.json.revision);
    assert.equal(raced.status, 200);
    assert.equal(raced.json.order, undefined, "an unconfirmed write is answered in full");
    assert.equal(raced.json.revision, null, "an unconfirmed write carries no revision");
  } finally {
    fsp.rename = realRename;
    syncBuiltinESMExports();
  }
  const afterRace = await list(`"${seeded.json.revision}"`);
  assert.equal(afterRace.status, 200, "the outside file is not hidden behind 304");
  assert.deepEqual(afterRace.json.applications.map((entry) => entry.id), ["outside"], "the outside file is re-read");
  const next = await save([record("ours3")], [{ id: "ours3", operation: "upsert", baseUpdatedAt: null }], afterRace.json.revision);
  assert.deepEqual(next.json.order, ["ours3", "outside"], "the next save keeps the outside writer's record");

  console.log("tracker revision probes passed");
} finally {
  await rm(workspaceDir, { recursive: true, force: true });
}
