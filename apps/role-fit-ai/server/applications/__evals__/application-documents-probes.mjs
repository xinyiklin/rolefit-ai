// Application document + attachment route probes in an isolated temporary
// workspace. Supersedes the resume-only resume-pdf-probes: the routes now store
// both document kinds identically (PDF + editable source) and also accept
// arbitrary user attachments, which is the part that must fail closed.
//
// Locked here: method gates, id/traversal safety before any filesystem write,
// magic-byte validation, the per-application attachment cap, name validation on
// both write and read, and the download headers that keep a user-supplied file
// from ever rendering as a document on the app's own origin.
//
// NOTE (reported, not encoded as an expectation): the route's own 8 MB decoded
// cap and base64ToBuffer's 10 MB cap are both SHADOWED by readBody's request-body
// byte cap — any base64 payload large enough to decode past 8 MB is itself over
// that cap and is rejected first, surfacing as the generic catch rather than the
// intended 413. Oversize still fails closed with nothing written, which is what
// these probes lock.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  handleApplicationAttachmentFile,
  handleApplicationDocumentFile,
  handleSaveApplicationDocument,
  handleUploadApplicationAttachment
} from "../routes.ts";
import { MAX_ATTACHMENTS_PER_APPLICATION, safeAttachmentFileName } from "../documents.ts";
import { writeApplications } from "../index.ts";

const isolatedRoot = await mkdtemp(join(tmpdir(), "rolefit-app-documents-"));
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
  get json() {
    return JSON.parse(this.text);
  }
}

function jsonRequest(method, payload) {
  const req = Readable.from([JSON.stringify(payload)]);
  req.method = method;
  return req;
}

async function saveDocument(id, kind, payload, method = "POST") {
  const res = new FakeResponse();
  await handleSaveApplicationDocument(jsonRequest(method, payload), res, id, kind, workspaceDir);
  return res;
}

async function readDocument(id, kind, format, method = "GET") {
  const res = new FakeResponse();
  await handleApplicationDocumentFile({ method }, res, id, kind, format, workspaceDir);
  return res;
}

async function uploadAttachment(id, payload, method = "POST") {
  const res = new FakeResponse();
  await handleUploadApplicationAttachment(jsonRequest(method, payload), res, id, workspaceDir);
  return res;
}

async function attachmentFile(id, fileName, method = "GET") {
  const res = new FakeResponse();
  await handleApplicationAttachmentFile({ method }, res, id, fileName, workspaceDir);
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
const pngBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);
const b64 = (buffer) => buffer.toString("base64");
const dirOf = (id) => join(workspaceDir, "applications", id);

// Attachment uploads require the record to exist, so the probes seed
// applications.json through the same writer the routes use.
async function writeTrackedApplications(ids) {
  const now = new Date().toISOString();
  await writeApplications(
    workspaceDir,
    ids.map((id) => ({ id, title: id, jobUrl: "", status: "applied", createdAt: now, updatedAt: now }))
  );
}

try {
  // --- Method gates ---
  assert.equal((await saveDocument("app-1", "resume", {}, "GET")).status, 405, "document save rejects non-POST");
  assert.equal((await readDocument("app-1", "resume", "pdf", "POST")).status, 405, "document stream rejects non-GET");
  assert.equal((await uploadAttachment("app-1", {}, "GET")).status, 405, "attachment upload rejects non-POST");
  assert.equal((await attachmentFile("app-1", "a.pdf", "PUT")).status, 405, "attachment route rejects non-GET/DELETE");

  // --- Traversal / invalid ids: rejected before any filesystem write ---
  for (const badId of ["../evil", "a/b", "..", "", "with space", "x".repeat(81), "a/../../etc"]) {
    for (const kind of ["resume", "cover"]) {
      const res = await saveDocument(badId, kind, { pdfBase64: b64(pdfBytes), fileName: "doc.pdf" });
      assert.equal(res.status, 400, `${kind} save rejects an unsafe id: ${JSON.stringify(badId)}`);
      assert.match(res.json.error, /Invalid application id/);
      assert.equal((await readDocument(badId, kind, "pdf")).status, 400, `${kind} stream rejects an unsafe id`);
    }
    assert.equal(
      (await uploadAttachment(badId, { fileName: "cv.pdf", dataBase64: b64(pdfBytes) })).status,
      400,
      `attachment upload rejects an unsafe id: ${JSON.stringify(badId)}`
    );
  }
  assert.equal(await exists(join(workspaceDir, "applications")), false, "invalid ids create no applications dir");
  assert.equal(await exists(join(isolatedRoot, "evil")), false, "traversal never wrote a sibling of the workspace");
  assert.equal(await exists(join(isolatedRoot, "etc")), false, "traversal never escaped above the workspace");

  // --- Document body validation ---
  assert.equal((await saveDocument("app-good", "resume", {})).status, 400, "a save with no document is rejected");
  assert.match((await saveDocument("app-good", "cover", {})).json.error, /No document to save/);

  {
    const res = await saveDocument("app-good", "resume", { pdfBase64: b64(Buffer.from("plainly not a pdf")) });
    assert.equal(res.status, 400, "a non-PDF body is rejected");
    assert.match(res.json.error, /not a valid PDF/);
    assert.equal(await exists(join(dirOf("app-good"), "resume.pdf")), false, "the rejected non-PDF wrote no file");
  }
  assert.match(
    (await saveDocument("app-good", "resume", { pdfBase64: "!!!! not base64 !!!!" })).json.error,
    /not valid base64/,
    "malformed base64 is a safe 400"
  );
  {
    const oversize = Buffer.concat([Buffer.from("%PDF-", "utf8"), Buffer.alloc(7_000_000, 0x20)]);
    const res = await saveDocument("app-oversize", "resume", { pdfBase64: b64(oversize) });
    assert.notEqual(res.status, 200, "an over-cap upload is not accepted");
    assert.equal(await exists(join(dirOf("app-oversize"), "resume.pdf")), false, "an over-cap upload writes no file");
  }

  // --- Both kinds store and stream identically ---
  for (const [kind, extension] of [["resume", "resume"], ["cover", "cover"]]) {
    const source = `{"format":"typeset-${kind}","schemaVersion":2}`;
    const res = await saveDocument("app-123", kind, {
      pdfBase64: b64(pdfBytes),
      sourceText: source,
      fileName: `Xinyi_Lin_Acme_${kind}.pdf`
    });
    assert.equal(res.status, 200, `a valid ${kind} save succeeds`);
    assert.equal(res.json.artifacts.hasPdf, true, `the ${kind} save reports a stored PDF`);
    assert.equal(res.json.artifacts.hasSource, true, `the ${kind} save reports a stored source file`);

    assert.ok(
      (await readFile(join(dirOf("app-123"), `${kind}.pdf`))).equals(pdfBytes),
      `the persisted ${kind} PDF matches the upload`
    );
    assert.equal(
      await readFile(join(dirOf("app-123"), `${kind}.${extension}`), "utf8"),
      source,
      `the persisted .${extension} source matches the upload`
    );

    const pdfRes = await readDocument("app-123", kind, "pdf");
    assert.equal(pdfRes.status, 200, `the stored ${kind} PDF streams back`);
    assert.equal(pdfRes.headers["Content-Type"], "application/pdf", `the ${kind} PDF is served as application/pdf`);
    assert.equal(pdfRes.headers["X-Content-Type-Options"], "nosniff", `the ${kind} PDF is served with nosniff`);
    assert.match(pdfRes.headers["Content-Disposition"], /^attachment;/, `the ${kind} PDF is served as a download`);
    assert.ok(pdfRes.buffer.equals(pdfBytes), `the streamed ${kind} PDF round-trips`);

    const sourceRes = await readDocument("app-123", kind, extension);
    assert.equal(sourceRes.status, 200, `the stored .${extension} streams back`);
    assert.equal(sourceRes.buffer.toString("utf8"), source, `the streamed .${extension} round-trips`);

    // A kind may only serve its OWN source format.
    const wrongFormat = kind === "resume" ? "cover" : "resume";
    assert.equal(
      (await readDocument("app-123", kind, wrongFormat)).status,
      404,
      `${kind} refuses the other kind's source format`
    );
    assert.equal((await readDocument("app-123", kind, "exe")).status, 404, "an unknown format is refused");
  }

  // A source-only save (the PDF render failed) still keeps the editable file,
  // and clears a PDF from an earlier save so the record and the disk agree
  // rather than the record claiming a current PDF that no longer matches.
  {
    const res = await saveDocument("app-source-only", "cover", { sourceText: "{}", fileName: "letter.pdf" });
    assert.equal(res.status, 200, "a source-only save succeeds");
    assert.equal(res.json.artifacts.hasPdf, false, "a source-only save reports no PDF");
    assert.equal(res.json.artifacts.hasSource, true, "a source-only save reports the stored source");

    await saveDocument("app-pair", "resume", { pdfBase64: b64(pdfBytes), sourceText: "{}" });
    assert.equal(await exists(join(dirOf("app-pair"), "resume.pdf")), true, "the first save stored a PDF");
    const second = await saveDocument("app-pair", "resume", { sourceText: "{\"v\":2}" });
    assert.equal(second.json.artifacts.hasPdf, false, "a later source-only save reports no PDF");
    assert.equal(
      await exists(join(dirOf("app-pair"), "resume.pdf")),
      false,
      "the superseded PDF does not survive a source-only save"
    );
  }

  assert.equal((await readDocument("app-absent", "resume", "pdf")).status, 404, "a missing document is a clean 404");

  // --- Attachments ---
  // The upload targets a real record: a well-formed id for a row that does not
  // exist must not create an orphan directory the tracker can never clean up.
  {
    const res = await uploadAttachment("app-not-tracked", { fileName: "cv.pdf", dataBase64: b64(pdfBytes) });
    assert.equal(res.status, 404, "an upload for an unknown application is refused");
    assert.equal(
      await exists(join(dirOf("app-not-tracked"), "attachments")),
      false,
      "a refused upload creates no directory"
    );
  }
  // Every id used below is a tracked record.
  await writeTrackedApplications(["app-123", "app-cap", "app-traversal"]);

  // An unsupported (or nameless) extension is refused outright.
  for (const badName of ["notes.exe", "shell.sh", "archive.zip", "..", "", ".pdf", "   .pdf"]) {
    const res = await uploadAttachment("app-123", { fileName: badName, dataBase64: b64(pdfBytes) });
    assert.equal(res.status, 400, `an unsupported attachment name is refused: ${JSON.stringify(badName)}`);
  }
  // A path in the name is neutralized to its base name rather than followed:
  // the file lands inside this application's attachments dir or nowhere.
  for (const traversal of ["../escape.pdf", "a/b/escape.pdf", "..\\escape.pdf"]) {
    const res = await uploadAttachment("app-traversal", { fileName: traversal, dataBase64: b64(pdfBytes) });
    assert.equal(res.status, 200, `a path-bearing name is stored under its base name: ${JSON.stringify(traversal)}`);
    assert.equal(res.json.attachment.fileName, "escape.pdf", "the stored name carries no path");
  }
  for (const outside of [join(isolatedRoot, "escape.pdf"), join(workspaceDir, "escape.pdf"), join(workspaceDir, "applications", "escape.pdf")]) {
    assert.equal(await exists(outside), false, `a traversing name never wrote to ${outside}`);
  }
  assert.deepEqual(
    await readdir(join(dirOf("app-traversal"), "attachments")),
    ["escape.pdf"],
    "every traversal attempt landed on the same in-scope file"
  );
  assert.equal(
    (await uploadAttachment("app-123", { fileName: "transcript.pdf", dataBase64: b64(pngBytes) })).status,
    400,
    "bytes that contradict the extension are refused"
  );
  assert.equal(
    (await uploadAttachment("app-123", { fileName: "transcript.pdf", dataBase64: "" })).status,
    400,
    "an attachment with no contents is refused"
  );

  {
    const res = await uploadAttachment("app-123", {
      fileName: "My Transcript (final).pdf",
      label: "My Transcript (final).pdf",
      dataBase64: b64(pdfBytes)
    });
    assert.equal(res.status, 200, "a valid attachment is stored");
    const stored = res.json.attachment;
    assert.equal(stored.fileName, "my transcript _final_.pdf", "the stored name is sanitized and case-folded");
    assert.equal(stored.label, "My Transcript (final).pdf", "the user's own name survives as the display label");
    assert.equal(stored.size, pdfBytes.length, "the record remembers the stored size");
    assert.equal(stored.contentType, "application/pdf", "the record remembers a narrow content type");

    const fileRes = await attachmentFile("app-123", stored.fileName);
    assert.equal(fileRes.status, 200, "the attachment streams back");
    assert.equal(fileRes.headers["X-Content-Type-Options"], "nosniff", "an attachment is served with nosniff");
    assert.match(fileRes.headers["Content-Disposition"], /^attachment;/, "an attachment is served as a download");
    assert.match(fileRes.headers["Content-Security-Policy"], /default-src 'none'/, "an attachment cannot load anything");
    assert.ok(fileRes.buffer.equals(pdfBytes), "the streamed attachment round-trips");

    // A name that does not survive validation can never address a stored file.
    assert.equal((await attachmentFile("app-123", "../../applications.json")).status, 404, "traversal on read is a 404");
    assert.equal((await attachmentFile("app-123", "absent.pdf")).status, 404, "a missing attachment is a clean 404");
  }

  // Re-uploading the same name replaces it rather than counting again.
  {
    const before = (await readdir(join(dirOf("app-123"), "attachments"))).length;
    const res = await uploadAttachment("app-123", { fileName: "My Transcript (final).pdf", dataBase64: b64(pdfBytes) });
    assert.equal(res.status, 200, "replacing an attachment succeeds");
    assert.equal(
      (await readdir(join(dirOf("app-123"), "attachments"))).length,
      before,
      "replacing an attachment does not add a second file"
    );
  }

  // The per-application cap is enforced on disk, not in the client.
  {
    for (let i = 0; i < MAX_ATTACHMENTS_PER_APPLICATION; i += 1) {
      await uploadAttachment("app-cap", { fileName: `file-${i}.txt`, dataBase64: b64(Buffer.from(`note ${i}`)) });
    }
    const res = await uploadAttachment("app-cap", { fileName: "one-too-many.txt", dataBase64: b64(Buffer.from("x")) });
    assert.equal(res.status, 409, "the attachment cap is enforced");
    assert.match(res.json.error, /Remove one first/);
    assert.equal(
      (await readdir(join(dirOf("app-cap"), "attachments"))).length,
      MAX_ATTACHMENTS_PER_APPLICATION,
      "the refused upload wrote no file"
    );
  }

  // Delete removes the file and stays a 200 when it is already gone.
  {
    const del = await attachmentFile("app-cap", "file-0.txt", "DELETE");
    assert.equal(del.status, 200, "deleting an attachment succeeds");
    assert.equal(
      await exists(join(dirOf("app-cap"), "attachments", "file-0.txt")),
      false,
      "the deleted attachment is gone from disk"
    );
    assert.equal((await attachmentFile("app-cap", "file-0.txt", "DELETE")).status, 200, "deleting twice is idempotent");
  }

  assert.deepEqual(
    (await readdir(join(workspaceDir, "applications"))).sort(),
    ["app-123", "app-cap", "app-pair", "app-source-only", "app-traversal"],
    "only the valid saves persisted application directories"
  );

  // Name derivation must be idempotent: the upload route stores what it returns
  // and the record sanitizer re-derives the same value later. A name that
  // changed on the second pass left the record pointing at bytes on disk that
  // nothing could download or remove.
  for (const raw of [
    `${"a".repeat(79)}.${"b".repeat(20)}.pdf`,
    "  spaced name  .pdf",
    "..dots..pdf",
    `${"x".repeat(200)}.pdf`,
    "../escape.pdf",
    "Ünïcodé résumé.pdf"
  ]) {
    const first = safeAttachmentFileName(raw);
    if (!first) continue;
    assert.equal(
      safeAttachmentFileName(first.fileName)?.fileName,
      first.fileName,
      `attachment name derivation is idempotent for ${JSON.stringify(raw)}`
    );
  }

  // A case-only variant is the same file on macOS and Windows, so it must
  // resolve to one stored name — otherwise two records would point at one blob.
  {
    const before = await readdir(join(dirOf("app-traversal"), "attachments"));
    const res = await uploadAttachment("app-traversal", { fileName: "ESCAPE.pdf", dataBase64: b64(pdfBytes) });
    assert.equal(res.status, 200, "a case-only variant uploads");
    assert.equal(res.json.attachment.fileName, "escape.pdf", "a case-only variant resolves to the same stored name");
    assert.deepEqual(
      await readdir(join(dirOf("app-traversal"), "attachments")),
      before,
      "a case-only variant replaces rather than adding a second file"
    );
  }

  console.log("application document + attachment probes: PASS");
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
