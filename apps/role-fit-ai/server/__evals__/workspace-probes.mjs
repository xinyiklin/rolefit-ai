// Base-resume persistence probes in an isolated temporary workspace.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoAppRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const starter = await readFile(join(repoAppRoot, "server", "starter.resume"), "utf8");
const isolatedRoot = await mkdtemp(join(tmpdir(), "rolefit-workspace-"));
const originalCwd = process.cwd();
const locations = {
  appRoot: repoAppRoot,
  workspaceDir: join(isolatedRoot, "explicit-workspace")
};

class FakeResponse {
  status = 0;
  body = "";
  destroyed = false;
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

// A request whose body is raw (possibly non-JSON) text, for malformed-body probes.
function rawRequest(method, raw) {
  const req = Readable.from([raw]);
  req.method = method;
  return req;
}

try {
  process.chdir(isolatedRoot);
  const {
    WorkspaceStorageError,
    handleWorkspaceBaseResume,
    handleSelectBaseResume,
    handleRestoreBaseResume,
    readWorkspaceBaseResume
  } = await import(`../workspace.ts?workspace-probe=${Date.now()}`);

  async function invoke(handler, method, payload) {
    const res = new FakeResponse();
    await handler(request(method, payload), res, locations);
    return res;
  }
  await mkdir(locations.workspaceDir, { recursive: true });

  assert.equal(
    (await readWorkspaceBaseResume("base-resume.resume", locations)).exists,
    false,
    "missing explicit version does not become starter"
  );
  assert.equal(
    (await readWorkspaceBaseResume(undefined, locations)).text,
    starter,
    "starter reads from the explicit app root"
  );

  await writeFile(join(locations.workspaceDir, "base-resume.resume"), "{" + "x".repeat(100), "utf8");
  await assert.rejects(
    () => readWorkspaceBaseResume(undefined, locations),
    (error) => error instanceof WorkspaceStorageError,
    "corrupt saved .resume fails closed instead of falling through to starter"
  );

  await writeFile(join(locations.workspaceDir, "base-resume.resume"), starter, "utf8");
  assert.equal((await readWorkspaceBaseResume(undefined, locations)).exists, true, "valid strict .resume loads");

  const first = JSON.parse(starter);
  first.document.name = "First Concurrent Save";
  const second = JSON.parse(starter);
  second.document.name = "Second Concurrent Save";
  const firstRes = new FakeResponse();
  const secondRes = new FakeResponse();
  await Promise.all([
    handleWorkspaceBaseResume(request("POST", { fileName: "base-resume.resume", text: JSON.stringify(first) }), firstRes, locations),
    handleWorkspaceBaseResume(request("POST", { fileName: "base-resume.resume", text: JSON.stringify(second) }), secondRes, locations)
  ]);
  assert.equal(firstRes.status, 200);
  assert.equal(secondRes.status, 200);
  const final = JSON.parse(await readFile(join(locations.workspaceDir, "base-resume.resume"), "utf8"));
  assert.equal(final.document.name, "Second Concurrent Save", "serialized saves preserve invocation order");
  const history = await readdir(join(locations.workspaceDir, ".trash"));
  assert.equal(history.length, 2, "both superseded versions remain recoverable with collision-free names");
  assert.equal((await readdir(locations.workspaceDir)).some((name) => name.endsWith(".tmp")), false, "atomic writes leave no temporary file");

  // --- assertBaseResumeFileName: the base-resume name guard ---
  // Exercised through readWorkspaceBaseResume's explicit-version path, which is
  // the exported seam over the internal assertBaseResumeFileName. Traversal,
  // absolute, embedded "..", empty, and wrong-extension names all fail closed.
  // An empty name is falsy, so readWorkspaceBaseResume treats it as "no explicit
  // version" — the empty-name rejection is asserted at the handler level below.
  for (const badName of [
    "../evil.resume",
    "/etc/passwd.resume",
    "base-resume-../x.resume",
    "base-resume.txt"
  ]) {
    await assert.rejects(
      () => readWorkspaceBaseResume(badName, locations),
      (error) => error instanceof Error && /valid base resume/.test(error.message),
      `unsafe base-resume version name is rejected: ${JSON.stringify(badName)}`
    );
  }
  assert.equal(
    (await readWorkspaceBaseResume("base-resume-fullstack.resume", locations)).exists,
    false,
    "a well-formed but absent variant name is a clean miss, never a throw"
  );

  // --- handleSelectBaseResume: method gate, malformed body, name rejection, hand-off ---
  assert.equal((await invoke(handleSelectBaseResume, "GET", {})).status, 405, "select rejects non-POST");
  {
    const res = new FakeResponse();
    await handleSelectBaseResume(rawRequest("POST", "not json"), res, locations);
    assert.equal(res.status, 400, "select rejects a malformed JSON body");
  }
  for (const badName of ["../evil.resume", "base-resume-../x.resume", "", "base-resume.txt"]) {
    const res = await invoke(handleSelectBaseResume, "POST", { fileName: badName });
    assert.equal(res.status, 400, `select rejects an unsafe fileName: ${JSON.stringify(badName)}`);
    assert.match(JSON.parse(res.body).error, /valid base resume/);
  }
  assert.equal(
    (await invoke(handleSelectBaseResume, "POST", { fileName: "base-resume-fullstack.resume" })).status,
    404,
    "select of a valid-but-absent version is a 404, not a starter fallback"
  );
  {
    // base-resume.resume exists here (written by the persistence block above).
    const res = await invoke(handleSelectBaseResume, "POST", { fileName: "base-resume.resume" });
    assert.equal(res.status, 200, "select of an existing version succeeds");
    assert.equal(JSON.parse(res.body).baseResume.exists, true, "the selected version is returned as present");
  }

  // --- Oversize save is rejected with 413 before anything is written ---
  {
    const res = await invoke(handleWorkspaceBaseResume, "POST", {
      fileName: "base-resume.txt",
      text: "x".repeat(200_001)
    });
    assert.equal(res.status, 413, "an over-cap base-resume save is rejected with 413");
    assert.equal(
      (await readdir(locations.workspaceDir)).includes("base-resume.txt"),
      false,
      "the rejected oversize save wrote nothing"
    );
  }

  // --- handleRestoreBaseResume: method gate, malformed body, key guard, hand-off ---
  assert.equal((await invoke(handleRestoreBaseResume, "GET", {})).status, 405, "restore rejects non-POST");
  {
    const res = new FakeResponse();
    await handleRestoreBaseResume(rawRequest("POST", "not json"), res, locations);
    assert.equal(res.status, 400, "restore rejects a malformed JSON body");
  }
  const beforeDir = (await readdir(locations.workspaceDir)).sort();
  const beforeTrash = (await readdir(join(locations.workspaceDir, ".trash"))).sort();
  for (const badKey of ["../evil", "foo/bar", "", "not-a-matching-key", "2026__unrelated.resume"]) {
    assert.equal(
      (await invoke(handleRestoreBaseResume, "POST", { key: badKey })).status,
      400,
      `restore rejects an unsafe/invalid history key: ${JSON.stringify(badKey)}`
    );
  }
  assert.deepEqual(
    (await readdir(locations.workspaceDir)).sort(),
    beforeDir,
    "a rejected restore leaves the workspace directory unchanged"
  );
  assert.deepEqual(
    (await readdir(join(locations.workspaceDir, ".trash"))).sort(),
    beforeTrash,
    "a rejected restore leaves .trash unchanged"
  );

  const restoreKey = "2026-07-21T09-08-07-000Z__base-resume.resume";
  await writeFile(join(locations.workspaceDir, ".trash", restoreKey), starter, "utf8");
  {
    const res = await invoke(handleRestoreBaseResume, "POST", { key: restoreKey });
    assert.equal(res.status, 200, "a valid history key restores");
    assert.equal(JSON.parse(res.body).restored, true, "the restore reports success");
    assert.equal(
      await readFile(join(locations.workspaceDir, "base-resume.resume"), "utf8"),
      starter,
      "the restored base resume carries the archived bytes"
    );
  }

  console.log("workspace persistence probes: PASS");
} finally {
  process.chdir(originalCwd);
  await rm(isolatedRoot, { recursive: true, force: true });
}
