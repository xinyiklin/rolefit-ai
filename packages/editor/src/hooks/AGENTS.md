# Shared Editor State Guide

Applies to `packages/editor/src/hooks/`. These hooks own reusable document and
style state; app lifecycle and persistence policy remain in the apps.

## Ownership

- `useResumeEditor.ts` owns structured document state, reducer transitions,
  bounded history, dirty state, typing coalescing, and public editor actions.
- `useDocStyle.ts` owns persisted document-style state plus local view controls
  required by the shared toolbar/editor. The engine's document-style contract
  remains the canonical model.
- `useModalFocus.ts` owns the cross-host modal keyboard/stacking contract:
  focus entry and restoration, Tab containment, topmost-only Escape handling,
  and background-scroll locking. Hosts retain their own dialog markup/styles.

## Rules

- Keep reducer transitions explicit, deterministic, serializable, and atomic.
  One visible edit or structural action produces one history step.
- Prefer derived state over synchronized copies. Use refs only for transient
  controller values that should not trigger presentation.
- Hooks do not own app files, autosave destinations, provider settings, tracker
  state, or network requests. Apps decide when/how shared state is persisted.
- Reuse engine constructors and style normalization; do not create parallel
  document/style representations in React state.
- Keep public actions intent-based. Avoid exposing setters that let hosts bypass
  history, dirty-state, normalization, or invariants.
- A new shared hook needs a stable cross-app responsibility, not merely reduced
  line count in one host.

## Verification

Run `npm run check --workspace packages/editor`. Reducer/history behavior should
be covered by the editor eval or a focused deterministic probe. Public contract
changes require both app builds.
