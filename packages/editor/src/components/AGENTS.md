# Editor Chrome Guide

Applies to `src/components/`. Follow the repository root guide first. Visual
rules live in `DESIGN.md`; these are the structural conventions for the
application chrome (never the resume page itself, which the typeset engine
paints).

## Module Ownership

- `Modal.tsx` owns the single dialog shell: dimmed backdrop, focus trap,
  Escape/backdrop close. Callers fill the body via `.modal__body` /
  `.modal__foot`.
- `Popover.tsx` owns the anchored non-modal disclosure used by every toolbar
  menu: trigger wiring, controlled/uncontrolled open state, focus and
  outside-click behavior.
- `toolbar/TopToolbar.tsx` composes the two toolbar rows and forwards state
  and callbacks; it holds no document state of its own.
- `toolbar/styleOptions.ts` owns toolbar option lists and preset helpers
  (alignment options, heading-case options, contact dividers, spacing groups).
  Domain-level option lists live with their model instead:
  `SECTION_TYPE_OPTIONS` in `lib/resumeData.ts`, `FONT_FAMILY_OPTIONS` and
  `DOC_ZOOM_OPTIONS`/`nextZoomOption` in `lib/documentStyle.ts`.
- One popover component per toolbar menu: `SpacingStylePopover`,
  `ParagraphStylePopover`, `TextStylesPopover`, `PageStylePopover`, and
  `DocumentStructureControls` (Header + Add section). Do not re-fuse menus
  behind mode props.
- `toolbar/StyleRange.tsx`, `toolbar/FontSizeControl.tsx`,
  `toolbar/ToolbarButton.tsx`, and `toolbar/LinkControl.tsx` are the shared
  control primitives; `ZoomControl.tsx` owns the zoom group.

## Conventions

- Toolbar components consume `DocStyleControls` (from `hooks/useDocStyle`) and
  reducer callbacks; they never write storage or reach into the editor DOM.
- Dependency direction: components may import from `lib/` and `hooks/`, never
  from `sections/` or `typeset/`. Editor modules must not import from here.
- Style popovers are headerless; sections use `.style-popover__section-title`.
  Popover/toolbar CSS lives in `styles/toolbar.css` (chrome) and
  `styles/popovers.css` (surfaces); popovers.css must stay imported after
  toolbar.css.
- Formatting buttons that act on the page selection prevent mousedown focus
  transfer so the selection survives the click.
- Numeric text inputs follow the draft pattern: local draft state, commit on
  blur/Enter (parse, clamp, round), reset on Escape. Each control keeps its
  own units and precision; there is deliberately no shared draft-input hook.

## Verification

Run `npm run build` after component or prop-contract changes, and check
material toolbar/popover changes in a real browser: keyboard focus order,
popover open/close and outside-click behavior, and the 720px/900px responsive
states.
