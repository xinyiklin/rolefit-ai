// Core value types for the owned browser typesetting engine.
//
// UNITS: every length in this engine is a PDF point (bp, 1/72in), so the editor
// and browser print surfaces consume the same geometry without conversion.
// User-facing document controls also use PDF/DTP points.

import type { FaceName } from "./metrics.gen.ts";
import type { DocumentFontFamily } from "./fontRegistry.ts";
import type { FieldAlignment } from "../lib/inlineMarksText.ts";

export type FontStyle = {
  family: DocumentFontFamily;
  face: FaceName;
  size: number; // bp
  tracking: number; // extra space between glyphs, bp
};

// Which ResumeData field a run came from. Direct editing resolves a click on a
// painted run back to the structured field through these stable ids.
export type FieldSrc =
  | { kind: "name" }
  | { kind: "contact"; index: number }
  | { kind: "heading"; sectionId: string }
  | { kind: "entry"; sectionId: string; entryId: string; field: "titleLeft" | "titleRight" | "subtitleLeft" | "subtitleRight" }
  | { kind: "bullet"; sectionId: string; entryId: string; bulletId: string }
  | { kind: "skillsRow"; sectionId: string; entryId: string };

// Stable string form for DOM data-attributes and matching. Ids never contain
// "|" (uid() emits alphanumerics + separators of its own).
export function fieldKey(src: FieldSrc): string {
  switch (src.kind) {
    case "name":
      return "name";
    case "contact":
      return `contact|${src.index}`;
    case "heading":
      return `heading|${src.sectionId}`;
    case "entry":
      return `entry|${src.sectionId}|${src.entryId}|${src.field}`;
    case "bullet":
      return `bullet|${src.sectionId}|${src.entryId}|${src.bulletId}`;
    case "skillsRow":
      return `skillsRow|${src.sectionId}|${src.entryId}`;
  }
}

// Inverse of fieldKey for resolving clicked data-attributes during editing.
export function parseFieldKey(key: string): FieldSrc | null {
  const p = key.split("|");
  switch (p[0]) {
    case "name":
      return { kind: "name" };
    case "contact":
      return { kind: "contact", index: Number(p[1]) };
    case "heading":
      return p[1] ? { kind: "heading", sectionId: p[1] } : null;
    case "entry":
      return p[1] && p[2] && p[3]
        ? { kind: "entry", sectionId: p[1], entryId: p[2], field: p[3] as "titleLeft" | "titleRight" | "subtitleLeft" | "subtitleRight" }
        : null;
    case "bullet":
      return p[1] && p[2] && p[3] ? { kind: "bullet", sectionId: p[1], entryId: p[2], bulletId: p[3] } : null;
    case "skillsRow":
      return p[1] && p[2] ? { kind: "skillsRow", sectionId: p[1], entryId: p[2] } : null;
    default:
      return null;
  }
}

// A run of shaped text on one line: renderers draw `text` at (x, baseline y) in
// `style` and may trust `width` (advance sum, bp). `text` is in display form
// with punctuation transformations (– — ’) already applied.
export type GlyphRun = {
  text: string;
  style: FontStyle;
  x: number;
  width: number;
  // Linkified runs (contact items and URL-like metadata) use the shared engine
  // underline and carry this destination into the interactive renderer.
  href?: string;
  underline?: boolean;
  linkSuppressed?: boolean;
  // Field provenance for editing surfaces (absent on decorative runs).
  src?: FieldSrc;
  // Structural flag: this run is a bullet MARKER — it shares the bullet's src
  // (clicking it targets the bullet) but is not part of the bullet's text, so
  // the typeset editor's offset mapping must skip it.
  marker?: boolean;
};

// One typeset line of a paragraph: runs positioned relative to the paragraph's
// left edge; `width` is the natural (unset) content width for diagnostics.
export type Line = {
  runs: GlyphRun[];
  width: number;
};

// Same value space as the per-field alignment marks and the document's
// bodyAlign — one union, three layer-facing names.
export type ParagraphAlign = FieldAlignment;

// ---- Line-breaker input model: boxes, flexible spaces, and penalties ----

// An unbreakable fragment (word or piece of a hyphenated word).
export type BoxItem = {
  kind: "box";
  text: string;
  style: FontStyle;
  width: number;
  href?: string;
  underline?: boolean;
};

// Interword space with a stretch/shrink budget. For Latin Modern, stretch is
// space/2 and shrink is space/3.
export type GlueItem = {
  kind: "glue";
  width: number;
  stretch: number;
  shrink: number;
};

// A legal break point with a cost. Breaking after an explicit hyphen inside a
// word costs 50; ordinary interword breaks cost 0.
export type PenaltyItem = {
  kind: "penalty";
  penalty: number;
};

// An author-supplied line break (a literal `\n` in ResumeData). Unlike a
// penalty it is mandatory: the line breaker partitions at this boundary before
// optimizing either side, so no width or demerit can pull text across it.
export type ForcedBreakItem = {
  kind: "forcedBreak";
};

export type ParaItem = BoxItem | GlueItem | PenaltyItem | ForcedBreakItem;
