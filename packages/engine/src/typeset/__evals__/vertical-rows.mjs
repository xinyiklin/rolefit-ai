// Vertical row contracts that depend on fonts and sizes, never on typed glyphs:
// page fit, title/subtitle clearance under an underline, and title line height.
import assert from "node:assert/strict";
import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { FONT_FAMILY_IDS } from "../../lib/fontFamilies.ts";
import { layoutCoverLetter, layoutResume } from "../layout.ts";
import { inkExtent, underlineRule, underlineSpans } from "../measure.ts";

const PAGE_HEIGHT = 792;
const header = { name: "Name", contact: [] };
const entry = (fields) => ({
  id: "e", titleLeft: "Title", titleRight: "", subtitleLeft: "Subtitle", subtitleRight: "",
  bullets: [], bulletIds: [], ...fields
});
const resume = (type, heading, items) => ({ header, sections: [{ id: "s", type, heading, items }] });
const baselines = (doc) => doc.pages.map((page) => page.lines.map((line) => line.baseline));
const fieldLine = (doc, field) => doc.pages.flatMap((page) => page.lines)
  .find((line) => line.runs.some((run) => run.src?.field === field));

// 1. Page fit. The page bottom sits 0.5bp below the last row's baseline, closer
//    than any descender: the same row must land on the same page whether it
//    holds "aaaa", "yyyy", or nothing.
const pageFitCases = [
  ["bullet", (text) => resume("standard", "Experience", [entry({ bullets: [text], bulletIds: ["b"] })]), layoutResume],
  ["summary", (text) => resume("summary", "Summary", [entry({ titleLeft: "", subtitleLeft: "", bullets: [text], bulletIds: ["b"] })]), layoutResume],
  ["skills row", (text) => resume("skills", "Skills", [entry({ titleLeft: "Tools", subtitleLeft: text })]), layoutResume],
  ["subtitle", (text) => resume("standard", "Experience", [entry({ subtitleLeft: text })]), layoutResume],
  ["title", (text) => resume("standard", "Experience", [entry({ titleLeft: text, subtitleLeft: null, subtitleRight: null })]), layoutResume],
  ["heading", (text) => resume("standard", text, []), layoutResume],
  ["cover paragraph", (text) => ({ header, sections: [{ id: "c", type: "summary", heading: "", items: [entry({ bullets: [text], bulletIds: ["p"] })] }] }), layoutCoverLetter]
];
for (const family of FONT_FAMILY_IDS) {
  for (const [label, build, layout] of pageFitCases) {
    const base = { ...DOC_STYLE_DEFAULTS, fontFamily: family, headingCase: "none", sectionRule: false };
    const probe = layout(build("aaaa"), base);
    const last = probe.pages.at(-1).lines.at(-1).baseline;
    const style = { ...base, pageMarginBottomPt: PAGE_HEIGHT - last - 0.5 };
    const expected = baselines(layout(build("aaaa"), style));
    for (const text of ["yyyy", "Agjpqy", ""]) {
      assert.deepEqual(
        baselines(layout(build(text), style)),
        expected,
        `${family} ${label}: typing ${JSON.stringify(text)} must not change pagination`
      );
    }
  }
}
console.log("page fit is independent of typed glyphs");

// 2. An underlined title's rule stays clear of the subtitle's ink at the most
//    negative title/subtitle gap, at every size the rule can take.
for (const baseFontSizePt of [10, 12]) {
  for (const titleLeft of ["<u>Title</u>", "<u><size=16>Title</size></u>", "<link=https%3A%2F%2Fexample.com>Title</link>"]) {
    for (const family of FONT_FAMILY_IDS) {
      const style = { ...DOC_STYLE_DEFAULTS, fontFamily: family, baseFontSizePt, titleSubGapPt: -6 };
      const doc = layoutResume(resume("standard", "Experience", [entry({ titleLeft, subtitleLeft: "Subtitle Ltd" })]), style);
      const title = fieldLine(doc, "titleLeft");
      const subtitle = fieldLine(doc, "subtitleLeft");
      const spans = underlineSpans(title.runs);
      assert.ok(spans.length, "fixture draws a title rule");
      const ruleBottom = title.baseline + Math.max(...spans.map((span) => {
        const rule = underlineRule(span.style);
        return rule.offset + rule.thickness;
      }));
      const subtitleInkTop = subtitle.baseline - Math.max(...subtitle.runs.map((run) => inkExtent(run.text, run.style).height));
      assert.ok(
        subtitleInkTop - ruleBottom >= 0.3 * (baseFontSizePt / 10) - 1e-9,
        `${family} ${baseFontSizePt}pt ${titleLeft}: subtitle ink overlaps the title rule by ${(ruleBottom - subtitleInkTop).toFixed(2)}bp`
      );
    }
  }
}
// Where the calibrated floor already cleared the rule, positions stay exactly as
// before: ink depth + 2.04bp below a linked title, at the default -1 gap.
for (const family of FONT_FAMILY_IDS) {
  const style = { ...DOC_STYLE_DEFAULTS, fontFamily: family, titleSubGapPt: -1 };
  const doc = layoutResume(resume("standard", "Experience", [entry({ titleLeft: "Project", titleRight: "github.com/app", subtitleLeft: "Subtitle Ltd" })]), style);
  const title = fieldLine(doc, "titleLeft");
  const subtitle = fieldLine(doc, "subtitleLeft");
  assert.ok(title.runs.some((run) => run.href), "fixture title carries a link");
  const ink = (runs, key) => Math.max(...runs.map((run) => inkExtent(run.text, run.style)[key]));
  const spaced = style.baseFontSizePt * style.lineHeight + style.titleSubGapPt;
  const oldFloor = ink(title.runs, "depth") + 2.04 + ink(subtitle.runs, "height") + 0.3;
  assert.ok(
    Math.abs(subtitle.baseline - title.baseline - Math.max(spaced, oldFloor)) < 1e-9,
    `${family}: a linked title keeps its calibrated subtitle distance`
  );
}
console.log("subtitle ink clears the title's underline rule; calibrated distances unchanged");

// 3. A <line-height> mark on a title or subtitle sets the space below it the
//    same way whether the row fits or wraps.
const long = "Wrapped heading words ".repeat(12).trim();
for (const [field, next] of [["titleLeft", "subtitleLeft"], ["subtitleLeft", "bullets"]]) {
  const gapBelow = (text) => {
    const doc = layoutResume(resume("standard", "Experience", [entry({ [field]: `<line-height=2>${text}</line-height>`, bullets: ["Body"], bulletIds: ["b"] })]), DOC_STYLE_DEFAULTS);
    const lines = doc.pages.flatMap((page) => page.lines);
    const rows = lines.filter((line) => line.runs.some((run) => run.src?.field === field));
    const following = next === "bullets"
      ? lines.find((line) => line.runs.some((run) => run.src?.kind === "bullet"))
      : fieldLine(doc, next);
    return { rows: rows.length, gap: following.baseline - rows.at(-1).baseline, leading: rows.at(-1).leading };
  };
  const short = gapBelow("Short");
  const wrapped = gapBelow(long);
  assert.equal(short.rows, 1);
  assert.ok(wrapped.rows > 1, "fixture wraps");
  assert.ok(
    Math.abs(short.gap - wrapped.gap) < 1e-9,
    `${field}: line-height gap is ${short.gap.toFixed(2)}bp short vs ${wrapped.gap.toFixed(2)}bp wrapped`
  );
  assert.equal(short.leading, wrapped.leading, `${field}: the row owns the same leading`);
}
console.log("title and subtitle line-height marks apply with or without wrapping");
