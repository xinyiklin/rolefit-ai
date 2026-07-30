import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import React from "react";
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

const rendered = StyleRange({
  id: "header-gap",
  label: "Header gap",
  value: 4,
  min: 0,
  max: 12,
  step: 0.1,
  displayValue: "4 pt",
  disabled: true,
  onChange() {
    throw new Error("a disabled slider must not emit changes");
  }
});
const input = React.Children.toArray(rendered.props.children).find(
  (child) => child?.type === "input"
);
assert.equal(input?.props.disabled, true, "the native range input receives the host disabled state");

console.log("editor component probes: PASS");
