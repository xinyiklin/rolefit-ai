// Core value types for the owned typesetting engine (D013).
//
// UNITS: every length in this engine is PDF points (bp, 1/72in) — the unit the
// compiled page actually uses — so engine output can be diffed against pdf.js
// baselines with no conversion. TeX-pt sizes are pre-multiplied by 72/72.27
// (e.g. \small 10pt → 9.963bp), matching the committed truth fixtures.

import type { FaceName } from "./metrics.gen.ts";

// The font sizes of the 11pt article class, in PDF points (nominal × 0.99626).
export const FONT_SIZES_BP = {
  tiny: 5.977,
  small: 9.963,
  normalsize: 10.909,
  large: 11.955,
  Large: 17.215,
  LARGE: 20.663,
  Huge: 24.787
} as const;

export type FontStyle = {
  face: FaceName;
  size: number; // bp
};

// Which ResumeData field a run came from — Exact-mode editing resolves a click
// on a painted run back to the editable field through this. Ids are the
// ResumeData ids carried through toTemplateSchema.
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

// Inverse of fieldKey (Exact mode resolves clicked data-attributes back).
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

// A run of shaped text on one line: the renderer/PDF backend draws `text` at
// (x, baseline y) in `style` and may trust `width` (advance sum, bp).
// `text` is in DISPLAY form — TeX ligatures (– — ’) already applied and
// consistent with `width`; renderers draw it verbatim.
export type GlyphRun = {
  text: string;
  style: FontStyle;
  x: number;
  width: number;
  // Linkified runs (contact items, URL-ish metas): renderers underline them
  // like the template's \href{\underline{…}}, and the PDF backend attaches a
  // link annotation with this destination.
  href?: string;
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

export type ParagraphAlign = "left" | "justify" | "center" | "right";

// ---- Line-breaker input model (TeX's box/glue/penalty) ----

// An unbreakable fragment (word or piece of a hyphenated word).
export type BoxItem = {
  kind: "box";
  text: string;
  style: FontStyle;
  width: number;
};

// Interword space: width plus stretch/shrink budget (TeX fontdimen 2/3/4 —
// for Latin Modern: stretch = space/2, shrink = space/3).
export type GlueItem = {
  kind: "glue";
  width: number;
  stretch: number;
  shrink: number;
};

// A legal break point with a cost. Breaking after an explicit hyphen inside a
// word is penalty 50 (TeX \exhyphenpenalty); glue breaks carry penalty 0.
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
