// PDF backend: serialize an engine LayoutDocument to PDF bytes (D013 phase 3).
// The engine already decided every glyph position in bp — this module writes
// those decisions as PDF text operators with embedded, subsetted fonts, rules
// as vector rectangles, and link annotations from GlyphRun.href. Same
// one-engine-two-backends shape as the DOM renderer: no layout happens here.
//
// Runs in both the browser (client-side export) and Node (offline eval); the
// caller supplies the raw font bytes (see fontBytes helpers below).

import { PDFDocument, PDFName, PDFString, type PDFFont, type PDFPage, type PDFRef } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

import type { FaceName } from "../metrics.gen.ts";
import type { LayoutDocument } from "../layout.ts";
import { underlineRule } from "../measure.ts";

// OTF sources for embedding (the woff2 files serve CSS only): raw woff2 bytes
// are not a valid PDF font program, and @pdf-lib/fontkit's CFF handling of
// woff2-decoded fonts produced subsets pdf.js could not parse (silent
// sans-serif fallback in viewers).
export const FONT_FILES: Record<FaceName, string> = {
  regular: "LMRoman10-Regular.otf",
  bold: "LMRoman10-Bold.otf",
  italic: "LMRoman10-Italic.otf",
  boldItalic: "LMRoman10-BoldItalic.otf",
  boldDisplay: "LMRoman12-Bold.otf",
  caps: "LMRomanCaps10-Regular.otf"
};

export type FontBytes = Record<FaceName, Uint8Array>;

// Browser-side loader: fetch the same files the app already serves.
export async function fetchFontBytes(base = "/fonts"): Promise<FontBytes> {
  const entries = await Promise.all(
    (Object.keys(FONT_FILES) as FaceName[]).map(async (face) => {
      const res = await fetch(`${base}/${FONT_FILES[face]}`);
      if (!res.ok) throw new Error(`font fetch failed: ${FONT_FILES[face]}`);
      return [face, new Uint8Array(await res.arrayBuffer())] as const;
    })
  );
  return Object.fromEntries(entries) as FontBytes;
}

const PAGE_W = 612;
const PAGE_H = 792;

export async function emitPdf(
  doc: LayoutDocument,
  fonts: FontBytes,
  meta?: { title?: string }
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  if (meta?.title) pdf.setTitle(meta.title);
  pdf.setProducer("role-fit-ai typeset engine");
  pdf.setCreator("role-fit-ai");

  // Embed lazily — only faces the document actually draws — and WITHOUT
  // subsetting: @pdf-lib/fontkit's CFF subsetter emits font programs pdf.js
  // (and other viewers) cannot parse — glyphs silently fall back to a generic
  // sans with fi/fl dropped. Full embedding keeps the original, valid OTF
  // program. Cost: ~110KB per used face (~500KB PDFs); a real subsetter
  // (modern fontkit createSubset / hb-subset) is the known optimization.
  const embedded = new Map<FaceName, PDFFont>();
  const fontFor = async (face: FaceName): Promise<PDFFont> => {
    let f = embedded.get(face);
    if (!f) {
      f = await pdf.embedFont(fonts[face], { subset: false });
      embedded.set(face, f);
    }
    return f;
  };

  for (const layoutPage of doc.pages) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    const annots: PDFRef[] = [];
    for (const line of layoutPage.lines) {
      // PDF's y axis grows upward; engine baselines are from the page top.
      const y = PAGE_H - line.baseline;
      for (const run of line.runs) {
        page.drawText(run.text, {
          x: run.x,
          y,
          size: run.style.size,
          font: await fontFor(run.style.face)
        });
        if (run.href) {
          // \href{\underline{…}}: the rule hangs below the run's ink depth
          // (TeX \underline geometry — shared with the DOM painter via
          // underlineRule), plus a link annotation covering the run's box.
          const ul = underlineRule(run.text, run.style);
          page.drawRectangle({ x: run.x, y: y - ul.offset - ul.thickness, width: run.width, height: ul.thickness });
          annots.push(
            pdf.context.register(
              pdf.context.obj({
                Type: "Annot",
                Subtype: "Link",
                // Rect spans the line box generously (ascender to underline).
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
