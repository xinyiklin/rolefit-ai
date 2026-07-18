# Typeset Engine Package Guide

Applies to `packages/engine/`. Read `README.md` and the root architecture guide.
Use `src/lib/AGENTS.md` for resume-domain/file work and
`src/typeset/AGENTS.md` for layout, fonts, rendering, and PDF work.

## Package Boundary

- Own one canonical `ResumeData`, document-style contract, `.resume` codec,
  font registry/assets, measurement model, layout, DOM/print painter, and PDF
  emitter for every consumer.
- Keep domain and layout logic deterministic and React-free. The intentional
  exception is `src/typeset/render/dom.tsx`; Node consumers must be able to
  import domain subpaths without loading React.
- Depend on no app and no editor package. Do not add provider, tracker,
  navigation, browser-storage, or host lifecycle knowledge.
- Export focused source subpaths. Avoid a broad barrel that hides ownership,
  increases server import risk, or creates cycles.

## Maintainability

- One value or grammar gets one owner. Extend the canonical type, option list,
  unit conversion, inline-mark grammar, or layout constant instead of copying
  it into another renderer or app.
- Separate pure transforms from I/O and rendering. Portable file validation
  happens before hydration; renderer backends consume shared layout output.
- Keep generated files reproducible. Never hand-edit mirrored app fonts or
  `metrics.gen.ts`; change the generator/source and verify committed output.
- Do not add compatibility layers for hypothetical or unshipped file versions.
  Schema evolution requires an explicit version/migration decision and round-
  trip tests.
- Preserve every consumer's validation, privacy, deterministic output, and
  import contract when extracting or changing a helper.

## Verification

Run from the repository root:

```bash
npm run check --workspace packages/engine
npm run eval:resume-file --workspace packages/engine
npm run eval:pdf-font-parity --workspace packages/engine
```

Engine public-contract changes require affected editor and app checks. Layout,
font, or PDF changes require rendered-output evidence, not only typechecks.
