import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  InvalidWorkspacePreferencesError,
  persistWorkspacePreferences,
  readStoredWorkspacePreferences
} from "../workspacePreferences.ts";
import { WORKSPACE_PREFERENCES_FILE_NAME } from "../../src/lib/workspaceBackupContract.ts";

const root = await mkdtemp(join(tmpdir(), "rolefit-workspace-preferences-"));
const workspace = join(root, "workspace");
const file = join(workspace, WORKSPACE_PREFERENCES_FILE_NAME);
const initial = {
  settings: { honestContext: "Grounded experience only" },
  lastBaseResume: "default.resume"
};
const replacement = {
  settings: { honestContext: "Browser cache must not repair this" },
  lastBaseResume: ""
};

try {
  await mkdir(workspace, { recursive: true });
  await persistWorkspacePreferences(workspace, initial, new Date("2026-08-09T15:00:00.000Z"));
  const stored = await readStoredWorkspacePreferences(workspace);
  assert.equal(stored.status, "ok", "a missing canonical file accepts its first normalized preferences write");
  assert.deepEqual(stored.status === "ok" ? stored.value.settings : null, initial.settings);

  await writeFile(file, "{not valid json", "utf8");
  await assert.rejects(
    persistWorkspacePreferences(workspace, replacement, new Date("2026-08-09T16:00:00.000Z")),
    InvalidWorkspacePreferencesError,
    "an ordinary settings save cannot silently replace a corrupt canonical file"
  );
  assert.equal(
    await readFile(file, "utf8"),
    "{not valid json",
    "the invalid record remains available for explicit recovery or replacement"
  );

  await rm(file);
  await persistWorkspacePreferences(workspace, replacement, new Date("2026-08-09T17:00:00.000Z"));
  const repaired = await readStoredWorkspacePreferences(workspace);
  assert.equal(repaired.status, "ok", "an explicit removal makes the next settings write a valid seed");
  assert.deepEqual(repaired.status === "ok" ? repaired.value.settings : null, replacement.settings);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("workspace preference persistence probes passed");
