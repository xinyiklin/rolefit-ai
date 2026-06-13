import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function base64ToBuffer(value) {
  const base64 = String(value ?? "").replace(/^data:[^,]+,/, "");
  if (!base64 || !/^[a-z0-9+/=\s]+$/i.test(base64)) {
    throw new Error("DOCX data was not valid base64.");
  }
  const buffer = Buffer.from(base64, "base64");
  // Bound the decoded DOCX (real resumes are well under 1 MB) so a crafted body
  // can't exhaust memory/temp disk via import, base-resume save, or export.
  if (buffer.length > 10_000_000) {
    throw new Error("DOCX file is too large.");
  }
  return buffer;
}

export function bufferToBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function decodeXmlText(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function paragraphText(paragraphXml) {
  return Array.from(paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((match) => decodeXmlText(match[1]))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDocumentText(documentXml) {
  const lines = Array.from(documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
    .map((match) => {
      const text = paragraphText(match[0]);
      if (!text) return "";
      const isListItem = /<w:numPr\b[\s\S]*?<\/w:numPr>/.test(match[0]);
      return isListItem ? `- ${text}` : text;
    })
    .filter(Boolean);

  return lines.join("\n");
}

// Rejects archive entry names that are absolute or contain a `..` traversal
// segment, so a malicious .docx can't escape the unpack directory (zip-slip).
export function assertSafeZipEntries(listing) {
  const entries = listing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
      throw new Error("Archive contains an absolute path entry.");
    }
    if (normalized.split("/").some((segment) => segment === "..")) {
      throw new Error("Archive contains a path traversal entry.");
    }
  }
}

// Walk the unpacked tree and reject any symlink. The entry-name check
// (assertSafeZipEntries) can't see this: a zip entry can carry an innocuous
// name like `word/link` while its content is a symlink target pointing outside
// the unpack dir, which `unzip -Z1` does not reveal. readdir(withFileTypes) uses
// lstat semantics, so it flags links without following them.
async function assertNoSymlinks(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error("Archive contains a symbolic link entry.");
    }
    if (entry.isDirectory()) {
      await assertNoSymlinks(join(dir, entry.name));
    }
  }
}

export async function withUnpackedDocx(docxBase64, callback) {
  const workspace = await mkdtemp(join(tmpdir(), "resume-polisher-docx-"));
  const sourcePath = join(workspace, "source.docx");
  const unpackedPath = join(workspace, "docx");

  try {
    await writeFile(sourcePath, base64ToBuffer(docxBase64));
    const { stdout: listing } = await execFileAsync("unzip", ["-Z1", sourcePath]);
    assertSafeZipEntries(listing);
    // Reject a decompression bomb by its reported uncompressed total BEFORE
    // extracting to disk. `unzip -l`'s final summary line starts with the total
    // uncompressed byte count; if it is unparseable, treat the archive as hostile.
    const { stdout: sizeListing } = await execFileAsync("unzip", ["-l", sourcePath]);
    const summaryLine = sizeListing.trim().split("\n").pop() ?? "";
    const totalUncompressed = Number.parseInt(summaryLine.trim().split(/\s+/)[0], 10);
    if (!Number.isFinite(totalUncompressed) || totalUncompressed > 50_000_000) {
      throw new Error("Archive expands beyond the allowed size.");
    }
    await execFileAsync("unzip", ["-qq", sourcePath, "-d", unpackedPath]);
    // Reject symlinks before any read/repack so a crafted archive can't read or
    // write outside the temp workspace by following a planted link.
    await assertNoSymlinks(unpackedPath);
    return await callback({ workspace, unpackedPath });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function extractDocxResume(docxBase64) {
  return withUnpackedDocx(docxBase64, async ({ unpackedPath }) => {
    const documentXml = await readFile(join(unpackedPath, "word", "document.xml"), "utf8");
    const text = extractDocumentText(documentXml);
    if (text.trim().length < 80) {
      throw new Error("DOCX did not expose enough readable resume text.");
    }
    return {
      text: text.slice(0, 45_000),
      paragraphs: text.split(/\r?\n/).filter(Boolean).length
    };
  });
}

export { execFileAsync };
