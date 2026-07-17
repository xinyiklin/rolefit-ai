// Page assembly: place the vertical stream onto US-Letter pages.
//
// Baseline rules used by the owned page builder:
//   - First baseline of a page: margin + max(minimum inset, line ink height).
//     Short lines use the common inset; tall display lines push down.
//   - Subsequent lines: previous baseline + the stream's junction distance.
//   - A line whose baseline would exceed (page height − margin) moves to the
//     next page, dragging its keep-with-previous chain along — the editor's
//     keep-together policy keeps entry heads with their first bullet.

import type { GlyphRun } from "./types.ts";
import { buildVerticalStream, pageGeometry, type VLine } from "./blocks.ts";
import type { DocumentStyle } from "../lib/documentStyle.ts";
import type { TypesetSchema } from "./schema.ts";

export type PlacedLine = {
  runs: GlyphRun[]; // x absolute on the page (margin included)
  baseline: number; // y from the page top, bp
  rule?: { x: number; width: number; y: number; thickness: number };
};

export type LayoutPage = { lines: PlacedLine[] };

export type LayoutDocument = {
  pages: LayoutPage[];
  geometry: ReturnType<typeof pageGeometry>;
};

export function layoutResume(schema: TypesetSchema, style: DocumentStyle): LayoutDocument {
  const geo = pageGeometry(style);
  const stream = buildVerticalStream(schema, style);

  // Split into keep-chains: a chain starts at a line with keepWithPrev=false.
  const chains: VLine[][] = [];
  for (const line of stream) {
    if (!line.keepWithPrev || !chains.length) chains.push([line]);
    else chains[chains.length - 1].push(line);
  }

  const pages: LayoutPage[] = [{ lines: [] }];
  let baseline = 0; // 0 = page top not yet started
  const startPage = (first: VLine) =>
    geo.marginTop + Math.max(geo.firstBaselineMin - geo.marginTop, first.height);
  const contentBottom = (line: VLine, lineBaseline: number) =>
    lineBaseline + Math.max(line.depth, line.rule ? line.rule.yOffset + line.rule.thickness : 0);

  for (const chain of chains) {
    // Tentative placement of the whole chain on the current page.
    const page = pages[pages.length - 1];
    let b = baseline === 0 ? startPage(chain[0]) : baseline + chain[0].dist;
    let fits = contentBottom(chain[0], b) <= geo.lastBaselineMax;
    if (fits) {
      let bb = b;
      for (let i = 1; i < chain.length && fits; i += 1) {
        bb += chain[i].dist;
        if (contentBottom(chain[i], bb) > geo.lastBaselineMax) fits = false;
      }
    }
    if (!fits && page.lines.length) {
      pages.push({ lines: [] });
      baseline = 0;
      b = startPage(chain[0]);
    }
    const target = pages[pages.length - 1];
    for (let i = 0; i < chain.length; i += 1) {
      if (i > 0) b += chain[i].dist;
      const line = chain[i];
      target.lines.push({
        runs: line.runs.map((r) => ({ ...r, x: r.x + geo.marginLeft })),
        baseline: b,
        rule: line.rule
          ? { x: line.rule.x + geo.marginLeft, width: line.rule.width, y: b + line.rule.yOffset, thickness: line.rule.thickness }
          : undefined
      });
    }
    baseline = b;
  }
  return { pages, geometry: geo };
}
