import assert from "node:assert/strict";

import { commitDocumentSaveBaseline } from "../documentSaveBaseline.ts";

const calls = [];
commitDocumentSaveBaseline(
  () => calls.push("content"),
  () => calls.push("style")
);
assert.deepEqual(
  calls,
  ["content", "style"],
  "one durable save baseline marks both document content and print style clean"
);

console.log("Typeset document save baseline: PASS");
