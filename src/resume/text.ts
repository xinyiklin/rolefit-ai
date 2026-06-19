// Shared low-level text utilities used across keyword extraction, scoring,
// rewriting, and diffing. No domain tables live here — only generic string
// helpers depended on by two or more of those modules. Section/bullet vocabulary
// lives in the single source of truth ./sections.mjs (shared with the editor +
// server parsers); the re-exports below keep existing importers unchanged.
import { BULLET_GLYPHS, isTopLevelSectionHeader, normalize } from "./sections.mjs";

export const hasMetric = (text: string) =>
  /(\$\s?\d+|\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*(?:percent|x|k|m|tb|gb|mb)\b|\d+\+|\d+(?:\.\d+)?\s+(?:\w+\s+){0,2}(?:users?|requests?|records?|models?|endpoints?|apps?|patients?|facilities?|hours?|days?|weeks?|months?|ms|milliseconds?|seconds?|minutes?)\b)/i.test(text);
// Bullet detection uses the shared glyph set (./sections.mjs). The trailing \s+ is
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
// Single source of truth: ./sections.mjs (shared with the editor + server parsers).
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

export const titleCase = (text: string) =>
  text
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (["api", "apis", "css", "html", "sql"].includes(word)) return word.toUpperCase();
      if (word === "javascript") return "JavaScript";
      if (word === "node.js") return "Node.js";
      if (word === "postgresql") return "PostgreSQL";
      if (word === "react") return "React";
      if (word === "rest") return "REST";
      if (word === "typescript") return "TypeScript";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");

export const unique = (items: string[]) => Array.from(new Set(items));
export const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
