// Parse a plain-text resume (the human-readable format the AI produces) into a
// canonical schema for LaTeX rendering.
//
// Schema:
//   {
//     name: string,
//     contact: string[],
//     sections: [
//       {
//         heading: string,
//         items: [
//           {
//             title: string,
//             subtitle: string,
//             meta: string,        // typically dates
//             location: string,
//             bullets: string[],
//             raw?: string         // if no heading-like structure (e.g., Skills)
//           }
//         ]
//       }
//     ]
//   }
//
// The parser is heuristic. It detects:
//   - the first line as the name
//   - subsequent lines (before the first section header) as contact lines,
//     split on | • · , and similar separators
//   - SECTION HEADERS as short ALL-CAPS lines
//   - bullet lines (-, *, •, ◦, 1., etc.) attach to the most recent item
//   - non-bullet lines inside a section are interpreted as item headings,
//     split on | (or " — ") for title / subtitle / dates / location

import { isSummaryHeading } from "./util.ts";
// Section vocabulary + bullet glyphs come from the single source of truth shared
// with the client scorer/parser, so this server render path segments a pasted
// resume identically to the editor. (It's a plain .ts module both Node's native
// type stripping and the bundler import directly.)
import { BULLET_GLYPHS, isSectionHeader } from "../../src/resume/sections.ts";
// The LaTeX → plain-text extractor is the ONE shared implementation in
// src/lib/latexText.ts (imported directly by node and the bundler both). It used
// to be duplicated as a hand-port in src/lib/resumeData.ts; both now consume the
// shared module. Re-exported below so server/latex/index.ts (and thence
// server.ts) can keep importing extractPlainTextFromLatex from here.
import { extractPlainTextFromLatex } from "../../src/lib/latexText.ts";

// The canonical schema shape (matches the LaTeX template's ResumeSchema): a name,
// contact lines, and sections of item headings + bullets.
type ParsedItem = {
  title: string;
  subtitle: string;
  meta: string;
  location: string;
  bullets: string[];
};
type ParsedSection = { heading: string; items: ParsedItem[] };
type ParsedResume = { name: string; contact: string[]; sections: ParsedSection[] };

// The parser additionally accepts numbered lists ("1." / "1)") on top of the shared
// bullet glyphs.
const BULLET_RE = new RegExp(`^\\s*(?:[${BULLET_GLYPHS}]|\\d+[.)])\\s+`);
const HEADING_SPLIT_RE = /\s*[|•·]\s+/;
const CONTACT_SPLIT_RE = /\s*[|•·]\s+/;

function stripBullet(line: string): string {
  return line.replace(BULLET_RE, "").trim();
}

function parseItemHeading(line: string): ParsedItem {
  const trimmed = line.trim();
  // Handle "Title — Subtitle — Dates — Location" with em-dash or hyphen too
  const sepNormalized = trimmed.replace(/\s+[—–]\s+/g, " | ");
  const parts = sepNormalized.split(HEADING_SPLIT_RE).map((piece) => piece.trim()).filter(Boolean);

  return {
    title: parts[0] || "",
    subtitle: parts[1] || "",
    meta: parts[2] || "",
    location: parts[3] || "",
    bullets: []
  };
}

function parseContactLines(lines: string[]): string[] {
  if (!lines.length) return [];
  // Join all contact lines into one logical line, then split on separators.
  const joined = lines.join(" | ");
  return joined.split(CONTACT_SPLIT_RE).map((piece) => piece.trim()).filter(Boolean);
}

export function parseResumeText(text: string): ParsedResume {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim());

  // Find first non-empty line as name
  let i = 0;
  while (i < lines.length && !lines[i]) i += 1;

  let name = "";
  if (i < lines.length && !isSectionHeader(lines[i])) {
    name = lines[i] || "";
    i += 1;
  }

  // Collect contact lines until first section header (or first bullet)
  const contactBuffer: string[] = [];
  while (i < lines.length && !isSectionHeader(lines[i])) {
    if (lines[i]) contactBuffer.push(lines[i]);
    i += 1;
  }
  const contact = parseContactLines(contactBuffer);

  // Sections
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;
  let currentItem: ParsedItem | null = null;

  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;

    if (isSectionHeader(line)) {
      currentSection = { heading: line.trim().replace(/:$/, ""), items: [] };
      sections.push(currentSection);
      currentItem = null;
      continue;
    }

    if (!currentSection) {
      // Lines before any section — treat as additional contact entries
      contact.push(line);
      continue;
    }

    if (BULLET_RE.test(line)) {
      if (!currentItem) {
        currentItem = { title: "", subtitle: "", meta: "", location: "", bullets: [] };
        currentSection.items.push(currentItem);
      }
      currentItem.bullets.push(stripBullet(line));
      continue;
    }

    // Summary-style sections hold paragraphs, not item headings — never
    // pipe-split a paragraph into title/subtitle/meta slots.
    if (isSummaryHeading(currentSection.heading)) {
      if (!currentItem || currentItem.title) {
        currentItem = { title: "", subtitle: "", meta: "", location: "", bullets: [] };
        currentSection.items.push(currentItem);
      }
      currentItem.bullets.push(line);
      continue;
    }

    // Non-bullet, non-section-header line inside a section: new item heading
    currentItem = parseItemHeading(line);
    currentSection.items.push(currentItem);
  }

  return { name, contact, sections };
}

// Re-export the shared LaTeX plain-text extractor so existing importers of this
// module (server/latex/index.ts → server.ts, the tailor-quality eval) keep
// resolving extractPlainTextFromLatex from here without knowing it moved.
export { extractPlainTextFromLatex };
