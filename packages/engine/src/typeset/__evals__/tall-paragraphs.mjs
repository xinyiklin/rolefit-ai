// Pagination of content that cannot keep together: a bullet or skills row taller
// than a page splits at its wrapped continuations instead of running off the
// page bottom, an authored indent never pushes text past the right margin, and
// an uppercase heading transforms its text but not its tag payloads.
import assert from "node:assert/strict";
import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { coverLetterResumeData } from "../../lib/coverLetter.ts";
import { skillsRowText, wholeFieldFormat, withWholeFieldFormat } from "../../lib/inlineMarksText.ts";
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
const wide = { ...DOC_STYLE_DEFAULTS, pageMarginTopPt: 216, pageMarginRightPt: 216, pageMarginBottomPt: 216, pageMarginLeftPt: 216, entryIndentPt: 36, entryEndIndentPt: 36, bulletIndentPt: 36 };
const indented = layoutResume(toTypesetSchema(data([
  standard(["<size=12><indent=216>Indented bullet words that wrap</indent></size>", "Plain bullet"]),
  { id: "sum", heading: "Summary", type: "summary", items: [{ id: "p", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "sp", text: "<size=12><indent=216>Indented summary words</indent></size>" }] }] }
])), wide);
for (const run of lines(indented).flatMap((line) => line.runs)) {
  const edge = run.src?.kind === "bullet" ? 612 - wide.pageMarginRightPt - wide.entryEndIndentPt : 612 - wide.pageMarginRightPt;
  assert.ok(run.x + run.width <= edge + 1e-6, `indented run ${JSON.stringify(run.text)} stays inside its column edge`);
}
const cover = layoutCoverLetter(toTypesetSchema(coverLetterResumeData(["<size=12><indent=216>Indented letter paragraph words</indent></size>"])), wide);
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

// 4. Alignment never moves a line break: each alignment sets the same words on
//    the same lines, in resumes, letters, and across fonts and widths.
{
  const words = "Led migration of 40 services to event-driven architecture, cutting p99 latency 38% and saving $1.2M annually while mentoring six engineers through on-call rotations".split(" ");
  const breaksFor = (doc) => doc.pages.map((page) => page.lines.map((line) =>
    line.runs.filter((run) => !run.marker).map((run) => run.text).join("").replace(/\s+/g, " ").trim()));
  let cases = 0;
  for (const fontFamily of ["latin-modern", "carlito", "tinos", "source-sans"]) {
    for (let count = 6; count <= words.length; count += 3) {
      const text = words.slice(0, count).join(" ");
      for (const margin of [36, 90, 160]) {
        const resumeBreaks = [];
        const letterBreaks = [];
        for (const bodyAlign of ["left", "center", "right", "justify"]) {
          const style = { ...DOC_STYLE_DEFAULTS, fontFamily, bodyAlign, pageMarginLeftPt: margin, pageMarginRightPt: margin };
          resumeBreaks.push(breaksFor(layoutResume(toTypesetSchema(data([standard([text, `${text} ${text}`])])), style)));
          letterBreaks.push(breaksFor(layoutCoverLetter(toTypesetSchema(coverLetterResumeData([text, `${text} ${text}`])), style)));
          cases += 2;
        }
        for (const breaks of resumeBreaks) assert.deepEqual(breaks, resumeBreaks[0], `${fontFamily} ${count} words @${margin}: resume breaks are the same in every alignment`);
        for (const breaks of letterBreaks) assert.deepEqual(breaks, letterBreaks[0], `${fontFamily} ${count} words @${margin}: letter breaks are the same in every alignment`);
      }
    }
  }
  console.log(`alignment leaves line breaks unchanged (${cases} layouts)`);
}

// 5. An empty partner field never sets a row's spacing: a 9 pt title with a
//    blank date sits exactly where a 9 pt title with a 9 pt date does.
{
  const rowBaselines = (titleRight, subtitleRight) => {
    const doc = layoutResume(toTypesetSchema(data([standard(["A bullet", "Another bullet"], {
      titleLeft: "<size=9>Engineer</size>", titleRight, subtitleLeft: "<size=8>Acme</size>", subtitleRight
    })])), DOC_STYLE_DEFAULTS);
    return lines(doc).map((line) => line.baseline);
  };
  assert.deepEqual(
    rowBaselines("", ""),
    rowBaselines("<size=9>2026</size>", "<size=8>Remote</size>"),
    "blank right fields keep the rows their filled partners give"
  );
  console.log("empty partner fields never set a row's spacing");
}

// 6. Text without a size of its own paints at its role default (what the editor
//    shows), whatever size another part of its row was set to.
{
  const skillsRow = (titleLeft, subtitleLeft) => {
    const doc = layoutResume(toTypesetSchema(data([{ id: "k", heading: "Skills", type: "skills", items: [
      { id: "r", titleLeft, titleRight: null, subtitleLeft, subtitleRight: null, bullets: [] }
    ] }])), DOC_STYLE_DEFAULTS);
    return lines(doc).find((line) => line.runs.some((run) => run.src?.kind === "skillsRow")).runs
      .filter((run) => run.text.trim())
      .reduce((groups, run) => {
        const last = groups.at(-1);
        if (last && last[1] === run.style.size && run.text.trim() !== ":" && last[0] !== ":") last[0] += ` ${run.text.trim()}`;
        else groups.push([run.text.trim(), run.style.size]);
        return groups;
      }, []);
  };
  assert.deepEqual(skillsRow("<size=12><b>Languages</b></size>", "Python, Java"),
    [["Languages", 12], [":", 10], ["Python, Java", 10]], "a sized label leaves unsized skills at their default");
  assert.deepEqual(skillsRow("<b>Languages</b>", "<size=12>Python, Java</size>"),
    [["Languages", 10], [":", 12], ["Python, Java", 12]], "sized skills leave an unsized label at its default; the separator goes with the skills");
  console.log("unsized text paints at its role default beside sized text");
}

// 7. A field's size is its first character's: sizing a word inside it, or the
//    editor re-spelling its runs, never re-spaces the paragraph.
{
  const long = "words that wrap across several lines of the bullet ".repeat(4).trim();
  const gaps = (bullet) => {
    const doc = layoutResume(toTypesetSchema(data([standard([bullet, "<size=12>next</size>"])])), DOC_STYLE_DEFAULTS);
    const baselines = lines(doc).filter((line) => line.runs.some((run) => run.src?.kind === "bullet")).map((line) => line.baseline);
    return baselines.slice(1).map((baseline, index) => Math.round((baseline - baselines[index]) * 1000) / 1000);
  };
  const plain = gaps(`<size=12>Built ${long}</size>`);
  for (const variant of [
    `<size=12>Built <size=9>tiny</size> ${long}</size>`,
    `<size=12>Built </size><size=9>tiny</size><size=12> ${long}</size>`,
    `<size=12>Built <size=13>bump</size> ${long}</size>`
  ]) {
    const variantGaps = gaps(variant);
    assert.equal(variantGaps.length, plain.length, "the variant wraps to the same line count");
    assert.deepEqual(variantGaps.slice(1), plain.slice(1), `${variant.slice(0, 40)}…: lines after the odd word keep the 12 pt spacing`);
  }
  console.log("a word sized inside a field never re-spaces it");
}

// 8. Spacing follows the first character (D081, accepted): a sized lead-in word
//    spaces its whole paragraph, and Polish carry follows the main text.
{
  const leadGaps = (bullet) => {
    const doc = layoutResume(toTypesetSchema(data([standard([bullet])])), DOC_STYLE_DEFAULTS);
    const baselines = lines(doc).filter((line) => line.runs.some((run) => run.src?.kind === "bullet")).map((line) => line.baseline);
    return baselines.slice(1).map((baseline, index) => Math.round((baseline - baselines[index]) * 1000) / 1000);
  };
  const tail = " fast services for many partners across several wrapped lines of text".repeat(3);
  assert.equal(leadGaps(`<size=14>Built</size>${tail}`)[0], leadGaps(`<size=14>Built${tail}</size>`)[0],
    "a 14 pt lead-in spaces its paragraph's lines as 14 pt text does");
  const carried = withWholeFieldFormat("Rewritten bullet", wholeFieldFormat(`<size=14>Built</size><size=12>${tail}</size>`));
  assert.equal(carried, "<size=12>Rewritten bullet</size>", "an accepted rewrite takes the main size, not the lead-in's");
  console.log("a sized lead-in spaces its paragraph; carry follows the main text");
}

// 9. The skills separator follows the skills' first character, even when one
//    skill is set apart, and typing never moves it.
{
  const separator = skillsRowText("<size=12><b>Languages</b></size>", "<size=12>Python, </size><size=13>Go</size>");
  assert.match(separator, /<size=12>(?:<b>)?: /, "the separator keeps the columns' shared main size");
  assert.doesNotMatch(skillsRowText("<size=12><b>Languages</b></size>", "Python, Java"), /<size=12>(?:<b>)?: /,
    "a size only the label has stays off the separator");
  // Typing inside the set-apart run never moves the separator.
  for (const typed of ["", ", Rust, Kotlin, Swift, Scala, Elixir"]) {
    assert.match(skillsRowText("<size=12><b>Languages</b></size>", `<size=12>Python, </size><size=13>Go${typed}</size>`),
      /<size=12>(?:<b>)?: /, `the separator holds while typing (${typed.length} chars)`);
  }
  console.log("the skills separator follows the skills' first character");
}

// 10. An empty name's caret run shows what typing will produce: the default
//     display bold when bare, its stored emphasis when tag-only.
{
  const nameFace = (name) => {
    const doc = layoutResume(toTypesetSchema({ header: { visible: true, name, contact: [] }, sections: [] }), DOC_STYLE_DEFAULTS);
    return lines(doc)[0].runs[0].style.face;
  };
  assert.equal(nameFace(""), "boldDisplay", "a bare empty name paints in the default display bold");
  assert.equal(nameFace("<b></b>"), "boldDisplay", "a tag-only bold empty name paints in the display bold");
  assert.equal(nameFace("<i></i>"), "italic", "a tag-only empty name without bold keeps its own emphasis");
  assert.equal(nameFace("Jane"), "regular", "a typed name without <b> is regular");
  assert.equal(nameFace("<b>Jane</b>"), "boldDisplay", "a bold typed name paints in the display bold");
  console.log("an empty name's caret run matches what typing produces");
}
