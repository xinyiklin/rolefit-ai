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

// A close handler that already moved focus out (Custom spacing returns it to the
// editor selection) keeps it: the trap must not pull it back mid-close, and
// cleanup must not replace it with the opener or the first page control.
const { focusMovedOutside } = await import("../useModalFocus.ts");
const ownerDocument = { body: null };
const body = { isConnected: true, ownerDocument };
ownerDocument.body = body;
const inside = { isConnected: true, ownerDocument };
const editor = { isConnected: true, ownerDocument };
const detached = { isConnected: false, ownerDocument };
const dialog = { contains: (node) => node === inside };
assert.equal(focusMovedOutside(editor, dialog), true, "focus moved to a live control outside the dialog is kept");
assert.equal(focusMovedOutside(editor, null), true, "an unmounted dialog still keeps focus that moved elsewhere");
assert.equal(focusMovedOutside(body, null), false, "focus that fell back to the body is restored");
assert.equal(focusMovedOutside(detached, null), false, "focus on a removed element is restored");
assert.equal(focusMovedOutside(inside, dialog), false, "focus still inside a deactivated dialog is restored");
assert.equal(focusMovedOutside(null, dialog), false, "no active element is restored");

const trapStart = source.indexOf("function keepFocusInside");
const trap = source.slice(trapStart, source.indexOf('document.addEventListener("focusin", keepFocusInside)', trapStart));
assert.match(
  trap,
  /queueMicrotask\(\(\) => \{[\s\S]{0,200}?isTopmost\(\)[\s\S]{0,200}?focusFirst\(\)/,
  "the focus trap re-checks after the current task, so a close that moves focus out is not undone"
);
assert.match(
  source,
  /modalStack\.length === 0\)[\s\S]{0,200}?if \(!focusMovedOutside\(document\.activeElement, containerRef\.current\)\)[\s\S]{0,40}?restoreFocus\(/,
  "closing the last modal restores focus only when nothing else took it"
);

console.log("Modal focus contract passed");
