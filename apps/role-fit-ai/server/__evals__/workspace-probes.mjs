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

try {
  process.chdir(isolatedRoot);
  const {
    WorkspaceStorageError,
    handleWorkspaceBaseResume,
    jobWorkspaceDir,
    readWorkspaceBaseResume
  } = await import(`../workspace.ts?workspace-probe=${Date.now()}`);
  await mkdir(jobWorkspaceDir, { recursive: true });

  assert.equal((await readWorkspaceBaseResume("base-resume.resume")).exists, false, "missing explicit version does not become starter");

  await writeFile(join(jobWorkspaceDir, "base-resume.resume"), "{" + "x".repeat(100), "utf8");
  await assert.rejects(
    () => readWorkspaceBaseResume(),
    (error) => error instanceof WorkspaceStorageError,
    "corrupt saved .resume fails closed instead of falling through to starter"
  );

  await writeFile(join(jobWorkspaceDir, "base-resume.resume"), starter, "utf8");
  assert.equal((await readWorkspaceBaseResume()).exists, true, "valid strict .resume loads");

  const first = JSON.parse(starter);
  first.document.name = "First Concurrent Save";
  const second = JSON.parse(starter);
  second.document.name = "Second Concurrent Save";
  const firstRes = new FakeResponse();
  const secondRes = new FakeResponse();
  await Promise.all([
    handleWorkspaceBaseResume(request("POST", { fileName: "base-resume.resume", text: JSON.stringify(first) }), firstRes),
    handleWorkspaceBaseResume(request("POST", { fileName: "base-resume.resume", text: JSON.stringify(second) }), secondRes)
  ]);
  assert.equal(firstRes.status, 200);
  assert.equal(secondRes.status, 200);
  const final = JSON.parse(await readFile(join(jobWorkspaceDir, "base-resume.resume"), "utf8"));
  assert.equal(final.document.name, "Second Concurrent Save", "serialized saves preserve invocation order");
  const history = await readdir(join(jobWorkspaceDir, ".trash"));
  assert.equal(history.length, 2, "both superseded versions remain recoverable with collision-free names");
  assert.equal((await readdir(jobWorkspaceDir)).some((name) => name.endsWith(".tmp")), false, "atomic writes leave no temporary file");

  console.log("workspace persistence probes: PASS");
} finally {
  process.chdir(originalCwd);
  await rm(isolatedRoot, { recursive: true, force: true });
}
