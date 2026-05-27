// Helpers shared across LaTeX template renderers.

const LATEX_ESCAPES = [
  [/\\/g, "\\textbackslash{}"],
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

export function escapeTex(value) {
  let out = String(value ?? "");
  for (const [pattern, replacement] of LATEX_ESCAPES) {
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

// Markdown-style **bold** -> \textbf{bold} (escaped)
export function richInline(value) {
  const escaped = escapeTex(value);
  return escaped.replace(/\\\*\\\*(.+?)\\\*\\\*/g, "\\textbf{$1}");
}

// Pull the URL out of "github.com/foo" or "https://github.com/foo" patterns so
// we can wrap contact items in \href{}.
const LINK_HOSTS = ["github.com", "linkedin.com", "gitlab.com", "twitter.com", "x.com", "behance.net", "dribbble.com"];

export function linkify(contactItem) {
  const raw = String(contactItem ?? "").trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    return { url: raw, label: raw.replace(/^https?:\/\//i, "") };
  }
  if (/^mailto:/i.test(raw)) {
    return { url: raw, label: raw.replace(/^mailto:/i, "") };
  }
  for (const host of LINK_HOSTS) {
    if (raw.toLowerCase().includes(host)) {
      const url = raw.startsWith("http") ? raw : `https://${raw}`;
      return { url, label: raw };
    }
  }
  // Email
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return { url: `mailto:${raw}`, label: raw };
  }
  return null;
}
