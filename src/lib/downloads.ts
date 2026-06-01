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
  URL.revokeObjectURL(url);
}

// Pull the applicant's name from a resume so downloads can be named after the
// person. Scans the document body, strips LaTeX, and takes the first
// "First Last" sequence. Returns "" when nothing confident is found.
export function extractApplicantName(text: string): string {
  const docStart = text.indexOf("\\begin{document}");
  const body = docStart >= 0 ? text.slice(docStart) : text;
  // Scan line by line (the name sits on its own line at the top) and take the
  // first 2-3 word "First Last" from the start of a line. Matching per-line
  // avoids gluing the name to a following title like "Software Engineer".
  const lines = body
    .replace(/%.*$/gm, " ")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, " ")
        .replace(/[{}\\$~^]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
  for (const line of lines.slice(0, 12)) {
    const match = line.match(/^([A-Z][a-z]+(?:\s+[A-Z][A-Za-z'’.-]+){1,2})\b/);
    if (match && !/[\d@]/.test(match[1])) return match[1];
  }
  return "";
}

// Filesystem-safe slug: keep letters/digits, collapse the rest to underscores.
export function slugForFile(value: string): string {
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
