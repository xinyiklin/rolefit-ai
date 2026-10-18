# Resume And Cover-Letter Domain And File Contract Guide

Applies to `src/lib/`. Follow the repository root guide first. This file owns
the reusable document-domain and editable-file rules; product and visual behavior
remain in `PRODUCT.md` and `DESIGN.md`.

## Module Ownership

- `resumeData.ts` owns canonical `ResumeData` types, constructors, and fresh
  session ids.
- `documentStyle.ts` owns the pure persisted document-style contract, defaults,
  bounds, spacing presets, coercion for browser preferences, and conversion that
  excludes local zoom. The contract is composed from three slices so each
  consumer can name what it reads: `PageStyle` (face, body size, leading,
  alignment, margins), `HeaderStyle` (the letterhead and its gaps), and
  `ResumeBodyStyle` (sections, entries, bullets). `DocumentStyle` is all three
  — an unchanged field set, still the `.resume` contract — and
  `CoverLetterDocumentStyle` is page + header, which is everything a letter's
  layout reads. A letter must never inherit `ResumeBodyStyle` values from the
  resume defaults; `coverLetter.ts` states them as inert zeroes for the shared
  editor's sake alone.
- `documentTypography.ts` owns shared document-size scale math used by domain,
  editor, and typesetting consumers.
- `resumeFile.ts` owns portable `.resume` validation, serialization, versioning,
  size limits, and download naming.
- `coverLetter.ts` owns the strict `.cover` paragraph/style contract and the
  constrained adapter into the shared in-memory `ResumeData` editing shape.
- `inlineMarksText.ts` owns non-JSX inline-mark parsing and transforms,
  including the single inline-tag grammar (`INLINE_MARK_TAG_PATTERN`) that
  other parsers instantiate. Paragraph properties live in that grammar beside
  the character ones: `line-height`, `space-before`, `space-after`, and
  `indent` (a left indent in points). Adding a tag here means adding it to the
  editor's anchored scanner too, and to its display-map char shape, or a value
  the engine understands will serialize back out as literal text. Every
  tag-stack walker over the grammar (this module's truth helpers, the engine's
  segmenter, the editor's display map) gives an open tag whose value is
  unusable — `<size=0>`, `<size=999>` — an inert stack slot
  (`INERT_OPEN_TAG`), so its closing tag can never pop an outer value.
  `<lt>` is the one text token: a literal `<` stored where the raw character
  would start a tag. Every walker reads it as text, `stripInlineMarks` decodes
  it, and `escapeInlineMarkText` encodes plain text entering the grammar.
  Never concatenate or regex-strip stored values directly: a bare literal `<`
  at a seam can complete a tag. Join with `joinInlineMarkText`, run raw
  strip/wrap transforms inside `withInlineLiteralsProtected`, and use
  `canonicalInlineMarkText` for the stored spelling. `skillsRowText` is the
  one join of a skills row's label and skills columns, shared by the painter
  and the editor's field value: its `: ` separator is written as its own run in
  the alignment, size, family, and emphasis that every non-space character of
  BOTH columns shares (never a link), so a whole-row command covers it. Both
  columns must have text, and a format only one column has (a label sized from
  the Styles menu) stays off it: typed skills would inherit it. It reads
  meaning, not tag spelling, because the editor writes a row back as several
  runs whenever one skill differs.
  `uppercaseInlineMarkedText` is the engine's case transform: it uppercases text
  and leaves tag payloads (link destinations, family ids) alone. The editor's
  display map uppercases per display character (`ß` shows as `S` there while
  the engine paints `SS`), a known one-character drift after such a glyph.
- `styleFieldFormatting.ts` owns reusable bulk/effective formatting across
  headings, entry columns, skill labels, and contact fields, not toolbar state
  or presentation.
- `links.ts` owns safe link normalization, detection, and inline destination
  encoding/decoding. A bare domain is a link only when the URL parser accepts
  it (the shape test admits ports no browser does), and automatic detection
  strips trailing punctuation except a closing bracket that closes one inside
  the candidate (`wiki/Foo_(bar)`).
- `pageMargins.ts` owns page-margin types, bounds, presets, and normalization.
- `download.ts` owns the one browser file-download side effect (object URL,
  anchor click, deferred cleanup) used by `.resume` saves and PDF export. Keep
  its anchor and object URL alive until Chromium has consumed the requested
  filename instead of falling back to the blob UUID. It is the deliberate DOM
  exception in this directory; keep every other module DOM-free.

Extend the existing owner rather than adding another model, parser, mark
grammar, margin table, or link-normalization path.

## Boundaries

- Keep these modules deterministic and React-free. Accept plain values and
  return explicit results; do not read the DOM, local storage, or component
  state here.
- Keep `ResumeData` as the in-memory source of truth. UI-friendly or portable
  representations are adapters, not competing canonical models.
- Keep validation separate from hydration. Validate unknown portable data first,
  then create fresh session ids and runtime values.
- Preserve unknown-input safety. Do not cast parsed JSON to application types or
  accept unknown fields for convenience.
- Keep reusable transformations composable and lossless for unaffected marks.
  Formatting, links, alignment, and whitespace must not erase one another unless
  the operation explicitly owns that behavior.
- Avoid imports from components, hooks, or application orchestration. A narrow
  dependency on stable typesetting types is acceptable when the domain contract
  genuinely shares that value and does not create a cycle.

## Editable File Contract

- `.resume` is the resume open/save format and `.cover` is the cover-letter
  open/save format. The two strict schemas do not masquerade as one another.
  PDF is final output.
- **Pre-release policy (D007 in root `docs/decisions.md`, in force until the
  user lifts it):** one live shape per format, always `schemaVersion: 1`. A change to a
  stored shape rewrites the existing documents through a throwaway developer
  script that is not committed; the parsers here gain no compatibility branch,
  no default for an absent field, and no second accepted shape. Spacing values
  are absolute points and `style.spacingModel: "absolute"` is required, so a
  document from before that change fails loudly instead of being reinterpreted.
- Current saves use `format: "typeset-resume"` and the sole
  `schemaVersion: 1`, with an optional explicit header object. Retired
  name/contact and schema-v2 shapes are migration-tool inputs only, never
  runtime parser aliases.
- Current cover-letter saves use `format: "typeset-cover-letter"` and
  the sole `schemaVersion: 1`, with an optional explicit header, ordered
  paragraphs, and cover-letter print style. Reject every other cover-letter
  version at runtime; retired shapes are inputs only to the explicit workspace
  rewrite tool.
- Cover-letter paragraph rhythm is paragraph content, not document style.
  Newly parsed paragraphs receive explicit 8pt `space-before` formatting, and
  before/after marks remain the only persisted paragraph-spacing controls.
  Do not add a hidden document-wide paragraph-gap field or accept the removed
  beta prototype field as a compatibility alias.
- Unsupported versions and pre-release prototype shapes must be rejected.
- Standard entry title/subtitle rows use the existing required left/right keys:
  two strings mean present (including a blank row), and two nulls mean absent.
  Reject mixed pairs and null rows in Skills/Summary sections. Constructors,
  hydration, formatting, and field edits must preserve absence; only an explicit
  Add-row action creates strings again. This value expansion keeps existing
  string-valued v1 files valid without migration or a second parser branch.
  Older builds reject files containing null row values.
- The file contains structured content plus every print-affecting style value.
  Page margins persist only as physical point values; Narrow, Normal, and
  Custom are editor conveniences rather than file-format state.
- Session ids never cross the boundary; regenerate them on open. Zoom and the
  spell-check view preference never cross the boundary.
- Preserve the 2 MB input cap unless a measured need changes it with matching
  tests, error copy, and documentation.
- Reject malformed JSON, wrong magic, unsupported versions, missing/unknown
  fields, invalid bounds, and oversized input with clear user-facing errors. A
  leading byte-order mark is not malformed: the byte path strips it through
  `TextDecoder` and the text path strips it itself, so a file read through
  Node's `utf8` decoding parses the same way.
- A future schema change requires an explicit version and migration decision
  plus compatibility and round-trip verification. Do not add alternate source
  or conversion paths as a fallback.
- Preserve the persisted wire identifiers (`typeset-resume`) unless a deliberate
  future migration updates files, browser storage, tests, docs, and continuity
  together.

## Verification

For model, transform, or codec changes:

1. Run `npm run eval:resume-file --workspace packages/engine` for `.resume`
   changes or `npm run eval:cover-letter-file --workspace packages/engine` for
   `.cover` changes, `npm run eval:inline-marks --workspace packages/engine`
   for the tag grammar, plus the smallest probe for other pure functions.
2. Verify the current cover-letter v1 save/open round trip without session ids;
   for resumes, verify the sole current v1 round trip without session ids.
3. Check unsupported schema-version rejection; no prototype-version migration
   path should exist.
4. Check malformed, unknown-field, invalid-bound, and
   oversized-input rejection.
5. Confirm unrelated marks/content survive transformations.
6. Run `npm run check --workspace packages/engine`, then affected app checks
   before handing off a shared contract change.

If no focused harness exists, add or run a small deterministic eval when the
logic is durable enough to regress; otherwise report the exact manual probe.
