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
- `metrics.gen.ts` and `metrics/<family>.gen.ts` are generated committed
  measurement data; never hand-edit them. Each family's tables are their own
  lazy module, packed (one `JSON.parse` string, alias faces by name,
  class-matrix pair kerning) because an object literal of every family's tables
  cost the type checker over 1 GB, and one eager module shipped about 5 MB
  before the first page could even request its fonts. Keep each payload a
  string.
- `metrics.ts` owns loading a family's module on demand and unpacking a face
  into `FaceMetrics` lookup records on first use; the registry's `metrics`
  getter is the only reader. The contract: layout throws on unloaded metrics,
  so await `ensureLayoutMetrics(schema, style)` (the document's families and
  their glyph-fallback families) before any layout; evals may await
  `ensureAllFontMetrics` once instead.
- `measure.ts` owns face selection, glyph measurement, modeled ligatures, inline
  mark segmentation, paragraph items, and underline geometry.
- `linebreak.ts` owns deterministic paragraph breaking.
- `blocks.ts` converts the resume schema and document style into vertical lines
  and shared page geometry; `coverLetterBlocks.ts` owns the simpler plain
  paragraph stream. `blocks.ts` also owns the US-Letter page constants
  (`PAGE_WIDTH_BP`/`PAGE_HEIGHT_BP`) every renderer imports.
- `layout.ts` owns shared pagination and produces `LayoutDocument` for resume
  and cover-letter streams.
- `render/dom.tsx` paints physical pages/rules; `render/logicalFields.tsx` paints
  selectable field-ordered inline text for the editor and browser print.
  `render/segments.ts` groups measured word runs without changing layout.
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
  work stays under `render/`; PDF-library work stays in `pdf/emit.ts`.
- Absent standard-entry rows emit no lines or gaps. The first remaining title,
  subtitle, or bullet owns the section/entry junction; title-subtitle and
  head-bullet gaps apply only when both sides exist. Fully empty entries do not
  consume pagination state. Blank present rows retain their editable provenance.
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
  leading only inside a paragraph. Paragraph rows likewise carry authored
  before-space on their first visual line and after-space on their last visual
  line through `VLine`/`PlacedLine` into DOM custom properties. This metadata is
  selection provenance at ordinary junctions. At a page start, authored
  before-space also shifts the first baseline because there is no preceding
  junction to carry it; this keeps editor, print, and PDF behavior truthful.
  Do not introduce screen-relative units into saved layout behavior.
- Preserve literal interior and trailing whitespace according to the shared
  engine model. Summary and cover-letter prose also preserves authored leading
  whitespace as indentation; ordinary marked resume bullets may trim accidental
  space after their marker. Do not fix one renderer independently.
- Runs with different families or sizes may share a line, but they share one
  engine baseline. The DOM painter may measure CSS face baselines at its
  browser-only boundary.
- Vertical placement is a function of the fonts and sizes on a line, never of the
  glyphs typed into it. A line carries the ink footprint of a fixed reference
  string (`Agjpqy`) in its role font and size, never of its typed text, plus a
  rise/drop overflow derived from `faceExtent`, and pagination adds only that
  overflow to a calibrated junction. Typing a taller ascender or a deeper
  descender must not move any baseline, while an oversized inline run must still
  clear its neighbours' real ink. `inkExtent` remains for calibrated TeX row
  mechanics (the entry title/subtitle strut) — do not reintroduce it into
  spacing, page-top placement, page fit, or rule geometry.
- Line separation is layout provenance: `GlyphRun.breakAfter` records consumed
  space, authored newline, or an empty hard-token break for each field fragment.
  The DOM emits those separators without inventing spaces at token boundaries.
  Physical line/page boxes are separate from logical field text, and fragments
  publish their page/line identity. Caret and selection code must resolve those
  identities rather than assume a fragment is nested inside its physical line.
- Section headings reuse measured single-field wrapping with their caps face
  and alignment preserved. Emit the section rule only on the last continuation;
  preserve fitting geometry and allow oversized chains to split between lines.
- Names and contact values wrap at the header width; paired entry fields retain
  natural short-side width or divide available width when both sides are long.
  Fitting paired rows preserve their existing geometry. Continuation
  boundaries allow an oversized keep-chain to paginate: wrapped heading rows
  and the wrapped lines of a kept-together paragraph (a bullet, a skills row)
  carry `emergencyBreakBefore`, which `layout.ts` uses only when the chain
  cannot fit a page. It then fills the current page to the last boundary that
  fits and continues on the next, never leaving only heading rows behind, while
  a page-sized bullet still moves whole. Never shrink a glyph or discard text
  to conceal impossible page geometry. The one clamp is `fitParagraphIndent`:
  an authored `<indent>` is held so the paragraph keeps at least one em of
  measure inside its column, because at a 3-inch margin a 3-inch indent would
  otherwise push text past the right edge in every renderer. The stored mark is
  unchanged; a glyph wider than that em (a `W` at 12pt) may still overshoot by
  its excess, the emergency allowance below.
- Header row footprints use `faceExtent` at the run size capped by its role size,
  with oversized rise/drop counted separately. Empty runs reserve the same face
  box. Never use typed ink to place a name/contact at page top or test page fit;
  ascenders and descenders must not shift the header or following content.
- Link annotations in `pdf/emit.ts` go through `pdfUriString`: pdf-lib writes a
  literal string verbatim, so an unescaped `)` or `\\` in a destination produced
  a PDF that pdf-lib itself could not reopen. Escape those bytes and
  percent-encode everything outside printable ASCII; `pdf-links.mjs` locks the
  round trip for brackets, backslashes, non-ASCII, and percent-encoded paths.
- Underline and link rules come from `underlineSpans` plus `underlineRule`, so
  every renderer draws one rule per contiguous underlined phrase at one
  face-derived depth. Never derive a rule from the text a renderer happens to
  hold: the DOM painter groups merged style spans and the PDF emitter walks
  single runs, so a text-dependent rule silently disagrees between them.
- Alignment never changes where a line breaks (D082): every alignment breaks
  as a ragged paragraph does, and justify only stretches the spaces of lines
  already chosen. `tall-paragraphs.mjs` lays the same text out in all four.
- The optimal breaker tries previous breaks from the latest backwards and stops
  once a line is overfull past its shrink budget, so a paragraph costs its lines
  times its words per line rather than its words squared; ties keep the latest
  break exactly as before. A 16,000-word bullet lays out in milliseconds
  instead of over a second. The emergency path for an oversized token still
  measures each candidate prefix, so a single 20,000-character token costs
  under a second and grows faster than linearly beyond that.
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
- The 30 supported families start with the metric-compatible trio Tinos (Times
  New Roman), Carlito (Calibri), and Arimo (Arial), then Source Serif 4, Source
  Sans 3, and Latin Modern; the remaining families follow alphabetically.
  `lib/fontFamilies.ts` owns menu order and persisted ids; `fonts/README.md`
  documents sources and licenses. A new family requires bundled web and PDF faces, generated
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
- Those three are drawn on a 2048-unit em, so the committed metrics' integer 1000ths
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
- PDF serialization must not await timer callbacks: browsers throttle them in
  background tabs. Keep this scheduling choice in the shared emitter; it does
  not guarantee progress in a fully suspended or discarded tab.

## Font And Shaping Pipeline

- `scripts/generate_font_assets.py` is the pinned, checksum-verified source for
  WOFF2 assets, `metrics.gen.ts`, and `metrics/*.gen.ts`.
- `scripts/generate_pdf_fonts.py` derives PDF-embeddable TrueType siblings from
  the committed WOFF2 files and must fail if the sources contain shaping the
  engine does not model. Latin Modern's name-keyed CFF web outlines are
  reproducibly converted to quadratic `glyf` outlines with the same glyph
  order, metrics, and shaping tables; this avoids ambiguous CFF/CID declarations
  across PDF viewers.
- The DOM painter loads only the families used by the next layout, including
  inline overrides, and primes their browser baseline metrics before painting.
  It pre-scans those families from the schema (`layoutFamilies`) so their
  metrics modules and fonts download in parallel before the first layout.
  Font-load failure remains visible; a canceled load cannot repaint a superseded
  document. Only a family the loader has not yet confirmed withholds pages:
  adding or removing an already-loaded inline family must not swap the editable
  host for the loading state. The same browser-only loader serves next-typing
  caret choices. Never cache a face box measured before that face is loaded; it
  would preserve fallback metrics when the family later enters document content.
- Nothing off-screen may share the first visible page's commit: the `print`
  variant's font-ready repaint runs as a transition, and the editor's print
  layer mounts empty and lays out after the editor. `LogicalFields` positions
  fragments in separate DOM write and read passes; a read after every write
  forced a synchronous layout per fragment and dominated time to first page.
- Browser fonts, PDF fonts, and committed metrics share one shaping model:
  `liga` is limited to `ff`, `fi`, `fl`, `ffi`, and `ffl`; new catalog families
  compile them into one longest-first lookup and measure glyph-boundary kerning.
  Original-family metrics retain their prior contract. Unmodeled default-on
  GSUB behavior is removed; GPOS kerning retains only modeled pure pairs.
- A measured character a face lacks borrows from the family's `fallback` in
  `fontRegistry.ts` (Tinos or Arimo, which cover the whole repertoire):
  `measure.ts` measures it there, painters set `cssFontFamily` so the browser
  falls back to that face, loaders fetch `runFamilies`, and the emitter draws
  `faceSegments`. Borrow only what the face's fonts cannot draw (a mark the
  generator leaves `unmeasured` stays the face's), because the browser picks a
  font by its character map. Pairs kern only within one face. A decomposed
  accent composes only where the face has the composed letter; elsewhere it
  keeps its earlier measurement (500 units per mark) even where a browser would
  compose it from the next font. Runs keep their source text, so editor offsets
  are unchanged. The baseline
  probe stays on the primary face alone. A fallback family loads beside the
  pages and never withholds them (its load failure goes to the console, since
  only a borrowed glyph's look depends on it); `LogicalFields` repositions its
  fragments when a font finishes loading (deferred to compositionend while an
  IME composes) and then dispatches `TEXT_REPOSITIONED_EVENT`, on which the
  editor redraws its caret overlay.
- Every full PDF font must be declared as `CIDFontType2` + `FontFile2`, with the
  identity CID-to-GID map used by the engine's glyph ids. Do not reintroduce the
  former Latin Modern `CIDFontType0` rewrite: its embedded program remained
  name-keyed CFF, which newer Firefox/PDF.js releases rendered as missing or
  remapped glyphs. `pdf-roundtrip.mjs` locks the TrueType declaration,
  searchable text layer, and exact run positions.
- Do not patch generated fonts or metrics by hand. Change the pinned generator,
  regenerate all affected artifacts, and preserve license/checksum provenance.

## Verification

Choose checks based on the changed boundary:

- Any engine change: run the narrowest deterministic probe and
  `npm run check --workspace packages/engine`.
- Font, metrics, measurement, or PDF emitter change: run
  `npm run eval:pdf-font-parity --workspace packages/engine` and
  `npm run eval:glyph-fallback --workspace packages/engine`.
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
