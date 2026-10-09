// Focused probes for the PDF importer's building blocks. The audit probes are
// mutation checks in miniature: each feeds a deliberately unfaithful document
// and requires the audit to fail, because the AI path relies on that audit to
// reject invented, duplicated, or dropped text.
//
//   node apps/role-fit-ai/src/resume/pdfImport/__evals__/pdf-import-units.mjs
import assert from "node:assert/strict";
import { auditImport } from "../importAudit.ts";
import { familyForFont } from "../importStyle.ts";
import { renderField, splitOnSeparators } from "../fieldText.ts";
import { layoutLines, slicePiece } from "../layoutLines.ts";
import { isDateLike } from "../resumeFromLayout.ts";
import { readPdfLayout } from "../pdfLayout.ts";

let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

let spanId = 0;
const span = (text, x, y, extra = {}) => ({
  id: `s${(spanId += 1)}`,
  page: 0,
  text,
  x,
  y,
  width: extra.width ?? text.length * 5,
  size: 10,
  font: "Helvetica",
  bold: false,
  italic: false,
  dingbat: false,
  smallCaps: false,
  ...extra
});
const docWith = (texts) => ({
  header: { visible: true, name: texts[0] ?? null, contact: [] },
  sections: [{ id: "x", heading: "", type: "standard", items: [{ id: "e", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: texts.slice(1).map((text, index) => ({ id: `b${index}`, text })) }] }]
});

// ── Audit ───────────────────────────────────────────────────────────────────
test("audit accepts a faithful document with markers, separators, and a label colon", () => {
  const spans = [span("Jane Doe", 0, 10), span("•", 0, 30), span("Built tools", 10, 30), span("a | b", 0, 50), span("Go:", 0, 70)];
  const audit = auditImport(
    spans,
    docWith(["Jane Doe", "Built <b>tools</b>", "a", "b", "Go"]),
    [],
    [
      { spanId: spans[1].id, text: "•", role: "marker" },
      { spanId: spans[3].id, text: "|", role: "separator" },
      { spanId: spans[4].id, text: ":", role: "label-colon" }
    ]
  );
  assert.equal(audit.ok, true, JSON.stringify(audit));
});
test("audit rejects an invented word", () => {
  const audit = auditImport([span("Built tools", 0, 0)], docWith(["", "Built internal tools"]), [], []);
  assert.equal(audit.ok, false);
  assert.ok(audit.added.length > 0);
});
test("audit rejects duplicated source text", () => {
  const audit = auditImport([span("Acme Corp", 0, 0)], docWith(["Acme Corp", "Acme Corp"]), [], []);
  assert.equal(audit.ok, false);
});
test("audit rejects text dropped without a Not placed item", () => {
  const audit = auditImport([span("Acme Corp", 0, 0), span("Page 2", 0, 700)], docWith(["Acme Corp"]), [], []);
  assert.equal(audit.ok, false);
  assert.ok(audit.lost.length > 0);
});
test("audit accepts the same text when it is listed as Not placed", () => {
  const audit = auditImport([span("Acme Corp", 0, 0), span("Page 2", 0, 700)], docWith(["Acme Corp"]), [{ kind: "unplaced", id: "f1", text: "Page 2", reason: "Page number.", page: 0 }], []);
  assert.equal(audit.ok, true);
  assert.equal(audit.unplacedWords, 2);
});
test("audit rejects content smuggled out as a consumed marker or separator", () => {
  const spans = [span("Senior", 0, 0), span("Engineer", 40, 0)];
  assert.equal(auditImport(spans, docWith(["Engineer"]), [], [{ spanId: spans[0].id, text: "Senior", role: "marker" }]).ok, false);
  assert.equal(auditImport(spans, docWith(["Engineer"]), [], [{ spanId: spans[0].id, text: "Senior", role: "separator" }]).ok, false);
  const label = [span("Go", 0, 0)];
  assert.equal(auditImport(label, docWith([""]), [], [{ spanId: label[0].id, text: "Go", role: "label-colon" }]).ok, false);
});
test("audit accepts a dingbat marker letter only from a dingbat span", () => {
  const dingbat = span("l", 0, 0, { dingbat: true });
  const letter = span("l", 0, 0);
  const text = span("Shipped it", 10, 0);
  assert.equal(auditImport([dingbat, text], docWith(["", "Shipped it"]), [], [{ spanId: dingbat.id, text: "l", role: "marker" }]).ok, true);
  assert.equal(auditImport([letter, text], docWith(["", "Shipped it"]), [], [{ spanId: letter.id, text: "l", role: "marker" }]).ok, false);
});
test("audit catches source text that looks like markup if it ever reached a field", () => {
  const audit = auditImport([span("Use <b> tags", 0, 0)], docWith(["", "Use <b> tags"]), [], []);
  assert.equal(audit.ok, false, "stripInlineMarks removes <b>, so placing it would lose characters");
});

// ── Field text ──────────────────────────────────────────────────────────────
const pieceOf = (text, x, extra) => slicePiece(span(text, x, 0, extra), 0, text.length);
test("a line-end hyphen joins the next line without a space and is reported", () => {
  const rendered = renderField({ lines: [[pieceOf("wrote front-", 0)], [pieceOf("end tools", 0)]], marks: false });
  assert.deepEqual(rendered, { text: "wrote front-end tools", joinedHyphen: true });
});
test("other line ends join with one space", () => {
  assert.equal(renderField({ lines: [[pieceOf("one", 0)], [pieceOf("two", 0)]], marks: false }).text, "one two");
});
test("bold runs become inline marks; each piece keeps its own weight", () => {
  const pieces = [pieceOf("Mentored", 0, { width: 40 }), pieceOf("five", 44, { bold: true, width: 20 }), pieceOf(",", 64, { width: 2 }), pieceOf("engineers", 69, { width: 40 })];
  assert.equal(renderField({ lines: [pieces], marks: true }).text, "Mentored <b>five</b>, engineers");
});
test("marks are off for plain fields", () => {
  assert.equal(renderField({ lines: [[pieceOf("Bold", 0, { bold: true })]], marks: false }).text, "Bold");
});

// ── Separators ──────────────────────────────────────────────────────────────
test("spaced separators split items and are returned for accounting", () => {
  const { parts, separators } = splitOnSeparators([pieceOf("a@x.test | 555 · Chicago, IL", 0)]);
  assert.deepEqual(parts.map((part) => part.map((member) => member.text).join(" ")), ["a@x.test", "555", "Chicago, IL"]);
  assert.deepEqual(separators.map((member) => member.text), ["|", "·"]);
});
test("unspaced pipes and dots inside words are content", () => {
  const { parts, separators } = splitOnSeparators([pieceOf("C|C++ and Node.js", 0)]);
  assert.equal(parts.length, 1);
  assert.equal(separators.length, 0);
});

// ── Dates and fonts ─────────────────────────────────────────────────────────
test("date-like values", () => {
  for (const value of ["Jan 2020 – Present", "2019 – 2021", "Summer 2024", "Sept. 2018 - May 2019", "05/2021 – 06/2022", "Expected May 2026", "2022"]) {
    assert.equal(isDateLike(value), true, value);
  }
  for (const value of ["Boston, MA", "Built 2020 dashboards", "BFA, 2015", "Remote", "Q3 2020 launch plan"]) {
    assert.equal(isDateLike(value), false, value);
  }
});
test("font names map to the nearest bundled family", () => {
  const expectations = [
    ["Calibri-Bold", "carlito", true],
    ["TimesNewRomanPSMT", "tinos", true],
    ["Arial-BoldMT", "arimo", true],
    ["TypesetSerif4Regular", "source-serif", true],
    ["TypesetSans3Regular", "source-sans", true],
    ["LMRomanCaps10-Regular", "latin-modern", true],
    ["Garamond", "tinos", false],
    ["Roboto-Regular", "arimo", false],
    ["NotoSans-Regular", "arimo", false]
  ];
  for (const [font, family, exact] of expectations) assert.deepEqual(familyForFont(font), { family, exact }, font);
});

// ── Lines and columns ───────────────────────────────────────────────────────
const page = { width: 612, height: 792, hasImages: false };
test("right-aligned dates in one column are not mistaken for a second column", () => {
  const spans = [];
  for (let row = 0; row < 8; row += 1) {
    const y = 100 + row * 40;
    spans.push(span(`Company ${row}`, 54, y, { width: 60, bold: true }), span(`20${10 + row} – 20${11 + row}`, 500, y, { width: 58 }));
    spans.push(span("Built and operated systems that served customers across several regions", 70, y + 14, { width: 470 }));
  }
  const { lines } = layoutLines({ pages: [page], spans, rules: [] });
  assert.ok(lines.every((line) => line.region === "main"));
  assert.ok(lines.filter((line) => line.segments.length === 2).length === 8);
});
test("a real sidebar is read before the main column", () => {
  const spans = [span("Name Straddling The Gutter", 150, 50, { width: 220, size: 20 })];
  for (let row = 0; row < 10; row += 1) {
    spans.push(span(`side ${row} item`, 40, 100 + row * 14, { width: 100 }));
    spans.push(span(`main column line ${row} with longer text`, 220, 100 + row * 14, { width: 300 }));
  }
  const { lines } = layoutLines({ pages: [page], spans, rules: [] });
  assert.deepEqual([...new Set(lines.map((line) => line.region))], ["top", "left", "right"]);
  assert.equal(lines.find((line) => line.region === "left").text, "side 0 item");
});
test("bullet markers: glyph spans, inline glyphs, dingbat fonts, private-use glyphs", () => {
  const spans = [
    span("•", 54, 100, { width: 4 }),
    span("Glyph span", 66, 100),
    span("• Inline glyph", 54, 120),
    span("n", 54, 140, { dingbat: true, width: 5 }),
    span("Symbol font", 66, 140),
    span("\uF0B7", 54, 160, { width: 5 }),
    span("Private use", 66, 160),
    span("- Hyphen marker", 54, 180),
    span("-5% churn is not a marker", 54, 200)
  ];
  const { lines } = layoutLines({ pages: [page], spans, rules: [] });
  assert.deepEqual(lines.map((line) => [line.marker?.text ?? null, line.text]), [
    ["•", "Glyph span"],
    ["•", "Inline glyph"],
    ["n", "Symbol font"],
    ["\uF0B7", "Private use"],
    ["-", "Hyphen marker"],
    [null, "-5% churn is not a marker"]
  ]);
});
test("tag-like spans are excluded before structure", () => {
  const { lines, excluded } = layoutLines({ pages: [page], spans: [span("Use <link=https://x.test>here</link>", 54, 100), span("Plain", 54, 120)], rules: [] });
  assert.equal(excluded.length, 1);
  assert.deepEqual(lines.map((line) => line.text), ["Plain"]);
});

// ── Reading with an injected pdf.js ─────────────────────────────────────────
test("a missing font record falls back to no font facts rather than throwing", async () => {
  const pdfjs = {
    OPS: {},
    getDocument: () => ({
      destroy: async () => {},
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getViewport: () => ({ width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }),
          getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
          getTextContent: async () => ({ items: [{ str: "Plenty of readable resume text here", transform: [10, 0, 0, 10, 72, 700], width: 180, fontName: "f9" }] }),
          commonObjs: { has: () => false, get: () => { throw new Error("unresolved"); } }
        })
      })
    })
  };
  const layout = await readPdfLayout(new TextEncoder().encode("%PDF-1.7\n"), pdfjs);
  assert.equal(layout.spans[0].font, "");
  assert.equal(layout.spans[0].text, "Plenty of readable resume text here");
});

for (const [name, fn] of cases) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}\n  ${error.message}`);
    process.exitCode = 1;
  }
}
console.log(`pdf-import-units: ${passed}/${cases.length} passed`);
