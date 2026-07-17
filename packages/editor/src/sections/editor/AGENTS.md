# Direct Editor Guide

Applies to `src/sections/editor/`. Follow the repository root guide and the
typesetting guide when a change affects painted output or layout provenance.

## Module Ownership

- `TypesetEditor.tsx` composes the direct-editing controller. It owns selection
  state, typing-format state, mutation primitives, repaint/caret restoration,
  and the public imperative editing API. The commit primitives stay in this
  file deliberately: they share the pending-caret, typing-format, and
  commit-gate refs with the restore/replay effect, and extracting them would
  thread a dozen refs through a hook seam without isolating anything (their
  pure math already lives in `inlineTextEditing.ts`).
- `inlineTextEditing.ts` owns pure value/display mapping and mark-balanced text
  transformations. Keep it free of React and DOM reads. Its anchored tag
  scanner is a deliberate second automaton over the grammar owned by
  `lib/inlineMarksText.ts`; keep the two tag inventories in sync.
- `domSelection.ts` translates between DOM caret positions and display indexes,
  and owns the caret/line DOM geometry helpers (line lookup, caret placement,
  click-to-caret) plus `keyOfNode`.
- `resumeFieldAdapter.ts` maps one-field editor values to the structured
  resume domain: reads (`valueForField`), commits (`commitField`), and the
  pure render-overlay write (`withFieldValue`).
- `useTypesetInputEvents.ts` intercepts browser input and keyboard intents.
- `useTypesetStructure.ts` owns add/remove/reorder commands and drag state.
- `useTypesetOverlayAnchors.ts` owns overlay geometry: page origins inside the
  wrapper, pointer-hover block targeting, and the caret-active field anchor.
- `typesetStructure.ts` derives pure anchors, extents, and drop slots from the
  engine layout.
- `TypesetStructureOverlay.tsx` paints drag affordances outside the editable DOM.
- `useTypesetContextMenu.tsx` builds contextual document commands from a
  captured editor selection; `TypesetContextMenu.tsx` only renders the menu.

## Editing Invariants

- The engine-painted DOM is the editing surface, but the browser never commits
  mutations directly. Prevent the native edit, transform the serialized field,
  dispatch a structured action, repaint, and restore the caret.
- Keep display indexes and serialized-value indexes explicit. Inline tags are
  value-space metadata and must remain balanced across insert, delete, split,
  merge, copy, paste, undo, and redo.
- Preserve authored interior and trailing whitespace. Deleting the final styled
  character must retain that character's typing format for the next insertion.
- Selections may cross fields for native copy behavior, but formatting and text
  mutations operate on one mapped field at a time.
- Structure controls stay outside `contenteditable`; position them from engine
  provenance and geometry so controls never alter page layout or PDF output.
- Keep structural actions in the reducer/history path. A pointer drag, keyboard
  move, context command, or Enter/Backspace edit must remain one undoable action.
- Use refs for transient selection, replay, drag, and caret state that changes on
  hot input paths; derive visible toolbar state instead of duplicating it.

## Verification

1. Run `npm run eval:editor` after value/display, whitespace, deletion-format,
   selection, or drag-hit-area changes.
2. Run `npm run build` after component, hook, or action-contract changes.
3. Check direct typing, trailing spaces, delete-and-retype formatting, range
   formatting, undo/redo, right-click commands, drag, and keyboard reorder in a
   real browser for material editor work.
4. Confirm edits repaint through the shared engine and remain aligned with the
   print/PDF path; do not add an editor-only layout approximation.
