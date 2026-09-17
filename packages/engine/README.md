# @typeset/engine

Private workspace package containing the canonical resume domain, constrained
cover-letter document adapter, and deterministic typesetting engine shared by
Typeset and RoleFit AI.

## Owns

- `src/lib/`: `ResumeData`, document style/typography, inline marks and links,
  the sole strict `.resume` schema v1, the sole strict `.cover` schema v1,
  explicit optional document headers, and download helpers.
- `src/typeset/`: schema adapter, measurement, line breaking, blocks,
  shared pagination, resume and plain-paragraph cover-letter composition,
  DOM/print rendering, and client-side PDF emission.
- `fonts/` and `scripts/`: bundled faces, licenses, generated metrics, and
  reproducible font tooling. Browser assets remain WOFF2; PDF siblings are
  TrueType sfnt files, including metric-preserving Latin Modern conversions.

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

Standard entry rows retain their four required field keys: paired strings
represent present title/subtitle rows; paired nulls represent removed rows.
Existing string-valued `.resume` files retain their output. Older builds reject
new files containing null row values; no file migration or schema-version bump
is needed for the expanded current v1 value contract.

Section titles wrap at the full text width, retaining heading case and alignment,
with one section rule after the last continuation. Long title/subtitle fields wrap inside their paired row. A short date or location
keeps its natural width; two long fields share the remaining width. Names and
individual contact values wrap across the full header width. Wrapping preserves
authored text, marks, links, and fitting paired-row geometry, and oversized heading
groups can continue on another page. An indivisible glyph wider or taller than
the available page area remains outside the supported geometry; typography is
never silently shrunk.

Header page placement reserves font-face metrics rather than the ink of typed
letters. Names and contacts keep stable baselines while typing at the same font,
size and wrap count, including an empty name's first character. This corrects
the former text-dependent header offset in the editor, browser print and PDF.

The selectable DOM follows logical field order across physical lines and pages.
PDF text operators follow field order within each page, while PDF readers may
apply their own geometric reading order and line separators.

## Checks

Run from the repository root:

```bash
npm run check --workspace packages/engine
npm run eval:resume-file --workspace packages/engine
npm run eval:cover-letter-file --workspace packages/engine
npm run eval:pdf-font-parity --workspace packages/engine
npm run fonts:check --workspace packages/engine
```

Read `AGENTS.md` first, then `src/lib/AGENTS.md` for domain/file work or
`src/typeset/AGENTS.md` for layout/font/PDF work. Shared contract changes also
require affected app checks; see root `docs/architecture.md`.
