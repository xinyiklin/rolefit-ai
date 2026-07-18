# Typeset App Guide

Applies to `apps/typeset/`. Read the root guide plus `PRODUCT.md` and
`DESIGN.md` before changing the standalone product shell.

## Ownership

- `src/App.tsx` composes the shared engine/editor with file lifecycle,
  filename state, browser autosave, view preferences, export, and Typeset
  identity.
- `scripts/sync-fonts.mjs` mirrors the engine-owned fonts into generated
  `public/fonts/` before development and builds.
- `vite.config.ts`, `Dockerfile`, and app metadata own the static Typeset
  runtime and deployment.
- `@typeset/engine` owns the document model, strict `.resume` codec, layout,
  fonts, print painting, and PDF output.
- `@typeset/editor` owns document/history/style hooks, direct editing,
  formatting controls, popovers, and shared editor styles.

Do not recreate package behavior inside the app. When a shared contract needs
to change, edit its owner and verify both application consumers.

## Product Invariants

- Typeset is browser-only and static. Do not add a server, AI, analytics,
  accounts, remote persistence, or resume-data requests without explicit user
  approval.
- `.resume` is the sole portable editable format; PDF is final output.
- Autosave is recovery state, not a replacement for an explicitly saved file.
- Zoom and spell-check are view preferences and never cross the file boundary.
- The editor, browser print path, and dedicated PDF emitter share one document,
  style, font, metrics, and layout contract.

## Modularity And UI

- Keep `App.tsx` as composition. Extract deterministic file/name transforms or
  cohesive browser side effects when they have a stable contract or test seam.
- Do not create pass-through wrappers merely to reduce line count. Prefer the
  shared component directly with narrow host callbacks or slots.
- Typeset owns file/status chrome and host composition. Shared toolbar/page
  behavior belongs in `packages/editor`; measurement and PDF behavior belongs
  in `packages/engine`.
- App CSS may style the surrounding shell and deliberate host seams. It must
  not fork shared editor geometry, selection behavior, or document layout.
- Preserve keyboard access, visible focus, compact-width editing, and literal
  file/error status.

## Commands And Verification

Run from the repository root:

```bash
npm run dev:typeset
npm run build:typeset
npm run check --workspace apps/typeset
```

Shared engine/editor changes require their focused checks plus both app builds.
File work requires save/open round trips and malformed-input rejection. Layout,
toolbar, or PDF changes require real browser/rendered-output evidence.
