import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(
  new URL("../../../styles/application-pages.css", import.meta.url),
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

console.log("tracker inspector layout contract: passed");
