# RoleFit AI Continuity

Cross-workspace decisions and handoff state. Keep entries factual, dated, and
bounded; app-only operational detail belongs in the affected app documentation.

## 2026-07-24

- [TOOL] Local `main` was fast-forwarded to `origin/main` at `58fcf3f`
  (`Harden AI workflows and refresh application tracker`) before the current
  cover-letter work began.
- [USER] Cover letters are moving out of Materials into a dedicated editor page.
  The workflow starts from the user's own written letter and tailors it against
  the job description and truthful candidate evidence; it does not generate a
  new letter from nothing.
- [USER] Cover-letter presentation is a plain correspondence document: one text
  column and paragraphs, without resume sections, rules, columns, or bullets.
- [USER] The cover-letter page uses the same document and formatting toolbar
  family as the resume editor, but it must not expose resume-specific structure,
  heading, entry-indent, or resume-spacing settings.
- [CODE] The portable editable cover-letter format is `.cover`, with magic
  `typeset-cover-letter` and schema version 1. `.resume` remains resume-only,
  while `.rolefit-backup` remains the product-level workspace backup format.
- [CODE] `@typeset/engine` owns the shared measurement, line breaking,
  pagination, font, DOM/PDF painting, and strict portable-file primitives.
  Cover-letter paragraph composition is a separate engine adapter. RoleFit owns
  job/provider orchestration, source-letter intake, tailoring, and review UX.
- [CODE] `FormattingToolbar.documentStyleTools` is the narrow host seam for a
  non-resume document grammar. RoleFit replaces the default resume style menus
  with a focused line-height popover plus the shared page-margin popover; the
  shared history, zoom, selection formatting, alignment, link, and spell-check
  controls remain unchanged for both document types.
- [USER] Direct editing uses word-processor behavior across both document
  layouts: Tab inserts four preserved spaces (Shift+Tab remains a focus escape),
  copy/paste retains supported inline formatting, mixed font-family selections
  leave the family control blank, and Ctrl/Cmd +/-/0 controls document zoom.
- [USER] Mixed font-family and font-size selections leave both toolbar controls
  blank. Custom typed inline sizes clamp to 1–200 pt without changing the
  curated preset dropdown. Selection highlighting spans the full engine-line
  height determined by its largest inline run.
- [USER] The cover-letter page always presents an editor. With no uploaded,
  restored, or authored base, it starts as a clean blank paragraph; opening a
  source remains optional.
- [CODE] Empty engine paragraphs paint a DOM-only zero-width caret target that
  selection mapping and clipboard handling exclude from document content, so a
  blank cover letter remains immediately editable.
- [USER] Fresh starter resumes, New, and Reset use the canonical Jake-derived
  defaults, including the 10.8 pt start indent and 5.4 pt end indent implied by
  Jake's 0.15 in list plus 0.97-text-width entry rows.
- [USER] The bundled RoleFit starter is the serialized canonical starter, so
  its title, subtitle, and skill-label marks already match Reset text
  formatting instead of changing appearance the first time Reset is used.
- [USER] A collapsed editor caret follows the active next-typing family, face,
  and size and remains visible while toolbar settings own focus. The engine
  wraps otherwise-unbreakable oversized tokens at measured grapheme boundaries
  instead of allowing them to overflow the page; inline font, size, and mark
  boundaries within the token do not create early line breaks. A grapheme that
  cannot fit the current remainder moves intact to the next line, preventing
  single-character formatting runs from oscillating as the user types.
- [USER] Committing a font-family or font-size selection returns keyboard focus
  from the toolbar control to the saved document caret or text range.
- [CODE] Mixed families and sizes remain independent runs on one line. All runs
  share one engine baseline; the DOM painter measures the browser's real CSS
  baseline per bundled face, and pagination expands calibrated line junctions
  for oversized inline ink so adjacent lines cannot collide.
- [ASSUMPTION] A separate AI review pass is not required for the first
  cover-letter editor slice. The product keeps the pre-tailoring source
  recoverable and presents deterministic human-review checks; this decision may
  be revisited with quality evidence.
- [TOOL] CareerOneStop, MIT CAPD, and Harvard FAS guidance was reviewed for
  concise, specific, active, evidence-based application writing that preserves
  the candidate's own voice. The durable links and resulting prompt policy are
  recorded in `apps/role-fit-ai/docs/engineering/ai-server.md`.
