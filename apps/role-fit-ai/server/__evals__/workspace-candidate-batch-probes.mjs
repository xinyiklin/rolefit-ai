// Probes for the two batch candidate routes — the reads Prepare uses to rank
// saved variants before any provider request.
//
// The load-bearing rules:
//   - one request reads every requested document under ONE workspace lock;
//   - the response carries the requested documents and nothing else: no
//     history, starter, cover-letter state, options list, or workspace files
//     (that payload is why the per-file select route was the wrong tool here);
//   - the same name guards as the select routes apply, so a batch cannot become
//     a path-traversal read;
//   - one unreadable or invalid document is SKIPPED, never fatal: the ranker's
//     own completeness rule turns a short candidate list into no recommendation,
//     while a 500 would leave Prepare with no selection at all.
//
//   node server/__evals__/workspace-candidate-batch-probes.mjs

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COVER_LETTER_STYLE_DEFAULTS,
  parseCoverLetterText,
  serializeCoverLetterFile
} from "@typeset/engine/lib/coverLetter.ts";

const repoAppRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const starter = await readFile(join(repoAppRoot, "server", "starter.resume"), "utf8");
const isolatedRoot = await mkdtemp(join(tmpdir(), "rolefit-candidates-"));
const locations = { appRoot: repoAppRoot, workspaceDir: join(isolatedRoot, "workspace") };
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

function request(method, payload) {
  const req = Readable.from([JSON.stringify(payload)]);
  req.method = method;
  return req;
}

function rawRequest(method, raw) {
  const req = Readable.from([raw]);
  req.method = method;
  return req;
}

const originalCwd = process.cwd();
try {
  process.chdir(isolatedRoot);
  const { handleBaseResumeCandidates, ensureJobWorkspace } = await import(
    `../workspace.ts?candidate-probe=${Date.now()}`
  );
  const { handleCoverLetterCandidates } = await import(
    `../coverLetterWorkspace.ts?candidate-probe=${Date.now()}`
  );

  async function invoke(handler, method, payload) {
    const res = new FakeResponse();
    await handler(request(method, payload), res, locations);
    return res;
  }

  await mkdir(locations.workspaceDir, { recursive: true });
  await ensureJobWorkspace(locations.workspaceDir);

  const named = (name) => {
    const parsed = JSON.parse(starter);
    parsed.document.header.name = name;
    return JSON.stringify(parsed);
  };
  await writeFile(join(resumeDir, "default.resume"), named("Default Variant"), "utf8");
  await writeFile(join(resumeDir, "fullstack.resume"), named("Fullstack Variant"), "utf8");
  await writeFile(join(resumeDir, "general-sde.resume"), named("General SDE Variant"), "utf8");

  // ── Method, shape, and cap gates ───────────────────────────────────────────
  assert.equal((await invoke(handleBaseResumeCandidates, "GET", {})).status, 405, "resume batch rejects non-POST");
  {
    const res = new FakeResponse();
    await handleBaseResumeCandidates(rawRequest("POST", "not json"), res, locations);
    assert.equal(res.status, 400, "resume batch rejects a malformed JSON body");
  }
  assert.equal(
    (await invoke(handleBaseResumeCandidates, "POST", {})).status,
    400,
    "resume batch requires an explicit file list"
  );
  assert.equal(
    (await invoke(handleBaseResumeCandidates, "POST", { fileNames: [] })).status,
    400,
    "resume batch rejects an empty file list rather than dumping the workspace"
  );
  assert.equal(
    (await invoke(handleBaseResumeCandidates, "POST", {
      fileNames: Array.from({ length: 41 }, (_, index) => `variant-${index}.resume`)
    })).status,
    400,
    "resume batch is bounded, not an unlimited workspace read"
  );
  for (const badName of ["../evil.resume", "variant-../x.resume", "", "default.txt"]) {
    const res = await invoke(handleBaseResumeCandidates, "POST", {
      fileNames: ["default.resume", badName]
    });
    assert.equal(res.status, 400, `resume batch rejects an unsafe fileName: ${JSON.stringify(badName)}`);
    assert.match(JSON.parse(res.body).error, /valid base resume/);
  }

  // ── One request returns every requested resume, and nothing else ───────────
  {
    const res = await invoke(handleBaseResumeCandidates, "POST", {
      fileNames: ["default.resume", "fullstack.resume", "general-sde.resume"]
    });
    assert.equal(res.status, 200, "resume batch reads several variants in one request");
    const body = JSON.parse(res.body);
    assert.deepEqual(
      body.candidates.map((candidate) => candidate.fileName),
      ["default.resume", "fullstack.resume", "general-sde.resume"],
      "every requested variant comes back in the requested order"
    );
    assert.deepEqual(
      body.candidates.map((candidate) => candidate.label),
      ["Default", "Fullstack", "General SDE"],
      "each candidate carries the same friendly label the options list uses"
    );
    assert.ok(
      body.candidates.every((candidate) => candidate.text.includes("Variant")),
      "each candidate carries its own validated bytes, not a shared read"
    );
    assert.deepEqual(Object.keys(body), ["candidates"], "the batch answers with candidates and nothing else");
    for (const leaked of [
      "baseResumeOptions",
      "baseResumeHistory",
      "starterResume",
      "coverLetterOptions",
      "coverLetterHistory",
      "files",
      "path"
    ]) {
      assert.equal(
        Object.hasOwn(body, leaked),
        false,
        `the batch does not pay for the whole workspace snapshot (${leaked})`
      );
    }
  }

  // ── Duplicates collapse; an absent variant is a clean miss ─────────────────
  {
    const res = await invoke(handleBaseResumeCandidates, "POST", {
      fileNames: ["default.resume", "default.resume", "absent.resume"]
    });
    assert.equal(res.status, 200, "an absent variant is not an error for the batch");
    assert.deepEqual(
      JSON.parse(res.body).candidates.map((candidate) => candidate.fileName),
      ["default.resume"],
      "duplicates are read once and an absent variant is simply missing from the result"
    );
  }

  // ── One corrupt variant is skipped, never fatal ────────────────────────────
  await writeFile(join(resumeDir, "broken.resume"), `{${"x".repeat(120)}`, "utf8");
  {
    const res = await invoke(handleBaseResumeCandidates, "POST", {
      fileNames: ["default.resume", "broken.resume", "fullstack.resume"]
    });
    assert.equal(res.status, 200, "one corrupt variant does not fail the whole batch");
    assert.deepEqual(
      JSON.parse(res.body).candidates.map((candidate) => candidate.fileName),
      ["default.resume", "fullstack.resume"],
      "the corrupt variant is skipped while its siblings still rank"
    );
  }

  // ── Cover letters follow exactly the same contract ─────────────────────────
  const coverPayload = (text) =>
    serializeCoverLetterFile(parseCoverLetterText(text), COVER_LETTER_STYLE_DEFAULTS);
  await writeFile(join(coverDir, "default.cover"), coverPayload("Dear Hiring Team,\n\nDefault letter body."), "utf8");
  await writeFile(join(coverDir, "growth.cover"), coverPayload("Dear Hiring Team,\n\nGrowth letter body."), "utf8");
  await writeFile(join(coverDir, "broken.cover"), "{not a cover letter", "utf8");

  assert.equal((await invoke(handleCoverLetterCandidates, "GET", {})).status, 405, "cover batch rejects non-POST");
  assert.equal(
    (await invoke(handleCoverLetterCandidates, "POST", { fileNames: [] })).status,
    400,
    "cover batch rejects an empty file list"
  );
  for (const badName of ["../evil.cover", "", "default.resume"]) {
    const res = await invoke(handleCoverLetterCandidates, "POST", { fileNames: [badName] });
    assert.equal(res.status, 400, `cover batch rejects an unsafe fileName: ${JSON.stringify(badName)}`);
    assert.match(JSON.parse(res.body).error, /valid cover letter/);
  }
  {
    const res = await invoke(handleCoverLetterCandidates, "POST", {
      fileNames: ["default.cover", "broken.cover", "growth.cover", "absent.cover"]
    });
    assert.equal(res.status, 200, "cover batch reads several letters in one request");
    const body = JSON.parse(res.body);
    assert.deepEqual(
      body.candidates.map((candidate) => candidate.fileName),
      ["default.cover", "growth.cover"],
      "invalid and absent letters are skipped while valid siblings still rank"
    );
    assert.deepEqual(
      body.candidates.map((candidate) => candidate.label),
      ["Default", "Growth"],
      "each letter carries its friendly label"
    );
    assert.deepEqual(Object.keys(body), ["candidates"], "the cover batch answers with candidates and nothing else");
  }

  console.log("Workspace candidate batch probes: all checks passed");
} finally {
  process.chdir(originalCwd);
}
