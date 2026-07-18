// Plain-text ⇄ ResumeData bridge — a role-fit-ai concern, not an engine one.
// The engine (`@typeset/engine`) owns the structured model and the strict
// `.resume` codec; this module owns the AI-pipeline text formats:
//
// `parseResumeData` seeds the editor from plain-text resumes (upload/paste and
// AI polish output); `serializeResumeData` derives the plain text the scoring,
// diff, tailor-payload, and pipeline-snapshot consumers read.
//
// All ids are minted through the engine's constructors so parse-seeded rows
// can never collide with rows the editor mints later.

import {
  newBullet,
  newEntry,
  newSection,
  newSkillEntry,
  newSummaryEntry,
  type ResumeData,
  type ResumeEntry,
  type ResumeSectionData
} from "@typeset/engine/lib/resumeData.ts";
import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import { BULLET_GLYPHS, inferSectionType, isSectionHeader } from "../resume/sections.ts";

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ===== Parse (plain text → structured) =====
// Section/bullet heuristics live in ../resume/sections.ts so parsing stays
// consistent wherever a plain-text resume needs the same section model.

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
    ...newEntry({
      titleLeft: parts[0] || "",
      subtitleLeft: parts[1] || "",
      titleRight: parts[2] || "",
      subtitleRight: parts[3] || ""
    }),
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
    // Skill labels render bold by convention, so a parsed label must not carry
    // inline marks — otherwise an imported bold label round-trips doubled.
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
  const data = parsePlainResume(text);

  // Recover a name/contact from the original source when the polished output
  // dropped its header.
  if (!data.name && sourceText) {
    const src = parsePlainResume(sourceText);
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
      currentSection = { ...newSection(inferSectionType(heading), heading), items: [] };
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
        currentItem = { ...newEntry(), bullets: [] };
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
// Emits the format the scoring/diff/print consumers expect: name line,
// contact joined by " | ", ALL-CAPS section headings, conventional entry rows,
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

  // Plain-text consumers (Copy, scoring, diff, snapshots) get the
  // text without the internal inline formatting tags — those style only the
  // rendered surfaces (editor and Preview/PDF).
  return stripInlineMarks(lines.join("\n").replace(/\n{3,}/g, "\n\n").trim());
}
