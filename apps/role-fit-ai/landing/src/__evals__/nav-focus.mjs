// In-page navigation moves keyboard focus with the view: a header "Download"
// button that only scrolled left focus in the header, so keyboard and
// screen-reader users never reached the section the page showed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../landing.css", import.meta.url), "utf8");
assert.ok(
  main.includes('if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");\n  target.focus({ preventScroll: true });'),
  "every scroll target takes focus without a second scroll"
);
assert.ok(!main.includes('if (id === "main") {'), "focus is not limited to the main landmark");
assert.ok(css.includes('section[tabindex="-1"]:focus-visible'), "a section focused this way draws no outline box");
console.log("landing nav focus: passed");
