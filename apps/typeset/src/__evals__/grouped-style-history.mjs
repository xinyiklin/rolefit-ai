// Offline source probe: Typeset's document-alignment gesture changes content
// (clears per-paragraph overrides) and style (the new default) on one history
// clock, so it must run as one grouped step. The shared package eval
// (packages/editor/src/hooks/__evals__/grouped-history.mjs) drives this exact
// composition through the real hooks; this guards the host wiring.
//
//   node src/__evals__/grouped-style-history.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

assert.match(
  app,
  /onGlobalAlignmentChange=\{\(scope, alignment\) => \{[\s\S]{0,120}?docStyle\.groupHistory\(\(\) => \{\s*editor\.actions\.clearAlignmentOverrides\(scope\);[\s\S]{0,320}?docStyle\.set\("headingAlign"[^\n]*\n\s*\}\);/,
  "clearing alignment overrides and setting the default run as one grouped gesture"
);
assert.match(
  app,
  /const docStyle = useDocStyle\(historyClock\);/,
  "content and style share the clock the group runs on"
);

console.log("grouped style history probe passed");
