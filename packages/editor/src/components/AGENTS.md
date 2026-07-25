# Editor Chrome Guide

Applies to `src/components/`. Follow the repository root guide first. Visual
rules live in `DESIGN.md`; these are the structural conventions for the
application chrome (never the resume page itself, which the typeset engine
paints).

## Module Ownership

- `Modal.tsx` owns the single dialog shell: dimmed backdrop, focus trap,
  Escape/backdrop close. It delegates the reusable modal keyboard/stacking
  contract to `hooks/useModalFocus.ts`. Callers fill the body via
  `.modal__body` / `.modal__foot`.
- `Popover.tsx` owns the anchored non-modal disclosure used by every toolbar
  menu: trigger wiring, controlled/uncontrolled open state, focus and
  outside-click behavior.
- `toolbar/DocumentToolbar.tsx` owns the shared document/header row: optional
  product identity, document metadata, structure controls, and a host action
  slot. Embedded apps omit the Typeset product name and keep their own file
  lifecycle.
- `toolbar/FormattingToolbar.tsx` owns the shared formatting row and forwards
  state and callbacks; it holds no document state of its own. Host apps may
  mount it beneath `DocumentToolbar` inside their editing surface. Its only
  local state is the responsive More disclosure: document-style labels
  disappear first, then their menu icons move into a compact anchored overlay;
  alignment joins at the next narrower threshold, and selection typography only
  at the narrow supported edge. Zoom remains visible before the font-family
  control. Opening More never changes toolbar or editor geometry. A popover
  opened from INSIDE the More panel anchors below the whole panel, not to the
  fixed slot under the toolbar the narrow-viewport rules use — that slot is
  where the open panel sits, so a popover took it and painted over the row of
  buttons the user had just opened. Its trigger goes `position: static` so the
  surface resolves against the panel and clears every wrapped row.
- `Popover` measures the room between its trigger and the window bottom on open
  and publishes it as `--popover-space` on the surface. Every panel is bounded
  by it, because a viewport-fraction cap (`calc(100vh - 116px)`) assumes the
  panel starts just under the toolbar and a trigger further down puts its END
  past the window. That is not merely clipping: an absolutely positioned
  descendant extends its scroll container's scrollable area, so an over-long
  panel makes the host scrollable and shifts the document under it. A panel with
  its own scrolling body applies the value to that body and subtracts
  `--popover-frame` (the surface's border), so there is never a scrollbar inside
  a scrollbar. The optional
  `documentStructureTools` slot lets an embedded host place Header/Section
  controls immediately before the document-style group while standalone
  Typeset keeps them in `DocumentToolbar`. The optional
  `documentStyleTools` slot replaces the complete default resume-style menu
  group for another document grammar; it does not replace history, zoom,
  selection typography, marks, alignment, links, or spell-check.
- `toolbar/TopToolbar.tsx` composes the standalone Typeset document row with
  its file actions and `FormattingToolbar`.
- `toolbar/styleOptions.ts` owns toolbar option lists and preset helpers
  (alignment options, heading-case options, contact dividers, spacing groups).
  Domain-level option lists live with their model instead:
  `SECTION_TYPE_OPTIONS` in `lib/resumeData.ts`, `FONT_FAMILY_OPTIONS` and
  `DOC_ZOOM_OPTIONS`/`nextZoomOption` in `lib/documentStyle.ts`.
- One popover component per toolbar menu: `SpacingStylePopover`,
  `ParagraphStylePopover`, `TextStylesPopover`, `PageStylePopover`, and
  `DocumentStructureControls` (Header + Add section). Do not re-fuse menus
  behind mode props. Document-specific menu compositions passed through
  `documentStyleTools` remain in their host until another consumer demonstrates
  a genuinely shared contract.
- `toolbar/StyleRange.tsx`, `toolbar/FontFamilyControl.tsx`, `toolbar/FontSizeControl.tsx`,
  `toolbar/ToolbarButton.tsx`, and `toolbar/LinkControl.tsx` are the shared
  control primitives. FontFamilyControl owns the portaled family list used by
  selection typography and per-field Styles rows; `ZoomControl.tsx` owns the
  editable percent combobox and preset list.

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
- Committing a font-family or font-size menu choice returns focus through the
  host-provided editor callback to the saved page caret or range. Escape still
  returns to the menu trigger, and merely editing a numeric draft does not make
  toolbar controls reach into the editor DOM.
- Toolbar rows and type use fixed values across responsive states. Use the
  `typeset-toolbar` container queries for progressive disclosure; do not shrink
  type, control widths, row padding/gaps, crop controls, or restore horizontal
  scrolling as a breakpoint fix.
- The content-sized document title keeps one 36ch ceiling across breakpoints.
  Let flexbox shrink it only when neighboring controls exhaust the real row
  width; do not introduce breakpoint-specific filename caps.
- Numeric text inputs follow the draft pattern: local draft state, commit on
  blur/Enter (parse, clamp, round), reset on Escape. Each control keeps its
  own units and precision; there is deliberately no shared draft-input hook.
- Zoom's Fit option is a real display state: the compact control reads `Fit`
  until a typed/preset percentage replaces it, and refits after viewport
  changes settle.

## Verification

Run `npm run check --workspace packages/editor` after component or prop-contract
changes, then build both affected apps. Check material toolbar/popover changes
in each affected host: keyboard focus order, popover open/close and
outside-click behavior, and the relevant responsive states.
