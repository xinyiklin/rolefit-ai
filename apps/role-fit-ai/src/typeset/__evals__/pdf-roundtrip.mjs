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

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const { layoutResume } = await import(join(here, "../layout.ts"));
const { emitPdf, FONT_FILES } = await import(join(here, "../pdf/emit.ts"));

const truth = JSON.parse(readFileSync(join(here, "vertical-truth.json"), "utf8"));

// Node-side font bytes from the same files the app serves.
const fonts = Object.fromEntries(
  Object.entries(FONT_FILES).map(([face, file]) => [face, new Uint8Array(readFileSync(join(root, "public/fonts", file)))])
);

const layout = layoutResume(truth.schema, truth.docStyle);
const bytes = await emitPdf(layout, fonts, { title: "roundtrip probe" });

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
for (let p = 1; p <= doc.numPages; p += 1) {
  const page = await doc.getPage(p);
  annots += (await page.getAnnotations()).filter((a) => a.subtype === "Link").length;
  const tc = await page.getTextContent();
  const items = tc.items
    .filter((it) => it.str.trim())
    .map((it) => ({ x: it.transform[4], y: 792 - it.transform[5], text: it.str }));
  const expect = layout.pages[p - 1].lines.flatMap((line) => line.runs.map((r) => ({ x: r.x, y: line.baseline, text: r.text })));
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

if (failures) {
  console.error(`pdf-roundtrip: ${failures} failures (${checked} runs checked)`);
  process.exit(1);
}
console.log(`pdf-roundtrip: ${checked} runs at exact positions, ${annots} link annotations, text layer searchable`);
