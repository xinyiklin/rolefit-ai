# RoleFit UI Composition Guide

Applies to `apps/role-fit-ai/src/sections/`. Follow `PRODUCT.md`, `DESIGN.md`,
and `docs/engineering/ui-principles.md`.

## Ownership and reuse

- Reuse shared Typeset editor/toolbar/popover components for document behavior.
  RoleFit sections compose host navigation, job/AI controls, tracker, materials,
  review, and the RoleFit-only editor overlay.
- Reuse `NavMenu`, `SettingsStage`, `DocumentActionMenu`, dialog primitives, and
  `AiWorkflowProgress` for repeated host interactions. Do not introduce a
  second modal shell, provider picker, stage row, or status vocabulary.
- Settings is a dialog of frameless, hairline-separated rows. Do not nest a
  bordered card inside another bordered card: the Drafting Desk rejects
  card-in-card, and the first cut of the AI stage rows cost 317px each in a
  625px panel. Disclose optional per-item detail instead of stacking always-open
  textareas, and keep a set-but-collapsed value previewed so nothing that is
  actually being sent is invisible.
- Provider selectors show only explicitly configured providers. Keep an
  unavailable configured selection visible but disabled with reconnect/setup
  guidance; never render an API-key field or silently choose a paid provider.
  With no provider, keep editing/tracker/export usable and direct setup to the
  companion.
- Keep components declarative. Network, storage, cross-tab, and pipeline state
  belong in hooks; components receive values and callbacks.
- `PrepareTab` is the first/default and sole job-intake page. It composes the
  URL/paste fallbacks, receipt/Distill progress, collapsed source, editable
  full job brief and its extraction/candidate-review gaps, resume-variant
  recommendation, material selection, readiness, and the shared Apply callback;
  it does not own their async state. Its brief includes tracked job facts,
  company context, responsibilities, required/preferred qualifications,
  technical keywords, seniority/domain signals, and benefits. Candidate gaps
  restored from a saved Apply snapshot are visibly historical until Review
  produces a matching current result.
- Resume and Cover Letter use the same Prepare card component and visual
  hierarchy, each with an Include toggle and named-variant selector plus its
  document-specific actions. Resume defaults included and Cover Letter defaults
  excluded. Do not label either card optional. Readiness gates only included
  materials, and either or both may be excluded.
- Resume recommendations compare actual saved document contents. A clear
  high-confidence winner may be selected automatically only when the editor is
  clean; dirty or ambiguous state recommends/pauses for the user. Do not add
  persisted variant metadata to support this UI.
- The masthead contains Sessions and the shared Apply command only. Do not
  reintroduce an Inputs group, `jobControl`, intake control, or parallel Apply
  gate.
- Restored applications return to Prepare through **Open preparation** after
  the host validates their posting and document sources.
- Keep feature-specific composition near its tab/menu. Extract a shared section
  component only for demonstrated repetition or a stable interaction contract.
- Avoid mode-heavy components. Prefer a small base primitive plus explicit
  feature composition over unrelated boolean props.

## Shared editor boundary

- `ResumeTab` composes shared `DocumentToolbar`, `FormattingToolbar`, and
  `TypesetEditor` with RoleFit host actions and `RoleFitEditorOverlay`.
- `CoverLetterTab` composes the shared `DocumentToolbar`,
  `FormattingToolbar`, and direct editor with the cover-letter layout and
  structure editing disabled. It replaces only the toolbar's resume style-menu
  slot with a RoleFit-owned line-height control plus the shared page control;
  its file lifecycle and deterministic review rail remain RoleFit-owned. The
  editor is always mounted: without an opened or restored source, it starts as
  one empty editable paragraph.
- The Cover letter page has exactly one workflow action. `CoverLetterReview`
  reports readiness before Tailor and length, provenance, warnings, and Restore
  after it; it never gates the action behind a review step, and its enabled
  state depends only on real readiness, never on the presence of an
  intermediate object.
- Never fork shared editor markup or layout CSS for a host tweak. Add a narrow
  package seam and verify both apps.
- Structure controls stay outside editable DOM and must not affect PDF layout.

## UX rules

- Preserve the Sessions/Apply masthead + vertical PREPARE / DRAFT / TRACK
  navigation + tabbed workspace. Prepare is first and selected by default.
- Use app tokens/classes for host chrome and package styles for shared editor
  behavior. Document intentional overrides.
- Keep errors local, specific, and recoverable. Async stage UI must show exact
  step position, failure/stop state, Retry where valid, and later steps as not
  run.
- Preserve keyboard access, focus visibility, reduced motion, and non-color
  status cues.
- Follow flag-first browser QA for material layout/interaction changes.
