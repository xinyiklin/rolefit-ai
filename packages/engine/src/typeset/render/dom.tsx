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
// each face's actual CSS line-box baseline once at runtime. A line starts at
//   min(engine baseline − run CSS ascent)
// and its fixed-width inline runs use native `vertical-align: baseline`.
// That gives every family/size one shared browser baseline while retaining the
// engine's exact x positions.
//
// Text integrity: engine runs are word-level boxes (spaces are glue, not
// text). We regroup them into one span per style-run WITH real space
// characters so selection/copy/find work, and correct any difference between
// the engine's set glue and the natural space width via `word-spacing` — so
// shrunk lines keep exact engine geometry. Each line is a block element, so
// copied text gets line breaks.

import { useEffect, useMemo, useState } from "react";

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
import {
  layoutCoverLetter,
  layoutResume,
  lineSeparators,
  type LayoutDocument,
  type LayoutPage
} from "../layout.ts";
import { spaceWidth, underlineRule, underlineSpans } from "../measure.ts";
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
  // Prime browser-only line-box metrics after every face is loaded and before
  // React paints pages, keeping the render path read-only and cache-backed.
  for (const family of Object.keys(DOCUMENT_FONT_FAMILIES) as DocumentFontFamily[]) {
    for (const face of Object.keys(DOCUMENT_FONT_FAMILIES[family].faces) as FaceName[]) {
      browserFaceBox(family, face);
    }
  }
}

export type BrowserFaceBox = { ascent: number; descent: number }; // em ratios

const faceBoxCache = new Map<string, BrowserFaceBox>();

// The browser's CSS line-box metrics per face (em ratios), measured once.
// Canvas fontBoundingBox* values describe glyph/font bounds, not necessarily
// the baseline CSS uses inside a blockified, absolutely positioned span. That
// difference becomes visible when multiple sizes or families share one line.
// A zero-height inline marker sits exactly on the probe line's CSS baseline,
// giving the painter the offset used by the actual rendering path.
export function browserFaceBox(
  family: DocumentFontFamily,
  face: FaceName
): BrowserFaceBox {
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
  const font = fontFace(family, face);
  const probe = document.createElement("span");
  const marker = document.createElement("span");
  Object.assign(probe.style, {
    position: "absolute",
    left: "-10000px",
    top: "0",
    display: "block",
    visibility: "hidden",
    padding: "0",
    margin: "0",
    border: "0",
    whiteSpace: "pre",
    fontFamily: `"${font.cssFamily}"`,
    fontWeight: String(font.weight),
    fontStyle: font.italic ? "italic" : "normal",
    fontSize: "100px",
    lineHeight: `${(ascent + descent) * 100}px`
  });
  Object.assign(marker.style, {
    display: "inline-block",
    width: "0",
    height: "0",
    padding: "0",
    margin: "0",
    border: "0",
    verticalAlign: "baseline"
  });
  probe.append(document.createTextNode("Mg"), marker);
  document.body.append(probe);
  const probeRect = probe.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const cssAscent = (markerRect.top - probeRect.top) / 100;
  const cssDescent = (probeRect.bottom - markerRect.top) / 100;
  probe.remove();
  if (
    Number.isFinite(cssAscent) &&
    Number.isFinite(cssDescent) &&
    cssAscent > 0 &&
    cssDescent >= 0
  ) {
    ascent = cssAscent;
    descent = cssDescent;
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
  // Selection/text-extraction fidelity: `white-space: pre` renders trailing whitespace
  // inside a span's own box without moving any glyph, so appending it never
  // shifts layout. A trailing space where a glue gap separates two segments
  // (style boundaries, the bullet marker) keeps browser-derived words apart.
  for (let i = 0; i < segs.length - 1; i += 1) {
    if (segs[i + 1].x - segs[i].end > 0.3) segs[i].text += " ";
  }
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
// React omits an empty string child, leaving no text node for contenteditable
// to place a caret in. This browser-only, zero-width placeholder keeps an empty
// engine run editable; data-tsde lets the selection adapter treat it as model
// length zero.
export const EMPTY_EDITABLE_PLACEHOLDER = "\uFEFF";


function PageLines({
  page,
  separators,
  unit,
  ruleBox,
  highlightFieldKey
}: {
  page: LayoutPage;
  separators: readonly string[];
  unit: Unit;
  ruleBox: RuleBox;
  highlightFieldKey?: string | null;
}) {
  return (
    <>
      {page.lines.map((line, li) => {
        const segs = groupRuns(line.runs);
        // The line div is a REAL block box (true top/height), so browser text
        // extraction can distinguish visual lines. External editor copy is
        // intercepted and serialized from logical fields instead; paint wraps
        // must never become hard paragraph boundaries. Fixed-width inline
        // segments share the browser's native baseline while margins preserve
        // every engine x.
        const lineTop = segs.length
          ? Math.min(...segs.map((s) => line.baseline - browserFaceBox(s.family, s.face).ascent * s.size))
          : line.baseline - 10;
        const lineBottom = segs.length
          ? Math.max(...segs.map((s) => line.baseline + browserFaceBox(s.family, s.face).descent * s.size))
          : line.baseline;
        return (
          <div
            key={li}
            className="tsd-line"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: unit(lineTop),
              height: unit(lineBottom - lineTop),
              fontSize: 0,
              lineHeight: 0,
              whiteSpace: "pre",
              "--tsd-line-baseline": unit(line.baseline - lineTop),
              // Selection bands use owned leading because the div measures only ink.
              ...(line.leading === undefined
                ? {}
                : { "--tsd-line-leading": unit(line.leading) }),
              ...(line.paragraphSpaceBefore === undefined
                ? {}
                : { "--tsd-paragraph-space-before": unit(line.paragraphSpaceBefore) }),
              ...(line.paragraphSpaceAfter === undefined
                ? {}
                : { "--tsd-paragraph-space-after": unit(line.paragraphSpaceAfter) })
            } as React.CSSProperties}
          >
            {segs.map((seg, si) => {
              const box = browserFaceBox(seg.family, seg.face);
              const font = fontFace(seg.family, seg.face);
              const key = seg.src ? fieldKey(seg.src) : undefined;
              const highlighted = Boolean(key && key === highlightFieldKey && !seg.marker);
              const previousEnd = si > 0 ? segs[si - 1].end : 0;
              const style: React.CSSProperties = {
                display: "inline-block",
                verticalAlign: "baseline",
                marginLeft: unit(seg.x - previousEnd),
                width: unit(seg.end - seg.x),
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
              if (seg.href) {
                return (
                  <a
                    key={si}
                    href={seg.href}
                    target="_blank"
                    rel="noreferrer"
                    data-tsdf={key}
                    data-tsde={seg.text ? undefined : "1"}
                    className={highlighted ? "tsd-run--highlighted" : undefined}
                    style={{ ...style, color: "#000", textDecoration: "none" }}
                  >
                    {seg.text || EMPTY_EDITABLE_PLACEHOLDER}
                  </a>
                );
              }
              return (
                <span
                  key={si}
                  data-tsdf={key}
                  data-tsde={seg.text ? undefined : "1"}
                  data-tsdm={seg.marker ? "1" : undefined}
                  className={highlighted ? "tsd-run--highlighted" : undefined}
                  style={style}
                >
                  {seg.text || EMPTY_EDITABLE_PLACEHOLDER}
                </span>
              );
            })}
            {separators[li] ? (
              <span data-tsds="1" contentEditable={false} style={{ whiteSpace: "pre" }}>
                {separators[li]}
              </span>
            ) : null}
            {/* Links and explicit underlines use an engine-painted rule with the
                same device-pixel snapping as section rules, grouped by the shared
                span owner so it runs through interior spaces and never steps
                mid-phrase. Browser text-decoration is not involved. */}
            {underlineSpans(line.runs).map((span, ui) => {
              const ul = underlineRule(span.style);
              return (
                <div
                  key={`u${ui}`}
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: unit(span.x),
                    width: unit(span.width),
                    ...ruleBox(line.baseline + ul.offset, ul.thickness, lineTop),
                    background: "#000",
                    pointerEvents: "none"
                  }}
                />
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
  highlightFieldKey,
  documentKind = "resume"
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
  documentKind?: "resume" | "cover-letter";
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
    const next =
      documentKind === "cover-letter"
        ? layoutCoverLetter(schema, docStyle)
        : layoutResume(schema, docStyle);
    setDoc(next);
    onPageCount?.(next.pages.length);
    onDoc?.(next);
  }, [loadedFamily, family, schema, docStyle, onPageCount, onDoc, documentKind]);

  const separators = useMemo(() => (doc ? lineSeparators(doc.pages) : []), [doc]);

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
      aria-label={editable ? (documentKind === "cover-letter" ? "Cover letter editor" : "Resume editor") : undefined}
    >
      {doc.pages.map((page, i) => (
        <div
          key={i}
          className="tsd-page"
          data-tsd-page={i}
          role="document"
          aria-label={`${documentKind === "cover-letter" ? "Cover letter" : "Resume"} page ${i + 1}`}
          style={{ position: "relative", overflow: "hidden", width: unit(PAGE_WIDTH_BP), height: unit(PAGE_HEIGHT_BP) }}
        >
          <PageLines
            page={page}
            separators={separators[i] ?? []}
            unit={unit}
            ruleBox={ruleBox}
            highlightFieldKey={highlightFieldKey}
          />
        </div>
      ))}
    </div>
  );
}
