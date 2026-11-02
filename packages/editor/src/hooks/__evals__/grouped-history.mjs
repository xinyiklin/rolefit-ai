// One gesture that changes both content and document style is one history
// step: one undo reverts both parts, one redo reapplies both, and no press
// lands on a state the user never saw. Drives the real shared hooks
// (useResumeEditor + useDocStyle on one clock, Typeset's composition) through a
// minimal React stand-in whose useReducer applies queued actions at render, as
// React does, so the group must survive the gesture returning before reduce.
// Run: node --experimental-strip-types src/hooks/__evals__/grouped-history.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const reactStandIn = `
let slots = [];
let cursor = 0;
export function resetHooks() { slots = []; }
export function render(component) { cursor = 0; return component(); }
export function useReducer(reducer, initialArg, init) {
  const index = cursor++;
  if (!(index in slots)) {
    const slot = { state: init ? init(initialArg) : initialArg, queue: [] };
    slot.dispatch = (action) => { slot.queue.push(action); };
    slots[index] = slot;
  }
  const slot = slots[index];
  for (const action of slot.queue.splice(0)) {
    reducer(slot.state, action);
    slot.state = reducer(slot.state, action);
  }
  return [slot.state, slot.dispatch];
}
export function useState(initial) {
  const index = cursor++;
  if (!(index in slots)) {
    const slot = { value: typeof initial === "function" ? initial() : initial };
    slot.set = (next) => { slot.value = typeof next === "function" ? next(slot.value) : next; };
    slots[index] = slot;
  }
  return [slots[index].value, slots[index].set];
}
export function useRef(initial) {
  const index = cursor++;
  if (!(index in slots)) slots[index] = { current: initial };
  return slots[index];
}
export function useMemo(factory, deps) {
  const index = cursor++;
  const slot = slots[index];
  if (slot && deps.length === slot.deps.length && deps.every((dep, at) => Object.is(dep, slot.deps[at]))) {
    return slot.value;
  }
  slots[index] = { value: factory(), deps };
  return slots[index].value;
}
export function useCallback(callback, deps) { return useMemo(() => callback, deps); }
export function useEffect() { cursor++; }
export function useSyncExternalStore(subscribe, getSnapshot) { cursor++; return getSnapshot(); }
`;
const reactUrl = `data:text/javascript,${encodeURIComponent(reactStandIn)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react") return { url: reactUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  }
});

const { render, resetHooks } = await import("react");
const { rootReducer, useResumeEditor } = await import("../useResumeEditor.ts");
const { styleReducer, useDocStyle } = await import("../useDocStyle.ts");
const { createHistoryClock, historySourceFor } = await import("../historyClock.ts");
const { DOC_STYLE_DEFAULTS, TEXT_STYLE_DEFAULTS } = await import("@typeset/engine/lib/documentStyle.ts");
const { newSection } = await import("@typeset/engine/lib/resumeData.ts");

const CENTERED = "<align=center>Centered summary</align>";

function centeredResume() {
  const section = newSection("summary", "Summary");
  section.items[0].bullets[0].text = CENTERED;
  return { header: null, sections: [section] };
}

// Typeset's App: both hooks share the clock the host creates.
function mountTypeset() {
  resetHooks();
  const clock = createHistoryClock();
  const initial = centeredResume();
  const app = () => render(() => ({
    editor: useResumeEditor(initial, clock),
    docStyle: useDocStyle(clock)
  }));
  return app;
}

// TypesetEditor's commitHistory: pick the source(s) by sequence, then move them.
function press(app, direction) {
  const { editor, docStyle } = app();
  const source = historySourceFor(
    direction,
    direction === "undo" ? editor.undoSequence : editor.redoSequence,
    direction === "undo" ? docStyle.undoSequence : docStyle.redoSequence
  );
  if (source === "style" || source === "both") docStyle[direction]();
  if (source !== "style") editor.actions[direction]();
  return { source, ...app() };
}

const summaryText = ({ editor }) => editor.editedResume.sections[0].items[0].bullets[0].text;

// Typeset's onGlobalAlignmentChange: clear the overrides, then set the default.
{
  const app = mountTypeset();
  const before = app();
  assert.equal(summaryText(before), CENTERED);
  assert.equal(before.docStyle.style.bodyAlign, "left");

  before.docStyle.groupHistory(() => {
    before.editor.actions.clearAlignmentOverrides("body");
    before.docStyle.set("bodyAlign", "justify");
  });
  const after = app();
  assert.equal(summaryText(after), "Centered summary", "the gesture clears the paragraph override");
  assert.equal(after.docStyle.style.bodyAlign, "justify", "the gesture sets the document default");
  assert.equal(after.editor.undoSequence, after.docStyle.undoSequence, "both parts share one history step");

  const undone = press(app, "undo");
  assert.equal(undone.source, "both", "one undo moves content and style together");
  assert.equal(undone.docStyle.style.bodyAlign, "left", "one undo restores the old default");
  assert.equal(summaryText(undone), CENTERED, "the same undo restores the centered paragraph");
  assert.equal(undone.editor.canUndo || undone.docStyle.canUndo, false, "no second undo is left for the gesture");

  const redone = press(app, "redo");
  assert.equal(redone.source, "both", "one redo moves content and style together");
  assert.equal(redone.docStyle.style.bodyAlign, "justify", "one redo reapplies the default");
  assert.equal(summaryText(redone), "Centered summary", "the same redo clears the override again");
  assert.equal(redone.editor.canRedo || redone.docStyle.canRedo, false, "no second redo is left for the gesture");
}

// TextStylesPopover's Reset text formatting: style defaults plus the host's
// per-field reset, here wrapped by the popover (the host adds no group).
{
  const app = mountTypeset();
  let view = app();
  view.editor.actions.setStyleFieldSize("body", 12.5);
  view = app();
  view.docStyle.set("sectionRule", false);
  const formatted = app();
  const formattedText = summaryText(formatted);
  assert.notEqual(formattedText, CENTERED, "setup sized the body text");
  assert.equal(formatted.docStyle.style.sectionRule, false);

  formatted.docStyle.groupHistory(() => {
    formatted.docStyle.applyStyle(TEXT_STYLE_DEFAULTS);
    formatted.editor.actions.resetStyleFieldFormatting();
  });
  const reset = app();
  assert.equal(reset.docStyle.style.sectionRule, true, "reset restores the text-style defaults");
  assert.equal(summaryText(reset), CENTERED, "reset clears the per-field size");
  assert.equal(reset.editor.undoSequence, reset.docStyle.undoSequence, "both parts share one history step");

  const undone = press(app, "undo");
  assert.equal(undone.source, "both");
  assert.equal(undone.docStyle.style.sectionRule, false, "one undo restores the custom style");
  assert.equal(summaryText(undone), formattedText, "the same undo restores the per-field size");

  const redone = press(app, "redo");
  assert.equal(redone.source, "both");
  assert.equal(redone.docStyle.style.sectionRule, true, "one redo reapplies the defaults");
  assert.equal(summaryText(redone), CENTERED, "the same redo clears the per-field size again");

  // The setup steps before the gesture are still separate and in order.
  const firstUndo = press(app, "undo");
  assert.equal(firstUndo.source, "both");
  const styleSetup = press(app, "undo");
  assert.equal(styleSetup.source, "style", "the earlier style edit is its own step");
  assert.equal(styleSetup.docStyle.style.sectionRule, true);
  const contentSetup = press(app, "undo");
  assert.equal(contentSetup.source, "content", "the earlier content edit is its own step");
  assert.equal(summaryText(contentSetup), CENTERED);
}

// A no-op member leaves an ordinary one-source step, and an ungrouped pair of
// dispatches still records two steps (existing behavior is unchanged).
{
  const app = mountTypeset();
  let view = app();
  view.docStyle.groupHistory(() => {
    view.editor.actions.clearAlignmentOverrides("header");
    view.docStyle.set("headerAlign", "left");
  });
  view = app();
  assert.equal(view.editor.canUndo, false, "a member with nothing to change records nothing");
  assert.equal(press(app, "undo").source, "style");

  const fresh = mountTypeset();
  view = fresh();
  view.editor.actions.clearAlignmentOverrides("body");
  view.docStyle.set("bodyAlign", "justify");
  view = fresh();
  assert.notEqual(view.editor.undoSequence, view.docStyle.undoSequence, "ungrouped dispatches stay separate steps");
  assert.equal(press(fresh, "undo").source, "style");
  assert.equal(press(fresh, "undo").source, "content");
}

// Reducer-level checks on the clock itself.
const contentSeed = (clock) =>
  rootReducer(
    { data: null, dirty: false, past: [], future: [], coalesceKey: null, coalesceAt: 0, coalesceEdge: null, coalesceCount: 0 },
    { type: "seed", data: centeredResume() },
    clock
  );
const styleSeed = () => ({ style: { ...DOC_STYLE_DEFAULTS }, past: [], future: [], coalesceKey: null, coalesceAt: 0 });

{
  // Reduce order does not matter: whichever member runs first allocates.
  const clock = createHistoryClock();
  const seeded = contentSeed(clock);
  let style = styleSeed();
  let clear;
  let align;
  clock.group(() => {
    clear = clock.stamp({ type: "clearAlignmentOverrides", scope: "body" });
    align = clock.stamp({ type: "set", key: "bodyAlign", value: "justify" });
  });
  style = styleReducer(style, align, clock);
  const content = rootReducer(seeded, clear, clock);
  assert.equal(content.past.at(-1).sequence, style.past.at(-1).sequence, "style-first reduce still shares the step");

  // Strict Mode double invocation stays idempotent.
  const again = rootReducer(seeded, clear, clock);
  assert.equal(again.past.at(-1).sequence, content.past.at(-1).sequence);

  // A grouped style step never coalesces with a following same-key edit.
  const next = styleReducer(style, { type: "set", key: "bodyAlign", value: "center" }, clock);
  assert.equal(next.past.length, 2, "an edit after a grouped step is its own step");

  // Ungrouped same-key style edits still coalesce.
  const run = styleReducer(next, { type: "set", key: "bodyAlign", value: "right" }, clock);
  assert.equal(run.past.length, 2, "ordinary style coalescing is unchanged");

  // Nested groups join the outer gesture.
  let inner;
  let outer;
  clock.group(() => {
    outer = clock.stamp({ type: "undo" });
    clock.group(() => {
      inner = clock.stamp({ type: "undo" });
    });
  });
  assert.equal(inner.historyGroup, outer.historyGroup);
  assert.equal(clock.stamp({ type: "undo" }).historyGroup, undefined, "nothing is stamped outside a gesture");
}

{
  // A new edit after undoing a group invalidates redo for both sources.
  const app = mountTypeset();
  let view = app();
  view.docStyle.groupHistory(() => {
    view.editor.actions.clearAlignmentOverrides("body");
    view.docStyle.set("bodyAlign", "justify");
  });
  press(app, "undo");
  view = app();
  view.docStyle.set("lineHeight", 1.4);
  app();
  // The clock's branch subscription re-renders the content hook React-side.
  view = app();
  assert.equal(view.editor.canRedo || view.docStyle.canRedo, false, "a new transaction clears both redo stacks");
}

// The editor's undo path is the one mirrored above.
const editorSource = readFileSync(new URL("../../sections/editor/TypesetEditor.tsx", import.meta.url), "utf8");
assert.match(
  editorSource,
  /const source = historySourceFor\(direction, contentSequence, styleSequence\);[\s\S]{0,120}?source === "style" \|\| source === "both"[\s\S]{0,160}?if \(source === "style"\) return;/,
  "commitHistory moves style for a style or grouped step and returns only for style alone"
);
const popoverSource = readFileSync(new URL("../../components/toolbar/TextStylesPopover.tsx", import.meta.url), "utf8");
assert.match(
  popoverSource,
  /docStyle\.groupHistory\(\(\) => \{\s*docStyle\.applyStyle\(TEXT_STYLE_DEFAULTS\);\s*onResetStyleFormatting\?\.\(\);\s*\}\)/,
  "Reset text formatting groups the style defaults with the host's per-field reset"
);

console.log("grouped history probes passed");
