// downloadBlob lives in the shared engine (@typeset/engine/lib/download.ts) —
// import it from there. This file keeps only the RoleFit-specific naming and
// text-scanning helpers below.

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

export function resolveResumeApplicantName(structuredName: string | null | undefined, resumeText: string): string {
  return (structuredName ?? "").replace(/<\/?[a-z]+>/gi, "").trim() || extractApplicantName(resumeText);
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

// Both editors name a document the same way, so a resume and its letter for the
// same role read as one application: Name_Company_<kind>, degrading to
// Name_<kind>, Company_<kind>, then the bare kind. The editable header and every
// download format share this base, so the title never disagrees with the file.
const DOCUMENT_TITLE_SUFFIX = { resume: "Resume", coverLetter: "Cover_Letter" } as const;

export type DocumentTitleKind = keyof typeof DOCUMENT_TITLE_SUFFIX;

export function buildDocumentTitle(kind: DocumentTitleKind, name: string, company: string): string {
  const parts = [slugForFile(name), slugForFile(company)].filter(Boolean);
  parts.push(DOCUMENT_TITLE_SUFFIX[kind]);
  return parts.join("_");
}

export function buildResumeDocumentTitle(name: string, company: string): string {
  return buildDocumentTitle("resume", name, company);
}

export function buildCoverLetterDocumentTitle(name: string, company: string): string {
  return buildDocumentTitle("coverLetter", name, company);
}

export function buildResumeFileName(name: string, company: string, ext: string): string {
  return `${buildResumeDocumentTitle(name, company)}.${ext}`;
}

// Job intake and document loading are independent async paths, so a title is
// often built from partial identity first (Company_Resume) and completed when
// the applicant name arrives. Rewrite only a title the app itself produced —
// anything the user typed is preserved. `placeholders` are the kind's own
// untouched defaults ("Resume", "Cover letter").
export function completeAutoDocumentTitle(
  kind: DocumentTitleKind,
  currentTitle: string,
  name: string,
  company: string,
  placeholders: readonly string[]
): string {
  const automaticTitles = new Set([
    ...placeholders,
    buildDocumentTitle(kind, "", ""),
    buildDocumentTitle(kind, name, ""),
    buildDocumentTitle(kind, "", company)
  ]);
  return automaticTitles.has(currentTitle) ? buildDocumentTitle(kind, name, company) : currentTitle;
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
