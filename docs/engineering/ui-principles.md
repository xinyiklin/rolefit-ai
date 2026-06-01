# UI Principles

Role-Fit AI should feel like a compact desktop-first job-prep workspace:
calm, dense, and focused on the resume-polishing workflow. It is not a
marketing landing page, a SaaS dashboard, or a native desktop installer.

## Source Of Truth

- Reuse primitives from `src/ui.tsx` (`ScoreMeter`, `Stat`, `ChipList`,
  `PanelHeading`).
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
  `npm run dev`. (Sibling reservations: careflow `5173-5180`, portfolio
  `5184-5185`.)

## Workflow Shape

Preserve the two-column workflow:

- left column: job target (link + description) and resume source
  (DOCX upload, text paste, or workspace base-resume)
- right column: polished output, before/after review, version vault, and
  optional cover letter, organized into tabbed views

When changing one panel or tab, preserve the others' layout and labels
unless the task explicitly touches them.

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

- Default provider is OpenAI Responses API.
- First-class provider choices: Claude, Gemini, OpenRouter, Groq,
  Together AI, Mistral AI, and Local/custom.
- The Model control changes with the selected provider; keep a
  **Custom model** escape hatch for newer model IDs.
- One-request `apiKey`, `provider`, `apiBaseUrl`, and `model` values
  from the local UI must not be persisted in browser storage.

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

## Visual QA

For meaningful UI changes:

1. Run `npm run dev` and open `http://localhost:5181` in Chrome.
2. Walk through the affected control in the normal two-column workflow.
3. Confirm no console errors, overlap, unexpected layout shift, or
   broken keyboard path.
4. Capture a screenshot or describe the visual QA in the final response.

For tiny copy/class changes, use judgment. If Chrome QA is skipped, say
why.
