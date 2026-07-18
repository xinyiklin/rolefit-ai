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

import {
  DEFAULT_DOCUMENT_FONT_FAMILY,
  DOCUMENT_FONT_FAMILIES,
  documentFontFamily,
  fontFace,
  type DocumentFontFamily
} from "../fontRegistry.ts";
import type { FaceName } from "../metrics.gen.ts";
import { fieldKey, type FieldSrc, type GlyphRun } from "../types.ts";
import { PAGE_HEIGHT_BP, PAGE_WIDTH_BP } from "../blocks.ts";
import type { DocumentStyle } from "../../lib/documentStyle.ts";
import { layoutResume, type LayoutDocument, type LayoutPage } from "../layout.ts";
import { spaceWidth, underlineRule } from "../measure.ts";
import type { TypesetSchema } from "../schema.ts";

function cssFontShorthand(family: DocumentFontFamily, face: FaceName, sizePx: number): string {
  const f = fontFace(family, face);
  return `${f.italic ? "italic " : ""}${f.weight} ${sizePx}px "${f.cssFamily}"`;
}

// Load every face before first paint/measure (an unloaded family silently
// falls back to a default serif with wrong metrics).
async function ensureTypesetFonts(family: DocumentFontFamily = DEFAULT_DOCUMENT_FONT_FAMILY): Promise<void> {
  const loaded = await Promise.all(
    (Object.keys(DOCUMENT_FONT_FAMILIES[family].faces) as FaceName[]).map((face) =>
      document.fonts.load(cssFontShorthand(family, face, 16), "Mg")
    )
  );
  if (loaded.some((faces) => faces.length === 0)) {
    throw new Error(`The ${DOCUMENT_FONT_FAMILIES[family].label} document font could not be loaded.`);
  }
}

async function ensureAllTypesetFonts(): Promise<void> {
  await Promise.all((Object.keys(DOCUMENT_FONT_FAMILIES) as DocumentFontFamily[]).map(ensureTypesetFonts));
}

type FaceBox = { ascent: number; descent: number }; // em ratios

const faceBoxCache = new Map<string, FaceBox>();

// The browser's own font-box metrics per face (em ratios), measured once.
function faceBox(family: DocumentFontFamily, face: FaceName): FaceBox {
  const cacheKey = `${family}:${face}`;
  const cached = faceBoxCache.get(cacheKey);
  if (cached) return cached;
  const ctx = document.createElement("canvas").getContext("2d");
  let ascent = 0.95;
  let descent = 0.25;
  if (ctx) {
    ctx.font = cssFontShorthand(family, face, 100);
    const measured = ctx.measureText("Mg");
    if (measured.fontBoundingBoxAscent) ascent = measured.fontBoundingBoxAscent / 100;
    if (measured.fontBoundingBoxDescent) descent = measured.fontBoundingBoxDescent / 100;
  }
  const box = { ascent, descent };
  faceBoxCache.set(cacheKey, box);
  return box;
}

// ---- Run grouping: word boxes → style spans with real spaces ----

type Segment = {
  text: string;
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

function groupRuns(runs: GlyphRun[]): Segment[] {
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
    } else {
      flush();
      cur = {
        text: run.text,
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
  return (
    <>
      {page.lines.map((line, li) => {
        const segs = groupRuns(line.runs);
        // The line div is a REAL block box (true top/height): selection then
        // yields a newline per line on copy. Spans position within it.
        const lineTop = segs.length
          ? Math.min(...segs.map((s) => line.baseline - faceBox(s.family, s.face).ascent * s.size))
          : line.baseline - 10;
        const lineBottom = segs.length
          ? Math.max(...segs.map((s) => line.baseline + faceBox(s.family, s.face).descent * s.size))
          : line.baseline;
        return (
          <div
            key={li}
            className="tsd-line"
            style={{ position: "absolute", left: 0, right: 0, top: unit(lineTop), height: unit(lineBottom - lineTop) }}
          >
            {segs.map((seg, si) => {
              const box = faceBox(seg.family, seg.face);
              const font = fontFace(seg.family, seg.face);
              const key = seg.src ? fieldKey(seg.src) : undefined;
              const highlighted = Boolean(key && key === highlightFieldKey && !seg.marker);
              const style: React.CSSProperties = {
                position: "absolute",
                left: unit(seg.x),
                top: unit(line.baseline - box.ascent * seg.size - lineTop),
                fontFamily: `"${font.cssFamily}"`,
                fontWeight: font.weight,
                fontStyle: font.italic ? "italic" : "normal",
                fontSize: unit(seg.size),
                lineHeight: unit((box.ascent + box.descent) * seg.size),
                whiteSpace: "pre",
                letterSpacing: seg.tracking ? unit(seg.tracking) : 0,
                wordSpacing: seg.wordSpacing ? unit(seg.wordSpacing) : undefined,
                color: "#000"
              };
              if (seg.href || seg.underline) {
                // Links and explicit underlines use an engine-painted rule with
                // the same device-pixel snapping as section rules. It hangs
                // below the ink instead of relying on browser text-decoration.
                const ul = underlineRule(seg.text.trimEnd(), {
                  family: seg.family,
                  face: seg.face,
                  size: seg.size,
                  tracking: seg.tracking
                });
                return (
                  <Fragment key={si}>
                    {seg.href ? (
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
                    ) : (
                      <span
                        data-tsdf={key}
                        data-tsdm={seg.marker ? "1" : undefined}
                        className={highlighted ? "tsd-run--highlighted" : undefined}
                        style={style}
                      >
                        {seg.text}
                      </span>
                    )}
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
  spellCheck = false,
  hostRef,
  onDoc,
  highlightFieldKey
}: {
  schema: TypesetSchema;
  docStyle: DocumentStyle;
  zoom?: number;
  // screen: px sized by zoom, page chrome (white sheet, shadow via CSS class).
  // print: pt units (true physical size), one sheet per page, break-after.
  variant?: "screen" | "print";
  onPageCount?: (count: number) => void;
  editable?: boolean;
  // Browser spell-check underlines, off by default; only meaningful when editable.
  spellCheck?: boolean;
  hostRef?: React.Ref<HTMLDivElement>;
  onDoc?: (doc: LayoutDocument) => void;
  // Transient render flag: paint this field's runs with tsd-run--highlighted
  // (the host styles the class). Not document state; never affects layout.
  highlightFieldKey?: string | null;
}) {
  const family = documentFontFamily(docStyle.fontFamily);
  const [loadedFamily, setLoadedFamily] = useState<DocumentFontFamily | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  const [doc, setDoc] = useState<LayoutDocument | null>(null);

  useEffect(() => {
    let alive = true;
    setFontError(null);
    ensureAllTypesetFonts()
      .then(() => {
        if (alive) setLoadedFamily(family);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setLoadedFamily(null);
        setFontError(error instanceof Error ? error.message : "The document font could not be loaded.");
      });
    return () => {
      alive = false;
    };
  }, [family]);

  useEffect(() => {
    if (loadedFamily !== family) return;
    const next = layoutResume(schema, docStyle);
    setDoc(next);
    onPageCount?.(next.pages.length);
    onDoc?.(next);
  }, [loadedFamily, family, schema, docStyle, onPageCount, onDoc]);

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

  if (fontError) {
    return variant === "screen" ? (
      <div className="preview-overlay__loading" role="alert">
        <span>{fontError}</span>
      </div>
    ) : null;
  }

  if (loadedFamily !== family || !doc) {
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
          style={{ position: "relative", overflow: "hidden", width: unit(PAGE_WIDTH_BP), height: unit(PAGE_HEIGHT_BP) }}
        >
          <PageLines page={page} unit={unit} ruleBox={ruleBox} highlightFieldKey={highlightFieldKey} />
        </div>
      ))}
    </div>
  );
}
