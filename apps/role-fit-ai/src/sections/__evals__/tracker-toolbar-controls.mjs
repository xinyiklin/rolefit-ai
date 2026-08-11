import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tracker = readFileSync(new URL("../tabs/TrackerTab.tsx", import.meta.url), "utf8");
const pipelineStyles = readFileSync(new URL("../../styles/pipeline.css", import.meta.url), "utf8");
const applicationStyles = readFileSync(
  new URL("../../styles/application-pages.css", import.meta.url),
  "utf8"
);

assert.ok(
  tracker.includes("const triggerLabel = selectedStatus ? STATUS_LABEL[selectedStatus] : groupLabel;"),
  "a nested lifecycle selection replaces its group label in the toolbar"
);
assert.ok(
  tracker.includes("pipeline-filter pipeline-filter--menu"),
  "Active and Inactive each use one full-segment menu trigger"
);
assert.ok(tracker.includes("<span>All {group}</span>"), "each lifecycle menu retains its whole-group option");
assert.ok(!tracker.includes("pipeline-filter--split"), "lifecycle filters no longer hide two actions in one segment");
assert.ok(!tracker.includes("pipeline-filter__disclosure"), "there is no separate narrow disclosure target");

assert.ok(
  tracker.includes('role="radiogroup" aria-label="Application view"'),
  "Table and Calendar expose a symmetric choice to assistive technology"
);
assert.equal((tracker.match(/type="radio"/g) ?? []).length, 2, "both view modes are native radio options");
assert.ok(tracker.includes('checked={value === "table"}'));
assert.ok(tracker.includes('checked={value === "calendar"}'));
assert.ok(!tracker.includes('role="switch"'), "the view selector is not described as a binary Calendar switch");

assert.match(
  applicationStyles,
  /\.workspace-toolbar--tracker\s*\{[\s\S]{0,180}?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(280px, 360px\)/,
  "the complete control group stays registered over the tracker rail"
);
assert.match(
  applicationStyles,
  /\.view-switch\[data-view="calendar"\]::before/,
  "the existing selection indicator follows the selected radio option"
);
const viewSelectionRule = applicationStyles.match(/\.view-switch::before\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(viewSelectionRule, /background:\s*var\(--accent-soft\)/, "the selected view uses a quiet accent tint");
assert.doesNotMatch(viewSelectionRule, /border:/, "the selected view does not nest another border inside the control");
assert.doesNotMatch(viewSelectionRule, /box-shadow:/, "the selected view stays flat instead of becoming a raised button");
assert.match(
  applicationStyles,
  /\.view-switch__option:not\(\.is-active\):hover \.view-switch__label/,
  "the inactive view has its own hover response"
);
assert.match(
  pipelineStyles,
  /@media \(pointer: coarse\)[\s\S]{0,160}?\.pipeline-filter\s*\{[\s\S]{0,80}?height:\s*44px/,
  "lifecycle menu buttons reach the coarse-pointer target floor"
);
assert.match(
  applicationStyles,
  /@media \(pointer: coarse\)[\s\S]{0,180}?\.activity-filter-menu__item,[\s\S]{0,80}?\.view-switch\s*\{[\s\S]{0,80}?min-height:\s*44px/,
  "view choices and lifecycle menu items reach the coarse-pointer target floor"
);
