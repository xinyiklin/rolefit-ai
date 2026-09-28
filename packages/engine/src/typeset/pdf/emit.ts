// PDF backend: serialize an engine LayoutDocument to PDF bytes. The engine has
// already decided every glyph position in bp, so this module only writes those
// decisions as PDF text operators with embedded fonts, rules as vector
// rectangles, and link annotations from GlyphRun.href — the same
// one-engine-many-backends shape as the DOM renderer (no layout happens here).
//
// This is the app's canonical "Export PDF" path (a dedicated client-side
// export), replacing the browser Print / Save-as-PDF route. It runs fully in
// the browser: the resume text never leaves the page — only the same font files
// the app already serves are fetched from the same origin.

import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFString,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSpacing,
  setFontAndSize,
  setTextMatrix,
  type PDFArray,
  type PDFContext,
  type PDFFont,
  type PDFPage,
  type PDFRef
} from "pdf-lib";
import fontkit, { type Font as ShapingFont } from "@pdf-lib/fontkit";

import { sfntAssetFile, type DocumentFontFamily } from "../fontRegistry.ts";
import type { FaceName } from "../metrics.gen.ts";
import { PAGE_HEIGHT_BP as PAGE_H, PAGE_WIDTH_BP as PAGE_W } from "../blocks.ts";
import type { LayoutDocument } from "../layout.ts";
import { underlineRule, underlineSpans } from "../measure.ts";
import { fieldKey, type GlyphRun } from "../types.ts";

const faceKey = (family: DocumentFontFamily, face: FaceName) => `${family}:${face}`;

// Resolve a face's embeddable sfnt URL from the single source of truth in the
// font registry (its woff2 assetPath plus the family's outline flavour) so
// filenames never drift.
function sfntUrl(family: DocumentFontFamily, face: FaceName, base: string): string {
  return `${base.replace(/\/+$/, "")}/${sfntAssetFile(family, face)}`;
}

// Every (family, face) the document actually paints. A resume typically uses one
// family and a handful of faces, so only those get fetched and embedded.
function usedFaces(doc: LayoutDocument): Array<{ family: DocumentFontFamily; face: FaceName }> {
  const seen = new Map<string, { family: DocumentFontFamily; face: FaceName }>();
  for (const page of doc.pages) {
    for (const line of page.lines) {
      for (const run of line.runs) {
        seen.set(faceKey(run.style.family, run.style.face), { family: run.style.family, face: run.style.face });
      }
    }
  }
  return [...seen.values()];
}

export type FontBytes = Map<string, Uint8Array>; // faceKey → sfnt bytes

// Browser-side loader: fetch the sfnt files the document needs from the host's
// deployment-aware asset base. Requiring the base prevents a shared consumer
// from silently falling back to the domain root when it is deployed below a
// path prefix (for example, a GitHub Pages project site).
export async function fetchFontBytes(doc: LayoutDocument, fontAssetBaseUrl: string): Promise<FontBytes> {
  const entries = await Promise.all(
    usedFaces(doc).map(async ({ family, face }) => {
      const url = sfntUrl(family, face, fontAssetBaseUrl);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`font fetch failed: ${url}`);
      return [faceKey(family, face), new Uint8Array(await res.arrayBuffer())] as const;
    })
  );
  return new Map(entries);
}

export async function emitPdf(
  doc: LayoutDocument,
  fonts: FontBytes,
  meta?: { title?: string }
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  if (meta?.title) pdf.setTitle(meta.title);
  pdf.setProducer("Typeset engine");
  pdf.setCreator("Typeset");

  // Embed lazily — only faces the document draws — and WITHOUT subsetting.
  // The shipped TrueType sfnt files are already reduced to the engine's
  // supported repertoire, so full embedding stays small and avoids fontkit's
  // format-sensitive subsetters while keeping a standalone font program.
  // The unsubsetted embedding keeps the font's own glyph ids as CIDs; a second
  // fontkit parse of the same bytes supplies the kerned positions of those ids.
  const embedded = new Map<string, { pdfFont: PDFFont; shaper: ShapingFont }>();
  const fontFor = async (family: DocumentFontFamily, face: FaceName) => {
    const key = faceKey(family, face);
    let f = embedded.get(key);
    if (!f) {
      const bytes = fonts.get(key);
      if (!bytes) throw new Error(`missing embedded font for ${key}`);
      f = { pdfFont: await pdf.embedFont(bytes, { subset: false }), shaper: fontkit.create(bytes) };
      embedded.set(key, f);
    }
    return f;
  };

  for (const layoutPage of doc.pages) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    const annots: PDFRef[] = [];
    const fontKeys = new Map<PDFFont, PDFName>();
    // Character spacing (letter tracking) the engine folded into each run's
    // width. Each run's text sits in q…Q, so a Tc set on the page's graphics
    // state before it carries in; set it only when it changes. A fresh page
    // content stream starts at the Tc=0 default.
    let currentTracking = 0;
    // Keep a wrapped field contiguous in the content stream; its coordinates
    // still come from physical lines, including across paired columns.
    const fields = new Map<string, Array<{ run: GlyphRun; y: number }>>();
    for (const [index, line] of layoutPage.lines.entries()) {
      for (const [ri, run] of line.runs.entries()) {
        const key = run.src ? fieldKey(run.src) : `decoration:${index}:${ri}`;
        if (!fields.has(key)) fields.set(key, []);
        fields.get(key)!.push({ run, y: PAGE_H - line.baseline });
      }
    }
    for (const fragments of fields.values()) {
      for (const { run, y } of fragments) {
        if (run.text) {
          if (run.style.tracking !== currentTracking) {
            page.pushOperators(setCharacterSpacing(run.style.tracking));
            currentTracking = run.style.tracking;
          }
          const { pdfFont, shaper } = await fontFor(run.style.family, run.style.face);
          let fontKey = fontKeys.get(pdfFont);
          if (!fontKey) {
            fontKey = page.node.newFontDictionary(pdfFont.name, pdfFont.ref);
            fontKeys.set(pdfFont, fontKey);
          }
          // q…Q per run, as drawText wrote it: pdf.js ends a text item at a
          // restore, so each run still extracts as its own item.
          page.pushOperators(
            pushGraphicsState(),
            beginText(),
            setFontAndSize(fontKey, run.style.size),
            setTextMatrix(1, 0, 0, 1, run.x, y),
            PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [kernedGlyphs(pdf.context, pdfFont, shaper, pdfSafeText(run.text))]),
            endText(),
            popGraphicsState()
          );
        }
        if (run.href) {
          const ul = underlineRule(run.style);
          annots.push(
            pdf.context.register(
              pdf.context.obj({
                Type: "Annot",
                Subtype: "Link",
                // Rect spans the run box generously (ascender to underline).
                Rect: [run.x, y - ul.offset - ul.thickness - 0.5, run.x + run.width, y + run.style.size],
                Border: [0, 0, 0],
                A: { Type: "Action", S: "URI", URI: PDFString.of(run.href) }
              })
            )
          );
        }
      }
    }
    for (const line of layoutPage.lines) {
      const y = PAGE_H - line.baseline;
      // A link OR an explicit underline mark draws the same engine-painted rule
      // as the DOM painter, grouped by the shared span owner so an underlined
      // phrase gets one continuous rule instead of one per word.
      for (const span of underlineSpans(line.runs)) {
        const ul = underlineRule(span.style);
        page.drawRectangle({
          x: span.x,
          y: y - ul.offset - ul.thickness,
          width: span.width,
          height: ul.thickness
        });
      }
      if (line.rule) {
        page.drawRectangle({
          x: line.rule.x,
          y: PAGE_H - line.rule.y - line.rule.thickness,
          width: line.rule.width,
          height: line.rule.thickness
        });
      }
    }
    if (annots.length) setAnnots(page, annots);
  }

  return pdf.save();
}

// A TJ array for one run: the embedded font's shaped glyph ids with its kern
// adjustments. A bare Tj would space glyphs by plain advances, dropping the
// pair kerning `measure()` counts (pdf-font-parity locks the two shapings).
// Ids come from pdfFont.encodeText, as drawText's did: its shaping also records
// each glyph's source text for the ToUnicode map, which keeps extraction exact.
// The same control-character cleanup pdf-lib's drawText applied, so a pasted
// tab or line separator never becomes a missing-glyph box.
function pdfSafeText(text: string): string {
  return text.replace(/[\t\u0085\u2028\u2029]/g, "    ").replace(/[\b\v\n\r]/g, "");
}

function kernedGlyphs(context: PDFContext, font: PDFFont, shaper: ShapingFont, text: string): PDFArray {
  const ids = font.encodeText(text).asString();
  const { glyphs, positions } = shaper.layout(text);
  if (ids.length !== glyphs.length * 4) throw new Error(`PDF shaping diverged for ${JSON.stringify(text)}`);
  const elements: Array<PDFHexString | PDFNumber> = [];
  let start = 0;
  for (const [i, glyph] of glyphs.entries()) {
    const kern = positions[i].xAdvance - glyph.advanceWidth;
    if (kern !== 0 && i < glyphs.length - 1) {
      // TJ numbers are thousandths of text space, subtracted from the advance.
      elements.push(PDFHexString.of(ids.slice(start, (i + 1) * 4)), PDFNumber.of((-kern * 1000) / shaper.unitsPerEm));
      start = (i + 1) * 4;
    }
  }
  if (start < ids.length) elements.push(PDFHexString.of(ids.slice(start)));
  return context.obj(elements);
}

function setAnnots(page: PDFPage, annots: PDFRef[]) {
  page.node.set(PDFName.of("Annots"), page.doc.context.obj(annots));
}
