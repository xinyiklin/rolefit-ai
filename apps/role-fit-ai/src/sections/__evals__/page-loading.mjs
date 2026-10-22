import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundled = await build({
  stdin: {
    contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { ApplicationsLoadingSkeleton, AnalyticsLoadingSkeleton } from "../PageLoadingSkeleton.tsx";
      import { AnalyticsTab } from "../tabs/AnalyticsTab.tsx";
      export const table = renderToStaticMarkup(<ApplicationsLoadingSkeleton view="table" />);
      export const calendar = renderToStaticMarkup(<ApplicationsLoadingSkeleton view="calendar" />);
      export const analytics = renderToStaticMarkup(<AnalyticsLoadingSkeleton />);
      export function report(loadError, applications = [], props = {}) {
        return renderToStaticMarkup(
          <AnalyticsTab
            applications={applications}
            loadError={loadError}
            pendingWrites={0}
            trackerError=""
            ghostedAfterDays={21}
            onGhostedAfterDaysChange={() => {}}
            autoMarkGhosted={false}
            onAutoMarkGhostedChange={() => {}}
            onMarkGhosted={async (ids) => ids.length}
            autoMarkedCount={0}
            onDismissAutoMarked={() => {}}
            onOpenApplication={() => {}}
            onOpenApplications={() => {}}
            onViewStage={() => {}}
            {...props}
          />
        );
      }
    `,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    loader: "tsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const module = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(
  createRequire(import.meta.url), module, module.exports
);
const { table, calendar, analytics, report } = module.exports;

// Static markup only: attributes by name, so prop order never matters.
const attributes = (source) =>
  Object.fromEntries([...source.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, name, value = ""]) => [name, value]));
const openTags = (html, tag) => [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))].map(([, source]) => attributes(source));
const buttons = (html) =>
  [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map(([, source, inner]) => ({
    ...attributes(source),
    text: inner.replace(/<[^>]+>/g, "")
  }));
const stripTags = (inner) => inner.replace(/<[^>]+>/g, "");
const selects = (html) =>
  [...html.matchAll(/<select\b([^>]*)>(.*?)<\/select>/g)].map(([, source, inner]) => ({
    ...attributes(source),
    options: [...inner.matchAll(/<option\b([^>]*)>(.*?)<\/option>/g)].map(([, option, text]) => ({
      ...attributes(option),
      text: stripTags(text)
    }))
  }));
const selectedValues = (select) => select.options.filter((option) => "selected" in option).map((option) => option.value);
const hasClass = (tag, name) => (tag.class ?? "").split(/\s+/).includes(name);
const withClass = (tags, name) => tags.filter((tag) => hasClass(tag, name));
const REMOVED_CLASSES =
  /viz-|analytics-charts|figures-strip|analytics-zone|analytics-bar|analytics-period|analytics-desk|workcol|tally__stroke|composition|register__table|register-foot|register-period|outcome-key|quiet-rule/;
const EMPTY_CLAIMS = /Nothing sent yet|No submitted applications|Prepare and apply to roles/;

for (const html of [table, calendar, analytics]) {
  assert.equal((html.match(/role="status"/g) ?? []).length, 1, "one loading announcement");
  assert.doesNotMatch(html, /<(button|input|select|a)\b|tabindex=/i, "no fake interactive controls");
  assert.match(html, /aria-hidden="true"/, "decorations are hidden from assistive technology");
  assert.doesNotMatch(html, EMPTY_CLAIMS, "pending does not claim empty data");
}

// The Analytics skeleton is shaped like the report's top: the KPI row, then the
// activity chart beside the callout and the silence bars, in the report's grid.
assert.match(analytics, /Loading analytics…/);
const skeletonDivs = openTags(analytics, "div");
assert.equal(withClass(skeletonDivs, "an-grid").length, 1, "the skeleton uses the report's grid");
assert.equal(withClass(skeletonDivs, "an-kpis").length, 1, "the skeleton draws the KPI row");
assert.equal(withClass(skeletonDivs, "an-kpi").length, 8, "eight placeholder figures, grouped like the report");
for (const card of ["an-activity", "an-callout", "an-silence"]) {
  assert.equal(withClass(skeletonDivs, card).length, 1, `the skeleton draws the ${card} card`);
}
const activityCard = analytics.slice(analytics.indexOf("an-card an-activity"), analytics.indexOf("an-card an-callout"));
assert.equal((activityCard.match(/page-loading__column\b/g) ?? []).length, 12, "twelve placeholder columns, like the 12-week default");
assert.doesNotMatch(analytics, REMOVED_CLASSES, "the skeleton draws none of the removed layouts");

// Load failure is not a zero-data report.
const failure = report("Synthetic load failure");
assert.match(failure, /role="status">Could not load applications: Synthetic load failure</);
assert.deepEqual(buttons(failure).map((button) => button.text), ["Open Applications to retry"]);
assert.deepEqual(selects(failure), [], "a failure draws no threshold or period control");
assert.doesNotMatch(failure, /an-card|an-col|Mark automatically/, "a failure draws no cards");
assert.doesNotMatch(failure, EMPTY_CLAIMS, "a failure never claims nothing was sent");

// The head controls: a threshold select of common days and a How it works
// disclosure behind an info button, closed at first.
const headSelect = (html) => {
  const select = selects(html).find((candidate) => candidate.options.some((option) => /^\d+ days$/.test(option.text)));
  assert.ok(select, "the head has the Mark as Ghosted after select");
  return select;
};
const named = (button) => button["aria-label"] ?? button.text;
const checkHead = (html) => {
  assert.match(html, /<label class="an-field"><span>Mark as Ghosted after<\/span><select/);
  const select = headSelect(html);
  assert.deepEqual(
    select.options.map((option) => [option.value, option.text]),
    [["7", "7 days"], ["14", "14 days"], ["21", "21 days"], ["30", "30 days"], ["45", "45 days"], ["60", "60 days"], ["90", "90 days"]],
    "the threshold offers the common day counts"
  );
  assert.deepEqual(selectedValues(select), ["21"], "the select shows the saved threshold");
  const howTo = buttons(html).find((button) => button["aria-label"] === "How it works");
  assert.ok(howTo, "a How it works disclosure, named for its icon");
  assert.equal(howTo["aria-expanded"], "false", "the explanation starts closed");
  assert.equal("aria-controls" in howTo, false, "a closed disclosure points at no missing panel");
  assert.doesNotMatch(html, /class="an-howto"/, "no explanation panel until opened");
};

// Settled with no submission: a Draft and a job-only Skip are not sends.
const unsent = [
  { id: "draft", title: "Draft role", company: "Draft company", status: "draft", createdAt: "2026-01-02T12:00:00.000Z", jobUrl: "" },
  {
    id: "skip", title: "Skipped role", company: "Skip company", status: "not_applying",
    createdAt: "2026-01-02T12:00:00.000Z", notApplyingAt: "2026-01-03T12:00:00.000Z", jobUrl: ""
  }
];
for (const blank of [report(""), report("", unsent)]) {
  assert.match(blank, /<strong>Nothing sent yet\.<\/strong>/, "settled empty data keeps real empty guidance");
  checkHead(blank);
  assert.deepEqual(buttons(blank).map(named), ["How it works", "Open Applications"]);
  assert.equal(selects(blank).length, 1, "an empty report has the threshold but no period control");
  assert.doesNotMatch(blank, /an-col|an-callout|an-stagekey|an-kpis|Mark automatically|Loading analytics/, "an empty report draws no charts or rail");
  assert.doesNotMatch(blank, REMOVED_CLASSES);
}

// One application sent 40 days ago with no reply: inside 12 calendar weeks,
// quiet past 21 days. The tab reads the real date, so the fixture is relative.
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const application = {
  id: "synthetic", title: "Example role", role: "Example role", company: "Example company", status: "applied",
  createdAt: daysAgo(40), appliedAt: daysAgo(40), jobUrl: ""
};
const populated = report("", [application]);
assert.match(populated, /Example company/);
assert.doesNotMatch(populated, /Nothing sent yet|Loading analytics/);
assert.doesNotMatch(populated, REMOVED_CLASSES, "none of the removed report parts render");
// The KPI row, then one grid of bands, its cards in reading order.
assert.ok(populated.indexOf('class="an-kpis"') < populated.indexOf('class="an-grid"'), "the KPI row leads");
assert.equal(withClass(openTags(populated, "div"), "an-grid").length, 1, "the report's band grid");
const order = ["an-activity", "an-callout", "an-silence", "an-stages", "an-attention", "an-upcoming"]
  .map((name) => populated.indexOf(`an-card ${name}`));
assert.ok(order.every((at) => at >= 0), "every card renders");
assert.deepEqual([...order].sort((x, y) => x - y), order, "cards come in reading order");
checkHead(populated);
assert.deepEqual(selectedValues(headSelect(report("", [application], { ghostedAfterDays: 25 }))), ["25"], "a saved threshold outside the list is kept as an option");
assert.deepEqual(
  headSelect(report("", [application], { ghostedAfterDays: 25 })).options.map((option) => option.value),
  ["7", "14", "21", "25", "30", "45", "60", "90"],
  "in order"
);

// The period select sits in the head, 12 weeks by default.
const periodSelect = selects(populated).find((select) => select.options.some((option) => option.value === "12w"));
assert.ok(periodSelect, "the head has a period select");
assert.match(populated, /<label class="an-field an-field--period">.*?<span class="sr-only">Period<\/span><select/, "the period select is labelled");
assert.deepEqual(
  periodSelect.options.map((option) => [option.value, option.text]),
  [["8w", "Last 8 weeks"], ["12w", "Last 12 weeks"], ["26w", "Last 26 weeks"], ["all", "All time"]],
  "four periods"
);
assert.deepEqual(selectedValues(periodSelect), ["12w"], "12 weeks is selected");

// KPI row: the period's applications by current stage, against the previous
// window of the same length.
const kpis = (html) =>
  [...html.matchAll(/<div class="an-kpi an-kpi--([\w]+)"><dt>([^<]+)<\/dt><dd class="an-kpi__value">(\d+)<\/dd>(?:<dd>(.*?)<\/dd>)?<\/div>/g)]
    .map(([, id, label, value, change]) => [id, label, Number(value), change === undefined ? null : stripTags(change)]);
assert.match(populated, /<section class="an-kpis" aria-label="Applications this period by stage">/);
const share = (percent) => `${percent}% of this period&#x27;s applications`;
assert.deepEqual(
  kpis(populated),
  [
    ["total", "Total applications", 1, "New, none in the previous 12 weeks"],
    ["applied", "Applied", 1, share(100)],
    ["interviewing", "Interviewing", 0, share(0)],
    ["offer", "Offer", 0, share(0)],
    ["ghosted", "Ghosted", 0, share(0)],
    ["rejected", "Rejected", 0, share(0)],
    ["withdrawn", "Withdrawn", 0, share(0)],
    ["not_applying", "Skipped", 0, share(0)]
  ],
  "only the total compares with the previous span; each stage shows its share, since older cohorts have had longer to be answered"
);
const older = { ...application, id: "older", company: "Older company", createdAt: daysAgo(100), appliedAt: daysAgo(100) };
const comparedHtml = report("", [application, older, { ...older, id: "older-2", status: "rejected" }]);
const compared = kpis(comparedHtml);
assert.deepEqual(compared[0], ["total", "Total applications", 1, "-50% vs the previous 12 weeks"], "one now against two before");
assert.deepEqual(compared[5], ["rejected", "Rejected", 0, share(0)], "the earlier rejections never colour this period");
const tone = (id) => new RegExp(`an-kpi--${id}"><dt>[^<]+</dt><dd class="an-kpi__value">\\d+</dd><dd><span class="([^"]+)"`).exec(comparedHtml)[1];
assert.equal(tone("total"), "an-kpi__change is-bad", "fewer applications sent is bad news");
assert.ok(["applied", "rejected", "ghosted"].every((id) => tone(id) === "an-kpi__change is-flat"), "stage shares carry no verdict");
assert.deepEqual(
  kpis(report("", [application, older, { ...older, id: "older-2" }, { ...application, id: "now-2" }, { ...application, id: "now-3" }]))[0],
  ["total", "Total applications", 3, "+50% vs the previous 12 weeks"]
);
const groups = withClass(openTags(populated, "dl"), "an-kpi-group");
assert.deepEqual(groups.map((group) => group.class), [
  "an-kpi-group is-single", "an-kpi-group", "an-kpi-group is-single is-ghosted", "an-kpi-group is-single", "an-kpi-group"
], "total, pipeline, Ghosted on its own, Rejected, and the applicant's own closures");

// Activity card: weekly by default, stacked by current stage.
assert.match(populated, /<h3 class="an-card__title" id="[^"]+">Application activity<\/h3>/);
assert.match(
  stripTags(/<p class="an-card__sub">(.*?)<\/p>/.exec(populated)[1]),
  /^1 application sent · 0\/1 replied · 0 reached interview$/,
  "under three sent, the reply rate is a fraction"
);
const unitSelect = selects(populated).find((select) => select.options.some((option) => option.value === "week"));
assert.deepEqual(unitSelect.options.map((option) => [option.value, option.text]), [["week", "Weekly"], ["month", "Monthly"]]);
assert.deepEqual(selectedValues(unitSelect), ["week"]);
assert.equal("disabled" in unitSelect, false, "a windowed period can switch to monthly");
const columns = withClass(buttons(populated), "an-col");
assert.equal(columns.length, 12, "twelve weekly columns, empty weeks included");
// Empty weeks are aria-disabled, not disabled: Firefox sends disabled buttons
// no pointer events, which would strand the previous column's tooltip.
assert.ok(columns.every((column) => !("disabled" in column)), "no column uses the disabled attribute");
const enabled = columns.filter((column) => column["aria-disabled"] !== "true");
assert.equal(enabled.length, 1, "only a week with sends opens");
assert.ok(columns.every((column) => column["aria-pressed"] === "false"), "no week is open at first");
assert.match(enabled[0]["aria-label"], /: 1 application, 1 Applied$/, "a column names its count and stages");
const segments = withClass(openTags(populated, "i"), "an-col__seg");
assert.equal(segments.length, 1, "one segment for the one application");
assert.ok(hasClass(segments[0], "an-stage--applied"), "segments take their stage's fill");
assert.deepEqual(
  [.../<ul class="an-legend" aria-label="Stages">(.*?)<\/ul>/.exec(populated)[1].matchAll(/<li>(.*?)<\/li>/g)].map(([, inner]) => stripTags(inner)),
  ["Applied", "Interviewing", "Offer", "Ghosted", "Rejected", "Withdrawn", "Skipped"],
  "the legend names every stage in the stacking order"
);
assert.match(populated, /<table class="sr-only"><caption>Applications sent per week by current stage<\/caption>/, "the chart has a table view");
assert.doesNotMatch(populated, /an-week__head/, "no week list until a column opens");

// Stage distribution: the period's applications, with shares and a filter key.
assert.match(populated, /<div class="an-stagekey" role="group" aria-label="Filter by stage">/);
const stageKeys = withClass(buttons(populated), "an-stagekey__item");
assert.deepEqual(
  stageKeys.map((button) => button.text),
  ["Applied1", "Interviewing0", "Offer0", "Ghosted0", "Rejected0", "Withdrawn0", "Skipped0"],
  "the key names every stage in the KPI order with its count; Drafts are not applications"
);
assert.ok(stageKeys.every((button) => button["aria-pressed"] === "false"), "no stage is selected at first");
assert.deepEqual(
  stageKeys.filter((button) => !("disabled" in button)).map((button) => button.text),
  ["Applied1"],
  "an empty stage cannot be selected"
);
assert.match(populated, /<div class="an-stagebar__shares"><span style="flex-grow:1">100%<\/span><\/div>/, "each segment carries its share");
assert.match(populated, /<p class="an-stagebar__total"><b>1<\/b> application<\/p>/);
assert.match(populated, /<div class="an-selection-region" role="status"><\/div>/, "the selection live region is mounted and empty");
assert.doesNotMatch(populated, /class="an-selection"|in Applications/, "no selection bar until a stage is chosen");

// No response callout: count, a way to the list, automatic checkbox.
assert.match(populated, />1 application may be ghosted<\/h3>/, "one candidate reads singular");
const markButton = (html) => buttons(html).find((button) => /Mark .*Ghosted/.test(button.text));
assert.equal(markButton(populated).text, "Mark 1 as Ghosted");
assert.equal("disabled" in markButton(populated) || "aria-disabled" in markButton(populated), false, "the bulk action is ready");
assert.equal(markButton(report("", [application], { pendingWrites: 1 }))["aria-disabled"], "true", "the bulk action waits for in-flight writes");
// The app's own checkbox row, not a toggle switch the rest of the app lacks.
const autoOf = (html) => {
  const match = /<label class="check-row an-callout__auto"[^>]*>(<input[^>]*>)<span>Mark automatically<\/span>/.exec(html);
  assert.ok(match, "automatic marking is a check-row checkbox");
  return openTags(match[1], "input")[0];
};
assert.equal(autoOf(populated).type, "checkbox");
assert.equal("checked" in autoOf(populated), false, "automatic marking reflects its prop");
assert.equal("checked" in autoOf(report("", [application], { autoMarkGhosted: true })), true);
assert.doesNotMatch(populated, /role="switch"/, "no custom switch");

const twoQuiet = report("", [application, { ...application, id: "synthetic-2", company: "Second company" }]);
assert.match(twoQuiet, />2 applications may be ghosted<\/h3>/, "several candidates read plural");
assert.equal(markButton(twoQuiet).text, "Mark 2 as Ghosted");

const longThreshold = report("", [application], { ghostedAfterDays: 90 });
assert.match(longThreshold, />Nothing waiting<\/h3>/);
assert.match(longThreshold, /Nothing quiet past 90 days\./, "a longer threshold empties the callout");
assert.equal(markButton(longThreshold), undefined, "nothing to mark");
assert.doesNotMatch(longThreshold, /Needs your attention/, "and no list");
assert.doesNotMatch(longThreshold, /Review applications/, "and nothing to review");
assert.ok(autoOf(longThreshold), "automatic marking stays available");

const autoMarked = report("", [application], { autoMarkedCount: 3 });
assert.match(autoMarked, /<p class="an-callout__note" role="status"><span>3 marked Ghosted automatically<\/span>/);
assert.ok(buttons(autoMarked).some((button) => button["aria-label"] === "Dismiss"), "the automatic note can be dismissed");
assert.doesNotMatch(populated, /marked Ghosted automatically/, "no count, no line");
assert.match(
  report("", [application], { trackerError: "Timeline is full." }),
  /<p class="pipeline-alert" role="alert">Timeline is full\.<\/p>/,
  "a refused mark explains itself beside the action"
);
assert.doesNotMatch(populated, /role="alert"/);

// Time without a response: 40 quiet days lands in 31–59, past a 21-day threshold.
assert.match(populated, />Time without a response<span class="an-card__hint" title="[^"]+">.*?<\/span><\/h3><span class="an-card__meta">1 awaiting reply<\/span>/);
const silenceRows = (html) =>
  [...html.matchAll(/<li( class="is-past")?><span class="an-silence__label">([^<]+)(?:<span class="sr-only">[^<]*<\/span>)?<\/span>.*?<b>(\d+)<\/b><\/li>/g)]
    .map(([, past, label, count]) => [label, Boolean(past), Number(count)]);
assert.deepEqual(
  silenceRows(populated),
  [
    ["0–7 days", false, 0],
    ["8–14 days", false, 0],
    ["15–20 days", false, 0],
    ["21–30 days", true, 0],
    ["31–59 days", true, 1],
    ["60+ days", true, 0]
  ],
  "the threshold is an edge, and bins from it on are past"
);
assert.equal(
  (populated.match(/<span class="sr-only"> \(past the No response threshold\)<\/span>/g) ?? []).length,
  3,
  "past bins say so in words, not only in colour"
);
assert.deepEqual(
  silenceRows(longThreshold).filter(([, past]) => past).map(([label]) => label),
  ["90+ days"],
  "a 90-day threshold becomes its own edge, and only from there is past"
);
const closedOnly = report("", [{ ...application, status: "rejected" }]);
assert.doesNotMatch(closedOnly, /Time without a response/, "no open records, no silence card");
assert.match(closedOnly, />Nothing waiting<\/h3>/);

// Needs your attention: the bulk action heads its own selection, each row has
// an inferred status, a next step, and a menu; the callout leads there.
assert.match(populated, /<section class="an-card an-attention" aria-labelledby="[^"]+"><header class="an-card__head an-attention__head"><h3 class="an-card__title"[^>]*tabindex="-1">Needs your attention <span class="an-count-pill">1<\/span><\/h3>/);
assert.ok(buttons(populated).some((button) => button.text.trim() === "Review applications"), "the callout leads to the list");
const headActions = /<div class="an-attention__actions">(.*?)<\/div>/.exec(populated)?.[1] ?? "";
assert.match(headActions, /Mark 1 as Ghosted/, "the Mark button is in the list header");
assert.doesNotMatch(headActions, /View all/, "every row already shows");
const inputs = openTags(populated, "input");
const allBox = inputs.find((input) => input["aria-label"] === "Select all shown");
assert.ok(allBox && "checked" in allBox, "a checked Select all heads the list");
const rowBoxes = inputs.filter((input) => input["aria-label"]?.startsWith("Select ") && input !== allBox);
assert.deepEqual(rowBoxes.map((input) => input["aria-label"]), ["Select Example company, Example role"]);
assert.ok(rowBoxes.every((input) => input.type === "checkbox" && "checked" in input), "every candidate starts selected");
assert.match(populated, /<span class="an-attention__days" title="Last activity [^"]+">4[01]<span class="sr-only"> days quiet<\/span><\/span>/, "each row shows its quiet days");
assert.equal((populated.match(/class="an-attention__date"/g) ?? []).length, 1, "each row shows its applied date");
assert.match(populated, /<span class="an-attention__status"><span class="an-pill">No response<\/span><\/span>/, "the status is the derived one");
assert.match(populated, /<span class="an-attention__next">Send a follow-up<\/span>/, "no follow-up sent yet");
assert.match(
  report("", [{ ...application, stageHistory: [{ id: "f1", type: "followup", at: daysAgo(30) }] }]),
  /<span class="an-attention__next">Consider Ghosted<\/span>/,
  "after a follow-up that went unanswered, Ghosted is the next step"
);
assert.match(
  report("", [{
    ...application,
    stageHistory: [{ id: "f1", type: "followup", at: daysAgo(35) }, { id: "r1", type: "response", at: daysAgo(30) }]
  }]),
  /<span class="an-attention__next">Send a follow-up<\/span>/,
  "a follow-up the employer already answered does not make Ghosted the next step"
);
const menuButton = buttons(populated).find((button) => button["aria-label"] === "Actions for Example company");
assert.ok(menuButton, "each row has an actions menu");
assert.equal(menuButton["aria-haspopup"], "menu");
assert.equal(menuButton["aria-expanded"], "false");
assert.doesNotMatch(populated, /role="menu"/, "the menu is closed at first");

// Coming up: one dated list; an open record without a follow-up is counted.
assert.match(populated, /<section class="an-card an-upcoming" aria-labelledby="[^"]+">/);
assert.match(populated, /No interviews scheduled or follow-ups due this week\./);
assert.match(populated, /<p class="an-upcoming__foot"><span><b>1<\/b> open without a follow-up date<\/span><\/p>/);
// Local noon three calendar days on, so a DST night cannot make it four.
const inThreeDays = (() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 12).toISOString(); })();
const planned = report("", [{ ...application, followupAt: inThreeDays }]);
const upcomingRow = stripTags(/<ul class="an-upcoming__list">(.*?)<\/ul>/.exec(planned)?.[1] ?? "");
assert.match(upcomingRow, /Example company.*Example role.*Follow up.*In 3 d/, "a planned follow-up is a dated row");
assert.doesNotMatch(planned, /Needs your attention/, "and a planned follow-up holds the No response list");

console.log("Page loading markup and Analytics settled-state probes passed.");
