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

import { PDFDocument, PDFName, PDFString, setCharacterSpacing, type PDFFont, type PDFPage, type PDFRef } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

import { DOCUMENT_FONT_FAMILIES, type DocumentFontFamily } from "../fontRegistry.ts";
import type { FaceName } from "../metrics.gen.ts";
import { PAGE_HEIGHT_BP as PAGE_H, PAGE_WIDTH_BP as PAGE_W } from "../blocks.ts";
import type { LayoutDocument } from "../layout.ts";
import { underlineRule } from "../measure.ts";

// The committed webfonts are woff2 (CSS only); a woff2 byte stream is not a
// valid PDF font program. The build ships a decompressed sfnt sibling per face
// for embedding — Latin Modern as CFF/OTF, the Source families as TrueType.
const SFNT_EXT: Record<DocumentFontFamily, "otf" | "ttf"> = {
  "latin-modern": "otf",
  "source-serif": "ttf",
  "source-sans": "ttf"
};

const faceKey = (family: DocumentFontFamily, face: FaceName) => `${family}:${face}`;

// Resolve a face's embeddable sfnt URL from the single source of truth in the
// font registry (its woff2 assetPath) so filenames never drift.
function sfntUrl(family: DocumentFontFamily, face: FaceName, base: string): string {
  const woff2 = DOCUMENT_FONT_FAMILIES[family].faces[face].assetPath; // /fonts/<name>.woff2
  const file = woff2.replace(/^\/fonts\//, "").replace(/\.woff2$/i, `.${SFNT_EXT[family]}`);
  return `${base}/${file}`;
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

// Browser-side loader: fetch the sfnt files the document needs from the same
// origin the app already serves fonts from.
export async function fetchFontBytes(doc: LayoutDocument, base = "/fonts"): Promise<FontBytes> {
  const entries = await Promise.all(
    usedFaces(doc).map(async ({ family, face }) => {
      const url = sfntUrl(family, face, base);
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

  // Embed lazily — only faces the document draws — and WITHOUT subsetting:
  // @pdf-lib/fontkit's CFF subsetter emits font programs some viewers cannot
  // parse (glyphs silently fall back to a generic sans). The shipped sfnt files
  // are already reduced to the engine's supported repertoire, so full embedding
  // stays small while keeping a valid, standalone font program.
  const embedded = new Map<string, PDFFont>();
  const fontFor = async (family: DocumentFontFamily, face: FaceName): Promise<PDFFont> => {
    const key = faceKey(family, face);
    let f = embedded.get(key);
    if (!f) {
      const bytes = fonts.get(key);
      if (!bytes) throw new Error(`missing embedded font for ${key}`);
      f = await pdf.embedFont(bytes, { subset: false });
      embedded.set(key, f);
    }
    return f;
  };

  for (const layoutPage of doc.pages) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    const annots: PDFRef[] = [];
    // Character spacing (letter tracking) the engine folded into each run's
    // width. drawText wraps its glyphs in q…Q, so a Tc set on the page's
    // graphics state before the call carries into it; set it only when it
    // changes. A fresh page content stream starts at the Tc=0 default.
    let currentTracking = 0;
    for (const line of layoutPage.lines) {
      // PDF's y axis grows upward; engine baselines are measured from the top.
      const y = PAGE_H - line.baseline;
      for (const run of line.runs) {
        if (run.text) {
          if (run.style.tracking !== currentTracking) {
            page.pushOperators(setCharacterSpacing(run.style.tracking));
            currentTracking = run.style.tracking;
          }
          page.drawText(run.text, {
            x: run.x,
            y,
            size: run.style.size,
            font: await fontFor(run.style.family, run.style.face)
          });
        }
        // A link OR an explicit underline mark draws the same engine-painted
        // rule (TeX \underline geometry, shared with the DOM painter). Only a
        // link also gets a clickable annotation over the run's box.
        if (run.href || run.underline) {
          const ul = underlineRule(run.text.trimEnd(), run.style);
          page.drawRectangle({ x: run.x, y: y - ul.offset - ul.thickness, width: run.width, height: ul.thickness });
        }
        if (run.href) {
          const ul = underlineRule(run.text.trimEnd(), run.style);
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

function setAnnots(page: PDFPage, annots: PDFRef[]) {
  page.node.set(PDFName.of("Annots"), page.doc.context.obj(annots));
}
