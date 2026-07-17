export function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Defer revoke so Gecko (Firefox) can start reading the blob from the object
  // URL after the click event finishes. Revoking in the same synchronous tick
  // races that fetch and can cancel the download or produce a 0-byte file.
  // Behavior-preserving in Chromium, which queues the download before returning.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Pull the applicant's name from a resume's plain text so downloads can be named
// after the person. Scans the first lines and takes the first "First Last"
// sequence. Returns "" when nothing confident is found. (Callers prefer the
// structured ResumeData.name; this is the fallback for text-only sources.)
export function extractApplicantName(text: string): string {
  // Scan line by line (the name sits on its own line at the top) and take the
  // first 2-3 word "First Last" from the start of a line. Matching per-line
  // avoids gluing the name to a following title like "Software Engineer".
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 12)) {
    const match = line.match(/^([A-Z][a-z]+(?:\s+[A-Z][A-Za-z'’.-]+){1,2})\b/);
    if (match && !/[\d@]/.test(match[1])) return match[1];
  }
  return "";
}

// Filesystem-safe slug: keep letters/digits, collapse the rest to underscores.
// Internal to buildResumeFileName below.
function slugForFile(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

// Download name: Name_Company_Resume.ext, degrading to Name_Resume, then Resume.
export function buildResumeFileName(name: string, company: string, ext: string): string {
  const parts = [slugForFile(name), slugForFile(company)].filter(Boolean);
  parts.push("Resume");
  return `${parts.join("_")}.${ext}`;
}

// Sanitize a user-typed file name into a safe base (extension excluded): the
// rename dialog pre-fills the system name, but the user can edit it freely, so
// we strip path separators and characters illegal on common filesystems, drop
// trailing dots (Windows), collapse whitespace, and cap length. Falls back to
// "Resume" when nothing usable remains. Spaces, hyphens, and underscores are
// intentionally preserved — they are valid, common parts of a file name.
export function sanitizeFileBase(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/g, "")
    .trim()
    .slice(0, 80);
  return cleaned || "Resume";
}
