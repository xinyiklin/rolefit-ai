// Deterministic text measurement for the browser typesetting engine over the
// committed per-family tables in metrics.gen.ts. No runtime font parsing means
// the editor, print layout, and tests use identical advances.
//
// Shaping stages:
//   1. display punctuation: --- → —, -- → –, ' → ’ (ResumeData stays ASCII;
//      transformation happens during measurement and painting)
//   2. f-ligatures: longest-match ff/fi/fl/ffi/ffl → single ligature advance
//   3. pair kerning between adjacent glyphs from the committed font tables

import { fontFace, type DocumentFontFamily } from "./fontRegistry.ts";
import type { FaceName } from "./metrics.gen.ts";
import type {
  BoxItem,
  FontStyle,
  ForcedBreakItem,
  GlueItem,
  GlyphRun,
  ParaItem,
  PenaltyItem
} from "./types.ts";
import {
  INLINE_MARK_TAG_PATTERN,
  isInlineFontSizePt,
  paragraphLineHeight
} from "../lib/inlineMarksText.ts";
import { automaticLinkHref, decodeLinkHref } from "../lib/links.ts";

// Module-local instance of the shared grammar (match[1] is the <link=…>
// destination); only used via matchAll, which never mutates lastIndex.
const INLINE_TAG_RE = new RegExp(INLINE_MARK_TAG_PATTERN, "gi");

export function faceFor(bold: boolean, italic: boolean): FaceName {
  if (bold && italic) return "boldItalic";
  if (bold) return "bold";
  if (italic) return "italic";
  return "regular";
}

// Display punctuation transformations shared by measurement and painting.
export function texLigatures(text: string): string {
  return text.replace(/---/g, "—").replace(/--/g, "–").replace(/'/g, "’");
}

const F_LIGATURES = ["ffi", "ffl", "ff", "fi", "fl"] as const;

// Advance width of an ALREADY-ligatured string in font units (1000/em).
function shapeUnits(text: string, style: FontStyle): { units: number; glyphs: number } {
  const m = fontFace(style.family, style.face).metrics;
  let units = 0;
  let glyphs = 0;
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
      glyphs += 1;
      // Pair kerning enters the ligature through its first letter (f).
      if (prev) units += m.kern[prev + matched[0]] ?? 0;
      prev = matched[matched.length - 1];
      i += matched.length;
      continue;
    }
    const ch = text[i];
    const adv = m.adv[ch];
    if (adv !== undefined) {
      units += adv;
      glyphs += 1;
      if (prev) units += m.kern[prev + ch] ?? 0;
      prev = ch;
    } else {
      // Unknown glyph: fall back to the average of x-height-ish letters so a
      // stray character degrades measurement instead of crashing it.
      units += 500;
      glyphs += 1;
      prev = "";
    }
    i += 1;
  }
  return { units, glyphs };
}

// Width in bp of a text fragment at a style. Applies display punctuation first.
export function measure(text: string, style: FontStyle): number {
  const shaped = shapeUnits(texLigatures(text), style);
  return (shaped.units / 1000) * style.size + Math.max(0, shaped.glyphs - 1) * style.tracking;
}

// A real interword gap has two tracking boundaries: last glyph → space and
// space → next glyph. Keeping that in the glue width makes engine positioning
// match a DOM span rendered with CSS letter-spacing.
export function spaceWidth(style: FontStyle): number {
  const metrics = fontFace(style.family, style.face).metrics;
  return (metrics.adv[" "] / 1000) * style.size + 2 * style.tracking;
}

// Flexible interword space can stretch by half and shrink by a third.
export function spaceGlue(style: FontStyle): GlueItem {
  const space = spaceWidth(style);
  return { kind: "glue", width: space, stretch: space / 2, shrink: space / 3 };
}

// Cost of breaking after an explicit hyphen.
export const EXHYPHEN_PENALTY = 50;

// Underline geometry: the rule hangs three rule-thicknesses below the FACE's
// descender reach, not below the typed glyphs. A per-text depth made the rule
// jump between two links in one paragraph, and it disagreed between the DOM
// painter (which measures a merged style span) and the PDF emitter (which
// measures each engine run), so one underline could step mid-link on paper but
// not on screen. `offset` is the distance from baseline to the rule's top edge
// in bp. The DOM editor, print layer, and PDF share this calculation.
const UNDERLINE_THICKNESS = 0.3985; // calibrated rule thickness in bp
const UNDERLINE_DESCENDERS = "gjpqy";
export function underlineRule(style: FontStyle): { offset: number; thickness: number } {
  return {
    offset: inkExtent(UNDERLINE_DESCENDERS, style).depth + 3 * UNDERLINE_THICKNESS,
    thickness: UNDERLINE_THICKNESS
  };
}

// The face's own vertical box in bp above and below the baseline. Unlike
// inkExtent this ignores which glyphs a run holds, so a row's box depends only
// on the fonts and sizes on it. Vertical placement uses this instead of typed
// ink wherever a word processor would keep spacing stable: pressing a key must
// never move the line because the new letter is taller or deeper than the old.
export function faceExtent(style: FontStyle): { height: number; depth: number } {
  const m = fontFace(style.family, style.face).metrics;
  return { height: (m.ascent / 1000) * style.size, depth: (-m.descent / 1000) * style.size };
}

// Ink extents in bp above and below the baseline for strut-less rows.
export function inkExtent(text: string, style: FontStyle): { height: number; depth: number } {
  const m = fontFace(style.family, style.face).metrics;
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

// One continuous underline rule on a line. Engine runs are WORD boxes, so a
// renderer that draws a rule per run leaves every interior space bare — the PDF
// used to break an underlined phrase into one rule per word while the editor,
// which paints merged style spans, showed a single rule. Word processors draw
// through interior spaces, so both renderers group runs here instead. A change of
// face, size, or link target ends the span, because the rule's depth changes
// with it.
export type UnderlineSpan = { x: number; width: number; style: FontStyle };

export function underlineSpans(runs: readonly GlyphRun[]): UnderlineSpan[] {
  const spans: UnderlineSpan[] = [];
  let open: { x: number; end: number; style: FontStyle; href?: string } | null = null;
  const close = () => {
    if (open && open.end > open.x) spans.push({ x: open.x, width: open.end - open.x, style: open.style });
    open = null;
  };
  for (const run of runs) {
    if (!run.href && !run.underline) {
      close();
      continue;
    }
    const gap = open ? run.x - open.end : 0;
    const joinable =
      open !== null &&
      open.href === run.href &&
      open.style.family === run.style.family &&
      open.style.face === run.style.face &&
      open.style.size === run.style.size &&
      open.style.tracking === run.style.tracking &&
      // Only a real interword gap joins. Anything wider is layout, not a space.
      gap >= -0.05 &&
      gap <= spaceWidth(run.style) * 1.75;
    if (joinable && open) open.end = run.x + run.width;
    else {
      close();
      open = { x: run.x, end: run.x + run.width, style: run.style, href: run.href };
    }
  }
  close();
  return spans;
}

// ---- Paragraph tokenization ----

type StyledSegment = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontFamily: DocumentFontFamily | null;
  fontSizePt: number | null;
  lineHeight: number | null;
  href: string | null;
  linkSuppressed: boolean;
};

// Split the resume's inline-marks form (`a <b>c</b> d`) into styled segments.
export function segmentsFromInlineMarks(value: string): StyledSegment[] {
  const out: StyledSegment[] = [];
  let bold = 0;
  let italic = 0;
  let underline = 0;
  const fontStack: DocumentFontFamily[] = [];
  const sizeStack: number[] = [];
  const lineHeightStack: number[] = [];
  const linkStack: Array<string | null> = [];
  let suppressed = 0;
  let cursor = 0;
  const push = (end: number) => {
    if (end > cursor) {
      out.push({
        text: value.slice(cursor, end),
        bold: bold > 0,
        italic: italic > 0,
        underline: underline > 0,
        fontFamily: fontStack[fontStack.length - 1] ?? null,
        fontSizePt: sizeStack[sizeStack.length - 1] ?? null,
        lineHeight: lineHeightStack[lineHeightStack.length - 1] ?? null,
        href: linkStack[linkStack.length - 1] ?? null,
        linkSuppressed: suppressed > 0
      });
    }
  };
  for (const match of value.matchAll(INLINE_TAG_RE)) {
    push(match.index);
    const tag = match[0].toLowerCase();
    if (tag === "<b>") bold += 1;
    else if (tag === "</b>") bold = Math.max(0, bold - 1);
    else if (tag === "<i>") italic += 1;
    else if (tag === "</i>") italic = Math.max(0, italic - 1);
    else if (tag === "<u>") underline += 1;
    else if (tag === "</u>") underline = Math.max(0, underline - 1);
    else if (tag.startsWith("<font=")) fontStack.push(tag.slice(6, -1) as DocumentFontFamily);
    else if (tag === "</font>") fontStack.pop();
    else if (tag.startsWith("<size=")) {
      const size = Number(tag.slice(6, -1));
      if (isInlineFontSizePt(size)) sizeStack.push(size);
    } else if (tag === "</size>") sizeStack.pop();
    else if (tag.startsWith("<line-height=")) {
      lineHeightStack.push(paragraphLineHeight(Number(tag.slice(13, -1))));
    } else if (tag === "</line-height>") lineHeightStack.pop();
    else if (tag.startsWith("<link=")) linkStack.push(decodeLinkHref(match[1]));
    else if (tag === "</link>") linkStack.pop();
    else if (tag === "<nolink>") suppressed += 1;
    else if (tag === "</nolink>") suppressed = Math.max(0, suppressed - 1);
    cursor = match.index + match[0].length;
  }
  push(value.length);
  return out;
}

// Build the box/glue/penalty item stream for one paragraph of inline-marked
// text at a size. Words split at explicit hyphens into fragments joined by
// weighted break points. Literal newlines become structural forced breaks,
// preserving Shift+Enter intent through the shared editor/print layout.
export function paragraphItems(
  value: string,
  sizeBp: number,
  family: DocumentFontFamily,
  tracking: number
): ParaItem[] {
  const items: ParaItem[] = [];
  const segments = segmentsFromInlineMarks(value);
  // Word-processor whitespace: a run of N spaces BETWEEN two words on a line is
  // N−1 literal space glyphs (a box that trails the previous word) plus ONE
  // interword glue (the sole break opportunity, and the Nth rendered space).
  // The DOM painter then merges the literal spaces into the word run and adds a
  // single space for the glue gap, so N spaces survive with no other engine
  // change. This mirrors buildDisplayMap's word-processor preserve mode:
  // authored leading, interior, trailing, and hard-break-adjacent spaces all
  // remain caret-bearing glyphs.
  let pending: { style: FontStyle; count: number; lineHeight: number | null } | null = null;
  let hasPrecedingBox = false; // a real word already sits on the current line
  const spaceBox = (n: number, style: FontStyle, lineHeight: number | null) => {
    if (n <= 0) return;
    const text = " ".repeat(n);
    // Match pushWord's default box shape (href undefined, underline false) so the
    // space glyphs merge into the adjacent word run in setLine/groupRuns instead
    // of splintering into their own spans.
    items.push({
      kind: "box",
      text,
      style,
      width: measure(text, style),
      lineHeight: lineHeight ?? undefined,
      underline: false
    } satisfies BoxItem);
  };

  for (const seg of segments) {
    const style: FontStyle = {
      family: seg.fontFamily ?? family,
      face: faceFor(seg.bold, seg.italic),
      size: seg.fontSizePt ?? sizeBp,
      tracking
    };
    // Preserve leading/trailing space significance across segment boundaries.
    const parts = seg.text.split(/(\r\n|\r|\n|[^\S\r\n]+)/);
    for (const part of parts) {
      if (!part) continue;
      if (part === "\n" || part === "\r" || part === "\r\n") {
        // A hard break is structural, but authored spaces before it remain
        // literal glyphs so the engine and editor caret map stay identical.
        if (pending) {
          spaceBox(pending.count, pending.style, pending.lineHeight);
          pending = null;
        }
        items.push({ kind: "forcedBreak" } satisfies ForcedBreakItem);
        hasPrecedingBox = false;
        continue;
      }
      if (/^\s+$/.test(part)) {
        // Accumulate consecutive whitespace, even across a tag boundary.
        if (pending) pending.count += part.length;
        else pending = { style, count: part.length, lineHeight: seg.lineHeight };
        continue;
      }
      if (pending) {
        if (hasPrecedingBox) {
          // Interior run: N−1 literal spaces after the previous word, then one
          // break-opportunity glue that renders the Nth space.
          spaceBox(pending.count - 1, pending.style, pending.lineHeight);
          items.push(spaceGlue(pending.style));
        } else {
          // Authored line-leading spaces (including a Tab insertion represented
          // as four spaces) are fixed glyphs, not discardable glue.
          spaceBox(pending.count, pending.style, pending.lineHeight);
        }
        pending = null;
      }
      pushWord(
        items,
        part,
        style,
        seg.linkSuppressed ? undefined : seg.href ?? automaticLinkHref(part) ?? undefined,
        seg.underline,
        seg.lineHeight
      );
      hasPrecedingBox = true;
    }
  }
  // Trailing spaces at the paragraph's end are kept in full so the caret can sit
  // after them (buildDisplayMap keeps them too when preserving whitespace).
  if (pending && hasPrecedingBox) spaceBox(pending.count, pending.style, pending.lineHeight);
  return items;
}

// A word becomes one box, or — when it contains explicit hyphens with material
// on both sides — hyphen-terminated fragments separated by penalty items.
// CONTRACT: box/run text is stored in display form (– — ’), matching its
// measured width. Renderers draw it verbatim and never re-transform it;
// texLigatures is idempotent, so measure() re-applying it is safe.
function pushWord(
  items: ParaItem[],
  word: string,
  style: FontStyle,
  href?: string,
  underline = false,
  lineHeight: number | null = null
) {
  const display = texLigatures(word);
  const pieces = display.split(/(?<=-)(?=[^-])/); // split AFTER each hyphen run
  for (let i = 0; i < pieces.length; i += 1) {
    if (i > 0) items.push({ kind: "penalty", penalty: EXHYPHEN_PENALTY } satisfies PenaltyItem);
    const text = pieces[i];
    items.push({
      kind: "box",
      text,
      style,
      width: measure(text, style),
      lineHeight: lineHeight ?? undefined,
      href,
      underline
    } satisfies BoxItem);
  }
}
