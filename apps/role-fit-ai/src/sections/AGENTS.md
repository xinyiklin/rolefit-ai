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
- About you stores optional evidence and scheduling facts, never self-scored
  fit. GPA is a single bounded 4.0-scale value attached to declared education;
  availability is a bounded notice period or valid exact date. Experience
  remains divided by source with bounded duration, role/project count, recency,
  and a factual scope note; job-specific relevance belongs to Fit Assessment.
  Keep its category rows flat and do not collapse distinct evidence sources
  into one additive years-of-experience total.
- Provider selectors show only explicitly configured providers. Keep an
  unavailable configured selection visible but disabled with reconnect/setup
  guidance; never render an API-key field or silently choose a paid provider.
  With no provider, keep editing/tracker/export usable and direct setup to the
  companion.
- Keep components declarative. Network, storage, cross-tab, and pipeline state
  belong in hooks; components receive values and callbacks.
- `PrepareTab` is the first/default and sole job-intake page. It composes the
  URL/paste fallbacks, receipt/Job analysis progress, collapsed source, editable
  full job brief and its extraction gaps, resume-variant
  recommendation, material selection, readiness, and the shared Apply callback;
  it does not own their async state. Its brief includes tracked job facts and
  one role context, responsibilities, required/preferred qualifications,
  technical keywords, seniority/domain signals, and benefits. Candidate gaps
  restored from a saved Apply snapshot remain clearly historical compatibility
  data rather than masquerading as current evidence.
- Before preparation, Source is the only visible panel. URL and pasted text are
  two APG-tabbed methods inside it, only the selected method renders, and the
  intake column is centered instead of reserving an empty rail. A prepared
  source collapses into its panel head — captured size and origin — rather than
  repeating them in the body.
- After preparation, the brief leads the main column and one Application rail
  owns both material choices, compact Fit Assessment, readiness,
  saved-application summary, and Apply. Fit Assessment shows only its verdict,
  selected resume, short summary, up to three matches and gaps, and a relevant
  eligibility warning. When out of date, retain those facts only as a clearly
  labeled previous assessment and add one flat Changed since assessment list
  before Reassess fit. Running, disabled, and retryable-unavailable states stay
  flat and never block manual Polish.
  Preparation is one of those checks, so its progress line appears only while
  work is in flight or a status message is outstanding, never as a standing
  card.
- The single Role context prose field stays inline and remains backed by the
  tracker's `roleDescription` value. Every
  multi-item brief section is a tab in one small tablist over a single panel,
  declared by `PrepareTab`'s `BRIEF_SECTIONS` so the page owns which sections
  exist. Tabs carry item counts so an empty section stays visible unselected,
  and follow the same APG roving-tabindex model as the studio rail.
- Inside a section each item is its own row: an editable input plus remove,
  with Add item appending a focused blank row. Rows are transient text until
  commit; normalization (dedupe, bullet stripping, empty-item removal) still
  happens only on commit, so a blank row survives until it is typed into. This
  is presentation only — the brief stays `string[]` per field and the change
  callback keeps its newline-joined string contract. Do not add per-item
  persisted state without changing the editable schema deliberately.
- Prepare is built from flat panels: a hairline-separated head (title, quiet
  meta, trailing actions) over plain content. Do not stack a card, tinted box,
  or icon tile inside a panel — the extraction/candidate gap columns and the
  material rows are dividers and columns, not nested cards. A panel whose head
  is its only content renders as a bar with no empty body.
- Every secondary line on the page — blocked-action guidance, live status,
  safety notes, the variant recommendation — uses the one `.prepare-note`
  treatment. Do not reintroduce per-status panels, accent stripes, or decorative
  icons for them.
- Resume and Cover Letter use the same Prepare card component and visual
  hierarchy as divided groups inside the Application rail. Each places identity
  and state beside Include, followed by its named-variant selector and
  document-specific actions. Resume defaults included and Cover Letter defaults
  excluded. Do not label either card optional. Readiness gates only included
  materials, and either or both may be excluded.
- Materials are a supporting choice on Prepare, not its subject. Each rail group
  is identity/state, Include, variant, then actions in both DOM and visual order,
  and discloses conditional detail underneath only when it applies. The state
  line reports state only — the selector already names the variant, so do not
  restate it. Show one note at a time: the blocker while an action is
  unavailable, the live status otherwise. Keep note text wrapping rather than
  ellipsed — the trailing clause is recovery guidance.
- Both materials rank actual saved document contents with one weighted
  prepared-job scorer and auto-select a meaningful unique winner while the
  corresponding editor is clean and not application-owned. The selector is the
  receipt; do not repeat counts or explanations underneath it. Only a blocked
  automatic replacement gets the compact `PreparedVariantRecommendation`
  fallback. A tie or incomplete comparison returns no recommendation and keeps
  the current selection. Do not add persisted variant metadata to support this
  UI.
- A material's state line names the real reason it is not ready. A saved base
  letter is a template holding real prose and unresolved `[slots]`; reporting
  that as "No draft" contradicts the variant the selector is showing.
- The masthead contains the RoleFit identity and shared Apply command only.
  Read-only Sessions is ambient awareness immediately above Settings in the
  bottom studio-rail utilities group, outside `OUTPUT_TABS` and the APG tablist.
  Expanded it shows Sessions + count; collapsed it becomes an icon + compact
  count/working state, and its popover opens rightward within the viewport. Do
  not reintroduce an Inputs group, `jobControl`, intake control, or parallel
  Apply gate.
- Stored applications and Skipped decisions use **Edit preparation** after the
  host validates their posting and document sources. Update mode keeps a
  persistent exact-record banner, and a
  materially different replacement source must be detached through the
  explicit **Start a new preparation** choice before it can commit.
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
  its file lifecycle, workflow rail, and whole-document proposal review
  remain RoleFit-owned. The
  editor is always mounted: without an opened or restored source, it starts as
  one empty editable paragraph.
- `DocumentWorkflowRail` owns the single named complementary landmark and the
  shared state/target/readiness/failure/body/footer hierarchy for both document
  tabs. The shell places each document's one primary **Polish** action beside the
  rail disclosure control in whichever open or collapsed state is visible.
  Resume dispatches one proposal request from both its document action and
  Prepare; no stage selector exists. Its compact feedback is What improved, the
  proposed edits open in one disclosure with per-row Accept/Edit/Discard, Still
  missing, and a quiet withheld line. Evidence, risk, and keyword chips do not
  belong in the normal surface, and Withheld never receives success treatment.
  Cover letter keeps one Polish request but stages its result as a whole-document
  proposal: **Accept proposal** applies it atomically, **Discard proposal** performs no
  mutation, stale inputs disable acceptance, and Restore appears only after acceptance.
- `ProposalDecisionBar` and `ProposalDiff` are the shared accept surface, and
  both documents must go through them. The bar is the ONLY place either document
  commits: it renders in the rail's sticky footer, states what remains in that
  document's own unit, and puts a primary accept before a secondary discard —
  Accept all / Discard all for the resume's edits, Accept proposal / Discard
  proposal for the letter's single replacement. Only a multi-decision proposal
  gets its `progressbar`, and the rail description must not repeat the counts the
  bar owns. `ProposalDiff` marks every changed word: `removed` and `added` for
  the resume's Now/Proposed pair, `merged` for the letter's Changes view behind
  its Changes / Full letter switch. It falls back to the plain rendered side when
  either text carries inline marks, because a word diff can split a tag pair.
  Resume decisions are individually reversible — `revert` restores an accepted
  edit's original text before returning the row to the queue — and `discardAll`
  is a decision record, never a mutation. Do not add a second commit location, a
  third verb pair, or a document-private way of showing what changed.
  Typed post-draft issues render as one flat failure list with recovery beside
  each claim. When that rail is collapsed, its edge tab may show only the
  bounded issue count; readiness blockers and generic provider failures do not
  earn a badge.
- `DocumentWorkbench` owns the two document tabs' shared rail placement,
  disclosure, and responsive scroll boundary. Its wrapper stays semantically
  neutral because `DocumentWorkflowRail` owns the one named complementary
  landmark. At the stacked breakpoint its layout is the scroll
  owner inside the clipped studio host, and Resume gives the shared Fit control
  its editor-pane ref so rail transitions cannot leave Fit stale. Both document
  tabs also give `useRestoredScroll` the layout and editor refs so tab switches
  preserve the offset of whichever element owns scrolling at that width.
- Opening the rail spends desk margin before it moves the page. Centring the
  page in the shrunken pane wastes half the remaining whitespace on a right
  gutter the rail already stands in, so the docked pane biases its start padding
  by the rail's width: the page holds its position until the margin runs out,
  then goes flush against the pane's end padding. The bias needs the rendered
  page width (`DOC_PAGE_WIDTH_PX × zoom`, passed in as `pageWidthPx`), not the
  816px logical page — zoom scales the real box. Stacked, the rail claims no
  horizontal space, so the page stays plainly centred.
- That bias and the rail's track must animate on one clock
  (`--document-rail-motion`). The page holds still only because the padding
  gains exactly what the track loses; leaving the padding a step change lands it
  at full width while the track is still open, throwing the document sideways by
  the rail's width before it slides back.
- These tabs' host must be `overflow: clip`, never `hidden`. `hidden` leaves it
  a scroll container holding horizontal overflow from closed toolbar popovers,
  and focus landing on a rail control mid-transition scrolled the toolbar,
  title, and editor sideways together.
- Never fork shared editor markup or layout CSS for a host tweak. Add a narrow
  package seam and verify both apps.
- Structure controls stay outside editable DOM and must not affect PDF layout.

## UX rules

- Preserve the Apply-only masthead plus Sessions/Settings studio-rail utilities
  + vertical PREPARE / DRAFT / TRACK navigation + tabbed workspace. Prepare is
  first and selected by default.
- Use app tokens/classes for host chrome and package styles for shared editor
  behavior. Document intentional overrides.
- Keep errors local, specific, and recoverable. Async stage UI must show exact
  step position, failure/stop state, Retry where valid, and later steps as not
  run.
- Preserve keyboard access, focus visibility, reduced motion, and non-color
  status cues.
- Follow flag-first browser QA for material layout/interaction changes.
