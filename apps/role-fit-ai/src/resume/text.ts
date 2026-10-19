// Shared low-level text utilities used across keyword extraction, scoring,
// rewriting, and diffing. No domain tables live here — only generic string
// helpers depended on by two or more of those modules. Section/bullet vocabulary
// lives in the single source of truth ./sections.ts (shared with the editor +
// server parsers); the re-exports below keep existing importers unchanged.
import { BULLET_GLYPHS, isTopLevelSectionHeader, normalize } from "./sections.ts";

// Bullet detection uses the shared glyph set (./sections.ts). The trailing \s+ is
// required, so a glyph inside text or a "2020-2023" date span is never a bullet.
const BULLET_RE = new RegExp(`^\\s*[${BULLET_GLYPHS}]\\s+`);
export const isBullet = (line: string) => BULLET_RE.test(line);
export const stripBullet = (line: string) => line.replace(BULLET_RE, "").trim();
// Single source: the same normalization the section matchers use, so label-matching
// (sectionName) and boundary detection (isKnownSection) can never disagree.
export const sectionName = normalize;
export const isContactLine = (line: string) => /@|https?:\/\/|github\.com|linkedin\.com|\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/i.test(line);
// A known TOP-LEVEL section header — the boundary detector for the education
// date-shield (scoring.ts) and the polisher's section-removal walk (rewrite.ts).
// Single source of truth: ./sections.ts (shared with the editor + server parsers).
export const isKnownSection = isTopLevelSectionHeader;

export function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/\bpostgre\s*sql\b/g, "postgresql")
    .replace(/\bnodejs\b/g, "node.js")
    .replace(/\breactjs\b/g, "react")
    .replace(/\brestful\b/g, "rest")
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const unique = (items: string[]) => Array.from(new Set(items));
