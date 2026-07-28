import assert from "node:assert/strict";

import {
  COVER_LETTER_FILE_MAGIC,
  COVER_LETTER_STYLE_DEFAULTS,
  CoverLetterFileError,
  coverLetterPlainText,
  parseCoverLetterFile,
  parseCoverLetterText,
  serializeCoverLetterFile
} from "../coverLetter.ts";
import { toTypesetSchema } from "../../typeset/schema.ts";
import { layoutCoverLetter, lineSeparators } from "../../typeset/layout.ts";
import { inkExtent, measure, paragraphItems, underlineRule, underlineSpans } from "../../typeset/measure.ts";
import { breakParagraph } from "../../typeset/linebreak.ts";
import {
  coverLetterStyleToDocumentStyle,
  documentStyleToCoverLetterStyle
} from "../coverLetter.ts";
import { FONT_FAMILY_OPTIONS } from "../documentStyle.ts";
import { pageMarginValuesFor, pageMarginsForValues } from "../pageMargins.ts";

assert.deepEqual(pageMarginValuesFor("narrow"), { top: 36, right: 36, bottom: 36, left: 36 });
assert.deepEqual(pageMarginValuesFor("normal"), { top: 72, right: 72, bottom: 72, left: 72 });
assert.equal(pageMarginsForValues({ top: 36, right: 36, bottom: 36, left: 36 }), "narrow");
assert.equal(pageMarginsForValues({ top: 72, right: 72, bottom: 72, left: 72 }), "normal");
assert.equal(pageMarginsForValues({ top: 54, right: 72, bottom: 54, left: 72 }), "custom");
assert.equal(coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS).pageMargins, "custom");
assert.deepEqual(
  {
    lineHeight: COVER_LETTER_STYLE_DEFAULTS.lineHeight,
    paragraphGapPt: COVER_LETTER_STYLE_DEFAULTS.paragraphGapPt,
    margins: [
      COVER_LETTER_STYLE_DEFAULTS.marginTopPt,
      COVER_LETTER_STYLE_DEFAULTS.marginRightPt,
      COVER_LETTER_STYLE_DEFAULTS.marginBottomPt,
      COVER_LETTER_STYLE_DEFAULTS.marginLeftPt
    ]
  },
  { lineHeight: 2, paragraphGapPt: 8, margins: [36, 54, 36, 54] },
  "new cover letters default to double spacing, 8pt paragraph gaps, and 0.5/0.75-inch margins"
);
assert.deepEqual(
  documentStyleToCoverLetterStyle({
    ...coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS),
    pageMargins: "narrow",
    pageMarginTopPt: 36,
    pageMarginRightPt: 36,
    pageMarginBottomPt: 36,
    pageMarginLeftPt: 36
  }),
  {
    ...COVER_LETTER_STYLE_DEFAULTS,
    marginTopPt: 36,
    marginRightPt: 36,
    marginBottomPt: 36,
    marginLeftPt: 36
  },
  "cover-letter saves persist physical margins rather than preset identity"
);

const source = [
  "July 24, 2026",
  "Dear Hiring Manager,",
  "I build dependable local-first tools and care about clear, honest product writing.",
  "In my current work, I translate ambiguous workflows into focused interfaces without inventing evidence.",
  "Sincerely,\nCandidate Name"
].join("\n\n");

const data = parseCoverLetterText(source);
assert.equal(coverLetterPlainText(data), source);

const indentedParagraphData = structuredClone(data);
indentedParagraphData.sections[0].items[0].bullets[0].text = "    Indented paragraph.";
const indentedParagraphSchema = toTypesetSchema(indentedParagraphData);
assert.equal(
  indentedParagraphSchema.sections[0].items[0].bullets[0],
  "    Indented paragraph.",
  "summary and cover-letter paragraphs preserve authored leading indentation"
);
const ordinaryBulletData = structuredClone(indentedParagraphData);
ordinaryBulletData.sections[0].type = "standard";
assert.equal(
  toTypesetSchema(ordinaryBulletData).sections[0].items[0].bullets[0],
  "Indented paragraph.",
  "ordinary resume bullets still trim accidental space after their marker"
);

const serialized = serializeCoverLetterFile(data, COVER_LETTER_STYLE_DEFAULTS);
const raw = JSON.parse(serialized);
assert.equal(raw.format, COVER_LETTER_FILE_MAGIC);
assert.equal(raw.schemaVersion, 2);
assert.equal(raw.document.header, null);
assert.equal(JSON.stringify(raw).includes('"id"'), false, "session ids never cross the .cover boundary");

const parsed = parseCoverLetterFile(serialized);
assert.equal(coverLetterPlainText(parsed.data), source);
assert.deepEqual(parsed.style, COVER_LETTER_STYLE_DEFAULTS);

const withHeader = {
  ...data,
  name: "Candidate Name",
  contact: ["candidate@example.com", "Portfolio"]
};
const headerRoundTrip = parseCoverLetterFile(
  serializeCoverLetterFile(withHeader, { ...COVER_LETTER_STYLE_DEFAULTS, contactDivider: "•" })
);
assert.equal(headerRoundTrip.data.name, "Candidate Name");
assert.deepEqual(headerRoundTrip.data.contact, ["candidate@example.com", "Portfolio"]);
assert.equal(headerRoundTrip.style.contactDivider, "•");
const headerLayout = layoutCoverLetter(
  toTypesetSchema(headerRoundTrip.data),
  coverLetterStyleToDocumentStyle(headerRoundTrip.style)
);
assert(headerLayout.pages[0].lines.some((line) => line.runs.some((run) => run.src?.kind === "name")));
assert(headerLayout.pages[0].lines.some((line) => line.runs.some((run) => run.src?.kind === "contact")));
assert(
  headerLayout.pages[0].lines.every((line) =>
    line.runs.every((run) =>
      run.x + run.width <=
        headerLayout.geometry.marginLeft + headerLayout.geometry.textWidth + 0.01
    )
  ),
  "header contact items stay inside the text column"
);

const legacy = {
  format: COVER_LETTER_FILE_MAGIC,
  schemaVersion: 1,
  document: { paragraphs: ["Legacy letter."] },
  style: Object.fromEntries(
    Object.entries(COVER_LETTER_STYLE_DEFAULTS).filter(([key]) => key !== "contactDivider")
  )
};
const migratedLegacy = parseCoverLetterFile(JSON.stringify(legacy));
assert.equal(migratedLegacy.data.name, "");
assert.equal(migratedLegacy.style.contactDivider, "|");

const layout = layoutCoverLetter(
  toTypesetSchema(parsed.data),
  coverLetterStyleToDocumentStyle(parsed.style)
);
assert.equal(layout.pages.length, 1);
assert(layout.pages[0].lines.length >= 5, "cover-letter paragraphs reach the shared layout engine");

const compactCoverStyle = { ...COVER_LETTER_STYLE_DEFAULTS, lineHeight: 1.15 };
const doubleSpaced = parseCoverLetterFile(
  serializeCoverLetterFile(
    parseCoverLetterText(
      "<line-height=2>This selected paragraph is intentionally long enough to wrap onto a second line so its physical baseline spacing can be measured directly by the deterministic layout engine without relying on the following paragraph gap.</line-height>\n\nNormal paragraph."
    ),
    compactCoverStyle
  )
);
assert.equal(doubleSpaced.style.lineHeight, compactCoverStyle.lineHeight);
const doubleSpacedLayout = layoutCoverLetter(
  toTypesetSchema(doubleSpaced.data),
  coverLetterStyleToDocumentStyle(doubleSpaced.style)
);
assert(
  doubleSpacedLayout.pages[0].lines[1].baseline - doubleSpacedLayout.pages[0].lines[0].baseline
    > compactCoverStyle.fontSizePt * compactCoverStyle.lineHeight,
  "whole-paragraph line spacing affects every wrapped line without changing the document default"
);

const selectedLineData = parseCoverLetterText(
  "<line-height=2>Selected line</line-height>\nDefault middle line\nDefault final line"
);
const selectedLineLayout = layoutCoverLetter(
  toTypesetSchema(selectedLineData),
  coverLetterStyleToDocumentStyle(compactCoverStyle)
);
const selectedLineBaselines = selectedLineLayout.pages[0].lines.map((line) => line.baseline);
assert(
  selectedLineBaselines[1] - selectedLineBaselines[0]
    > selectedLineBaselines[2] - selectedLineBaselines[1],
  "a visual-line override adds space below the selected line"
);

const selectedMiddleLineData = parseCoverLetterText(
  "Default first line\n<line-height=2>Selected middle line</line-height>\nDefault final line"
);
const selectedMiddleLineLayout = layoutCoverLetter(
  toTypesetSchema(selectedMiddleLineData),
  coverLetterStyleToDocumentStyle(compactCoverStyle)
);
const selectedMiddleBaselines = selectedMiddleLineLayout.pages[0].lines.map((line) => line.baseline);
assert(
  selectedMiddleBaselines[1] - selectedMiddleBaselines[0]
    < selectedMiddleBaselines[2] - selectedMiddleBaselines[1],
  "a selected middle line keeps the gap above unchanged and adds its spacing only below"
);

const emptyLineGap = (lineHeight) => {
  const emptyLineLayout = layoutCoverLetter(
    toTypesetSchema(
      parseCoverLetterText(`<line-height=${lineHeight}></line-height>\n\nFollowing paragraph`)
    ),
    coverLetterStyleToDocumentStyle(compactCoverStyle)
  );
  const baselines = emptyLineLayout.pages[0].lines.map((line) => line.baseline);
  return baselines[1] - baselines[0];
};
assert(
  emptyLineGap(2) > emptyLineGap(1),
  "line spacing on an empty paragraph adds space below its blank line"
);

const mixedData = parseCoverLetterText(
  [
    "Normal",
    "<size=36><font=latin-modern>A</font><font=source-sans>B</font><font=source-serif>C</font></size>",
    "Normal"
  ].join("\n")
);
const mixedLayout = layoutCoverLetter(
  toTypesetSchema(mixedData),
  coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS)
);
const mixedLines = mixedLayout.pages[0].lines;
assert.equal(mixedLines.length, 3);
assert.deepEqual(
  [...new Set(mixedLines[1].runs.map((run) => run.style.family))],
  ["latin-modern", "source-sans", "source-serif"],
  "different font families remain independent runs on one line"
);
const lineInk = (line) =>
  line.runs.reduce(
    (ink, run) => {
      const extent = inkExtent(run.text, run.style);
      return {
        height: Math.max(ink.height, extent.height),
        depth: Math.max(ink.depth, extent.depth)
      };
    },
    { height: 0, depth: 0 }
  );
for (let index = 1; index < mixedLines.length; index += 1) {
  const previousInk = lineInk(mixedLines[index - 1]);
  const currentInk = lineInk(mixedLines[index]);
  const previousBottom = mixedLines[index - 1].baseline + previousInk.depth;
  const currentTop = mixedLines[index].baseline - currentInk.height;
  assert(
    currentTop >= previousBottom - 0.01,
    "oversized inline runs expand the baseline junction instead of colliding"
  );
}

// Glyph choice must not move baselines when family and size stay constant.
const baselinesFor = (paragraphs) =>
  layoutCoverLetter(
    toTypesetSchema(parseCoverLetterText(paragraphs.join("\n"))),
    coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS)
  ).pages.flatMap((page, index) => page.lines.map((line) => [index, line.baseline]));

for (const [label, variants] of Object.entries({
  "an oversized inline run": [
    ["aaaaa<size=48>aaaaaa</size> ccc", "tail"],
    ["aaaaa<size=48>aaaaaa b ccc</size>", "tail"],
    ["aaaaa<size=48>gpqjy Å( ccc</size>", "tail"]
  ],
  "ordinary body prose": [["ana ana ana", "one two"], ["ÅQg jbl Åpy", "two one"]],
  "a blank paragraph": [["", "aaa"], ["", "Åjg"]]
})) {
  const [reference, ...rest] = variants.map(baselinesFor);
  for (const variant of rest) {
    assert.deepEqual(
      variant,
      reference,
      `${label}: glyph choice must not change any baseline`
    );
  }
}

// Overflow expansion still clears representative tall and deep glyphs.
for (const size of [12, 36, 48, 120, 200]) {
  const probeLines = layoutCoverLetter(
    toTypesetSchema(
      parseCoverLetterText(
        ["Åjgpqy", `Åjgpqy<size=${size}>Å(jgpqy</size>Åjgpqy`, "Åjgpqy"].join("\n")
      )
    ),
    coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS)
  ).pages.flatMap((page) => page.lines);
  for (let index = 1; index < probeLines.length; index += 1) {
    const previous = probeLines[index - 1];
    const current = probeLines[index];
    assert(
      current.baseline - lineInk(current).height >=
        previous.baseline + lineInk(previous).depth - 0.01,
      `size ${size}: an oversized inline run must not collide with its neighbour`
    );
  }
}

// Underline spans merge word boxes so editor and PDF paint one continuous rule.
const underlinedLine = layoutCoverLetter(
  toTypesetSchema(parseCoverLetterText("See <u>ab pq words</u> then plain text.")),
  coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS)
).pages[0].lines[0];
const underlinedRuns = underlinedLine.runs.filter((run) => run.underline);
assert.equal(underlinedRuns.length, 3, "the underlined phrase reaches layout as one run per word");
const spans = underlineSpans(underlinedLine.runs);
assert.equal(spans.length, 1, "an underlined phrase draws ONE rule, not one per word");
assert.equal(spans[0].x, underlinedRuns[0].x);
assert.equal(
  spans[0].x + spans[0].width,
  underlinedRuns[2].x + underlinedRuns[2].width,
  "the rule spans the phrase's interior spaces"
);
assert.equal(
  new Set(underlinedRuns.map((run) => underlineRule(run.style).offset.toFixed(4))).size,
  1,
  "rule depth depends on the face and size, never on the glyphs in the run"
);
assert(
  underlineRule(spans[0].style).offset > inkExtent("gjpqy", spans[0].style).depth,
  "the rule still clears the face's descender reach"
);
assert.equal(
  underlineSpans(
    layoutCoverLetter(
      toTypesetSchema(parseCoverLetterText("plain <u>one</u> plain <u>two</u> plain")),
      coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS)
    ).pages[0].lines[0].runs
  ).length,
  2,
  "separate underlined words stay separate rules"
);

// Line separators: what a break stands for once the painted lines carry no
// character for the glue the breaker consumed.
const separatorsFor = (paragraphs) =>
  lineSeparators(
    layoutCoverLetter(
      toTypesetSchema(parseCoverLetterText(paragraphs.join("\n"))),
      coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS)
    ).pages
  );
// Assert separator shape because wrap count varies with the default family's advances.
const softWrapped = separatorsFor([
  "The quick brown fox jumps over the lazy dog and keeps running well past the right margin so it wraps, " +
    "and then keeps going for a second line so the break exists whatever face the default style names."
]);
assert.equal(softWrapped.length, 1, "one paragraph paints one page");
assert(softWrapped[0].length > 1, "the fixture is long enough to wrap in the default family");
assert.deepEqual(
  softWrapped[0],
  [...softWrapped[0].slice(0, -1).map(() => " "), ""],
  "a soft wrap inside one paragraph stands for a space; the last line has no separator"
);
assert.deepEqual(
  separatorsFor(["First paragraph.", "", "Second paragraph."]),
  [["\n", ""]],
  "crossing into another paragraph stands for a newline"
);
assert.deepEqual(
  separatorsFor(["Held\nover two authored lines."]),
  [[" ", ""]],
  "an authored break inside one field reads as a space; the model keeps the real newline"
);

const unbrokenData = parseCoverLetterText("A".repeat(240));
const unbrokenLayout = layoutCoverLetter(
  toTypesetSchema(unbrokenData),
  coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS)
);
const unbrokenLines = unbrokenLayout.pages.flatMap((page) => page.lines);
assert(unbrokenLines.length > 1, "an oversized unbroken token wraps across lines");
assert.equal(
  unbrokenLines.flatMap((line) => line.runs).map((run) => run.text).join(""),
  "A".repeat(240),
  "emergency character wrapping preserves every character"
);
assert(
  unbrokenLines.every((line) =>
    line.runs.every(
      (run) =>
        run.x + run.width <=
        unbrokenLayout.geometry.marginLeft + unbrokenLayout.geometry.textWidth + 0.01
    )
  ),
  "character-wrapped runs remain inside the text column"
);

const boundaryTokenText = `${"A".repeat(70)}${"Z".repeat(50)}${"A".repeat(70)}`;
const boundaryTokenData = parseCoverLetterText(
  `<font=latin-modern>${"A".repeat(70)}</font>` +
    `<font=source-sans>${"Z".repeat(50)}</font>` +
    `<font=source-serif>${"A".repeat(70)}</font>`
);
const boundaryTokenLayout = layoutCoverLetter(
  toTypesetSchema(boundaryTokenData),
  coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS)
);
const boundaryTokenLines = boundaryTokenLayout.pages.flatMap((page) => page.lines);
assert.equal(
  boundaryTokenLines.flatMap((line) => line.runs).map((run) => run.text).join(""),
  boundaryTokenText,
  "character wrapping preserves a continuous token across formatting boundaries"
);
assert(
  boundaryTokenLines.some(
    (line) => new Set(line.runs.map((run) => run.style.family)).size > 1
  ),
  "an inline formatting boundary does not force a new line"
);
for (const line of boundaryTokenLines.slice(0, -1)) {
  const usedWidth =
    Math.max(...line.runs.map((run) => run.x + run.width)) -
    boundaryTokenLayout.geometry.marginLeft;
  const widestGlyph = Math.max(
    ...line.runs.flatMap((run) =>
      Array.from(run.text, (character) => measure(character, run.style))
    )
  );
  assert(
    boundaryTokenLayout.geometry.textWidth - usedWidth <= widestGlyph + 0.01,
    "formatting boundaries cannot leave a premature ragged line"
  );
}

const prefix = "A".repeat(24);
const smallStyle = {
  family: "latin-modern",
  face: "regular",
  size: COVER_LETTER_STYLE_DEFAULTS.fontSizePt,
  tracking: 0
};
const largeStyle = { ...smallStyle, size: 36 };
const singleGlyphTarget =
  measure(prefix, smallStyle) + measure("C", largeStyle) / 2;
for (const count of [1, 2, 3]) {
  const stagedLines = breakParagraph(
    paragraphItems(
      `${prefix}<size=36>${"C".repeat(count)}</size>`,
      smallStyle.size,
      smallStyle.family,
      smallStyle.tracking
    ),
    singleGlyphTarget,
    "left"
  );
  assert.equal(
    stagedLines[0].runs.map((run) => run.text).join(""),
    prefix,
    `stage ${count}: a large unsplittable glyph moves to the next line`
  );
  assert.equal(
    stagedLines.flatMap((line) => line.runs).map((run) => run.text).join(""),
    `${prefix}${"C".repeat(count)}`,
    `stage ${count}: reflow preserves character order`
  );
  assert(
    stagedLines.every((line) =>
      line.runs.every((run) => run.x + run.width <= singleGlyphTarget + 0.01)
    ),
    `stage ${count}: reflow never overflows a partially occupied line`
  );
}

// Emergency layout must still keep later multi-box words intact when they fit.
const followingWordText = "BBBBBDDDD";
const followingWordLines = breakParagraph(
  paragraphItems(
    `${"W".repeat(88)} alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu ` +
      `<size=11>BBBBB</size><size=14>DDDD</size> tail`,
    smallStyle.size,
    smallStyle.family,
    smallStyle.tracking
  ),
  468,
  "left"
);
assert(
  followingWordLines.length > 2,
  "the oversized token forces the emergency path"
);
const followingWordLine = followingWordLines.find((line) =>
  line.runs.some((run) => run.text.startsWith("BBBBB"))
);
assert.equal(
  followingWordLine.runs
    .map((run) => run.text)
    .join("")
    .slice(0, followingWordText.length),
  followingWordText,
  "a mixed-size word stays whole instead of splitting at its style boundary"
);
assert.equal(
  followingWordLines.flatMap((line) => line.runs).map((run) => run.text).join(""),
  `${"W".repeat(88)}alphabetagammadeltaepsilonzetaetathetaiotakappalambdamu${followingWordText}tail`,
  "emergency-path word breaking preserves character order"
);

for (const mutation of [
  { ...raw, format: "typeset-resume" },
  { ...raw, schemaVersion: 3 },
  { ...raw, document: { header: null, paragraphs: [] } },
  { ...raw, style: { ...raw.style, fontSizePt: 40 } },
  { ...raw, extra: true }
]) {
  assert.throws(
    () => parseCoverLetterFile(JSON.stringify(mutation)),
    CoverLetterFileError
  );
}

for (const invalidData of [
  { ...withHeader, contact: Array.from({ length: 21 }, (_, index) => `item-${index}`) },
  { ...withHeader, name: "x".repeat(1_001) },
  { ...withHeader, contact: ["x".repeat(1_001)] }
]) {
  assert.throws(
    () => serializeCoverLetterFile(invalidData, COVER_LETTER_STYLE_DEFAULTS),
    (error) => error instanceof CoverLetterFileError && error.code === "invalid-document",
    "the serializer rejects header data its parser would reject"
  );
}
assert.throws(
  () => serializeCoverLetterFile(withHeader, { ...COVER_LETTER_STYLE_DEFAULTS, contactDivider: "" }),
  (error) => error instanceof CoverLetterFileError && error.code === "invalid-style",
  "a persisted contact divider must contain one or two characters"
);

// Sweep every persisted family through both codec and layout registries.
for (const { value: family } of FONT_FAMILY_OPTIONS) {
  const style = { ...COVER_LETTER_STYLE_DEFAULTS, fontFamily: family };
  const round = parseCoverLetterFile(serializeCoverLetterFile(data, style));
  assert.equal(round.style.fontFamily, family, `.cover must round-trip fontFamily ${family}`);

  const familyLayout = layoutCoverLetter(
    toTypesetSchema(round.data),
    coverLetterStyleToDocumentStyle(round.style)
  );
  assert(familyLayout.pages.length >= 1, `${family} must produce pages`);
  const runs = familyLayout.pages[0].lines.flatMap((line) => line.runs);
  assert(runs.length > 0, `${family} must produce runs`);
  assert(
    runs.every((run) => run.style.family === family),
    `${family} must be the family of every run it lays out`
  );
  // Every face must measure: a caps or display face wired to a missing metrics
  // record would only surface when a heading or name is painted.
  for (const face of ["regular", "bold", "italic", "boldItalic", "boldDisplay", "caps"]) {
    const width = measure("Handgloves 123", { family, face, size: 10, tracking: 0 });
    assert(width > 0 && Number.isFinite(width), `${family}:${face} must measure`);
    const rule = underlineRule({ family, face, size: 10, tracking: 0 });
    assert(rule.thickness > 0 && rule.offset > 0, `${family}:${face} must have an underline rule`);
  }
}

console.log(
  `cover-letter file v2 + v1 migration + layout probes: PASS (incl. ${FONT_FAMILY_OPTIONS.length} families × 6 faces through the file boundary)`
);
