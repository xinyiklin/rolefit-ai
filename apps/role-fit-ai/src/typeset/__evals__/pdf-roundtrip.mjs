// Offline, deterministic probe: the PDF backend must faithfully serialize the
// engine's layout. Round trip: layoutResume(fixture) → emitPdf → pdf.js text
// extraction → every glyph run's {page, x, baseline} matches the layout within
// 0.2bp, links carry annotations, and the text layer is searchable. The layout
// itself is separately gated by vertical-layout-snapshot.mjs, so passing both
// means engine-PDF ≡ engine-layout ≡ the layout we intend.
//
//   node src/typeset/__evals__/pdf-roundtrip.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  COVER_LETTER_STYLE_DEFAULTS,
  coverLetterStyleToDocumentStyle,
  coverLetterResumeData
} from "@typeset/engine/lib/coverLetter.ts";
import { DOC_STYLE_DEFAULTS } from "@typeset/engine/lib/documentStyle.ts";
import { buildStarterResume } from "@typeset/engine/sampleResume.ts";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";
import { DOCUMENT_FONT_FAMILIES, sfntAssetFile } from "@typeset/engine/typeset/fontRegistry.ts";
import { layoutCoverLetter, layoutResume } from "@typeset/engine/typeset/layout.ts";
import { emitPdf } from "@typeset/engine/typeset/pdf/emit.ts";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

// The engine's starter supplies the real resume structure. The first bullet
// deliberately covers the last emitted face and paint contracts the starter
// otherwise leaves implicit: bold italic, accents, shaping, an explicit link,
// and a continuous underline.
const starter = buildStarterResume();
starter.sections[1].items[0].bullets[0].text =
  "<b><i>Efficient AVA café résumé workflow</i></b> with "
  + "<u><link=https://example.test/pdf-audit>one underlined link</link></u>.";
const schema = toTypesetSchema(starter);
const auditDir = process.env.ROLEFIT_PDF_AUDIT_DIR?.trim();
if (auditDir) mkdirSync(auditDir, { recursive: true });
const retainAuditPdf = (file, value) => {
  if (auditDir) writeFileSync(join(auditDir, file), value);
};


// Node-side bytes from the engine package's exact sfnt siblings. The woff2 -> sfnt
// filename is resolved by the registry's own `sfntAssetFile`, not re-derived here:
// this eval is the last place that would notice a family whose PDF sibling is a
// different outline flavour than assumed.
const fonts = new Map();
for (const [family, config] of Object.entries(DOCUMENT_FONT_FAMILIES)) {
  for (const face of Object.keys(config.faces)) {
    const path = fileURLToPath(
      import.meta.resolve(`@typeset/engine/fonts/${sfntAssetFile(family, face)}`)
    );
    fonts.set(`${family}:${face}`, new Uint8Array(readFileSync(path)));
  }
}

const layout = layoutResume(schema, DOC_STYLE_DEFAULTS);
const bytes = await emitPdf(layout, fonts, { title: "roundtrip probe" });
retainAuditPdf("representative-resume-default.pdf", bytes);

// Every PDF face, including the metric-preserving Latin Modern conversion, is
// a TrueType sfnt. Lock the serialized declaration: the former post-save CFF
// rewrite produced a name-keyed/CID-keyed hybrid that Firefox PDF.js 6 rendered
// as missing or remapped glyphs even though older parsers extracted its text.
const emitted = await PDFDocument.load(bytes.slice());
const name = (value) => PDFName.of(value);
let latinModernFonts = 0;
let invalidLatinModernDeclarations = 0;
for (const [, object] of emitted.context.enumerateIndirectObjects()) {
  if (!(object instanceof PDFDict)) continue;
  if (String(object.get(name("Subtype"))) !== "/CIDFontType2") continue;
  if (!String(object.get(name("BaseFont"))).startsWith("/LM")) continue;
  latinModernFonts += 1;
  const descriptor = object.lookup(name("FontDescriptor"), PDFDict);
  const fontFile = descriptor.get(name("FontFile2"));
  const stream = fontFile ? emitted.context.lookup(fontFile, PDFRawStream) : null;
  if (
    !fontFile ||
    !stream ||
    descriptor.has(name("FontFile3")) ||
    String(object.get(name("CIDToGIDMap"))) !== "/Identity"
  ) {
    invalidLatinModernDeclarations += 1;
  }
}

// Embedded-font validity: pdf.js reports unparseable font programs only as a
// console warning while silently substituting a fallback face — extraction
// still "works", so positions alone can't catch it (it DID happen: the
// @pdf-lib/fontkit subsetter emitted CFF that viewers rejected). Trap the
// warning and fail hard.
const fontWarnings = [];
const origWarn = console.log;
console.log = (...args) => {
  const msg = args.join(" ");
  if (/Unable to detect correct font file|FormatError|Failed to load font/i.test(msg)) fontWarnings.push(msg);
  else origWarn(...args);
};

// Bare specifier so Node's resolver climbs to wherever npm hoisted the
// package (pdfjs-dist has no exports map, so deep subpaths resolve legacily).
// A hardcoded node_modules path broke when the repo became a workspace.
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false, isEvalSupported: false }).promise;

let failures = 0;
let checked = 0;
let annots = 0;
if (!latinModernFonts || invalidLatinModernDeclarations) {
  console.error(
    `TrueType declarations: ${invalidLatinModernDeclarations} invalid across ${latinModernFonts} Latin Modern fonts`
  );
  failures += 1;
}
for (let p = 1; p <= doc.numPages; p += 1) {
  const page = await doc.getPage(p);
  annots += (await page.getAnnotations()).filter((a) => a.subtype === "Link").length;
  const tc = await page.getTextContent();
  const items = tc.items
    .filter((it) => it.str.trim())
    .map((it) => ({ x: it.transform[4], y: 792 - it.transform[5], text: it.str }));
  const expect = layout.pages[p - 1].lines.flatMap((line) => line.runs
    .filter((run) => run.text)
    .map((run) => ({ x: run.x, y: line.baseline, text: run.text })));
  for (const e of expect) {
    checked += 1;
    const hit = items.find(
      (it) => Math.abs(it.x - e.x) <= 0.2 && Math.abs(it.y - e.y) <= 0.2 && it.text.startsWith(e.text.slice(0, 8))
    );
    if (!hit) {
      failures += 1;
      if (failures <= 5) console.error(`MISSING run p${p} (${e.x.toFixed(1)}, ${e.y.toFixed(1)}) "${e.text.slice(0, 30)}"`);
    }
  }
}

console.log = origWarn;
if (fontWarnings.length) {
  console.error(`embedded font programs rejected by pdf.js (${fontWarnings.length} warnings): ${fontWarnings[0]}`);
  failures += 1;
}

const expectedLinks = layout.pages.flatMap((pg) => pg.lines.flatMap((l) => l.runs.filter((r) => r.href))).length;
if (annots !== expectedLinks) {
  console.error(`link annotations: ${annots} !== expected ${expectedLinks}`);
  failures += 1;
}

// Floors: a corrupt/truncated fixture (or an emitter regression that silently
// produces zero output) must fail loudly instead of an all-zero "clean" pass.
// This fixture's contact info always yields at least one automatic link
// (email/github), so expectedLinks > 0 and annots must be too.
if (checked === 0) {
  console.error("pdf-roundtrip: 0 runs checked — the starter document produced no text runs");
  failures += 1;
}
if (expectedLinks === 0) {
  console.error("pdf-roundtrip: expected 0 links from the layout — the fixture's contact info should always yield at least one automatic link (email/github)");
  failures += 1;
} else if (annots === 0) {
  console.error("pdf-roundtrip: 0 link annotations emitted though the layout expected some — the PDF link-annotation path silently produced nothing");
  failures += 1;
}

// ---- every family embeds and extracts ----
//
// The checks above run the fixture in its own family (Latin Modern, CFF). Font
// EMBEDDING is per-font-program work: @pdf-lib/fontkit subsets and rewrites each
// face's tables, and it has failed on specific programs before (the CFF subsetter
// emitted output viewers rejected). A family whose faces cannot be embedded would
// pass every layout and shaping check and then break only at Export PDF, so each
// one is emitted and re-extracted here.
const familyFailures = [];
for (const family of Object.keys(DOCUMENT_FONT_FAMILIES)) {
  const familyLayout = layoutResume(schema, {
    ...DOC_STYLE_DEFAULTS,
    fontFamily: family
  });
  const usedFaces = new Set(
    familyLayout.pages.flatMap((page) =>
      page.lines.flatMap((line) =>
        line.runs
          .filter((run) => run.style.family === family)
          .map((run) => run.style.face)
      )
    )
  );
  const missingFaces = Object.keys(DOCUMENT_FONT_FAMILIES[family].faces)
    .filter((face) => !usedFaces.has(face));
  if (missingFaces.length) {
    familyFailures.push(`${family}: fixture did not paint ${missingFaces.join(", ")}`);
  }
  const familyBytes = await emitPdf(familyLayout, fonts, { title: `roundtrip ${family}` });
  retainAuditPdf(`representative-resume-${family}.pdf`, familyBytes);
  if (!familyBytes?.length) {
    familyFailures.push(`${family}: emitPdf produced no bytes`);
    continue;
  }
  const warnings = [];
  const restore = console.log;
  console.log = (...args) => {
    const message = args.join(" ");
    if (/Unable to detect correct font file|FormatError|Failed to load font/i.test(message)) warnings.push(message);
    else restore(...args);
  };
  let extracted = 0;
  try {
    const familyDoc = await pdfjs.getDocument({
      data: familyBytes.slice(),
      useWorkerFetch: false,
      isEvalSupported: false
    }).promise;
    for (let p = 1; p <= familyDoc.numPages; p += 1) {
      const content = await (await familyDoc.getPage(p)).getTextContent();
      extracted += content.items.filter((item) => item.str.trim()).length;
    }
  } finally {
    console.log = restore;
  }
  if (warnings.length) familyFailures.push(`${family}: pdf.js rejected an embedded program — ${warnings[0]}`);
  // The fixture is a full resume, so an empty text layer means the glyphs went in
  // as unextractable shapes rather than searchable text.
  if (extracted < 20) familyFailures.push(`${family}: only ${extracted} extractable text items`);
}
if (familyFailures.length) {
  for (const message of familyFailures) console.error(`FAMILY ${message}`);
  failures += familyFailures.length;
}

// A separate cover-letter export proves the plain-paragraph adapter and shared
// paginator, not only the resume schema. Enough deterministic paragraphs are
// used to cross a page boundary; the first carries the same link/underline and
// shaping stress as the resume fixture.
const coverParagraphs = Array.from(
  { length: 36 },
  (_, index) => index === 0
    ? "<b><i>Efficient AVA café résumé workflow</i></b> with "
      + "<u><link=https://example.test/cover-audit>one underlined link</link></u>."
    : `Deterministic cover-letter paragraph ${index + 1} keeps pagination stable.`
);
const coverLayout = layoutCoverLetter(
  toTypesetSchema(coverLetterResumeData(coverParagraphs, starter.header)),
  coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS)
);
const coverBytes = await emitPdf(coverLayout, fonts, { title: "roundtrip cover letter" });
retainAuditPdf("representative-cover-letter.pdf", coverBytes);
const coverDoc = await pdfjs.getDocument({
  data: coverBytes.slice(),
  useWorkerFetch: false,
  isEvalSupported: false
}).promise;
let coverTextItems = 0;
let coverLinks = 0;
for (let pageNumber = 1; pageNumber <= coverDoc.numPages; pageNumber += 1) {
  const page = await coverDoc.getPage(pageNumber);
  coverTextItems += (await page.getTextContent()).items.filter((item) => item.str.trim()).length;
  coverLinks += (await page.getAnnotations()).filter((annotation) => annotation.subtype === "Link").length;
}
if (coverDoc.numPages < 2) {
  console.error(`cover letter: expected multiple pages, emitted ${coverDoc.numPages}`);
  failures += 1;
}
if (coverTextItems < coverParagraphs.length || coverLinks < 1) {
  console.error(
    `cover letter: ${coverTextItems} text items and ${coverLinks} links across ${coverDoc.numPages} pages`
  );
  failures += 1;
}

if (failures) {
  console.error(`pdf-roundtrip: ${failures} failures (${checked} runs checked)`);
  process.exit(1);
}
console.log(
  `pdf-roundtrip: ${checked} runs at exact positions, ${annots} link annotations, text layer searchable; ` +
    `all ${Object.keys(DOCUMENT_FONT_FAMILIES).length} families × 6 faces embed and re-extract; ` +
    `${coverDoc.numPages}-page cover letter stays searchable`
);
