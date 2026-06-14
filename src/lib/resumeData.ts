// Structured, editable resume model — the canonical shape the interactive editor
// mutates and the LaTeX/Tectonic "Compile Preview" renders. It mirrors the schema
// the server templates already consume (server/latex/parseResumeText.mjs →
// the jakes template's `render(resume)`), plus stable ids for React keys:
//
//   { name, contact: string[],
//     sections: [
//       { heading, type,
//         items: [ { titleLeft, titleRight, subtitleLeft, subtitleRight, bullets[] } ] }
//     ] }
//
// `parseResumeData` seeds the editor from existing plain-text / LaTeX resumes,
// `serializeResumeData` derives the plain text every legacy consumer needs
// (scoring, diff, clean-PDF print, pipeline snapshot), and
// `toTemplateSchema` produces the id-free schema the server template renderer
// expects for the structured compile path.

import { looksLikeLatex } from "./resumeFormat";
import { stripInlineMarks } from "./inlineMarks";

// ===== Types =====

export type ResumeBullet = { id: string; text: string };

export type ResumeSectionType = "standard" | "skills" | "summary";

export type ResumeEntry = {
  id: string;
  titleLeft: string; // school / project / role / company line
  titleRight: string; // dates, year, link
  subtitleLeft: string; // degree / company / tech stack / role detail
  subtitleRight: string; // location or secondary metadata
  bullets: ResumeBullet[];
};

export type ResumeSectionData = { id: string; heading: string; type: ResumeSectionType; items: ResumeEntry[] };

export type ResumeData = { name: string; contact: string[]; sections: ResumeSectionData[] };

// Id-free shape sent to the server template renderer. Matches exactly what
// jakes.mjs destructures in its `render(resume)`.
export type ResumeTemplateSchema = {
  name: string;
  contact: string[];
  sections: {
    heading: string;
    // Explicit section type so templates don't have to re-infer it from the
    // heading text (a renamed summary still renders as paragraphs). Optional:
    // server-side text parsing produces schemas without it.
    type?: ResumeSectionType;
    items: { title: string; subtitle: string; meta: string; location: string; bullets: string[] }[];
  }[];
};

// ===== Stable ids =====

// Session-unique ids for React keys + edit targeting. They only need to be unique
// within a render tree, not stable across reparses, so a counter is enough.
let uidCounter = 0;
function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

const SKILLS_SECTION_RE = /\b(?:technical\s+skills|skills|core\s+skills)\b/i;
const SUMMARY_SECTION_RE = /\b(?:summary|objective|profile|about\s+me|highlights)\b/i;

// Internal: type is inferred from the heading only when PARSING imported resumes
// (added sections get an explicit type from the picker). Skills wins over
// summary so "Skills Summary" stays a skill list.
function inferSectionType(heading: string): ResumeSectionType {
  const trimmed = heading.trim();
  if (SKILLS_SECTION_RE.test(trimmed)) return "skills";
  if (SUMMARY_SECTION_RE.test(trimmed)) return "summary";
  return "standard";
}

export function newBullet(text = ""): ResumeBullet {
  return { id: uid("bullet"), text };
}

export function newEntry(partial: Partial<Omit<ResumeEntry, "id" | "bullets">> = {}): ResumeEntry {
  return {
    id: uid("entry"),
    titleLeft: partial.titleLeft ?? "",
    titleRight: partial.titleRight ?? "",
    subtitleLeft: partial.subtitleLeft ?? "",
    subtitleRight: partial.subtitleRight ?? "",
    bullets: [newBullet()]
  };
}

export function newSkillEntry(label = "", skills = ""): ResumeEntry {
  return {
    id: uid("entry"),
    titleLeft: label,
    titleRight: "",
    subtitleLeft: skills,
    subtitleRight: "",
    bullets: []
  };
}

// A summary row is one paragraph. The text lives in a single bullet so the
// tailor pipeline's existing bullet targeting (suggestions, highlights, accepts)
// works on summaries unchanged; the section type controls how it renders and
// serializes (plain paragraph, no bullet glyph or "- " prefix).
export function newSummaryEntry(text = ""): ResumeEntry {
  return {
    id: uid("entry"),
    titleLeft: "",
    titleRight: "",
    subtitleLeft: "",
    subtitleRight: "",
    bullets: [newBullet(text)]
  };
}

// Type is now explicit (chosen by the user when adding a section), not inferred
// from the heading — so renaming a heading never silently flips a "bulleted
// entries" section into a "skill list" (which would strand its bullets).
// inferSectionType is still used when PARSING imported resumes (no explicit type).
export function newSection(type: ResumeSectionType = "standard", heading?: string): ResumeSectionData {
  const resolvedHeading = heading ?? (type === "skills" ? "Skills" : type === "summary" ? "Summary" : "New Section");
  return {
    id: uid("section"),
    heading: resolvedHeading,
    type,
    items: [type === "skills" ? newSkillEntry() : type === "summary" ? newSummaryEntry() : newEntry()]
  };
}

// ===== Parse (plain text → structured) =====
// Heuristics mirror the server parser (server/latex/parseResumeText.mjs) so a
// resume seeded into the editor maps the same way the LaTeX pipeline would map it.

const BULLET_RE = /^\s*(?:[-*•◦▪‣]|\d+[.)])\s+/;
const SECTION_RE = /^[A-Z0-9][A-Z0-9 &/\-]+$/;
const HEADING_SPLIT_RE = /\s*[|•·]\s+/;

function isSectionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 2 || trimmed.length > 50) return false;
  if (!SECTION_RE.test(trimmed)) return false;
  // Section headings are usually 1–2 words; cap at 4 so a SHOUTING company name
  // is not mistaken for a heading.
  return trimmed.split(/\s+/).length <= 4;
}

function stripBullet(line: string): string {
  return line.replace(BULLET_RE, "").trim();
}

function parseItemHeading(line: string): ResumeEntry {
  const trimmed = line.trim();
  const sepNormalized = trimmed.replace(/\s+[—–]\s+/g, " | ");
  const parts = sepNormalized
    .split(HEADING_SPLIT_RE)
    .map((piece) => piece.trim())
    .filter(Boolean);
  return {
    id: uid("entry"),
    titleLeft: parts[0] || "",
    subtitleLeft: parts[1] || "",
    titleRight: parts[2] || "",
    subtitleRight: parts[3] || "",
    bullets: []
  };
}

// Bracketed prompts like "[add metric: …]" are accomplishment placeholders and
// never belong on a skills line — drop them, then tidy whitespace.
function cleanSkillText(text: string): string {
  return text
    .replace(/\s*\[(?:add|insert|todo)\b[^\]]*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// A skills line is "Label: comma, separated, skills". Split on the FIRST colon
// only when it reads like a short label (≤ 40 chars, not a URL scheme); otherwise
// the whole line is the skill list with no label.
function parseSkillEntry(line: string): ResumeEntry {
  const stripped = cleanSkillText(stripBullet(line));
  const colonIndex = stripped.indexOf(":");
  const label = colonIndex > 0 ? stripped.slice(0, colonIndex).trim() : "";
  const isLabel = colonIndex > 0 && colonIndex <= 40 && !/^https?$/i.test(label) && stripped.slice(colonIndex + 1).trim().length > 0;
  if (isLabel) {
    // The template bolds every skills label, so a parsed label must not carry
    // inline marks — otherwise an imported `\textbf{Languages}` round-trips to
    // `\textbf{\textbf{Languages}}`. (Mirrors the link-underline chrome fix.)
    return newSkillEntry(stripInlineMarks(label), cleanSkillText(stripped.slice(colonIndex + 1)));
  }
  return newSkillEntry("", stripped);
}

function parseContactLines(lines: string[]): string[] {
  if (!lines.length) return [];
  const joined = lines.join(" | ");
  return joined
    .split(HEADING_SPLIT_RE)
    .map((piece) => piece.trim())
    .filter(Boolean);
}

export function parseResumeData(text: string, sourceText?: string): ResumeData {
  const plain = looksLikeLatex(text) ? extractPlainTextFromLatex(text) : text;
  const data = parsePlainResume(plain);

  // Recover a name/contact from the original source when the polished output
  // dropped its header (mirrors the existing PDF/document fallback).
  if (!data.name && sourceText) {
    const srcPlain = looksLikeLatex(sourceText) ? extractPlainTextFromLatex(sourceText) : sourceText;
    const src = parsePlainResume(srcPlain);
    if (src.name) {
      data.name = src.name;
      if (!data.contact.length) data.contact = src.contact;
    }
  }
  return data;
}

function parsePlainResume(text: string): ResumeData {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim());

  let i = 0;
  while (i < lines.length && !lines[i]) i += 1;

  let name = "";
  if (i < lines.length && !isSectionHeader(lines[i])) {
    name = lines[i] || "";
    i += 1;
  }

  const contactBuffer: string[] = [];
  while (i < lines.length && !isSectionHeader(lines[i])) {
    if (lines[i]) contactBuffer.push(lines[i]);
    i += 1;
  }
  const contact = parseContactLines(contactBuffer);

  const sections: ResumeSectionData[] = [];
  let currentSection: ResumeSectionData | null = null;
  let currentItem: ResumeEntry | null = null;

  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;

    if (isSectionHeader(line)) {
      const heading = line.trim();
      currentSection = { id: uid("section"), heading, type: inferSectionType(heading), items: [] };
      sections.push(currentSection);
      currentItem = null;
      continue;
    }

    if (!currentSection) {
      // Lines before any section are additional contact entries.
      contact.push(line);
      continue;
    }

    if (currentSection.type === "skills") {
      currentSection.items.push(parseSkillEntry(line));
      currentItem = null;
      continue;
    }

    if (currentSection.type === "summary") {
      // Each line is a paragraph; tolerate bulleted summaries by stripping the
      // marker. Never pipe-split a paragraph into heading slots.
      currentSection.items.push(newSummaryEntry(stripBullet(line)));
      currentItem = null;
      continue;
    }

    if (BULLET_RE.test(line)) {
      if (!currentItem) {
        currentItem = newEntry();
        currentItem.bullets = [];
        currentSection.items.push(currentItem);
      }
      currentItem.bullets.push(newBullet(stripBullet(line)));
      continue;
    }

    currentItem = parseItemHeading(line);
    currentSection.items.push(currentItem);
  }

  return { name, contact, sections };
}

// ===== Serialize (structured → plain text) =====
// Emits the format the scoring/diff/print/DOCX consumers expect: name line,
// contact joined by " | ", ALL-CAPS section headings, Jake-style entry rows,
// and skills rows as "Label: comma-separated skills".

function formatSkillRow(item: ResumeEntry): string {
  const label = item.titleLeft.trim();
  const skills = item.subtitleLeft.trim();
  if (label && skills) return `${label}: ${skills}`;
  return label || skills;
}

export function serializeResumeData(data: ResumeData): string {
  const lines: string[] = [];
  if (data.name.trim()) lines.push(data.name.trim());
  const contact = data.contact.map((c) => c.trim()).filter(Boolean);
  if (contact.length) lines.push(contact.join(" | "));

  for (const section of data.sections) {
    lines.push("");
    if (section.heading.trim()) lines.push(section.heading.trim().toUpperCase());
    if (section.type === "skills") {
      for (const item of section.items) {
        const row = formatSkillRow(item);
        if (row) lines.push(row);
        for (const bullet of item.bullets) {
          const text = bullet.text.trim();
          if (text) lines.push(`- ${text}`);
        }
      }
      continue;
    }

    if (section.type === "summary") {
      // Paragraphs serialize as plain lines (no "- " prefix) so the round trip
      // back through parsePlainResume re-derives the summary type and shape.
      for (const item of section.items) {
        for (const bullet of item.bullets) {
          const text = bullet.text.trim();
          if (text) lines.push(text);
        }
      }
      continue;
    }

    for (const item of section.items) {
      const headingLine = [item.titleLeft, item.subtitleLeft, item.titleRight, item.subtitleRight]
        .map((slot) => slot.trim())
        .filter(Boolean)
        .join(" | ");
      if (headingLine) lines.push(headingLine);
      for (const bullet of item.bullets) {
        const text = bullet.text.trim();
        if (text) lines.push(`- ${text}`);
      }
    }
  }

  // Plain-text consumers (Copy, DOCX rewrite, scoring, diff, snapshots) get the
  // text without the internal inline formatting tags — those style only the
  // rendered surfaces (editor, print mirror, LaTeX templates).
  return stripInlineMarks(lines.join("\n").replace(/\n{3,}/g, "\n\n").trim());
}

export function toTemplateSchema(data: ResumeData): ResumeTemplateSchema {
  return {
    name: data.name.trim(),
    contact: data.contact.map((c) => c.trim()).filter(Boolean),
    sections: data.sections.map((section) => ({
      heading: section.heading.trim(),
      type: section.type,
      items:
        section.type === "skills"
          ? section.items
              .map((item) => ({
                title: "",
                subtitle: "",
                meta: "",
                location: "",
                bullets: [formatSkillRow(item), ...item.bullets.map((b) => b.text.trim())].filter(Boolean)
              }))
              .filter((item) => item.bullets.length)
          : section.type === "summary"
          ? section.items
              .map((item) => ({
                title: "",
                subtitle: "",
                meta: "",
                location: "",
                bullets: item.bullets.map((b) => b.text.trim()).filter(Boolean)
              }))
              .filter((item) => item.bullets.length)
          : section.items.map((item) => ({
              title: item.titleLeft.trim(),
              subtitle: item.subtitleLeft.trim(),
              meta: item.titleRight.trim(),
              location: item.subtitleRight.trim(),
              bullets: item.bullets.map((b) => b.text.trim()).filter(Boolean)
            }))
    }))
  };
}

// ===== LaTeX → plain text =====
// Ported from server/latex/parseResumeText.mjs (extractPlainTextFromLatex) so a
// raw .tex resume can seed the structured editor without a server round-trip. It
// produces the clean "Title | Subtitle | Meta | Location" + "- bullet" format the
// parser above understands.

type LatexCommandCall = { index: number; end: number; args: string[] };

function stripLatexComments(value: string): string {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => {
      let escaped = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === "\\" && !escaped) {
          escaped = true;
          continue;
        }
        if (char === "%" && !escaped) return line.slice(0, i);
        escaped = false;
      }
      return line;
    })
    .join("\n");
}

function readBracedGroup(source: string, start: number): { value: string; end: number } | null {
  if (source[start] !== "{") return null;

  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    const escaped = i > 0 && source[i - 1] === "\\";
    if (char === "{" && !escaped) {
      depth += 1;
      continue;
    }
    if (char === "}" && !escaped) {
      depth -= 1;
      if (depth === 0) {
        return { value: source.slice(start + 1, i), end: i + 1 };
      }
    }
  }

  return null;
}

function readCommandArgs(source: string, command: string, index: number, maxArgs = 8): LatexCommandCall | null {
  const prefix = `\\${command}`;
  if (!source.startsWith(prefix, index)) return null;

  const next = source[index + prefix.length] ?? "";
  if (/[A-Za-z]/.test(next)) return null;

  const args: string[] = [];
  let cursor = index + prefix.length;
  if (source[cursor] === "*") cursor += 1;
  while (args.length < maxArgs) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "{") break;
    const group = readBracedGroup(source, cursor);
    if (!group) break;
    args.push(group.value);
    cursor = group.end;
  }

  return { index, end: cursor, args };
}

function findCommandCalls(source: string, command: string, maxArgs = 8): LatexCommandCall[] {
  const calls: LatexCommandCall[] = [];
  const prefix = `\\${command}`;
  let cursor = 0;

  while (cursor < source.length) {
    const index = source.indexOf(prefix, cursor);
    if (index < 0) break;
    const call = readCommandArgs(source, command, index, maxArgs);
    if (call) {
      calls.push(call);
      cursor = Math.max(call.end, index + prefix.length);
    } else {
      cursor = index + prefix.length;
    }
  }

  return calls;
}

function replaceCommandWithArg(source: string, command: string, argIndex = 0): string {
  let result = "";
  let cursor = 0;
  // Read EXACTLY the args this command takes (argIndex + 1). Reading more would
  // greedily swallow an adjacent brace group — e.g. a skills row
  // `\textbf{Languages}{: Python, …}` would lose its `{: …}` skills and leave only
  // "Languages". \href (argIndex 1) still correctly reads {url}{label}.
  const calls = findCommandCalls(source, command, argIndex + 1);

  for (const call of calls) {
    if (call.args.length <= argIndex) continue;
    result += source.slice(cursor, call.index);
    result += call.args[argIndex];
    cursor = call.end;
  }

  return result + source.slice(cursor);
}

function replaceCommandWithFormattedArg(source: string, command: string, tag: "b" | "i" | "u", argIndex = 0): string {
  let result = "";
  let cursor = 0;
  const calls = findCommandCalls(source, command, argIndex + 1);

  for (const call of calls) {
    if (call.args.length <= argIndex) continue;
    result += source.slice(cursor, call.index);
    result += `<${tag}>${call.args[argIndex]}</${tag}>`;
    cursor = call.end;
  }

  return result + source.slice(cursor);
}

// Filesystem/LaTeX-safe URL text: drop braces, whitespace, and control chars
// (none are valid in a real link) and cap length.
function cleanUrlForText(url: string): string {
  return String(url ?? "")
    .replace(/[\s{}\\]+/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 300);
}

// Does the visible label already encode the URL (so linkify can rebuild the link
// on serialize)? True for domain-style labels like "github.com/x"; false for a
// friendly label like "My Portfolio" whose URL would otherwise be lost.
function labelImpliesUrl(label: string, url: string): boolean {
  const cleanLabel = String(label ?? "")
    .replace(/<\/?[a-z]+>/gi, "")
    .replace(/\\[a-zA-Z]+\b/g, "")
    .replace(/[{}\\]/g, "")
    .trim()
    .toLowerCase();
  const bare = String(url ?? "")
    .replace(/^\s*(?:https?:\/\/|mailto:)/i, "")
    .replace(/\/+$/, "")
    .trim()
    .toLowerCase();
  if (!cleanLabel || !bare) return true; // nothing comparable — keep current behavior
  if (cleanLabel === bare) return true;
  if (bare.startsWith(cleanLabel) || cleanLabel.startsWith(bare)) return true;
  // A spaceless label that contains the URL's domain is link-like enough.
  const domain = bare.split("/")[0];
  return !/\s/.test(cleanLabel) && cleanLabel.includes(domain);
}

// Replace each \href{url}{label}. When the label implies the URL, keep just the
// label (the serializer's linkify rebuilds the clickable link, preserving the
// historical round-trip). Otherwise append the URL as text — "label (url)" — so
// a friendly-labelled link's destination is never silently lost on parse.
function replaceHrefPreservingUrl(source: string): string {
  let result = "";
  let cursor = 0;
  for (const call of findCommandCalls(source, "href", 2)) {
    if (!call.args.length) continue;
    const url = cleanUrlForText(call.args[0] ?? "");
    const label = call.args.length >= 2 ? call.args[1] : "";
    result += source.slice(cursor, call.index);
    if (!label.trim()) result += url;
    else if (!url || labelImpliesUrl(label, url)) result += label;
    else result += `${label} (${url})`;
    cursor = call.end;
  }
  return result + source.slice(cursor);
}

function unwrapLatexInlineCommands(value: string): string {
  let text = replaceHrefPreservingUrl(value);
  for (let i = 0; i < 6; i += 1) {
    const next = [
      ["underline", 0],
      ["textbf", 0],
      ["textit", 0],
      ["emph", 0],
      ["textsc", 0],
      ["texttt", 0],
      ["textrm", 0],
      ["textsf", 0],
      ["small", 0],
      ["footnotesize", 0]
    ].reduce((current, [command, argIndex]) => replaceCommandWithArg(current, String(command), Number(argIndex)), text);
    if (next === text) break;
    text = next;
  }
  return text;
}

// A link's underline is template chrome — Jake's template wraps every \href
// label in \underline — not user formatting. Strip the underline bound to an
// \href so parsed links don't render underlined and don't double-wrap
// (\underline{\underline{…}}) when re-serialized (the template re-adds it). A
// standalone \underline{…} not tied to a link is left intact and still becomes <u>.
function dropLinkUnderlines(value: string): string {
  let text = value;
  for (let i = 0; i < 6; i += 1) {
    // \underline{\href{…}{…}} -> \href{…}{…}
    let next = "";
    let cursor = 0;
    for (const call of findCommandCalls(text, "underline", 1)) {
      const inner = call.args[0] ?? "";
      if (call.args.length >= 1 && /^\s*\\href\b/.test(inner)) {
        next += text.slice(cursor, call.index) + inner;
        cursor = call.end;
      }
    }
    next += text.slice(cursor);

    // \href{url}{\underline{label}} -> \href{url}{label} (whole label is one underline)
    let after = "";
    cursor = 0;
    for (const call of findCommandCalls(next, "href", 2)) {
      if (call.args.length < 2) continue;
      const label = call.args[1].trim();
      const u = findCommandCalls(label, "underline", 1);
      if (u.length === 1 && u[0].index === 0 && u[0].end === label.length && u[0].args.length >= 1) {
        after += next.slice(cursor, call.index) + `\\href{${call.args[0]}}{${u[0].args[0]}}`;
        cursor = call.end;
      }
    }
    after += next.slice(cursor);

    if (after === text) break;
    text = after;
  }
  return text;
}

function preserveLatexInlineCommands(value: string): string {
  let text = dropLinkUnderlines(value);
  for (let i = 0; i < 6; i += 1) {
    let next = replaceHrefPreservingUrl(text);
    next = replaceCommandWithFormattedArg(next, "underline", "u");
    next = replaceCommandWithFormattedArg(next, "textbf", "b");
    next = replaceCommandWithFormattedArg(next, "textit", "i");
    next = replaceCommandWithFormattedArg(next, "emph", "i");
    next = [
      ["textsc", 0],
      ["texttt", 0],
      ["textrm", 0],
      ["textsf", 0],
      ["small", 0],
      ["footnotesize", 0]
    ].reduce((current, [command, argIndex]) => replaceCommandWithArg(current, String(command), Number(argIndex)), next);
    if (next === text) break;
    text = next;
  }
  return text;
}

function stripLatexInline(value: string): string {
  return unwrapLatexInlineCommands(String(value ?? ""))
    .replace(/\\\\(?:\[[^\]]*\])?/g, "\n")
    .replace(/\\(?:begin|end)\{[^}]+\}/g, " ")
    .replace(/\\item\b/g, " ")
    .replace(/\\(?:Huge|huge|LARGE|Large|large|small|footnotesize|tiny|normalsize|scshape|bfseries|itshape)\b/g, " ")
    // Spacing/layout commands whose braced argument is a dimension to DISCARD (not
    // content). Without \needspace here, `\needspace{4\baselineskip}` strips the
    // command + \baselineskip but leaves a stray "4" in the output.
    .replace(/\\(?:v?h?space|needspace|addvspace|vskip|hskip)\*?\s*\{[^}]*\}/g, " ")
    .replace(/\\(?:quad|qquad|hfill|vfill|noindent|par|newline|newpage|pagebreak|linebreak|bigskip|medskip|smallskip)\b/g, " ")
    .replace(/\$\\bullet\$/g, " | ")
    .replace(/\$([^$]*)\$/g, "$1")
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\\$/g, "$")
    .replace(/\\#/g, "#")
    .replace(/\\_/g, "_")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\,|\\ /g, " ")
    .replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}]/g, "")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function formatLatexInline(value: string): string {
  return preserveLatexInlineCommands(String(value ?? ""))
    .replace(/\\\\(?:\[[^\]]*\])?/g, "\n")
    .replace(/\\(?:begin|end)\{[^}]+\}/g, " ")
    .replace(/\\item\b/g, " ")
    .replace(/\\(?:Huge|huge|LARGE|Large|large|small|footnotesize|tiny|normalsize|scshape|bfseries|itshape)\b/g, " ")
    .replace(/\\(?:v?h?space|needspace|addvspace|vskip|hskip)\*?\s*\{[^}]*\}/g, " ")
    .replace(/\\(?:quad|qquad|hfill|vfill|noindent|par|newline|newpage|pagebreak|linebreak|bigskip|medskip|smallskip)\b/g, " ")
    .replace(/\$\\bullet\$/g, " | ")
    .replace(/\$([^$]*)\$/g, "$1")
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\\$/g, "$")
    .replace(/\\#/g, "#")
    .replace(/\\_/g, "_")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\,|\\ /g, " ")
    .replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}]/g, "")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const URL_SCHEME_RE = /(?:https?|mailto|ftps?|tel|file|ssh|sftp)$/i;

// Tidy spacing around a label colon ("Label:skills" → "Label: skills") WITHOUT
// breaking URL schemes ("https://", "mailto:x") or digit ratios/times ("12:30").
function normalizeColon(match: string, offset: number, full: string): string {
  const before = full[offset - 1] ?? "";
  const after = full[offset + match.length] ?? "";
  if (after === "/") return match; // "://"
  if (/\d/.test(before) && /\d/.test(after)) return match; // "12:30"
  if (URL_SCHEME_RE.test(full.slice(Math.max(0, offset - 7), offset))) return match; // "mailto:x"
  return ": ";
}

function splitLatexRows(value: string): string[] {
  return String(value ?? "")
    .split(/\\\\(?:\[[^\]]*\])?|\r?\n/)
    .map((piece) => formatLatexInline(piece))
    .map((piece) => piece.replace(/\s*:\s*/g, normalizeColon).replace(/\s*\|\s*/g, " | ").trim())
    .filter(Boolean);
}

function extractHeaderName(headerSource: string): string {
  // Capture allows escaped specials (\& \_ \% \# \$) so a name like
  // "OReilly \& Sons" isn't truncated at the backslash; it still stops at a
  // line break (\\) or a real command, and stripLatexInline un-escapes after.
  const match =
    headerSource.match(/\\textbf\{\s*\\(?:Huge|huge|LARGE|Large)\s*(?:\\(?:scshape|bfseries)\s*)*((?:[^{}\\\n]|\\[&_%#$])+)\}/) ||
    headerSource.match(/\\(?:Huge|huge|LARGE|Large)\s*(?:\\(?:scshape|bfseries)\s*)*((?:[^{}\\\n]|\\[&_%#$])+)/);
  return match ? stripLatexInline(match[1]) : "";
}

function extractHeaderContact(headerSource: string, name: string): string {
  const text = stripLatexInline(headerSource)
    .replace(/\$\|\$/g, " | ")
    .replace(/\$\\bullet\$/g, " | ")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
  const withoutName = name && text.startsWith(name) ? text.slice(name.length).trim() : text;
  return withoutName.replace(/^\|+|\|+$/g, "").trim();
}

function formatSubheading(args: string[]): string {
  return [args[0], args[2], args[1], args[3]]
    .map((arg) => formatLatexInline(arg))
    .filter(Boolean)
    .join(" | ");
}

function formatProjectHeading(args: string[]): string {
  if (args.length >= 3) {
    return [args[0], args[1], args[2]].map((arg) => formatLatexInline(arg)).filter(Boolean).join(" | ");
  }

  const titleParts = formatLatexInline(args[0] ?? "")
    .split(/\s*\|\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const meta = formatLatexInline(args[1] ?? "");
  return [...titleParts, meta].filter(Boolean).join(" | ");
}

function pushItemRows(events: { index: number; order: number; kind: "sub" | "item"; text: string }[], index: number, orderRef: { value: number }, raw: string) {
  for (const text of splitLatexRows(raw)) {
    events.push({ index, order: orderRef.value, kind: "item", text });
    orderRef.value += 1;
  }
}

// A real résumé .tex is a few KB. The brace readers below are worst-case O(n²) on
// pathological unbalanced-brace input, so bound the input length to keep a huge
// pasted/crafted .tex from freezing the tab (self-DoS). Mirrors the server cap.
const MAX_LATEX_INPUT = 200_000;

export function extractPlainTextFromLatex(tex: string): string {
  const raw = String(tex ?? "");
  if (raw.length > MAX_LATEX_INPUT) return "";
  const source = stripLatexComments(raw);
  const docStart = source.indexOf("\\begin{document}");
  const body = docStart >= 0 ? source.slice(docStart + "\\begin{document}".length) : source;
  const trimmedBody = body.replace(/\\end\{document\}[\s\S]*$/, "");

  const sectionStarts: { heading: string; index: number; after: number }[] = [];
  for (const call of findCommandCalls(trimmedBody, "section", 1)) {
    if (!call.args[0]) continue;
    sectionStarts.push({ heading: stripLatexInline(call.args[0]), index: call.index, after: call.end });
  }

  const headerSource = sectionStarts.length ? trimmedBody.slice(0, sectionStarts[0].index) : trimmedBody;
  const lines: string[] = [];
  const name = extractHeaderName(headerSource);
  if (name) lines.push(name);
  const contact = extractHeaderContact(headerSource, name);
  if (contact) lines.push(contact);

  for (let s = 0; s < sectionStarts.length; s += 1) {
    const start = sectionStarts[s];
    const end = s + 1 < sectionStarts.length ? sectionStarts[s + 1].index : trimmedBody.length;
    const segment = trimmedBody.slice(start.after, end);

    lines.push("");
    lines.push(start.heading.toUpperCase());

    const events: { index: number; order: number; kind: "sub" | "item"; text: string }[] = [];
    const orderRef = { value: 0 };

    for (const call of findCommandCalls(segment, "resumeSubheading", 4)) {
      if (call.args.length < 4) continue;
      events.push({ index: call.index, order: orderRef.value, kind: "sub", text: formatSubheading(call.args) });
      orderRef.value += 1;
    }

    for (const call of findCommandCalls(segment, "resumeSubSubheading", 2)) {
      if (call.args.length < 2) continue;
      events.push({
        index: call.index,
        order: orderRef.value,
        kind: "sub",
        text: [call.args[0], call.args[1]].map((arg) => formatLatexInline(arg)).filter(Boolean).join(" | ")
      });
      orderRef.value += 1;
    }

    for (const call of findCommandCalls(segment, "resumeProjectHeading", 3)) {
      if (call.args.length < 2) continue;
      events.push({ index: call.index, order: orderRef.value, kind: "sub", text: formatProjectHeading(call.args) });
      orderRef.value += 1;
    }

    for (const call of findCommandCalls(segment, "resumeItem", 1)) {
      if (!call.args[0]) continue;
      pushItemRows(events, call.index, orderRef, call.args[0]);
    }

    if (!events.length) {
      for (const call of findCommandCalls(segment, "item", 1)) {
        if (!call.args[0]) continue;
        pushItemRows(events, call.index, orderRef, call.args[0]);
      }
    }

    events.sort((a, b) => a.index - b.index || a.order - b.order);
    for (const event of events) {
      const text = event.text.replace(/\s+\|\s+(?=\|)/g, " | ").replace(/\|\s+$/, "").trim();
      if (!text) continue;
      lines.push(event.kind === "sub" ? text : `- ${text}`);
    }

    if (!events.length) {
      for (const piece of splitLatexRows(segment)) {
        if (piece && !lines.includes(piece)) lines.push(piece);
      }
    }
  }

  return lines.join("\n");
}
