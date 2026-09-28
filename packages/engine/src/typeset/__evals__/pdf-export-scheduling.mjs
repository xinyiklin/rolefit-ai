import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";

import { coverLetterResumeData } from "../../lib/coverLetter.ts";
import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { buildStarterResume } from "../../sampleResume.ts";
import { DOCUMENT_FONT_FAMILIES, sfntAssetFile } from "../fontRegistry.ts";
import { layoutCoverLetter, layoutResume } from "../layout.ts";
import { emitPdf } from "../pdf/emit.ts";
import { toTypesetSchema } from "../schema.ts";

const fonts = new Map();
for (const [family, config] of Object.entries(DOCUMENT_FONT_FAMILIES)) {
  for (const face of Object.keys(config.faces)) {
    fonts.set(`${family}:${face}`, new Uint8Array(readFileSync(
      new URL(`../../../fonts/${sfntAssetFile(family, face)}`, import.meta.url)
    )));
  }
}

const resume = buildStarterResume();
const bullet = resume.sections[1].items[0].bullets[0];
// Five font faces plus links exercise pdf-lib's default serialization yield.
bullet.text = `<b><i>${bullet.text}</i></b> ` + Array.from(
  { length: 7 }, (_, index) => `<link=https://example.test/${index}>Reference${index}</link>`
).join(" ");
const cover = coverLetterResumeData(
  Array.from({ length: 12 }, () => "A synthetic cover-letter paragraph for export testing. ".repeat(8)),
  resume.header
);

let checked = 0;
for (const family of Object.keys(DOCUMENT_FONT_FAMILIES)) {
  const style = { ...DOC_STYLE_DEFAULTS, fontFamily: family };
  for (const layout of [
    layoutResume(toTypesetSchema(resume), style),
    layoutCoverLetter(toTypesetSchema(cover), style)
  ]) {
    const nativeTimeout = globalThis.setTimeout;
    let bytes;
    try {
      // A background tab may not service timers promptly. Fail instead of
      // waiting on one, so this check needs no wall-clock deadline.
      globalThis.setTimeout = () => {
        throw new Error("PDF export must complete without timer callbacks");
      };
      bytes = await emitPdf(layout, fonts, { title: "Export scheduling probe" });
    } finally {
      globalThis.setTimeout = nativeTimeout;
    }
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), "%PDF-");
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), layout.pages.length);
    checked += 1;
  }
}

console.log(`pdf-export-scheduling: ${checked} resume/cover exports complete without timer callbacks`);
