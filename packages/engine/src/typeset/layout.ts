// Page assembly: place the vertical stream onto US-Letter pages.
//
// Baseline rules used by the owned page builder:
//   - First baseline of a page: margin + max(minimum inset, the row's own ink
//     height) + any oversized-inline rise. Short rows use the common inset;
//     tall display rows push down.
//   - Subsequent lines: previous baseline + the stream's junction distance.
//   - A line whose baseline would exceed (page height − margin) moves to the
//     next page, dragging its keep-with-previous chain along — the editor's
//     keep-together policy keeps entry heads with their first bullet.

import { fieldKey, type GlyphRun } from "./types.ts";
import { buildVerticalStream, pageGeometry, type VLine } from "./blocks.ts";
import { buildCoverLetterVerticalStream } from "./coverLetterBlocks.ts";
import type { DocumentStyle } from "../lib/documentStyle.ts";
import type { TypesetSchema } from "./schema.ts";

export type PlacedLine = {
  runs: GlyphRun[]; // x absolute on the page (margin included)
  baseline: number; // y from the page top, bp
  // The line spacing this line owns (see VLine.leading), for renderers that
  // need the line BOX rather than the ink box.
  leading?: number;
  rule?: { x: number; width: number; y: number; thickness: number };
};

export type LayoutPage = { lines: PlacedLine[] };

export type LayoutDocument = {
  pages: LayoutPage[];
  geometry: ReturnType<typeof pageGeometry>;
};

// Baseline distance for one junction: the stream's calibrated distance plus the
// room an oversized inline run on either side needs. Both overflow terms come
// from face boxes, so editing the characters inside a line never changes where
// the next line sits — the word-processor rule the calibrated distances assume.
function junctionDistance(previous: VLine, current: VLine): number {
  return current.dist + (previous.afterDist ?? 0) + previous.dropOverflow + current.riseOverflow;
}

export function layoutVerticalStream(
  stream: VLine[],
  geo: ReturnType<typeof pageGeometry>
): LayoutDocument {
  // Split into keep-chains: a chain starts at a line with keepWithPrev=false.
  const chains: VLine[][] = [];
  for (const line of stream) {
    if (!line.keepWithPrev || !chains.length) chains.push([line]);
    else chains[chains.length - 1].push(line);
  }

  const pages: LayoutPage[] = [{ lines: [] }];
  let baseline = 0; // 0 = page top not yet started
  let previousLine: VLine | null = null;
  const startPage = (first: VLine) =>
    geo.marginTop +
    Math.max(geo.firstBaselineMin - geo.marginTop, first.height) +
    first.riseOverflow;
  const contentBottom = (line: VLine, lineBaseline: number) =>
    lineBaseline +
    Math.max(
      line.depth + line.dropOverflow,
      line.rule ? line.rule.yOffset + line.rule.thickness : 0
    );

  for (const chain of chains) {
    // Tentative placement of the whole chain on the current page.
    const page = pages[pages.length - 1];
    let b =
      baseline === 0 || !previousLine
        ? startPage(chain[0])
        : baseline + junctionDistance(previousLine, chain[0]);
    let fits = contentBottom(chain[0], b) <= geo.lastBaselineMax;
    if (fits) {
      let bb = b;
      for (let i = 1; i < chain.length && fits; i += 1) {
        bb += junctionDistance(chain[i - 1], chain[i]);
        if (contentBottom(chain[i], bb) > geo.lastBaselineMax) fits = false;
      }
    }
    if (!fits && page.lines.length) {
      pages.push({ lines: [] });
      baseline = 0;
      previousLine = null;
      b = startPage(chain[0]);
    }
    const target = pages[pages.length - 1];
    for (let i = 0; i < chain.length; i += 1) {
      if (i > 0) b += junctionDistance(chain[i - 1], chain[i]);
      const line = chain[i];
      target.lines.push({
        runs: line.runs.map((r) => ({ ...r, x: r.x + geo.marginLeft })),
        baseline: b,
        leading: line.leading,
        rule: line.rule
          ? { x: line.rule.x + geo.marginLeft, width: line.rule.width, y: b + line.rule.yOffset, thickness: line.rule.thickness }
          : undefined
      });
    }
    baseline = b;
    previousLine = chain[chain.length - 1] ?? null;
  }
  return { pages, geometry: geo };
}

// Line separation is LAYOUT here, not text: a break consumes the interword glue
// and each line becomes its own block, so nothing in the DOM separates the last
// word of one line from the first word of the next. The browser's word iterator
// then runs them together — a double-click at the end of a line also selected the
// first word of the following line — and any DOM-derived text (find-in-page, a
// native copy) loses the gap. Each line therefore ends with the separator its
// break stood for: a space inside one field, a newline between fields.
//
// The line box sets font-size 0, so this is invisible and zero-width, and it is
// contentEditable=false so the browser steps over it. It carries data-tsds so the
// editor's own caret/selection helpers exclude it too: it belongs to no field, and
// a caret parked in it could not be mapped or typed into.
// What a line break stands for in TEXT. A break consumes the interword glue and
// each painted line becomes its own box, so nothing separates the last word of a
// line from the first word of the next: a renderer that emits no separator lets
// the browser's word iterator run them together (a double-click at a line end
// also took the next line's first word) and loses the gap in any text derived
// from the painted output.
//
// A break inside one field stands for a space, and crossing into another field
// for a newline; the last line has none. This drives word segmentation and
// text extraction only — an authored hard break therefore also reads as a space
// here, which is harmless because both clipboard paths slice the model's display
// string, where the authored newline is a real character.
export function lineSeparators(pages: readonly LayoutPage[]): string[][] {
  const lines = pages.flatMap((page) => page.lines);
  const keyOf = (run: GlyphRun | undefined) => (run?.src ? fieldKey(run.src) : null);
  const all = lines.map((line, index) => {
    const next = lines[index + 1];
    if (!next) return "";
    const from = keyOf([...line.runs].reverse().find((run) => run.src));
    const to = keyOf(next.runs.find((run) => run.src));
    return from && to && from === to ? " " : "\n";
  });
  let cursor = 0;
  return pages.map((page) => {
    const slice = all.slice(cursor, cursor + page.lines.length);
    cursor += page.lines.length;
    return slice;
  });
}

export function layoutResume(schema: TypesetSchema, style: DocumentStyle): LayoutDocument {
  const geo = pageGeometry(style);
  return layoutVerticalStream(buildVerticalStream(schema, style), geo);
}

export function layoutCoverLetter(schema: TypesetSchema, style: DocumentStyle): LayoutDocument {
  const geo = pageGeometry(style);
  return layoutVerticalStream(buildCoverLetterVerticalStream(schema, style), geo);
}
