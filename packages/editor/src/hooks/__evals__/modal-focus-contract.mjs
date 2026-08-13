import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../useModalFocus.ts", import.meta.url), "utf8");
const focusFirstStart = source.indexOf("const focusFirst = useCallback");
const focusFirstEnd = source.indexOf("useEffect(() => {", focusFirstStart);
assert.ok(focusFirstStart >= 0 && focusFirstEnd > focusFirstStart, "the focus-first probe is bounded");
const focusFirst = source.slice(focusFirstStart, focusFirstEnd);
const restoreFocusStart = source.indexOf("function restoreFocus");
const restoreFocusEnd = source.indexOf("function preferredReturnFocus", restoreFocusStart);
assert.ok(
  restoreFocusStart >= 0 && restoreFocusEnd > restoreFocusStart,
  "the restore-focus probe is bounded"
);
const restoreFocus = source.slice(restoreFocusStart, restoreFocusEnd);

assert.match(
  source,
  /function isUsableFocusTarget\([\s\S]{0,260}?isConnected[\s\S]{0,260}?FOCUSABLE_SELECTOR/,
  "modal focus validates that a preferred target is still connected and focusable"
);
assert.match(source, /element\.tabIndex >= 0/, "modal focus ignores controls removed from tab order");
assert.match(source, /!element\.matches\(":disabled"\)/, "modal focus rejects inherited disabled state");
assert.match(
  source,
  /!element\.closest\(['"]\[inert\], \[aria-hidden=[^)]*true[^)]*\]['"]\)/,
  "modal focus rejects controls hidden by an inert or aria-hidden ancestor"
);
assert.match(
  focusFirst,
  /isUsableFocusTarget\(preferred\)[\s\S]{0,160}?visibleFocusable\(container\)\[0\][\s\S]{0,80}?container/,
  "a disabled preferred control falls back to another visible control or the dialog container"
);
assert.match(focusFirst, /target\.focus\(\)/, "modal activation places focus inside the dialog");
assert.match(
  source,
  /function restoreFocus\([\s\S]{0,300}?visibleFocusable\(document\.body\)\[0\]/,
  "a removed trigger falls back to a visible document control"
);
assert.match(restoreFocus, /\.focus\(\)/, "modal cleanup restores focus");
assert.match(
  source,
  /function preferredReturnFocus\([\s\S]{0,300}?isUsableFocusTarget\(previouslyFocused\) \? previouslyFocused : fallback/,
  "a still-mounted trigger wins over the persistent fallback"
);
assert.equal(source.match(/restoreFocus\(/g)?.length, 3, "both modal cleanup paths restore focus");
assert.match(
  source,
  /document\.activeElement[\s\S]{0,260}?container\.contains\(current\)[\s\S]{0,220}?focusFirst\(\)/,
  "a render that disables the focused control moves focus to the dialog fallback"
);

console.log("Modal focus contract passed");
