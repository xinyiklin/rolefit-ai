// Focused regression checks for direct-editing whitespace, deleted typography,
// and engine-derived structural hit areas.
// Run: node --experimental-strip-types src/sections/editor/__evals__/typeset-editing.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  autoLinkSuppressionForSelection,
  applyInlineFragment,
  applyEdit,
  applyPlainTextInputEdit,
  buildDisplayMap,
  expandToLinkRun,
  inlineFragmentForRange,
  replaceWithParagraphFragments,
  replaceWithLink,
  setAlignment,
  setLineHeightRanges,
  setParagraphLineHeight,
  setParagraphSpaceAfter,
  setParagraphSpaceBefore,
  setEmptyFieldTypingFormat,
  setFontSize,
  splitValueAt,
  suppressedAutoLinkValue,
  trailingLinkWordAt,
  typingFormatForDeletedRange
} from "../inlineTextEditing.ts";
import {
  clipboardHtmlForRanges,
  clipboardPlainTextForRanges
} from "../clipboardHtmlExport.ts";
import {
  clipboardLineHeight,
  clipboardParagraphSpacePt
} from "../clipboardHtmlImport.ts";
import {
  decodeInlineClipboard,
  decodeSelectionClipboard,
  encodeInlineClipboard,
  encodeSelectionClipboard
} from "../clipboardPrivateCodec.ts";
import {
  clipboardBlocks,
  defaultDocumentPasteMapping
} from "../documentPasteMapping.ts";
import {
  commitField,
  historyCaretTarget,
  valueForField
} from "../resumeFieldAdapter.ts";
import { anchorsFromDoc } from "../typesetStructure.ts";
import { FONT_FAMILY_OPTIONS } from "@typeset/engine/lib/documentStyle.ts";
import {
  clearInlineOverride,
  effectiveFieldFont,
  paragraphSpacingFromInlineMarks
} from "@typeset/engine/lib/inlineMarksText.ts";
import { automaticLinkHref } from "@typeset/engine/lib/links.ts";

const skillsSrc = { kind: "skillsRow", sectionId: "skills", entryId: "row" };
let storedRow = { label: "", skills: "" };
const actions = {
  updateSkillsRow(_sectionId, _entryId, label, skills) {
    storedRow = { label, skills };
  }
};

const storedData = () => ({
  header: { visible: true, name: "", contact: [] },
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

assert.equal(
  applyPlainTextInputEdit("<b>Candidate</b>", "Candidates").value,
  "<b>Candidates</b>",
  "editing a formatted header field through its plain-text input preserves inherited marks"
);
assert.equal(
  applyPlainTextInputEdit(
    "<b>Candidate</b> · <i>New York</i>",
    "Candidate X · New York"
  ).value,
  "<b>Candidate</b> X · <i>New York</i>",
  "plain-text header editing preserves marks outside the smallest changed range and inherits at the actual insertion point"
);
for (const {
  previous,
  next,
  expectedHref,
  label
} of [
  {
    previous: "<link=mailto%3Ajane%40example.com>jane@example.com</link>",
    next: "john@example.com",
    expectedHref: "mailto:john@example.com",
    label: "editing an email recalculates its derived destination"
  },
  {
    previous: "<link=https%3A%2F%2Fexample.com%2Fold>example.com/old</link>",
    next: "example.org/new",
    expectedHref: "https://example.org/new",
    label: "replacing a URL recalculates its derived destination"
  },
  {
    previous: "<link=https%3A%2F%2Fexample.com>example.com</link>",
    next: "example.org",
    expectedHref: "https://example.org/",
    label: "editing a bare domain recalculates its normalized destination"
  },
  {
    previous: "<link=tel%3A%2B12125550100>+1 (212) 555-0100</link>",
    next: "+1 (646) 555-0199",
    expectedHref: "tel:+16465550199",
    label: "editing a phone number recalculates its derived destination"
  },
  {
    previous: "<link=mailto%3Ajane%40example.com>jane@example.com</link>",
    next: "New York City",
    expectedHref: null,
    label: "replacing an automatic link with plain text removes its destination"
  },
  {
    previous: "<link=https%3A%2F%2Fportfolio.example>Portfolio</link>",
    next: "Selected work",
    expectedHref: "https://portfolio.example/",
    label: "editing a custom link label preserves its independent destination"
  }
]) {
  const edited = applyPlainTextInputEdit(previous, next);
  const editedMap = buildDisplayMap(edited.value, { preserveWhitespace: true });
  assert.equal(editedMap.display, next, `${label}: visible text`);
  assert.equal(editedMap.chars[0]?.linkHref ?? null, expectedHref, label);
}
assert.equal(
  automaticLinkHref("+1 (212) 555-0100"),
  "tel:+12125550100",
  "phone contacts auto-link to a canonical tel destination"
);
assert.equal(
  automaticLinkHref("2026-07-29"),
  null,
  "an ISO date is not mistaken for a telephone link"
);
assert.equal(
  automaticLinkHref("+1 (212) 555-0100 ext 42"),
  "tel:+12125550100;ext=42",
  "phone extensions use a stable tel destination"
);

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
assert.equal(clipboardParagraphSpacePt("8pt"), 8);
assert.equal(
  clipboardParagraphSpacePt("16px"),
  12,
  "Google Docs CSS pixel margins convert to physical paragraph points"
);
assert.equal(clipboardLineHeight("1.5", 11), 1.5);
assert.equal(clipboardLineHeight("150%", 11), 1.5);
assert.equal(
  clipboardLineHeight("22px", 11),
  1.5,
  "Google Docs absolute CSS line height resolves against the paragraph font size"
);
assert.equal(clipboardLineHeight("normal", 11), null);

// External rich copy is built from logical fields, never the engine's visual
// line divs. A destination with a different measure may reflow the paragraph,
// but it must not inherit Typeset's old wrap points as separate blocks.
{
  const paragraph = buildDisplayMap(
    "<line-height=1.5><space-before=8><space-after=12><font=arimo><b>A paragraph that wraps wherever the destination needs.</b></font></space-after></space-before></line-height>",
    { preserveWhitespace: true }
  );
  const html = clipboardHtmlForRanges([
    {
      src: { kind: "bullet", sectionId: "summary", entryId: "one", bulletId: "one" },
      map: paragraph,
      dStart: 0,
      dEnd: paragraph.chars.length,
      defaultFontFamily: "tinos",
      defaultFontSizePt: 10,
      defaultAlignment: "left",
      defaultLineHeight: 1.15
    }
  ]);
  assert.equal(
    html,
    '<p style="margin-top: 8pt; margin-right: 0; margin-bottom: 12pt; margin-left: 0; text-align: left; line-height: 1.5"><span style="font-family: Arial; font-size: 10pt; line-height: 1.5; font-weight: 700; white-space: pre-wrap">A paragraph that wraps wherever the destination needs.</span></p>'
  );
  assert.equal(html.includes("&nbsp;"), false, "paragraph spacing does not create a blank paragraph");
  assert.equal(
    (html.match(/<p /g) ?? []).length,
    1,
    "one logical paragraph remains one external paragraph when it carries spacing"
  );

  const second = buildDisplayMap("<i>Second logical paragraph.</i>", {
    preserveWhitespace: true
  });
  const crossField = clipboardHtmlForRanges([
    {
      src: { kind: "bullet", sectionId: "summary", entryId: "one", bulletId: "one" },
      map: paragraph,
      dStart: 0,
      dEnd: paragraph.chars.length,
      defaultFontFamily: "tinos",
      defaultFontSizePt: 10,
      defaultAlignment: "left",
      defaultLineHeight: 1.15
    },
    {
      src: { kind: "bullet", sectionId: "summary", entryId: "two", bulletId: "two" },
      map: second,
      dStart: 0,
      dEnd: second.chars.length,
      defaultFontFamily: "tinos",
      defaultFontSizePt: 10,
      defaultAlignment: "left",
      defaultLineHeight: 1.15
    }
  ]);
  assert.equal(
    (crossField.match(/>A paragraph that wraps wherever the destination needs\.<\/span>/g) ?? []).length,
    1,
    "one model paragraph remains one clipboard block"
  );
  assert.equal(
    (crossField.match(/<p style="/g) ?? []).length,
    2,
    "cross-field copy emits one block per logical field"
  );

  const automaticLink = buildDisplayMap("Portfolio: example.com", {
    preserveWhitespace: true
  });
  const automaticLinkHtml = clipboardHtmlForRanges([
    {
      src: { kind: "bullet", sectionId: "summary", entryId: "link", bulletId: "link" },
      map: automaticLink,
      dStart: 0,
      dEnd: automaticLink.chars.length,
      defaultFontFamily: "tinos",
      defaultFontSizePt: 10,
      defaultAlignment: "left",
      defaultLineHeight: 1.15
    }
  ]);
  assert.match(
    automaticLinkHtml,
    /<a href="https:\/\/example\.com\/?"><span[^>]*>example\.com<\/span><\/a>/,
    "auto-detected editor links become real outbound HTML anchors"
  );

  const name = buildDisplayMap("<b>Candidate Name</b>", { preserveWhitespace: true });
  const email = buildDisplayMap("candidate@example.com", { preserveWhitespace: true });
  const city = buildDisplayMap("New York, NY", { preserveWhitespace: true });
  const headerRanges = [
    { src: { kind: "name" }, map: name },
    { src: { kind: "contact", index: 0 }, map: email },
    { src: { kind: "contact", index: 1 }, map: city }
  ].map(({ src, map }) => ({
    src,
    map,
    dStart: 0,
    dEnd: map.chars.length,
    defaultFontFamily: "tinos",
    defaultFontSizePt: 10,
    defaultAlignment: "center",
    defaultLineHeight: 1.15
  }));
  const headerHtml = clipboardHtmlForRanges(headerRanges, "•");
  assert.equal((headerHtml.match(/data-typeset-role="contacts"/g) ?? []).length, 1);
  assert.match(
    headerHtml,
    /candidate@example\.com.*•.*New York, NY/,
    "external header HTML emits contacts on one logical line"
  );
  assert.equal(
    clipboardPlainTextForRanges(headerRanges, "•"),
    "Candidate Name\ncandidate@example.com • New York, NY"
  );
  assert.equal(
    clipboardPlainTextForRanges(
      [
        ...headerRanges,
        {
          src: {
            kind: "bullet",
            sectionId: "summary",
            entryId: "body",
            bulletId: "body"
          },
          map: second,
          dStart: 0,
          dEnd: second.chars.length,
          defaultFontFamily: "tinos",
          defaultFontSizePt: 10,
          defaultAlignment: "left",
          defaultLineHeight: 1.15
        }
      ],
      "•"
    ),
    "Candidate Name\ncandidate@example.com • New York, NY\n\nSecond logical paragraph.",
    "plain-text copy separates a complete header from body paragraphs"
  );

  const directPayload = encodeSelectionClipboard([{
    kind: "header",
    header: {
      visible: false,
      name: "<b>Candidate Name</b>",
      contact: ["candidate@example.com", "New York, NY"]
    }
  }]);
  assert.deepEqual(decodeSelectionClipboard(directPayload), [{
    kind: "header",
    header: {
      visible: false,
      name: "<b>Candidate Name</b>",
      contact: ["candidate@example.com", "New York, NY"]
    }
  }], "the private selection format restores exact header structure");
  assert.equal(
    decodeSelectionClipboard(JSON.stringify({
      ...JSON.parse(directPayload),
      ignored: true
    })),
    null,
    "the private selection format rejects undeclared top-level data"
  );
  assert.equal(
    decodeSelectionClipboard(encodeSelectionClipboard([
      { kind: "paragraph", value: "Body" },
      {
        kind: "header",
        header: { visible: true, name: "Candidate", contact: [] }
      }
    ])),
    null,
    "a private header block must be unique and first"
  );

  assert.deepEqual(
    clipboardBlocks(
      "",
      "Name\nPortfolio"
    ),
    ["Name", "Portfolio"],
    "plain-text structural fallback splits only nonempty authored lines"
  );
  assert.deepEqual(
    defaultDocumentPasteMapping(1),
    { nameIndex: null, bodyStart: 0 },
    "one block remains body-only"
  );
  assert.deepEqual(
    defaultDocumentPasteMapping(2),
    { nameIndex: 0, bodyStart: 1 },
    "two blocks cannot map the first block to both name and body"
  );
  assert.deepEqual(
    defaultDocumentPasteMapping(3),
    { nameIndex: 0, bodyStart: 2 },
    "three blocks default to name, contact, and body"
  );
}

{
  const target = buildDisplayMap("BeforeAfter", { preserveWhitespace: true });
  const replacement = replaceWithParagraphFragments(
    target,
    6,
    6,
    [
      "<space-before=8><b>First</b></space-before>",
      "<space-after=12><i>Second</i></space-after>"
    ]
  );
  assert.equal(replacement.values.length, 2);
  const first = buildDisplayMap(replacement.values[0], { preserveWhitespace: true });
  const second = buildDisplayMap(replacement.values[1], { preserveWhitespace: true });
  assert.equal(first.display, "BeforeFirst");
  assert.equal(second.display, "SecondAfter");
  assert(first.chars.slice(6).every((char) => char.bold));
  assert(second.chars.slice(0, 6).every((char) => char.italic));
  assert.equal(second.chars[0].spaceAfterPt, 12);
  assert.equal(replacement.lastCaretDisplayIndex, 6);

  const crossFieldReplacement = replaceWithParagraphFragments(
    buildDisplayMap("BeforeSelected", { preserveWhitespace: true }),
    6,
    "BeforeSelected".length,
    ["<b>First</b>", "<i>Second</i>"],
    {
      map: buildDisplayMap("SelectedAfter", { preserveWhitespace: true }),
      dEnd: "Selected".length
    }
  );
  assert.deepEqual(
    crossFieldReplacement.values.map(
      (value) => buildDisplayMap(value, { preserveWhitespace: true }).display
    ),
    ["BeforeFirst", "SecondAfter"],
    "one paragraph replacement preserves both boundary remainders across fields"
  );
}
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

const visualLinesMap = buildDisplayMap("First visual line Second visual line", {
  preserveWhitespace: true
});
const firstLineOnly = setLineHeightRanges(
  visualLinesMap,
  [{ dStart: 0, dEnd: 18 }],
  1.5
);
const firstLineOnlyMap = buildDisplayMap(firstLineOnly.value, { preserveWhitespace: true });
assert(firstLineOnlyMap.chars.slice(0, 18).every((char) => char.lineHeight === 1.5));
assert(firstLineOnlyMap.chars.slice(18).every((char) => char.lineHeight === null));

// A visual-line override must not flatten an existing paragraph-wide value.
// This mirrors selecting one wrapped middle line after setting the paragraph.
const inheritedLineHeight = setParagraphLineHeight(visualLinesMap, 1.2);
const middleLineOverride = setLineHeightRanges(
  buildDisplayMap(inheritedLineHeight.value, { preserveWhitespace: true }),
  [{ dStart: 6, dEnd: 17 }],
  2
);
const middleLineOverrideMap = buildDisplayMap(middleLineOverride.value, {
  preserveWhitespace: true
});
assert(middleLineOverrideMap.chars.slice(0, 6).every((char) => char.lineHeight === 1.2));
assert(middleLineOverrideMap.chars.slice(6, 17).every((char) => char.lineHeight === 2));
assert(middleLineOverrideMap.chars.slice(17).every((char) => char.lineHeight === 1.2));

// A hard break belongs to the line before it. Formatting that range must leave
// the following authored line alone, including its independent line height.
const hardBreakMap = buildDisplayMap("First line\nSecond line", {
  preserveWhitespace: true
});
const hardBreakBase = setParagraphLineHeight(hardBreakMap, 1.2);
const hardBreakOverride = setLineHeightRanges(
  buildDisplayMap(hardBreakBase.value, { preserveWhitespace: true }),
  [{ dStart: 0, dEnd: 11 }],
  1.5
);
const hardBreakOverrideMap = buildDisplayMap(hardBreakOverride.value, {
  preserveWhitespace: true
});
assert(hardBreakOverrideMap.chars.slice(0, 11).every((char) => char.lineHeight === 1.5));
assert(hardBreakOverrideMap.chars.slice(11).every((char) => char.lineHeight === 1.2));

const paragraphMap = buildDisplayMap("Paragraph text", { preserveWhitespace: true });
const spacedParagraph = setParagraphSpaceAfter(
  buildDisplayMap(
    setParagraphSpaceBefore(
      buildDisplayMap(setParagraphLineHeight(paragraphMap, 1.5).value, { preserveWhitespace: true }),
      8
    ).value,
    { preserveWhitespace: true }
  ),
  12
);
const spacedParagraphMap = buildDisplayMap(spacedParagraph.value, { preserveWhitespace: true });
assert.equal(spacedParagraphMap.chars[0].lineHeight, 1.5);
assert.equal(spacedParagraphMap.chars[0].spaceBeforePt, 8);
assert.equal(spacedParagraphMap.chars[0].spaceAfterPt, 12);
const editedParagraph = applyEdit(spacedParagraphMap, 9, 9, "new ");
const editedParagraphMap = buildDisplayMap(editedParagraph.value, { preserveWhitespace: true });
assert.equal(editedParagraphMap.chars[9].lineHeight, 1.5);
assert.equal(editedParagraphMap.chars[9].spaceBeforePt, 8);
assert.equal(editedParagraphMap.chars[9].spaceAfterPt, 12);

const emptyParagraph = setParagraphSpaceAfter(
  buildDisplayMap(
    setParagraphSpaceBefore(
      buildDisplayMap(
        setParagraphLineHeight(buildDisplayMap("", { preserveWhitespace: true }), 1.5).value,
        { preserveWhitespace: true }
      ),
      8
    ).value,
    { preserveWhitespace: true }
  ),
  12
);
assert.match(emptyParagraph.value, /<line-height=1\.5>/);
assert.match(emptyParagraph.value, /<space-before=8>/);
assert.match(emptyParagraph.value, /<space-after=12>/);
const typedEmptyParagraph = applyEdit(
  buildDisplayMap(emptyParagraph.value, { preserveWhitespace: true }),
  0,
  0,
  "Text"
);
const typedEmptyParagraphMap = buildDisplayMap(typedEmptyParagraph.value, {
  preserveWhitespace: true
});
assert(typedEmptyParagraphMap.chars.every((char) => char.lineHeight === 1.5));
assert(typedEmptyParagraphMap.chars.every((char) => char.spaceBeforePt === 8));

const defaultSpacedParagraph = buildDisplayMap(
  "<space-before=8>Paragraph</space-before>",
  { preserveWhitespace: true }
);
const defaultSpacedSplitAtEnd = splitValueAt(
  defaultSpacedParagraph,
  defaultSpacedParagraph.chars.length
);
assert.equal(
  paragraphSpacingFromInlineMarks(defaultSpacedSplitAtEnd.before).spaceBeforePt,
  8
);
assert.equal(
  paragraphSpacingFromInlineMarks(defaultSpacedSplitAtEnd.after).spaceBeforePt,
  8,
  "Enter at the end keeps the explicit default on the new empty paragraph"
);
const defaultSpacedSplitAtStart = splitValueAt(defaultSpacedParagraph, 0);
assert.equal(
  paragraphSpacingFromInlineMarks(defaultSpacedSplitAtStart.before).spaceBeforePt,
  8,
  "Enter at the start keeps the explicit default on the empty first paragraph"
);
assert.equal(
  paragraphSpacingFromInlineMarks(defaultSpacedSplitAtStart.after).spaceBeforePt,
  8
);

const fullyFormattedParagraph = buildDisplayMap(
  "<space-before=8><font=source-sans><size=14><b><i><u>Styled paragraph</u></i></b></size></font></space-before>",
  { preserveWhitespace: true }
);
const formattedSplit = splitValueAt(
  fullyFormattedParagraph,
  fullyFormattedParagraph.chars.length
);
const typedAfterFormattedSplit = applyEdit(
  buildDisplayMap(formattedSplit.after, { preserveWhitespace: true }),
  0,
  0,
  "Next"
);
const typedAfterFormattedSplitMap = buildDisplayMap(
  typedAfterFormattedSplit.value,
  { preserveWhitespace: true }
);
assert(
  typedAfterFormattedSplitMap.chars.every(
    (char) =>
      char.bold &&
      char.italic &&
      char.underline &&
      char.fontFamily === "source-sans" &&
      char.fontSizePt === 14 &&
      char.spaceBeforePt === 8
  ),
  "typing after Enter preserves the preceding paragraph's active formatting"
);

const linkedParagraph = buildDisplayMap(
  "<link=https%3A%2F%2Fexample.com>example.com</link>",
  { preserveWhitespace: true }
);
const linkedSplit = splitValueAt(linkedParagraph, linkedParagraph.chars.length);
const typedAfterLinkedSplit = applyEdit(
  buildDisplayMap(linkedSplit.after, { preserveWhitespace: true }),
  0,
  0,
  "Not linked"
);
assert(
  buildDisplayMap(typedAfterLinkedSplit.value, { preserveWhitespace: true })
    .chars.every((char) => char.linkHref === null),
  "Enter preserves typography without extending a hyperlink into the next paragraph"
);

const reformattedEmptyParagraph = setEmptyFieldTypingFormat(
  buildDisplayMap(formattedSplit.after, { preserveWhitespace: true }),
  {
    bold: false,
    italic: true,
    underline: false,
    fontFamily: "tinos",
    fontSizePt: 18,
    alignment: "right"
  }
);
const returnedEmptyParagraphMap = buildDisplayMap(
  reformattedEmptyParagraph.value,
  { preserveWhitespace: true }
);
assert.equal(returnedEmptyParagraphMap.chars.length, 0);
const typedAfterReturning = applyEdit(
  returnedEmptyParagraphMap,
  0,
  0,
  "Later"
);
const typedAfterReturningMap = buildDisplayMap(
  typedAfterReturning.value,
  { preserveWhitespace: true }
);
assert(
  typedAfterReturningMap.chars.every(
    (char) =>
      !char.bold &&
      char.italic &&
      !char.underline &&
      char.fontFamily === "tinos" &&
      char.fontSizePt === 18 &&
      char.alignment === "right" &&
      char.spaceBeforePt === 8
  ),
  "formatting an empty paragraph persists after the caret leaves and returns"
);
assert(typedEmptyParagraphMap.chars.every((char) => char.spaceAfterPt === 12));
const linkedEmptyParagraphMap = buildDisplayMap(
  replaceWithLink(
    buildDisplayMap(emptyParagraph.value, { preserveWhitespace: true }),
    0,
    0,
    "Portfolio",
    "https://example.com"
  ).value,
  { preserveWhitespace: true }
);
assert(linkedEmptyParagraphMap.chars.every((char) => char.lineHeight === 1.5));
assert(linkedEmptyParagraphMap.chars.every((char) => char.spaceBeforePt === 8));
assert(linkedEmptyParagraphMap.chars.every((char) => char.spaceAfterPt === 12));
const explicitlySpacedPasteMap = buildDisplayMap(
  applyInlineFragment(
    buildDisplayMap(emptyParagraph.value, { preserveWhitespace: true }),
    0,
    0,
    "<space-before=4><space-after=6>From Docs</space-after></space-before>"
  ).value,
  { preserveWhitespace: true }
);
assert(
  explicitlySpacedPasteMap.chars.every((char) => char.spaceBeforePt === 4),
  "explicit source paragraph spacing wins over an empty target's default"
);
assert(
  explicitlySpacedPasteMap.chars.every((char) => char.spaceAfterPt === 6)
);
const centeredEmptyParagraph = setAlignment(
  buildDisplayMap(emptyParagraph.value, { preserveWhitespace: true }),
  "center"
);
const centeredTypedMap = buildDisplayMap(
  applyEdit(
    buildDisplayMap(centeredEmptyParagraph.value, { preserveWhitespace: true }),
    0,
    0,
    "Centered"
  ).value,
  { preserveWhitespace: true }
);
assert(centeredTypedMap.chars.every((char) => char.alignment === "center"));

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
  lineEdgePosition,
  placeInLine
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

// A measured fallback keeps overlay-time point resolution away from offset zero.
const originalDocument = globalThis.document;
let measuredEnd = 0;
globalThis.document = {
  caretRangeFromPoint: () => null,
  createRange: () => ({
    setStart: () => {},
    setEnd: (_node, offset) => {
      measuredEnd = offset;
    },
    getClientRects: () => [{ right: 100 + measuredEnd * 10 }]
  })
};
const measuredTextNode = { nodeType: 3, textContent: "abcde" };
const measuredLine = Object.assign(new HTMLElement(), {
  querySelectorAll: () => [measuredSpan]
});
const measuredSpan = Object.assign(new HTMLElement(), {
  firstChild: measuredTextNode,
  hasAttribute: () => false,
  getBoundingClientRect: () => ({ left: 100, right: 150 }),
  closest: (selector) => selector === ".tsd-line" ? measuredLine : null
});
measuredTextNode.parentElement = measuredSpan;
assert.deepEqual(
  placeInLine(measuredLine, 126),
  { node: measuredTextNode, offset: 3 },
  "failed browser caret lookup falls back to the nearest measured character"
);
if (originalDocument === undefined) delete globalThis.document;
else globalThis.document = originalDocument;

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

// Restoring an empty trailing contact is a structural history change even
// though both the missing field and its value read as an empty string.
{
  const base = storedData();
  const after = {
    ...base,
    header: {
      ...base.header,
      contact: ["candidate@example.com", ""]
    }
  };
  const before = {
    ...base,
    header: {
      ...base.header,
      contact: ["candidate@example.com"]
    }
  };
  assert.deepEqual(
    historyCaretTarget(before, after),
    { key: "contact|1", valueIndex: 0 },
    "undo/redo restores the caret inside the contact after its divider"
  );
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

// 7. A pointer drag that starts at an automatic link's trailing edge must not
//    repaint that link between mousedown and mousemove. Replacing its <a> with a
//    <span> invalidates the browser's anchor node and collapses the drag.
{
  const map = dm("linkedin.com/in/xinyiklin");
  const collapsedAtEnd = {
    key: "contact|0",
    map,
    dStart: map.chars.length,
    dEnd: map.chars.length
  };
  assert.equal(
    autoLinkSuppressionForSelection(null, true, collapsedAtEnd),
    null,
    "pointer selection preserves the current paint at an automatic link edge"
  );

  const current = {
    key: "contact|0",
    dStart: 0,
    dEnd: map.chars.length
  };
  assert.deepEqual(
    autoLinkSuppressionForSelection(current, true, {
      ...collapsedAtEnd,
      dStart: 5
    }),
    current,
    "an existing suppression remains stable until the pointer gesture ends"
  );
  assert.deepEqual(
    autoLinkSuppressionForSelection(null, false, collapsedAtEnd),
    current,
    "a non-pointer caret still defers an automatic link while typing"
  );
  assert.equal(
    autoLinkSuppressionForSelection(current, false, {
      ...collapsedAtEnd,
      dStart: 5
    }),
    null,
    "the completed range restores normal link rendering"
  );
}

// Authored prose indentation behaves as one measured tab stop.
{
  const { indentDeletionRange } = await import("../inlineTextEditing.ts");
  const W = 8;

  // Backspace removes the authored stop without consuming a preceding typed space.
  assert.deepEqual(
    indentDeletionRange(`word ${" ".repeat(W)}text`, 5 + W, "backward", W),
    { start: 5, end: 5 + W },
    "Backspace removes the tab stop, leaving the space that preceded it"
  );

  // Backspace immediately after a Tab removes the whole tab stop.
  assert.deepEqual(
    indentDeletionRange(`${" ".repeat(W)}text`, W, "backward", W),
    { start: 0, end: W },
    "Backspace after Tab deletes the indentation, not one space"
  );
  // Forward delete from the start of an indented line removes it too.
  assert.deepEqual(
    indentDeletionRange(`${" ".repeat(W)}text`, 0, "forward", W),
    { start: 0, end: W },
    "Delete at the start of an indented line removes the whole indentation"
  );
  // Two Tabs are two stops: one Backspace takes back one of them.
  assert.deepEqual(
    indentDeletionRange(`${" ".repeat(W * 2)}text`, W * 2, "backward", W),
    { start: W, end: W * 2 },
    "one Backspace steps back exactly one tab stop"
  );
  // A ragged run still gives up exactly one stop, from the caret backwards.
  assert.deepEqual(
    indentDeletionRange(`${" ".repeat(W + 2)}text`, W + 2, "backward", W),
    { start: 2, end: W + 2 },
    "one stop comes off a ragged run, never the remainder first"
  );
  // Ordinary typed spaces stay ordinary: a run shorter than a stop is not a Tab.
  for (const count of [0, 1, 2, W - 1]) {
    assert.equal(
      indentDeletionRange(`${" ".repeat(count)}x`, count, "backward", W),
      null,
      `${count} spaces must delete one character at a time`
    );
  }
  // The caret at the very start of a field has nothing behind it — that keystroke
  // belongs to the paragraph-merge path.
  assert.equal(indentDeletionRange(`${" ".repeat(W)}text`, 0, "backward", W), null);
  // Deleting forward mid-word is untouched.
  assert.equal(indentDeletionRange("word here", 4, "forward", W), null);

}

// Paragraph indentation moves the whole block and survives value round trips.
{
  const { paragraphIndentOf, setParagraphIndent } = await import("../inlineTextEditing.ts");
  const plain = dm("A paragraph.");
  assert.equal(paragraphIndentOf(plain), 0, "a fresh paragraph has no indent");

  const indented = setParagraphIndent(plain, 36).value;
  assert.equal(indented, "<indent=36>A paragraph.</indent>");
  const indentedMap = dm(indented);
  assert.equal(indentedMap.display, "A paragraph.", "the tag never reaches the painted text");
  assert.equal(paragraphIndentOf(indentedMap), 36);

  // A second stop stacks on the first.
  const twice = dm(setParagraphIndent(indentedMap, 72).value);
  assert.equal(paragraphIndentOf(twice), 72);

  // Zero removes the wrapper so equivalent unindented values serialize identically.
  assert.equal(setParagraphIndent(twice, 0).value, "A paragraph.");

  // Block indentation preserves the first-line rung encoded in text.
  const bothRungs = dm(setParagraphIndent(dm("        A paragraph."), 36).value);
  assert.equal(bothRungs.display, "        A paragraph.");
  assert.equal(paragraphIndentOf(bothRungs), 36);

  // Editing must not split the paragraph-wide indent wrapper.
  const typed = applyEdit(bothRungs, 10, 10, "Z").value;
  assert.equal(
    (typed.match(/<indent=/g) ?? []).length,
    1,
    "typing inside an indented paragraph must not split its wrapper"
  );
  assert.equal(paragraphIndentOf(dm(typed)), 36);

  // Bounded like every other paragraph value, and zero is the floor coming down.
  assert.equal(paragraphIndentOf(dm(setParagraphIndent(plain, -20).value)), 0);
  assert.equal(paragraphIndentOf(dm(setParagraphIndent(plain, 9999).value)), 216);
}

// The shared indent ladder reverses each Tab rung with Shift+Tab.
{
  const { TAB_STOP_PT, indentStep, paragraphIndentOf } = await import("../inlineTextEditing.ts");
  const UNIT = " ".repeat(8);
  const TEXT = "A paragraph that wraps.";
  const press = (map, dStart, dEnd, direction) => {
    const step = indentStep(map, dStart, dEnd, UNIT, direction);
    return step ? dm(step.value) : null;
  };
  const caretPress = (map, direction) => press(map, 0, 0, direction);

  // A caret climbs: first line, then block, then block again.
  const rung1 = caretPress(dm(TEXT), "in");
  assert.equal(rung1.display, `${UNIT}${TEXT}`, "a caret indents the first line first");
  assert.equal(paragraphIndentOf(rung1), 0);
  const rung2 = caretPress(rung1, "in");
  assert.equal(rung2.display, `${UNIT}${TEXT}`, "the second press moves the block, not the text");
  assert.equal(paragraphIndentOf(rung2), TAB_STOP_PT);
  assert.equal(paragraphIndentOf(caretPress(rung2, "in")), TAB_STOP_PT * 2);

  // Selecting the WHOLE paragraph indents the whole paragraph immediately —
  // every line moves, and no first-line spaces are written.
  const whole = press(dm(TEXT), 0, TEXT.length, "in");
  assert.equal(whole.display, TEXT, "a full-paragraph selection writes no leading spaces");
  assert.equal(paragraphIndentOf(whole), TAB_STOP_PT, "it moves the block instead");

  // A partial selection reaching the first character still takes rung one.
  const partial = press(dm(TEXT), 0, 5, "in");
  assert.equal(partial.display, `${UNIT}${TEXT}`);
  assert.equal(paragraphIndentOf(partial), 0);

  // A selection starting at the first GLYPH of an already-indented paragraph
  // counts as covering it: the indentation is not part of the text.
  const fromFirstGlyph = press(rung1, UNIT.length, UNIT.length + TEXT.length, "in");
  assert.equal(paragraphIndentOf(fromFirstGlyph), TAB_STOP_PT);

  // Shift+Tab unwinds in the reverse order: block first, then the first line.
  const down1 = caretPress(rung2, "out");
  assert.equal(paragraphIndentOf(down1), 0, "the block indent comes off first");
  assert.equal(down1.display, `${UNIT}${TEXT}`, "and the first line keeps its spaces");
  const down2 = caretPress(down1, "out");
  assert.equal(down2.display, TEXT, "then the first line's indent comes off");
  assert.equal(paragraphIndentOf(down2), 0);
  assert.equal(caretPress(down2, "out"), null, "a flush paragraph has nothing left to give");

  // Shift+Tab on a fully selected paragraph pulls its block indent back too.
  assert.equal(paragraphIndentOf(press(whole, 0, TEXT.length, "out")), 0);

  // Only the text-backed first-line rung shifts selection offsets.
  assert.equal(indentStep(dm(TEXT), 0, 0, UNIT, "in").shift, UNIT.length);
  assert.equal(indentStep(dm(TEXT), 0, TEXT.length, UNIT, "in").shift, 0);
  assert.equal(indentStep(rung1, 0, 0, UNIT, "out").shift, -UNIT.length);
}

// Selection shading covers engine-owned line leading and authored paragraph spacing.
{
  const { selectionBandBottomOffset, selectionBandTopOffset } = await import("../selectionHighlight.ts");
  // A 12pt ink box that owns 20pt of line spacing.
  const line = { top: 100, bottom: 112, leading: 20, spaceAfter: 6 };
  const nextLine = (top) => ({ top, selected: true, samePage: true });

  assert.equal(selectionBandTopOffset(8), -8, "authored space before extends above the first line");
  assert.equal(selectionBandTopOffset(null), 0);
  assert.equal(
    selectionBandBottomOffset(line, nextLine(120)),
    8,
    "a selected next line caps the band so translucent highlights tile"
  );
  assert.equal(
    selectionBandBottomOffset(line, null),
    14,
    "the last selected paragraph paints its authored after-space"
  );
  assert.equal(
    selectionBandBottomOffset(line, { top: 140, selected: false, samePage: true }),
    14,
    "an unselected neighbour does not shrink paragraph spacing this line owns"
  );
  assert.equal(
    selectionBandBottomOffset(line, nextLine(160)),
    48,
    "selected paragraphs paint continuously through their complete junction"
  );

  // Overlapping selected lines tile instead of double-painting translucent bands.
  assert.equal(
    selectionBandBottomOffset(line, nextLine(108)),
    -4,
    "a band stops where the next selected line starts, even going backwards"
  );
  assert.equal(
    selectionBandBottomOffset(line, { top: 108, selected: false, samePage: true }),
    -4,
    "an unselected neighbour still bounds the highlight away from its ink"
  );
  assert.equal(
    selectionBandBottomOffset(line, { top: 900, selected: true, samePage: false }),
    8,
    "a selection never bridges a page break"
  );

  // Structural rows without owned leading still join the next selected row.
  const structural = { top: 100, bottom: 112, leading: null, spaceAfter: null };
  assert.equal(selectionBandBottomOffset(structural, nextLine(130)), 18);
  assert.equal(selectionBandBottomOffset(structural, nextLine(106)), -6, "and still tiles");
}

// A caret past the final display character restores at the value's end.
{
  const { valueIndexForDisplayIndex } = await import("../inlineTextEditing.ts");
  const value = "<b>abc</b>";
  const map = dm(value);
  assert.equal(map.display, "abc");

  assert.equal(valueIndexForDisplayIndex(map, value, 0), map.valueStart[0]);
  assert.equal(valueIndexForDisplayIndex(map, value, 2), map.valueStart[2]);
  // The end of the field: past every character, so the end of the value.
  assert.equal(
    valueIndexForDisplayIndex(map, value, 3),
    value.length,
    "a caret at the field end resolves to the end of the value, never to 0"
  );
  // Out of range in either direction clamps rather than wrapping.
  assert.equal(valueIndexForDisplayIndex(map, value, 99), value.length);
  assert.equal(valueIndexForDisplayIndex(map, value, -5), map.valueStart[0]);
  // Both restored endpoints agree, preserving a collapsed caret.
  assert.equal(
    valueIndexForDisplayIndex(map, value, 3),
    valueIndexForDisplayIndex(map, value, 3)
  );
  const empty = dm("");
  assert.equal(valueIndexForDisplayIndex(empty, "", 0), 0);
}

// Separator-hosted carets resolve to the preceding field's painted end.
{
  const { fieldCaretOf } = await import("../domSelection.ts");
  const KEY = "bullet|letter|p1|b1";
  const build = (runs) => {
    const children = [];
    const line = Object.assign(new HTMLElement(), {
      className: "tsd-line",
      childNodes: children,
      querySelectorAll: () => children.filter((child) => child.getAttribute?.("data-tsdf")),
      closest: (selector) => (selector === ".tsd-line" ? line : null)
    });
    for (const run of runs) {
      const textNode = { nodeType: 3, textContent: run.text };
      const span = Object.assign(new HTMLElement(), {
        firstChild: textNode,
        hasAttribute: (name) => name === "data-tsde" && Boolean(run.empty),
        getAttribute: (name) => (name === "data-tsdf" ? (run.separator ? null : KEY) : null),
        closest: (selector) =>
          selector === ".tsd-line" ? line : selector.includes("data-tsdf") && !run.separator ? span : null
      });
      textNode.parentElement = span;
      children.push(span);
    }
    return { line, spans: children, host: { contains: () => true } };
  };

  // "abc" then the separator the painter appends at every line end.
  const painted = build([{ text: "abc" }, { text: " ", separator: true }]);
  const [textSpan, separator] = painted.spans;

  assert.deepEqual(
    fieldCaretOf(painted.host, separator.firstChild, 0),
    { key: KEY, node: textSpan.firstChild, offset: 3 },
    "a caret in the line separator belongs to the end of the text before it"
  );
  assert.deepEqual(
    fieldCaretOf(painted.host, painted.line, painted.spans.length),
    { key: KEY, node: textSpan.firstChild, offset: 3 },
    "so does a caret at the end of the line container"
  );
  assert.deepEqual(
    fieldCaretOf(painted.host, painted.line, 0),
    { key: KEY, node: textSpan.firstChild, offset: 0 },
    "and a caret before every span belongs to the line's start"
  );
  // An endpoint that DOES name a field is returned untouched.
  assert.deepEqual(
    fieldCaretOf(painted.host, textSpan.firstChild, 2),
    { key: KEY, node: textSpan.firstChild, offset: 2 },
    "an endpoint inside field text is left exactly where it is"
  );
  // Authored trailing spaces are content: the caret belongs AFTER them.
  const trailing = build([{ text: "abc   " }, { text: " ", separator: true }]);
  assert.equal(fieldCaretOf(trailing.host, trailing.spans[1].firstChild, 0).offset, 6);
  // A blank line's placeholder span carries no text position but still a field.
  const blank = build([{ text: "\u200b", empty: true }, { text: "\n", separator: true }]);
  assert.deepEqual(fieldCaretOf(blank.host, blank.spans[1].firstChild, 0), {
    key: KEY,
    node: blank.spans[0].firstChild,
    offset: 0
  });
}

// Fieldless drag endpoints resolve against the covered field's painted spans.
{
  const { readFieldRanges } = await import("../multiFieldSelection.ts");
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  // Numeric document order lets the fake range answer comparePoint deterministically.
  let order = 0;
  const step = () => (order += 100);
  const positionOf = (node, offset) =>
    node.nodeType === 3
      ? node.start + offset
      : offset === 0
        ? node.start + 1
        : node.end - 1;

  const orderedHost = (lines) => {
    const spans = [];
    const lineElements = [];
    for (const runs of lines) {
      const lineElement = Object.assign(new HTMLElement(), {
        className: "tsd-line",
        start: step(),
        children: [],
        childNodes: [],
        closest: (selector) => (selector === ".tsd-line" ? lineElement : null)
      });
      for (const run of runs) {
        const spanStart = step();
        const textNode = { nodeType: 3, textContent: run.text, start: step() };
        textNode.end = textNode.start + run.text.length;
        const span = Object.assign(new HTMLElement(), {
          start: spanStart,
          firstChild: textNode,
          childNodes: [textNode],
          hasAttribute: () => false,
          getAttribute: (name) => (name === "data-tsdf" ? run.key : null),
          closest: (selector) =>
            selector === ".tsd-line" ? lineElement : selector.includes("data-tsdf") ? span : null
        });
        span.end = step();
        textNode.parentElement = span;
        lineElement.children.push(span);
        lineElement.childNodes.push(span);
        spans.push(span);
      }
      lineElement.end = step();
      lineElements.push(lineElement);
    }
    return {
      lines: lineElements,
      host: {
        contains: () => true,
        querySelectorAll: (selector) => {
          const match = /data-tsdf="([^"]+)"/.exec(selector);
          return spans.filter((span) => !match || span.getAttribute("data-tsdf") === match[1]);
        },
        querySelector: (selector) => {
          const match = /data-tsdf="([^"]+)"/.exec(selector);
          return spans.find((span) => !match || span.getAttribute("data-tsdf") === match[1]) ?? null;
        }
      }
    };
  };

  const selectBetween = (startContainer, startOffset, endContainer, endOffset) => {
    const live = {
      startContainer,
      startOffset,
      endContainer,
      endOffset,
      setStart(node, offset) {
        this.startContainer = node;
        this.startOffset = offset;
      },
      setEnd(node, offset) {
        this.endContainer = node;
        this.endOffset = offset;
      },
      collapse() {
        this.endContainer = this.startContainer;
        this.endOffset = this.startOffset;
      },
      comparePoint(node, offset) {
        const point = positionOf(this.startContainer, this.startOffset);
        const other = positionOf(node, offset);
        return other < point ? -1 : other > point ? 1 : 0;
      },
      intersectsNode: () => true
    };
    globalThis.document = { createRange: () => ({ ...live }) };
    globalThis.window = {
      getSelection: () => ({
        rangeCount: 1,
        isCollapsed: false,
        getRangeAt: () => ({ ...live })
      })
    };
  };

  const KEY_A = "bullet|letter|p1|b1";
  const wrappedField = orderedHost([
    [{ key: KEY_A, text: "abc" }],
    [{ key: KEY_A, text: "def" }]
  ]);
  const resolve = () => {
    const value = "abc def";
    return { map: buildDisplayMap(value, { preserveWhitespace: true }), value };
  };

  // Selecting the FIRST painted line, both endpoints on the line container.
  selectBetween(wrappedField.lines[0], 0, wrappedField.lines[0], 1);
  const firstLine = readFieldRanges(wrappedField.host, resolve);
  assert.equal(firstLine?.length, 1, "one field is covered");
  assert.deepEqual(
    { dStart: firstLine[0].dStart, dEnd: firstLine[0].dEnd },
    { dStart: 0, dEnd: 3 },
    "selecting the first line covers that line, not the whole paragraph"
  );

  // Selecting the SECOND painted line. This is the one that used to resolve to
  // no field at all (toolbar disabled) and, once resolved, to the whole field.
  selectBetween(wrappedField.lines[1], 0, wrappedField.lines[1], 1);
  const secondLine = readFieldRanges(wrappedField.host, resolve);
  assert.equal(secondLine?.length, 1, "a continuation line still resolves its field");
  assert.deepEqual(
    { dStart: secondLine[0].dStart, dEnd: secondLine[0].dEnd },
    { dStart: 4, dEnd: 7 },
    "selecting a continuation line covers that line only"
  );

  // A select-all style range over the whole host still covers everything.
  selectBetween(wrappedField.lines[0], 0, wrappedField.lines[1], 1);
  const everything = readFieldRanges(wrappedField.host, resolve);
  assert.deepEqual(
    { dStart: everything[0].dStart, dEnd: everything[0].dEnd },
    { dStart: 0, dEnd: 7 },
    "a range across every line still covers the whole field"
  );

  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}

const inputEventsSource = readFileSync(new URL("../useTypesetInputEvents.ts", import.meta.url), "utf8");
const editorCss = readFileSync(new URL("../../../styles/resume-document.css", import.meta.url), "utf8");
assert.match(
  inputEventsSource,
  /onCompositionStart[\s\S]{0,240}?classList\.add\("is-composing"\)/,
  "composition exposes the browser-managed caret state"
);
assert.match(
  inputEventsSource,
  /onCompositionEnd[\s\S]{0,240}?classList\.remove\("is-composing"\)/,
  "composition restores overlay-only caret ownership when it ends"
);
assert.match(
  editorCss,
  /\.tsd-doc--editable\.is-composing\s*\{[^}]*caret-color:\s*#000/,
  "the native caret is visible while the browser owns IME composition"
);
assert.match(
  editorCss,
  /\.tsd-doc--editable\.is-composing\s*~\s*\.typeset-caret\s*\{[^}]*visibility:\s*hidden/,
  "the stale overlay caret is hidden during IME composition"
);

console.log(
  `typeset editing: whitespace, rich clipboard, bounded typography, indentation stops, drag hit-area, selection-boundary resolution, ${FONT_FAMILY_OPTIONS.length}-family tag round-trip, and hyperlink-editing checks passed`
);
