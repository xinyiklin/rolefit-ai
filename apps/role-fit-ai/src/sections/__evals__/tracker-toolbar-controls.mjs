import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tracker = readFileSync(new URL("../tabs/TrackerTab.tsx", import.meta.url), "utf8");
const calendar = readFileSync(new URL("../tracker/TrackerCalendarView.tsx", import.meta.url), "utf8");
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

assert.ok(
  tracker.includes("applicationSearchRank"),
  "table search uses the shared relevance contract"
);
assert.ok(
  tracker.includes('const grouped = sort.key === "applied" && !query.trim();'),
  "relevance-ranked results do not retain misleading chronological month groups"
);
assert.ok(
  calendar.includes("applicationSearchRank"),
  "calendar search uses the same application field scope as table search"
);
assert.doesNotMatch(
  tracker,
  /sorted\.length > 0[\s\S]{0,120}?applications-pagination/,
  "pagination remains present when search or filters return no applications"
);

assert.match(
  applicationStyles,
  /\.workspace-toolbar--tracker\s*\{[^}]*--tracker-control-height:\s*34px;[^}]*align-items:\s*stretch;/,
  "the desktop tracker toolbar owns one control height and top alignment"
);
assert.match(
  applicationStyles,
  /\.workspace-toolbar--tracker \.workspace-search,[\s\S]{0,180}?\.workspace-toolbar--tracker \.view-switch\s*\{[^}]*height:\s*var\(--tracker-control-height\)/,
  "search, lifecycle filters, and view selector share the tracker control height"
);

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
const tableHeadRule = applicationStyles.match(/\.applications-table__head\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(
  tableHeadRule,
  /background:\s*var\(--card-soft\)/,
  "the table head paints through its measured scrollbar gutter"
);
assert.match(
  tableHeadRule,
  /box-shadow:\s*inset 0 -1px 0 var\(--hairline\)/,
  "the table head rule spans its measured scrollbar gutter"
);
const tableHeadRowRule = applicationStyles.match(/\.applications-table__row--head\s*\{([^}]*)\}/)?.[1] ?? "";
assert.doesNotMatch(
  tableHeadRowRule,
  /border-bottom:/,
  "the inner header row does not stop the divider before the Firefox gutter"
);
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
  /@media \(pointer: coarse\)[\s\S]{0,420}?\.activity-filter-menu__item,[\s\S]{0,80}?\.view-switch\s*\{[\s\S]{0,80}?min-height:\s*44px/,
  "view choices and lifecycle menu items reach the coarse-pointer target floor"
);
assert.match(
  applicationStyles,
  /@media \(pointer: coarse\)[\s\S]{0,320}?\.workspace-toolbar--tracker \.view-switch\s*\{[^}]*padding-block:\s*0;/,
  "the shared coarse-pointer frame leaves each view option a 44px interactive height"
);
