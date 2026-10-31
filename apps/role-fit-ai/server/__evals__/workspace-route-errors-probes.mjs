// Probes for how the resume and cover-letter workspace routes answer a failure.
//
// The load-bearing rule: a file-system failure (a locked or unwritable file,
// here forced by putting a regular file where `.trash/`, `resumes/`, or
// `cover-letters/` must be created, or a folder where a letter belongs) is
// the server's failure, so the route answers 500 with fixed user-safe text and
// never Node's own message, which names absolute workspace paths. A request
// the route rejects keeps its own 400 validation message.
//
//   node server/__evals__/workspace-route-errors-probes.mjs

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COVER_LETTER_STYLE_DEFAULTS,
  parseCoverLetterText,
  serializeCoverLetterFile
} from "@typeset/engine/lib/coverLetter.ts";
import {
  WORKSPACE_FILE_ACCESS_ERROR,
  ensureJobWorkspace,
  handleBaseResumeCandidates,
  handleSelectBaseResume,
  handleWorkspaceBaseResume
} from "../workspace.ts";
import {
  handleCoverLetterCandidates,
  handleSelectCoverLetter,
  handleWorkspaceCoverLetter
} from "../coverLetterWorkspace.ts";

const appRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const starter = await readFile(join(appRoot, "server", "starter.resume"), "utf8");
const isolatedRoot = await mkdtemp(join(tmpdir(), "rolefit-route-errors-"));
const locations = { appRoot, workspaceDir: join(isolatedRoot, "workspace") };
const resumeDir = join(locations.workspaceDir, "resumes");
const coverDir = join(locations.workspaceDir, "cover-letters");

class FakeResponse {
  status = 0;
  body = "";
  writableEnded = false;
  writeHead(status) { this.status = status; }
  end(chunk = "") {
    this.body = String(chunk);
    this.writableEnded = true;
  }
}

async function invoke(handler, method, payload, at = locations) {
  const req = Readable.from([JSON.stringify(payload)]);
  req.method = method;
  const res = new FakeResponse();
  await handler(req, res, at);
  return { status: res.status, error: JSON.parse(res.body).error, body: res.body };
}

function assertServerFailure(result, label) {
  assert.equal(result.status, 500, `${label}: a file-system failure is the server's, not a bad request`);
  assert.equal(result.error, WORKSPACE_FILE_ACCESS_ERROR, `${label}: answers the fixed user-safe text`);
  assert.ok(!result.body.includes("rolefit-route-errors-"), `${label}: never echoes a workspace path`);
  assert.doesNotMatch(result.body, /E[A-Z]{3,}:/, `${label}: never echoes Node's errno text`);
}

const coverPayload = (text) => serializeCoverLetterFile(parseCoverLetterText(text), COVER_LETTER_STYLE_DEFAULTS);
const originalError = console.error;
const logged = [];
console.error = (...args) => logged.push(args.join(" "));

try {
  await ensureJobWorkspace(locations.workspaceDir);
  const liveCover = coverPayload("Dear Hiring Team,\n\nThe live letter.");
  await writeFile(join(coverDir, "growth.cover"), liveCover, "utf8");
  await writeFile(join(resumeDir, "backend.resume"), starter, "utf8");
  // A regular file where the history directory belongs: archiving the live
  // version fails with a real errno error, as a locked file would.
  await writeFile(join(coverDir, ".trash"), "not a directory", "utf8");
  await writeFile(join(resumeDir, ".trash"), "not a directory", "utf8");

  // ── Cover-letter save ───────────────────────────────────────────────────
  assertServerFailure(
    await invoke(handleWorkspaceCoverLetter, "POST", {
      fileName: "growth.cover",
      text: coverPayload("Dear Hiring Team,\n\nA replacement letter.")
    }),
    "cover save"
  );
  assert.equal(await readFile(join(coverDir, "growth.cover"), "utf8"), liveCover, "the live letter is left in place");
  {
    const result = await invoke(handleWorkspaceCoverLetter, "POST", {
      fileName: "../escape.cover",
      text: coverPayload("Dear Hiring Team,\n\nA letter.")
    });
    assert.equal(result.status, 400, "an unsafe name is still a bad request");
    assert.equal(result.error, "Choose a valid cover letter version.", "the route's own validation message is kept");
  }

  // ── Cover-letter select ─────────────────────────────────────────────────
  await mkdir(join(coverDir, "folder.cover"));
  assertServerFailure(await invoke(handleSelectCoverLetter, "POST", { fileName: "folder.cover" }), "cover select");
  {
    const result = await invoke(handleSelectCoverLetter, "POST", { fileName: "bad name.cover" });
    assert.equal(result.status, 400);
    assert.equal(result.error, "Choose a valid cover letter version.");
  }

  // ── Resume variant removal ──────────────────────────────────────────────
  assertServerFailure(
    await invoke(handleWorkspaceBaseResume, "DELETE", { fileName: "backend.resume" }),
    "resume removal"
  );
  assert.equal(await readFile(join(resumeDir, "backend.resume"), "utf8"), starter, "the variant is not removed");
  {
    const result = await invoke(handleWorkspaceBaseResume, "DELETE", { fileName: "../escape.resume" });
    assert.equal(result.status, 400, "an unsafe name is still a bad request");
    assert.equal(result.error, "Choose a valid base resume version.", "the route's own validation message is kept");
  }
  {
    const result = await invoke(handleSelectBaseResume, "POST", { fileName: "bad name.resume" });
    assert.equal(result.status, 400);
    assert.equal(result.error, "Choose a valid base resume version.");
  }

  // ── Routes that fail before reading: the variant folders cannot be created ─
  // Plain files where `resumes/` and `cover-letters/` belong make the routes'
  // workspace setup fail with a real errno error.
  const blocked = { appRoot, workspaceDir: join(isolatedRoot, "blocked-workspace") };
  await mkdir(blocked.workspaceDir, { recursive: true });
  await writeFile(join(blocked.workspaceDir, "resumes"), "not a directory", "utf8");
  await writeFile(join(blocked.workspaceDir, "cover-letters"), "not a directory", "utf8");
  assertServerFailure(
    await invoke(handleSelectBaseResume, "POST", { fileName: "backend.resume" }, blocked),
    "resume select"
  );
  assertServerFailure(
    await invoke(handleBaseResumeCandidates, "POST", { fileNames: ["backend.resume"] }, blocked),
    "resume candidates"
  );
  assertServerFailure(
    await invoke(handleCoverLetterCandidates, "POST", { fileNames: ["growth.cover"] }, blocked),
    "cover candidates"
  );
  {
    const result = await invoke(handleCoverLetterCandidates, "POST", { fileNames: ["../escape.cover"] }, blocked);
    assert.equal(result.status, 400, "an unsafe candidate name is still a bad request");
    assert.equal(result.error, "Choose a valid cover letter version.");
  }

  assert.ok(logged.length >= 6, "each server failure is logged");
  for (const line of logged) {
    assert.match(line, /^\[workspace\] a file operation failed \(E[A-Z]+\)$/, "the log names only the error code");
  }
  console.error = originalError;
  console.log("Workspace route error probes: all checks passed");
} finally {
  console.error = originalError;
  await rm(isolatedRoot, { recursive: true, force: true });
}
