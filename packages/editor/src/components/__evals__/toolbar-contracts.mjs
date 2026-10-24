// Toolbar chrome decisions that a DOM would otherwise be needed to prove: which
// targets count as inside a surface for outside-dismissal, and what a numeric
// draft commits on blur/Enter. The pure decisions are exercised directly; the
// source checks pin each control to them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DOC_ZOOM_OPTIONS, nextZoomOption } from "@typeset/engine/lib/documentStyle.ts";

import { isInsideToolbarPortal } from "../toolbarPortal.ts";
import { numericDraftCommit } from "../toolbar/numericDraft.ts";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// ----- #7 portaled toolbar menus belong to the surface that opened them -----
const fakeElement = (insidePortal) => ({
  closest: (selector) => (selector === "[data-typeset-toolbar-portal]" && insidePortal ? {} : null)
});
assert.equal(isInsideToolbarPortal(fakeElement(true)), true, "a target inside a portaled menu is inside");
assert.equal(isInsideToolbarPortal(fakeElement(false)), false, "any other element is outside");
assert.equal(isInsideToolbarPortal(null), false, "a missing target is outside");
assert.equal(isInsideToolbarPortal({}), false, "a non-element target is outside");

const popover = source("../Popover.tsx");
const handler = (name) => {
  const start = popover.indexOf(`function ${name}(`);
  const end = popover.indexOf("\n    }\n", start);
  assert.ok(start >= 0 && end > start, `the Popover ${name} handler is bounded`);
  return popover.slice(start, end);
};
assert.match(
  handler("onKeyDown"),
  /isInsideToolbarPortal\(event\.target\)\) return/,
  "Escape inside a portaled menu is left to that menu instead of closing the popover"
);
assert.match(
  handler("onPointerDown"),
  /isInsideToolbarPortal\(event\.target\)/,
  "choosing a portaled font or size option keeps the popover open"
);
assert.match(
  handler("onFocusIn"),
  /isInsideToolbarPortal\(event\.target\)/,
  "focus entering a portaled menu keeps the popover open"
);

const formatting = source("../toolbar/FormattingToolbar.tsx");
const moreStart = formatting.indexOf("if (!moreOpen) return;");
const moreEffect = formatting.slice(moreStart, formatting.indexOf("}, [moreOpen]);", moreStart));
assert.doesNotMatch(moreEffect, /font-size-control__menu/, "the More panel no longer exempts only the size menu");
assert.equal(
  moreEffect.match(/isInsideToolbarPortal\(event\.target\)/g)?.length,
  2,
  "the More panel treats every portaled menu as inside for pointerdown and Escape"
);

// ----- #8 numeric drafts revert when empty and never commit an unchanged value -----
const clampSize = (next) => Math.min(72, Math.max(1, Math.round(next * 10) / 10));
assert.equal(numericDraftCommit("", "11", 11, clampSize), null, "an emptied size reverts instead of committing the minimum");
assert.equal(numericDraftCommit("  ", "", null, clampSize), null, "blurring an empty mixed size commits nothing");
assert.equal(numericDraftCommit("abc", "11", 11, clampSize), null, "an unparsable draft reverts");
assert.equal(numericDraftCommit("11", "11", 11, clampSize), null, "an unchanged draft commits nothing");
assert.equal(numericDraftCommit("11.0", "11", 11, clampSize), null, "a draft that normalizes to the current value commits nothing");
assert.equal(numericDraftCommit("12", "11", 11, clampSize), 12, "a changed draft commits");
assert.equal(numericDraftCommit("14", "", null, clampSize), 14, "a typed size applies to a mixed field");
assert.equal(numericDraftCommit("0", "11", 11, clampSize), 1, "an explicit out-of-range value still clamps");

const marginPt = (inches) => Math.round(Math.min(144, Math.max(0, inches * 72)) * 10) / 10;
assert.equal(numericDraftCommit("", "0.5", 36, marginPt), null, "a cleared margin reverts instead of committing the minimum");
assert.equal(numericDraftCommit("0.5", "0.5", 36, marginPt), null, "an unchanged margin commits nothing");
assert.equal(
  numericDraftCommit("0.56", "0.56", 40, marginPt),
  null,
  "a margin whose inch display rounds commits nothing when left as displayed"
);
assert.equal(numericDraftCommit("0.75", "0.5", 36, marginPt), 54, "a changed margin commits in points");

const fontSize = source("../toolbar/FontSizeControl.tsx");
assert.match(
  fontSize,
  /const commitDraft = \(\) => \{[\s\S]{0,200}?numericDraftCommit\(draft, displaySize\(value\), value, clamp\)/,
  "the size box resolves its draft through the shared decision"
);
assert.match(
  fontSize,
  /const commitDraft = \(\) => \{[\s\S]{0,400}?if \(next === null\)[\s\S]{0,120}?setDraft\(displaySize\(value\)\)/,
  "a reverted size draft restores the displayed value without calling onChange"
);
const step = fontSize.slice(fontSize.indexOf("const step = "), fontSize.indexOf("const returnFocusAfterCommit"));
assert.doesNotMatch(step, /\?\? min/, "a mixed (blank) size never steps from the minimum");
assert.match(step, /else if \(onStep\) onStep\(delta\)/, "an untouched draft steps each run from its own size");
assert.match(fontSize, /const stepUnavailable = value === null && !onStep;/, "with no relative step, a mixed size disables +/-");
const formattingToolbar = source("../toolbar/FormattingToolbar.tsx");
assert.match(formattingToolbar, /onStep=\{inlineFormatting\?\.fontSize\?\.onStep\}/, "the selection toolbar wires the relative step");
assert.doesNotMatch(
  formattingToolbar,
  /fontFamily\?\.value \?\? docStyle/,
  "a mixed family stays blank instead of showing the document font"
);

const page = source("../toolbar/PageStylePopover.tsx");
assert.match(
  page,
  /numericDraftCommit\(draft, formatMarginInches\(valuePt\), valuePt,/,
  "margin inputs resolve their draft through the shared decision"
);
assert.match(
  page,
  /if \(nextPt === null\) \{\s*setDraft\(formatMarginInches\(valuePt\)\);\s*return;/,
  "a reverted margin draft never flips the preset to custom"
);

// ----- Zoom steps below the smallest preset (a phone's Fit) -----
{
  const smallest = DOC_ZOOM_OPTIONS[0];
  assert.equal(nextZoomOption(0.42, -1), 0.42, "zooming out below every preset stays put");
  assert.equal(nextZoomOption(0.42, 1), smallest, "zooming in from a phone Fit reaches the smallest preset");
  assert.equal(nextZoomOption(0.75, -1), smallest, "zooming out between presets still steps down");
}

console.log("toolbar contract probes: PASS");
