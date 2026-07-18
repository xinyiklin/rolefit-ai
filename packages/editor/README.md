# @typeset/editor

Private React workspace package containing the direct resume editor and shared
document chrome used by Typeset and RoleFit AI. It depends on
`@typeset/engine` and has no app-specific provider, tracker, file-lifecycle, or
navigation behavior.

## Owns

- `src/hooks/`: document/history reducer state, document/view-style controls,
  and the host-agnostic stacked-modal focus contract.
- `src/sections/editor/`: contenteditable interception, structured commits,
  selection/caret mapping, context commands, and structure overlays.
- `src/components/`: modal/popover primitives and the shared document and
  formatting toolbar family.
- `src/styles/`: shared editor/tooling tokens, toolbar/popover/modal styles,
  document paint styles, and print rules. Host shell styles stay in each app.

Host apps compose the package through values, callbacks, and narrow slots:
Typeset supplies file lifecycle and product identity; RoleFit supplies its own
document actions and the section-scope/review overlay.

## Checks

Run from the repository root:

```bash
npm run check --workspace packages/editor
npm run eval:editor --workspace packages/editor
```

After a public component/hook contract change, build both apps and browser-check
the affected hosts. Read package `AGENTS.md` and the nearest nested guide before
editing.
