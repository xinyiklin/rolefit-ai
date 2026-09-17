import { breakParagraph, minimumParagraphWidth } from "./linebreak.ts";
import { paragraphItems } from "./measure.ts";
import type { GlyphRun, ParaItem } from "./types.ts";
import type { FaceName } from "./metrics.gen.ts";
import type { DocumentFontFamily } from "./fontRegistry.ts";

// Fitting rows retain their original glyph positions and calibrated spacing.
export function wrapHeadRow(
  runs: GlyphRun[], leftValue: string, rightValue: string,
  origin: number, width: number, size: number, family: DocumentFontFamily, tracking: number
): GlyphRun[][] {
  const left = runs.filter((run) => run.src?.kind === "entry" && run.src.field.endsWith("Left"));
  const right = runs.filter((run) => run.src?.kind === "entry" && run.src.field.endsWith("Right"));
  const end = (field: GlyphRun[]) => Math.max(...field.map((run) => run.x + run.width));
  const start = (field: GlyphRun[]) => Math.min(...field.map((run) => run.x));
  if (start(left) >= origin && end(right) <= origin + width + 1e-7 &&
      end(left) <= start(right) && !/[\r\n]/.test(leftValue + rightValue)) return [runs];

  const leftItems = paragraphItems(leftValue, size, family, tracking);
  const rightItems = paragraphItems(rightValue, size, family, tracking);
  const leftWidth = end(left) - start(left);
  const rightWidth = end(right) - start(right);
  const paired = left.some(run => run.text.length > 0) && right.some(run => run.text.length > 0);
  const available = Math.max(1, width - (paired ? size : 0));
  let leftColumn = paired
    ? leftWidth <= available / 2 ? leftWidth : rightWidth <= available / 2 ? available - rightWidth : available / 2
    : width;
  if (paired) {
    const leftMin = minimumParagraphWidth(leftItems);
    const rightMin = minimumParagraphWidth(rightItems);
    if (leftMin + rightMin <= available) {
      leftColumn = Math.max(leftMin, Math.min(leftColumn, available - rightMin));
    }
  }
  const rightColumn = paired ? available - leftColumn : width;
  const compose = (stream: ParaItem[], field: GlyphRun[], column: number, rightAligned: boolean) => {
    const lines = breakParagraph(stream, Math.max(1, column), rightAligned ? "right" : "left");
    return lines.map((line) => {
      const runs = line.runs.length
      ? line.runs.map((run) => ({ ...run, x: run.x + (rightAligned ? origin + width - column : origin), src: field[0].src }))
      : [{ ...field[0], text: "", width: 0, x: rightAligned ? origin + width : origin }];
      if (line.breakAfter !== undefined) runs[runs.length - 1].breakAfter = line.breakAfter;
      return runs;
    });
  };
  const leftLines = compose(leftItems, left, leftColumn, false);
  const rightLines = compose(rightItems, right, rightColumn, true);
  return Array.from({ length: Math.max(leftLines.length, rightLines.length) }, (_, index) =>
    [...(leftLines[index] ?? []), ...(rightLines[index] ?? [])]);
}

export function wrapSingleField(
  value: string, runs: GlyphRun[], width: number, size: number,
  family: DocumentFontFamily, tracking: number, faceOverride?: FaceName
): GlyphRun[][] {
  if (runs.every(run => run.x + run.width <= width + 1e-7) && !/[\r\n]/.test(value)) return [runs];
  return breakParagraph(paragraphItems(value, size, family, tracking, faceOverride), width, "left")
    .map(line => {
      const fragment = line.runs.length
        ? line.runs.map(run => ({ ...run, src: runs[0].src }))
        : [{ ...runs[0], text: "", width: 0, x: 0 }];
      if (line.breakAfter !== undefined) fragment[fragment.length - 1].breakAfter = line.breakAfter;
      return fragment;
    });
}
