import assert from "node:assert/strict";

import { inlineMarksToHtml } from "../inlineMarksHtml.ts";

const rendered = inlineMarksToHtml(
  '<b>Grounded</b> <img src=x onerror="alert(1)"> <script>alert(2)</script> & safe\n<i>detail</i>'
);

assert.match(rendered, /^<strong>Grounded<\/strong>/, "the persisted mark grammar renders semantic tags");
assert.ok(!rendered.includes("<img"), "untrusted HTML elements never reach the sink");
assert.ok(!rendered.includes("<script"), "script elements never reach the sink");
assert.ok(rendered.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"), "untrusted markup is visible as escaped text");
assert.ok(rendered.includes("&amp; safe<br><em>detail</em>"), "entities, line breaks, and allowed emphasis round-trip");

console.log("PASS inline mark HTML boundary");
