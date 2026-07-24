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
- `clipboardFormatting.ts` owns the versioned same-editor clipboard payload and
  the allowlisted HTML-to-inline-mark sanitizer. Keep arbitrary clipboard CSS,
  scripts, event attributes, unsupported fonts, and invalid links out of
  document state.
- `selectionHighlight.ts` owns the visual selection overlay. It coalesces the
  browser range fragments per engine line and paints one highlight using that
  line's full height, which is determined by its largest inline run.
- `caretOverlay.ts` maps a collapsed logical selection onto the engine line's
  exposed baseline and the browser-measured active font face. The resulting
  caret remains visible while editor toolbar controls own focus and reflects
  next-typing family, emphasis, and size without entering document state.
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
- Tab inserts four authored spaces inside a clean field. Shift+Tab remains
  available to leave the contenteditable surface. Ctrl/Cmd +/- steps document
  zoom and Ctrl/Cmd 0 resets it to 100%.
- Copy writes plain text, safe HTML, and the private versioned inline fragment;
  paste prefers that fragment, then sanitized HTML, then plain text. Supported
  family, size, emphasis, underline, link, and alignment runs must survive a
  same-editor round trip.
- Selections may cross fields for native copy behavior, but formatting and text
  mutations operate on one mapped field at a time.
- Mixed font-family and font-size selections are indeterminate and leave their
  toolbar controls blank. Typed inline sizes clamp to 1–200 pt; the curated
  preset menu remains a smaller unchanged list.
- A collapsed caret remains visually anchored in the document while a toolbar
  input, popover, or portaled option menu is editing its next-typing format.
  Its height and baseline use that active format rather than adjacent text.
- After a font-family or font-size choice commits, the public focus command
  restores the saved caret or range to the contenteditable page.
- Structure controls stay outside `contenteditable`; position them from engine
  provenance and geometry so controls never alter page layout or PDF output.
- Constrained prose hosts may disable structure controls and choose the
  cover-letter layout while retaining the same edit/history/caret engine.
- Keep structural actions in the reducer/history path. A pointer drag, keyboard
  move, context command, or Enter/Backspace edit must remain one undoable action.
- Use refs for transient selection, replay, drag, and caret state that changes on
  hot input paths; derive visible toolbar state instead of duplicating it.

## Verification

1. Run `npm run eval:editor --workspace packages/editor` after value/display,
   whitespace, clipboard, deletion-format, selection, or drag-hit-area changes.
2. Run `npm run check --workspace packages/editor` after component, hook, or
   action-contract changes, then build both apps when the public contract moved.
3. Check direct typing, Tab indentation, trailing spaces, mixed-size/family
   baselines, rich copy/paste, zoom shortcuts, delete-and-retype formatting,
   range formatting, undo/redo, right-click commands, drag, and keyboard
   reorder in a real browser for material editor work.
4. Confirm edits repaint through the shared engine and remain aligned with the
   print/PDF path; do not add an editor-only layout approximation.
