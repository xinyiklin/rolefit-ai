const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const DOMAIN_RE = /^(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#][^\s]*)?$/i;
const CODE_LIKE_SUFFIXES = new Set(["c", "cpp", "cs", "go", "java", "js", "jsx", "php", "py", "rb", "rs", "sh", "sql", "ts", "tsx"]);

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
    if (CODE_LIKE_SUFFIXES.has(suffix)) return null;
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
