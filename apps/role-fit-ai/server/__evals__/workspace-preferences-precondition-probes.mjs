// Stale-save refusal for canonical workspace preferences, in an isolated workspace.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  StaleWorkspacePreferencesError,
  handleWorkspacePreferences,
  persistWorkspacePreferences
} from "../workspacePreferences.ts";
import { WORKSPACE_PREFERENCES_FILE_NAME } from "../../src/lib/workspaceBackupContract.ts";

class FakeResponse {
  status = 0;
  body = "";
  writeHead(status) { this.status = status; }
  end(chunk = "") { this.body = String(chunk); }
  json() { return JSON.parse(this.body); }
}

async function call(method, payload) {
  const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
  req.method = method;
  const res = new FakeResponse();
  await handleWorkspacePreferences(req, res, workspace);
  return res;
}

const root = await mkdtemp(join(tmpdir(), "rolefit-workspace-preferences-precondition-"));
const workspace = join(root, "workspace");
const file = join(workspace, WORKSPACE_PREFERENCES_FILE_NAME);

try {
  await mkdir(workspace, { recursive: true });

  const seed = await call("POST", { settings: { profileBackground: "Seed" }, lastBaseResume: "", baseRevision: null });
  assert.equal(seed.status, 200, "a missing record accepts a first save with no base revision");
  const seeded = seed.json().revision;
  assert.match(seeded, /^[0-9a-f]{64}$/, "a successful save returns the revision it wrote");
  assert.equal((await call("GET")).json().revision, seeded, "GET reports the same revision");

  // An outside writer that leaves updatedAt untouched still changes the revision.
  const external = JSON.parse(await readFile(file, "utf8"));
  external.settings.profileBackground = "Newer external edit";
  await writeFile(file, JSON.stringify(external), "utf8");

  const stale = await call("POST", { settings: { profileBackground: "Stale cache" }, lastBaseResume: "", baseRevision: seeded });
  assert.equal(stale.status, 409, "a save based on an older revision is refused, even when updatedAt did not change");
  assert.equal(stale.json().stale, true);
  assert.equal(stale.json().current.settings.profileBackground, "Newer external edit", "the refusal returns the current record");
  assert.equal(
    JSON.parse(await readFile(file, "utf8")).settings.profileBackground,
    "Newer external edit",
    "a refused save leaves the newer record untouched"
  );

  const unseen = await call("POST", { settings: { profileBackground: "Never loaded" }, lastBaseResume: "", baseRevision: null });
  assert.equal(unseen.status, 409, "a client that never saw an existing record cannot replace it");

  const current = await call("POST", {
    settings: { profileBackground: "Rebased" },
    lastBaseResume: "",
    baseRevision: stale.json().current.revision
  });
  assert.equal(current.status, 200, "a save based on the current revision is written");
  assert.notEqual(current.json().revision, stale.json().current.revision);

  for (const baseRevision of [undefined, 42, "2026-09-30T00:00:00.000Z"]) {
    const body = { settings: { profileBackground: "x" }, lastBaseResume: "" };
    if (baseRevision !== undefined) body.baseRevision = baseRevision;
    const invalid = await call("POST", body);
    assert.equal(invalid.status, 400, `a save without a valid base revision is rejected (${String(baseRevision)})`);
  }
  const extraKey = await call("POST", { settings: {}, lastBaseResume: "", baseRevision: null, extra: true });
  assert.equal(extraKey.status, 400, "unknown request keys still fail the strict preferences parser");

  await assert.rejects(
    persistWorkspacePreferences(workspace, { settings: {}, lastBaseResume: "" }, new Date(), "0".repeat(64)),
    StaleWorkspacePreferencesError
  );
  await persistWorkspacePreferences(workspace, { settings: { profileBackground: "Internal" }, lastBaseResume: "" });
  assert.equal(
    JSON.parse(await readFile(file, "utf8")).settings.profileBackground,
    "Internal",
    "server-internal callers without a base revision keep unconditional writes"
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("workspace preference precondition probes passed");
