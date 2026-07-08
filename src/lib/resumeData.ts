// Structured, editable resume model — the canonical shape the interactive editor
// mutates and the LaTeX/Tectonic "Compile Preview" renders. It mirrors the schema
// the server templates already consume (server/latex/parseResumeText.ts →
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
import { BULLET_GLYPHS, inferSectionType, isSectionHeader } from "../resume/sections";
import { extractPlainTextFromLatex } from "./latexText";

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

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
// jakes.ts destructures in its `render(resume)`.
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
// Section/bullet heuristics are the SAME as the server parser
// (server/latex/parseResumeText.ts) — both import them from
// ../resume/sections.ts — so a resume seeded into the editor maps the same way the
// LaTeX pipeline would map it.

// Bullet glyph set is shared (../resume/sections.ts); the parser additionally
// accepts numbered lists ("1." / "1)"). isSectionHeader is shared too.
const BULLET_RE = new RegExp(`^\\s*(?:[${BULLET_GLYPHS}]|\\d+[.)])\\s+`);
const HEADING_SPLIT_RE = /\s*[|•·]\s+/;

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
      const heading = titleCase(line.trim().replace(/:$/, ""));
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
// The extractor is the ONE shared implementation in ./latexText.ts (imported at
// the top for this module's own parse path, above). It used to live here as a
// hand-port of server/latex/parseResumeText.ts; both now consume the shared
// module. Re-exported so existing importers (e.g. useResumeAnalysis) keep
// resolving extractPlainTextFromLatex from resumeData.
export { extractPlainTextFromLatex };
