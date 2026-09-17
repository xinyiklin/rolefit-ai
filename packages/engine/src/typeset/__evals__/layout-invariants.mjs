// Semantic vertical-layout contracts. Snapshots catch any coordinate drift;
// these assertions explain which relationships must remain true when a
// deliberate layout change is reviewed.

import assert from "node:assert/strict";

import {
  coverLetterResumeData
} from "../../lib/coverLetter.ts";
import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { buildStarterResume } from "../../sampleResume.ts";
import {
  buildHeaderVerticalStream,
  buildVerticalStream,
  pageBox
} from "../blocks.ts";
import { buildCoverLetterVerticalStream } from "../coverLetterBlocks.ts";
import {
  layoutCoverLetter,
  layoutResume,
  layoutVerticalStream
} from "../layout.ts";
import { toTypesetSchema } from "../schema.ts";

const resumeSchema = toTypesetSchema(buildStarterResume());
const sharedHeader = buildStarterResume().header;
const coverSchema = toTypesetSchema(
  coverLetterResumeData(["First paragraph.", "Second paragraph."], sharedHeader)
);

const commonStyle = { ...DOC_STYLE_DEFAULTS };
const headerCount = buildHeaderVerticalStream(
  resumeSchema,
  commonStyle
).length;

assert.deepEqual(
  buildVerticalStream(resumeSchema, commonStyle).slice(0, headerCount),
  buildCoverLetterVerticalStream(coverSchema, commonStyle).slice(
    0,
    headerCount
  ),
  "resume and cover streams must use identical shared-header geometry"
);

assert.deepEqual(
  buildHeaderVerticalStream(resumeSchema, {
    ...commonStyle,
    lineHeight: 1
  }),
  buildHeaderVerticalStream(resumeSchema, {
    ...commonStyle,
    lineHeight: 2
  }),
  "header row spacing must remain independent of body line spacing"
);

function firstBodyDistForResume(headerSectionGapPt) {
  return buildVerticalStream(resumeSchema, {
    ...commonStyle,
    headerSectionGapPt
  })[headerCount].dist;
}

function firstBodyDistForCover(headerSectionGapPt) {
  return buildCoverLetterVerticalStream(coverSchema, {
    ...commonStyle,
    headerSectionGapPt
  })[headerCount].dist;
}

for (const firstBodyDist of [
  firstBodyDistForResume,
  firstBodyDistForCover
]) {
  const zero = firstBodyDist(0);
  const seven = firstBodyDist(7);
  assert.ok(zero > 0, "the following row still owns its line advance");
  assert.ok(
    Math.abs(seven - zero - 7) < 1e-9,
    "a zero gap adds no hidden space and authored gap points add exactly once"
  );
}

const tightStream = buildVerticalStream(resumeSchema, {
  ...commonStyle,
  lineHeight: 1,
  titleSubGapPt: -12
});
const titleIndex = tightStream.findIndex((line) =>
  line.runs.some(
    (run) => run.src?.kind === "entry" && run.src.field === "titleLeft"
  )
);
const subtitleIndex = tightStream.findIndex(
  (line, index) =>
    index > titleIndex &&
    line.runs.some(
      (run) =>
        run.src?.kind === "entry" && run.src.field === "subtitleLeft"
    )
);
assert.ok(titleIndex >= 0 && subtitleIndex === titleIndex + 1);
const title = tightStream[titleIndex];
const subtitle = tightStream[subtitleIndex];
const placedTitleSubtitleDistance =
  subtitle.dist + title.dropOverflow + subtitle.riseOverflow;
assert.ok(
  placedTitleSubtitleDistance > title.depth + subtitle.height,
  "a negative title/subtitle gap must retain positive ink clearance"
);

function bodyBaselines(document, bodyStart) {
  return document.pages[0].lines
    .slice(bodyStart)
    .map((line) => line.baseline);
}

for (const [layout, schema] of [
  [layoutResume, resumeSchema],
  [layoutCoverLetter, coverSchema]
]) {
  const zero = layout(schema, {
    ...commonStyle,
    headerSectionGapPt: 0
  });
  const larger = layout(schema, {
    ...commonStyle,
    headerSectionGapPt: 9
  });
  const zeroBaselines = bodyBaselines(zero, headerCount);
  const largerBaselines = bodyBaselines(larger, headerCount);
  assert.equal(largerBaselines.length, zeroBaselines.length);
  largerBaselines.forEach((baseline, index) => {
    assert.ok(
      baseline >= zeroBaselines[index],
      "increasing a gap must not move following content upward"
    );
  });
}

const longCover = toTypesetSchema(
  coverLetterResumeData(
    Array.from(
      { length: 180 },
      (_, index) => `Deterministic paragraph ${index + 1}.`
    ),
    sharedHeader
  )
);
const firstPagination = layoutCoverLetter(longCover, commonStyle);
const secondPagination = layoutCoverLetter(longCover, commonStyle);
assert.ok(firstPagination.pages.length > 1, "pagination fixture spans pages");
assert.deepEqual(
  secondPagination,
  firstPagination,
  "pagination and every shared layout coordinate must be deterministic"
);

// The public placer is deterministic independently of either document stream;
// DOM and PDF backends receive this same LayoutDocument without relayout.
const placedAgain = layoutVerticalStream(
  buildCoverLetterVerticalStream(longCover, commonStyle),
  pageBox(commonStyle)
);
assert.deepEqual(
  placedAgain,
  firstPagination,
  "the shared placed coordinates are the sole renderer input"
);

console.log(
  "layout invariants passed: zero gaps, header independence/parity, ink floor, monotonic gaps, deterministic pagination"
);

const rowEntry = { id: 'rows-entry', titleLeft: 'Title', titleRight: '', subtitleLeft: 'Subtitle', subtitleRight: '', bullets: [{ id: 'rows-bullet', text: 'Body' }] };
const rowData = (entries) => ({ header: null, sections: [{ id: 'rows-section', heading: 'Experience', type: 'standard', items: entries }] });
for (const title of [true, false]) for (const subtitle of [true, false]) {
  const entry = { ...rowEntry, titleLeft: title ? rowEntry.titleLeft : null, titleRight: title ? '' : null, subtitleLeft: subtitle ? rowEntry.subtitleLeft : null, subtitleRight: subtitle ? '' : null };
  const schema = toTypesetSchema(rowData([entry]));
  const lines = buildVerticalStream(schema, commonStyle);
  const fields = lines.flatMap((line) => line.runs.map((run) => run.src?.field));
  assert.equal(fields.includes('titleLeft'), title);
  assert.equal(fields.includes('subtitleLeft'), subtitle);
  assert.equal(lines.length, 2 + Number(title) + Number(subtitle));
  if (!title) {
    const changedGap = buildVerticalStream(schema, { ...commonStyle, titleSubGapPt: 55 });
    assert.deepEqual(changedGap, lines, 'absent title has no title/subtitle junction');
  }
  if (!title && !subtitle) {
    assert.deepEqual(buildVerticalStream(schema, { ...commonStyle, headBulletGapPt: 55 }), lines, 'bullet-only entry has no head/bullet junction');
  }
}
const emptyEntry = { ...rowEntry, id: 'empty-entry', titleLeft: null, titleRight: null, subtitleLeft: null, subtitleRight: null, bullets: [] };
assert.deepEqual(layoutResume(toTypesetSchema(rowData([emptyEntry, rowEntry, emptyEntry])), commonStyle), layoutResume(toTypesetSchema(rowData([rowEntry])), commonStyle), 'fully empty entries add no geometry or pagination state');
console.log('entry row layout combinations and absent-junction checks passed');
