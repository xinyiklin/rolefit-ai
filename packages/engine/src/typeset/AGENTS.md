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
  and shared page geometry; `coverLetterBlocks.ts` owns the simpler plain
  paragraph stream. `blocks.ts` also owns the US-Letter page constants
  (`PAGE_WIDTH_BP`/`PAGE_HEIGHT_BP`) every renderer imports.
- `layout.ts` owns shared pagination and produces `LayoutDocument` for resume
  and cover-letter streams.
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
  Carry line-height metadata through tokenization and line breaking so each
  visual line resolves its own outgoing leading. Apply that delta at the next
  junction so a line-height override changes space below, never above, the
  targeted line. Before/after spacing remains a paragraph property resolved
  before composing vertical streams. A paragraph's LEFT indent is a third such
  property: it shifts every one of the paragraph's lines and narrows its measure
  by the same amount, which is what leading spaces cannot do — a wrapped line has
  no authored start to put them at. Shifting without narrowing would push text
  past the right margin in both the editor and the PDF. Each line also carries
  the leading it OWNS (`VLine.leading` → `PlacedLine.leading` → the painter's
  `--tsd-line-leading`): a renderer that needs the line BOX rather than the ink
  box cannot derive it from geometry, because the gap to the next line is that
  leading only inside a paragraph. Do not
  introduce screen-relative units into saved layout behavior.
- Preserve literal interior and trailing whitespace according to the shared
  engine model. Summary and cover-letter prose also preserves authored leading
  whitespace as indentation; ordinary marked resume bullets may trim accidental
  space after their marker. Do not fix one renderer independently.
- Runs with different families or sizes may share a line, but they share one
  engine baseline. The DOM painter may measure CSS face baselines at its
  browser-only boundary.
- Vertical placement is a function of the fonts and sizes on a line, never of the
  glyphs typed into it. A line carries its role-size ink footprint plus a
  rise/drop overflow derived from `faceExtent`, and pagination adds only that
  overflow to a calibrated junction. Typing a taller ascender or a deeper
  descender must not move any baseline, while an oversized inline run must still
  clear its neighbours' real ink. `inkExtent` remains for calibrated TeX row
  mechanics (the entry title/subtitle strut) — do not reintroduce it into
  spacing, page-top placement, page fit, or rule geometry.
- Line separation is layout, not text: a break consumes the interword glue and
  each painted line is its own box. Every renderer must emit `lineSeparators`'
  character at a line's end, or the browser's word iterator runs the last word of
  a line into the first word of the next and text derived from the paint loses
  the gap. Mark it so caret and selection helpers can exclude it — it belongs to
  no field.
- Underline and link rules come from `underlineSpans` plus `underlineRule`, so
  every renderer draws one rule per contiguous underlined phrase at one
  face-derived depth. Never derive a rule from the text a renderer happens to
  hold: the DOM painter groups merged style spans and the PDF emitter walks
  single runs, so a text-dependent rule silently disagrees between them.
- Normal prose uses optimal word/hyphen breaks. When a single token is wider
  than the text column, the emergency path may split it only at deterministic
  grapheme boundaries measured with the same font metrics; it must preserve
  every character, link, underline, and page-width bound across DOM and PDF.
  Inline family, size, and mark boundaries inside that token are not line-break
  opportunities; the emergency path must continue filling through them. When
  the next grapheme cannot fit the remaining width, move it intact to a new
  line; overflow is permitted only when that grapheme exceeds an empty column.
  An oversized token puts its whole paragraph on that path, so the path must
  still break the surrounding ordinary words at spaces and hyphens: only a
  token wider than the column may be split inside, and its inline style
  boundaries never decide where.
- `lib/fontFamilies.ts` is the ONE list of family ids. The persisted style enum,
  the inline `<font=…>` tag grammar in both automata, the toolbar menu, and this
  directory's face registry all derive from it. Never re-declare the set: a
  missed copy validates a file whose tags then fail to parse, or offers a family
  the codec rejects.
- Supported families are the metric-compatible trio Tinos (Times New Roman),
  Carlito (Calibri), and Arimo (Arial), then Source Serif 4, Source Sans 3, and
  Latin Modern — that is menu order, which is presentation only; ids are the
  persisted values. A new family requires bundled web and PDF faces, generated
  metrics, license text, and full editor/PDF parity verification.
- Each italic face declares `italicAngleDeg`, the slope its outlines are drawn
  at, taken from the shipped asset's `post.italicAngle` and checked against that
  table on disk by `font-assets.mjs`. It is the one font fact written by hand:
  the generated metrics do not carry it and the browser cannot report it. Upright
  faces are 0. The editor's caret overlay is the consumer.
- Metric compatibility is the contract for the trio: their per-character advances
  equal the proprietary original's, so a document keeps its line and page count
  elsewhere. Do not "improve" their metrics — a nicer number breaks the only
  reason to ship them.
- Those three are drawn on a 2048-unit em, so `metrics.gen.ts`'s integer 1000ths
  cannot represent every advance exactly. The residue is per glyph and bounded:
  `pdf-font-parity` allows `0.005bp/glyph` at 10bp for them and holds every
  1000-unit family to bit-exact parity, so a real shaping divergence still fails.
  Do not rescale their outlines to 1000/em to close the gap — that trades an
  invisible engine-vs-render difference for a visible break in metric
  compatibility.
- A face may alias another face's asset when the family genuinely has one design
  for both roles (`boldDisplay` on the static families). Keep the alias in both
  the generator's `FACE_ALIASES` and the registry so the shipped bytes, the
  metrics record, and the CSS declaration stay one thing.
- A caps face is built by rewriting the shipped font's cmap, never by asking a
  renderer for `font-variant: small-caps`: the engine measures what the cmap
  resolves to, so the substitution has to be in the asset for the browser, the
  PDF embedder, and the metrics to agree. Families without a usable `smcp`
  lookup get uniformly scaled capitals — the construction Latin Modern's own
  caps design uses.
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
