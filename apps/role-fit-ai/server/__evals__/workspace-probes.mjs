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

try {
  process.chdir(isolatedRoot);
  const {
    WorkspaceStorageError,
    handleWorkspaceBaseResume,
    readWorkspaceBaseResume
  } = await import(`../workspace.ts?workspace-probe=${Date.now()}`);
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

  console.log("workspace persistence probes: PASS");
} finally {
  process.chdir(originalCwd);
  await rm(isolatedRoot, { recursive: true, force: true });
}
