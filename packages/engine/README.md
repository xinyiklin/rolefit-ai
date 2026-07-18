# @typeset/engine

Private workspace package containing the canonical resume domain and
deterministic typesetting engine shared by Typeset and RoleFit AI.

## Owns

- `src/lib/`: `ResumeData`, document style/typography, inline marks and links,
  strict `.resume` schema v1 validation/serialization, and download helpers.
- `src/typeset/`: schema adapter, measurement, line breaking, blocks,
  pagination, DOM/print rendering, and client-side PDF emission.
- `fonts/` and `scripts/`: bundled faces, licenses, generated metrics, and
  reproducible font tooling.

The package exports raw TypeScript source through explicit subpaths. Consumers
include the file extension, for example:

```ts
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
```

The Node RoleFit server must import only React-free domain subpaths. The DOM
renderer is the intentional React boundary.

PDF hosts call `fetchFontBytes(document, fontAssetBaseUrl)` with their explicit
deployment-aware public font base. The engine intentionally has no domain-root
fallback because a consumer may be hosted below a path prefix.

## Checks

Run from the repository root:

```bash
npm run check --workspace packages/engine
npm run eval:resume-file --workspace packages/engine
npm run eval:pdf-font-parity --workspace packages/engine
npm run fonts:check --workspace packages/engine
```

Read `AGENTS.md` first, then `src/lib/AGENTS.md` for domain/file work or
`src/typeset/AGENTS.md` for layout/font/PDF work. Shared contract changes also
require affected app checks; see root `docs/architecture.md`.
