import type { DocumentStyle } from "../lib/documentStyle.ts";
import { alignmentFromInlineMarks } from "../lib/inlineMarksText.ts";
import { documentFontFamily } from "./fontRegistry.ts";
import { pageGeometry, paragraphLines, type VLine } from "./blocks.ts";
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
  const leading = size * style.lineHeight;
  const paragraphGap = style.bulletGapPt;
  const bodyAlign = (
    ["justify", "center", "right"].includes(style.bodyAlign) ? style.bodyAlign : "left"
  ) as ParagraphAlign;
  const out: VLine[] = [];
  const section = schema.sections[0];
  const items = section?.items ?? [];

  items.forEach((item, index) => {
    const value = item.bullets[0] ?? "";
    const bulletId = item.bulletIds[0] ?? `${item.id}-paragraph`;
    const lines = paragraphLines(
      value,
      size,
      0,
      geo.textWidth,
      alignmentFromInlineMarks(value) ?? bodyAlign,
      leading,
      index === 0 ? 0 : leading + paragraphGap,
      false,
      family,
      tracking,
      false,
      {
        kind: "bullet",
        sectionId: section?.id ?? "cover-letter",
        entryId: item.id,
        bulletId
      }
    );
    if (index > 0 && lines.length) lines[0].keepWithPrev = false;
    out.push(...lines);
  });

  return out;
}
