# Deterministic Typesetting Guide

Applies to `src/typeset/`. Also read it when changing engine font-generation
scripts or `packages/engine/fonts/`, because those assets implement this directory's measurement
contract. Follow the repository root guide first.

## Module Ownership

- `schema.ts` owns the exact provenance-bearing layout input and the sole
  `ResumeData` -> typesetting adapter.
- `types.ts` owns engine run, field-provenance, and line-item contracts.
- `fontRegistry.ts` owns supported document families, faces, and asset paths,
  plus the engine-facing `DocumentFontFamily` name (an alias of the persisted
  `FontFamily` union in `lib/documentStyle.ts`) and its defensive coercion.
- `metrics.gen.ts` is generated committed measurement data; never hand-edit it.
- `measure.ts` owns face selection, glyph measurement, modeled ligatures, inline
  mark segmentation, paragraph items, and underline geometry.
- `linebreak.ts` owns deterministic paragraph breaking.
- `blocks.ts` converts the resume schema and document style into vertical lines
  and shared page geometry, and owns the US-Letter page constants
  (`PAGE_WIDTH_BP`/`PAGE_HEIGHT_BP`) every renderer imports.
- `layout.ts` owns pagination and produces `LayoutDocument`.
- `render/dom.tsx` paints selectable DOM used by the editor and browser print.
- `pdf/emit.ts` serializes `LayoutDocument` to PDF bytes, embedded fonts, vector
  rules, and link annotations.

Do not copy measurement, geometry, line breaking, link, whitespace, or formatting
rules into a renderer. Add behavior to the earliest shared owner that can express
it truthfully.

## Deterministic Contract

- `schema.ts`, the exact document-style contract, and `LayoutDocument` are the
  shared path for the editor, browser print, and dedicated PDF export.
- The DOM and PDF may differ only in backend painting mechanics. They must agree
  on glyph advances, positions, baselines, rules, links, alignment, whitespace,
  and pagination.
- Keep the core deterministic and independent of React/DOM globals. DOM-specific
  work stays in `render/dom.tsx`; PDF-library work stays in `pdf/emit.ts`.
- Preserve provenance ids needed for caret/selection mapping without writing
  session ids into portable files.
- Store print geometry in physical points and line height as a unitless value.
  Do not introduce screen-relative units into saved layout behavior.
- Preserve literal interior and trailing whitespace according to the shared
  engine model. Do not fix one renderer independently.
- Supported families are Latin Modern, Source Serif 4, and Source Sans 3. A new
  family requires bundled web and PDF faces, generated metrics, license text,
  and full editor/PDF parity verification.
- PDF font loading receives a deployment-aware asset base from each host. Do
  not restore a domain-root `/fonts/` default inside the engine.

## Font And Shaping Pipeline

- `scripts/generate_font_assets.py` is the pinned, checksum-verified source for
  WOFF2 assets and `metrics.gen.ts`.
- `scripts/generate_pdf_fonts.py` derives PDF-embeddable OTF/TTF siblings from
  the committed WOFF2 files and must fail if the sources contain shaping the
  engine does not model.
- Browser fonts, PDF fonts, and committed metrics share one shaping model:
  `liga` is limited to `ff`, `fi`, `fl`, `ffi`, and `ffl`; unmodeled default-on
  GSUB behavior is removed; GPOS kerning retains only modeled pure pairs.
- Latin Modern's full OpenType/CFF programs must be declared as
  `CIDFontType0` + `FontFile3`/`OpenType` in emitted PDFs. Keep the identity
  CID-to-GID map used by the engine's glyph ids; `pdf-roundtrip.mjs` locks the
  declaration, searchable text layer, and exact run positions.
- Do not patch generated fonts or metrics by hand. Change the pinned generator,
  regenerate all affected artifacts, and preserve license/checksum provenance.

## Verification

Choose checks based on the changed boundary:

- Any engine change: run the narrowest deterministic probe and
  `npm run check --workspace packages/engine`.
- Font, metrics, measurement, or PDF emitter change: run
  `npm run eval:pdf-font-parity --workspace packages/engine`.
- Font pipeline change: run `npm run fonts:check --workspace packages/engine`;
  regenerate both web/metrics assets and PDF fonts when the WOFF2 contract changes.
- Layout or DOM paint change: inspect representative editor pages in a real
  browser, including selection/caret behavior where provenance is involved.
- Browser-print change: inspect print media/preview and confirm chrome exclusion,
  pagination, fonts, marks, rules, alignment, links, and whitespace.
- Dedicated PDF change: export and render the emitted PDF, then compare fonts,
  marks, links, rules, alignment, whitespace, and page breaks with the editor.
- Broad engine work: run the engine check plus both affected app builds after
  the focused probes.

Do not claim parity from build success alone. Report which consumers and font
families were actually exercised.
