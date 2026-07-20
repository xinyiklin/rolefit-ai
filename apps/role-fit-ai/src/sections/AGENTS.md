# RoleFit UI Composition Guide

Applies to `apps/role-fit-ai/src/sections/`. Follow `PRODUCT.md`, `DESIGN.md`,
and `docs/engineering/ui-principles.md`.

## Ownership and reuse

- Reuse shared Typeset editor/toolbar/popover components for document behavior.
  RoleFit sections compose host navigation, job/AI controls, tracker, materials,
  review, and the RoleFit-only editor overlay.
- Reuse `NavMenu`, `MenuSection`, provider controls, dialog primitives, and
  `AiWorkflowProgress` for repeated host interactions. Do not introduce a
  second modal shell, provider picker, stage card, or status vocabulary.
- Provider selectors show only explicitly configured providers. Keep an
  unavailable configured selection visible but disabled with reconnect/setup
  guidance; never render an API-key field or silently choose a paid provider.
  With no provider, keep editing/tracker/export usable and direct setup to the
  companion.
- Keep components declarative. Network, storage, cross-tab, and pipeline state
  belong in hooks; components receive values and callbacks.
- Keep feature-specific composition near its tab/menu. Extract a shared section
  component only for demonstrated repetition or a stable interaction contract.
- Avoid mode-heavy components. Prefer a small base primitive plus explicit
  feature composition over unrelated boolean props.

## Shared editor boundary

- `ResumeTab` composes shared `DocumentToolbar`, `FormattingToolbar`, and
  `TypesetEditor` with RoleFit host actions and `RoleFitEditorOverlay`.
- Never fork shared editor markup or layout CSS for a host tweak. Add a narrow
  package seam and verify both apps.
- Structure controls stay outside editable DOM and must not affect PDF layout.

## UX rules

- Preserve the masthead + vertical studio navigation + tabbed workspace.
- Use app tokens/classes for host chrome and package styles for shared editor
  behavior. Document intentional overrides.
- Keep errors local, specific, and recoverable. Async stage UI must show exact
  step position, failure/stop state, Retry where valid, and later steps as not
  run.
- Preserve keyboard access, focus visibility, reduced motion, and non-color
  status cues.
- Follow flag-first browser QA for material layout/interaction changes.
