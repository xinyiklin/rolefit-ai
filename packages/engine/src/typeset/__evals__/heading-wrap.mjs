import assert from "node:assert/strict";
import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { FONT_FAMILY_IDS } from "../../lib/fontFamilies.ts";
import { layoutResume } from "../layout.ts";
import { buildVerticalStream, pageGeometry } from "../blocks.ts";
import { breakParagraph, graphemeClusters } from "../linebreak.ts";

import { inkExtent, paragraphItems } from "../measure.ts";

const fields = ["titleLeft", "titleRight", "subtitleLeft", "subtitleRight"];
const fixture = (values) => ({ sections: [{ id: "section", type: "standard", heading: "Experience", items: [{
  id: "entry", titleLeft: "Engineer", titleRight: "2026", subtitleLeft: "Company", subtitleRight: "Remote",
  bullets: ["Following content."], bulletIds: ["bullet"], ...values
}]}] });

for (const fontFamily of FONT_FAMILY_IDS) {
  const style = { ...DOC_STYLE_DEFAULTS, fontFamily };
  const geo = pageGeometry(style);
  for (const field of fields) {
    for (const text of ["A long heading phrase ".repeat(30).trimEnd(), "W".repeat(200)]) {
      const doc = layoutResume(fixture({ [field]: text }), style);
      const lines = doc.pages.flatMap((p) => p.lines).filter((l) => l.runs.some((r) => r.src?.field === field));
      assert(lines.length > 1, `${fontFamily} ${field} must wrap`);
      for (const line of lines) {
        for (const run of line.runs) {
          assert(run.x >= geo.marginLeft + geo.entryIndent - 1e-6, "left page bound");
          assert(run.x + run.width <= geo.marginLeft + geo.entryIndent + geo.headRowWidth + 1e-6, "right page bound");
        }
        const left = line.runs.filter((r) => r.src?.field?.endsWith("Left"));
        const right = line.runs.filter((r) => r.src?.field?.endsWith("Right"));
        if (left.length && right.length) assert(left.at(-1).x + left.at(-1).width <= right[0].x, "paired fields do not overlap");
      }
      const painted = lines.flatMap((l) => l.runs.filter((r) => r.src?.field === field).map((r) => r.text)).join("");
      assert.equal(painted.replaceAll(" ", ""), text.replaceAll(" ", ""), "all non-space characters survive");
    }
  }
}

const tall = layoutResume(fixture({ titleLeft: "Long heading ".repeat(1800), titleRight: "Paired heading ".repeat(1500) }), DOC_STYLE_DEFAULTS);
assert(tall.pages.length > 1, "oversized headings paginate");
for (const page of tall.pages) {
  assert(page.lines.length, "no phantom blank page");
  for (const line of page.lines) assert(line.baseline <= tall.geometry.lastBaselineMax, "heading stays on its page");
}
const spaces = layoutResume(fixture({ titleLeft: " ".repeat(600) }), DOC_STYLE_DEFAULTS);
assert.equal(spaces.pages.flatMap((p) => p.lines).flatMap((l) => l.runs)
  .filter((r) => r.src?.field === "titleLeft").map((r) => r.text).join(""), " ".repeat(600), "whitespace-only fields preserve every authored space");
assert.deepEqual(graphemeClusters("🇺🇸👍🏽é👩‍💻"), ["🇺🇸", "👍🏽", "é", "👩‍💻"], "displayed emoji and combining characters stay intact");
console.log("heading wrapping: four fields, six families, tokens, paired bounds, content, whitespace, graphemes, and oversized pagination passed");

const tightHeading = buildVerticalStream(fixture({
  titleLeft: `<line-height=1>${"Wrapped heading words ".repeat(30)}</line-height>`, titleRight: ""
}), DOC_STYLE_DEFAULTS).filter(line => line.runs.some(run => run.src?.field === "titleLeft"));
assert(tightHeading.length > 1);
assert.equal(tightHeading[0].leading, 11, "explicit tight leading overrides document default");

const tightJunction = layoutResume(fixture({
  titleLeft: `<line-height=1>${"gyp heading ".repeat(20)}</line-height>`, titleRight: "",
  subtitleLeft: "HIGHLAND", subtitleRight: ""
}), { ...DOC_STYLE_DEFAULTS, titleSubGapPt: -6 });
const tightLines = tightJunction.pages.flatMap(page => page.lines);
const finalTitle = tightLines.filter(line => line.runs.some(run => run.src?.field === "titleLeft")).at(-1);
const firstSubtitle = tightLines.find(line => line.runs.some(run => run.src?.field === "subtitleLeft"));
const titleBottom = finalTitle.baseline + Math.max(...finalTitle.runs.map(run => inkExtent(run.text, run.style).depth));
const subtitleTop = firstSubtitle.baseline - Math.max(...firstSubtitle.runs.map(run => inkExtent(run.text, run.style).height));
assert(subtitleTop - titleBottom >= 0.3 - 1e-7, "wrapped tight leading preserves title/subtitle ink clearance after its outgoing adjustment");

for (const value of ["one two three four five", "W".repeat(120), "hyphen-".repeat(30), "one\n\ntwo", "one " + "W".repeat(120) + " end"]) {
  const lines = breakParagraph(paragraphItems(value, 11, "tinos", 0), 45, "left");
  const reconstructed = lines.map(line => line.runs.map((run, index) =>
    (index && run.x > line.runs[index - 1].x + line.runs[index - 1].width + 0.3 ? " " : "") + run.text
  ).join("") + (line.breakAfter ?? "")).join("");
  assert.equal(reconstructed, value, "field-local separators preserve spaces, hard breaks, and split tokens");
}

for (const fontFamily of FONT_FAMILY_IDS) {
  for (const key of ["name", "contact"]) {
    const value = "W".repeat(key === "name" ? 120 : 500);
    const schema = { ...fixture({}), header: { name: key === "name" ? value : "Example Name", contact: [key === "contact" ? value : "contact@example.test"] } };
    const style = { ...DOC_STYLE_DEFAULTS, fontFamily };
    const doc = layoutResume(schema, style);
    const runs = doc.pages.flatMap(page => page.lines).flatMap(line => line.runs).filter(run => run.src?.kind === key);
    assert(runs.length > 1, `${key} wraps in ${fontFamily}`);
    for (const run of runs) {
      assert(run.x >= doc.geometry.marginLeft - 1e-6 && run.x + run.width <= 612 - doc.geometry.marginRight + 1e-6, `${key} stays inside page`);
    }
    assert.equal(runs.map(run => run.text).join(""), value);
  }
}

for (const count of [1, 10, 100]) {
  const data = fixture({ titleLeft: "Representative heading ".repeat(35), titleRight: "Location words ".repeat(20) });
  data.sections[0].items = Array.from({ length: count }, (_, index) => ({ ...data.sections[0].items[0], id: `entry-${index}`, bulletIds: [`bullet-${index}`] }));
  assert(JSON.stringify(data).length < 200_000);
  const start = performance.now();
  const doc = layoutResume(data, DOC_STYLE_DEFAULTS);
  const elapsed = performance.now() - start;
  assert(elapsed < 30_000, "bounded engine workload finishes before watchdog");
  for (const page of doc.pages) for (const line of page.lines) assert(line.baseline <= doc.geometry.lastBaselineMax, "stress line stays within its page");
  console.log(`engine stress: ${count} entries, ${doc.pages.length} pages, ${elapsed.toFixed(1)}ms`);
}

const suppressedHeader = layoutResume({ ...fixture({}), header: { name: null, contact: [`<nolink>https://example.test/${"path".repeat(100)}</nolink>`] } }, DOC_STYLE_DEFAULTS);
assert(suppressedHeader.pages.flatMap(page => page.lines).flatMap(line => line.runs).filter(run => run.src?.kind === "contact").every(run => !run.href), "wrapped contact must retain explicit link suppression");

const emptyMarks = layoutResume(fixture({ titleLeft: "<b></b>", titleRight: "<size=24></size>" }), DOC_STYLE_DEFAULTS);
assert(emptyMarks.pages.flatMap(page => page.lines).flatMap(line => line.runs).filter(run => run.src?.field?.startsWith("title")).every(run => run.text === ""), "format-only fields stay empty and do not paint markup");

const markedCluster = layoutResume(fixture({ titleLeft: "W".repeat(22) + "<b>e</b>\u0301" + "W".repeat(100), titleRight: "R".repeat(100), subtitleLeft: null, subtitleRight: null }), DOC_STYLE_DEFAULTS);
for (const line of markedCluster.pages.flatMap(page => page.lines)) {
  const left = line.runs.filter(run => run.src?.field === "titleLeft").map(run => run.text).join("");
  assert(!left.startsWith("\u0301"), "inline mark boundary cannot separate a combining accent from its base");
}
