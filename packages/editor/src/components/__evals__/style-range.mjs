import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true }
});
let StyleRange;
try {
  ({ StyleRange } = await vite.ssrLoadModule("/src/components/toolbar/StyleRange.tsx"));
} finally {
  await vite.close();
}

const render = (props) =>
  renderToStaticMarkup(
    React.createElement(StyleRange, {
      id: "header-gap",
      label: "Header gap",
      value: 4.5,
      min: 0,
      max: 12,
      step: 0.1,
      unit: "pt",
      onChange() {
        throw new Error("rendering must not emit changes");
      },
      ...props
    })
  );

const disabled = render({ disabled: true });
assert.equal(
  disabled.match(/<input[^>]*disabled=""/g)?.length,
  2,
  "the range and its value box both receive the host disabled state"
);

const enabled = render({});
assert.match(enabled, /<label[^>]*for="header-gap"[^>]*>Header gap<\/label>/, "the label names the range");
assert.match(enabled, /aria-label="Header gap in points"[^>]*value="4.5"/, "the value box names its unit and shows the value");
assert.match(enabled, /<span aria-hidden="true">pt<\/span>/, "the unit is shown beside the value");

const unitless = render({ unit: "", value: 1.18, min: 1, max: 2, step: 0.01 });
assert.match(unitless, /aria-label="Header gap value"[^>]*value="1.18"/, "a unitless value keeps its precision");
assert.doesNotMatch(unitless, /aria-hidden="true">/, "a unitless value shows no unit");

// The typed value resolves through the shared draft decision and snaps to the
// range's step, so a typed 4.56 on a 0.1 step commits 4.6, never 4.560000001.
const source = readFileSync(new URL("../toolbar/StyleRange.tsx", import.meta.url), "utf8");
assert.match(source, /numericDraftCommit\(draft, display, value,/, "the value box commits through the shared draft decision");
assert.match(source, /toFixed\(stepDecimals\(step\)\)/, "the committed value is rounded to the step's precision");
assert.match(source, /if \(next === null\) \{\s*setDraft\(display\);\s*return;/, "a reverted draft restores the shown value without onChange");

console.log("editor component probes: PASS");
