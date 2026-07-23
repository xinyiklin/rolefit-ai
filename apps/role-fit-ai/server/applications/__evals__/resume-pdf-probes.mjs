// Application resume-PDF route probes in an isolated temporary workspace.
//
// handleSaveApplicationResume enforces %PDF- magic bytes, a decoded size cap,
// and applicationResumeDir() traversal safety; handleApplicationResumeFile
// streams the stored artifact back by id. Neither had route-level coverage.
//
// NOTE (reported, not encoded as an expectation): the route's own 8 MB decoded
// cap (routes.ts ~166) and base64ToBuffer's 10 MB cap are both SHADOWED by
// readBody's 8 MB request-body byte cap (http.ts) — any base64 payload large
// enough to decode past 8 MB is itself > 8 MB and is rejected by readBody first,
// surfacing as the generic 500 catch rather than the intended 413. Oversize
// still fails closed with nothing written, which is what this probe locks.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { handleSaveApplicationResume, handleApplicationResumeFile } from "../routes.ts";

const isolatedRoot = await mkdtemp(join(tmpdir(), "rolefit-app-resume-"));
const workspaceDir = join(isolatedRoot, "workspace");

class FakeResponse {
  status = 0;
  headers = {};
  chunk = null;
  ended = false;
  writeHead(status, headers) {
    this.status = status;
    if (headers) this.headers = headers;
  }
  end(chunk = "") {
    this.chunk = chunk;
    this.ended = true;
  }
  get text() {
    return Buffer.isBuffer(this.chunk) ? this.chunk.toString("utf8") : String(this.chunk ?? "");
  }
  get buffer() {
    return Buffer.isBuffer(this.chunk) ? this.chunk : Buffer.from(String(this.chunk ?? ""), "utf8");
  }
}

function jsonRequest(method, payload) {
  const req = Readable.from([JSON.stringify(payload)]);
  req.method = method;
  return req;
}

async function save(id, payload, method = "POST") {
  const res = new FakeResponse();
  await handleSaveApplicationResume(jsonRequest(method, payload), res, id, workspaceDir);
  return res;
}

async function readFileRoute(id, method = "GET") {
  const res = new FakeResponse();
  await handleApplicationResumeFile({ method }, res, id, workspaceDir);
  return res;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const pdfBytes = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", "utf8");
const b64 = (buffer) => buffer.toString("base64");

try {
  // --- Method gates ---
  assert.equal((await save("app-1", {}, "GET")).status, 405, "save rejects non-POST");
  assert.equal((await readFileRoute("app-1", "POST")).status, 405, "file stream rejects non-GET");

  // --- Traversal / invalid application ids: rejected before any filesystem write ---
  for (const badId of ["../evil", "a/b", "..", "", "with space", "x".repeat(81), "a/../../etc"]) {
    const res = await save(badId, { pdfBase64: b64(pdfBytes), fileName: "resume.pdf" });
    assert.equal(res.status, 400, `save rejects an unsafe application id: ${JSON.stringify(badId)}`);
    assert.match(JSON.parse(res.text).error, /Invalid application id/);
    assert.equal(
      (await readFileRoute(badId)).status,
      400,
      `file stream rejects an unsafe application id: ${JSON.stringify(badId)}`
    );
  }
  // No traversal write escaped the workspace, and no applications dir was created.
  assert.equal(await exists(join(workspaceDir, "applications")), false, "invalid ids create no applications dir");
  assert.equal(await exists(join(isolatedRoot, "evil")), false, "traversal never wrote a sibling of the workspace");
  assert.equal(await exists(join(isolatedRoot, "etc")), false, "traversal never escaped above the workspace");

  // --- Body-level validation ---
  assert.equal((await save("app-good", {})).status, 400, "a save with no artifacts is rejected");
  assert.match(JSON.parse((await save("app-good", {})).text).error, /No resume artifacts/);

  // Non-PDF body (valid base64, wrong magic bytes) is rejected, nothing written.
  {
    const res = await save("app-good", { pdfBase64: b64(Buffer.from("this is plainly not a pdf file body")) });
    assert.equal(res.status, 400, "a non-PDF body is rejected");
    assert.match(JSON.parse(res.text).error, /not a valid PDF/);
    assert.equal(await exists(join(workspaceDir, "applications", "app-good", "resume.pdf")), false, "the rejected non-PDF wrote no file");
  }

  // Malformed base64 is rejected as a safe 400.
  {
    const res = await save("app-good", { pdfBase64: "!!!! not base64 !!!!" });
    assert.equal(res.status, 400, "malformed base64 is rejected");
    assert.match(JSON.parse(res.text).error, /not valid base64/);
  }

  // Over-cap upload: a body past readBody's 8 MB cap fails closed with no file.
  // (7 MB decoded → ~9.3 MB of base64, exceeding the request-body byte cap.)
  {
    const oversize = Buffer.concat([Buffer.from("%PDF-", "utf8"), Buffer.alloc(7_000_000, 0x20)]);
    const res = await save("app-oversize", { pdfBase64: b64(oversize) });
    assert.notEqual(res.status, 200, "an over-cap upload is not accepted");
    assert.equal(
      await exists(join(workspaceDir, "applications", "app-oversize", "resume.pdf")),
      false,
      "an over-cap upload writes no file"
    );
  }

  // --- Valid save + read round-trip ---
  {
    const res = await save("app-123", { pdfBase64: b64(pdfBytes), fileName: "Tailored Resume.pdf" });
    assert.equal(res.status, 200, "a valid PDF save succeeds");
    const payload = JSON.parse(res.text);
    assert.equal(payload.resumeArtifacts.hasPdf, true, "the save reports a stored PDF");
    assert.equal(payload.resumeArtifacts.fileName, "Tailored Resume.pdf", "the save echoes the client file name");

    const stored = await readFile(join(workspaceDir, "applications", "app-123", "resume.pdf"));
    assert.ok(stored.equals(pdfBytes), "the persisted bytes match the uploaded PDF");

    const fileRes = await readFileRoute("app-123");
    assert.equal(fileRes.status, 200, "the stored resume streams back");
    assert.equal(fileRes.headers["Content-Type"], "application/pdf", "the stream is served as application/pdf");
    assert.ok(fileRes.buffer.equals(pdfBytes), "the streamed bytes round-trip the uploaded PDF");
  }

  // --- A valid-but-absent id is a 404, not a traversal or crash ---
  assert.equal((await readFileRoute("app-absent")).status, 404, "a missing artifact is a clean 404");

  // The only application dir on disk is the one legitimately saved.
  assert.deepEqual(
    (await readdir(join(workspaceDir, "applications"))).sort(),
    ["app-123"],
    "only the valid save persisted an application directory"
  );

  console.log("application resume-pdf probes: PASS");
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
