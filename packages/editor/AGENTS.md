# Typeset Editor Package Guide

Applies to `packages/editor/`. Read `README.md` and the root architecture guide.
Use the nested guides under `src/hooks/`, `src/components/`, and
`src/sections/editor/` for their focused contracts.

## Package Boundary

- Own the reusable React editing surface over `@typeset/engine`: document and
  style hooks, direct editing, selection/caret mapping, formatting controls,
  optional structure chrome, and shared editor styles. Hosts may select a
  document layout kind and disable structure chrome for constrained prose.
- Depend only on the engine and general UI dependencies. Never import an app or
  encode provider, tracker, job, workspace, autosave, file-lifecycle, or product
  navigation behavior.
- Expose values, callbacks, narrow slots, and stable primitives. Avoid hidden
  storage/network access, product-mode flags, and unrelated boolean prop sets.
- Preserve dependency direction: engine <- editor <- apps.

## Reuse And Styling

- Share an interaction when both hosts need the same state and accessibility
  contract. Keep host composition, copy, and lifecycle in its app.
- Extend the smallest existing primitive before adding a parallel toolbar,
  popover, control, option list, or style vocabulary.
- `FormattingToolbar.documentStyleTools` is the explicit document-grammar seam:
  leaving it undefined mounts the resume style menus; supplying it replaces
  that complete menu group while preserving the common editing controls. Keep
  document-specific menu composition in the host instead of adding mode flags
  to the shared toolbar.
- `src/styles/` owns shared editor/tooling base CSS. Keep host shell rules in the
  apps; document intentional host seams and preserve import-order expectations.
  One such seam: a host may set `data-toolbar-labels="icon"` on the wrapper
  around the toolbar to render the document-style menus, and any host
  document-structure controls mounted with them, as icons at every width (see the
  `[data-toolbar-labels="icon"]` rules beside the disclosure ladder in
  `src/styles/toolbar.css`); a host that never sets the attribute keeps the
  default labels-until-1210px behavior.
- The formatting row never scrolls and must never be allowed to overflow — a
  RoleFit ancestor clips horizontally, so an overflowing row silently drops its
  trailing control. The disclosure ladder in `src/styles/toolbar.css` therefore
  carries measured thresholds: each stage's threshold is the intrinsic width of
  the control set still inline above it. Re-measure the whole ladder in a browser
  after adding a control to this row or widening an existing one; do not add a
  threshold by estimate.
- Components remain controlled and declarative. Hooks own cohesive serializable
  state transitions; DOM selection and geometry remain in the editor adapter.
- Extract by stable responsibility or test seam, not to chase a line-count
  target. Do not add pass-through wrappers or catch-all configurable controls.

## Verification

Run from the repository root:

```bash
npm run check --workspace packages/editor
npm run eval:editor --workspace packages/editor
```

A public hook, component, or CSS-contract change requires both app builds and
browser checks for every materially affected host. Accessibility and selection
behavior are part of the public contract.
