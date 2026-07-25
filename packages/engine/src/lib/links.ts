const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const DOMAIN_RE = /^(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#][^\s]*)?$/i;
// Suffixes that read as a FILENAME rather than a domain. "resume.pdf" and
// "README.md" match the shape of a bare domain, so without this they auto-link to
// https://resume.pdf — and a resume mentions files constantly.
//
// This is deliberately a denylist of file extensions, not an allowlist of TLDs: a
// real public-suffix list is far too large to bundle, and denying an extension can
// only ever cost a link the user can still add explicitly, while allowing one
// silently ships a broken destination. Suffixes that are also TLDs people
// genuinely type bare are left OUT (io, co, dev, app, page, sh is kept because a
// shell script is far more likely than a Saint Helena domain in this context).
const FILE_LIKE_SUFFIXES = new Set([
  // source
  "c", "cpp", "cs", "go", "java", "js", "jsx", "php", "py", "rb", "rs", "sh", "sql", "ts", "tsx",
  // documents
  "pdf", "doc", "docx", "txt", "rtf", "odt", "md", "csv", "tsv",
  "xls", "xlsx", "ppt", "pptx", "pages", "key", "numbers",
  // markup and config
  "html", "htm", "css", "json", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "lock", "log",
  // media
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "tiff",
  "mp3", "mp4", "mov", "wav", "avi", "webm",
  // archives and binaries
  "zip", "rar", "tar", "gz", "bz2", "7z", "exe", "dmg", "pkg", "deb", "rpm", "iso", "bak", "tmp"
]);

export function normalizeLinkDestination(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Explicit mailto: first — EMAIL_RE also matches "mailto:x@y.com" whole, so
  // testing it first would double-prefix the scheme.
  if (/^mailto:/i.test(trimmed)) return EMAIL_RE.test(trimmed.slice(7)) ? trimmed : null;
  if (EMAIL_RE.test(trimmed)) return `mailto:${trimmed}`;
  if (DOMAIN_RE.test(trimmed)) {
    const hostname = trimmed.split(/[/:?#]/, 1)[0].toLowerCase();
    const suffix = hostname.slice(hostname.lastIndexOf(".") + 1);
    // The suffix comes from the HOSTNAME, so a path ending in a filename
    // ("example.com/resume.pdf") is unaffected — only a bare filename is rejected.
    if (FILE_LIKE_SUFFIXES.has(suffix)) return null;
    return `https://${trimmed}`;
  }
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function automaticLinkHref(value: string): string | null {
  const candidate = value.trim().replace(/^[([{<]+/, "").replace(/[\])}>.,;:!?]+$/, "");
  return normalizeLinkDestination(candidate);
}

export function encodeLinkHref(href: string): string {
  return encodeURIComponent(href);
}

export function decodeLinkHref(value: string): string | null {
  try {
    return normalizeLinkDestination(decodeURIComponent(value));
  } catch {
    return null;
  }
}
