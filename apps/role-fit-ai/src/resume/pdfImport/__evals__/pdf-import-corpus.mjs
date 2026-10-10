// Offline PDF-import benchmark and regression gate. Every fixture is synthetic
// and generated here, so no PDF is committed:
//   - engine fixtures render known ResumeData through the Typeset engine;
//   - "foreign" fixtures draw Word/Docs-style layouts with pdf-lib from a spec
//     that is also the expected structure;
//   - refusal fixtures cover non-PDF, oversized, malformed, image-only,
//     over-long, encrypted, and unreadable input.
// Hard gates: zero characters lost or added, no markup injection, strict
// .resume round trip, PDF export of the import, determinism, and the refusal
// kinds. Benchmark gates: field precision/recall and reading order.
//
//   node apps/role-fit-ai/src/resume/pdfImport/__evals__/pdf-import-corpus.mjs
//   PDF_IMPORT_VERBOSE=1 … prints every miss.
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { parseResumeFile, serializeResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import { layoutResume } from "@typeset/engine/typeset/layout.ts";
import { emitPdf } from "@typeset/engine/typeset/pdf/emit.ts";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";
import { importResumePdf } from "../importResumePdf.ts";
import { MAX_IMPORT_PDF_BYTES, PdfImportError } from "../importErrors.ts";
import {
  TIMES,
  engineFixtures,
  engineFonts,
  findingShape,
  foreignFixtures,
  foreignTruth,
  keyPosition,
  renderEngineFixture,
  renderForeign,
  score,
  strip
} from "./support/importCorpus.mjs";

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const verbose = Boolean(process.env.PDF_IMPORT_VERBOSE);

// ── Run ─────────────────────────────────────────────────────────────────────
const failures = [];
const totals = { single: {}, hard: {} };
const orders = [];
const timings = [];

async function runFixture(name, group, bytes, truth, expectations = {}) {
  const started = performance.now();
  let result;
  try {
    result = await importResumePdf(bytes, pdfjs);
  } catch (error) {
    failures.push(`${name}: import failed (${error?.kind ?? ""}) ${error?.message ?? error}`);
    return;
  }
  timings.push(performance.now() - started);
  const { data, style, findings, audit } = result;
  if (!audit.ok) failures.push(`${name}: audit lost=${audit.lost.join(",")} added=${audit.added.join(",")}`);

  const scored = score(truth, data);
  orders.push(scored.order);
  for (const [cls, counts] of Object.entries(scored.perClass)) {
    const bucket = (totals[group][cls] ??= { tp: 0, predicted: 0, truth: 0 });
    bucket.tp += counts.tp;
    bucket.predicted += counts.predicted;
    bucket.truth += counts.truth;
  }
  if (verbose && scored.misses.length) console.log(`  ${name}\n    ${scored.misses.join("\n    ")}`);

  // Strict .resume round trip and PDF export of the imported document.
  const reopened = parseResumeFile(serializeResumeFile(data, style));
  try {
    assert.deepEqual(strip(reopened.data), strip(data));
    assert.deepEqual(reopened.documentStyle, style);
  } catch {
    failures.push(`${name}: .resume round trip changed the document`);
  }
  try {
    await emitPdf(layoutResume(toTypesetSchema(data), style), engineFonts, { title: name });
  } catch (error) {
    failures.push(`${name}: exporting the imported document failed: ${error.message}`);
  }

  // Determinism: the same bytes import to the same document.
  const again = await importResumePdf(bytes, pdfjs);
  try {
    assert.deepEqual(strip(again.data), strip(data));
    assert.deepEqual(again.findings.map((finding) => findingShape(again.data, finding)), findings.map((finding) => findingShape(data, finding)));
  } catch {
    failures.push(`${name}: import is not deterministic`);
  }

  for (const finding of findings) {
    if (finding.kind === "check" && keyPosition(data, finding.fieldKey) === null) failures.push(`${name}: a Check names no field (${finding.fieldKey})`);
  }
  if (verbose) for (const finding of findings) console.log(`    ${finding.kind}: ${finding.reason} — ${finding.kind === "unplaced" ? finding.text : `${keyPosition(data, finding.fieldKey)} "${finding.source}"`}`);

  if (expectations.tagLike) {
    const texts = JSON.stringify(data);
    const listed = findings.some((finding) => finding.kind === "unplaced" && finding.text.includes(expectations.tagLike));
    if (!listed || texts.includes("internal</b>")) failures.push(`${name}: tag-like text was not kept out of the document and listed`);
  }
  if (expectations.style) {
    for (const [key, expected] of Object.entries(expectations.style)) {
      const actual = style[key];
      const ok = typeof expected === "number" ? Math.abs(actual - expected) <= (key.includes("Top") || key.includes("Bottom") ? 10 : 6) : actual === expected;
      if (!ok) failures.push(`${name}: style.${key} ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
    }
  }
  if (expectations.unplaced) {
    const unplaced = findings.filter((finding) => finding.kind === "unplaced").map((finding) => finding.reason);
    for (const reason of expectations.unplaced) {
      if (!unplaced.includes(reason)) failures.push(`${name}: expected a Not placed item "${reason}"`);
    }
  }
  console.log(
    `${name.padEnd(42)} words ${String(audit.sourceWords).padStart(4)}  unplaced ${String(audit.unplacedWords).padStart(2)}  checks ${String(findings.filter((finding) => finding.kind === "check").length).padStart(2)}  order ${scored.order.toFixed(3)}  misses ${scored.misses.length}`
  );
}

for (const fixture of engineFixtures) {
  const { bytes, style } = await renderEngineFixture(fixture);
  await runFixture(fixture.name, "single", bytes, fixture.data, {
    style: {
      fontFamily: style.fontFamily,
      baseFontSizePt: style.baseFontSizePt,
      headerAlign: style.headerAlign,
      sectionRule: style.sectionRule,
      // Uppercase headings are imported as verbatim capitals; small caps come
      // through as the engine's Caps face.
      headingCase: style.headingCase === "smallcaps" ? "smallcaps" : "none",
      pageMarginLeftPt: style.pageMarginLeftPt,
      pageMarginRightPt: style.pageMarginRightPt
    }
  });
}

for (const fixture of foreignFixtures) {
  const bytes = await renderForeign(fixture.spec);
  await runFixture(fixture.name, fixture.group, bytes, foreignTruth(fixture.spec), {
    tagLike: fixture.tagLike,
    unplaced: fixture.spec.pageNumbers ? ["Page number."] : [],
    style: {
      fontFamily: fixture.spec.fonts === TIMES ? "tinos" : "arimo",
      headerAlign: fixture.spec.nameAlign,
      sectionRule: fixture.spec.heading.rule,
      headingCase: "none",
      pageMarginLeftPt: fixture.spec.margin ?? 54
    }
  });
}

// ── Refusals ────────────────────────────────────────────────────────────────
async function expectRefusal(name, kind, bytes, pdfjsImpl = pdfjs) {
  try {
    await importResumePdf(bytes, pdfjsImpl);
    failures.push(`${name}: expected refusal "${kind}", but it imported`);
  } catch (error) {
    if (!(error instanceof PdfImportError) || error.kind !== kind) failures.push(`${name}: expected "${kind}", got ${error?.kind ?? error}`);
    else console.log(`${name.padEnd(42)} refused: ${kind}`);
  }
}

const textBytes = new TextEncoder().encode("Jordan Rivera\nData engineer\n");
await expectRefusal("refusal/not-a-pdf", "not-pdf", textBytes);
const oversized = new Uint8Array(MAX_IMPORT_PDF_BYTES + 1);
oversized.set(new TextEncoder().encode("%PDF-1.7\n"));
await expectRefusal("refusal/too-large", "too-large", oversized);
await expectRefusal("refusal/malformed", "malformed", new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 9 0 R >>\n%%EOF garbage"));
{
  const doc = await PDFDocument.create();
  const png = await doc.embedPng(Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)));
  doc.addPage([612, 792]).drawImage(png, { x: 0, y: 0, width: 612, height: 792 });
  await expectRefusal("refusal/image-only", "no-text", await doc.save());
}
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 11; index += 1) doc.addPage([612, 792]).drawText(`Page body ${index + 1} with enough words to read.`, { x: 72, y: 700, size: 10, font });
  await expectRefusal("refusal/too-many-pages", "too-many-pages", await doc.save());
}
// pdf.js stubs for states that are impractical to author with pdf-lib.
const stub = (behavior) => ({
  OPS: pdfjs.OPS,
  getDocument: () => ({ promise: behavior(), destroy: async () => {} })
});
const pdfBytes = new TextEncoder().encode("%PDF-1.7\n");
await expectRefusal("refusal/encrypted", "encrypted", pdfBytes, stub(async () => {
  throw Object.assign(new Error("No password given"), { name: "PasswordException" });
}));
await expectRefusal("refusal/unreadable-glyphs", "unreadable", pdfBytes, stub(async () => ({
  numPages: 1,
  getPage: async () => ({
    getViewport: () => ({ width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }),
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
    getTextContent: async () => ({
      items: Array.from({ length: 8 }, (_, index) => ({ str: String.fromCharCode(0xe010 + index).repeat(6), transform: [10, 0, 0, 10, 72, 700 - index * 12], width: 40, fontName: "f1" }))
    }),
    commonObjs: { has: () => true, get: () => ({ name: "ABCDEF+CustomFont" }) }
  })
})));

// ── Report and gates ────────────────────────────────────────────────────────
const GATES = { single: 0.98, hard: 0.9 };
for (const [group, classes] of Object.entries(totals)) {
  const all = { tp: 0, predicted: 0, truth: 0 };
  const rows = Object.entries(classes).map(([cls, counts]) => {
    all.tp += counts.tp;
    all.predicted += counts.predicted;
    all.truth += counts.truth;
    const precision = counts.predicted ? counts.tp / counts.predicted : 1;
    const recall = counts.truth ? counts.tp / counts.truth : 1;
    if (precision < GATES[group] || recall < GATES[group]) failures.push(`${group} ${cls}: precision ${precision.toFixed(3)} recall ${recall.toFixed(3)} below ${GATES[group]}`);
    return `    ${cls.padEnd(8)} P ${precision.toFixed(3)}  R ${recall.toFixed(3)}  (${counts.tp}/${counts.predicted} predicted, ${counts.truth} expected)`;
  });
  console.log(`${group} fixtures (gate ${GATES[group]}):\n${rows.join("\n")}`);
}
const meanOrder = orders.reduce((sum, value) => sum + value, 0) / orders.length;
if (meanOrder < 0.98) failures.push(`reading order ${meanOrder.toFixed(3)} below 0.98`);
const sortedTimings = [...timings].sort((a, b) => a - b);
console.log(`reading order (mean LCS) ${meanOrder.toFixed(3)}; import time median ${sortedTimings[Math.floor(sortedTimings.length / 2)].toFixed(0)} ms, max ${sortedTimings[sortedTimings.length - 1].toFixed(0)} ms`);

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("pdf-import-corpus: all gates passed");
