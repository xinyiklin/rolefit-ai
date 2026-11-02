# Shared Editor State Guide

Applies to `packages/editor/src/hooks/`. These hooks own reusable document and
style state; app lifecycle and persistence policy remain in the apps.

## Ownership

- `useResumeEditor.ts` owns structured document state, reducer transitions,
  bounded history, dirty state, typing coalescing, and public editor actions.
- `useDocStyle.ts` owns persisted document-style state plus local view controls
  required by the shared toolbar/editor. The engine's document-style contract
  remains the canonical model. It also persists the saved spacing-preset list
  (pure list rules in `spacingPresets.ts`), which is a local preference that
  never enters document files or history.
- `useModalFocus.ts` owns the cross-host modal keyboard/stacking contract:
  focus entry and restoration, Tab containment, topmost-only Escape handling,
  and background-scroll locking. Hosts retain their own dialog markup/styles.
  A close handler may send focus elsewhere (for example back to the editor),
  but it must close the dialog first and move focus second: the trap re-checks
  in a microtask, and closing restores focus only when it fell to the body or a
  removed element.

## Rules

- Keep reducer transitions explicit, deterministic, serializable, and atomic.
  One visible edit or structural action produces one history step.
- Typing and held-key deletion coalesce into word-processor-sized undo steps,
  not whole bursts: a run ends at an idle pause, a word boundary in the
  gesture's own direction, or the group character cap. Callers report the
  characters an edit moved through `historyText`; an edit that omits it still
  advances the cap, so no burst can grow into one unbounded undo step.
- Content and print-style reducers share one `createHistoryClock()` per
  document. Never couple separate editors through module-global history state;
  a new transaction after Undo invalidates Redo in both reducers. Sequence
  allocation must be idempotent for the same state/action pair because React
  Strict Mode may invoke a reducer twice before committing either result.
  Both hooks read the redo branch through `useSyncExternalStore` on the clock:
  either reducer can advance it after the other hook has already rendered.
- One gesture that changes both content and style (a document alignment that
  clears per-paragraph overrides, Reset text formatting) runs its dispatches
  inside `docStyle.groupHistory`. Each hook stamps the open group's id on the
  action at dispatch, because the reducers run after the gesture returns; the
  first member to reduce allocates the sequence and the others reuse it. Equal
  content and style sequences mean one step: `historySourceFor` returns
  `"both"` and the editor undoes or redoes both sources on one press. A grouped
  step never coalesces with a neighbor. Group only one synchronous gesture,
  and keep it the only history dispatch in its batch (a style edit queued in
  the same render could reduce between its members); whoever dispatches to both
  sources owns the group, and nesting joins the outer group.
- The existing history-clock generation also identifies document replacement
  for input replay. `actions.getDocumentGeneration()` exposes that read-only
  boundary; the editor discards queued input and pending caret restoration from
  an older generation before touching the replacement document.
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
