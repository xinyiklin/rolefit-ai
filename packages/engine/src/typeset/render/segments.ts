import type { DocumentFontFamily } from "../fontRegistry.ts";
import type { FaceName } from "../metrics.gen.ts";
import { fieldKey, type FieldSrc, type GlyphRun } from "../types.ts";
import { spaceWidth } from "../measure.ts";

export type Segment = {
  text: string;
  breakAfter?: "" | " " | "\n";
  family: DocumentFontFamily;
  face: FaceName;
  size: number;
  tracking: number;
  x: number;
  end: number; // right edge in bp (for boundary-space decisions)
  href?: string;
  underline?: boolean;
  src?: FieldSrc;
  marker?: boolean; // bullet marker run (data-tsdm; editor mapping skips it)
  wordSpacing: number; // bp delta vs the natural space width
};

export function groupRuns(runs: GlyphRun[]): Segment[] {
  const segs: Segment[] = [];
  let cur: (Segment & { gaps: number[] }) | null = null;
  const flush = () => {
    if (!cur) return;
    // Engine glue vs natural space: apply the average delta as word-spacing.
    if (cur.gaps.length) {
      const natural = spaceWidth({ family: cur.family, face: cur.face, size: cur.size, tracking: cur.tracking });
      const avg = cur.gaps.reduce((s, g) => s + g, 0) / cur.gaps.length;
      const delta = avg - natural;
      if (Math.abs(delta) > 0.02) cur.wordSpacing = delta;
    }
    const { gaps: _g, ...seg } = cur;
    segs.push(seg);
    cur = null;
  };
  for (const run of runs) {
    const spaceish = spaceWidth(run.style);
    const gap = cur ? run.x - cur.end : 0;
    // Join only across genuine interword glue. Justified stretch tops out
    // near 1.63× the natural space (tolerance 200 ⇒ r ≈ 1.26 of a 0.5-space
    // stretch budget); anything wider (the contact "|" divider boxes at ~2.3×)
    // is layout, not a space — joining it would pollute word-spacing and
    // stretch the segment's real spaces.
    const joinable =
      cur &&
      cur.family === run.style.family &&
      cur.face === run.style.face &&
      cur.size === run.style.size &&
      cur.tracking === run.style.tracking &&
      cur.href === run.href &&
      cur.underline === run.underline &&
      Boolean(cur.marker) === Boolean(run.marker) &&
      (cur.src ? fieldKey(cur.src) : "") === (run.src ? fieldKey(run.src) : "") &&
      gap >= -0.05 &&
      gap <= spaceish * 1.75;
    if (joinable && cur) {
      if (gap > 0.3) {
        cur.text += ` ${run.text}`;
        cur.gaps.push(gap);
      } else {
        cur.text += run.text; // kern-adjacent fragments, no glue
      }
      cur.end = run.x + run.width;
      cur.breakAfter = run.breakAfter;
    } else {
      flush();
      cur = {
        text: run.text,
        breakAfter: run.breakAfter,
        family: run.style.family,
        face: run.style.face,
        size: run.style.size,
        tracking: run.style.tracking,
        x: run.x,
        href: run.href,
        underline: run.underline,
        src: run.src,
        marker: run.marker,
        wordSpacing: 0,
        end: run.x + run.width,
        gaps: []
      };
    }
  }
  flush();
  // Selection/text-extraction fidelity: `white-space: pre` renders trailing whitespace
  // inside a span's own box without moving any glyph, so appending it never
  // shifts layout. A trailing space where a glue gap separates two segments
  // (style boundaries, the bullet marker) keeps browser-derived words apart.
  for (let i = 0; i < segs.length - 1; i += 1) {
    if (segs[i].src && segs[i + 1].src && fieldKey(segs[i].src!) === fieldKey(segs[i + 1].src!) && segs[i + 1].x - segs[i].end > 0.3) segs[i].text += " ";
  }
  return segs;
}
