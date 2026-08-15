import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(
  new URL("../../../styles/application-pages.css", import.meta.url),
  "utf8"
);
const tableView = readFileSync(
  new URL("../TrackerTableView.tsx", import.meta.url),
  "utf8"
);
const inspector = readFileSync(
  new URL("../TrackerInspector.tsx", import.meta.url),
  "utf8"
);

const inspectorBlocks = [...css.matchAll(/\.pipeline-inspector\s*\{([^}]*)\}/g)]
  .map((match) => match[1]);

assert.ok(
  inspectorBlocks.some((block) =>
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/.test(block)
  ),
  "the tracker inspector must constrain its grid track so long values cannot widen the panel"
);

const applicationHeightBlock = css.slice(
  css.indexOf("@media (min-width: 1081px)"),
  css.indexOf("@media (max-width: 1080px)")
);

assert.notEqual(
  applicationHeightBlock,
  "",
  "the Applications two-pane height rules are desktop-scoped"
);
assert.match(
  applicationHeightBlock,
  /\.studio-body\[data-tab="applications"\]\s*\{[\s\S]{0,220}?overflow:\s*hidden/,
  "Applications bounds the studio scroller instead of growing it"
);
assert.match(
  applicationHeightBlock,
  /\.applications-page\s*\{[\s\S]{0,180}?height:\s*100%;[\s\S]{0,180}?min-height:\s*0/,
  "Applications uses the full studio height even when the result set is empty"
);
assert.match(
  applicationHeightBlock,
  /\.applications-page\s*>\s*\.tracker-layout\s*>\s*\.applications-table-wrap\s*\{[\s\S]{0,260}?grid-template-rows:\s*minmax\(0,\s*1fr\)\s*auto;[\s\S]{0,220}?overflow:\s*hidden/,
  "the table workspace reserves a fixed row for pagination below its scrollport"
);
assert.match(
  applicationHeightBlock,
  /\.applications-page\s*>\s*\.tracker-layout\s*>\s*\.applications-table-wrap\s*>\s*\.applications-table\s*\{[\s\S]{0,180}?min-height:\s*0;[\s\S]{0,180}?height:\s*100%/,
  "the table frame consumes the bounded workspace height"
);
assert.match(
  css,
  /\.applications-table__body\s*\{[\s\S]{0,260}?overflow:\s*auto/,
  "application rows scroll inside the fixed-height table without hiding pagination"
);
const tableHeadRule = css.match(/\.applications-table__head\s*\{([^}]*)\}/)?.[1] ?? "";
const tableBodyRule = css.match(/\.applications-table__body\s*\{([^}]*)\}/)?.[1] ?? "";
assert.doesNotMatch(tableHeadRule, /scrollbar-gutter:\s*stable/, "the table header does not reserve an empty scrollbar strip");
assert.doesNotMatch(tableBodyRule, /scrollbar-gutter:\s*stable/, "the table body does not reserve an empty scrollbar strip");
assert.doesNotMatch(
  tableBodyRule,
  /scrollbar-(?:width|color):/,
  "the table does not force Firefox into a permanently visible physical scrollbar"
);
assert.doesNotMatch(
  css,
  /\.applications-table__body::-(?:webkit-)?scrollbar/,
  "the table adds no vendor-specific scrollbar chrome beyond the inspector rail"
);
assert.match(
  tableHeadRule,
  /padding-right:\s*var\(--applications-scrollbar-width,\s*0px\)/,
  "the header reserves only the measured width of a scrollbar that is actually present"
);
assert.match(
  tableView,
  /body\.offsetWidth\s*-\s*body\.clientWidth[\s\S]{0,500}?--applications-scrollbar-width/,
  "the table measures the live vertical scrollbar so its header and rows stay aligned"
);
assert.match(
  applicationHeightBlock,
  /\.applications-page\s*>\s*\.tracker-layout\s*>\s*\.pipeline-inspector\s*\{[\s\S]{0,260}?overflow-y:\s*auto/,
  "the application inspector rail keeps its independent scrollport"
);
assert.match(
  applicationHeightBlock,
  /\.applications-page\s*>\s*\.tracker-layout\s*>\s*\.pipeline-inspector\s*\{[\s\S]{0,140}?position:\s*static/,
  "the independently scrolling inspector is not sticky"
);
assert.match(
  css,
  /\.application-gap-list li\s*\{[\s\S]{0,300}?min-width:\s*0;[\s\S]{0,300}?overflow-wrap:\s*anywhere/,
  "semantic assessment gap rows wrap instead of widening the inspector"
);
assert.ok(
  inspector.includes('<ul className="application-gap-list">'),
  "the inspector presents sentence-length gaps as a reading list rather than chips"
);
assert.match(
  inspector,
  /Job activity[\s\S]{0,700}?<ul className="application-related-records">[\s\S]{0,700}?application-related-records__marker/,
  "job activity reuses the saved-record timeline instead of the generic duplicate list"
);
assert.doesNotMatch(
  inspector,
  /inspector-related-record__open/,
  "job activity has no orphaned one-off Open treatment"
);
assert.doesNotMatch(
  tableView,
  /applications-table__month-count/,
  "month dividers do not show a redundant application count"
);
assert.match(
  css,
  /\.applications-table__month-group\s*\{[\s\S]{0,220}?width:\s*fit-content;[\s\S]{0,220}?min-width:\s*100%/,
  "month groups cover the complete horizontal row width"
);
assert.match(
  css,
  /\.applications-table__month-divider \.table-eyebrow\s*\{[\s\S]{0,160}?position:\s*sticky;[\s\S]{0,160}?left:\s*var\(--s3\)/,
  "month labels stay fixed at the visible left edge during horizontal scrolling"
);
assert.match(
  css,
  /\.applications-table__month-divider\s*\{[\s\S]{0,160}?position:\s*sticky;[\s\S]{0,160}?top:\s*0/,
  "the current month divider stays below the fixed table header during vertical scrolling"
);
assert.doesNotMatch(
  inspector,
  /pipeline-inspector__open|Open full application details/,
  "the inspector relies on its labeled Details action instead of a duplicate open icon"
);
assert.doesNotMatch(
  inspector,
  />\s*Job link\s*</,
  "the inspector rail does not duplicate the job-link action available in application details"
);
assert.doesNotMatch(
  inspector,
  /verdictResume|<em>Resume<\/em>/,
  "the inspector does not repeat the assessed resume beside the Fit verdict"
);
assert.doesNotMatch(
  inspector,
  /figures-strip figures-strip--compact|application-detail-score__reason/,
  "the inspector no longer maintains a second Fit presentation"
);
assert.match(inspector, /<ApplicationFitSummary[\s\S]{0,360}?summary=/, "the inspector renders the shared verdict-and-rationale component");
assert.match(
  tableView,
  /applications-table__body\$\{grouped && visible\.length \? " has-month-groups" : ""\}/,
  "the scroll body marks when a sticky month band needs to continue through its gutter"
);
assert.match(
  css,
  /\.applications-table__body\.has-month-groups\s*\{[\s\S]{0,260}?background:\s*linear-gradient\([\s\S]{0,260}?var\(--paper-deep\)[\s\S]{0,260}?var\(--applications-month-divider-height\)/,
  "the scrollport surface continues the visible sticky month band beneath an active scrollbar track"
);
assert.match(
  css,
  /\.applications-table\s*\{[\s\S]{0,220}?container-type:\s*inline-size/,
  "the Applications register adapts to its own split-pane width instead of only the viewport"
);
assert.match(
  css,
  /@container\s*\(max-width:\s*762px\)\s*\{[\s\S]{0,520}?\.applications-table__row\s*\{[\s\S]{0,360}?grid-template-columns:[\s\S]{0,360}?\.applications-table__row\s*>\s*\.applications-table__cell--next-action\s*\{[\s\S]{0,120}?display:\s*none/,
  "a narrow split-pane drops Next action before the fixed Fit verdict can be clipped"
);
assert.doesNotMatch(
  tableView,
  /Priority|priorityFor|applications-table__cell--priority/,
  "the Applications register does not retain the removed priority column or display path"
);

console.log("tracker inspector layout contract checks passed");
