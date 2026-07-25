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

Preserve the compact masthead + full-width studio workflow (the former left
inputs pane was folded into the masthead by explicit user request,
2026-06-09; document file actions moved into their editor bars on 2026-07-25):

- masthead (navbar): a standalone Sessions menu for concurrent job tabs first,
  followed by Job target (link + description), plus the global Apply action.
  Provider and guidance setup live in the Settings dialog at the foot of the
  studio rail, not here
- studio (full width): the tabbed output views — Resume (the engine-painted
  page is the sole editor, so what you see is exactly what exports — it is its
  own live preview, so there is no separate compile-preview; its margin
  controls own add/remove/reorder, section type, and per-section tailor scope;
  Open/Save/Polish share one document action bar, and the
  suggestion/recruiter-review rail docks beside it post-polish), Cover
  letter (a separate plain-paragraph editor that revises the user's source
  letter with the matching Open/Save/Polish action bar), Materials
  (application questions and role descriptions),
  Applications (table / calendar tracker views), Analytics — plus the
  document-specific review rails

Resume and cover letter share ONE Open menu (`DocumentOpenMenu`): the same
component renders each page's start actions (bundled starter, blank, choose a
file) above the documents already saved in the workspace. Starting a document and
reopening a saved one are the same decision, so they are not split across a
separate Starter button. Save is likewise ONE component (`DocumentSaveMenu`):
update the active workspace copy, save a named variant beside it, then the
downloads. PDF is a download, so it lives there too rather than as its own
toolbar button — both bars are Open/Save/Polish — and it opens the same rename
prompt for both documents.

A menu row carries a description only when its title is not enough. "Download
.resume" and "Download PDF" need none; "Download .txt" does, because it has to be
told apart from .cover. Ambient instructions do not belong at the bottom of a menu
at all: the resume Save menu carried a permanent "save a base resume to use it
automatically" sentence that its own primary row already said at the point of
action, costing 48px on every open.

Both documents persist the same way: `base-resume*.resume` and
`cover-letter*.cover` sit side by side in the workspace, each with named
variants and `.trash/` version history, and each save archives the version it
replaces. `server/coverLetterWorkspace.ts` is a sibling of `server/workspace.ts`,
sharing its storage primitives (lock, atomic write, trash stamping) without
inheriting the base resume's multi-extension import paths.
Resume Header and Section controls sit immediately before Spacing in the shared
formatting row; at narrow widths the whole group moves into More in that order.

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
- RoleFit owns the masthead, studio navigation, AI workflow, review rails,
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
  masthead keeps only Sessions, Job target, and Apply. Do not add a second
  control for a setting Settings already owns.
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
- `polishStages` has exactly two entry points and one stored value: the resume
  Polish action asks per run, and Settings > AI stages holds the default. A
  per-run pick updates that default.
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
- Masthead menu panels anchor to their own trigger's right edge so they open
  inboard, under the control that owns them. The bar's controls sit at the right
  of the window, so a left-anchored panel runs off it and ends up pressed
  against the edge by the viewport clamp.
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
- The Resume tab's editable document title is the default PDF and `.resume`
  name. A successful job import/distill sets the shared header/export base to
  `Name_Company_Resume`, with `Name_Resume`, `Company_Resume`, and `Resume`
  fallbacks when job or resume metadata is unavailable.
- Masthead menus use labels at normal widths and familiar, evenly spaced icons
  at compact widths. The RoleFit wordmark and the Polish/Apply icon-and-label
  buttons remain visible throughout the supported range. The masthead stays
  57px tall across disclosure states and meets the studio/sidebar through one
  structural hairline; it never wraps or paints a false gap below itself. At
  720px and below, only the Resume tab's precise authoring surface is replaced
  by the non-dismissible width notice. Masthead/navigation, the simpler Cover
  letter page, Materials, Applications, and Analytics remain usable, including
  when browser zoom makes the effective viewport cross that threshold.

## Visual QA

For meaningful UI changes:

1. Run `npm run dev:rolefit` and open `http://localhost:5181` in Chrome.
2. Walk through the affected control in the normal navbar-inputs + studio workflow.
3. Confirm no console errors, overlap, unexpected layout shift, or
   broken keyboard path.
4. Capture a screenshot or describe the visual QA in the final response.

For tiny copy/class changes, use judgment. If Chrome QA is skipped, say
why.
