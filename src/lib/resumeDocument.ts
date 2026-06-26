import { looksLikeLatex } from "./resumeFormat";

// Fallback print model, used by ResumePrintLayer ONLY when no structured editor
// model exists (resume === null). The Resume tab and the primary print path now use
// the structured editor model (ResumeEditor / ResumeReadonlyDocument, .rdx-* markup).
// The same plain-text heuristics the old hand-rolled PDF used (section headings,
// name/contact, role lines, bullets) still decide this fallback's structure.

export type ResumeBlock =
  | { kind: "bullet"; text: string }
  | { kind: "role"; left: string; right: string }
  | { kind: "para"; text: string };

export type ResumeSection = { heading: string; blocks: ResumeBlock[] };

export type ResumeDocumentModel = {
  name: string;
  contact: string;
  sections: ResumeSection[];
};

// Private markers: latexToPlainText tags structure (section titles, role lines,
// real line breaks) with control chars the parser recognizes, then strips them
// before output — so they never appear in plain-text resumes or rendered HTML.
const SECTION_MARK = "\u0001"; // line is a section heading
const ROLE_MARK = "\u0002"; // line is a role: left<ROLE_SEP>right
const ROLE_SEP = "\u0003"; // separates a role's left / right
const LINE_BREAK = "\u0004"; // a real break (a soft source newline becomes a space)

const DATE_RE = /\b(20\d{2}|present|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;

const KNOWN_HEADINGS = [
  "summary",
  "targeted summary",
  "core skills",
  "skills",
  "technical skills",
  "projects",
  "experience",
  "work experience",
  "education",
  "certifications"
];

function cleanLine(line: string): string {
  return line
    .replace(/[•]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isContactLine(line: string): boolean {
  return /@|https?:\/\/|github\.com|linkedin\.com|\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/i.test(line);
}

function isKnownHeading(line: string): boolean {
  return KNOWN_HEADINGS.includes(cleanLine(line).toLowerCase());
}

function isNameLine(line: string): boolean {
  return (
    /^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ' .-]+$/.test(line) &&
    line.split(/\s+/).length <= 4 &&
    !isKnownHeading(line)
  );
}

// Canonical, title-cased section label. Known synonyms collapse to one
// heading; arbitrary titles are title-cased to match the PDF's \scshape
// small-caps rendering (first letter full cap, rest small caps).
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
function headingLabel(raw: string): string {
  const normalized = cleanLine(raw).toLowerCase();
  if (normalized === "targeted summary") return "Summary";
  if (normalized === "core skills") return "Technical Skills";
  if (normalized === "experience") return "Work Experience";
  return titleCase(cleanLine(raw));
}

// Read a brace-balanced argument starting at s[i] === "{"; returns the inner
// content and the index just past the matching "}", or null if s[i] is not "{".
function readBracedArg(s: string, i: number): { content: string; end: number } | null {
  if (s[i] !== "{") return null;
  let depth = 0;
  let out = "";
  for (let j = i; j < s.length; j += 1) {
    const c = s[j];
    if (c === "{") {
      depth += 1;
      if (depth === 1) continue;
    } else if (c === "}") {
      depth -= 1;
      if (depth === 0) return { content: out, end: j + 1 };
    }
    out += c;
  }
  return null;
}

// Read n brace-balanced args from index i, skipping whitespace between them
// (macro calls and their args routinely span source lines).
function readArgs(s: string, i: number, n: number): { args: string[]; end: number } | null {
  const args: string[] = [];
  let j = i;
  for (let k = 0; k < n; k += 1) {
    while (j < s.length && /\s/.test(s[j])) j += 1;
    const arg = readBracedArg(s, j);
    if (!arg) return null;
    args.push(arg.content);
    j = arg.end;
  }
  return { args, end: j };
}

// Custom resume macros (e.g. Jake's template) hold the real structure, with
// nested braces and args spanning lines — expand them with a brace-aware reader,
// emitting the role lines / bullets the parser maps. Arg contents keep their
// inline LaTeX (\textbf, \href, ...); the general pass below cleans them.
const RESUME_MACROS: { name: string; argc: number; render: (a: string[]) => string }[] = [
  // {title}{date}{subtitle}{location} -> two role lines (title|date, subtitle|location)
  {
    name: "resumeSubheading",
    argc: 4,
    render: (a) =>
      `${LINE_BREAK}${ROLE_MARK}${a[0]}${ROLE_SEP}${a[1]}${LINE_BREAK}${ROLE_MARK}${a[2]}${ROLE_SEP}${a[3]}${LINE_BREAK}`
  },
  // {name}{tech}{url} -> role line (name|url), then a tech line
  {
    name: "resumeProjectHeading",
    argc: 3,
    render: (a) => `${LINE_BREAK}${ROLE_MARK}${a[0]}${ROLE_SEP}${a[2]}${LINE_BREAK}${a[1]}${LINE_BREAK}`
  },
  // {left}{right} -> role line
  {
    name: "resumeSubSubheading",
    argc: 2,
    render: (a) => `${LINE_BREAK}${ROLE_MARK}${a[0]}${ROLE_SEP}${a[1]}${LINE_BREAK}`
  },
  // {text} -> bullet
  {
    name: "resumeItem",
    argc: 1,
    render: (a) => `${LINE_BREAK}- ${a[0]}${LINE_BREAK}`
  }
];

function expandResumeMacros(text: string): string {
  for (const macro of RESUME_MACROS) {
    const token = `\\${macro.name}`;
    let out = "";
    let i = 0;
    while (i < text.length) {
      const idx = text.indexOf(token, i);
      if (idx < 0) {
        out += text.slice(i);
        break;
      }
      // A letter right after the name means a longer macro (e.g. resumeItemListStart).
      const after = text[idx + token.length];
      if (after && /[A-Za-z]/.test(after)) {
        out += text.slice(i, idx + token.length);
        i = idx + token.length;
        continue;
      }
      const read = readArgs(text, idx + token.length, macro.argc);
      if (!read) {
        out += text.slice(i, idx + token.length);
        i = idx + token.length;
        continue;
      }
      out += text.slice(i, idx) + macro.render(read.args);
      i = read.end;
    }
    text = out;
  }
  return text;
}

// Best-effort LaTeX -> clean text so a raw .tex resume still renders readably in
// the HTML view (LaTeX users keep PDF · LaTeX for faithful typesetting). Handles
// the common resume constructs (Jake-style macros, $|$ separators, \vspace and
// friends). A single source newline is soft (becomes a space) — only \\, blank
// lines, sections, and structural macros are real breaks.
function latexToPlainText(src: string): string {
  let text = src;
  const begin = text.indexOf("\\begin{document}");
  if (begin >= 0) text = text.slice(begin + "\\begin{document}".length);
  const end = text.indexOf("\\end{document}");
  if (end >= 0) text = text.slice(0, end);

  text = text.replace(/(?<!\\)%.*$/gm, ""); // drop comments, keep escaped \%
  text = text.replace(/\n[ \t]*\n+/g, LINE_BREAK); // blank line(s) = paragraph break
  text = expandResumeMacros(text); // structured macros -> role/bullet markers

  text = text
    .replace(/\\(?:section|subsection)\*?\s*\{([^{}]*)\}/g, (_m, title) => `${LINE_BREAK}${SECTION_MARK}${String(title).trim()}${LINE_BREAK}`)
    .replace(/\\\\\s*(?:\[[^\]]*\])?/g, LINE_BREAK) // \\ line break (drop optional [len])
    .replace(/\\item\b\s*/g, `${LINE_BREAK}- `)
    .replace(/(?<!\\)\$\s*\\?\|\s*\$/g, " | ") // $|$ separator -> | (skip escaped \$)
    .replace(/(?<!\\)\$[^$]*\$/g, " ") // drop other inline math (skip escaped \$)
    .replace(/\\(?:textbf|textit|emph|underline|textsc|texttt|textnormal|mbox|text)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\href\s*\{[^{}]*\}\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\url\s*\{([^{}]*)\}/g, "$1")
    // spacing / sizing commands carry args we drop entirely
    .replace(/\\(?:vspace|hspace|vskip|hskip|needspace|setlength|addtolength|titlespacing|raisebox)\*?\s*(?:\{[^{}]*\}|\[[^\]]*\])+/g, " ")
    .replace(/\\(?:begin|end)\s*\{[^{}]*\}(?:\[[^\]]*\])?(?:\{[^{}]*\})?/g, LINE_BREAK)
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/~/g, " ")
    .replace(/\\[,;:!> ]/g, " ")
    .replace(/\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?/g, " ") // any remaining commands
    .replace(/[{}]/g, " ") // stray braces
    .replace(/\\([&%$#_])/g, "$1") // unescape literal \&  \%  \$  \#  \_
    .replace(/[ \t\r\n]+/g, " "); // soft (source) newlines collapse to spaces

  return text
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

type Header = { name: string; contact: string; body: string[] };

// First non-empty line is the name when it reads like one and the next non-empty
// line reads like contact info; otherwise there is no confident header and all
// lines are body. Body lines come back already cleaned.
function extractHeader(rawLines: string[]): Header {
  const lines = rawLines.map(cleanLine);
  const nameIdx = lines.findIndex(Boolean);
  if (nameIdx < 0) return { name: "", contact: "", body: [] };

  const name = lines[nameIdx];
  let contactIdx = -1;
  for (let i = nameIdx + 1; i < lines.length; i += 1) {
    if (lines[i]) {
      contactIdx = i;
      break;
    }
  }
  const contact = contactIdx >= 0 ? lines[contactIdx] : "";
  if (isNameLine(name) && isContactLine(contact)) {
    return { name, contact, body: lines.slice(contactIdx + 1) };
  }
  return { name: "", contact: "", body: lines.slice(nameIdx) };
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

export function parseResumeDocument(polishedText: string, sourceText?: string): ResumeDocumentModel {
  const text = looksLikeLatex(polishedText) ? latexToPlainText(polishedText) : polishedText;
  const header = extractHeader(splitLines(text));

  let { name, contact } = header;
  // Recover a name/contact from the original source when the polished output
  // dropped its header (mirrors the old PDF fallback).
  if (!name && sourceText) {
    const srcText = looksLikeLatex(sourceText) ? latexToPlainText(sourceText) : sourceText;
    const src = extractHeader(splitLines(srcText));
    if (src.name) {
      name = src.name;
      contact = contact || src.contact;
    }
  }

  const sections: ResumeSection[] = [{ heading: "", blocks: [] }];
  const current = () => sections[sections.length - 1];

  for (const line of header.body) {
    if (!line) continue;

    if (line.startsWith(SECTION_MARK)) {
      const title = cleanLine(line.slice(1));
      if (title) sections.push({ heading: headingLabel(title), blocks: [] });
      continue;
    }

    // A role line from a structural macro carries an explicit left/right split,
    // so the right side is right-aligned even when it is a location, not a date.
    if (line.startsWith(ROLE_MARK)) {
      const [rawLeft, rawRight = ""] = line.slice(1).split(ROLE_SEP);
      const left = cleanLine(rawLeft);
      const right = cleanLine(rawRight);
      if (left || right) current().blocks.push({ kind: "role", left, right });
      continue;
    }

    if (isKnownHeading(line)) {
      sections.push({ heading: headingLabel(line), blocks: [] });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      current().blocks.push({ kind: "bullet", text: line.replace(/^[-*]\s+/, "") });
      continue;
    }

    // A plain-text role line carries a right-aligned date when split on "|" leaves
    // a final date-like segment; otherwise treat the whole line as one bold line.
    if (line.includes("|") || DATE_RE.test(line)) {
      const parts = line.split("|").map((part) => part.trim()).filter(Boolean);
      const last = parts[parts.length - 1] ?? "";
      if (parts.length >= 2 && DATE_RE.test(last)) {
        current().blocks.push({ kind: "role", left: parts.slice(0, -1).join(" | "), right: last });
      } else {
        current().blocks.push({ kind: "role", left: line, right: "" });
      }
      continue;
    }

    current().blocks.push({ kind: "para", text: line });
  }

  return {
    name,
    contact,
    sections: sections.filter((section) => section.heading !== "" || section.blocks.length > 0)
  };
}
