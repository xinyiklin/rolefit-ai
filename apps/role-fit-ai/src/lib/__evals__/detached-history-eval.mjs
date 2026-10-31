// Narrow-window toolbar undo/redo (the Typeset editor unmounted) follows the
// editor's own rule: a grouped gesture moves content and style together, and
// otherwise the newer source moves first.
import assert from "node:assert/strict";
import { commitDetachedHistory } from "../detachedHistory.ts";

function sources(content, style) {
  const calls = [];
  const make = (name, { undo = null, redo = null }) => ({
    undoSequence: undo,
    redoSequence: redo,
    undo: () => calls.push(`${name}:undo`),
    redo: () => calls.push(`${name}:redo`)
  });
  return { calls, content: make("content", content), style: make("style", style) };
}

const run = (direction, content, style) => {
  const s = sources(content, style);
  commitDetachedHistory(direction, s.content, s.style);
  return s.calls;
};

assert.deepEqual(run("undo", { undo: 5 }, { undo: 5 }), ["style:undo", "content:undo"], "a grouped step undoes both halves");
assert.deepEqual(run("redo", { redo: 5 }, { redo: 5 }), ["style:redo", "content:redo"], "a grouped step redoes both halves");
assert.deepEqual(run("undo", { undo: 3 }, { undo: 4 }), ["style:undo"], "a newer style step undoes style only");
assert.deepEqual(run("undo", { undo: 4 }, { undo: 3 }), ["content:undo"], "a newer content step undoes content only");
assert.deepEqual(run("redo", { redo: 4 }, { redo: 3 }), ["style:redo"], "redo takes the older step first");
assert.deepEqual(run("redo", { redo: 3 }, { redo: 4 }), ["content:redo"]);
assert.deepEqual(run("undo", {}, { undo: 2 }), ["style:undo"], "style alone");
assert.deepEqual(run("undo", { undo: 2 }, {}), ["content:undo"], "content alone");
assert.deepEqual(run("undo", {}, {}), [], "nothing to undo does nothing");

console.log("Detached history eval passed");
