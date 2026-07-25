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
import { coverLetterStyleToDocumentStyle } from "../coverLetter.ts";
import { FONT_FAMILY_OPTIONS } from "../documentStyle.ts";

const source = [
  "July 24, 2026",
  "Dear Hiring Manager,",
  "I build dependable local-first tools and care about clear, honest product writing.",
  "In my current work, I translate ambiguous workflows into focused interfaces without inventing evidence.",
  "Sincerely,\nCandidate Name"
].join("\n\n");

const data = parseCoverLetterText(source);
assert.equal(coverLetterPlainText(data), source);

const serialized = serializeCoverLetterFile(data, COVER_LETTER_STYLE_DEFAULTS);
const raw = JSON.parse(serialized);
assert.equal(raw.format, COVER_LETTER_FILE_MAGIC);
assert.equal(raw.schemaVersion, 1);
assert.equal(JSON.stringify(raw).includes('"id"'), false, "session ids never cross the .cover boundary");

const parsed = parseCoverLetterFile(serialized);
assert.equal(coverLetterPlainText(parsed.data), source);
assert.deepEqual(parsed.style, COVER_LETTER_STYLE_DEFAULTS);

const layout = layoutCoverLetter(
  toTypesetSchema(parsed.data),
  coverLetterStyleToDocumentStyle(parsed.style)
);
assert.equal(layout.pages.length, 1);
assert(layout.pages[0].lines.length >= 5, "cover-letter paragraphs reach the shared layout engine");

const doubleSpaced = parseCoverLetterFile(
  serializeCoverLetterFile(data, {
    ...COVER_LETTER_STYLE_DEFAULTS,
    lineHeight: 2
  })
);
assert.equal(doubleSpaced.style.lineHeight, 2);

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

// Word-processor rule: a line's vertical placement depends on the fonts and
// sizes on it, never on which glyphs were typed. Typing a taller ascender or a
// deeper descender must not move the line or its neighbours.
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

// The expansion still has to clear the real ink of the tallest and deepest
// glyphs the run could hold, at every supported inline size.
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

// Engine runs are word boxes. Both renderers must group them through interior
// spaces, or the PDF draws one rule per word while the editor (which paints
// merged style spans) shows one continuous rule. The rule's depth comes from the
// face, so it cannot step between two words of the same phrase either.
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
assert.deepEqual(
  separatorsFor([
    "The quick brown fox jumps over the lazy dog and keeps running well past the right margin so it wraps."
  ]),
  [[" ", ""]],
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

// An oversized token puts the WHOLE paragraph on the emergency path. Ordinary
// words that follow must still break at spaces: a word carrying an inline size
// boundary arrives as several boxes, and splitting it there would chop a word
// that fits a column of its own.
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
  { ...raw, schemaVersion: 2 },
  { ...raw, document: { paragraphs: [] } },
  { ...raw, style: { ...raw.style, fontSizePt: 40 } },
  { ...raw, extra: true }
]) {
  assert.throws(
    () => parseCoverLetterFile(JSON.stringify(mutation)),
    CoverLetterFileError
  );
}

// ---- every supported family survives the file boundary and lays out ----
//
// A family id is a PERSISTED enum value. The codec validates it against
// FONT_FAMILY_OPTIONS and the registry resolves its faces, but those are separate
// derivations from lib/fontFamilies.ts: a family present in one and absent from
// the other produces either a file that will not reopen or a layout that throws
// on a missing face. Both directions are cheap to sweep, so sweep them.
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
  `cover-letter file v1 + layout probes: PASS (incl. ${FONT_FAMILY_OPTIONS.length} families × 6 faces through the file boundary)`
);
