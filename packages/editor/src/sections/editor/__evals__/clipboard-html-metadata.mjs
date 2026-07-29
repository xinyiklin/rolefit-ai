import assert from "node:assert/strict";

import { parsedClipboardHtml } from "../clipboardHtmlImport.ts";

assert.deepEqual(
  parsedClipboardHtml("<b>One rich paragraph</b>", true),
  {
    inlineValue: "<b>One rich paragraph</b>",
    blocks: ["<b>One rich paragraph</b>"],
    sawBlockStructure: true
  },
  "a single rich block stays structural even after its trailing separator is cleaned up"
);
assert.deepEqual(
  parsedClipboardHtml("<b>Inline only</b>", false),
  {
    inlineValue: "<b>Inline only</b>",
    blocks: null,
    sawBlockStructure: false
  },
  "inline-only HTML remains a non-structural fragment"
);

console.log("clipboard HTML metadata probes: PASS");
