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
      export function report(loadError, applications = []) {
        return renderToStaticMarkup(<AnalyticsTab applications={applications} loadError={loadError} onOpenApplications={() => {}} />);
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

for (const html of [table, calendar, analytics]) {
  assert.equal((html.match(/role="status"/g) ?? []).length, 1, "one loading announcement");
  assert.doesNotMatch(html, /<(button|input|select|a)\b|tabindex=/i, "no fake interactive controls");
  assert.match(html, /aria-hidden="true"/, "decorations are hidden from assistive technology");
  assert.doesNotMatch(html, /No submitted applications|Prepare and apply to roles/, "pending does not claim empty data");
}

const failure = report("Synthetic load failure");
assert.match(failure, /Synthetic load failure/);
assert.match(failure, /Open Applications to retry/);
assert.doesNotMatch(failure, /Analytics summary|No submitted applications/, "failure is not a zero-data report");
assert.match(report(""), /No submitted applications yet/, "settled empty data retains real empty guidance");
const populated = report("", [{
  id: "synthetic", title: "Example role", company: "Example company", status: "applied",
  createdAt: "2026-09-04T12:00:00Z", appliedAt: "2026-09-04T12:00:00Z", jobUrl: ""
}]);
assert.match(populated, /Example company/);
assert.doesNotMatch(populated, /No submitted applications yet|Loading analytics/);
console.log("Page loading markup and Analytics settled-state probes passed.");
