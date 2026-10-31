// The display map must hold exactly the text the engine paints, character for
// character, or caret offsets and diff-based edits drift. A link keeps the
// punctuation it was typed with (no -- → – or ' → ’) in the painted text, so
// the map keeps it too: in an explicit <link>, in an automatically linked
// word, and while a word being typed has its auto-link deferred.
// Run: node --experimental-strip-types src/sections/editor/__evals__/link-display.mjs
import assert from "node:assert/strict";

import { DOC_STYLE_DEFAULTS } from "@typeset/engine/lib/documentStyle.ts";
import { encodeLinkHref } from "@typeset/engine/lib/links.ts";
import { ensureAllFontMetrics } from "@typeset/engine/typeset/fontRegistry.ts";
import { layoutResume } from "@typeset/engine/typeset/layout.ts";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";
import {
  applyPlainTextInputEdit,
  buildDisplayMap,
  displayIndexForValueIndex,
  suppressedAutoLinkValue,
  trailingLinkWordAt
} from "../inlineTextEditing.ts";

await ensureAllFontMetrics();

// The text the engine paints for one field, spaces where glue or a consumed
// separator stood (as the DOM painter emits them).
function painted(value, kind, headingCase = DOC_STYLE_DEFAULTS.headingCase) {
  const data = toTypesetSchema({
    header: { visible: true, name: "Name", contact: kind === "contact" ? [value] : ["x@example.test"] },
    sections: [{ id: "s", heading: kind === "heading" ? value : "Notes", type: "standard", items: [{ id: "e", titleLeft: "Title", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "b", text: kind === "bullet" ? value : "Body" }] }] }]
  });
  const runs = layoutResume(data, { ...DOC_STYLE_DEFAULTS, headingCase }).pages.flatMap((page) => page.lines.flatMap((line) => line.runs))
    .filter((run) => run.src?.kind === kind && !run.marker && (kind !== "contact" || run.src.index === 0));
  let text = "";
  let end = null;
  for (const run of runs) {
    if (end !== null && run.x - end > 0.3) text += " ";
    text += run.text + (run.breakAfter === " " ? " " : run.breakAfter === "\n" ? "\n" : "");
    end = run.breakAfter ? null : run.x + run.width;
  }
  return text;
}
const display = (value) => buildDisplayMap(value, { preserveWhitespace: true }).display;
const squash = (text) => text.replace(/\s+/g, " ").trim();

const values = [
  "Mail a--b@x.com or see xn--bcher-kva.example/o'neil -- O'Neil's notes",
  "<link=https://example.test/o'neil>O'Neil's -- site</link> and it's",
  "x<b>--b@x.com</b> it's",
  "a<lt>b--c@x.com don't",
  "<nolink>a--b@x.com</nolink> isn't linked",
  "sean.o'brien@gmail.com",
  "it's -- not---a link",
  "<b>sean.o'brien</b>@gmail.com and x<i>--</i>y@z.com"
];
for (const value of values) {
  for (const kind of ["bullet", "contact"]) {
    assert.equal(squash(display(value)), squash(painted(value, kind)), `${kind} ${JSON.stringify(value)}: the display map holds the painted text`);
  }
}
assert.equal(display("Mail a--b@x.com -- it's"), "Mail a--b@x.com – it’s", "only the link keeps its typed punctuation");

// Deferring the auto-link of the word being typed marks it <nolink> for the
// paint only; the painted text still matches the map of the stored value.
{
  const value = "Write a--b@x.com";
  const map = buildDisplayMap(value, { preserveWhitespace: true });
  const word = trailingLinkWordAt(map, map.display.length);
  assert.ok(word, "the email at the caret is deferred");
  const renderValue = suppressedAutoLinkValue(map, { dStart: word.start, dEnd: word.end });
  assert.equal(painted(renderValue, "bullet"), map.display, "a deferred link paints the text the map holds");
}

// Small-caps headings drop <b>/<i>/<u> before layout. A word is read across
// tags, so an address split by a mark is still one link word, shown as typed
// in every piece, whichever heading case paints it.
for (const headingCase of ["smallcaps", "uppercase", "none"]) {
  for (const value of [...values, "Contact x<b>--</b>y@z.com", "Contact <i>o'</i>neil@x.com it's"]) {
    const map = buildDisplayMap(value, { preserveWhitespace: true, uppercase: headingCase === "uppercase" });
    assert.equal(squash(map.display), squash(painted(value, "heading", headingCase)), `${headingCase} heading ${JSON.stringify(value)}: the display map holds the painted text`);
  }
  if (headingCase === "uppercase") continue;
  const value = "Contact x<b>--</b>y@z.com";
  const edited = applyPlainTextInputEdit(value, painted(value, "heading", headingCase) + "Q");
  assert.equal(edited.value, `${value}Q`, `${headingCase} heading: typing after a mark-split address keeps its marks`);
}

// Re-serializing an edit merges adjacent same-format runs, so two tags that
// split a word can vanish. The word, read across tags, is the same before and
// after, so its display length never changes and a later link edge and the
// caret stay put.
{
  const site = `<link=${encodeLinkHref("https://e.test/")}>site</link>`;
  for (const [value, after, linkText] of [
    [`<b>a--b</b><b>@x.co</b> see ${site}`, "a--b@x.co see si", "sizte"],
    [`<b>o'</b><b>brien@x.co</b> see ${site}`, "o'brien@x.co see si", "sizte"],
    [`<b>a--b</b><b>@x.co</b> see more`, "a--b@x.co see m", ""]
  ]) {
    const map = buildDisplayMap(value, { preserveWhitespace: true });
    assert.equal(map.display, painted(value, "bullet"), `${JSON.stringify(value)}: the map holds the painted text`);
    assert.ok(map.display.startsWith(after), `${JSON.stringify(value)} shows ${JSON.stringify(map.display)}`);
    const edited = applyPlainTextInputEdit(value, `${after}z${map.display.slice(after.length)}`);
    const next = buildDisplayMap(edited.value, { preserveWhitespace: true });
    assert.equal(next.display, `${after}z${map.display.slice(after.length)}`, `${JSON.stringify(value)}: the edit adds only z (${edited.value})`);
    assert.equal(next.chars.map((char, index) => (char.linkHref ? next.display[index] : "")).join(""), linkText, `${JSON.stringify(value)}: the link keeps its own text (${edited.value})`);
    assert.equal(displayIndexForValueIndex(next, edited.caretValueIndex), after.length + 1, `${JSON.stringify(value)}: the caret follows z`);
  }
}

// Typing inside and after a linked "--": the browser reports the painted text
// with one character added; the stored value gains exactly that character and
// the caret lands right after it in the next paint.
for (const [value, after, typed] of [
  ["Write a--b@x.com today", "Write a--", "z"],
  ["Write a--b@x.com today", "Write a--b@x.com", "z"],
  ["<b>a</b>--b@x.com", "a--b@x.com", "z"],
  [`<link=${encodeLinkHref("https://example.test/x")}>O'Neil--site</link> ok`, "O'Neil--", "z"]
]) {
  const before = painted(value, "bullet");
  assert.ok(before.startsWith(after), `${JSON.stringify(value)} paints as typed (${JSON.stringify(before)})`);
  const offset = after.length;
  const edited = applyPlainTextInputEdit(value, before.slice(0, offset) + typed + before.slice(offset));
  const valueOffset = value.indexOf(after.slice(-6)) + after.slice(-6).length;
  const expected = value.slice(0, valueOffset) + typed + value.slice(valueOffset);
  assert.equal(edited.value, expected, `${JSON.stringify(value)}: typing ${typed} changes only that character`);
  const map = buildDisplayMap(edited.value, { preserveWhitespace: true });
  assert.equal(displayIndexForValueIndex(map, edited.caretValueIndex), offset + 1, `${JSON.stringify(value)}: the caret follows the typed character`);
  assert.equal(map.display, painted(edited.value, "bullet"), `${JSON.stringify(value)}: the next paint matches the map`);
}

console.log(`link display: ${values.length} values stay in step with the painted text; typing inside linked punctuation edits only the typed character`);
