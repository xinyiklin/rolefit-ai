// Groups positioned PDF spans into reading-order lines: one column gutter per
// page at most, baseline clustering, bullet markers, and segments split at
// tab-stop-sized gaps (right-aligned dates, contact runs).

import { INLINE_MARK_TAG_PATTERN } from "@typeset/engine/lib/inlineMarksText.ts";
import { BULLET_GLYPHS, isSectionHeader } from "../sections.ts";
import type { PdfLayout, PdfSpan } from "./pdfLayout.ts";
import { hasDate } from "./rowDates.ts";

// A character range of one span. Every imported field is built from pieces, so
// any text can be traced back to the exact span it came from.
export type LinePiece = {
  span: PdfSpan;
  start: number;
  end: number;
  text: string;
  x: number;
  right: number;
  spaceBefore: boolean;
  spaceAfter: boolean;
};

export type LineRegion = "main" | "top" | "left" | "right";

export type LayoutLine = {
  index: number;
  page: number;
  region: LineRegion;
  y: number;
  x: number;
  right: number;
  size: number;
  font: string;
  marker: LinePiece | null;
  segments: LinePiece[][];
  text: string;
  bold: boolean;
  italic: boolean;
  caps: boolean;
  smallCaps: boolean;
  regionLeft: number;
  regionRight: number;
  // Baseline distance from the previous line in the same page region.
  gapAbove: number | null;
};

export type ExcludedPiece = { piece: LinePiece; reason: string };

export type LayoutLines = {
  lines: LayoutLine[];
  excluded: ExcludedPiece[];
  bodySize: number;
};

const TAG_RE = new RegExp(INLINE_MARK_TAG_PATTERN, "i");
const TAG_REASON = "Looks like editor formatting code, so it was left out.";
const MARKER_CHARS = new Set([...BULLET_GLYPHS]);
const PRIVATE_USE_RE = /^[\uE000-\uF8FF]$/u;

// A whitespace-trimmed character range of one span.
export function slicePiece(span: PdfSpan, from: number, to: number): LinePiece {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(span.text[start])) start += 1;
  while (end > start && /\s/.test(span.text[end - 1])) end -= 1;
  const length = span.text.length || 1;
  return {
    span,
    start,
    end,
    text: span.text.slice(start, end),
    x: span.x + (span.width * start) / length,
    right: span.x + (span.width * end) / length,
    spaceBefore: start > 0 && /\s/.test(span.text[start - 1]),
    spaceAfter: end < span.text.length && /\s/.test(span.text[end])
  };
}

// One span's trimmed text, split wherever it holds a tab or a run of three or
// more spaces (text aligned with spaces rather than positioning).
function spanPieces(span: PdfSpan): LinePiece[] {
  const pieces: LinePiece[] = [];
  const re = /\S+(?:(?: {1,2})\S+)*/g;
  for (let match = re.exec(span.text); match; match = re.exec(span.text)) {
    pieces.push(slicePiece(span, match.index, match.index + match[0].length));
  }
  return pieces;
}

export function needsSpace(previous: LinePiece, next: LinePiece): boolean {
  if (previous.span === next.span && previous.end === next.start) return false;
  if (previous.spaceAfter || next.spaceBefore) return true;
  return next.x - previous.right > 0.12 * Math.min(previous.span.size, next.span.size);
}

export function joinPieces(pieces: readonly LinePiece[]): string {
  let text = "";
  pieces.forEach((current, index) => {
    if (index > 0 && needsSpace(pieces[index - 1], current)) text += " ";
    text += current.text;
  });
  return text.replace(/\s+/g, " ").trim();
}

function isMarkerText(text: string, span: PdfSpan): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (span.dingbat) return trimmed.length <= 2;
  return [...trimmed].length === 1 && (MARKER_CHARS.has(trimmed) || PRIVATE_USE_RE.test(trimmed));
}

function dominant<T>(pieces: readonly LinePiece[], key: (piece: LinePiece) => T): T {
  const weights = new Map<T, number>();
  for (const current of pieces) weights.set(key(current), (weights.get(key(current)) ?? 0) + current.text.length);
  return [...weights.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

type Gutter = { x0: number; x1: number; yCut: number };

// Finds a vertical band that no span below `yCut` crosses, with real columns on
// both sides. Right-aligned dates never qualify: bullets cross the band, and a
// right "column" must share a left edge, which ragged dates do not.
function findGutter(spans: readonly PdfSpan[], pageWidth: number): Gutter | null {
  const content = spans.filter((span) => span.text.trim() && !span.dingbat);
  const totalChars = content.reduce((sum, span) => sum + span.text.length, 0);
  if (content.length < 12 || totalChars === 0) return null;
  const lo = Math.floor(pageWidth * 0.2);
  const hi = Math.ceil(pageWidth * 0.8);
  const lowestCrossing = new Array<number>(hi - lo).fill(-Infinity);
  for (const span of content) {
    for (let x = Math.max(lo, Math.floor(span.x)); x < Math.min(hi, Math.ceil(span.x + span.width)); x += 1) {
      lowestCrossing[x - lo] = Math.max(lowestCrossing[x - lo], span.y);
    }
  }
  const cuts = [...new Set(lowestCrossing)].sort((a, b) => a - b);
  for (const yCut of cuts) {
    let best: [number, number] | null = null;
    let runStart = -1;
    for (let i = 0; i <= lowestCrossing.length; i += 1) {
      const open = i < lowestCrossing.length && lowestCrossing[i] <= yCut;
      if (open && runStart < 0) runStart = i;
      if (!open && runStart >= 0) {
        if (!best || i - runStart > best[1] - best[0]) best = [runStart, i];
        runStart = -1;
      }
    }
    if (!best || best[1] - best[0] < 10) continue;
    const x0 = lo + best[0];
    const x1 = lo + best[1];
    const below = content.filter((span) => span.y > yCut);
    const belowChars = below.reduce((sum, span) => sum + span.text.length, 0);
    if (belowChars < totalChars * 0.6) break;
    const left = below.filter((span) => span.x + span.width <= x0);
    const right = below.filter((span) => span.x >= x1);
    const leftChars = left.reduce((sum, span) => sum + span.text.length, 0);
    const rightChars = right.reduce((sum, span) => sum + span.text.length, 0);
    if (leftChars < belowChars * 0.15 || rightChars < belowChars * 0.15) continue;
    const rightLines = new Map<number, { start: number; end: number; spans: PdfSpan[] }>();
    for (const span of right) {
      const lineKey = Math.round(span.y);
      const extent = rightLines.get(lineKey);
      rightLines.set(lineKey, {
        start: Math.min(extent?.start ?? span.x, span.x),
        end: Math.max(extent?.end ?? span.x + span.width, span.x + span.width),
        spans: [...(extent?.spans ?? []), span]
      });
    }
    if (rightLines.size < 4) continue;
    const extents = [...rightLines.values()];
    const columnStart = Math.min(...extents.map((extent) => extent.start));
    const aligned = extents.filter((extent) => extent.start - columnStart <= 20).length;
    if (aligned < rightLines.size * 0.6) continue;
    // Row values sit on entry rows and come a row or two at a time, flush right,
    // or mostly dated; a dated band beside bullets or under a heading is a sidebar.
    const sharedRows = [...rightLines.keys()].filter((y) => left.some((span) => Math.abs(span.y - y) <= 1)).length;
    const leftWithMarkers = spans.filter((span) => span.text.trim() && span.y > yCut && span.x + span.width <= x0);
    const besideBullet = [...rightLines.keys()].some((y) => {
      const row = leftWithMarkers.filter((span) => Math.abs(span.y - y) <= 0.3 * span.size + 0.5);
      const first = row.reduce<PdfSpan | null>((best, span) => (!best || span.x < best.x ? span : best), null);
      return first !== null && isMarkerText(first.text.trim().split(/\s+/u)[0], first);
    });
    const widths = extents.map((extent) => extent.end - extent.start).sort((a, b) => a - b);
    const columnEnd = Math.max(...extents.map((extent) => extent.end));
    const flushRight = extents.filter((extent) => columnEnd - extent.end <= 2).length >= rightLines.size * 0.8;
    let run = 0;
    let longestRun = 0;
    const rows = [...new Set(below.map((span) => Math.round(span.y)))].sort((a, b) => a - b);
    rows.forEach((y, index) => {
      if (index > 0 && y - rows[index - 1] <= 1) return;
      run = [...rightLines.keys()].some((key) => Math.abs(key - y) <= 1) ? run + 1 : 0;
      longestRun = Math.max(longestRun, run);
    });
    const values = extents.map((extent) => [...extent.spans].sort((a, b) => a.x - b.x).map((span) => span.text).join(" "));
    const sizes = extents.map((extent) => Math.max(...extent.spans.map((span) => span.size)));
    const bolds = extents.map((extent) => extent.spans.every((span) => span.bold));
    const typicalSize = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)];
    const boldMinority = bolds.filter(Boolean).length < bolds.length / 2;
    const headed = values.some((value, index) => /\p{L}/u.test(value) && !/[\d,]/u.test(value) &&
      (sizes[index] >= typicalSize * 1.08 || (bolds[index] && boldMinority && isSectionHeader(value))));
    const dated = !besideBullet && !headed && values.filter(hasDate).length >= values.length * 0.4;
    const rowValues = sharedRows >= rightLines.size * 0.6 && (dated || widths[Math.floor(widths.length / 2)] < pageWidth * 0.2);
    if (rowValues && (flushRight || longestRun <= 2 || dated)) continue;
    return { x0, x1, yCut };
  }
  return null;
}

function clusterLines(spans: readonly PdfSpan[]): PdfSpan[][] {
  const sorted = [...spans].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PdfSpan[][] = [];
  for (const span of sorted) {
    const current = lines[lines.length - 1];
    const anchor = current?.find((member) => !member.dingbat) ?? current?.[0];
    if (current && anchor && Math.abs(span.y - anchor.y) <= 0.3 * Math.min(span.size, anchor.size) + 0.5) {
      current.push(span);
    } else {
      lines.push([span]);
    }
  }
  return joinRaisedRuns(lines.map((line) => line.sort((a, b) => a.x - b.x)));
}

// A superscript ("1st") or subscript is set smaller, a little off its line,
// and never at the line's start; it belongs to that line, not a line of its own.
function setAgainst(run: readonly PdfSpan[], line: readonly PdfSpan[]): boolean {
  const base = line.find((span) => !span.dingbat) ?? line[0];
  const lineSize = Math.max(...line.map((span) => span.size));
  if (Math.max(...run.map((span) => span.size)) > lineSize * 0.8) return false;
  const rise = base.y - run[0].y;
  if (!(rise > 0 && rise <= 0.55 * lineSize) && !(rise < 0 && -rise <= 0.3 * lineSize)) return false;
  const lineStart = Math.min(...line.map((span) => span.x));
  const lineEnd = Math.max(...line.map((span) => span.x + span.width));
  return Math.min(...run.map((span) => span.x)) > lineStart + 0.5 && Math.max(...run.map((span) => span.x + span.width)) <= lineEnd + lineSize;
}

function joinRaisedRuns(lines: PdfSpan[][]): PdfSpan[][] {
  const joined = [...lines];
  for (let index = 0; index < joined.length; index += 1) {
    const host = [joined[index - 1], joined[index + 1]].find((line) => line && setAgainst(joined[index], line));
    if (!host) continue;
    host.push(...joined[index]);
    host.sort((a, b) => a.x - b.x);
    joined.splice(index, 1);
    index -= 1;
  }
  return joined;
}

function buildLine(spans: readonly PdfSpan[], page: number, region: LineRegion): Omit<LayoutLine, "index" | "regionLeft" | "regionRight" | "gapAbove"> | null {
  const pieces = spans.flatMap(spanPieces);
  if (!pieces.length) return null;
  let marker: LinePiece | null = null;
  const first = pieces[0];
  if (pieces.length > 1 && isMarkerText(first.text, first.span)) {
    marker = first;
    pieces.shift();
  } else if (!first.span.dingbat && /^(\S)\s+\S/u.test(first.span.text.slice(first.start)) && isMarkerText(first.text[0], first.span)) {
    // "• Built …" painted as one run: the glyph is a marker, the rest content.
    const glyphEnd = first.start + first.text.match(/^\S/u)![0].length;
    marker = slicePiece(first.span, first.start, glyphEnd);
    pieces[0] = slicePiece(first.span, glyphEnd, first.end);
  }
  if (!pieces.length) return null;

  const segments: LinePiece[][] = [[pieces[0]]];
  for (let i = 1; i < pieces.length; i += 1) {
    const previous = pieces[i - 1];
    const gap = pieces[i].x - previous.right;
    const sameSpanRun = previous.span === pieces[i].span && /\s{3,}|\t/.test(previous.span.text.slice(previous.end, pieces[i].start));
    if (sameSpanRun || gap > Math.max(1.8 * previous.span.size, 14)) segments.push([pieces[i]]);
    else segments[segments.length - 1].push(pieces[i]);
  }
  const content = pieces.filter((current) => /[\p{L}\p{N}]/u.test(current.text));
  const styled = content.length ? content : pieces;
  const text = segments.map(joinPieces).join(" ");
  const letters = text.replace(/[^\p{L}]/gu, "");
  return {
    page,
    region,
    y: dominant(pieces, (current) => current.span.y),
    x: pieces[0].x,
    right: pieces[pieces.length - 1].right,
    size: dominant(pieces, (current) => Math.round(current.span.size * 2) / 2),
    font: dominant(pieces, (current) => current.span.font),
    marker,
    segments,
    text,
    bold: styled.every((current) => current.span.bold),
    italic: styled.every((current) => current.span.italic),
    caps: letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase(),
    smallCaps: dominant(pieces, (current) => current.span.smallCaps)
  };
}

export function layoutLines(layout: PdfLayout): LayoutLines {
  const excluded: ExcludedPiece[] = [];
  const kept: PdfSpan[] = [];
  for (const span of layout.spans) {
    if (TAG_RE.test(span.text)) {
      excluded.push({ piece: slicePiece(span, 0, span.text.length), reason: TAG_REASON });
    } else {
      kept.push(span);
    }
  }

  const lines: LayoutLine[] = [];
  layout.pages.forEach((page, pageIndex) => {
    const pageSpans = kept.filter((span) => span.page === pageIndex);
    const gutter = findGutter(pageSpans, page.width);
    const regions: [LineRegion, PdfSpan[]][] = gutter
      ? [
          ["top", pageSpans.filter((span) => span.y <= gutter.yCut)],
          ["left", pageSpans.filter((span) => span.y > gutter.yCut && span.x + span.width / 2 < (gutter.x0 + gutter.x1) / 2)],
          ["right", pageSpans.filter((span) => span.y > gutter.yCut && span.x + span.width / 2 >= (gutter.x0 + gutter.x1) / 2)]
        ]
      : [["main", pageSpans]];
    for (const [region, spans] of regions) {
      const built = clusterLines(spans)
        .map((members) => buildLine(members, pageIndex, region))
        .filter((line): line is NonNullable<typeof line> => line !== null)
        .filter((line) => {
          // Formatting code can also be split across runs ("Parsed <" + "b>").
          if (!TAG_RE.test(line.text)) return true;
          for (const piece of [...(line.marker ? [line.marker] : []), ...line.segments.flat()]) excluded.push({ piece, reason: TAG_REASON });
          return false;
        });
      if (!built.length) continue;
      const regionLeft = Math.min(...built.map((line) => line.marker?.x ?? line.x));
      const regionRight = Math.max(...built.map((line) => line.right));
      built.forEach((line, index) => {
        lines.push({
          ...line,
          index: lines.length,
          regionLeft,
          regionRight,
          gapAbove: index > 0 ? line.y - built[index - 1].y : null
        });
      });
    }
  });

  const sizeWeights = new Map<number, number>();
  for (const line of lines) {
    for (const current of line.segments.flat()) {
      const size = Math.round(current.span.size * 2) / 2;
      sizeWeights.set(size, (sizeWeights.get(size) ?? 0) + current.text.length);
    }
  }
  const bodySize = [...sizeWeights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
  return { lines, excluded, bodySize };
}
