// The inline-mark grammar's tag-stack rules, checked across every walker that
// instantiates it: the engine's segmenter, the whole-field truth helpers, and
// the tag-safe uppercase transform.
// Run: node --experimental-strip-types src/lib/__evals__/inline-marks.mjs
import assert from "node:assert/strict";
import {
  canonicalInlineMarkText,
  clearAlignmentOverride,
  effectiveFieldAlignment,
  effectiveFieldFont,
  effectiveFieldSize,
  escapeInlineMarkText,
  fieldMarkState,
  hasInlineMarkTags,
  inlineMarkTagStartsAt,
  joinInlineMarkText,
  setFieldFont,
  setFieldMark,
  setFieldSize,
  skillsRowText,
  stripInlineMarks,
  uppercaseInlineMarkedText
} from "../inlineMarksText.ts";
import { DOC_STYLE_DEFAULTS } from "../documentStyle.ts";
import {
  COVER_LETTER_STYLE_DEFAULTS,
  coverLetterParagraphs,
  coverLetterPlainText,
  parseCoverLetterFile,
  parseCoverLetterText,
  serializeCoverLetterFile
} from "../coverLetter.ts";
import { parseResumeFile, serializeResumeFile } from "../resumeFile.ts";
import { buildStarterResume } from "../../sampleResume.ts";
import { layoutResume } from "../../typeset/layout.ts";
import { segmentsFromInlineMarks } from "../../typeset/measure.ts";
import { toTypesetSchema } from "../../typeset/schema.ts";
import { ensureAllFontMetrics } from "../../typeset/fontRegistry.ts";

await ensureAllFontMetrics();

// An unusable <size> still owns its </size>: the close must not pop an outer size.
for (const inner of ["0", "0.5", "201", "999999"]) {
  const value = `<size=12>a<size=${inner}>b</size>c</size>`;
  assert.deepEqual(
    segmentsFromInlineMarks(value).map((segment) => [segment.text, segment.fontSizePt]),
    [["a", 12], ["b", 12], ["c", 12]],
    `<size=${inner}> is inert for the segmenter`
  );
  assert.equal(effectiveFieldSize(value, 10), 12, `<size=${inner}> is inert for the field-size truth`);
}
assert.deepEqual(
  segmentsFromInlineMarks("<size=0>a</size>b").map((segment) => [segment.text, segment.fontSizePt]),
  [["a", null], ["b", null]],
  "an inert size at the top level leaves the role size"
);
assert.equal(effectiveFieldSize("<size=14>a</size><size=0>b</size>", 10), null, "an inert size resolves to the fallback, so this field is mixed");
assert.deepEqual(
  segmentsFromInlineMarks("<font=tinos>a<size=14>b</size>c</font>d").map((segment) => [segment.text, segment.fontFamily, segment.fontSizePt]),
  [["a", "tinos", null], ["b", "tinos", 14], ["c", "tinos", null], ["d", null, null]],
  "valid nested marks keep their scopes"
);
assert.equal(effectiveFieldFont("<font=tinos>a</font>", "arimo"), "tinos");

// Uppercase transforms text and leaves every tag payload alone.
assert.equal(
  uppercaseInlineMarkedText("mixed <link=https%3A%2F%2Fexample.test%2FPath%3Fq%3DMixed>text</link> <font=tinos><size=10.5>styled</size></font> <align=center>c</align>"),
  "MIXED <link=https%3A%2F%2Fexample.test%2FPath%3Fq%3DMixed>TEXT</link> <font=tinos><size=10.5>STYLED</size></font> <align=center>C</align>"
);
assert.equal(uppercaseInlineMarkedText(""), "");
assert.equal(uppercaseInlineMarkedText("<b></b>"), "<b></b>");
assert.equal(uppercaseInlineMarkedText("plain ß text"), "PLAIN SS TEXT", "text uppercasing is the full Unicode mapping");
assert.equal(stripInlineMarks(uppercaseInlineMarkedText("<i>ab</i>")), "AB");
assert.equal(hasInlineMarkTags("<size=0>"), true, "an unusable size is still a tag the grammar recognizes");

// <lt> is the grammar's literal "<": text in every walker, never a mark.
const plainSegments = (value) =>
  segmentsFromInlineMarks(value).map((segment) => [segment.text, segment.bold, segment.italic, segment.fontSizePt]);
assert.equal(stripInlineMarks("Parsers for <lt>b> and <lt>i> tags"), "Parsers for <b> and <i> tags");
assert.equal(stripInlineMarks("<LT>b>"), "<b>", "the token is case-insensitive like every tag");
assert.deepEqual(plainSegments("a<lt>b>c"), [["a<b>c", false, false, null]], "a literal joins its text run");
assert.deepEqual(
  plainSegments("<b>x<lt>y</b>z"),
  [["x<y", true, false, null], ["z", false, false, null]],
  "a literal keeps the surrounding mark"
);
assert.deepEqual(plainSegments("<lt>size=200>big</size>"), [["<size=200>big", false, false, null]], "an escaped size tag changes nothing");
assert.deepEqual(
  plainSegments("plain <b>bold</b> <size=12>sized</size>"),
  [["plain ", false, false, null], ["bold", true, false, null], [" ", false, false, null], ["sized", false, false, 12]],
  "text without <lt> segments exactly as before"
);
assert.equal(fieldMarkState("<b><lt>lt></b>", "bold"), true, "a field holding only literal text is still marked text");
assert.equal(fieldMarkState("<lt>b>x", "bold"), false);
assert.equal(effectiveFieldAlignment("<align=center><lt></align>", "left"), "center", "a literal counts as aligned text");
assert.equal(uppercaseInlineMarkedText("<lt>b>tag"), "<lt>B>TAG");
assert.equal(stripInlineMarks(uppercaseInlineMarkedText("<lt>b>tag")), "<B>TAG");
assert.equal(inlineMarkTagStartsAt("x<b>", 1), true);
assert.equal(inlineMarkTagStartsAt("x<b>", 0), false);
assert.equal(inlineMarkTagStartsAt("a < b", 2), false, "a comparison is not a tag");
assert.equal(inlineMarkTagStartsAt("List<String>", 4), false, "an unknown element is not a tag");
assert.equal(inlineMarkTagStartsAt("<lt>", 0), true, "the token itself must be escaped when typed");
assert.equal(escapeInlineMarkText("a < b, <b>, <lt>"), "a <lt> b, <lt>b>, <lt>lt>");

// Escape then decode is the identity, and an escaped string carries no marks,
// for any mix of grammar fragments (seeded, so failures reproduce).
let seed = 0x5eed;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pieces = ["<", ">", "/", "b", "i", "u", "lt", "link=", "https%3A%2F%2Fx.test", "size=12", "font=tinos", "align=center", "nolink", " ", "x", "\n"];
for (let run = 0; run < 4000; run += 1) {
  let source = "";
  const length = Math.floor(random() * 14);
  for (let index = 0; index < length; index += 1) source += pieces[Math.floor(random() * pieces.length)];
  const escaped = escapeInlineMarkText(source);
  assert.equal(stripInlineMarks(escaped), source, `decode(escape(${JSON.stringify(source)}))`);
  const segments = segmentsFromInlineMarks(escaped);
  assert.equal(segments.map((segment) => segment.text).join(""), source, `segment text of ${JSON.stringify(source)}`);
  assert.ok(
    segments.every((segment) => !segment.bold && !segment.italic && !segment.underline && !segment.href && segment.fontSizePt === null && segment.fontFamily === null && !segment.linkSuppressed),
    `escaped ${JSON.stringify(source)} carries no marks`
  );
  assert.ok(segments.length <= 1, `escaped ${JSON.stringify(source)} stays one text run`);
}

// Layout paints the literal, so screen, print, and the PDF text layer agree.
const literalDoc = buildStarterResume();
literalDoc.sections[1].items[0].bullets[0].text = "Wrote parsers for <lt>b> and <lt>size=12> tags";
const runTexts = [];
const collectRuns = (node) => {
  if (Array.isArray(node)) node.forEach(collectRuns);
  else if (node && typeof node === "object") {
    if (typeof node.text === "string" && node.style) runTexts.push(node);
    else Object.values(node).forEach(collectRuns);
  }
};
collectRuns(layoutResume(toTypesetSchema(literalDoc), DOC_STYLE_DEFAULTS));
const paintedLine = runTexts.map((run) => run.text).join(" ");
assert.ok(paintedLine.includes("<b>") && paintedLine.includes("<size=12>"), "the escaped tags paint as text");
assert.ok(!runTexts.some((run) => run.text.includes("lt>")), "the token itself is never painted");

// The portable formats carry the token byte for byte; it is ordinary string content.
const resumeText = serializeResumeFile(literalDoc, DOC_STYLE_DEFAULTS);
assert.equal(
  parseResumeFile(resumeText).data.sections[1].items[0].bullets[0].text,
  "Wrote parsers for <lt>b> and <lt>size=12> tags"
);
assert.equal(serializeResumeFile(parseResumeFile(resumeText).data, parseResumeFile(resumeText).documentStyle), resumeText);
const letter = parseCoverLetterText("Dear team,\n\nI maintain a <lt>b> tag parser.");
const reopenedLetter = parseCoverLetterFile(serializeCoverLetterFile(letter, COVER_LETTER_STYLE_DEFAULTS));
assert.ok(coverLetterParagraphs(reopenedLetter.data).some((paragraph) => paragraph.includes("<lt>b> tag parser")));
assert.equal(coverLetterPlainText(reopenedLetter.data), "Dear team,\n\nI maintain a <b> tag parser.");

// Canonical spelling: <lt> only where a raw "<" would start a token.
const unmarked = (value) => segmentsFromInlineMarks(value).every((segment) =>
  !segment.bold && !segment.italic && !segment.underline && !segment.href && segment.fontSizePt === null && segment.fontFamily === null && !segment.linkSuppressed);
assert.equal(canonicalInlineMarkText("a <lt> b"), "a < b");
assert.equal(canonicalInlineMarkText("<lt>b> x"), "<lt>b> x");
assert.equal(canonicalInlineMarkText("<b>bold</b> <lt>i>"), "<b>bold</b> <lt>i>");
assert.equal(canonicalInlineMarkText(escapeInlineMarkText("<link=a<b>")), "<lt>link=a<lt>b>");

// Joins (paragraph merges) and protected transforms keep literals literal.
const merged = joinInlineMarkText("Parsers for <", "b> tags");
assert.equal(merged.value, "Parsers for <lt>b> tags", "a trailing literal \"<\" cannot open a tag with the next paragraph");
assert.equal(merged.index, "Parsers for <lt>".length, "the caret lands after the escaped literal");
assert.equal(joinInlineMarkText("a<lt>", "x").value, "a<x", "an escape the join no longer needs is dropped");
assert.equal(joinInlineMarkText("<b>a</b>", "<i>b</i>").value, "<b>a</b><i>b</i>", "real tags join unchanged");
assert.equal(stripInlineMarks(setFieldMark("<b>x<</b>i> y", "bold", false)), "x<i> y");
assert.ok(segmentsFromInlineMarks(setFieldMark("<b>x<</b>i> y", "bold", true)).every((segment) => !segment.italic), "rewrapping bold forms no italic");
assert.equal(stripInlineMarks(setFieldSize("a<<size=12>u>c</size>", "default")), "a<u>c");
assert.ok(unmarked(setFieldSize("a<<size=12>u>c</size>", "default")));
assert.ok(unmarked(setFieldMark("<b>x<</b>i> y", "bold", false)), "the literal stays text after the bold is removed");
assert.equal(stripInlineMarks(setFieldFont("a<<font=tinos>b>c</font>", "default")), "a<b>c");
assert.ok(unmarked(setFieldFont("a<<font=tinos>b>c</font>", "default")));
assert.equal(stripInlineMarks(clearAlignmentOverride("<align=center>x<</align>b> y")), "x<b> y");
assert.ok(unmarked(clearAlignmentOverride("<align=center>x<</align>b> y")));
const wrapped = setFieldMark("<lt>link=abc", "bold", true);
assert.ok(segmentsFromInlineMarks(wrapped).every((segment) => !segment.href), "wrapping a literal \"<link=…\" never makes a link");
assert.equal(stripInlineMarks(wrapped), "<link=abc");
assert.equal(stripInlineMarks(uppercaseInlineMarkedText("x<ı>y")), "X<I>Y", "an uppercase mapping cannot complete a tag");
assert.ok(unmarked(uppercaseInlineMarkedText("x<ı>y")));

// Any split-then-join of literal text restores it exactly (seeded).
for (let run = 0; run < 3000; run += 1) {
  let source = "";
  const length = Math.floor(random() * 14);
  for (let index = 0; index < length; index += 1) source += pieces[Math.floor(random() * pieces.length)];
  const whole = canonicalInlineMarkText(escapeInlineMarkText(source));
  assert.equal(canonicalInlineMarkText(whole), whole, "canonical spelling is idempotent");
  const at = Math.floor(random() * (source.length + 1));
  const left = canonicalInlineMarkText(escapeInlineMarkText(source.slice(0, at)));
  const right = canonicalInlineMarkText(escapeInlineMarkText(source.slice(at)));
  const joined = joinInlineMarkText(left, right);
  assert.equal(joined.value, whole, `join(${JSON.stringify(left)}, ${JSON.stringify(right)})`);
  assert.equal(stripInlineMarks(joined.value.slice(0, joined.index)), source.slice(0, at), "the join index separates the halves");
}

// A skills row's ": " separator is its own run in the format every character of
// both columns shares — by meaning, not tag spelling — so a whole-row size,
// font, or emphasis covers it; the painted text is unchanged.
for (const [label, skills, expected, why] of [
  ["<b>Tools</b>", "Git", "<b>Tools</b>: Git", "formatting only one column has leaves the separator plain"],
  ["", "Git", "Git", "a rowless label paints the skills alone"],
  ["<size=12><b>Tools</b></size>", "<size=12>Git</size>", "<size=12><b>Tools</b></size><size=12>: </size><size=12>Git</size>", "a whole-row size covers the separator"],
  ["<size=14><b>Tools</b></size>", "<size=14>Git, </size><size=14><b>Docker</b></size>", "<size=14><b>Tools</b></size><size=14>: </size><size=14>Git, </size><size=14><b>Docker</b></size>", "a row written as several runs still shares its size"],
  ["<b><i>Tools</i></b>", "<i>Git</i>", "<b><i>Tools</i></b><i>: </i><i>Git</i>", "shared emphasis covers the separator; the label's own bold does not"],
  ["<align=center><font=tinos>Tools</font></align>", "<align=center><font=tinos><u>Git</u></font></align>", "<align=center><font=tinos>Tools</font></align><align=center><font=tinos>: </font></align><align=center><font=tinos><u>Git</u></font></align>", "alignment and family are shared, a one-sided underline is not"],
  ["<size=12>Tools</size>", "Git", "<size=12>Tools</size>: Git", "a size on one column only leaves the separator at the default"],
  ["<b>Tools</b>", "<b></b>", "<b>Tools</b>: <b></b>", "a label alone never formats the separator, so typed skills stay plain"],
  ["<b>Tools</b>", "", "<b>Tools</b>: ", "an empty skills column leaves the separator plain"],
  ["<b>Tools <lt>link=x", "<b>Git</b>", "<b>Tools <lt>link=x<b>: </b><b>Git</b>", "a literal \"<\" ending the label cannot open a tag with the separator"],
  ["<link=https://a.example>Tools</link>", "<link=https://a.example>Git</link>", "<link=https://a.example>Tools</link>: <link=https://a.example>Git</link>", "a link never extends onto the separator"],
  ["<size=12>a<lt>b</size>", "<size=12>Git</size>", "<size=12>a<b</size><size=12>: </size><size=12>Git</size>", "a literal \"<\" is text, not a tag, in its canonical spelling"]
]) {
  const joined = skillsRowText(label, skills);
  assert.equal(joined, expected, why);
  assert.equal(stripInlineMarks(joined), label ? `${stripInlineMarks(label)}: ${stripInlineMarks(skills)}` : stripInlineMarks(skills), `${why}: painted text unchanged`);
}
assert.deepEqual(
  segmentsFromInlineMarks(skillsRowText("<font=tinos><size=14><b>Tools</b></size></font>", "<font=tinos><size=14>Git</size></font>"))
    .map((segment) => [segment.text, segment.fontFamily, segment.fontSizePt, segment.bold]),
  [["Tools", "tinos", 14, true], [": ", "tinos", 14, false], ["Git", "tinos", 14, false]],
  "the painted separator carries the row's family and size but not the label's bold"
);

// The shared-format walk is one pass: a crafted file of deeply nested tags stays fast.
const nested = `${"<b>".repeat(32000)}Git${"</b>".repeat(32000)}`;
const joinStarted = performance.now();
assert.equal(stripInlineMarks(skillsRowText(nested, nested)), "Git: Git");
assert.ok(performance.now() - joinStarted < 2000, "joining 32,000 nested wrappers takes well under two seconds");

// Escaping is one pass: thousands of needed escapes in a long field stay fast.
const manyTags = escapeInlineMarkText("<b>x".repeat(40000));
const started = performance.now();
const canonicalMany = canonicalInlineMarkText(manyTags);
assert.ok(performance.now() - started < 2000, "canonicalizing 40,000 escapes takes well under two seconds");
assert.equal(stripInlineMarks(canonicalMany), "<b>x".repeat(40000));

console.log("inline marks: inert size slots, nested scopes, tag-safe uppercase, the <lt> literal, joins, and protected transforms passed");
