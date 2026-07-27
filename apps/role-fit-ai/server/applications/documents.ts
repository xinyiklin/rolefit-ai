// Files an application keeps on disk, under
// <workspace>/applications/<id>/ (gitignored):
//
//   resume.pdf / resume.resume   the resume that went out, plus its editable source
//   cover.pdf  / cover.cover     the same pair for the cover letter
//   attachments/<name>           anything else the posting asked for
//
// Both document kinds are stored identically, so neither page is the one with
// the better file support. The record in applications.json only remembers WHAT
// exists (see sanitizeDocumentArtifacts / sanitizeAttachments); the bytes live
// here.
//
// Everything a browser can request back is served as an attachment download
// with a narrow content type and `nosniff`: these are user-supplied bytes on
// the same loopback origin as the app, so they must never be renderable as a
// document in that origin.

import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export type ApplicationDocumentKind = "resume" | "cover";

/** The editable source format each document kind owns. */
export const DOCUMENT_SOURCE_EXTENSION: Record<ApplicationDocumentKind, string> = {
  resume: "resume",
  cover: "cover"
};

export const APPLICATION_DOCUMENT_KINDS: readonly ApplicationDocumentKind[] = ["resume", "cover"];

export function isApplicationDocumentKind(value: string): value is ApplicationDocumentKind {
  return APPLICATION_DOCUMENT_KINDS.includes(value as ApplicationDocumentKind);
}

// 8 MB decoded per file, 10 attachments per application. The transport cap in
// the route sits above the base64 envelope of this (4/3 inflation + JSON).
export const MAX_DOCUMENT_BYTES = 8_000_000;
export const MAX_ATTACHMENTS_PER_APPLICATION = 10;

// Extension allowlist for user attachments. Anything not listed is refused
// rather than stored under a name the app cannot describe or serve safely.
const ATTACHMENT_TYPES: Record<string, { contentType: string; magic?: readonly string[] }> = {
  pdf: { contentType: "application/pdf", magic: ["%PDF-"] },
  docx: { contentType: "application/octet-stream", magic: ["PK\u0003\u0004"] },
  png: { contentType: "image/png", magic: ["\u0089PNG"] },
  jpg: { contentType: "image/jpeg", magic: ["\u00ff\u00d8\u00ff"] },
  jpeg: { contentType: "image/jpeg", magic: ["\u00ff\u00d8\u00ff"] },
  txt: { contentType: "text/plain; charset=utf-8" },
  md: { contentType: "text/plain; charset=utf-8" },
  csv: { contentType: "text/plain; charset=utf-8" },
  resume: { contentType: "application/octet-stream" },
  cover: { contentType: "application/octet-stream" }
};

export const ATTACHMENT_EXTENSIONS = Object.keys(ATTACHMENT_TYPES);

export class ApplicationDocumentError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApplicationDocumentError";
    this.status = status;
  }
}

// Resolve <workspace>/applications/<id>[/attachments], refusing anything that
// escapes the applications directory. `id` is already format-checked by the
// caller; this is the defense-in-depth boundary for the joined path.
export function applicationFilesDir(
  workspaceDir: string,
  id: string,
  scope: "root" | "attachments" = "root"
): string | null {
  const base = resolve(workspaceDir, "applications");
  const dir = scope === "attachments" ? join(base, id, "attachments") : join(base, id);
  const resolved = resolve(dir);
  if (!resolved.startsWith(base + sep) && resolved !== base) return null;
  return resolved;
}

// A file name safe to store and to hand back in Content-Disposition: no path
// separators, no leading dots, no control characters, one allowlisted
// extension, and a bounded length.
export function safeAttachmentFileName(raw: string): { fileName: string; extension: string } | null {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const match = base.match(/\.([A-Za-z0-9]+)$/);
  const extension = (match?.[1] ?? "").toLowerCase();
  if (!Object.hasOwn(ATTACHMENT_TYPES, extension)) return null;
  // The length cap comes BEFORE the final trim: cutting an 80-character stem can
  // land on a dot or a space, and leaving that in made the function
  // non-idempotent — the upload route and the record sanitizer would then derive
  // two different names for one file, orphaning the bytes on disk.
  // Lowercased, like the extension: macOS and Windows — both shipped desktop
  // targets — treat names differing only in case as ONE file, so storing
  // "Transcript.pdf" and "transcript.pdf" separately would leave two records
  // pointing at the same bytes. The user's original name survives as the
  // attachment's display label.
  const stem = base
    .slice(0, base.length - extension.length - 1)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "_")
    .toLowerCase()
    .slice(0, 80)
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (!stem) return null;
  return { fileName: `${stem}.${extension}`, extension };
}

export function attachmentContentType(fileName: string): string {
  const extension = (fileName.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase();
  return ATTACHMENT_TYPES[extension]?.contentType ?? "application/octet-stream";
}

// Reject a file whose bytes contradict its extension. Only formats with a
// stable signature are checked; text formats pass through unverified because
// they have none (they are still served as a download, never as markup).
export function assertAttachmentBytes(extension: string, bytes: Buffer): void {
  const magic = ATTACHMENT_TYPES[extension]?.magic;
  if (!magic) return;
  const head = bytes.subarray(0, 8).toString("latin1");
  if (!magic.some((signature) => head.startsWith(signature))) {
    throw new ApplicationDocumentError(`That file is not a valid .${extension} file.`, 400);
  }
}

// Write bytes atomically: a crash mid-write must not leave a truncated file
// where a previously good document used to be.
export async function writeApplicationFile(dir: string, fileName: string, data: Buffer): Promise<void> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, fileName);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, data, { mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

// Content-Disposition value for a download. The quoted name is ASCII-folded and
// the RFC 5987 form carries the exact name, so a non-ASCII title still arrives
// intact without breaking the header.
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
