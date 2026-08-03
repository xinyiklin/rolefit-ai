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
- `clipboardPrivateCodec.ts` owns the versioned same-editor payload.
  `clipboardHtmlImport.ts` owns the allowlisted HTML-to-inline-mark sanitizer,
  while `clipboardHtmlExport.ts` owns model-derived external HTML/plain copy.
  External copy emits one block per logical field, never one per
  engine wrap line, so a destination editor reflows the paragraph to its own
  measure. Paragraph before/after spacing stays CSS block margins; never encode
  it as a blank paragraph, which changes document structure in Google Docs.
  Effective line height is unitless CSS on both the paragraph and its inline
  runs; inbound unitless/percentage values, or physical values with a known
  font size, become explicit line-height marks. Explicit and
  engine-auto-detected links both serialize as HTML anchors. On inbound rich
  paste, allowlisted block margins become explicit paragraph before/after
  marks, and multiple HTML blocks become separate bullet/summary fields
  through one structural editor action rather than hard breaks inside one
  field. Keep all other arbitrary clipboard CSS, scripts, event attributes,
  unsupported fonts, and invalid links out of document state.
  Attach the private selection MIME only when every selected cover-letter field
  is representable. A header plus paragraphs is a full-document payload; never
  consume only its header or silently fall back to a lossy partial private
  import.
- `clipboardBrowser.ts` owns Clipboard API permission handling and MIME
  fallback. The paste-dialog components own only prompt rendering and mapping
  controls; selection, commit, caret, and replay-queue state remain in
  `TypesetEditor`.
- `selectionHighlight.ts` owns the visual selection overlay. It coalesces the
  browser range fragments per engine line and paints one text-bounded band.
  Consecutive selected lines tile through their complete vertical junction, so
  paragraph before/after spacing and the calibrated base gap cannot leave a
  white seam inside one selection. The upper line owns that junction downward.
  When a paragraph is selected without its predecessor, its first line may
  extend upward by the engine-published authored before-space, including at a
  page start where layout reserves that room. Its last line extends through
  authored after-space even when it is the document's final line. The page edge
  caps both boundary bands, preventing double-painted dark bands and
  cross-page paint. Inside a paragraph, the band covers each
  line's LINE BOX: its ink plus the line spacing that line owns, which the
  engine publishes as `--tsd-line-leading`. Lines with no leading of their own
  (entry heads, headings, a contact row) fall back to their ink box. The offset
  is SIGNED and bands TILE: a line's box is its ink box,
  tight line spacing makes consecutive ink boxes overlap, and a translucent veil
  painted twice is a dark stripe across the text — so a band gives height back
  just as readily as it grows, always stopping where the next selected line
  begins. It stays bounded horizontally by that
  line's painted text so a highlight never reaches into the page margins, and it
  never bridges a page break.
- `caretOverlay.ts` maps a collapsed logical selection onto the engine line's
  exposed baseline and the browser-measured active font face. The resulting
  caret remains visible while editor toolbar controls own focus and reflects
  next-typing family, emphasis, and size without entering document state. It
  also carries the active face's `italicAngleDeg`, so an italic caret leans with
  the text it will insert, sheared about the baseline it reports. Geometry
  equality must compare the slope and baseline too: a family's upright and
  italic faces usually share vertical metrics, so arming italic moves nothing in
  the box and an equality check over position alone would keep the upright
  caret.
- The overlay is the only caret while the model owns editing.
  `.tsd-doc--editable` suppresses the native one even when no model field
  resolves, because a document with no fields accepts typing nowhere yet the
  browser still parks a caret in the page's top-left corner. IME composition is
  the deliberate exception: while the browser owns its uncommitted DOM value,
  `.is-composing` restores the native caret and hides the stale overlay until
  `compositionend` commits the value. A range selection paints no edge caret;
  the selection band is its own feedback.
- An empty field's hint (currently only the blank structural name) is ghost text
  of what will be typed, not UI chrome: it inherits the run's own font so it
  agrees with the caret, which is drawn at the field's display size. A zero-width
  run IS its own alignment anchor, so the renderer publishes
  `--tsd-empty-hint-shift` — how far along the column that anchor sits — and the
  hint slides back by that share of its width instead of spilling off the page
  from a centred header's midpoint.
- Caret placement a HOST asks for has two entry points, both consumed by the
  post-paint restore effect because a caret can only be placed once its field is
  painted. `focusDocumentStart()` is for the moment a document is OPENED: it
  records the request and forces a paint rather than placing immediately,
  because the host calls it one tick before the new data is painted. The
  `initialCaret`/`onCaretExit` pair carries a `TypesetCaret` across an unmount,
  for a host that swaps the editor out (RoleFit's studio tabs) — the caret is
  stored in VALUE indexes so it survives the repaint. Neither may return early
  from that effect: it also reopens the commit gate.
- The editor is NEVER caretless once it has painted. Mounting with no stored
  caret starts at the document start, and a stored caret whose field no longer
  exists falls back there too. Without that first rule the cover letter had no
  caret at all on its first visit: its blank letter is the hook's initial state
  rather than a load, so no open path ever ran for it.
- Opening a document must never take focus from a text field outside the editor.
  A workspace load lands whenever the server answers, which can be mid-sentence
  in the job description. Buttons and the page background are fair game; an
  input, textarea, select, or foreign contenteditable is not, and the caret is
  still placed so the next Tab into the document lands there.
- Both endpoints of a restored range convert through
  `valueIndexForDisplayIndex`. `valueStart` holds one entry per real character,
  so a display index PAST the last one — a caret at the field's end — indexes
  nothing; the restore paths each defaulted the start to 0 and the end to the
  value's length, which brought a caret at the end of a paragraph back as the
  WHOLE paragraph selected. The edit itself was correctly scoped; only the
  selection that returned was wrong, which is why it looked like a second bug.
- A selection endpoint that names no field must still resolve to one. A browser
  parks the caret at the END of a line inside the painter's zero-width separator
  or on the line container, so `readSelection` resolves such an endpoint through
  `fieldCaretOf` to the end of the last content span at or before it. Without
  that, a caret at the end of a paragraph mapped to NO field, every command fell
  back to the last remembered range, and choosing a line spacing there applied
  it to the whole paragraph and left the whole paragraph selected afterwards.
- Authored indentation is ONE unit, not a run of spaces. The painter merges it
  into the first word's run, so `placeInLine` and the forgiving drag anchors
  resolve past it: the first position a pointer can reach on a line is its first
  real glyph, and a drag can never select part of a tab. That glyph — not the
  space at index 0 — is therefore the paragraph's first CHARACTER when Tab asks
  whether the selection includes it. Only a LEADING run counts; interior spaces
  are ordinary text, and a continuation line never starts with one because the
  breaker consumed its glue.
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
  keeps ownership of structural consequences. A selection endpoint frequently
  names NO field — a select-all anchors on the editing host, a triple-click ends
  on a line container, and selecting one whole line usually ends on the
  line-separator span — so both the covering field AND the display offset inside
  it are resolved against that field's own painted spans. Neither may fall back
  to the whole field: line spacing then applied to every line of the paragraph.
  Neither may test a wrapped field by its FIRST span either: every point past
  line one resolved to no field at all, and the toolbar greyed out on an
  ordinary selection.
- `useTypesetInputEvents.ts` intercepts browser input and keyboard intents.
- `useTypesetStructure.ts` owns add/remove/reorder commands and drag state. Its
  `headerCommands` bundle must keep stable identity: caret-restoration callbacks
  depend on it, and dependency churn can consume an in-flight caret against the
  pre-edit DOM.
- `useTypesetOverlayAnchors.ts` owns overlay geometry: page origins inside the
  wrapper, pointer-hover block targeting, and the caret-active field anchor.
- `typesetStructure.ts` derives pure anchors, extents, and drop slots from the
  engine layout.
- `TypesetStructureOverlay.tsx` paints drag affordances outside the editable DOM.
  It never paints header actions; create, show, hide, and remove stay in the
  toolbar, keyboard, and right-click command surfaces.
- `useTypesetContextMenu.tsx` builds contextual document commands over the
  editor's shared command surface; `TypesetContextMenu.tsx` only renders the menu.
- `useTypesetLinkCard.ts` resolves the link the CARET is in (or the selection
  covers) to its field and display range, from the selection the controller has
  already resolved; `TypesetLinkCard.tsx` only renders the card.

## Editing Invariants

- The engine-painted DOM is the editing surface, but the browser never commits
  mutations directly. Prevent the native edit, transform the serialized field,
  dispatch a structured action, repaint, and restore the caret.
- Every paste path is a mutation intent, including asynchronous Clipboard API
  reads and same-editor rich payloads. Queue it while the commit gate is closed,
  then resolve and apply it against the post-paint selection; bypassing the gate
  can target stale DOM and replay a caret against the wrong document state.
- Keep display indexes and serialized-value indexes explicit. Inline tags are
  value-space metadata and must remain balanced across insert, delete, split,
  merge, copy, paste, undo, and redo.
- Contact history restoration must compare structure before field values. A
  missing trailing contact and a restored empty contact both read as `""`;
  when a snapshot grows the contact list, restore the caret at offset zero of
  the first added slot so it lands after the engine-owned preceding divider.
- Line height and paragraph before/after spacing use the shared inline grammar.
  A caret or partial range expands to its painted visual line(s); selecting a
  whole paragraph targets the complete field. Each line-height override changes
  only the following junction, so it adds space below and never above the
  selected line. Before/after spacing remains a paragraph property. Keep these wrappers balanced through the same editing
  paths as font, emphasis, alignment, and link marks.
- Dragging from or to the first/last glyph uses forgiving line-edge hit areas.
  The forgiving snap owns only the initial drag anchor; the moving endpoint
  remains character-precise so short partial selections do not collapse or
  become full-line selections. A nearby line/separator pixel must still resolve
  the nearest field edge. Preserve native character selection away from those
  edges. When browser point-to-caret lookup fails, measure the span's substring
  advances rather than falling back to offset zero.
- Wherever a pointer press places the caret BY HAND, it must also start the
  synthetic drag (`beginPointerDrag`, already armed). Preventing the default
  removes the browser's own drag, so a press in the margins, before the first
  glyph, after the last, in the gap between two fields on a row, or on a bullet
  marker selected nothing at all however far the pointer then travelled — the
  user had to land inside the text to select from the start or end of a line.
  Only a press that lands ON field text stays unarmed, because the browser's
  character-precise selection is better until the pointer actually moves.
- Forgiving drag anchors are the outer edges of a FIELD on that line, not of
  every painted span. The painter splits a field at each inline style change,
  and snapping to those interior boundaries pulled the anchor off the character
  the user pressed on. The last field on a line keeps its authored trailing
  whitespace, exactly as `lineEdgePosition` does.
- Pointer move and release are watched on the DOCUMENT while a drag is live, and
  that drag resolves lines with `nearestLineByPoint(..., "anywhere")`. The
  pointer legitimately leaves the sheet — into the margin, past the last page,
  over the toolbar or the app chrome — while the user is still extending, and a
  host-only listener (or the click path's conservative horizontal/vertical
  reach) froze the selection wherever the pointer last crossed the text.
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
  Enter at a paragraph boundary likewise gives the empty split half a textless
  carrier for the adjacent typography and paragraph properties, so the next
  insertion continues the active format. Formatting commands at a caret in an
  empty paragraph update that carrier in document state, not only the transient
  typing-format ref, so moving away and returning retains the choice. Never
  carry link or link-suppression state across a new paragraph boundary.
  Summary/cover paragraphs also preserve leading whitespace so indentation
  survives repaint and PDF export; ordinary marked resume bullets may still
  trim accidental space after their marker.
- In a resume, Tab and Shift+Tab move forward/backward through logical content
  fields, skip structural section headings, and select the complete destination
  field even when it wraps or contains several inline runs. At either document
  boundary — and for a selection crossing fields, which names no starting stop —
  leave the key to the browser. Cover-letter headers use the same navigation
  over name/contact fields only. Ctrl/Cmd +/- steps document zoom and Ctrl/Cmd 0
  resets it to 100%.
- In a prose paragraph (a cover-letter body), Tab indents and Shift+Tab
  outdents; neither moves focus. A stray Shift+Tab that threw focus out of the page
  mid-sentence read as the editor losing the document, and Escape is the
  keyboard way out. Which of the two things Tab means follows the word
  processor: a caret indents AT the caret unless it sits at the paragraph's first
  character (the first glyph after any indentation); a selection reaching that
  same character indents the paragraph — one stop at its start,
  however many of its lines the selection covers, partially or whole, because
  the paragraph is the unit being indented; any other selection is replaced by
  the indentation, which is what a selection deliberately starting mid-paragraph
  asks for. A selection crossing paragraphs indents each of them at its start
  through the host's batched edit, and is never the replacing case — that would
  trade several paragraphs for one indent.
- Indenting a paragraph climbs a two-rung ladder, and Shift+Tab climbs back
  down it. Rung one is a FIRST-LINE indent: spaces at the paragraph's start,
  which move only the line they sit on. Rung two is the engine's `indent`
  paragraph property — every line moves and the measure narrows, while those
  leading spaces ride along and keep the first line one stop further in. Spaces
  alone cannot reach rung two: a wrapped line has no authored start to put them
  at. Which rung a Tab takes is settled by what is SELECTED: a whole paragraph
  asks for the whole paragraph to move, so it goes straight to the block; a
  caret or a partial selection takes the first line first. Coming down is the
  reverse order in every case — block before first line — so Shift+Tab always
  undoes the Tab before it. The whole rule is one pure function, `indentStep`;
  the commit path and its eval both go through it rather than each spelling the
  branching out.
- Backspace at the paragraph start gives one stop of that block indent back,
  before the merge and delete paths run. Shift+Tab reverses the same ladder;
  Backspace also makes an indent removable without leaving the typing flow.
- One tab stop is a MEASUREMENT, not a constant: `TAB_STOP_PT` (a half inch, as
  in Word and Docs) divided by the engine's space advance for the caret's own
  family and size. The model has no tab character, so the indent is real spaces,
  and a fixed count of them is a different visual size in every font — four
  spaces is 0.11in in Source Sans against 0.19in in Latin Modern, both far short
  of a real tab. `TypesetEditor` owns that measurement (`indentWidthAt`); the
  input hook asks for it rather than assuming a width.
- Authored indentation behaves as ONE tab stop everywhere it is met. A plain
  Backspace/Delete against a run of at least one stop removes a whole stop —
  including on the queued-replay path, which is what a held key uses. A ragged
  run first snaps back into alignment; runs shorter than a stop stay ordinary
  typed spaces; and word/line deletes keep their own larger intent. The
  arithmetic is pure and lives in `inlineTextEditing.ts`.
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
- Every host gets the right-click menu. `structureCapabilities.header` and
  `.sections` gate their own structural groups independently: cover letters
  expose name/contact structure without resume section, entry, or bullet
  actions, while clipboard, emphasis, link, and history commands remain shared.
- A multi-block paste into a header field never guesses structure. It opens the
  anchored mapper, and cover letters offer a separate `Paste as document…`
  mapper for explicit name/contact/body assignment. Direct Typeset clipboard
  data may restore its exact private header block without that heuristic gate.
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
- Deferring an automatic link while its trailing caret is being typed repaints
  that field between `<a>` and `<span>`. Never perform that swap while a primary
  pointer selection is in flight: replacing the range's anchor node between
  mousedown and mousemove collapses a backward drag from the link edge. Preserve
  the current suppression until mouseup, then restore the final single- or
  multi-field range across the settled paint.
- Plain-text header controls preserve custom label/destination pairs, but a
  destination derived from visible email, URL, or phone text must be recomputed
  when that visible run changes. If the new text is not linkable, remove the
  derived destination; Undo restores text and destination together.
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
- One selection rectangle per engine line, bounded by that line's painted text,
  covering its own line box and every complete junction inside the selection,
  with authored before/after spacing at an exposed paragraph edge and no
  overlap between adjacent bands. The browser's own selection
  paint is off for the WHOLE editable document, not just field spans: a contact
  divider is a run the engine owns and no field does, so it carries no
  `data-tsdf`, and a rule scoped to field spans left the native veil painting
  under each divider on top of the band — two translucent layers, one darker box
  per "|".
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
- Continuous same-field text input coalesces through a rolling 700 ms window,
  but typing, backward deletion, and forward deletion are distinct groups.
  Selection replacement, formatting, paste/cut, structural edits, field changes,
  caret moves, pauses, and undo/redo close the active group. One undo/redo
  restores or reapplies the complete held-key deletion burst. Background
  persistence may clear dirty state but never split that user transaction.
- Use refs for transient selection, replay, drag, and caret state that changes on
  hot input paths; derive visible toolbar state instead of duplicating it.

## Verification

1. Run `npm run eval:editor --workspace packages/editor` after value/display,
   whitespace, clipboard, deletion-format, selection, or drag-hit-area changes.
2. Run `npm run check --workspace packages/editor` after component, hook, or
   action-contract changes, then build both apps when the public contract moved.
3. Check direct typing, Tab/Shift+Tab indentation and its one-keystroke delete,
   selection drags begun in the margins and at the first/last glyph (forward,
   reverse, across fields and pages, released outside the window), trailing
   spaces, mixed-size/family
   baselines, rich copy/paste, zoom shortcuts, delete-and-retype formatting,
   range formatting, undo/redo, right-click commands, drag, and keyboard
   reorder in a real browser for material editor work.
4. Confirm edits repaint through the shared engine and remain aligned with the
   print/PDF path; do not add an editor-only layout approximation.
