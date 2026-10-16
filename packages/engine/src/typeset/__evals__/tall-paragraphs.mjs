// Pagination of content that cannot keep together: a bullet or skills row taller
// than a page splits at its wrapped continuations instead of running off the
// page bottom, an authored indent never pushes text past the right margin, and
// an uppercase heading transforms its text but not its tag payloads.
import assert from "node:assert/strict";
import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { coverLetterResumeData } from "../../lib/coverLetter.ts";
import { layoutCoverLetter, layoutResume } from "../layout.ts";
import { toTypesetSchema } from "../schema.ts";

const lines = (doc) => doc.pages.flatMap((page) => page.lines);
const offPage = (doc) => lines(doc).filter((line) => line.baseline > doc.geometry.lastBaselineMax + 1e-6);
const data = (sections) => ({ header: { visible: true, name: "Name", contact: ["name@example.test"] }, sections });
const standard = (bullets, fields = {}) => ({
  id: "s", heading: "Experience", type: "standard",
  items: [{ id: "e", titleLeft: "Title", titleRight: "2026", subtitleLeft: "Subtitle", subtitleRight: "Remote", bullets: bullets.map((text, index) => ({ id: `b${index}`, text })), ...fields }]
});
const tall = "word ".repeat(3000).trim();

// 1. Kept-together paragraphs taller than a page paginate at continuations.
for (const [label, sections] of [
  ["bullet", [standard([tall])]],
  ["first bullet after a head row", [standard([tall, "Short second bullet."])]],
  ["bullet-only entry", [standard([tall], { titleLeft: null, titleRight: null, subtitleLeft: null, subtitleRight: null })]],
  ["skills row", [{ id: "s", heading: "Skills", type: "skills", items: [{ id: "e", titleLeft: "Tools", titleRight: "", subtitleLeft: "skill, ".repeat(3000), subtitleRight: "", bullets: [] }] }]]
]) {
  const doc = layoutResume(toTypesetSchema(data(sections)), DOC_STYLE_DEFAULTS);
  assert.ok(doc.pages.length > 1, `${label}: fixture spans pages`);
  assert.equal(offPage(doc).length, 0, `${label}: no line falls past the page bottom`);
  for (const page of doc.pages) assert.ok(page.lines.length, `${label}: no blank page`);
  const body = lines(doc).flatMap((line) => line.runs).filter((run) => (run.src?.kind === "bullet" || run.src?.kind === "skillsRow") && !run.marker);
  const tokens = body.map((run) => run.text).join(" ").split(/\s+/).filter(Boolean);
  const authored = sections[0].items.map((item) => sections[0].type === "skills" ? `${item.titleLeft}: ${item.subtitleLeft}` : item.bullets.map((bullet) => bullet.text).join(" ")).join(" ");
  const expected = authored.split(/\s+/).filter(Boolean);
  assert.deepEqual(tokens, expected, `${label}: every word survives pagination in order`);
  // The over-tall chain fills the page it starts on rather than moving whole.
  assert.ok(doc.pages[0].lines.some((line) => line.runs.some((run) => run.src?.kind === "bullet" || run.src?.kind === "skillsRow")), `${label}: continues from the current page`);
}
// A bullet that fits a page keeps together exactly as before: the continuation
// boundaries are used only when the chain cannot fit any page. The fixture
// searches for a filler length that leaves too little room for the bullet at
// the bottom of a page, then checks the bullet moved whole to the next page.
const keptBullet = "Keeps together. ".repeat(60).trim();
const bulletPagesFor = (fillerWords) => {
  const doc = layoutResume(toTypesetSchema(data([
    { id: "f", heading: "Filler", type: "summary", items: [{ id: "p", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "fp", text: "filler ".repeat(fillerWords) }] }] },
    standard(["Short first bullet.", keptBullet])
  ])), DOC_STYLE_DEFAULTS);
  const fillerLast = Math.max(...doc.pages.flatMap((page, index) => page.lines.some((line) => line.runs.some((run) => run.src?.bulletId === "fp")) ? [index] : []));
  const bulletPages = doc.pages.flatMap((page, index) => page.lines.some((line) => line.runs.some((run) => run.src?.bulletId === "b1")) ? [index] : []);
  return { fillerLast, bulletPages, offPage: offPage(doc).length };
};
let crossing = null;
for (let fillerWords = 2100; fillerWords <= 2500 && !crossing; fillerWords += 5) {
  const placed = bulletPagesFor(fillerWords);
  // At every filler length the kept bullet sits on one page: a splitter that
  // split fitting bullets would show two pages here before the crossing.
  assert.equal(placed.bulletPages.length, 1, `kept bullet is whole at ${fillerWords} filler words`);
  assert.equal(placed.offPage, 0);
  if (placed.bulletPages[0] > placed.fillerLast) crossing = { fillerWords, ...placed };
}
assert.ok(crossing, "a filler length pushes the kept bullet past the page bottom");
assert.deepEqual(crossing.bulletPages, [crossing.fillerLast + 1], `a bullet that fits a page moves whole to the next page (filler ${crossing.fillerWords} words)`);
// A wrapped heading followed by an over-tall bullet never leaves its first row
// alone at a page bottom: the split needs real content on the page, or the
// chain moves whole to the next page before splitting there.
for (let fillerWords = 2300; fillerWords <= 2600; fillerWords += 4) {
  const doc = layoutResume(toTypesetSchema(data([
    { id: "f", heading: "Filler", type: "summary", items: [{ id: "p", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "fp", text: "filler ".repeat(fillerWords) }] }] },
    { ...standard([tall]), heading: "Section heading words ".repeat(8).trim() }
  ])), DOC_STYLE_DEFAULTS);
  assert.equal(offPage(doc).length, 0);
  for (const [index, page] of doc.pages.entries()) {
    const last = page.lines[page.lines.length - 1];
    assert.ok(!last.runs.every((run) => run.src?.kind === "heading"), `page ${index} does not end with a stranded heading row at ${fillerWords} filler words`);
  }
}
console.log("tall paragraphs paginate at wrapped continuations; fitting bullets keep together; headings are never stranded");

// 2. An authored indent is held inside the column at impossible geometry.
const wide = { ...DOC_STYLE_DEFAULTS, pageMarginTopPt: 216, pageMarginRightPt: 216, pageMarginBottomPt: 216, pageMarginLeftPt: 216, entryIndentPt: 36, entryEndIndentPt: 36, bulletIndentPt: 36, baseFontSizePt: 12 };
const indented = layoutResume(toTypesetSchema(data([
  standard(["<indent=216>Indented bullet words that wrap</indent>", "Plain bullet"]),
  { id: "sum", heading: "Summary", type: "summary", items: [{ id: "p", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "sp", text: "<indent=216>Indented summary words</indent>" }] }] }
])), wide);
for (const run of lines(indented).flatMap((line) => line.runs)) {
  const edge = run.src?.kind === "bullet" ? 612 - wide.pageMarginRightPt - wide.entryEndIndentPt : 612 - wide.pageMarginRightPt;
  assert.ok(run.x + run.width <= edge + 1e-6, `indented run ${JSON.stringify(run.text)} stays inside its column edge`);
}
const cover = layoutCoverLetter(toTypesetSchema(coverLetterResumeData(["<indent=216>Indented letter paragraph words</indent>"])), wide);
for (const run of lines(cover).flatMap((line) => line.runs)) {
  assert.ok(run.x + run.width <= 612 - wide.pageMarginRightPt + 1e-6, "indented cover paragraph stays inside the right margin");
}
// At ordinary geometry the same indent is applied in full.
const roomy = layoutResume(toTypesetSchema(data([standard(["<indent=72>Indented</indent>", "Plain"])])), DOC_STYLE_DEFAULTS);
const [first, second] = lines(roomy).filter((line) => line.runs.some((run) => run.marker)).map((line) => line.runs.find((run) => !run.marker).x);
assert.ok(Math.abs(first - second - 72) < 1e-9, "a fitting indent moves the paragraph by its full value");
console.log("authored indents stay inside the text column at every margin setting");

// 3. Uppercase headings keep tag payloads intact.
const upper = { ...DOC_STYLE_DEFAULTS, headingCase: "uppercase" };
const headingRuns = (heading) => lines(layoutResume(toTypesetSchema(data([{ id: "h", heading, type: "standard", items: [] }])), upper)).flatMap((line) => line.runs).filter((run) => run.src?.kind === "heading");
const linked = headingRuns("<link=https%3A%2F%2Fexample.test%2FMixedCase%3Fq%3DValue>My Site</link>");
assert.deepEqual(linked.map((run) => [run.text, run.href]), [["MY SITE", "https://example.test/MixedCase?q=Value"]], "uppercase heading keeps the link destination's case");
const fonted = headingRuns("Plain <font=tinos><size=14>Styled</size></font> ß");
assert.deepEqual(fonted.map((run) => [run.text.trim(), run.style.family, run.style.size]), [["PLAIN", "latin-modern", 12], ["STYLED", "tinos", 14], ["SS", "latin-modern", 12]], "uppercase heading keeps font and size tags and uppercases text only");
console.log("uppercase headings transform text, not tags");
