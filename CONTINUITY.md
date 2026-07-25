# RoleFit AI Continuity

Cross-workspace decisions and handoff state. Keep entries factual, dated, and
bounded; app-only operational detail belongs in the affected app documentation.

## 2026-07-25

- [USER] The hyperlink overlay is driven by the CARET and SELECTION, not by hover:
  it shows when the caret is inside a hyperlink or hyperlinked text is selected.
  The "Detected" badge is gone. Hover was wrong for an editor — it fires while
  reading rather than acting, no keyboard user can reach it, and it competes with
  selection dragging for the pointer.
- [CODE] ROOT CAUSE of the reported caret bug: `autoLinkSuppress` stored a
  SNAPSHOT of the field value, and `renderData` composed fresh data with it, so the
  repaint after every keystroke inside a URL painted pre-edit text — one character
  short. `displayIndexToCaret` then clamped the restore to the end of that shorter
  text, so the caret landed one back. That moved it off the word's trailing edge,
  which cleared the deferral and linked the URL mid-typing, and the next space then
  landed INSIDE the URL: typing `example.com` left the caret before the `m`, and the
  following space produced `example.co m` linked as `example.co`. State now holds a
  display RANGE and `suppressedAutoLinkValue` derives the paint from the current
  value every render, so the paint can never lag the data. Reproduced in the
  browser and proven offline before and after; the offline eval sweeps every prefix
  of `"example.com "` and asserts the paint's display equals the current value.
  The bug needed a repaint between keystrokes, so it appeared at human typing speed
  and NOT under machine-speed synthetic typing.
- [CODE] Link state is not inherited like character formatting. `applyEdit`
  inherited `linkHref` and `linkSuppressed` from the character to the left, so
  typing after a link swallowed the rest of the sentence into it and `<nolink>`
  leaked into everything typed after a de-linked URL, permanently killing
  auto-linking there. Both are now inherited only when the insertion point is
  strictly inside one run.
- [CODE] `expandToLinkRun` expanded from the selection's own bounds, so a selection
  touching two links returned a range labelled with the first href but reaching into
  the second — Remove and Apply then rewrote the neighbouring link's text. It now
  expands only across one href's contiguous run; a crossing selection resolves to
  the first link. Removing BOTH links from one crossing selection would need a
  multi-run command and is not implemented.
- [CODE] `trailingLinkWordAt` deferred explicit links too, so a real hyperlink
  visibly lost its anchor whenever the caret rested at its end. Only automatic links
  are deferred.
- [CODE] `automaticLinkHref` linked bare filenames: `resume.pdf` became
  `https://resume.pdf`, which a resume triggers constantly. The existing code-suffix
  denylist is now a general file-suffix denylist. It stays a denylist of extensions
  rather than an allowlist of TLDs because a real public-suffix list is too large to
  bundle, and denying an extension only costs a link the user can still add
  explicitly while allowing one silently ships a broken destination. Suffixes that
  are also TLDs people type bare (io, co, dev, app) are deliberately excluded.
- [CODE] The cover letter never received `onRequestLinkEditor`, so the menu's
  "Edit link"/"Add link" and the card's Edit were silent no-ops — a regression from
  giving it the context menu while its link-popover state stayed private to its
  toolbar. The state is lifted to `CoverLetterTab`.
- [CODE] Editor overlays are wrapper-relative siblings inside `.typeset-editor`,
  not viewport-fixed portals. The card was `position: fixed` on a one-shot rect and
  detached from its link on scroll (measured: link moved 150px, card moved 0). Scroll
  events are paint-gated and could not be observed at all in the QA pane, so a
  scroll listener was unverifiable; wrapper-relative geometry needs none.
- [TOOL] A hook returning a fresh object each render, consumed by an effect that
  writes state, is an infinite render loop ("Maximum update depth exceeded"). Found
  in the first cut of the selection-driven card. Destructure the hook's stable
  callbacks and make every repeatable state write identity-stable.
- [TOOL] An adversarial multi-agent audit of the link/caret pipeline independently
  confirmed the root cause from three directions and surfaced further defects that
  are CONFIRMED BUT NOT YET FIXED: PDF link annotations are emitted per run so
  interior spaces of a multi-word link are unclickable while the DOM paints one
  continuous anchor; a justified line that stretches past the 1.75x space-join bound
  splits a linked phrase into one anchor and one underline per word; the engine
  auto-links the raw field VALUE while the editor auto-links the ligature-transformed
  DISPLAY string; the engine auto-links name/heading/entry-head/contact fields per
  WHOLE FIELD while the editor works per word; `End`/`Shift+End` cannot reach a
  field's authored trailing spaces; the replay queue stalls when a drained intent
  commits nothing; and RoleFit's right-click menu resolves `position: fixed` against
  the editor scroller rather than the viewport.
- [USER] Resume and Cover letter now use matched document action bars above the
  formatting toolbar. Resume owns Starter, Open, Save, PDF, and Polish there;
  Cover letter owns Starter, Open, Save, PDF, optional Restore source, and Tailor.
  The masthead no longer owns Resume or Polish, and Cover letter no longer shows
  Copy.
- [CODE] `DocumentActionMenu` is the shared RoleFit disclosure shell. Resume Open
  carries base variants, Recent history, and file upload without the old
  Save/Reload/Remove cluster. Resume Save separates updating the active base,
  saving a named `base-resume-<variant>.resume`, and downloading `.resume`.
  Cover Save separates `.cover` from a plain-text copy. The workspace snapshot
  now exposes the bundled starter independently of the active saved base so the
  Starter action never needs to overwrite or disguise that base.
- [CODE] RoleFit injects `DocumentStructureControls` through the shared
  `FormattingToolbar.documentStructureTools` seam, placing Header and Section
  immediately before Spacing. At narrow widths that same order moves into More;
  standalone Typeset keeps its existing DocumentToolbar placement.
- [TOOL] Verified `@typeset/editor` checks, RoleFit production build, focused
  workspace persistence/lifecycle probes, and all desktop contract probes. Live
  browser QA at 1440, 1280, 1000, and 820px confirmed the action order, Open/Save
  surfaces, both starters, responsive disclosure, absent Cover Copy, and a clean
  console. The RoleFit offline suite remains 45/46 because the already-recorded
  `vertical-parity.mjs` fixture divergence is still red and unrelated.

## 2026-07-24

- [USER] Before requested pushes, review and update affected README and
  documentation; commit compact, privacy-safe continuity with the behavior
  slice. Version changes also update canonical/user-facing versions and require
  a triggered, successfully completed matching release/publish workflow before
  the versioned change is complete.
- [TOOL] Local `main` was fast-forwarded to `origin/main` at `58fcf3f`
  (`Harden AI workflows and refresh application tracker`) before the current
  cover-letter work began.
- [USER] Cover letters are moving out of Materials into a dedicated editor page.
  The workflow starts from the user's own written letter and tailors it against
  the job description and truthful candidate evidence; it does not generate a
  new letter from nothing.
- [USER] Cover-letter presentation is a plain correspondence document: one text
  column and paragraphs, without resume sections, rules, columns, or bullets.
- [USER] The cover-letter page uses the same document and formatting toolbar
  family as the resume editor, but it must not expose resume-specific structure,
  heading, entry-indent, or resume-spacing settings.
- [CODE] The portable editable cover-letter format is `.cover`, with magic
  `typeset-cover-letter` and schema version 1. `.resume` remains resume-only,
  while `.rolefit-backup` remains the product-level workspace backup format.
- [CODE] `@typeset/engine` owns the shared measurement, line breaking,
  pagination, font, DOM/PDF painting, and strict portable-file primitives.
  Cover-letter paragraph composition is a separate engine adapter. RoleFit owns
  job/provider orchestration, source-letter intake, tailoring, and review UX.
- [CODE] `FormattingToolbar.documentStyleTools` is the narrow host seam for a
  non-resume document grammar. RoleFit replaces the default resume style menus
  with a focused line-height popover plus the shared page-margin popover; the
  shared history, zoom, selection formatting, alignment, link, and spell-check
  controls remain unchanged for both document types.
- [USER] Direct editing uses word-processor behavior across both document
  layouts: Tab inserts four preserved spaces (Shift+Tab remains a focus escape),
  copy/paste retains supported inline formatting, mixed font-family selections
  leave the family control blank, and Ctrl/Cmd +/-/0 controls document zoom.
- [USER] Mixed font-family and font-size selections leave both toolbar controls
  blank. Custom typed inline sizes clamp to 1–200 pt without changing the
  curated preset dropdown. Selection highlighting spans the full engine-line
  height determined by its largest inline run.
- [USER] The cover-letter page always presents an editor. With no uploaded,
  restored, or authored base, it starts as a clean blank paragraph; opening a
  source remains optional.
- [CODE] Empty engine paragraphs paint a DOM-only zero-width caret target that
  selection mapping and clipboard handling exclude from document content, so a
  blank cover letter remains immediately editable.
- [USER] Fresh starter resumes, New, and Reset use the canonical Jake-derived
  defaults, including the 10.8 pt start indent and 5.4 pt end indent implied by
  Jake's 0.15 in list plus 0.97-text-width entry rows.
- [USER] The bundled RoleFit starter is the serialized canonical starter, so
  its title, subtitle, and skill-label marks already match Reset text
  formatting instead of changing appearance the first time Reset is used.
- [USER] A collapsed editor caret follows the active next-typing family, face,
  and size and remains visible while toolbar settings own focus. The engine
  wraps otherwise-unbreakable oversized tokens at measured grapheme boundaries
  instead of allowing them to overflow the page; inline font, size, and mark
  boundaries within the token do not create early line breaks. A grapheme that
  cannot fit the current remainder moves intact to the next line, preventing
  single-character formatting runs from oscillating as the user types.
- [USER] Committing a font-family or font-size selection returns keyboard focus
  from the toolbar control to the saved document caret or text range.
- [CODE] Mixed families and sizes remain independent runs on one line. All runs
  share one engine baseline; the DOM painter measures the browser's real CSS
  baseline per bundled face, and pagination expands calibrated line junctions
  for oversized inline ink so adjacent lines cannot collide.
- [ASSUMPTION] A separate AI review pass is not required for the first
  cover-letter editor slice. The product keeps the pre-tailoring source
  recoverable and presents deterministic human-review checks; this decision may
  be revisited with quality evidence.
- [USER] The editor follows word-processor behavior (Word, Google Docs, Pages)
  wherever the two models disagree. Vertical placement therefore depends on the
  fonts and sizes on a line, never on which glyphs were typed: `VLine` carries
  its role-size ink footprint plus `riseOverflow`/`dropOverflow` derived from the
  new `faceExtent`, and pagination adds only that overflow to a calibrated
  junction. Previously the page-top inset and the junction expansion read typed
  ink, so typing a taller letter at a larger inline size moved the line. All-
  nominal rows keep their calibrated distances exactly; `inkExtent` stays only
  for the TeX-calibrated entry title/subtitle strut.
- [CODE] A cleared section heading no longer opens extra space. Its injected
  space measured as zero nominal ink against a full-height row, which added the
  whole heading footprint to both adjacent junctions.
- [CODE+USER] Underline and link rules now come from `underlineSpans` plus a
  face-derived `underlineRule(style)`, superseding the 2026-07-11 per-content
  TeX `\underline` depth. That depth made the rule step between two links in one
  paragraph, and because the DOM painter measures merged style spans while the
  PDF emitter walks single runs, an underlined phrase drew one continuous rule on
  screen and one broken rule per word in the exported PDF.
- [CODE] Enter in a prose paragraph always starts a new paragraph, including from
  an empty one; bullet and skills rows keep the non-empty-only rule. Cover-letter
  authors could not open a blank line between blocks.
- [CODE] Cover-letter New restores the blank document's saved fingerprint, so a
  fresh blank letter is not reported as unsaved.
- [CODE] Bold/italic/underline with a collapsed caret arm the next-typing format.
  Only the toolbar buttons did; the keyboard shortcut and the browser's
  `formatBold`/`formatItalic`/`formatUnderline` intents reached a commit that
  returned early on a collapsed selection. All three now share one path.
- [CODE] Selection rectangles are bounded by each line's painted text. The line
  block spans the whole sheet and a browser stretches mid-selection fragment
  rects to their containing block, so Select All highlighted the page margins
  (measured: 0→815 px across an 816 px sheet). A selected empty paragraph keeps a
  short stub instead of vanishing from the highlight.
- [CODE] Selections that cross field boundaries are editable. `readSelection`
  returns null unless both endpoints map to one field, so Select All silently
  disabled delete, typing, formatting, and the whole toolbar. The new
  `multiFieldSelection.ts` resolves the covered fields and their display ranges,
  and a `batch` reducer action plus `applyFieldEdits` lands the whole change as
  one undo step. Cross-field deletion removes emptied prose paragraphs and
  bullet rows, joins the boundary remainders inside one list, keeps at least one
  row per covered list, and never removes a name, contact, heading, entry-head,
  or skills slot — those belong to the structure controls. Link commands stay
  single-field.
- [CODE] Cross-field resolution reads only document order plus the range's two
  endpoints; it no longer asks `Selection.containsNode` per span. A DOM selection
  is one contiguous range, so the fields it touches are a contiguous slice, and
  the endpoint-only form behaves the same whichever way an engine shapes a
  select-all range (Blink puts the boundaries in the first/last text nodes, Gecko
  can put them on the editing host with child offsets). An endpoint that resolves
  to no field means "from the start"/"to the end". Multiple ranges (Gecko-only)
  span first-start to last-end. A single covered field is allowed, so a
  one-paragraph Select All whose endpoints do not resolve still edits.
- [CODE+USER] Painted lines end with the separator their break stood for (a space
  inside one field, a newline between fields), marked `data-tsds` and rendered
  contentEditable=false inside the font-size-0 line box, so it is invisible and
  zero-width. Without it the browser's word iterator ran the last word of a line
  into the first word of the next: a double-click on the last word of a paragraph
  selected across the break ("gammaDelta"). `lineSeparators` lives in `layout.ts`
  (React-free, testable); caret placement, line-edge movement, and the selection
  rectangle exclude the span.
- [CODE] A range boundary that names no field is resolved by DOCUMENT POSITION,
  not by assuming the document's first or last field. A triple-click ends on a
  line container, so the old assumption made a one-paragraph selection report —
  and copy — the whole document.
- [CODE] Cross-field copy writes plain text from the model, one covered slice per
  field joined by newlines. The DOM-derived path lost paragraph breaks and could
  leak the caret placeholder; the model path also keeps an authored hard break's
  real newline, which the layout separator deliberately does not distinguish.
- [USER] Linking and pasting must work on a multi-paragraph selection. A
  cross-field selection now links every covered range in place, with the link
  popover's text field read-only (`linkTextEditable: false`) because one string
  cannot rewrite multi-paragraph text; remove-link clears them all. Paste replaces
  the selection inside the same batched edit (one undo step), and cut — previously
  a silent no-op across fields — writes the model's text and deletes.
- [CODE] KNOWN GAP: pasting text that contains blank lines inserts hard breaks in
  one paragraph rather than creating paragraphs, so a pasted multi-paragraph
  letter arrives as a single paragraph. `parseCoverLetterText` splits paragraphs
  only on the Open/load path. Fixing it needs a reducer action that replaces one
  paragraph with several, plus a decision for the resume host (pasting into a
  bullet list). Not attempted in this slice.
- [TOOL] The in-app browser driver cannot produce `insertParagraph`, Backspace's
  `deleteContentBackward`, or native Select All (CDP key events carry no editing
  command), so those paths were exercised by dispatching the app's own
  `beforeinput` intent and setting the range directly. Typing, real toolbar
  clicks, marks, and geometry read back normally.
- [USER] Cross-field Select All was confirmed fixed in Firefox by the
  endpoint-only resolution. Gecko puts a select-all range's boundaries on the
  editing host, which no endpoint-based key lookup can name, so `readSelection`
  now falls back to the covered-field resolution and treats a ONE-field selection
  as single-field. Without that, Firefox lost every command needing one run of
  text — the reported symptom was a dead link control on a fully selected
  single-paragraph letter, working in Blink and not in Gecko.
- [CODE] Wrapped continuation lines are editable again. A line break consumes the
  interword glue (or the authored newline) into the break, so that display
  character has no DOM character in either line; both caret mappings in
  `domSelection.ts` desynchronized there. `caretToDisplayIndex` returned null for
  any caret on a continuation line — no typing, no editing, and queued keystrokes
  such as a second space were dropped — and `displayIndexToCaret` resolved a
  restored caret to the end of the line above, so the next character landed in
  the previous word (typing past the margin produced "rightg" instead of "marg").
  A caret AT a break belongs to the end of the broken line; past it, to the start
  of the next. Emergency mid-token breaks and same-line style boundaries consume
  nothing, and the crossing is resolved for blank-line spans too — an authored
  hard break paints a blank line that consumed its own display character, so
  skipping it desynchronized every caret after it.
- [TOOL] `apps/role-fit-ai/src/typeset/__evals__/vertical-parity.mjs` is RED and
  was already red before this work: bullet, summary, and skills columns subtract
  `entryEndIndentPt` (5.4 default), which Jake's source applied only to entry
  head rows, so one truth line reflows by a word. Setting `entryEndIndentPt: 0`
  makes all 20 lines match within ±1.5bp. UNCONFIRMED whether the body columns or
  the fixture should change; the decision reflows every existing resume.
- [USER] The document font list gains the three families resumes are most often
  asked for, as their redistributable metric-compatible equivalents: Tinos
  (Times New Roman), Arimo (Arial), and Carlito (Calibri). The originals are not
  redistributable; these keep the originals' per-character advance widths, so a
  document holds its line and page count when opened in a word processor that
  only has the original. The menu shows each font's real name with its metric twin
  beside it — never the trademark as the font's own name — and previews each row
  in its own face. Verified against the published originals: Tinos and Arimo match
  Times New Roman and Arial with ZERO deviation on the sampled repertoire.
- [CODE] `lib/fontFamilies.ts` is the single list of family ids. The persisted
  style enum, `FONT_FAMILY_OPTIONS`, both `<font=…>` tag automata (engine
  measurement and the editor's display map), `clearInlineOverride`,
  `effectiveFieldFont`, and the engine face registry all derive from it. They were
  eight independent hardcoded copies; the tag automata are regex strings, so a
  missed copy TYPECHECKS and then fails at runtime with the tag painted as
  literal text. `typeset-editing.mjs` now sweeps every family through a
  value→display→value round trip, which is the only mechanical guard on that.
- [CODE] The three new families are drawn on a 2048-unit em, so `metrics.gen.ts`'s
  integer 1000ths cannot represent every advance exactly. The residue is per glyph
  and bounded — `pdf-font-parity` measured 0.1166bp worst case over a 61-character
  run at 10bp, and each painted segment carries an explicit engine width so it
  never accumulates past one segment. The eval now allows 0.005bp/glyph for a
  finer design grid and holds every 1000-unit family to bit-exact parity
  (measured 0.0000bp), so a real shaping divergence still fails. Rescaling their
  outlines to 1000/em was rejected: it would trade an invisible engine-vs-render
  difference for a visible break in the metric compatibility that is the reason
  to ship them.
- [CODE] None of the three ships a usable `smcp` lookup (Carlito's `c2sc` has one
  substitution), so their caps faces carry SYNTHESISED small capitals: uniformly
  scaled capitals baked into the shipped font's cmap. Uniform scaling is not an
  approximation of a different design — Latin Modern's own caps face, a genuine
  TeX design, measures 0.7513 height and 0.7522 advance against its capitals. The
  ratio floors at 0.80 (the median real small-cap height of the three bundled
  families) and rises with a face's x-height, because Arial-metric Arimo's
  x-height would otherwise reach past its own small caps. Synthesis lives in the
  ASSET, not in a layout branch, so the browser, the PDF embedder, and the
  committed metrics agree by construction.
- [CODE] `boldDisplay` aliases `bold` for the three static families. Latin Modern
  and the Source families ship a real display optical size (LM Roman 12,
  `opsz: 24`); a single-design static has none, so both roles share one asset,
  one metrics record, and one `@font-face`.
- [CODE] A new editor eval (`styles/__evals__/font-assets.mjs`) cross-checks the
  registry against the stylesheet and the disk: every face declared exactly once,
  loading its own asset at the right weight/style, with both a webfont and a PDF
  sibling present. That failure mode is silent and severe — an unmatched
  `cssFamily` makes the browser substitute a system font, so text paints at
  advances the engine never measured and every caret position is wrong while it
  still looks like text. Both directions were negative-tested.
- [USER] Every editor host gets the right-click menu. It was gated on
  `structureEditing`, so the cover letter had no menu at all — only the browser's
  native one. That flag now gates only the structural group; clipboard, emphasis,
  clear-formatting, link, and history commands are always present.
- [CODE] The toolbar and the right-click menu now drive one command surface and
  read enabled state from one `InlineFormatState`. The menu had its own
  single-field-only implementations, so it silently kept the pre-cross-field
  behaviour: on a multi-paragraph selection its Cut, Copy, Bold, and link items
  were all disabled. Verified in-browser: a cross-paragraph Cut from the menu
  merged the two paragraphs correctly and undid in one step.
- [USER] Hovering a link shows a card with the destination plus open, copy, edit,
  and remove. Acting on it selects that link's run first and then runs the
  ordinary command, so there is no second link path. Remove works on an
  auto-detected bare URL too — it marks the run `<nolink>`, keeping the text and
  dropping the link.
- [CODE] The font menu is sized to its content. At the toolbar's width the fixed
  128px menu collapsed the name column to nothing, so a row read only
  "Times New Roman" with no font name, and "Source Serif 4" truncated.
- [TOOL] CareerOneStop, MIT CAPD, and Harvard FAS guidance was reviewed for
  concise, specific, active, evidence-based application writing that preserves
  the candidate's own voice. The durable links and resulting prompt policy are
  recorded in `apps/role-fit-ai/docs/engineering/ai-server.md`.
