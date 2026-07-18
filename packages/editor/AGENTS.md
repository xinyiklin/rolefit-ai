# Typeset Editor Package Guide

Applies to `packages/editor/`. Read `README.md` and the root architecture guide.
Use the nested guides under `src/hooks/`, `src/components/`, and
`src/sections/editor/` for their focused contracts.

## Package Boundary

- Own the reusable React editing surface over `@typeset/engine`: document and
  style hooks, direct editing, selection/caret mapping, formatting controls,
  popovers, structure chrome, and shared editor styles.
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
- `src/styles/` owns shared editor/tooling base CSS. Keep host shell rules in the
  apps; document intentional host seams and preserve import-order expectations.
  One such seam: a host may set `data-toolbar-labels="text"` on the wrapper
  around the toolbar to opt into label-first disclosure (see the
  `[data-toolbar-labels="text"]` rules co-located with the default disclosure
  bands in `src/styles/toolbar.css`); a host that never sets the attribute is
  unaffected.
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
