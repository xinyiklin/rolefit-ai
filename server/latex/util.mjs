// Helpers shared across LaTeX template renderers.

// Section-heading classifier shared by the templates and the text parser:
// summary-like sections hold plain paragraphs, not skill rows or entries.
// Skills wins over summary so "Skills Summary" keeps its label-colon rows
// (mirrors inferSectionType in src/lib/resumeData.ts).
const SKILLS_HEADING_RE = /\b(?:technical\s+skills|skills|core\s+skills)\b/i;
const SUMMARY_HEADING_RE = /\b(?:summary|objective|profile|about\s+me|highlights)\b/i;

export function isSummaryHeading(heading) {
  const trimmed = String(heading ?? "").trim();
  return SUMMARY_HEADING_RE.test(trimmed) && !SKILLS_HEADING_RE.test(trimmed);
}

// Templates classify sections by the editor's explicit type when the schema
// carries one (a renamed summary still renders as paragraphs); heading text is
// only a fallback for text-parsed schemas that never had a type.
export function isSummarySection(section) {
  const type = section?.type;
  if (type === "summary") return true;
  if (type === "skills" || type === "standard") return false;
  return isSummaryHeading(section?.heading);
}

const LATEX_ESCAPES = [
  // Backslash first, and brace-free: a `{}`-bearing replacement here would be
  // re-escaped by the `{`/`}` rules below into `\textbackslash\{\}` (renders a
  // literal "\{}"). `\textbackslash ` (trailing space terminates the control
  // word) carries no braces, so the brace rules leave it intact.
  [/\\/g, "\\textbackslash "],
  [/&/g, "\\&"],
  [/%/g, "\\%"],
  [/\$/g, "\\$"],
  [/#/g, "\\#"],
  [/_/g, "\\_"],
  [/\{/g, "\\{"],
  [/\}/g, "\\}"],
  [/~/g, "\\textasciitilde{}"],
  [/\^/g, "\\textasciicircum{}"]
];

function inlineMarkupToTex(value) {
  let out = String(value ?? "");

  for (let i = 0; i < 6; i += 1) {
    const next = out
      .replace(/<u>([\s\S]*?)<\/u>/gi, "\\underline{$1}")
      .replace(/<i>([\s\S]*?)<\/i>/gi, "\\textit{$1}")
      .replace(/<b>([\s\S]*?)<\/b>/gi, "\\textbf{$1}");
    if (next === out) break;
    out = next;
  }

  return out.replace(/<\/?(?:b|i|u)>/gi, "");
}

// Unicode chars that lmodern + T1 can't render natively under XeTeX/Tectonic.
// Replace BEFORE TeX escaping so the output is pure ASCII or standard TeX.
const UNICODE_NORMALIZATIONS = [
  [/—/g, "---"],    // em dash
  [/–/g, "--"],     // en dash
  [/‘/g, "`"],      // left single quote
  [/’/g, "'"],      // right single quote / apostrophe
  [/“/g, "``"],     // left double quote
  [/”/g, "''"],     // right double quote
  [/…/g, "..."],    // ellipsis
  [/•/g, ""],       // bullet (stripped — only appears in raw list prefixes)
  [/ /g, "~"],      // non-breaking space
  [/​/g, ""],       // zero-width space
];

export function escapeTex(value) {
  let out = String(value ?? "");
  for (const [pattern, replacement] of UNICODE_NORMALIZATIONS) {
    out = out.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of LATEX_ESCAPES) {
    out = out.replace(pattern, replacement);
  }
  // Inline formatting from the structured editor becomes real LaTeX emphasis.
  // Runs AFTER escaping, so wrapped text is already safe for TeX. Rich-editor
  // edits use <b>/<i>/<u> internally.
  return inlineMarkupToTex(out);
}

// Escapes for the FIRST argument of \href{...}. Neutralizes the characters that
// let a crafted URL break out of the brace group and inject arbitrary LaTeX
// (e.g. "...}{}\input{/etc/passwd}%"). Unlike escapeTex we do NOT escape "_",
// "/", ":" etc., which are legal, common URL characters and are safe inside the
// \href target. Backslash first and brace-free (see escapeTex note) so the
// `{`/`}` rules below don't turn it into `\textbackslash\{\}`.
const LATEX_URL_ESCAPES = [
  [/\\/g, "\\textbackslash "],
  [/\{/g, "\\{"],
  [/\}/g, "\\}"],
  [/%/g, "\\%"],
  [/#/g, "\\#"],
  [/\$/g, "\\$"],
  [/&/g, "\\&"],
  [/~/g, "\\textasciitilde{}"],
  [/\^/g, "\\textasciicircum{}"]
];

export function escapeTexUrl(value) {
  // Drop ASCII control chars, space, and DEL — never valid in a contact URL and
  // a vector for hiding injected payloads.
  let out = String(value ?? "").replace(/[\x00-\x20\x7f]/g, "");
  for (const [pattern, replacement] of LATEX_URL_ESCAPES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// Title-case for section headings ("EDUCATION" -> "Education")
export function titleCase(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// Pull the URL out of "github.com/foo" or "https://github.com/foo" patterns so
// we can wrap contact items / project links in \href{}.
const LINK_HOSTS = ["github.com", "linkedin.com", "gitlab.com", "twitter.com", "x.com", "behance.net", "dribbble.com"];

// Generic bare-domain detector: a label (subdomains allowed) followed by a 2-24
// letter TLD, with an optional path. Matches "xinyiklin.com",
// "careflow.xinyiklin.com", "github.com/user/repo". Does NOT match "Jan. 2024"
// (digits in TLD), "John D." (no TLD), or anything with whitespace.
const BARE_DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}(?:\/[^\s]*)?$/i;

// Hosts whose link we point at the www subdomain in the CLICKABLE href only —
// the visible label is left exactly as typed, so the resume still shows the
// clean "github.com/user". Apex only: an already-www host or any other
// subdomain (gist.github.com, uk.linkedin.com) is left untouched.
const WWW_HREF_HOSTS = ["github.com", "linkedin.com"];

// Prepend www. to the host of a protocol-bearing URL for WWW_HREF_HOSTS; a no-op
// for every other (or already-www) host. Only the authority before the first
// "/" is matched, so the path is never altered.
function ensureWwwHref(url) {
  // Capture only the authority — stop at the first "/", "?", or "#" so a
  // path-less URL with a query ("github.com?x=1") doesn't fold the query into
  // the host and miss the exact-host match.
  return url.replace(/^(https?:\/\/)([^/?#]+)/i, (full, scheme, host) =>
    WWW_HREF_HOSTS.includes(host.toLowerCase()) ? `${scheme}www.${host}` : full
  );
}

export function linkify(contactItem) {
  const raw = String(contactItem ?? "").trim();
  if (!raw) return null;

  // Defense in depth: a legitimate contact URL never contains whitespace,
  // control chars, or LaTeX brace/backslash characters. Bail out so the item
  // falls back to plain escaped text. The authoritative injection fix is the
  // escapeTexUrl() applied at the \href{...} interpolation in each template.
  if (/[\s\\{}]/.test(raw)) return null;

  if (/^https?:\/\//i.test(raw)) {
    return { url: ensureWwwHref(raw), label: raw.replace(/^https?:\/\//i, "") };
  }
  if (/^mailto:/i.test(raw)) {
    return { url: raw, label: raw.replace(/^mailto:/i, "") };
  }
  for (const host of LINK_HOSTS) {
    if (raw.toLowerCase().includes(host)) {
      const url = ensureWwwHref(raw.startsWith("http") ? raw : `https://${raw}`);
      return { url, label: raw };
    }
  }
  // Email
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return { url: `mailto:${raw}`, label: raw };
  }
  // Generic bare domain: personal sites, project URLs, etc.
  if (BARE_DOMAIN_RE.test(raw)) {
    return { url: `https://${raw}`, label: raw };
  }
  return null;
}

// Split a meta/link field on whitespace-padded delimiters (" / ", " | ", " , ",
// " ; ") so a "site-a.com / site-b.com" field can linkify BOTH halves instead of
// failing linkify() outright on the embedded whitespace. Returns ordered
// segments — { link } for a linkifiable token, { text } for delimiters and any
// non-link tokens — which templates render with their own \href markup. The
// surrounding whitespace is required so genuine URL paths ("github.com/u/repo")
// and bare dates are never split. A field with no such delimiter yields a single
// segment, so existing single-link / plain-text behavior is unchanged.
export function splitLinkSegments(text) {
  const raw = String(text ?? "");
  const parts = raw.split(/(\s+[/|,;]\s+)/);
  return parts.map((part, index) => {
    if (index % 2 === 1) return { text: part };
    const link = linkify(part.trim());
    return link ? { link } : { text: part };
  });
}
