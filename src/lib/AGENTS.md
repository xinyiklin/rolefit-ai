# Resume Domain And File Contract Guide

Applies to `src/lib/`. Follow the repository root guide first. This file owns
the reusable resume-domain and editable-file rules; product and visual behavior
remain in `PRODUCT.md` and `DESIGN.md`.

## Module Ownership

- `resumeData.ts` owns canonical `ResumeData` types, constructors, and fresh
  session ids.
- `documentStyle.ts` owns the pure persisted document-style contract, defaults,
  bounds, spacing presets, coercion for browser preferences, and conversion that
  excludes local zoom.
- `documentTypography.ts` owns shared document-size scale math used by domain,
  editor, and typesetting consumers.
- `resumeFile.ts` owns portable `.resume` validation, serialization, versioning,
  size limits, and download naming.
- `inlineMarksText.ts` owns non-JSX inline-mark parsing and transforms,
  including the single inline-tag grammar (`INLINE_MARK_TAG_PATTERN`) that
  other parsers instantiate.
- `styleFieldFormatting.ts` owns reusable bulk/effective formatting across
  headings, entry columns, skill labels, and contact fields, not toolbar state
  or presentation.
- `links.ts` owns safe link normalization, detection, and inline destination
  encoding/decoding.
- `pageMargins.ts` owns page-margin types, bounds, presets, and normalization.
- `download.ts` owns the one browser file-download side effect (object URL,
  anchor click, deferred revoke) used by `.resume` saves and PDF export. It is
  the deliberate DOM exception in this directory; keep every other module
  DOM-free.

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

- `.resume` is the only editable open/save format. PDF is final output.
- Current saves use `format: "typeset-resume"` and `schemaVersion: 1`.
- Version 1 is the first and only contract. Pre-release prototype shapes and
  other schema-version values are unsupported and must be rejected.
- The file contains structured content plus every print-affecting style value.
- Session ids never cross the boundary; regenerate them on open. Zoom and the
  spell-check view preference never cross the boundary.
- Preserve the 2 MB input cap unless a measured need changes it with matching
  tests, error copy, and documentation.
- Reject malformed JSON, wrong magic, unsupported versions, missing/unknown
  fields, invalid bounds, and oversized input with clear user-facing errors.
- A future schema change requires an explicit version and migration decision
  plus compatibility and round-trip verification. Do not add alternate source
  or conversion paths as a fallback.
- Preserve the persisted wire identifiers (`typeset-resume`) unless a deliberate
  future migration updates files, browser storage, tests, docs, and continuity
  together.

## Verification

For model, transform, or codec changes:

1. Run `npm run eval:resume-file` for editable-file contract changes, plus the
   smallest probe for other pure functions.
2. Verify a current v1 save/open round trip without session ids.
3. Check unsupported schema-version rejection; no prototype-version migration
   path should exist.
4. Check malformed, unknown-field, invalid-bound, and
   oversized-input rejection.
5. Confirm unrelated marks/content survive transformations.
6. Run `npm run build`, or `npm run check` before handing off a broad change.

If no focused harness exists, add or run a small deterministic eval when the
logic is durable enough to regress; otherwise report the exact manual probe.
