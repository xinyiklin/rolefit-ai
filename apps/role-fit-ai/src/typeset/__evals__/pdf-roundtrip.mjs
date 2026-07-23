// Offline, deterministic probe: the PDF backend must faithfully serialize the
// engine's layout. Round trip: layoutResume(fixture) → emitPdf → pdf.js text
// extraction → every glyph run's {page, x, baseline} matches the layout within
// 0.2bp, links carry annotations, and the text layer is searchable. The layout
// itself is separately gated against Tectonic (vertical-parity), so passing
// both means engine-PDF ≡ engine-layout ≡ TeX.
//
//   node src/typeset/__evals__/pdf-roundtrip.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DOC_STYLE_DEFAULTS } from "@typeset/engine/lib/documentStyle.ts";
import { DOCUMENT_FONT_FAMILIES } from "@typeset/engine/typeset/fontRegistry.ts";
import { layoutResume } from "@typeset/engine/typeset/layout.ts";
import { emitPdf } from "@typeset/engine/typeset/pdf/emit.ts";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

const here = dirname(fileURLToPath(import.meta.url));
const truth = JSON.parse(readFileSync(join(here, "vertical-truth.json"), "utf8"));

const TEX_PT = 72 / 72.27;
const gap = (value) => value * 11 * TEX_PT;
const legacyStyle = (style) => ({
  ...DOC_STYLE_DEFAULTS,
  lineHeight: style.lineHeight,
  nameContactGapPt: (1 + (style.nameContactGap - 0.04) * 10) * TEX_PT,
  contactGapPt: style.contactGap * 10 * TEX_PT,
  headerSectionGapPt: (style.headerSectionGap - 1.19 + 0.85) * 11 * TEX_PT,
  sectionGapPt: gap(style.sectionGap),
  sectionEntryGapPt: gap(style.sectionEntryGap),
  entryGapPt: gap(style.entryGap),
  titleSubGapPt: gap(style.titleSubGap),
  headBulletGapPt: gap(style.headBulletGap),
  skillsRowGapPt: style.skillsRowGap * 10 * TEX_PT,
  bulletGapPt: gap(style.bulletGap),
  headingCase: style.headingCase,
  sectionRule: style.sectionRule,
  contactDivider: style.contactDivider,
  headerAlign: style.headerAlign,
  bodyAlign: style.bodyAlign,
  headingAlign: style.headingAlign,
  nameSize: style.nameSize,
  pageMargins: style.pageMargins
});
const entriesFor = (section, sectionIndex) => section.type === "skills"
  ? section.items.flatMap((item, itemIndex) => item.bullets.map((row, rowIndex) => {
      const split = row.indexOf(":");
      return {
        id: `skill-${sectionIndex}-${itemIndex}-${rowIndex}`,
        titleLeft: split >= 0 ? row.slice(0, split).trim() : "",
        titleRight: "",
        subtitleLeft: split >= 0 ? row.slice(split + 1).trim() : row,
        subtitleRight: "",
        bullets: [],
        bulletIds: []
      };
    }))
  : section.items.map((item, itemIndex) => ({
      id: item.id ?? `entry-${sectionIndex}-${itemIndex}`,
      titleLeft: item.title ?? "",
      titleRight: item.meta ?? "",
      subtitleLeft: item.subtitle ?? "",
      subtitleRight: item.location ?? "",
      bullets: item.bullets,
      bulletIds: item.bullets.map((_, bulletIndex) => `bullet-${sectionIndex}-${itemIndex}-${bulletIndex}`)
    }));
const typesetSchema = (schema) => ({
  name: schema.name,
  contact: schema.contact,
  sections: schema.sections.map((section, sectionIndex) => ({
    id: section.id ?? `section-${sectionIndex}`,
    heading: section.heading,
    type: section.type ?? "standard",
    items: entriesFor(section, sectionIndex)
  }))
});

// Node-side bytes from the engine package's exact sfnt siblings.
const fonts = new Map();
for (const [family, config] of Object.entries(DOCUMENT_FONT_FAMILIES)) {
  const extension = family === "latin-modern" ? "otf" : "ttf";
  for (const [face, info] of Object.entries(config.faces)) {
    const file = info.assetPath.replace(/^\/fonts\//, "").replace(/\.woff2$/i, `.${extension}`);
    const path = fileURLToPath(import.meta.resolve(`@typeset/engine/fonts/${file}`));
    fonts.set(`${family}:${face}`, new Uint8Array(readFileSync(path)));
  }
}

const layout = layoutResume(typesetSchema(truth.schema), legacyStyle(truth.docStyle));
const bytes = await emitPdf(layout, fonts, { title: "roundtrip probe" });

// pdf-lib 1.17.1 misidentifies OpenType/CFF as TrueType when paired with the
// current @pdf-lib/fontkit public shape. The emitter corrects those PDF resource
// declarations after drawing. Lock the actual serialized contract so a future
// refactor cannot reintroduce Poppler's font-type mismatch warnings.
const emitted = await PDFDocument.load(bytes.slice());
const name = (value) => PDFName.of(value);
let latinModernFonts = 0;
let invalidLatinModernDeclarations = 0;
for (const [, object] of emitted.context.enumerateIndirectObjects()) {
  if (!(object instanceof PDFDict)) continue;
  if (String(object.get(name("Subtype"))) !== "/CIDFontType0") continue;
  if (!String(object.get(name("BaseFont"))).startsWith("/LM")) continue;
  latinModernFonts += 1;
  const descriptor = object.lookup(name("FontDescriptor"), PDFDict);
  const fontFile = descriptor.get(name("FontFile3"));
  const stream = fontFile ? emitted.context.lookup(fontFile, PDFRawStream) : null;
  const subtype = stream?.dict.get(name("Subtype"));
  if (!fontFile || String(subtype) !== "/OpenType" || descriptor.has(name("FontFile2"))) {
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
    `OpenType/CFF declarations: ${invalidLatinModernDeclarations} invalid across ${latinModernFonts} Latin Modern fonts`
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
  console.error("pdf-roundtrip: 0 runs checked — vertical-truth.json fixture is missing/corrupt or the layout produced no text runs");
  failures += 1;
}
if (expectedLinks === 0) {
  console.error("pdf-roundtrip: expected 0 links from the layout — the fixture's contact info should always yield at least one automatic link (email/github)");
  failures += 1;
} else if (annots === 0) {
  console.error("pdf-roundtrip: 0 link annotations emitted though the layout expected some — the PDF link-annotation path silently produced nothing");
  failures += 1;
}

if (failures) {
  console.error(`pdf-roundtrip: ${failures} failures (${checked} runs checked)`);
  process.exit(1);
}
console.log(`pdf-roundtrip: ${checked} runs at exact positions, ${annots} link annotations, text layer searchable`);
