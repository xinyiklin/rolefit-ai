// Text measurement for the typeset engine: TeX-faithful shaping over the
// committed Latin Modern tables (metrics.gen.ts). No browser, no runtime font
// parsing — identical results in the editor, on the server, and in tests.
//
// Shaping mirrors what TeX does with its TFM ligkern program for CM/LM:
//   1. text ligatures:  ---  →  —,   --  →  –,   '  →  ’   (input stays ASCII
//      in ResumeData; this is applied at measure/render time, matching the
//      display layer's texLigatures and the compiled PDF)
//   2. f-ligatures: longest-match ff/fi/fl/ffi/ffl → single ligature advance
//   3. pair kerning between adjacent glyphs (GPOS ≈ TFM kerns for LM)

import { LM_METRICS, type FaceName } from "./metrics.gen.ts";
import type { BoxItem, FontStyle, ForcedBreakItem, GlueItem, ParaItem, PenaltyItem } from "./types.ts";

export function faceFor(bold: boolean, italic: boolean): FaceName {
  if (bold && italic) return "boldItalic";
  if (bold) return "bold";
  if (italic) return "italic";
  return "regular";
}

// TeX text-mode ligatures (same table as the editor's display layer).
export function texLigatures(text: string): string {
  return text.replace(/---/g, "—").replace(/--/g, "–").replace(/'/g, "’");
}

const F_LIGATURES = ["ffi", "ffl", "ff", "fi", "fl"] as const;

// Advance width of an ALREADY-ligatured string in font units (1000/em).
function shapeUnits(text: string, face: FaceName): number {
  const m = LM_METRICS[face];
  let units = 0;
  let prev = "";
  let i = 0;
  while (i < text.length) {
    let matched = "";
    for (const lig of F_LIGATURES) {
      if (m.lig[lig] !== undefined && text.startsWith(lig, i)) {
        matched = lig;
        break;
      }
    }
    if (matched) {
      units += m.lig[matched];
      // TeX kerns into the ligature by its first letter (f).
      if (prev) units += m.kern[prev + matched[0]] ?? 0;
      prev = matched[matched.length - 1];
      i += matched.length;
      continue;
    }
    const ch = text[i];
    const adv = m.adv[ch];
    if (adv !== undefined) {
      units += adv;
      if (prev) units += m.kern[prev + ch] ?? 0;
      prev = ch;
    } else {
      // Unknown glyph: fall back to the average of x-height-ish letters so a
      // stray character degrades measurement instead of crashing it.
      units += 500;
      prev = "";
    }
    i += 1;
  }
  return units;
}

// Width in bp of a text fragment at a style. Applies TeX ligatures first.
export function measure(text: string, style: FontStyle): number {
  return (shapeUnits(texLigatures(text), style.face) / 1000) * style.size;
}

// Interword glue for a style — TeX fontdimen 2/3/4 for CM/LM: the font's space
// advance, stretching by half and shrinking by a third of it.
export function spaceGlue(style: FontStyle): GlueItem {
  const space = (LM_METRICS[style.face].adv[" "] / 1000) * style.size;
  return { kind: "glue", width: space, stretch: space / 2, shrink: space / 3 };
}

// TeX \exhyphenpenalty — the cost of breaking after an explicit hyphen.
export const EXHYPHEN_PENALTY = 50;

// \underline geometry (TeXbook): the rule hangs 3 × default_rule_thickness
// below the content's INK DEPTH (so a link with descenders gets a lower rule),
// and is 0.4 TeX pt thick. Verified against the Tectonic oracle: rule center =
// depth + 1.395bp at both \small and \normalsize (a constant, not
// font-scaled). `offset` is baseline → rule TOP edge, in bp. Consumed by both
// the DOM painter and the PDF backend so every surface hangs links identically.
const UNDERLINE_THICKNESS = 0.3985; // 0.4 TeX pt → bp
export function underlineRule(text: string, style: FontStyle): { offset: number; thickness: number } {
  return { offset: inkExtent(text, style).depth + 3 * UNDERLINE_THICKNESS, thickness: UNDERLINE_THICKNESS };
}

// Ink extents (bp above/below the baseline) of a fragment — TeX's height and
// depth for strut-less rows (title/subtitle solid leading).
export function inkExtent(text: string, style: FontStyle): { height: number; depth: number } {
  const m = LM_METRICS[style.face];
  let maxY = 0;
  let minY = 0;
  for (const ch of texLigatures(text)) {
    const b = m.bbox[ch];
    if (!b) continue;
    if (b[1] > maxY) maxY = b[1];
    if (b[0] < minY) minY = b[0];
  }
  return { height: (maxY / 1000) * style.size, depth: (-minY / 1000) * style.size };
}

// ---- Paragraph tokenization ----

type StyledSegment = { text: string; bold: boolean; italic: boolean };

// Split the resume's inline-marks form (`a <b>c</b> d`) into styled segments.
export function segmentsFromInlineMarks(value: string): StyledSegment[] {
  const out: StyledSegment[] = [];
  let bold = 0;
  let italic = 0;
  let cursor = 0;
  const re = /<\/?(?:b|i|u)>/gi;
  const push = (end: number) => {
    if (end > cursor) out.push({ text: value.slice(cursor, end), bold: bold > 0, italic: italic > 0 });
  };
  for (const match of value.matchAll(re)) {
    push(match.index);
    const tag = match[0].toLowerCase();
    if (tag === "<b>") bold += 1;
    else if (tag === "</b>") bold = Math.max(0, bold - 1);
    else if (tag === "<i>") italic += 1;
    else if (tag === "</i>") italic = Math.max(0, italic - 1);
    cursor = match.index + match[0].length;
  }
  push(value.length);
  return out;
}

// Build the box/glue/penalty item stream for one paragraph of inline-marked
// text at a size. Words split at explicit hyphens into fragments joined by
// \exhyphenpenalty break points, exactly as TeX sees them. Literal newlines are
// structural forced breaks rather than whitespace glue, preserving Shift+Enter
// intent through the shared DOM/PDF layout document.
export function paragraphItems(value: string, sizeBp: number): ParaItem[] {
  const items: ParaItem[] = [];
  const segments = segmentsFromInlineMarks(value);
  let pendingGlueStyle: FontStyle | null = null;

  for (const seg of segments) {
    const style: FontStyle = { face: faceFor(seg.bold, seg.italic), size: sizeBp };
    // Preserve leading/trailing space significance across segment boundaries.
    const parts = seg.text.split(/(\r\n|\r|\n|[^\S\r\n]+)/);
    for (const part of parts) {
      if (!part) continue;
      if (part === "\n" || part === "\r" || part === "\r\n") {
        // Spaces immediately before a hard break are discarded like trailing
        // line glue. A following horizontal-space run becomes leading glue and
        // is discarded by the line breaker in the same way.
        pendingGlueStyle = null;
        items.push({ kind: "forcedBreak" } satisfies ForcedBreakItem);
        continue;
      }
      if (/^\s+$/.test(part)) {
        pendingGlueStyle = style;
        continue;
      }
      if (pendingGlueStyle) {
        items.push(spaceGlue(pendingGlueStyle));
        pendingGlueStyle = null;
      }
      pushWord(items, part, style);
    }
  }
  return items;
}

// A word becomes one box, or — when it contains explicit hyphens with material
// on both sides — hyphen-terminated fragments separated by penalty items.
// CONTRACT: box/run text is stored in DISPLAY form (TeX ligatures applied:
// – — ’), matching its measured width — renderers draw it verbatim, never
// re-transform. texLigatures is idempotent, so measure() re-applying is safe.
function pushWord(items: ParaItem[], word: string, style: FontStyle) {
  const display = texLigatures(word);
  const pieces = display.split(/(?<=-)(?=[^-])/); // split AFTER each hyphen run
  for (let i = 0; i < pieces.length; i += 1) {
    if (i > 0) items.push({ kind: "penalty", penalty: EXHYPHEN_PENALTY } satisfies PenaltyItem);
    const text = pieces[i];
    items.push({ kind: "box", text, style, width: measure(text, style) } satisfies BoxItem);
  }
}
