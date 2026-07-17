// DOM backend: paint an engine LayoutDocument as absolutely-positioned REAL
// text. The engine owns all layout (line breaks, baselines, x positions); the
// browser is asked only to rasterize glyphs inside boxes we place — the
// Monaco/old-Kix architecture. Unlike the retired canvas painter, the output
// is selectable, copyable, findable, screen-reader-visible, and prints as
// vector text; it serves every human-facing surface (the editor, Preview
// overlay, and the ⌘P print layer).
//
// Baseline math: CSS positions boxes by their TOP edge; where the baseline
// falls inside a line box depends on the font-box metrics the BROWSER uses
// (which may differ from static hhea tables across engines). So we measure
// each face's fontBoundingBox once at runtime via canvas TextMetrics and set
//   line-height = ascent + descent  (zero half-leading)
//   top         = baseline − ascent
// which pins the drawn baseline to the engine's, per browser, exactly.
//
// Text integrity: engine runs are word-level boxes (spaces are glue, not
// text). We regroup them into one span per style-run WITH real space
// characters so selection/copy/find work, and correct any difference between
// the engine's set glue and the natural space width via `word-spacing` — so
// shrunk lines keep exact engine geometry. Each line is a block element, so
// copied text gets line breaks.

import { Fragment, useEffect, useMemo, useState } from "react";

import type { FaceName } from "../metrics.gen.ts";
import { fieldKey, type FieldSrc, type GlyphRun } from "../types.ts";
import type { DocStyleIn, ResumeSchemaIn } from "../blocks.ts";
import { layoutResume, type LayoutDocument, type LayoutPage } from "../layout.ts";
import { measure, underlineRule } from "../measure.ts";

// CSS font selection per engine face (families match resume-document.css).
const FACE_FONT: Record<FaceName, { family: string; weight: number; italic: boolean }> = {
  regular: { family: '"Latin Modern Roman"', weight: 400, italic: false },
  bold: { family: '"Latin Modern Roman"', weight: 700, italic: false },
  italic: { family: '"Latin Modern Roman"', weight: 400, italic: true },
  boldItalic: { family: '"Latin Modern Roman"', weight: 700, italic: true },
  boldDisplay: { family: '"Latin Modern Roman Display"', weight: 700, italic: false },
  caps: { family: '"Latin Modern Roman Caps"', weight: 400, italic: false }
};

export const PAGE_W_BP = 612;
export const PAGE_H_BP = 792;

function cssFontShorthand(face: FaceName, sizePx: number): string {
  const f = FACE_FONT[face];
  return `${f.italic ? "italic " : ""}${f.weight} ${sizePx}px ${f.family}`;
}

// Load every face before first paint/measure (an unloaded family silently
// falls back to a default serif with wrong metrics).
export async function ensureTypesetFonts(): Promise<void> {
  await Promise.all(
    (Object.keys(FACE_FONT) as FaceName[]).map((face) => document.fonts.load(cssFontShorthand(face, 16), "Mg"))
  );
}

type FaceBox = { ascent: number; descent: number }; // em ratios

let faceBoxCache: Record<FaceName, FaceBox> | null = null;

// The browser's own font-box metrics per face (em ratios), measured once.
// Exported for Exact mode's overlay geometry.
function faceBoxes(): Record<FaceName, FaceBox> {
  if (faceBoxCache) return faceBoxCache;
  const ctx = document.createElement("canvas").getContext("2d");
  const out = {} as Record<FaceName, FaceBox>;
  for (const face of Object.keys(FACE_FONT) as FaceName[]) {
    let ascent = 0.95;
    let descent = 0.25;
    if (ctx) {
      ctx.font = cssFontShorthand(face, 100);
      const m = ctx.measureText("Mg");
      if (m.fontBoundingBoxAscent) ascent = m.fontBoundingBoxAscent / 100;
      if (m.fontBoundingBoxDescent) descent = m.fontBoundingBoxDescent / 100;
    }
    out[face] = { ascent, descent };
  }
  faceBoxCache = out;
  return out;
}

// ---- Run grouping: word boxes → style spans with real spaces ----

type Segment = {
  text: string;
  face: FaceName;
  size: number;
  x: number;
  end: number; // right edge in bp (for boundary-space decisions)
  href?: string;
  src?: FieldSrc;
  marker?: boolean; // bullet marker run (data-tsdm; editor mapping skips it)
  wordSpacing: number; // bp delta vs the natural space width
};

function groupRuns(runs: GlyphRun[]): Segment[] {
  const segs: Segment[] = [];
  let cur: (Segment & { gaps: number[] }) | null = null;
  const flush = () => {
    if (!cur) return;
    // Engine glue vs natural space: apply the average delta as word-spacing.
    if (cur.gaps.length) {
      const natural = measure(" ", { face: cur.face, size: cur.size });
      const avg = cur.gaps.reduce((s, g) => s + g, 0) / cur.gaps.length;
      const delta = avg - natural;
      if (Math.abs(delta) > 0.02) cur.wordSpacing = delta;
    }
    const { gaps: _g, ...seg } = cur;
    segs.push(seg);
    cur = null;
  };
  for (const run of runs) {
    const spaceish = measure(" ", { face: run.style.face, size: run.style.size });
    const gap = cur ? run.x - cur.end : 0;
    // Join only across genuine interword glue. Justified stretch tops out
    // near 1.63× the natural space (tolerance 200 ⇒ r ≈ 1.26 of a 0.5-space
    // stretch budget); anything wider (the contact "|" divider boxes at ~2.3×)
    // is layout, not a space — joining it would pollute word-spacing and
    // stretch the segment's real spaces.
    const joinable =
      cur &&
      cur.face === run.style.face &&
      cur.size === run.style.size &&
      cur.href === run.href &&
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
    } else {
      flush();
      cur = {
        text: run.text,
        face: run.style.face,
        size: run.style.size,
        x: run.x,
        href: run.href,
        src: run.src,
        marker: run.marker,
        wordSpacing: 0,
        end: run.x + run.width,
        gaps: []
      };
    }
  }
  flush();
  // Copy/selection fidelity: `white-space: pre` renders trailing whitespace
  // inside a span's own box without moving any glyph, so appending it never
  // shifts layout. A trailing space where a glue gap separates two segments
  // (style boundaries, the bullet marker) keeps copied words apart; the last
  // segment gets a trailing newline so copied lines break like the page.
  for (let i = 0; i < segs.length - 1; i += 1) {
    if (segs[i + 1].x - segs[i].end > 0.3) segs[i].text += " ";
  }
  if (segs.length) segs[segs.length - 1].text += "\n";
  return segs;
}

// ---- Painters ----

// `unit` converts bp → CSS length: px×zoom for screen, pt for print (612pt is
// exactly the 8.5in physical page, so print needs no zoom concept).
type Unit = (bp: number) => string;

// Rule (hairline) box: PDF viewers snap sub-pixel rules to the device grid
// with a one-device-pixel minimum — a raw 0.4bp div lands between device rows
// and anti-aliases into a faint smear instead of a crisp line. `yAbs` is the
// rule's ABSOLUTE page position: snapping must happen in page space (the line
// div's own top is fractional), then convert back to a line-relative offset.
type RuleBox = (yAbs: number, thickness: number, lineTop: number) => { top: string; height: string };

function PageLines({
  page,
  unit,
  ruleBox,
  highlightFieldKey
}: {
  page: LayoutPage;
  unit: Unit;
  ruleBox: RuleBox;
  highlightFieldKey?: string | null;
}) {
  const boxes = faceBoxes();
  return (
    <>
      {page.lines.map((line, li) => {
        const segs = groupRuns(line.runs);
        // The line div is a REAL block box (true top/height): selection then
        // yields a newline per line on copy. Spans position within it.
        const lineTop = segs.length
          ? Math.min(...segs.map((s) => line.baseline - boxes[s.face].ascent * s.size))
          : line.baseline - 10;
        const lineBottom = segs.length
          ? Math.max(...segs.map((s) => line.baseline + boxes[s.face].descent * s.size))
          : line.baseline;
        return (
          <div
            key={li}
            className="tsd-line"
            style={{ position: "absolute", left: 0, right: 0, top: unit(lineTop), height: unit(lineBottom - lineTop) }}
          >
            {segs.map((seg, si) => {
              const box = boxes[seg.face];
              const font = FACE_FONT[seg.face];
              const key = seg.src ? fieldKey(seg.src) : undefined;
              const highlighted = Boolean(key && key === highlightFieldKey && !seg.marker);
              const style: React.CSSProperties = {
                position: "absolute",
                left: unit(seg.x),
                top: unit(line.baseline - box.ascent * seg.size - lineTop),
                fontFamily: font.family,
                fontWeight: font.weight,
                fontStyle: font.italic ? "italic" : "normal",
                fontSize: unit(seg.size),
                lineHeight: unit((box.ascent + box.descent) * seg.size),
                whiteSpace: "pre",
                letterSpacing: 0,
                wordSpacing: seg.wordSpacing ? unit(seg.wordSpacing) : undefined,
                color: "#000"
              };
              if (seg.href) {
                // Links are underlined the way TeX \underline does it: a
                // PAINTED rule (same device-pixel snapping as section rules),
                // hung below the segment's ink depth — never CSS
                // text-decoration, whose skip-ink cuts gaps around descenders
                // and whose sub-pixel thickness rasterizes unevenly.
                const ul = underlineRule(seg.text.trimEnd(), { face: seg.face, size: seg.size });
                return (
                  <Fragment key={si}>
                    <a
                      href={seg.href}
                      target="_blank"
                      rel="noreferrer"
                      data-tsdf={key}
                      className={highlighted ? "tsd-run--highlighted" : undefined}
                      style={{ ...style, color: "#000", textDecoration: "none" }}
                    >
                      {seg.text}
                    </a>
                    <div
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        left: unit(seg.x),
                        width: unit(seg.end - seg.x),
                        ...ruleBox(line.baseline + ul.offset, ul.thickness, lineTop),
                        background: "#000",
                        pointerEvents: "none"
                      }}
                    />
                  </Fragment>
                );
              }
              return (
                <span
                  key={si}
                  data-tsdf={key}
                  data-tsdm={seg.marker ? "1" : undefined}
                  className={highlighted ? "tsd-run--highlighted" : undefined}
                  style={style}
                >
                  {seg.text}
                </span>
              );
            })}
            {line.rule ? (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: unit(line.rule.x),
                  width: unit(line.rule.width),
                  ...ruleBox(line.rule.y, line.rule.thickness, lineTop),
                  background: "#000"
                }}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function TypesetDomPages({
  schema,
  docStyle,
  zoom = 1,
  variant = "screen",
  onPageCount,
  // Typeset editor hooks: `editable` turns the whole document into ONE
  // contenteditable host (native caret/selection on the painted real text —
  // the controller intercepts every mutation); `hostRef` exposes the host
  // element; `onDoc` reports each fresh layout (the controller restores the
  // caret after the repaint it triggers).
  editable = false,
  // Browser-native spellcheck on the editable host — the red typo underlines.
  // Only meaningful when `editable`; ignored for the print mirror. An editor
  // preference (useEditorPrefs), NOT typography: it never affects the layout
  // or PDF, only what the browser paints under the caret.
  spellCheck = true,
  hostRef,
  onDoc,
  highlightFieldKey
}: {
  schema: ResumeSchemaIn;
  docStyle: DocStyleIn;
  zoom?: number;
  // screen: px sized by zoom, page chrome (white sheet, shadow via CSS class).
  // print: pt units (true physical size), one sheet per page, break-after.
  variant?: "screen" | "print";
  onPageCount?: (count: number) => void;
  editable?: boolean;
  spellCheck?: boolean;
  hostRef?: React.Ref<HTMLDivElement>;
  onDoc?: (doc: LayoutDocument) => void;
  highlightFieldKey?: string | null;
}) {
  const [fontsReady, setFontsReady] = useState(false);
  const [doc, setDoc] = useState<LayoutDocument | null>(null);

  useEffect(() => {
    let alive = true;
    ensureTypesetFonts().then(() => {
      if (alive) setFontsReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!fontsReady) return;
    const next = layoutResume(schema, docStyle);
    setDoc(next);
    onPageCount?.(next.pages.length);
    onDoc?.(next);
  }, [fontsReady, schema, docStyle, onPageCount, onDoc]);

  const unit = useMemo<Unit>(
    () => (variant === "print" ? (bp) => `${+bp.toFixed(3)}pt` : (bp) => `${+(bp * zoom).toFixed(3)}px`),
    [variant, zoom]
  );

  // Screen rules snap to the device-pixel grid with a 1-device-pixel floor
  // (see RuleBox). Print keeps exact pt — paper has no sub-pixel problem.
  const ruleBox = useMemo<RuleBox>(() => {
    if (variant === "print") {
      return (yAbs, thickness, lineTop) => ({
        top: `${+(yAbs - lineTop).toFixed(3)}pt`,
        height: `${+thickness.toFixed(3)}pt`
      });
    }
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    return (yAbs, thickness, lineTop) => {
      const topDev = Math.round(yAbs * zoom * dpr);
      const heightDev = Math.max(1, Math.round(thickness * zoom * dpr));
      return {
        top: `${+(topDev / dpr - lineTop * zoom).toFixed(3)}px`,
        height: `${+(heightDev / dpr).toFixed(3)}px`
      };
    };
  }, [variant, zoom]);

  if (!fontsReady || !doc) {
    return variant === "screen" ? (
      <div className="preview-overlay__loading" role="status">
        <div className="preview-overlay__spinner" />
        <span>Typesetting…</span>
      </div>
    ) : null;
  }

  return (
    <div
      ref={hostRef}
      className={`tsd-doc tsd-doc--${variant}${editable ? " tsd-doc--editable" : ""}`}
      contentEditable={editable || undefined}
      suppressContentEditableWarning={editable || undefined}
      spellCheck={editable ? spellCheck : undefined}
      role={editable ? "textbox" : undefined}
      aria-multiline={editable || undefined}
      aria-label={editable ? "Resume editor" : undefined}
    >
      {doc.pages.map((page, i) => (
        <div
          key={i}
          className="tsd-page"
          data-tsd-page={i}
          role="document"
          aria-label={`Resume page ${i + 1}`}
          style={{ position: "relative", overflow: "hidden", width: unit(PAGE_W_BP), height: unit(PAGE_H_BP) }}
        >
          <PageLines page={page} unit={unit} ruleBox={ruleBox} highlightFieldKey={highlightFieldKey} />
        </div>
      ))}
    </div>
  );
}
