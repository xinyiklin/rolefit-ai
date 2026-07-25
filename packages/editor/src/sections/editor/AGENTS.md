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
  line's full height (determined by its largest inline run), bounded
  horizontally by that line's painted text so a highlight never reaches into the
  page margins.
- `caretOverlay.ts` maps a collapsed logical selection onto the engine line's
  exposed baseline and the browser-measured active font face. The resulting
  caret remains visible while editor toolbar controls own focus and reflects
  next-typing family, emphasis, and size without entering document state.
- `domSelection.ts` translates between DOM caret positions and display indexes,
  and owns the caret/line DOM geometry helpers (line lookup, caret placement,
  click-to-caret) plus `keyOfNode`. A field's spans are split by inline style
  boundaries AND by line breaks; at a line break the breaker consumes the
  interword glue (or the authored newline) into the break, so that display
  character has no DOM character. Both mappings skip exactly one such character
  when the walk crosses into a new line.
- `resumeFieldAdapter.ts` maps one-field editor values to the structured
  resume domain: reads (`valueForField`), commits (`commitField`), the write as
  data for a batched edit (`fieldEditFor`), and the pure render-overlay write
  (`withFieldValue`).
- `multiFieldSelection.ts` resolves a selection that crosses field boundaries
  into the ordered fields it covers, and answers the mark/family/size questions
  that span them. DOM-reading and pure: it never dispatches, so the controller
  keeps ownership of structural consequences.
- `useTypesetInputEvents.ts` intercepts browser input and keyboard intents.
- `useTypesetStructure.ts` owns add/remove/reorder commands and drag state.
- `useTypesetOverlayAnchors.ts` owns overlay geometry: page origins inside the
  wrapper, pointer-hover block targeting, and the caret-active field anchor.
- `typesetStructure.ts` derives pure anchors, extents, and drop slots from the
  engine layout.
- `TypesetStructureOverlay.tsx` paints drag affordances outside the editable DOM.
- `useTypesetContextMenu.tsx` builds contextual document commands over the
  editor's shared command surface; `TypesetContextMenu.tsx` only renders the menu.
- `useTypesetLinkCard.ts` resolves the link the CARET is in (or the selection
  covers) to its field and display range, from the selection the controller has
  already resolved; `TypesetLinkCard.tsx` only renders the card.

## Editing Invariants

- The engine-painted DOM is the editing surface, but the browser never commits
  mutations directly. Prevent the native edit, transform the serialized field,
  dispatch a structured action, repaint, and restore the caret.
- Keep display indexes and serialized-value indexes explicit. Inline tags are
  value-space metadata and must remain balanced across insert, delete, split,
  merge, copy, paste, undo, and redo.
- A wrapped continuation line is ordinary editable text. The caret must read and
  restore across a line break: the glue a break consumed exists in the display
  string but in neither line's DOM text, so a mapping that ignores it reports no
  selection on continuation lines and throws a restored caret back to the line
  above. A caret AT a break belongs to the end of the broken line; past it, to
  the start of the next. Resolve the crossing for EVERY span, blank lines
  included — a blank line stands for an authored break that consumed its own
  character, and stepping over it desynchronizes everything after it.
- Preserve authored interior and trailing whitespace. Deleting the final styled
  character must retain that character's typing format for the next insertion.
- Tab inserts four authored spaces inside a clean field. Shift+Tab remains
  available to leave the contenteditable surface. Ctrl/Cmd +/- steps document
  zoom and Ctrl/Cmd 0 resets it to 100%.
- Copy writes plain text, safe HTML, and the private versioned inline fragment;
  paste prefers that fragment, then sanitized HTML, then plain text. Supported
  family, size, emphasis, underline, link, and alignment runs must survive a
  same-editor round trip.
- A selection may cross fields. `multiFieldSelection.ts` resolves the DOM
  selection into the ordered fields it covers with the display range inside each,
  and those edits commit through the batched field-edit action so the whole
  change is ONE undo step and the selection survives the repaint. Single-field
  paths stay unchanged and keep their keystroke coalescing; a cross-field commit
  is always its own undo step.
- Cross-field deletion follows the word processor for list content and protects
  structure. Prose paragraphs and bullet rows the selection emptied are removed,
  and remainders join into the first row when the selection began and ended in
  the same list; each covered list keeps at least one row. A name, contact,
  heading, entry head, or skills slot only loses its covered text — those are
  removed through the structure controls, never by typing.
- Every clipboard and link command works across fields. A cross-field selection
  links each covered range IN PLACE (its text is not rewritable from the link
  popover — one string cannot describe multi-paragraph text, so the control
  reports `linkTextEditable: false`), cut writes the model's text and deletes as
  one edit, and paste replaces the selection inside the SAME batch so it stays
  one undo step. A command that silently returns for a cross-field selection is a
  bug: the toolbar stays enabled, so the user sees no reason it should not apply.
- The toolbar and the right-click menu drive ONE command surface
  (`TypesetEditorCommands`, the imperative handle plus the menu's clipboard
  members), and both read their enabled state from the same `InlineFormatState`.
  A menu item must never be a second implementation of a toolbar command: the
  menu kept editing one field at a time for a whole slice after the toolbar had
  learned to span them, and nothing failed loudly.
- Every host gets the right-click menu. `structureEditing` gates only the
  structural group (add/delete section, entry, bullet, skills row) — a cover
  letter has no resume structure but still needs clipboard, emphasis, link, and
  history commands, and gating the whole menu on that flag left it with the
  browser's native menu instead.
- Structural menu commands target the field the POINTER was over, not the
  selection, so right-clicking a bullet offers to delete that bullet.
- The link card follows the SELECTION, never the pointer: it shows for a caret
  inside a hyperlink or a selection covering one. Hover is the wrong trigger for
  an editor — it fires while reading rather than acting, no keyboard user can
  reach it, and it competes with selection dragging for the pointer. Acting on the
  card selects its run first and then calls the ordinary command, so there is no
  second link-editing path to drift from the toolbar and menu.
- Overlays are siblings of the editable host inside the positioned wrapper
  (`.typeset-editor`), positioned in WRAPPER-relative coordinates — the pattern the
  caret and structure overlays already use. Controls must never live in the
  `contenteditable` DOM, where they would become content the caret can enter and an
  edit can delete; and wrapper-relative geometry scrolls with the text for free. A
  viewport-anchored overlay needs a scroll listener, and scroll events are
  paint-gated, so it silently detaches from its target wherever they do not fire.
- Any hook whose value an effect depends on must expose stable callbacks, and
  every state write that an effect can repeat must be identity-stable when nothing
  changed. A card repositioned from a repaint effect, handing back a fresh object
  each time, is an infinite render loop.
- The auto-link deferral remembers a display RANGE, never a copy of the field's
  text. A cached value is stale for the repaint after the very next keystroke: the
  paint holds pre-edit text while the caret restore targets an index in the new
  value, and `displayIndexToCaret` clamps to the end of the shorter text. That put
  the caret one character back on every keystroke inside a URL, which moved it off
  the word's trailing edge and let the link fire mid-typing — and the following
  space then landed inside the URL.
- Link state is NOT inherited like character formatting. Typing inherits bold,
  family, and size from the character to the left, but a hyperlink (and a
  `<nolink>` suppression) is inherited only when the insertion point is strictly
  INSIDE one run — the characters on both sides agree. Inheriting from the left
  alone made typing after a link swallow the rest of the sentence into it, and
  leaked `<nolink>` into everything typed after a de-linked URL.
- `expandToLinkRun` never reaches outside one href's contiguous run. Expanding
  from the selection's own bounds let a selection touching two links return a range
  labelled with the first link's href but reaching into the second, so Remove and
  Apply rewrote the neighbour's text. A selection spanning two links resolves to
  the first.
- Only an AUTOMATIC link is ever deferred. An explicit `<link=…>` is a hyperlink
  the user asked for; deferring it made a real link visibly lose its anchor while
  the caret rested at its end.
- A host that enables the editor's link commands must pass `onRequestLinkEditor`.
  Without it the menu's "Edit link"/"Add link" and the card's Edit are silent
  no-ops — which is exactly what happened to the cover letter when it gained the
  menu but kept its link popover state private to its toolbar.
- A selection covering exactly ONE field is single-field whichever way the
  browser shaped its boundaries — Gecko anchors a select-all on the editing host,
  so endpoint lookup alone would strand it and lose every one-field command.
- The painter's line-separator span (`data-tsds`) is not field content. Caret
  placement, line-edge movement, and the selection rectangle must exclude it, or
  End parks the caret in text that maps to no field.
- Enter follows the field's grammar. Prose paragraphs (summary sections, which is
  how a cover letter is modelled) always split, including from an empty
  paragraph, so an author can open a blank line between blocks. List rows
  (bullets, skills) split only when non-empty, so an empty row never piles up
  more empty rows.
- Mixed font-family and font-size selections are indeterminate and leave their
  toolbar controls blank. Typed inline sizes clamp to 1–200 pt; the curated
  preset menu remains a smaller unchanged list.
- A collapsed caret remains visually anchored in the document while a toolbar
  input, popover, or portaled option menu is editing its next-typing format.
  Its height and baseline use that active format rather than adjacent text.
- Bold/italic/underline with a collapsed caret arm the next-typing format
  instead of doing nothing. Toolbar buttons, keyboard shortcuts, and the
  browser's `formatBold`/`formatItalic`/`formatUnderline` intents all route
  through one commit so they cannot diverge.
- One selection rectangle per engine line, bounded by that line's painted text.
  A browser stretches the client rect of a fragment in the middle of a
  multi-line selection out to its containing block, and a line block spans the
  whole sheet, so an unbounded rectangle paints the page margins. A selected
  empty paragraph keeps a short stub.
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
