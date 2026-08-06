# UI Principles

Paths in this document are relative to `apps/role-fit-ai/`. Run commands from
the repository root.

RoleFit AI should feel like a compact desktop-first job-prep workspace:
calm, dense, and focused on the resume-polishing workflow. It is not a
marketing landing page, a SaaS dashboard, or a native desktop installer.

## Source Of Truth

- Reuse the per-surface CSS classes in `src/styles/` and the design tokens in
  `src/styles/tokens.css`.
- Prefer tokens and classes from `src/styles/` instead of one-off
  inline styles (tokens in `src/styles/tokens.css`; each surface has its
  own file under `src/styles/`, aggregated in import order by
  `src/styles/index.css`).
- Use lucide-react icons for compact controls when the action is familiar
  and the icon is already in the app's icon set.
- Use Google Chrome for visual inspection/QA at `http://localhost:5181`
  unless the user explicitly asks for another browser surface. If port
  `5181` is already in use, the app is most likely already running —
  attach to the existing instance instead of starting a second
  `npm run dev:rolefit`. (Sibling reservations: careflow `5173-5180`, portfolio
  `5184-5185`.)

## Workflow Shape

Preserve the compact masthead + full-width studio workflow (document file
actions moved into their editor bars on 2026-07-25; job intake moved from the
masthead into the first/default Prepare page on 2026-07-29):

- masthead (navbar): RoleFit identity plus the global Apply action. No Inputs
  group or intake control lives here
- studio utilities (bottom rail): read-only Sessions provides ambient awareness
  immediately above Settings, outside `OUTPUT_TABS` and the APG tablist. Expanded
  rails show Sessions + count; collapsed rails show an icon + compact
  count/working state. Its popover opens rightward and is bounded by the
  viewport. Provider and guidance setup live in the Settings dialog
- studio (full width): PREPARE comes first and contains Prepare, the sole
  job-intake and application-readiness surface. DRAFT contains Resume (the
  engine-painted
  page is the sole editor, so what you see is exactly what exports — it is its
  own live preview, so there is no separate compile-preview; its margin
  controls own add/remove/reorder, section type, and per-section tailor scope;
  Open/Save share one document bar; the primary Polish action rides beside the
  workflow rail's disclosure control in either state, and the
  suggestion/recruiter-review rail docks beside it post-polish), Cover
  letter (a separate plain-paragraph editor with one Polish action and a rail
  that reports readiness before it and the result's provenance after it),
  Materials (application questions and role descriptions); TRACK contains
  Applications (table / calendar tracker views) and Analytics — plus the
  document-specific review rails

Prepare treats the paired extension as the primary intake path, with URL fetch
and pasted text as deliberate fallbacks on the same page. Before preparation,
one centered Source panel is the whole task: URL and pasted text are two
keyboard-navigable methods and only the selected method is visible. Empty Job
brief, Materials, and readiness scaffolds stay out of the page. Extension
receipt and Distill progress navigate to and remain visible on Prepare.

Once ready, Source collapses to its head — captured size and origin — behind
explicit View, Replace, and Prepare again paths. The structured brief leads the
main column and one Application rail combines both material choices, readiness,
  the saved-application summary, a flat fit summary, and Apply. The fit summary
  prefers a current matching Recruiter audit, labels a matching saved audit historical,
  and otherwise says "Not audited"; it never estimates fit locally. Nothing on
the page is a card inside a card, and no status earns its own tinted panel or
icon tile. Preparation
progress is already a readiness check, so it takes rail space only while work is
running or a status message is outstanding. A restored application returns to
Prepare after its job and documents pass their existing source validation and
dirty-document replacement guards.

Every extracted tracker field remains editable on Prepare: role, company,
location, job type, source, work authorization, compensation range/currency/
period, and one role context. Responsibilities, required and preferred
qualifications, technical keywords, seniority and domain signals, and benefits
are editable in the same brief. Surface both extraction gaps and
candidate-review gaps so partial Distill output can be corrected without
another AI run. Benefits remain visible preparation context rather than being
silently folded into resume-tailoring evidence.

Resume and Cover Letter share the same Prepare material-card structure and
hierarchy while retaining their document-specific actions, as two divided
groups inside the Application rail. Each group places its state beside Include,
then the named-variant selector and actions in matching DOM and visual order. It
shows at most one note underneath: the blocker while its action is unavailable,
its live status otherwise. Resume starts included and Cover Letter starts
excluded. Do not add “optional” labels, badges, or card-specific visual
hierarchy. The Prepare and masthead Apply buttons invoke one handler and
one readiness model: the current job must match a completed preparation, and
only included materials must be ready while their preparation is idle. Either
or both cards may be excluded. Re-Apply treats exclusion as non-destructive:
any artifact already saved for that application remains untouched.

Extension intake always runs AI Distill and stops on Prepare; it never starts
resume Polish. Independently, Prepare may rank the actual contents of saved
`.resume` and `.cover` variants against weighted prepared-job sections. For
either document, auto-select a meaningful unique winner only while its editor
is clean and not application-owned. A tie or incomplete read keeps the current
selection. This is source selection, not automatic tailoring. The selector is
the normal receipt; reserve the shared compact recommendation line for a blocked
replacement. Do not persist parallel variant metadata or widen the strict
document schema for this decision.

A material's state line reports the real reason it is not ready. A saved base
letter is a template: real prose plus unresolved `[slots]` that Polish fills.
Say so — "No draft" beside a selected variant reads as a bug, not a state.

Resume and cover letter share ONE Open menu (`DocumentOpenMenu`): the same
component renders each page's start actions (bundled starter, blank, choose a
file) above the documents already saved in the workspace. Starting a document and
reopening a saved one are the same decision, so they are not split across a
separate Starter button. Save is likewise ONE component (`DocumentSaveMenu`):
update the active workspace copy, save a named variant beside it, then the
downloads. PDF is a download, so it lives there too rather than as its own
toolbar button — both bars are Open/Save, with Polish owned by the workflow
rail — and it opens the same rename
prompt for both documents.

The Resume editor is always mounted over a real `ResumeData` document. With no
saved or opened source, RoleFit seeds a clean blank document whose empty name is
still caret-bearing and whose sections are empty. Blank resets persisted document
style, detaches saved-variant identity, and never mutates the saved variant it
replaced. Document existence enables editing and strict `.resume` save; meaningful
content separately gates PDF, Polish, and Apply.

Resume and Cover Letter compose their separate `ReviewRail` and
`CoverLetterReview` content through `DocumentWorkbench`. The shared shell owns
only the editor/rail grid, labelled disclosure, independent scrolling,
container-query stacking, and the two origin-scoped preferences
`rolefit:document-rail:resume-review` and
`rolefit:document-rail:cover-tailoring`. Rail children stay mounted while hidden
so local inputs and review interaction state survive collapse. A new result does
not override an explicit preference; Resume simply omits the rail until review
content exists, while Cover Letter always exposes pre-Tailor readiness.

Opening the rail moves the rail, not the workspace. Two rules hold that:

- The document tabs' `.studio-body` is `overflow: clip`, never `hidden`.
  `hidden` still makes it a scroll container, and it carries horizontal overflow
  from closed toolbar popovers, so focus landing on a rail control mid-transition
  scrolled the toolbar, title, and editor sideways as one. The rail toggle also
  focuses with `preventScroll`, since its target sits outside the box until the
  track settles.
- The track is paid out of the desk margin before the page moves. The pane
  biases its start padding by the rail's width — clamped flush against the end
  padding once the margin runs out — so the page holds its position while there
  is whitespace to spend and slides only as far as it must. The bias uses the
  rendered page width (`DOC_PAGE_WIDTH_PX × zoom`), not the 816px logical page.
  Both the bias and the track animate on one token, `--document-rail-motion`:
  the page stays still only because the padding gains exactly what the track
  loses, so a step change in either throws the document sideways and back.

The rail is sized in `rem`, not `vw`. Its own type is rem-based, so the width
tracks what it holds and follows the reader's font-size; the space it divides is
`viewport - sidebar - page`, which grows linearly rather than proportionally, so
a viewport-proportional rail took its largest bite where least was spare.

That width is adjustable, and one preference serves both documents: disclosure is
workflow state a document owns, but how much screen a rail gets is a workspace
decision, and a per-document width would move the page on every tab switch. It is
dragged from the rail's own divider — a 7px `role="separator"` target that also
resizes with the arrow keys, Home, and End — between 18rem (the default, and the
floor) and 28rem. The bounds stay in `rem` for the reason above; the dragged
value is stored in px under `rolefit:document-rail:width` and re-clamped against
the live root font size on read, so a width saved at one font size never opens
unusable at another. A drag writes the width variable straight onto the element
and commits to state once, on release: re-rendering the rail's review content on
every pointer frame is what makes a resize feel like it is dragging the
workspace. The drag also suspends the shared rail clock — left running, every
frame starts a new 200ms catch-up and the rail trails the cursor.

Collapsing is total: the rail's grid track animates to zero and gives every
pixel back to the document rather than leaving a reserved icon gutter. The rail's
primary action and its disclosure control travel together and keep their order:
open, they sit at the end of the rail header with the label taking the slack;
closed, the same pair stands on the document's top-right edge, and stacked below
1080px in flow where the rail would be. Both are placement only — no card wraps
the pair — and the disclosure is one 30px shape in either state, matched to the
compact button beside it, so the pair never changes proportion when the rail
does. Because the action lives beside the disclosure, a rail's own footer carries
only what an outcome adds: stopping a run, retrying the stage that failed,
accepting or discarding a proposal, restoring the previous letter. The reopen
control carries no visible label — its accessible name and tooltip name the
panel it reopens. The one exception is a bounded count for typed post-draft Cover Letter
issues; that count and its label preserve a recoverable failure while the rail
is closed, and ordinary readiness/provider failures never receive it. Exactly one disclosure control
exists per state: the panel keeps its own Hide button, the collapsed rail goes
`inert` (mounted, so review state survives) and its replacement tab takes focus,
so a keyboard user never lands on `<body>` and a screen reader never hears two
controls for one panel. The panel's contents hold the full rail width while the
track closes, so it slides out instead of reflowing on the way.

Both workspaces spell the run **Polish** — beside the rail's disclosure control
in either state, and on the Prepare cards that start the same runs — with `Polishing…`
while it is in flight and `Polish again` once an outcome exists. `Tailor` and
`Audit` are stage names, legitimate only where the interface reports which half
of a run is happening (the resume's progress steps, the Settings stage default,
a material card's state). The Settings-owned Tailor / Recruiter audit / Both
choice applies to every Resume Polish entry point, and readiness shows only the
providers that selected workflow will call. A rail's readiness rows hold gates only: what the
workflow does with them belongs to the description, and a row that is always
ready is not a check. The two rails share their gate phrasing (`Add your
resume`, `Prepare the job`, `Check AI settings`) and their decision verbs
(`Accept` / `Discard` a proposal) while their content stays document-specific; a
row never repeats a reason that the field directly below it already carries.

The stacked layout owns vertical scrolling inside the document tabs' clipped
studio host; the editor and rail can then participate as full-width rows without
losing content below the viewport. Tab-to-tab scroll restoration receives both
the layout and editor refs and resolves the active owner from computed overflow,
so the breakpoint does not reset the reading position. Resume also passes its
editor pane to the shared Fit control, whose `ResizeObserver` refits after rail
transitions that do not emit a window resize. The workbench wrapper stays
semantically neutral so each feature's existing named `aside` remains the only
complementary landmark.

A menu row carries a description only when its title is not enough. "Download
.resume" and "Download PDF" need none; "Download .txt" does, because it has to be
told apart from .cover. Ambient instructions do not belong at the bottom of a menu
at all: the resume Save menu carried a permanent "save a base resume to use it
automatically" sentence that its own primary row already said at the point of
action, costing 48px on every open.

Both documents persist the same way: `resumes/<variant>.resume` and
`cover-letters/<variant>.cover` use separate workspace folders, each with named
variants and local `.trash/` history, and each save archives the version it
replaces. The filename stem is the variant identity; the extension is the
document kind. `server/coverLetterWorkspace.ts` is a sibling of `server/workspace.ts`,
sharing its storage primitives (lock, atomic write, trash stamping) without
inheriting the base resume's multi-extension import paths.
Each editor remembers its last active saved variant in origin-scoped browser
storage and reopens it on startup; a missing or cleared preference falls back
to the server's first option (Default when present). Detached starters, blank
documents, and uploaded files clear the cover-letter preference.
Base cover letters use modern block formatting: first lines remain flush left
and paragraph separation provides the visual break. Authored indentation is
available, but is not imposed on every base paragraph.
Header controls sit with the document tools in both toolbars; the resume also
includes Section. At narrow widths the group moves into More in its established
order.
The shared Page menu uses the simple labels Narrow, Normal, and Custom. Narrow
applies 0.5 inches on all sides and Normal applies 1 inch; only the resulting
physical values persist in editable files. Custom supports 0.25 through
3 inches per side, and all four inch values stay visible under every preset.
The resume keeps global line height inside Spacing, alongside inspectable
Compact, Balanced, Spacious, and Custom structural values.
Cover-letter line spacing is a vertical, selection-scoped menu: Single, 1.15, 1.5, Double,
paragraph space before/after, and Custom spacing. The menu is compact and uses
a line-list icon; Custom spacing opens a focused modal with Cancel and Apply.
Line height adds space below each targeted visual line, never above it; selecting
the complete paragraph targets all its lines. Before/after spacing remains
paragraph-local, and every action must preserve the active editor selection.
The custom selection paint includes the vertical line/paragraph gap owned by
each selected line, remains text-width horizontally, and stops at page breaks.
In resumes, Tab and Shift+Tab traverse logical header and section fields,
skipping structural headings and selecting a wrapped destination as one field.
The optional cover-letter header uses the same navigation over name/contact
fields only. In cover-letter body paragraphs, Tab indents and Shift+Tab
outdents along a measured half-inch ladder; neither moves focus. That indentation
must remain visible after repaint and in PDF output. Edge-assisted dragging
snaps only its initial anchor; either drag direction retains character-precise
partial selection on paragraph starts, wrapped-line starts, and final glyphs.
Up/Down navigation must enter and leave authored blank lines in either
direction, including consecutive blank lines; blank-line hit testing stays
bound to the intended painted line rather than an adjacent text line.
Resume print-style changes participate in the same chronological Undo/Redo
stream as content. Zoom, spell-check, and preset labels do not.

Polish should feel like a review queue, not a hidden overwrite. By default,
the user selects editable resume sections in the document; identity,
contact, and education stay out of the AI prompt unless explicitly selected.
After AI returns, show proposed edits as accept / edit / discard cards and
let the editor remain the final source of truth for export and pipeline
tracking.

When changing one menu or tab, preserve the others' layout and labels
unless the task explicitly touches them.

## Shared Editor Boundary

- `@typeset/editor` owns the direct editor, document/history/style hooks,
  formatting toolbar, popovers, and shared editor styles.
- `@typeset/engine` owns the resume model, constrained cover-letter adapter,
  strict `.resume`/`.cover` codecs, deterministic layout, fonts, print painting,
  and PDF emission.
- RoleFit owns the masthead, Prepare intake/readiness page, studio navigation,
  AI workflow, review rails,
  tracker, cover-letter file/source lifecycle, and its narrow resume-editor
  overlay for section scope and review targets.
- Adapt shared surfaces through values, callbacks, and deliberate slots. Do not
  fork package components or add product-mode boolean combinations.
- A shared editor change must be checked in both RoleFit and standalone
  Typeset; host-only composition and copy remain in this app.

## Visual Direction

- Use restrained contrast, clear hierarchy, and compact spacing.
- Avoid decorative-heavy visuals, oversized heroes, gradient-heavy
  surfaces, and sales-style copy.
- Match existing radius and spacing scales rather than inventing new
  ones.
- Prefer icons + short labels over decorative chrome for repeated
  controls.

## No Nested Container Rule

Let the outer page shell or panel own the framed feel. Do not stack
card-like containers inside card-like containers just to group content.

Use these patterns instead:

- inner sections separated by dividers
- flat rows with clear labels and values
- subtle background bands without new borders/shadows
- one true card only when it represents a repeated item (a resume
  version row, a keyword chip group, etc.)

Avoid:

- panels inside panels
- bordered/shadowed wrappers around every subsection
- `overflow-hidden` as a way to hide layout mistakes

## Copy And Chrome

- Keep UI text concise and action-oriented.
- Do not turn the app into an in-product manual. A short hint or
  placeholder is fine; multi-sentence inline help blocks and "how to"
  essays are not.
- Fix stale or misleading visible copy during the same UI polish pass.
- The product title is "RoleFit AI" (per `index.html`); do not silently rename it.

## Loading And Empty States

- Do not add loading spinners, shimmer states, or transient animation
  unless the user explicitly asks.
- Preserve layout stability silently while data loads.
- Empty states should be calm, short, and actionable.
- Do not build fake loading states or mock systems.

## Error UX

Errors should support workflow recovery without visual noise.

Prefer:

- inline validation near the affected field
- localized recoverable errors near the affected workflow
- compact retry affordances
- safe, user-facing language

Never show:

- raw exception messages
- stack traces
- raw AI provider error bodies
- endpoint or internal path details
- secrets, tokens, or raw resume/job-description text

## AI Settings UI

- Default provider is the account-backed Claude Code CLI (`claude-cli`) path,
  on both the frontend and the server's no-`AI_PROVIDER` fallback. A non-empty,
  unrecognized `AI_PROVIDER` fails configuration instead of silently selecting
  OpenAI.
- First-class provider choices: subscription CLIs (Claude Code, Codex,
  Antigravity CLI) plus the native OpenAI and Claude APIs. Do not expose an
  adapter until its current request contract and a live smoke are verified.
- Every preference lives in ONE place: the Settings dialog, opened from the foot
  of the studio tab rail. Its three sections are AI stages, About you, and
  Guidance, with Reset pinned below them at the foot of the section rail. The
  masthead keeps only the RoleFit identity and Apply. Read-only Sessions
  belongs immediately above Settings in the bottom studio-rail utilities group,
  outside the output tablist. Do not add a second control for a setting
  Settings already owns.
- A settings section must earn its nav entry. Reset was briefly a section of its
  own and rendered a near-empty panel holding one button. It belongs at the foot
  of the section rail — an action, not a section, reachable from whichever
  section is open, and the same shape as Settings sitting at the foot of the
  studio rail that opens the dialog. A full-width dialog footer was tried in
  between and read as a detached bar. Settings has no Save button; it saves as
  you make changes, and the header says so.
- Settings holds PREFERENCES, not runtime diagnostics. The local server address,
  workspace path, and provider counts describe the machine the companion runs;
  they belong in RoleFit Companion, not in a browser settings panel. Per-stage
  readiness is not listed separately either — a blocked stage says so in its own
  row, beside the control that fixes it.
- Settings > AI stages carries one section per configurable stage (Job distill,
  Resume tailor, Resume review, Cover letter tailor, Application questions). Each
  owns a concrete provider/model/effort config plus an optional instruction
  override; **Copy settings** is a one-shot sync between stages, not a live link.
  The stage list is declared once in `src/config/aiStages.ts` — a stage added to
  the UI without being declared there silently runs on another stage's provider,
  which is how the cover-letter and Q&A flows sat on Tailor's config unnoticed.
- Keep every stage section expanded together. There is no section toggle,
  collapsed summary, or persisted open/collapse preference; the user can scan
  and edit all stage configurations without changing view state.
- Candidate facts (citizenship, work authorization, sponsorship, education level,
  field of study) are strictly opt-in. An unset field emits no prompt line, so
  the model is never told a fact the user did not declare. Citizenship gates the
  work-authorization lines and education level gates the field of study; neither
  block gates the other.
- `polishStages` has one stored value in Settings > AI stages. Resume's document
  action and Prepare card both dispatch that choice; neither owns a per-run
  override or silently rewrites it.
- Distill, Tailor, and Review share one ordered workflow indicator. It shows
  every selected stage and its real `Step n of total` position; a failed or
  user-stopped stage leaves later stages visible as not run and never advances
  automatically.
- Duplicate detection is an explicit pipeline gate. Before an AI request, and
  again after Distill when richer tracking facts become available, the user
  chooses **Continue pipeline** or **Stop here**. Continuing acknowledges that
  job target for the rest of the run; stopping makes no downstream request.
- Each Model control changes with its section's selected provider and exposes
  only models verified against the installed CLI or current first-party API;
  do not add a custom-model escape hatch for unverified IDs.
- Provider, model, and effort preferences may persist in localStorage so the
  three stage configurations survive reloads. CLI providers show connection
  guidance and no API-key field. Native OpenAI/Claude API credentials are added
  only through the local provider companion; the browser never collects,
  stores, renders, or submits them. Settings shows only explicitly added
  providers and makes an added-but-unready provider visibly unavailable.
  Antigravity may be request-eligible as **Ready to verify** while its auth
  state remains unknown; never describe that state as signed in.

## Interaction

- A document page always has a caret. Opening a document puts it at the first
  line — a resume or letter arriving from the workspace, a file, a starter, or a
  blank page is something the user is about to type into — and so does arriving
  at the page for the first time. Returning to the Resume or Cover letter tab
  RESUMES the caret it was left at instead of re-homing it — the studio tabs
  unmount the editor, so the host holds that caret and hands it back. Do not
  re-home a returning caret: it discards the user's place, and in the resume it
  lands in the name field, where a stray keystroke edits the most conspicuous
  line in the document. A tailored AI result does not take focus; the user is
  reading a review when it lands.
- The document scroller returns to the offset it was left at, for the same
  reason and through the same host-held pair (`useRestoredScroll`). Opening a
  document resets it — a new document has no earlier position.
- A menu is bounded by the room under its trigger, never by a guess at where the
  chrome ends. A panel that runs past the window both clips and extends the
  scroll area of whatever contains it, which shifts the document behind it; the
  panel scrolls inside itself instead.
- The Sessions studio-rail popover opens to the right of its trigger and clamps
  to the viewport. It scrolls internally rather than extending or shifting the
  studio shell's scroll area.
- Keep keyboard access for changed controls.
- Prefer existing select / segmented / toggle patterns over hand-rolled
  inline alternatives.
- Use tooltips for unfamiliar icon-only controls.
- Do not introduce global UX systems (banner systems, toast systems,
  loading frameworks) unless the user asks and the need is
  cross-cutting.

## Responsive Behavior

- Desktop is the primary surface. Long resume text, job descriptions,
  and status messages must remain readable without layout overlap.
- Wrap or adjust layout rather than clipping important content.
- Keep the studio navigation vertical. At narrower supported widths it becomes
  a 52px icon rail with accessible tab names; it does not become another top
  navigation row.
- Editor header and formatting rows keep fixed type and a 48px resting height.
  RoleFit's formatting row shares its container with a full document action bar,
  so its style menus (Header, Section, Spacing, Paragraph, Styles, Page) are
  icon-only at every width, named by tooltip and accessible label. Export keeps
  its text label because it is a document action, not a formatting menu.
- The formatting row's disclosure is a measured ladder: style menus move into the
  anchored More overlay first, then selected-text typography, then alignment,
  then clear-formatting and spell check. Each threshold is the intrinsic width of
  the set still inline above it, so the row is never cropped and never scrolls.
  Re-measure the ladder in a browser when a control is added to that row. The
  overlay never consumes editor space; do not shrink type, add a horizontally
  cropped toolbar, or make an overflowing toolbar scroll.
- Each editor's editable document title is its default PDF and portable-source
  name. A successfully prepared job sets the paired header/export bases to
  `Name_Company_Resume` and `Name_Company_Cover_Letter`, with metadata-aware
  fallbacks. Selecting a workspace variant changes the document source, not
  that application output title; both toolbar sublabels use the same
  `Role at Company` target.
- The expanded Sessions utility uses its label plus total count; the collapsed
  rail uses a familiar, evenly spaced icon plus a compact count/working state.
  It remains immediately above Settings and outside output-tab navigation. The
  RoleFit wordmark and Apply icon-and-label button remain visible throughout
  the supported range. The masthead stays 57px tall across disclosure states
  and meets the studio/sidebar through one structural hairline; it never wraps
  or paints a false gap below itself. At 720px and below, only the Resume tab's
  precise authoring surface is replaced by the non-dismissible width notice.
  Prepare, masthead/navigation, the simpler Cover letter page, Materials,
  Applications, and Analytics remain usable, including when browser zoom makes
  the effective viewport cross that threshold.

## Visual QA

For meaningful UI changes:

1. Run `npm run dev:rolefit` and open `http://localhost:5181` in Chrome.
2. Walk through the affected control in the Prepare + studio workflow.
3. Confirm no console errors, overlap, unexpected layout shift, or
   broken keyboard path.
4. Capture a screenshot or describe the visual QA in the final response.

For tiny copy/class changes, use judgment. If Chrome QA is skipped, say
why.
