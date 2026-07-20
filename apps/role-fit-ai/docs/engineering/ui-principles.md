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

Preserve the navbar-inputs + full-width studio workflow (the former left
inputs pane was folded into the masthead by explicit user request,
2026-06-09):

- masthead (navbar): a standalone Sessions menu for concurrent job tabs first,
  followed by Resume source (workspace
  base-resume, upload, source text), Job target (link + description), the AI
  provider, and polish Options — plus the primary Polish action and Apply
- studio (full width): the tabbed output views — Resume (the engine-painted
  page is the sole editor, so what you see is exactly what exports — it is its
  own live preview, so there is no separate compile-preview; its margin
  controls own add/remove/reorder, section type, and per-section tailor scope;
  the suggestion/recruiter-review rail docks beside it post-polish), Materials (cover letter
  + application questions), Applications (table / board / calendar tracker
  views), Analytics — plus the template/export rail below

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
- `@typeset/engine` owns the resume model, `.resume` codec, deterministic
  layout, fonts, print painting, and PDF emission.
- RoleFit owns the masthead, studio navigation, AI workflow, review rail,
  tracker, and its narrow editor overlay for section scope and review targets.
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
- The AI menu is split into Distill, Tailor, and Review sections. Each
  section owns a concrete provider/model/effort config; **Copy from** is a
  one-shot sync between stages, not a live link.
- Keep all three sections expanded together. There is no section toggle,
  collapsed summary, or persisted open/collapse preference; the user can scan
  and edit all three stage configurations without changing view state.
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
  stores, renders, or submits them. The AI menu shows only explicitly added
  providers and makes an added-but-unready provider visibly unavailable.
  Antigravity may be request-eligible as **Ready to verify** while its auth
  state remains unknown; never describe that state as signed in.

## Interaction

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
  Remove formatting-menu labels first, move their icons into the anchored More
  overlay, then move alignment at the next narrower threshold. Header labels
  for Header, Section, and Export remain visible throughout RoleFit's supported
  range. The overlay never consumes editor space; do not shrink type or add a
  horizontally cropped toolbar.
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
  by the non-dismissible width notice. Masthead/navigation and Materials,
  Applications, and Analytics remain usable, including when browser zoom makes
  the effective viewport cross that threshold.

## Visual QA

For meaningful UI changes:

1. Run `npm run dev:rolefit` and open `http://localhost:5181` in Chrome.
2. Walk through the affected control in the normal navbar-inputs + studio workflow.
3. Confirm no console errors, overlap, unexpected layout shift, or
   broken keyboard path.
4. Capture a screenshot or describe the visual QA in the final response.

For tiny copy/class changes, use judgment. If Chrome QA is skipped, say
why.
