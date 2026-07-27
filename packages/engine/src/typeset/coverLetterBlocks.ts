import type { DocumentStyle } from "../lib/documentStyle.ts";
import {
  alignmentFromInlineMarks,
  paragraphIndentFromInlineMarks,
  paragraphSpacingFromInlineMarks,
  stripInlineMarks
} from "../lib/inlineMarksText.ts";
import { documentFontFamily } from "./fontRegistry.ts";
import {
  buildHeaderVerticalStream,
  pageGeometry,
  paragraphLines,
  type VLine
} from "./blocks.ts";
import type { ParagraphAlign } from "./types.ts";
import type { TypesetSchema } from "./schema.ts";

// Cover letters use the same measurement, line breaking, pagination, fonts,
// inline-mark grammar, DOM painter, and PDF emitter as resumes. Only this
// vertical composition differs: the constrained cover-letter adapter exposes
// each prose paragraph as a summary field, and this stream gives those fields
// correspondence-style margins, body size, leading, and paragraph spacing.
export function buildCoverLetterVerticalStream(
  schema: TypesetSchema,
  style: DocumentStyle
): VLine[] {
  const geo = pageGeometry(style);
  const family = documentFontFamily(style.fontFamily);
  const size = style.baseFontSizePt;
  const tracking = style.letterSpacingPt;
  const paragraphGap = style.bulletGapPt;
  const bodyAlign = (
    ["justify", "center", "right"].includes(style.bodyAlign) ? style.bodyAlign : "left"
  ) as ParagraphAlign;
  const header = buildHeaderVerticalStream(schema, style);
  const out: VLine[] = [...header];
  const section = schema.sections[0];
  const items = section?.items ?? [];
  let previousSpaceAfterPt = 0;

  items.forEach((item, index) => {
    const value = item.bullets[0] ?? "";
    const paragraphSpacing = paragraphSpacingFromInlineMarks(value);
    const leading = size * style.lineHeight;
    const spaceBeforePt = paragraphSpacing.spaceBeforePt ?? 0;
    const spaceAfterPt = paragraphSpacing.spaceAfterPt ?? 0;
    const bulletId = item.bulletIds[0] ?? `${item.id}-paragraph`;
    // Block indentation moves every wrapped line and narrows its measure.
    const indent = paragraphIndentFromInlineMarks(value);
    const lines = paragraphLines(
      value,
      size,
      indent,
      Math.max(size, geo.textWidth - indent),
      alignmentFromInlineMarks(value) ?? bodyAlign,
      leading,
      index === 0
        ? header.length ? leading + style.headerSectionGapPt + spaceBeforePt : spaceBeforePt
        : leading + paragraphGap + previousSpaceAfterPt + spaceBeforePt,
      false,
      family,
      tracking,
      false,
      {
        kind: "bullet",
        sectionId: section?.id ?? "cover-letter",
        entryId: item.id,
        bulletId
      },
      stripInlineMarks(value).trim().length === 0
        ? paragraphSpacing.lineHeight ?? undefined
        : undefined
    );
    if (index > 0 && lines.length) lines[0].keepWithPrev = false;
    out.push(...lines);
    previousSpaceAfterPt = spaceAfterPt;
  });

  return out;
}
