// Page assembly: place the vertical stream onto US-Letter pages.
//
// Baseline rules used by the owned page builder:
//   - First baseline of a page: margin + max(minimum inset, the row's role-size
//     footprint) + any oversized-inline rise + authored paragraph before-space.
//     Short rows use the common inset; tall display rows push down.
//   - Subsequent lines: previous baseline + the stream's junction distance.
//   - A line whose baseline would exceed (page height − margin) moves to the
//     next page, dragging its keep-with-previous chain along — the editor's
//     keep-together policy keeps entry heads with their first bullet.

import type { GlyphRun } from "./types.ts";
import { buildVerticalStream, pageBox, pageGeometry, type VLine } from "./blocks.ts";
import { buildCoverLetterVerticalStream } from "./coverLetterBlocks.ts";
import type { CoverLetterDocumentStyle, DocumentStyle } from "../lib/documentStyle.ts";
import type { TypesetSchema } from "./schema.ts";
import { documentFontFamily, ensureFontMetrics, type DocumentFontFamily } from "./fontRegistry.ts";
import { segmentsFromInlineMarks } from "./measure.ts";
import { emptyFieldCarrier } from "../lib/inlineMarksText.ts";

export type PlacedLine = {
  runs: GlyphRun[]; // x absolute on the page (margin included)
  baseline: number; // y from the page top, bp
  // The line spacing this line owns (see VLine.leading), for renderers that
  // need the line BOX rather than the ink box.
  leading?: number;
  paragraphSpaceBefore?: number;
  paragraphSpaceAfter?: number;
  rule?: { x: number; width: number; y: number; thickness: number };
};

export type LayoutPage = { lines: PlacedLine[] };

export type LayoutDocument = {
  pages: LayoutPage[];
  // The page box both document kinds share. A resume's entry insets belong to
  // building its stream, not to the placed result, and nothing reads them here.
  geometry: ReturnType<typeof pageBox>;
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
  geo: ReturnType<typeof pageBox>
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
    first.riseOverflow +
    (first.paragraphSpaceBefore ?? 0);
  const contentBottom = (line: VLine, lineBaseline: number) =>
    lineBaseline +
    Math.max(
      line.depth + line.dropOverflow,
      line.rule ? line.rule.yOffset + line.rule.thickness : 0
    );
  // How many leading lines of `chain` fit the page when its first baseline is `first`.
  const fittingCount = (chain: VLine[], first: number) => {
    let b = first;
    for (let i = 0; i < chain.length; i += 1) {
      if (i > 0) b += junctionDistance(chain[i - 1], chain[i]);
      if (contentBottom(chain[i], b) > geo.lastBaselineMax) return i;
    }
    return chain.length;
  };
  const place = (chain: VLine[], first: number) => {
    const target = pages[pages.length - 1];
    let b = first;
    for (let i = 0; i < chain.length; i += 1) {
      if (i > 0) b += junctionDistance(chain[i - 1], chain[i]);
      const line = chain[i];
      target.lines.push({
        runs: line.runs.map((r) => ({ ...r, x: r.x + geo.marginLeft })),
        baseline: b,
        leading: line.leading,
        paragraphSpaceBefore: line.paragraphSpaceBefore,
        paragraphSpaceAfter: line.paragraphSpaceAfter,
        rule: line.rule
          ? { x: line.rule.x + geo.marginLeft, width: line.rule.width, y: b + line.rule.yOffset, thickness: line.rule.thickness }
          : undefined
      });
    }
    baseline = b;
    previousLine = chain[chain.length - 1] ?? null;
  };
  const newPage = () => {
    pages.push({ lines: [] });
    baseline = 0;
    previousLine = null;
  };
  const headingOnly = (line: VLine) =>
    line.runs.length > 0 && line.runs.every((run) => run.src?.kind === "heading");

  for (const chain of chains) {
    let rest = chain;
    while (rest.length) {
      const page = pages[pages.length - 1];
      const first = baseline === 0 || !previousLine
        ? startPage(rest[0])
        : baseline + junctionDistance(previousLine, rest[0]);
      const fits = fittingCount(rest, first);
      if (fits === rest.length) {
        place(rest, first);
        break;
      }
      // The chain overflows here. One that fits a fresh page moves there whole,
      // as a keep-chain should. One that cannot fit any page splits at its last
      // continuation boundary that still fits, so it fills this page first and
      // continues on the next instead of leaving the page half empty.
      const fitsFreshPage = page.lines.length > 0 && fittingCount(rest, startPage(rest[0])) === rest.length;
      if (!fitsFreshPage) {
        let split = 0;
        for (let i = 1; i <= fits && i < rest.length; i += 1) {
          if (!rest[i].emergencyBreakBefore) continue;
          // A part that is nothing but heading rows would strand the heading at
          // the page bottom; the chain moves to a fresh page instead.
          if (page.lines.length && rest.slice(0, i).every(headingOnly)) continue;
          split = i;
        }
        if (split > 0) {
          place(rest.slice(0, split), first);
          rest = rest.slice(split);
          newPage();
          continue;
        }
      }
      if (page.lines.length) {
        newPage();
        continue;
      }
      // An empty page and no boundary that fits: nothing more can be done
      // without shrinking or discarding text, so the content overflows.
      place(rest, first);
      break;
    }
  }
  return { pages, geometry: geo };
}

export function layoutResume(schema: TypesetSchema, style: DocumentStyle): LayoutDocument {
  const geo = pageGeometry(style);
  return layoutVerticalStream(buildVerticalStream(schema, style), geo);
}

// Every family a layout of `schema` measures with: the document font and each
// inline <font=…> override. Layout is synchronous, so a caller awaits
// `ensureLayoutMetrics` (these families and their glyph-fallback families) first.
export function layoutFamilies(schema: TypesetSchema, style: Pick<DocumentStyle, "fontFamily">): DocumentFontFamily[] {
  const families = new Set<DocumentFontFamily>([documentFontFamily(style.fontFamily)]);
  const texts = [schema.header?.name ?? "", ...(schema.header?.contact ?? [])];
  for (const section of schema.sections) {
    texts.push(section.heading);
    for (const item of section.items) {
      texts.push(item.titleLeft ?? "", item.titleRight ?? "", item.subtitleLeft ?? "", item.subtitleRight ?? "", ...item.bullets);
    }
  }
  for (const text of texts) {
    for (const segment of segmentsFromInlineMarks(text)) {
      if (segment.fontFamily) families.add(documentFontFamily(segment.fontFamily));
    }
    // An empty field has no segments, yet an empty header name is measured in
    // the family its stored carrier tags hold (blocks.ts `emptyFieldCarrier`).
    const carrier = emptyFieldCarrier(text).fontFamily;
    if (carrier) families.add(documentFontFamily(carrier));
  }
  return [...families];
}

export function ensureLayoutMetrics(schema: TypesetSchema, style: Pick<DocumentStyle, "fontFamily">): Promise<void> {
  return ensureFontMetrics(layoutFamilies(schema, style));
}

export function layoutCoverLetter(
  schema: TypesetSchema,
  style: CoverLetterDocumentStyle
): LayoutDocument {
  const geo = pageBox(style);
  return layoutVerticalStream(buildCoverLetterVerticalStream(schema, style), geo);
}
