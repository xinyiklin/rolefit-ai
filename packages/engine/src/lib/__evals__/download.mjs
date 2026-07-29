// Browser-download lifecycle guard.
// Run: node --experimental-strip-types src/lib/__evals__/download.mjs

import assert from "node:assert/strict";

import {
  DOWNLOAD_OBJECT_URL_CLEANUP_DELAY_MS,
  downloadBlob
} from "../download.ts";

const calls = [];
let cleanup;
let cleanupDelay;
const link = {
  href: "",
  download: "",
  hidden: false,
  click() {
    calls.push("click");
  },
  remove() {
    calls.push("remove");
  }
};

globalThis.URL = {
  createObjectURL(blob) {
    assert.equal(blob.type, "application/pdf");
    calls.push("create");
    return "blob:https://rolefit.test/temporary-id";
  },
  revokeObjectURL(url) {
    calls.push(`revoke:${url}`);
  }
};
globalThis.document = {
  createElement(tagName) {
    assert.equal(tagName, "a");
    calls.push("element");
    return link;
  },
  body: {
    append(node) {
      assert.equal(node, link);
      calls.push("append");
    }
  }
};
globalThis.window = {
  setTimeout(callback, delay) {
    cleanup = callback;
    cleanupDelay = delay;
    calls.push("schedule");
    return 1;
  }
};

downloadBlob(
  new Blob(["%PDF-1.7"], { type: "application/pdf" }),
  "Candidate_Resume.pdf"
);

assert.equal(link.href, "blob:https://rolefit.test/temporary-id");
assert.equal(link.download, "Candidate_Resume.pdf");
assert.equal(link.hidden, true);
assert.deepEqual(calls, ["create", "element", "append", "click", "schedule"]);
assert.equal(cleanupDelay, DOWNLOAD_OBJECT_URL_CLEANUP_DELAY_MS);
assert.equal(typeof cleanup, "function");

cleanup();
assert.deepEqual(calls, [
  "create",
  "element",
  "append",
  "click",
  "schedule",
  "remove",
  "revoke:blob:https://rolefit.test/temporary-id"
]);

console.log(
  `Download handoff passed: filename retained for ${DOWNLOAD_OBJECT_URL_CLEANUP_DELAY_MS} ms before cleanup.`
);
