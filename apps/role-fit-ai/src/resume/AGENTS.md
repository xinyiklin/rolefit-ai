# RoleFit Resume Analysis Guide

Applies to `apps/role-fit-ai/src/resume/`. The shared structured document and
file/layout contracts remain in `@typeset/engine`.

## Scope

- Own deterministic mechanical analysis used to describe resume text,
  sections, keywords, and proposed edits.
- Keep transformations evidence-preserving and target stable document IDs.
- Do not calculate, cap, recompute, or substitute a fit score, verdict,
  eligibility decision, or missing-qualification count. Fit Assessment owns its
  compact advisory verdict; Polish owns the evidence-grounded proposal contract.
- Do not promote job-description-only terms into resume evidence. Rewrites may
  clarify facts already present in the resume or honest user context, never
  invent experience, tools, metrics, employers, dates, or outcomes.
- `terminology.ts` owns job-term extraction (required, responsibility,
  technical, then preferred; at most 48 terms), unsupported-term warnings, and
  lost-term advisories; `proposalWarnings.ts` carries earlier proposal concerns
  forward to the current document. Neither certifies evidence.

## PDF import (`pdfImport/`)

- `pdfLayout.ts` is the only pdf.js adapter (injected, so Node evals and the
  browser share it); `layoutLines.ts` groups spans into reading-order lines;
  `resumeFromLayout.ts` builds the structure; `importStyle.ts` maps style;
  `importAudit.ts` is the preservation audit; `importStructure.ts` rebuilds an
  AI reply from the client's own pieces.
- Every source character must land in exactly one place: a document field, a
  Not placed finding, or consumed structure (a bullet marker, a spaced
  separator, a skills label's colon). Never edit words; never place text that
  matches the inline-mark grammar. A change that makes the audit fail must fix
  the placement, not the audit.
- Only dingbat faces (`PdfSpan.dingbat`) are glyph artifacts; Symbol-font text
  such as "≥" is content. Filled form fields, viewer-added text boxes
  (FreeText), and any annotation whose appearance paints non-dingbat glyphs (a
  stamp, a field showing a value it does not hold, a checkbox drawn with a
  letter, a signature appearance) paint text pdf.js does not read, so they
  refuse the import (`overlay-text`); a dingbat check mark does not. The font
  is tracked as graphics state (q/Q restore it). Outside dingbat faces, every private-use glyph counts toward the
  unreadable share, icons and bullets included. The audit also fails when a
  field would form formatting code once the importer's own marks are removed.
- A right-hand band is a column unless it holds row values: text on the left
  column's baselines that comes a row or two at a time, sits flush right, or is
  at least 40% dated (`rowDates.ts` `hasDate`, which also finds the date in
  "2019 – 2023 · Boston" or "06/2019 – Present (4 yrs)"). The dated reading
  never applies to a band beside a bullet (dingbat glyphs included) or holding
  a heading-styled line, which is a sidebar.
- `__evals__/pdf-import-corpus.mjs` is the gate (synthetic fixtures generated
  in memory from `__evals__/support/importCorpus.mjs`; never commit a PDF);
  `pdf-import-edge-cases.mjs` holds review-found layouts.
  Keep its hard gates (zero lost/added, round trip, export, determinism,
  refusals) and benchmark gates (field P/R 0.98 single-column, 0.90 hard; mean
  reading order 0.98); add a fixture for every layout bug fixed.

## Maintainability

- Keep analysis pure and serializable. React, requests, provider logic, and
  storage belong elsewhere.
- Reuse the shared engine's `ResumeData` and inline-mark grammar rather than
  defining local document shapes.
- Separate extraction/normalization from presentation wording so UI copy can
  change without changing evidence semantics.
- Add focused offline evals for changes to section parsing, keyword extraction,
  rewrite application, or evidence boundaries.
