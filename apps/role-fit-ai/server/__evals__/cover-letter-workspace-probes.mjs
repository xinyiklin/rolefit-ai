// Probes for server/coverLetterWorkspace.ts — the workspace store that gives
// cover letters the same named variants and version history base resumes have.
//
// The load-bearing rules, all mirrored from the base-resume path:
//   - only strict `.cover` files are accepted, validated on the COMPLETE bytes
//     before anything is written or handed back;
//   - a save archives the version it replaces, so no save is destructive;
//   - a user-supplied variant name is slugged, never used as a path;
//   - a history key cannot escape .trash/.
//
//   node server/__evals__/cover-letter-workspace-probes.mjs

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  coverLetterFileNameForVariant,
  coverLetterLabel,
  readCoverLetterOptions,
  readCoverLetterWorkspace,
  validateCoverLetterText
} from "../coverLetterWorkspace.ts";
import {
  COVER_LETTER_STYLE_DEFAULTS,
  parseCoverLetterText,
  serializeCoverLetterFile
} from "@typeset/engine/lib/coverLetter.ts";

const workspaceDir = await mkdtemp(join(tmpdir(), "rolefit-cover-ws-"));
const locations = { appRoot: process.cwd(), workspaceDir };
const coverDir = join(workspaceDir, "cover-letters");

// A real .cover payload built through the engine, not a hand-written fixture —
// the validator parses it, so a drifting codec must fail this eval.
function coverPayload(text) {
  return serializeCoverLetterFile(parseCoverLetterText(text), COVER_LETTER_STYLE_DEFAULTS);
}

// ── Variant names are slugged, never used as a path ─────────────────────────
assert.equal(coverLetterFileNameForVariant(""), "default.cover", "an empty variant is the default file");
assert.equal(coverLetterFileNameForVariant("  "), "default.cover", "a blank variant is the default file");
assert.equal(coverLetterFileNameForVariant("Backend SDE"), "backend-sde.cover", "spaces and case slug");
assert.equal(
  coverLetterFileNameForVariant("../../etc/passwd"),
  "etc-passwd.cover",
  "path separators and traversal are slugged away, never preserved"
);
assert.equal(
  coverLetterFileNameForVariant("!!!"),
  "default.cover",
  "a variant with nothing sluggable falls back to the default rather than an empty name"
);
assert.ok(
  !coverLetterFileNameForVariant("a".repeat(200)).includes("/"),
  "an over-long variant stays a single safe file name"
);
assert.ok(
  coverLetterFileNameForVariant("a".repeat(200)).length <= 40 + ".cover".length,
  "an over-long variant is capped"
);

// ── Labels ──────────────────────────────────────────────────────────────────
assert.equal(coverLetterLabel("default.cover"), "Default", "the unnamed file is Default");
assert.equal(coverLetterLabel("backend-sde.cover"), "Backend SDE", "known acronyms stay upper-case");
assert.equal(coverLetterLabel("growth.cover"), "Growth", "a plain variant title-cases");

// ── Validation rejects anything that is not a real .cover ───────────────────
assert.throws(() => validateCoverLetterText("not json"), /invalid/i, "garbage is rejected");
assert.throws(() => validateCoverLetterText("{}"), /invalid/i, "an empty object is rejected");
assert.throws(
  () => validateCoverLetterText(JSON.stringify({ format: "typeset-resume", schemaVersion: 1 })),
  /invalid/i,
  "a RESUME file is rejected by the cover-letter validator — the two formats never cross"
);
assert.throws(
  () => validateCoverLetterText(Buffer.alloc(200_001, 0x20)),
  /too large/i,
  "an oversized payload is rejected before it is parsed"
);
const valid = coverPayload("Dear hiring manager,\n\nI am writing about the role.");
assert.equal(validateCoverLetterText(valid), valid, "a real .cover round-trips through the validator unchanged");

// ── Listing ─────────────────────────────────────────────────────────────────
assert.deepEqual(await readCoverLetterOptions(locations), [], "a fresh workspace lists nothing");

await mkdir(coverDir, { recursive: true });
await writeFile(join(coverDir, "default.cover"), valid);
await writeFile(join(coverDir, "growth.cover"), valid);
await writeFile(join(coverDir, "backend-sde.cover"), valid);
// Neighbours that must never appear in the cover-letter list.
await writeFile(join(coverDir, "base-resume.resume"), "{}");
await writeFile(join(coverDir, "notes.txt"), "hello");

const options = await readCoverLetterOptions(locations);
assert.deepEqual(
  options.map((option) => option.fileName),
  ["default.cover", "backend-sde.cover", "growth.cover"],
  "the default sorts first, then variants alphabetically by label; resumes and loose files are excluded"
);
assert.deepEqual(
  options.map((option) => option.label),
  ["Default", "Backend SDE", "Growth"],
  "each option carries its friendly label"
);

// ── History grouping ────────────────────────────────────────────────────────
const trashDir = join(coverDir, ".trash");
await mkdir(trashDir, { recursive: true });
await writeFile(join(trashDir, "2026-07-25T10-00-00-000Z__default.cover"), valid);
await writeFile(join(trashDir, "2026-07-25T11-00-00-000Z__default.cover"), valid);
await writeFile(join(trashDir, "2026-07-25T12-00-00-000Z__growth.cover"), valid);
// A base-resume backup shares the same .trash directory and must not leak in.
await writeFile(join(trashDir, "2026-07-25T12-00-00-000Z__base-resume.resume"), "{}");

const { coverLetterHistory } = await readCoverLetterWorkspace(locations);
assert.deepEqual(
  coverLetterHistory.map((group) => group.variant),
  ["default", "growth"],
  "history groups by variant, default first, and ignores base-resume backups in the same .trash"
);
assert.deepEqual(
  coverLetterHistory[0].entries.map((entry) => entry.key),
  [
    "2026-07-25T11-00-00-000Z__default.cover",
    "2026-07-25T10-00-00-000Z__default.cover"
  ],
  "entries are newest first"
);
assert.equal(
  coverLetterHistory[0].entries[0].date,
  "2026-07-25T11:00:00.000Z",
  "the stamped file name is reconstructed into a real ISO date for display"
);

// ── The .trash listing tolerates a missing directory ────────────────────────
const emptyDir = await mkdtemp(join(tmpdir(), "rolefit-cover-empty-"));
const empty = await readCoverLetterWorkspace({ appRoot: process.cwd(), workspaceDir: emptyDir });
assert.deepEqual(empty.coverLetterHistory, [], "no .trash directory is not an error");
assert.deepEqual(empty.coverLetterOptions, [], "no cover letters is not an error");

// Nothing above wrote outside its own temp workspace.
assert.ok(
  (await readdir(workspaceDir)).every((name) => name === "cover-letters"),
  "the probe wrote only inside its temp workspace"
);
assert.equal((await readFile(join(coverDir, "default.cover"), "utf8")), valid, "stored bytes are untouched");

console.log("cover-letter workspace probes passed");

// ── Route round-trip over real HTTP ─────────────────────────────────────────
// The handlers are exercised through node:http against a scratch workspace, so
// the request parsing, the archive-before-overwrite rule, and the traversal
// guards are proven end to end rather than by calling internals.
const { createServer } = await import("node:http");
const {
  handleWorkspaceCoverLetter,
  handleSelectCoverLetter,
  handleRestoreCoverLetter
} = await import("../coverLetterWorkspace.ts");

const routeDir = await mkdtemp(join(tmpdir(), "rolefit-cover-routes-"));
const routeLocations = { appRoot: process.cwd(), workspaceDir: routeDir };

const server = createServer((req, res) => {
  if (req.url === "/save") return void handleWorkspaceCoverLetter(req, res, routeLocations);
  if (req.url === "/select") return void handleSelectCoverLetter(req, res, routeLocations);
  if (req.url === "/restore") return void handleRestoreCoverLetter(req, res, routeLocations);
  res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const post = async (path, body) => {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
};

const first = coverPayload("Dear hiring manager,\n\nFirst version of the letter.");
const second = coverPayload("Dear hiring manager,\n\nSecond version of the letter.");

// Save the default, then a named variant.
let result = await post("/save", { text: first });
assert.equal(result.status, 200, "saving the default letter succeeds");
assert.equal(result.data.fileName, "default.cover", "an unnamed save is the default file");

result = await post("/save", { text: first, variant: "Backend SDE" });
assert.equal(result.data.fileName, "backend-sde.cover", "a named variant slugs into its own file");
assert.deepEqual(
  result.data.coverLetterOptions.map((option) => option.fileName),
  ["default.cover", "backend-sde.cover"],
  "the response lists both letters"
);

// Overwriting archives the previous bytes rather than destroying them.
result = await post("/save", { text: second, fileName: "default.cover" });
assert.equal(result.status, 200, "overwriting the default succeeds");
const historyAfterOverwrite = result.data.coverLetterHistory.find((g) => g.variant === "default");
assert.ok(historyAfterOverwrite?.entries.length >= 1, "the replaced version is archived to history");

result = await post("/select", { fileName: "default.cover" });
assert.equal(result.data.text, second, "select returns the version most recently written");

// Restoring brings the earlier bytes back and archives the current ones.
const restoreKey = historyAfterOverwrite.entries[0].key;
result = await post("/restore", { key: restoreKey });
assert.equal(result.status, 200, "restore succeeds");
assert.equal(result.data.text, first, "restore returns the ARCHIVED bytes, not the current ones");
result = await post("/select", { fileName: "default.cover" });
assert.equal(result.data.text, first, "the restored version is what the workspace now holds");

// ── Guards ──────────────────────────────────────────────────────────────────
assert.equal((await post("/save", { text: "not a cover file" })).status, 400, "invalid payloads are rejected");
assert.equal(
  (await post("/save", { text: JSON.stringify({ format: "typeset-resume", schemaVersion: 1 }) })).status,
  400,
  "a resume payload cannot be saved as a cover letter"
);
assert.equal((await post("/select", { fileName: "../../secret.cover" })).status, 400, "select rejects traversal");
assert.equal((await post("/select", { fileName: "base-resume.resume" })).status, 400, "select rejects a non-cover name");
assert.equal((await post("/select", { fileName: "missing.cover" })).status, 404, "a missing variant is 404");
assert.equal((await post("/restore", { key: "../workspace/default.cover" })).status, 400, "restore rejects traversal");
assert.equal((await post("/restore", { key: "nonsense" })).status, 400, "restore rejects an unparseable key");

await new Promise((resolve) => server.close(resolve));

console.log("cover-letter workspace route round-trip passed");

// ── Regression: a file name must never be sent as a variant ─────────────────
// `variant` is a LABEL the server slugs; `fileName` is already a file name it
// only validates. Sending the active file name as a variant re-slugged it, so
// "Update Growth" wrote cover-letter-growth-cover.cover instead of
// updating Growth. Both directions are locked here.
assert.equal(
  coverLetterFileNameForVariant("growth.cover"),
  "growth-cover.cover",
  "slugging a FILE NAME as a variant mangles it — this is why the client must send fileName"
);

const bugDir = await mkdtemp(join(tmpdir(), "rolefit-cover-update-"));
const bugLocations = { appRoot: process.cwd(), workspaceDir: bugDir };
const bugServer = createServer((req, res) => {
  if (req.url === "/save") return void handleWorkspaceCoverLetter(req, res, bugLocations);
  res.writeHead(404).end();
});
await new Promise((resolve) => bugServer.listen(0, "127.0.0.1", resolve));
const bugOrigin = `http://127.0.0.1:${bugServer.address().port}`;
const bugPost = async (body) => {
  const response = await fetch(`${bugOrigin}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.json();
};

await bugPost({ text: first, variant: "Growth" });
// The client's "Update <active>" path: the active file name goes in `fileName`.
const updated = await bugPost({ text: second, fileName: "growth.cover" });
assert.equal(updated.fileName, "growth.cover", "updating the active variant writes back to the SAME file");
assert.deepEqual(
  updated.coverLetterOptions.map((option) => option.fileName),
  ["growth.cover"],
  "updating a variant does not spawn a second mangled file"
);
await new Promise((resolve) => bugServer.close(resolve));

console.log("cover-letter variant-update regression locked");
