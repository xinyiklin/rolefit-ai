// Focused regression checks for direct-editing whitespace, deleted typography,
// and engine-derived structural hit areas.
// Run: node --experimental-strip-types src/sections/editor/__evals__/typeset-editing.mjs

import assert from "node:assert/strict";

import {
  applyInlineFragment,
  applyEdit,
  buildDisplayMap,
  expandToLinkRun,
  inlineFragmentForRange,
  setFontSize,
  suppressedAutoLinkValue,
  trailingLinkWordAt,
  typingFormatForDeletedRange
} from "../inlineTextEditing.ts";
import {
  decodeInlineClipboard,
  encodeInlineClipboard
} from "../clipboardFormatting.ts";
import { commitField, valueForField } from "../resumeFieldAdapter.ts";
import { anchorsFromDoc } from "../typesetStructure.ts";
import { FONT_FAMILY_OPTIONS } from "@typeset/engine/lib/documentStyle.ts";
import { clearInlineOverride, effectiveFieldFont } from "@typeset/engine/lib/inlineMarksText.ts";
import { automaticLinkHref } from "@typeset/engine/lib/links.ts";

const skillsSrc = { kind: "skillsRow", sectionId: "skills", entryId: "row" };
let storedRow = { label: "", skills: "" };
const actions = {
  updateSkillsRow(_sectionId, _entryId, label, skills) {
    storedRow = { label, skills };
  }
};

const storedData = () => ({
  name: "",
  contact: [],
  sections: [
    {
      id: "skills",
      heading: "Skills",
      type: "skills",
      items: [
        {
          id: "row",
          titleLeft: storedRow.label,
          titleRight: "",
          subtitleLeft: storedRow.skills,
          subtitleRight: "",
          bullets: []
        }
      ]
    }
  ]
});

commitField(actions, skillsSrc, "Tools: ");
assert.deepEqual(storedRow, { label: "Tools", skills: "" });
assert.equal(valueForField(storedData(), skillsSrc), "Tools: ");

commitField(actions, skillsSrc, "Tools:  ");
assert.deepEqual(storedRow, { label: "Tools", skills: " " });
assert.equal(valueForField(storedData(), skillsSrc), "Tools:  ");

commitField(actions, skillsSrc, "Tools: React, ");
assert.deepEqual(storedRow, { label: "Tools", skills: "React, " });
assert.equal(valueForField(storedData(), skillsSrc), "Tools: React, ");

commitField(actions, skillsSrc, "Programming : React");
assert.deepEqual(storedRow, { label: "Programming ", skills: "React" });
assert.equal(valueForField(storedData(), skillsSrc), "Programming : React");

const styled = buildDisplayMap(
  "<b>A</b><font=source-sans><size=14>B</size></font>",
  { preserveWhitespace: true }
);
const deletedFormat = typingFormatForDeletedRange(styled, 0, 2);
assert.deepEqual(deletedFormat, {
  bold: false,
  italic: false,
  underline: false,
  fontFamily: "source-sans",
  fontSizePt: 14,
  alignment: null
});
const emptied = applyEdit(styled, 0, 2, "");
const retyped = applyEdit(buildDisplayMap(emptied.value, { preserveWhitespace: true }), 0, 0, "Z", deletedFormat ?? undefined);
const retypedMap = buildDisplayMap(retyped.value, { preserveWhitespace: true });
assert.equal(retypedMap.display, "Z");
assert.equal(retypedMap.chars[0].fontFamily, "source-sans");
assert.equal(retypedMap.chars[0].fontSizePt, 14);

const authoredIndent = buildDisplayMap("    Indented", { preserveWhitespace: true });
assert.equal(authoredIndent.display, "    Indented", "Tab-equivalent leading spaces remain editable");

const mixedSource = buildDisplayMap(
  "<font=source-serif>A</font><font=source-sans><size=24><b>B</b></size></font><i>C</i>",
  { preserveWhitespace: true }
);
const mixedFragment = inlineFragmentForRange(mixedSource, 0, 3);
const transportedFragment = decodeInlineClipboard(encodeInlineClipboard(mixedFragment));
assert.equal(transportedFragment, mixedFragment);
const mixedPaste = applyInlineFragment(
  buildDisplayMap("xy", { preserveWhitespace: true }),
  1,
  1,
  transportedFragment
);
const mixedPasteMap = buildDisplayMap(mixedPaste.value, { preserveWhitespace: true });
assert.equal(mixedPasteMap.display, "xABCy");
assert.equal(mixedPasteMap.chars[1].fontFamily, "source-serif");
assert.equal(mixedPasteMap.chars[2].fontFamily, "source-sans");
assert.equal(mixedPasteMap.chars[2].fontSizePt, 24);
assert.equal(mixedPasteMap.chars[2].bold, true);
assert.equal(mixedPasteMap.chars[3].italic, true);

const boundedSizeSource = buildDisplayMap("ABC", { preserveWhitespace: true });
const belowMinimum = setFontSize(boundedSizeSource, 0, 1, -20);
const aboveMaximum = setFontSize(
  buildDisplayMap(belowMinimum.value, { preserveWhitespace: true }),
  1,
  2,
  900
);
const boundedSizeMap = buildDisplayMap(aboveMaximum.value, { preserveWhitespace: true });
assert.equal(boundedSizeMap.chars[0].fontSizePt, 1);
assert.equal(boundedSizeMap.chars[1].fontSizePt, 200);
assert.equal(boundedSizeMap.chars[2].fontSizePt, null);

const style = { family: "latin-modern", face: "regular", size: 10, tracking: 0 };
const bulletSrc = { kind: "bullet", sectionId: "work", entryId: "job", bulletId: "bullet" };
const anchors = anchorsFromDoc({
  geometry: {},
  pages: [
    {
      lines: [
        {
          baseline: 100,
          runs: [
            { text: "•", x: 64, width: 4, style, src: bulletSrc, marker: true },
            { text: "Built it", x: 82, width: 34, style, src: bulletSrc }
          ]
        }
      ]
    }
  ]
});
const bulletAnchor = anchors.blocks.find((block) => block.kind === "bullet");
assert.equal(bulletAnchor?.x0, 64);
assert.equal(bulletAnchor?.x1, 116);

// ----- caret mapping across engine line breaks -----
// A field's painted spans are split by inline style boundaries AND by line
// breaks, and the breaker consumes the interword glue INTO the break: that
// display character has no DOM character on either side. Walking spans without
// accounting for it desynchronizes, which made every wrapped continuation line
// uneditable (the caret could not be read at all) and threw a restored caret
// back to the end of the previous line.
//
// domSelection.ts is DOM-facing but pure over that structure, so these checks
// drive it with the smallest faithful stand-in for the painted tree.
globalThis.CSS ??= { escape: (value) => value };
globalThis.Node ??= { TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.HTMLElement ??= class HTMLElement {};
const {
  caretToDisplayIndex,
  displayIndexToCaret,
  lineEdgePosition
} = await import("../domSelection.ts");

const paintedHost = (lines) => {
  const spans = [];
  const nodes = [];
  const lineElements = [];
  for (const runs of lines) {
    const lineElement = Object.assign(new HTMLElement(), {
      className: "tsd-line",
      children: []
    });
    lineElements.push(lineElement);
    for (const run of runs) {
      const textNode = { nodeType: 3, textContent: run.text };
      const span = Object.assign(new HTMLElement(), {
        firstChild: textNode,
        hasAttribute: (name) => name === "data-tsde" && Boolean(run.empty),
        getAttribute: (name) => (name === "data-tsdf" ? run.key : null),
        closest: (selector) => (selector === ".tsd-line" ? lineElement : null)
      });
      textNode.parentElement = span;
      lineElement.children.push(span);
      spans.push({ span, key: run.key });
      nodes.push(textNode);
    }
  }
  return {
    nodes,
    lines: lineElements,
    host: {
      querySelectorAll: (selector) => {
        const match = /data-tsdf="([^"]+)"/.exec(selector);
        return spans.filter((entry) => !match || entry.key === match[1]).map((entry) => entry.span);
      }
    }
  };
};

const KEY = "bullet|s1|e1|b1";
const trailing = paintedHost([[{ key: KEY, text: "abc   " }]]);
assert.deepEqual(
  lineEdgePosition(trailing.lines[0], "end"),
  { node: trailing.nodes[0], offset: 6 },
  "End and a click after the last field land after authored trailing spaces"
);

// "abc def" wrapped at the space: the break ate it, so neither line holds it.
const wrapped = paintedHost([[{ key: KEY, text: "abc" }], [{ key: KEY, text: "def" }]]);
const wrappedDisplay = "abc def";
assert.equal(
  caretToDisplayIndex(wrapped.host, KEY, wrappedDisplay, wrapped.nodes[1], 0),
  4,
  "the start of a continuation line maps past the glue the break consumed"
);
assert.equal(
  caretToDisplayIndex(wrapped.host, KEY, wrappedDisplay, wrapped.nodes[1], 3),
  7,
  "the end of a continuation line maps to the end of the value"
);
assert.equal(
  caretToDisplayIndex(wrapped.host, KEY, wrappedDisplay, wrapped.nodes[0], 3),
  3,
  "the end of the broken line maps before the consumed glue"
);
assert.deepEqual(
  displayIndexToCaret(wrapped.host, KEY, wrappedDisplay, 7),
  { node: wrapped.nodes[1], offset: 3 },
  "a caret at the value end resolves onto the continuation line, not the line above"
);
assert.deepEqual(
  displayIndexToCaret(wrapped.host, KEY, wrappedDisplay, 4),
  { node: wrapped.nodes[1], offset: 0 },
  "a caret just past the break opens the continuation line"
);
assert.deepEqual(
  displayIndexToCaret(wrapped.host, KEY, wrappedDisplay, 3),
  { node: wrapped.nodes[0], offset: 3 },
  "a caret AT the break stays at the end of the line that was broken"
);

// Two authored spaces: one survives as a literal glyph, the break eats the other.
const doubleSpaced = paintedHost([[{ key: KEY, text: "abc " }], [{ key: KEY, text: "def" }]]);
assert.equal(
  caretToDisplayIndex(doubleSpaced.host, KEY, "abc  def", doubleSpaced.nodes[1], 0),
  5,
  "only the glue the break consumed is skipped, not authored spaces"
);

// An authored hard break paints a BLANK line between two text lines. It stands
// for a break that consumed its own display character, so it has to take part in
// the walk rather than be stepped over.
const hardBroken = paintedHost([
  [{ key: KEY, text: "a" }],
  [{ key: KEY, text: "", empty: true }],
  [{ key: KEY, text: "b" }]
]);
const hardDisplay = "a\n\nb";
assert.equal(
  caretToDisplayIndex(hardBroken.host, KEY, hardDisplay, hardBroken.nodes[1], 0),
  2,
  "a caret on a blank line maps past the first authored break, not to index 0"
);
assert.equal(
  caretToDisplayIndex(hardBroken.host, KEY, hardDisplay, hardBroken.nodes[2], 1),
  4,
  "text after a blank line maps past BOTH authored breaks"
);
assert.deepEqual(
  displayIndexToCaret(hardBroken.host, KEY, hardDisplay, 2),
  { node: hardBroken.nodes[1], offset: 0 },
  "a caret on the blank line resolves onto it"
);
assert.deepEqual(
  displayIndexToCaret(hardBroken.host, KEY, hardDisplay, 4),
  { node: hardBroken.nodes[2], offset: 1 },
  "the value end after a blank line resolves onto the last line"
);

// An oversized token splits mid-word, where no glue was consumed.
const midToken = paintedHost([[{ key: KEY, text: "abc" }], [{ key: KEY, text: "def" }]]);
assert.equal(
  caretToDisplayIndex(midToken.host, KEY, "abcdef", midToken.nodes[1], 0),
  3,
  "an emergency mid-token break consumes nothing"
);

// Style boundaries inside ONE line are not breaks either.
const styleSplit = paintedHost([[{ key: KEY, text: "abc" }, { key: KEY, text: "def" }]]);
assert.equal(
  caretToDisplayIndex(styleSplit.host, KEY, "abcdef", styleSplit.nodes[1], 0),
  3,
  "an inline style boundary on one line consumes nothing"
);

// ---- every font family survives a value → display → value round trip ----
//
// The tag grammar is written twice on purpose (engine measurement scans it with
// a global regex; the editor steps it anchored, one tag at a time). Both take
// their font alternation from lib/fontFamilies.ts, but nothing in the TYPE system
// connects a family id to a regex string: a family missing from one automaton
// compiles cleanly and then fails at runtime, with the tag surviving into the
// display text as literal characters. Sweeping the real list is the only guard.
for (const { value: family } of FONT_FAMILY_OPTIONS) {
  const tagged = `<font=${family}>Ab</font>`;
  const map = buildDisplayMap(tagged, { preserveWhitespace: true });
  assert.equal(map.display, "Ab", `<font=${family}> must be parsed as a tag, not painted as text`);
  assert.equal(map.chars[0].fontFamily, family, `<font=${family}> must resolve to that family`);
  // A no-op edit re-serialises the whole map, so it proves the value survives.
  assert.equal(
    applyEdit(map, 0, 0, "").value,
    tagged,
    `<font=${family}> must round-trip back to the same value`
  );
  // clearInlineOverride is a third spelling of the same alternation.
  assert.equal(
    clearInlineOverride(tagged, "fontFamily"),
    "Ab",
    `clearInlineOverride must strip <font=${family}>`
  );
  assert.equal(
    effectiveFieldFont(tagged, "latin-modern"),
    family,
    `effectiveFieldFont must report ${family}`
  );
}

// ---- hyperlink editing behaviour ----
//
// These lock the four link defects that made typing near a link destructive. Each
// is written as the KEYSTROKE a user performs, because every one of them looked
// harmless in isolation and only misbehaved in the position a real edit lands in.
const dm = (value) => buildDisplayMap(value, { preserveWhitespace: true });

// 1. Typing immediately AFTER a link must not extend it. Inheriting link state
//    from the character to the left swallowed the rest of the sentence.
{
  const map = dm("<link=https%3A%2F%2Fa.com>a.com</link> x");
  const end = map.chars.length;
  const typed = applyEdit(map, end, end, "Z").value;
  assert.equal(
    dm(typed).chars[dm(typed).chars.length - 1].linkHref,
    null,
    "typing after a link must not inherit its href"
  );
  // Typing INSIDE the link still stays in it.
  const inside = applyEdit(map, 2, 2, "Z").value;
  assert.equal(dm(inside).chars[2].linkHref, "https://a.com/", "typing inside a link stays linked");
  // Typing at the link's own trailing edge (before the following space) is an
  // edge, not an interior, so it does not extend the link either.
  const atEdge = applyEdit(map, 5, 5, "Z").value;
  assert.equal(dm(atEdge).chars[5].linkHref, null, "typing at a link's trailing edge must not extend it");
}

// 2. A <nolink> suppression must not leak into text typed after it, which
//    permanently killed auto-linking from that point on.
{
  const map = dm("<nolink>a.com</nolink> ");
  const end = map.chars.length;
  const typed = applyEdit(map, end, end, "b.com").value;
  const chars = dm(typed).chars;
  assert.equal(
    chars.slice(-5).every((c) => c.linkSuppressed === false),
    true,
    "<nolink> must not be inherited past its own run"
  );
}

// 3. trailingLinkWordAt defers only AUTOMATIC links. A real hyperlink must keep
//    its anchor while the caret rests at its end.
{
  const auto = dm("a.com");
  assert.deepEqual(
    trailingLinkWordAt(auto, auto.chars.length),
    { start: 0, end: 5 },
    "an automatic link being typed is deferred"
  );
  const explicit = dm("<link=https%3A%2F%2Fa.com>a.com</link>");
  assert.equal(
    trailingLinkWordAt(explicit, explicit.chars.length),
    null,
    "an explicit link must never be deferred — it would visibly lose its anchor"
  );
}

// 4. expandToLinkRun must never reach out of one href's contiguous run, or
//    Remove/Apply rewrites the neighbouring link's text.
{
  const two = dm("<link=https%3A%2F%2Fa.com>aaa</link> <link=https%3A%2F%2Fb.com>bbb</link>");
  assert.equal(two.display, "aaa bbb");
  assert.deepEqual(
    expandToLinkRun(two, 1, 1),
    { start: 0, end: 3, href: "https://a.com/" },
    "a caret in the first link resolves to the first link"
  );
  assert.deepEqual(
    expandToLinkRun(two, 5, 5),
    { start: 4, end: 7, href: "https://b.com/" },
    "a caret in the second link resolves to the second link"
  );
  // A selection crossing BOTH links must resolve inside one of them only.
  const crossing = expandToLinkRun(two, 1, 6);
  assert.equal(crossing.href, "https://a.com/", "a crossing selection resolves to the first link");
  assert.equal(crossing.end <= 3, true, `a crossing selection must not reach into the neighbour (got end=${crossing.end})`);
}

// 5. A bare filename is not a domain. A resume says "resume.pdf" and "README.md"
//    constantly; auto-linking them produced https://resume.pdf.
for (const notALink of ["resume.pdf", "README.md", "notes.txt", "diagram.png", "archive.zip", "data.json", "app.exe"]) {
  assert.equal(automaticLinkHref(notALink), null, `${notALink} must not auto-link`);
}
for (const isALink of ["example.com", "sub.example.co.uk", "example.io/resume.pdf", "www.example.dev", "me@example.com"]) {
  assert.notEqual(automaticLinkHref(isALink), null, `${isALink} must still auto-link`);
}

// 6. The render overlay for a deferred auto-link must always display exactly the
//    CURRENT value. A cached overlay value was stale for the repaint after the
//    next keystroke, and the caret restore then clamped one character short.
{
  let range = null;
  for (let i = 1; i <= "example.com ".length; i += 1) {
    const value = "example.com ".slice(0, i);
    const map = dm(value);
    if (range) {
      const painted = suppressedAutoLinkValue(map, range);
      assert.equal(
        painted === null ? map.display : dm(painted).display,
        map.display,
        `the deferred-auto-link paint must display the current value at ${JSON.stringify(value)}`
      );
    }
    const word = trailingLinkWordAt(map, map.chars.length);
    range = word ? { dStart: word.start, dEnd: word.end } : null;
  }
}

console.log(
  `typeset editing: whitespace, rich clipboard, bounded typography, drag hit-area, ${FONT_FAMILY_OPTIONS.length}-family tag round-trip, and hyperlink-editing checks passed`
);
