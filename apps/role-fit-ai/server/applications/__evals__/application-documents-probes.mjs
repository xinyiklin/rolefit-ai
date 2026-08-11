// Application document + attachment route probes in an isolated temporary
// workspace. Supersedes the resume-only resume-pdf-probes: each document route
// stores one strict source or explicit PDF, and additional uploads are PDF-only.
//
// Locked here: method gates, id/traversal safety before any filesystem write,
// magic-byte validation, the per-application attachment cap, name validation on
// both write and read, and the download headers that keep a user-supplied file
// from ever rendering as a document on the app's own origin.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  handleApplicationAttachmentFile,
  handleUploadApplicationAttachment
} from "../attachmentRoutes.ts";
import {
  handleApplicationDocumentFile,
  handleSaveApplicationDocument
} from "../documentRoutes.ts";
import { persistApplicationDocument } from "../documentService.ts";
import { handleSaveApplications } from "../trackerRoutes.ts";
import { MAX_ATTACHMENTS_PER_APPLICATION, safeAttachmentFileName } from "../documents.ts";
import { readApplications, writeApplications } from "../storage.ts";
import {
  COVER_LETTER_STYLE_DEFAULTS,
  serializeCoverLetterFile
} from "@typeset/engine/lib/coverLetter.ts";

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
  const current = (await readApplications(workspaceDir)).find((application) => application.id === id);
  await handleSaveApplicationDocument(
    jsonRequest(method, { ...payload, ...(current ? { baseUpdatedAt: current.updatedAt } : {}) }),
    res,
    id,
    kind,
    workspaceDir
  );
  return res;
}

async function readDocument(id, kind, format, method = "GET") {
  const res = new FakeResponse();
  await handleApplicationDocumentFile({ method }, res, id, kind, format, workspaceDir);
  return res;
}

async function uploadAttachment(id, payload, method = "POST") {
  const res = new FakeResponse();
  const current = (await readApplications(workspaceDir)).find((application) => application.id === id);
  await handleUploadApplicationAttachment(
    jsonRequest(method, { ...payload, ...(current ? { baseUpdatedAt: current.updatedAt } : {}) }),
    res,
    id,
    workspaceDir
  );
  return res;
}

async function attachmentFile(id, fileName, method = "GET") {
  const res = new FakeResponse();
  if (method === "DELETE") {
    const current = (await readApplications(workspaceDir)).find((application) => application.id === id);
    await handleApplicationAttachmentFile(
      jsonRequest(method, current ? { baseUpdatedAt: current.updatedAt } : {}),
      res,
      id,
      fileName,
      workspaceDir
    );
  } else {
    await handleApplicationAttachmentFile({ method }, res, id, fileName, workspaceDir);
  }
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
const resumeSource = await readFile(new URL("../../starter.resume", import.meta.url), "utf8");
const coverSource = serializeCoverLetterFile({
  header: {
    visible: true,
    name: "Xinyi Lin",
    contact: ["xinyi@example.test"]
  },
  sections: [{
    id: "cover",
    heading: "",
    type: "summary",
    items: [{
      id: "body",
      titleLeft: "",
      titleRight: "",
      subtitleLeft: "",
      subtitleRight: "",
      bullets: [{ id: "paragraph", text: "Dear Hiring Team,\n\nThank you for considering my application." }]
    }]
  }]
}, COVER_LETTER_STYLE_DEFAULTS);

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

  await writeTrackedApplications([
    "app-good",
    "app-oversize",
    "app-123",
    "app-source-only",
    "app-pair",
    "app-remove",
    "app-rollback-delete",
    "app-rollback-pdf-to-source",
    "app-rollback-source-to-pdf",
    "app-delete",
    "app-cap",
    "app-traversal"
  ]);

  {
    const now = new Date().toISOString();
    const current = await readApplications(workspaceDir);
    await writeApplications(workspaceDir, [{
      id: "app-skipped",
      title: "Skipped job",
      jobUrl: "",
      status: "not_applying",
      notApplyingAt: now,
      createdAt: now,
      updatedAt: now
    }, ...current]);
    const rejected = await saveDocument("app-skipped", "resume", {
      sourceText: resumeSource,
      fileName: "must-not-save.resume"
    });
    assert.equal(rejected.status, 409, "a Skipped job rejects application-document saves");
    const rejectedAttachment = await uploadAttachment("app-skipped", {
      fileName: "must-not-save.pdf",
      dataBase64: b64(pdfBytes)
    });
    assert.equal(rejectedAttachment.status, 409, "a Skipped job rejects additional-document saves");
    assert.equal(
      await exists(dirOf("app-skipped")),
      false,
      "rejected Skipped-document saves leave no orphan personal file"
    );
  }

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
  assert.equal(
    (await saveDocument("app-good", "resume", { sourceText: "{}" })).status,
    400,
    "a malformed strict resume source is rejected"
  );
  assert.equal(
    (await saveDocument("app-good", "cover", { sourceText: "{}" })).status,
    400,
    "a malformed strict cover-letter source is rejected"
  );
  assert.equal(
    (await saveDocument("app-not-tracked", "resume", { sourceText: resumeSource })).status,
    404,
    "a document save cannot create an orphan application directory"
  );
  {
    const oversize = Buffer.concat([Buffer.from("%PDF-", "utf8"), Buffer.alloc(7_000_000, 0x20)]);
    const res = await saveDocument("app-oversize", "resume", { pdfBase64: b64(oversize) });
    assert.notEqual(res.status, 200, "an over-cap upload is not accepted");
    assert.equal(await exists(join(dirOf("app-oversize"), "resume.pdf")), false, "an over-cap upload writes no file");
  }

  // --- Both kinds store and stream identically, one representation at a time ---
  for (const [kind, extension] of [["resume", "resume"], ["cover", "cover"]]) {
    const source = kind === "resume" ? resumeSource : coverSource;
    const sourceSave = await saveDocument("app-123", kind, {
      sourceText: source,
      fileName: `Xinyi_Lin_Acme_${kind}.${extension}`
    });
    assert.equal(sourceSave.status, 200, `a valid ${kind} source save succeeds`);
    assert.equal(sourceSave.json.artifacts.hasPdf, false, `the ${kind} source save stores no duplicate PDF`);
    assert.equal(sourceSave.json.artifacts.hasSource, true, `the ${kind} save reports a stored source file`);
    assert.equal(
      await readFile(join(dirOf("app-123"), `${kind}.${extension}`), "utf8"),
      source,
      `the persisted .${extension} source matches the upload`
    );

    const sourceRes = await readDocument("app-123", kind, extension);
    assert.equal(sourceRes.status, 200, `the stored .${extension} streams back`);
    assert.equal(sourceRes.buffer.toString("utf8"), source, `the streamed .${extension} round-trips`);

    const pdfSave = await saveDocument("app-123", kind, {
      pdfBase64: b64(pdfBytes),
      fileName: `Xinyi_Lin_Acme_${kind}.pdf`
    });
    assert.equal(pdfSave.status, 200, `an uploaded ${kind} PDF replaces the source`);
    assert.equal(pdfSave.json.artifacts.hasPdf, true, `the ${kind} save reports a stored PDF`);
    assert.equal(pdfSave.json.artifacts.hasSource, false, `a PDF-only save removes the prior source`);
    assert.equal((await readDocument("app-123", kind, extension)).status, 404, "the superseded source is gone");

    const pdfRes = await readDocument("app-123", kind, "pdf");
    assert.equal(pdfRes.status, 200, `the stored ${kind} PDF streams back`);
    assert.equal(pdfRes.headers["Content-Type"], "application/pdf", `the ${kind} PDF is served as application/pdf`);
    assert.equal(pdfRes.headers["X-Content-Type-Options"], "nosniff", `the ${kind} PDF is served with nosniff`);
    assert.match(pdfRes.headers["Content-Disposition"], /^attachment;/, `the ${kind} PDF is served as a download`);
    assert.ok(pdfRes.buffer.equals(pdfBytes), `the streamed ${kind} PDF round-trips`);

    // A kind may only serve its OWN source format.
    const wrongFormat = kind === "resume" ? "cover" : "resume";
    assert.equal(
      (await readDocument("app-123", kind, wrongFormat)).status,
      404,
      `${kind} refuses the other kind's source format`
    );
    assert.equal((await readDocument("app-123", kind, "exe")).status, 404, "an unknown format is refused");

    const restoredSource = await saveDocument("app-123", kind, {
      sourceText: source,
      fileName: `Xinyi_Lin_Acme_${kind}.${extension}`
    });
    assert.equal(restoredSource.status, 200, "saving editable source again removes the uploaded PDF");
    assert.equal((await readDocument("app-123", kind, "pdf")).status, 404, "source-only storage leaves no PDF");
  }
  const storedApplication = (await readApplications(workspaceDir)).find(
    (application) => application.id === "app-123"
  );
  assert.equal(
    Object.hasOwn(storedApplication, "resumeData") ||
      Object.hasOwn(storedApplication, "polishedText") ||
      Object.hasOwn(storedApplication, "coverLetterText"),
    false,
    "strict document files remain the sole application document model"
  );

  assert.equal(
    (await saveDocument("app-good", "resume", {
      pdfBase64: b64(pdfBytes),
      sourceText: resumeSource
    })).status,
    400,
    "the route refuses duplicate source and PDF storage for one document"
  );

  async function assertTrackerUnchanged(id, before) {
    const after = (await readApplications(workspaceDir)).find(
      (application) => application.id === id
    );
    assert.deepEqual(after, before, `${id} tracker metadata and revision remain unchanged`);
  }

  // The production transaction receives only its metadata writer as a narrow
  // test seam. Throwing there proves rollback happens after real file mutation,
  // without copying the rollback algorithm into this probe.
  {
    const id = "app-rollback-source-to-pdf";
    await saveDocument(id, "resume", {
      sourceText: resumeSource,
      fileName: "previous.resume"
    });
    const before = (await readApplications(workspaceDir)).find(
      (application) => application.id === id
    );
    const previousSource = await readFile(join(dirOf(id), "resume.resume"));
    await assert.rejects(
      persistApplicationDocument(
        {
          workspaceDir,
          id,
          kind: "resume",
          baseUpdatedAt: before.updatedAt,
          fileName: "replacement.pdf",
          sourceOrigin: "upload",
          sourceText: "",
          sourceBuffer: null,
          pdfBuffer: pdfBytes,
          remove: false
        },
        {
          writeApplications: async () => {
            assert.equal(
              await exists(join(dirOf(id), "resume.resume")),
              false,
              "source-to-PDF mutation removed the previous source before metadata commit"
            );
            assert.ok(
              (await readFile(join(dirOf(id), "resume.pdf"))).equals(pdfBytes),
              "source-to-PDF mutation wrote the replacement PDF before metadata commit"
            );
            throw new Error("injected tracker write failure");
          }
        }
      ),
      /injected tracker write failure/
    );
    assert.ok(
      (await readFile(join(dirOf(id), "resume.resume"))).equals(previousSource),
      "source-to-PDF rollback restores the previous source bytes exactly"
    );
    assert.equal(
      await exists(join(dirOf(id), "resume.pdf")),
      false,
      "source-to-PDF rollback removes the uncommitted PDF"
    );
    await assertTrackerUnchanged(id, before);
  }

  {
    const id = "app-rollback-pdf-to-source";
    await saveDocument(id, "resume", {
      pdfBase64: b64(pdfBytes),
      fileName: "previous.pdf"
    });
    const before = (await readApplications(workspaceDir)).find(
      (application) => application.id === id
    );
    const previousPdf = await readFile(join(dirOf(id), "resume.pdf"));
    await assert.rejects(
      persistApplicationDocument(
        {
          workspaceDir,
          id,
          kind: "resume",
          baseUpdatedAt: before.updatedAt,
          fileName: "replacement.resume",
          sourceOrigin: "editor",
          sourceText: resumeSource,
          sourceBuffer: Buffer.from(resumeSource, "utf8"),
          pdfBuffer: null,
          remove: false
        },
        {
          writeApplications: async () => {
            assert.equal(
              await exists(join(dirOf(id), "resume.pdf")),
              false,
              "PDF-to-source mutation removed the previous PDF before metadata commit"
            );
            assert.equal(
              await readFile(join(dirOf(id), "resume.resume"), "utf8"),
              resumeSource,
              "PDF-to-source mutation wrote the replacement source before metadata commit"
            );
            throw new Error("injected tracker write failure");
          }
        }
      ),
      /injected tracker write failure/
    );
    assert.ok(
      (await readFile(join(dirOf(id), "resume.pdf"))).equals(previousPdf),
      "PDF-to-source rollback restores the previous PDF bytes exactly"
    );
    assert.equal(
      await exists(join(dirOf(id), "resume.resume")),
      false,
      "PDF-to-source rollback removes the uncommitted source"
    );
    await assertTrackerUnchanged(id, before);
  }

  {
    const id = "app-rollback-delete";
    await saveDocument(id, "cover", {
      sourceText: coverSource,
      fileName: "previous.cover"
    });
    const before = (await readApplications(workspaceDir)).find(
      (application) => application.id === id
    );
    const previousSource = await readFile(join(dirOf(id), "cover.cover"));
    await assert.rejects(
      persistApplicationDocument(
        {
          workspaceDir,
          id,
          kind: "cover",
          baseUpdatedAt: before.updatedAt,
          fileName: "",
          sourceOrigin: "editor",
          sourceText: "",
          sourceBuffer: null,
          pdfBuffer: null,
          remove: true
        },
        {
          writeApplications: async () => {
            assert.equal(
              await exists(join(dirOf(id), "cover.cover")),
              false,
              "deletion removed the source before metadata commit"
            );
            throw new Error("injected tracker write failure");
          }
        }
      ),
      /injected tracker write failure/
    );
    assert.ok(
      (await readFile(join(dirOf(id), "cover.cover"))).equals(previousSource),
      "deletion rollback restores the previous source bytes exactly"
    );
    await assertTrackerUnchanged(id, before);
  }

  // A source-only save keeps the editable file and replaces an earlier PDF so
  // the tracker and disk never retain two representations of one document.
  {
    const res = await saveDocument("app-source-only", "cover", { sourceText: coverSource, fileName: "letter.cover" });
    assert.equal(res.status, 200, "a source-only save succeeds");
    assert.equal(res.json.artifacts.hasPdf, false, "a source-only save reports no PDF");
    assert.equal(res.json.artifacts.hasSource, true, "a source-only save reports the stored source");

    await saveDocument("app-pair", "resume", { pdfBase64: b64(pdfBytes) });
    assert.equal(await exists(join(dirOf("app-pair"), "resume.pdf")), true, "the first save stored a PDF");
    const second = await saveDocument("app-pair", "resume", { sourceText: resumeSource });
    assert.equal(second.json.artifacts.hasPdf, false, "a later source-only save reports no PDF");
    assert.equal(
      await exists(join(dirOf("app-pair"), "resume.pdf")),
      false,
      "the superseded PDF does not survive a source-only save"
    );
  }

  // Removing a document clears whichever representation currently owns its
  // slot. The operation is idempotent so a retry cannot strand bytes.
  {
    await saveDocument("app-remove", "cover", { pdfBase64: b64(pdfBytes), fileName: "letter.pdf" });
    const removedPdf = await saveDocument("app-remove", "cover", {}, "DELETE");
    assert.equal(removedPdf.status, 200, "uploaded PDF removal succeeds");
    assert.equal(await exists(join(dirOf("app-remove"), "cover.pdf")), false, "document removal deletes the PDF");

    await saveDocument("app-remove", "cover", { sourceText: coverSource, fileName: "letter.cover" });
    const removedSource = await saveDocument("app-remove", "cover", {}, "DELETE");
    assert.equal(removedSource.status, 200, "editable source removal succeeds");
    assert.equal(await exists(join(dirOf("app-remove"), "cover.cover")), false, "document removal deletes the source");
    assert.equal((await saveDocument("app-remove", "cover", {}, "DELETE")).status, 200, "document removal is idempotent");
  }

  assert.equal((await readDocument("app-absent", "resume", "pdf")).status, 404, "a missing document is a clean 404");
  await mkdir(join(dirOf("app-good"), "attachments"), { recursive: true });
  await writeFile(join(dirOf("app-good"), "resume.pdf"), pdfBytes);
  await writeFile(join(dirOf("app-good"), "attachments", "orphan.pdf"), pdfBytes);
  assert.equal(
    (await readDocument("app-good", "resume", "pdf")).status,
    404,
    "untracked document bytes cannot be downloaded"
  );
  assert.equal(
    (await attachmentFile("app-good", "orphan.pdf")).status,
    404,
    "untracked attachment bytes cannot be downloaded"
  );
  await rm(dirOf("app-good"), { recursive: true, force: true });

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
  // An unsupported (or nameless) extension is refused outright.
  for (const badName of ["notes.exe", "image.png", "letter.cover", "shell.sh", "archive.zip", "..", "", ".pdf", "   .pdf"]) {
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
    assert.equal(
      (await attachmentFile("app-123", `folder/${stored.fileName}`)).status,
      404,
      "a path-bearing alias cannot address a canonical stored name"
    );
    assert.equal(
      (await attachmentFile("app-123", stored.fileName.toUpperCase())).status,
      404,
      "a non-canonical case alias cannot address a stored name"
    );
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

  // The per-application cap is enforced from authoritative tracker metadata,
  // not from the client or a possibly incomplete directory listing.
  {
    for (let i = 0; i < MAX_ATTACHMENTS_PER_APPLICATION; i += 1) {
      await uploadAttachment("app-cap", { fileName: `file-${i}.pdf`, dataBase64: b64(pdfBytes) });
    }
    const res = await uploadAttachment("app-cap", { fileName: "one-too-many.pdf", dataBase64: b64(pdfBytes) });
    assert.equal(res.status, 409, "the attachment cap is enforced");
    assert.match(res.json.error, /Remove one first/);
    assert.equal(
      (await readdir(join(dirOf("app-cap"), "attachments"))).length,
      MAX_ATTACHMENTS_PER_APPLICATION,
      "the refused upload wrote no file"
    );

    // A missing tracked file must not look like a free slot. If the route
    // counted disk entries, this upload would be written as attachment 11 and
    // then dropped by the tracker sanitizer, leaving unreachable bytes behind.
    await rm(join(dirOf("app-cap"), "attachments", "file-0.pdf"));
    const missingTrackedFile = await uploadAttachment("app-cap", {
      fileName: "missing-slot.pdf",
      dataBase64: b64(pdfBytes)
    });
    assert.equal(missingTrackedFile.status, 409, "a missing tracked file does not bypass the attachment cap");
    assert.equal(
      await exists(join(dirOf("app-cap"), "attachments", "missing-slot.pdf")),
      false,
      "a cap rejection with incomplete disk state writes no orphan file"
    );
  }

  // Delete removes the file and stays a 200 when it is already gone.
  {
    const del = await attachmentFile("app-cap", "file-0.pdf", "DELETE");
    assert.equal(del.status, 200, "deleting an attachment succeeds");
    assert.equal(
      await exists(join(dirOf("app-cap"), "attachments", "file-0.pdf")),
      false,
      "the deleted attachment is gone from disk"
    );
    assert.equal((await attachmentFile("app-cap", "file-0.pdf", "DELETE")).status, 200, "deleting twice is idempotent");
  }

  // The browser deletes through the sparse tracker mutation endpoint. That path
  // must move the whole application directory too, not only remove metadata.
  {
    await saveDocument("app-delete", "resume", { sourceText: resumeSource });
    await uploadAttachment("app-delete", {
      fileName: "supporting.pdf",
      dataBase64: b64(pdfBytes)
    });
    const current = await readApplications(workspaceDir);
    const deleted = current.find((application) => application.id === "app-delete");
    const res = new FakeResponse();
    await handleSaveApplications(
      jsonRequest("PUT", {
        applications: [],
        mutations: [{
          id: "app-delete",
          operation: "delete",
          baseUpdatedAt: deleted.updatedAt
        }]
      }),
      res,
      workspaceDir
    );
    assert.equal(res.status, 200, "the ordinary tracker delete succeeds");
    assert.equal(await exists(dirOf("app-delete")), false, "tracker delete removes the live application directory");
    assert.ok(
      (await readdir(join(workspaceDir, "applications", ".trash"))).some((name) => name.startsWith("app-delete-")),
      "tracker delete keeps the application's personal files in recoverable trash"
    );
  }

  assert.deepEqual(
    (await readdir(join(workspaceDir, "applications"))).sort(),
    [
      ".trash",
      "app-123",
      "app-cap",
      "app-pair",
      "app-rollback-delete",
      "app-rollback-pdf-to-source",
      "app-rollback-source-to-pdf",
      "app-source-only",
      "app-traversal"
    ],
    "only valid live saves and recoverable trash persisted application directories"
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
