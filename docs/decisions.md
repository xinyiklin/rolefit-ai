# Decisions

Rules still in force for the RoleFit AI monorepo, moved verbatim from
`CONTINUITY.md` on 2026-10-11. Read on demand before changing a rule. Statuses
change in place (`AMENDED by D00n`, `SUPERSEDED by D00n`); never renumber.

Tags: `[USER]` user decision, `[CODE]` verified in code, `[TOOL]` observed by a
tool run, `[ASSUMPTION]` unverified inference; `UNCONFIRMED` marks an unverified
claim. Bullets keep the date and tag of their source entries; on conflict the
later entry wins.

### Monorepo, packages, toolchain, and CI

- 2026-07-24 [CODE] D001 ACTIVE: `@typeset/engine` owns measurement, line breaking,
  pagination, fonts, DOM/PDF painting, and the strict portable-file primitives;
  RoleFit owns job/provider orchestration, source-letter intake, tailoring, and
  review UX; `FormattingToolbar.documentStyleTools` and `documentStructureTools`
  are the host seams.
- 2026-08-01 [USER+CODE+TOOL] D002 ACTIVE: Typeset and the private `@typeset/engine` /
  `@typeset/editor` packages share a 0.2.0 milestone (metadata only; link ranges
  stay `*`), published by the Typeset static-container deploy from `main`; that
  milestone's PR checks, `Typeset CI and Deploy` run, and live-site receipt are
  UNCONFIRMED.
- 2026-07-29 [USER+CODE+TOOL] D003 ACTIVE: Toolchain: Node 24.18+ below 25 (`.node-version`:
  24.18.0), npm 11.16.0, root-owned TypeScript 7.0.2/Vite/React tooling, a
  pinned install-script allowlist, and the dependency-contract gate; Electron
  43.7.9 (bundled Node 24.21.0; superseded 43.2.0 on 2026-10-09, see that day).
  Actions are SHA-pinned; Dependabot has no auto-merge and checks npm monthly
  (2026-10-09); Vite, TypeScript, Electron, PDF/font, and Python bumps stay
  manual.
- 2026-07-29..07-31 [USER+CODE+TOOL] D004 ACTIVE: PDF dependencies stay `pdf-lib` 1.17.1,
  `@pdf-lib/fontkit` 1.1.1, and React-PDF 10.4.1; RoleFit declares `pdfjs-dist`
  5.4.296 (contract-pinned to React-PDF's). `devEngines` enforcement on a
  mismatched toolchain is UNCONFIRMED. `.gitattributes` sets `* text=auto
  eol=lf`; `fonts:check` runs via `packages/engine/scripts/run-python.mjs`.
- 2026-07-31..09-29 [USER+CODE+TOOL] D005 ACTIVE: `Document workflow CI` is the sole per-push
  owner of the package suites and app correctness and must stay green on `main`;
  deploy workflows build only their own app (a skipped workflow never reports,
  so a deploy verify job must not be a required check). [USER+CODE] Core and
  extended browser-contract groups own disjoint cases (Product Partner waived).
- 2026-09-08 [USER+CODE+TOOL] D006 ACTIVE: Root ignore rules follow Machine Bootstrap (root
  `.npmrc` stays shared). `.agent-work/` stays local, including completed task
  artifacts; durable summaries are self-contained and task IDs are plain labels.

### Document formats and the shared engine/editor

- 2026-07-29 [USER] D007 ACTIVE: **Pre-release schema policy, in force until the user lifts
  it.** While the products are in dev/preview/beta each format has exactly one
  live schema, still `schemaVersion: 1`; runtime parsers stay single-shape (no
  compatibility branches, derived defaults, or version negotiation). When a
  stored shape changes, the assistant converts existing documents with a
  throwaway script kept out of the commit. The user will say when to lift it;
  the assistant may ask.
- 2026-07-29 [USER+CODE] D008 ACTIVE: `.resume` and `.cover` each have one strict schema v1
  with the same optional structural header; retired shapes are accepted only by
  explicit workspace rewrite tools. [USER] One strict shape per portable format,
  no runtime migration tooling, truthful artifact status, tab-safe recovery, and
  separate behavior/refactor commits; the application lock, revision check,
  client mutation queue, and file-byte rollback are non-negotiable; PR #97's
  three merge blockers (tracker revision regression, async replacement
  overwrite, stale auto-link destination) were fixed.
- 2026-09-27 [USER+CODE] D009 ACTIVE: `.resume` style requires `bulletIndentPt` (0–36 pt,
  default 14.73, absolute points); older files and stale autosaves are rejected
  (user accepted); `.cover` carries an inert 0 and shares `.resume`'s header
  limits (`DOCUMENT_HEADER_LIMITS`). 2026-09-16 [USER+CODE]: title/subtitle rows
  are Add/Remove-only, stored as paired strings or paired nulls; older builds
  reject null rows.
- 2026-07-29 [USER+CODE] D010 ACTIVE: **Spacing is absolute**: each junction is the next
  row's line advance plus the user's gap; the header keeps line spacing 1;
  `titleSubGapPt` may reach -6; the three header gaps stay style-owned for both
  kinds. UNCONFIRMED: on the cover letter, `headerSectionGapPt` and the first
  paragraph's `space-before` add rather than override (`coverLetterBlocks.ts`).
- 2026-10-02 [USER+CODE] D011 ACTIVE: Spacing presets: fixed Compact/Balanced/Spacious plus
  up to eight named saved presets in a shared-editor local preference
  (`typeset-resume.docStyle.spacingPresets.v1`), synced across tabs, never in
  files or history; the old `typeset-resume.docStyle.custom.v1` preset migrates
  in as "Custom".
- 2026-07-26 [USER+CODE] D012 ACTIVE: Page margins are Narrow (0.5 in), Normal (1 in), or
  Custom per side; files store only physical values. [USER] Resume line height
  is a global setting inside Spacing (the letter's too, under its inline line
  height, per D083); preset numeric controls stay expanded;
  cover-letter inline line height adds room below the targeted lines only.
  [USER+CODE] The line-height menu offers Single, 1.15, 1.5, Double, paragraph
  before/after, and Custom; a caret or partial selection applies to the painted
  lines.
- 2026-07-24..07-26 [USER] D013 ACTIVE: The editor follows word-processor behavior wherever
  models disagree: line placement depends on a line's fonts and sizes, never
  typed glyphs; prose Tab/Shift+Tab indent/outdent by a measured half-inch stop;
  Resume Tab/Shift+Tab walks logical header and section fields, skipping
  headings (the cover letter cycles only its header fields); copy/paste keeps
  supported inline formatting; mixed family/size selections blank those
  controls; typed sizes clamp to 1–200 pt; committing a family/size returns
  focus to the document; Ctrl/Cmd +/-/0 zooms. The caret follows the next-typing
  family, face, and size and stays visible while toolbar controls hold focus;
  oversized unbreakable tokens wrap at measured grapheme boundaries; cross-field
  Select All works in Firefox; selection endpoints that name no field still
  resolve to one, and a press off the text starts a drag that survives leaving
  the sheet.
- 2026-07-25 [USER] D014 ACTIVE: A document page always has a caret: an open or first arrival
  starts at the document start, returning to the Resume or Cover letter tab
  restores caret and scroll offset, and an open never steals focus from an
  outside text field. The caret leans by the face's `post.italicAngle`.
- 2026-07-28..07-29 [USER] D015 ACTIVE: Enter continues the active formatting, and a format
  set on an empty paragraph persists. Authored spacing shows at document
  boundaries; a selected line's highlight spans its full engine-line height and
  is continuous through before/after spacing without crossing pages. Google Docs
  clipboard interop keeps logical paragraphs, before/after spacing as paragraph
  style, line height both ways, and outbound links; [USER+TOOL] the user's live
  line-height round trip passed.
- 2026-07-24..07-25 [USER] D016 ACTIVE: Every editor host has the self-owned right-click
  menu; linking and pasting work on multi-paragraph selections; the link overlay
  follows caret and selection, not hover; alignment is one labelled-menu
  trigger; RoleFit's formatting-row menus are icon-only (Typeset keeps labels
  until 1210px); menu rows carry a description only when the title is not
  enough.
- 2026-07-24..07-25 [USER] D017 AMENDED by D081: Tinos, Carlito, and Arimo ship as metric-compatible
  equivalents under their own names, the metric twin shown beside them; menu
  order is Tinos, Carlito, Arimo, Source Serif 4, Source Sans 3, Latin Modern,
  then (2026-10-14 [USER]) the 24 added catalog families alphabetically.
  New cover letters start in Carlito; resumes default to Latin Modern
  (letter defaults AMENDED by D081: a new letter starts with the resume's).
  `entryEndIndentPt` is the entry's right edge for every row; Jake is the style
  reference, not a spec; fresh starters use the Jake-derived defaults (10.8 pt
  start, 5.4 pt end) and the bundled starter is the canonical starter.
  Small-caps "wobble" is overshoot plus pixel quantization; the benefit of
  `text-rendering: geometricPrecision` is UNCONFIRMED. [CODE]
  `lib/fontFamilies.ts` is the single family-id list.
- 2026-07-27..07-29 [USER+CODE] D018 ACTIVE: History: a field-plus-intent text run closes on
  a 700 ms pause, field or caret move, selection, formatting, structural edit,
  undo/redo, a word boundary, or a 20-character cap; content and style share one
  coordinator per document. Header structure lives in the toolbar, keyboard, and
  right-click (no hover menu); auto-link deferral holds the paint stable during
  a pointer selection; contact undo restores a removed slot.
- 2026-08-03 [USER+CODE] D019 ACTIVE: RoleFit's Resume tab always mounts a real editor
  document; existence enables editing and strict save, while `resumeHasContent`
  gates PDF export, Polish, and Apply. The overlay caret owns editing except
  during IME composition (real-browser IME handoff and hint placement
  unverified).
- 2026-09-17..09-27 [USER+CODE] D020 ACTIVE: Measured wrapping covers paired entry fields,
  section titles, names, and contacts; header baselines use font-face metrics;
  the selectable DOM and PDF text follow logical field order; the PDF carries
  kern adjustments (TJ); year ranges and numeric dates no longer auto-link as
  phones. [CODE] Residual: non-year number ranges still auto-link; OS IME,
  screen readers, native Find UI, and other browsers are unverified.
- 2026-07-24 [CODE+USER] D021 ACTIVE: Underline and link rules come from `underlineSpans` and
  a face-derived `underlineRule(style)`; painted lines end with the separator
  their break stood for (`data-tsds`), so word selection never runs across a
  line break.
- 2026-07-29..09-28 [USER+CODE] D022 ACTIVE: PDF export embeds every face as `CIDFontType2` +
  `FontFile2`; downloads keep the anchor and blob URL alive so the `.pdf` name
  survives; the emitter disables pdf-lib's timer-based yields. Firefox
  background prioritization (consistent with Mozilla bug 1960734) still delays
  hidden tabs; the READMEs give the foreground workaround; the user's exact
  10–20 s case is unverified.
- 2026-10-17 [USER+CODE] D078 ACTIVE: In Typeset a completed browser autosave
  clears content and print-style dirty state like an explicit `.resume` Save,
  so the leave warning covers only edits not yet stored in this browser or a
  failed autosave.
- 2026-10-17 [USER+CODE+TOOL] D079 ACTIVE: The inline grammar's `<lt>` token is a
  literal `<`, written only where a raw `<` would start a tag, so text typed or
  pasted into either editor stays text. Paragraph merges and whole-field
  strip/wrap transforms keep literals literal; values the editor stores use that
  canonical spelling. It is string content within `schemaVersion: 1` (D007);
  older builds show it as `<lt>`. Resume Polish and its review prompts explain
  it, the Polish markup gate rejects every grammar tag except b/i/u and `<lt>`,
  and an edit that drops an escaped literal is warned. Limits: RoleFit's proposal Edit
  box edits the raw grammar; Final review evidence and cover-letter AI output
  read decoded text back as grammar; PDF import excludes tag-shaped source text.
- 2026-10-18 [USER+CODE+TOOL] D081 ACTIVE: **No document base size and no size
  scale.** Every text role has its own default (`TEXT_SIZES_PT`: name 25,
  section heading 12, titles 11, subtitles, contact, skill labels and body 10),
  shared by resumes and letters. Text without its own size paints at its role
  default (what the editor shows). Sizes read meaning, not tag spelling. A
  field's spacing and bullet dot follow its first character's size, so typing
  later in it, sizing a word inside it, or re-spelled runs never re-space it
  (larger words make room through overflow; a sized lead-in word spaces its
  whole paragraph, accepted [USER]). The Styles state, Body changes, Polish
  carry, and new-field seeding use the main size, the one most of its text
  carries. Empty fields never set a row's size; the skills `: ` takes the size
  both columns share, else the skills' first character's. The Styles menu has
  Name (default bold, now a removable `<b>`, painted in the display bold face)
  and Body rows (no B/I/U, so per-word emphasis survives). Resumes and letters
  share behavior and names: a letter's style keys are the resume's
  (`pageMargin*Pt`), a new letter takes the resume's page defaults, both
  starters share one placeholder header, both blanks one empty header, the
  name is removable in both, and a letter's Paragraph menu sets its header and
  body alignment (`headerAlign`/`bodyAlign`, optional on read, default
  center/left). Both stay `schemaVersion: 1` (D007): the parsers
  still read the retired `baseFontSizePt`, `fontSizePt`, and `margin*Pt` keys
  and write the sizes they implied, and the name's former forced bold, onto the
  fields; nothing writes them. Workspace files were rewritten the same way on
  2026-10-18 (398 files, layout unchanged; originals under ignored `.agent-work`).
  Accepted residue: 10.5 pt-base resumes' bullet text moves 0.74 pt right and
  their section rule 0.14 pt. In general any non-10 base moves the bullet text
  (fixed 9.47 pt gap), the section rule (scales with the heading), and a
  headerless page's first baseline (fixed 11 pt inset); an 11 pt letter's
  continuation-page top rises 1 pt; italic text in an
  old name now paints italic; an accepted Polish rewrite keeps its field's
  whole size and font but not per-word sizes inside it (Polish never sees
  them). Body's size and font change the main text and keep words set
  otherwise. Saved style preferences (a letter's stored default style,
  resume style presets) drop the retired size key and take the defaults.
- 2026-10-18 [USER+CODE+TOOL] D082 ACTIVE: **Alignment never changes line
  breaks.** Every alignment breaks as a ragged paragraph does (unused width is
  free, interword shrink keeps its budget); justify only stretches the spaces
  of the lines already chosen, as word processors do. Justified text set before
  this may re-break once; none of the 398 local documents used justify.
- 2026-10-18 [USER+CODE+TOOL] D083 ACTIVE: **The cover letter has the resume's
  Spacing menu** over the values a letter reads (line spacing and the three
  header gaps); built-in presets apply only those keys and saved presets stay
  resume-only. Header gaps leave the Header menu in both documents. Spacing and
  Paragraph values are one line each with a typeable value; Styles is a table.
- 2026-10-18 [CODE+TOOL] D088 AMENDED by D089: **Metrics measure Latin-1 symbols, Latin
  Extended-A, and common punctuation (`‚„†‡‰‹›′″€™−→←↑↓≤≥`) wherever a face
  has the glyph**, so the editor and PDF place them at real widths. The original
  repertoire alone sets catalog faces' vertical envelope, so a document using
  only it lays out exactly as before; a new letter in an entry title or subtitle
  adds its real ink to that row's spacing. Ligature-boundary entries for new
  characters are kept only where the font differs from the plain pair; a new
  character whose glyph a face classes as a mark stays unmeasured. A character a
  face lacks keeps the 500-unit fallback. Cost: metrics 3.3 → 5.45 MB raw, +215 KB
  brotli.
- 2026-10-18 [CODE+TOOL] D089 ACTIVE: **A measured character a face lacks is
  measured, painted, and embedded from the family's fallback**: Tinos for serif
  families, Arimo for sans (both bundled; each covers the whole measured
  repertoire). Only a character the face's fonts cannot draw is borrowed; a mark
  glyph the face draws but leaves unmeasured stays its own. Pairs kern only
  within one face. A decomposed accent composes where the face has the composed
  letter; elsewhere it keeps its earlier 500-unit-per-mark measurement (and
  `.notdef` in the PDF where the face lacks the mark), as on `main`. The editor
  loads a fallback family beside the pages, never withholding them. A document
  of composed text that borrows nothing lays out and exports exactly as before
  (419/419 local and starter layouts identical, all 148,756 runs drawn
  unchanged); one that does embeds only the borrowed fallback faces. Characters
  outside the measured repertoire (CJK, emoji, Cyrillic) keep the 500-unit
  fallback, and the PDF draws the face's own glyph or `.notdef`, while the
  editor's font stack may draw one from Tinos or Arimo; covering them needs new
  font assets.

### RoleFit product behavior and trust decisions

- 2026-09-18 [USER] D023 ACTIVE: Content and evidence checks warn across RoleFit while usable
  output and actions stay available; acceptance is not verification; truthful
  prompts and technical/stale-document protections stay blocking. Policy:
  `PRODUCT.md#content-and-evidence-warning-policy` (RoleFit only).
- 2026-09-27 [USER+CODE] D024 ACTIVE: Still blocking: confirmed BLOCKED eligibility stops
  automatic Polish; BLOCKED without explicitly conflicting excerpts becomes
  CHECK; Apply needs 40 authored words and no template slots in the cover
  letter; Resume Polish withholds edits containing placeholders; metadata-only
  Job analysis falls back to the local brief.
- 2026-09-30 [USER+CODE] D025 ACTIVE: Job analysis is plain structured JD extraction: the
  user trusts the selected model and wants no fact checking; the parser keeps
  type, enum, markup, and size guards without source matching, condition
  replacement, or evidence warnings.
- 2026-08-08..09-28 [USER+CODE+TOOL] D026 ACTIVE: Fit Assessment (formerly Initial Fit) is
  advisory: a categorical verdict (Strong, Reasonable, Stretch, Limited) with
  bounded exact excerpts, validated mechanically; semantic word-matching vetoes
  are gone (2026-09-18) while citation integrity and explicit-conflict checks
  remain; insufficient information is a neutral outcome; prompt
  `fit-assessment-direct-rubric-v7` (2026-09-28). Fit has its own stage
  settings, sharing Prepare's request only when they match Job analysis;
  **Reassess fit** always runs fresh; a stale run shows as **Previous
  assessment**; only the first Prepare-launched run may trigger automatic
  Polish; Apply keeps the latest assessment as one timestamped snapshot.
- 2026-09-30 [USER+CODE] D027 ACTIVE: Fit gap notes are not claim-checked (user-accepted: an
  invented claim there shows unflagged); `Match N:`, `Gap N:`, and
  `Eligibility:` warnings render beside their finding.
- 2026-08-07..08-08 [USER+CODE] D028 ACTIVE: Fit runs automatically by default; Resume and
  Cover automatic Polish are independent switches, off by default, with
  minimum-fit thresholds (fresh defaults Reasonable and Strong); only
  exact-evidence BLOCKED stops an eligible run. Polish turns on only the
  polished document's Include toggle.
- 2026-07-30..08-11 [USER+CODE+TOOL] D029 ACTIVE: Prepare is the default and sole job-intake
  surface (JobMenu retired): Source, then the editable brief with one Role
  context, then the Application rail with Resume (included by default) and Cover
  Letter (excluded by default) and Apply, which needs readiness only for
  included materials. `usePreparedResume` alone picks the preparation's resume,
  auto-selecting a unique winner only into a clean, unowned editor; the bundled
  starter never satisfies readiness, Fit, or automatic proposals; Prepare waits
  until the startup resume is committed. [USER] Prepare is flat, dense, and
  tool-like ("more functional/compact/less ai"); brief list sections edit as
  per-item rows under one tablist, and per-item toggles and drag reordering were
  declined.
- 2026-08-08 [USER+CODE+TOOL] D030 ACTIVE: The shared input firewall derives its data-only
  instruction and escaping pattern from one fence list.
- 2026-08-07..08-09 [USER+CODE] D031 ACTIVE: The fast path is Prepare → Fit → Polish → Apply:
  Prepare publishes the local brief first and provider failure leaves manual
  Polish usable; numeric scores, recruiter reviews, and Tailor/Review/Both
  settings were removed; each workflow owns a named progress card and every
  active request exposes Stop.
- 2026-08-07..09-30 [USER+CODE] D032 ACTIVE: Resume Polish is one proposal request over
  opaque `target-N` ids (only bullets (rewrite/remove), actual Skills lists,
  linked new-bullet slots, and in-entry bullet order are mutable; Skills
  category labels, identity, contact, education, standard-entry
  role/employer/subtitle/dates, and omitted sections are locked; oversized
  target sets are ranked by materiality and job relevance) with distinct
  Proposal, No changes, and Withheld outcomes (the 2026-10-07 opt-in review is
  the one exception). It also proposes bullet removals and per-entry reorders,
  grouped Rewrite / Add / Remove / Reorder; entry-level removal/reorder and
  Profile swap are out of scope; the "Proposed improvements" summary is not
  claim-checked. UNCONFIRMED: browser QA of the grouped rail and live-provider
  use of those rules.
- 2026-08-09 [USER+CODE+TOOL] D033 ACTIVE: Accepting is one interaction for both documents
  through the footer `ProposalDecisionBar` (`Accept all` / `Discard all`,
  `Accept proposal` / `Discard proposal`) and one `ProposalDiff`; every resume
  decision is reversible; a resume-only change leaves a pending cover proposal
  acceptable with a warning. Browser QA of the bar and letter diff is
  UNCONFIRMED.
- 2026-08-04 [USER+CODE] D034 ACTIVE: Workbench: Polish is one rail action (header when open,
  beside the reopen tab when closed); vocabulary **Polish** / `Polishing…` /
  `Polish again` and Accept/Discard; footers carry only Stop, Retry,
  Accept/Discard, and Restore previous; the Resume More menu was removed at the
  user's request; the rail closes to zero behind an icon-only edge tab ([USER]
  chose it over a labelled tab), with a count only for a validated post-draft
  Cover Letter `blocked` response. Opening the rail does not shift the page
  (`.studio-body` uses `overflow: clip`), and the idle Cover Letter rail does
  not restate its workflow message. [USER] The rail resizes from 18rem (default)
  to 28rem with one shared width (`rolefit:document-rail:width`).
- 2026-07-28..08-05 [USER+CODE] D035 ACTIVE: Cover Letter Polish is one operation: the server
  resolves date, names, greeting, and sign-off and sends the whole evidence
  corpus with the user's template; the model chooses the evidence; a failure
  gets one silent repair, then 422; a valid letter is staged as a fingerprinted
  whole-document proposal. Questions are the exception path (missing name, role,
  or company; an unanswered private slot). Employer facts never count as
  candidate evidence. [USER+CODE] The cover quality corpus stays synthetic and
  never reads `workspace/cover-letters/`. [ASSUMPTION] Future employer research
  must never block Polish or send resume or Profile text to a fetcher.
- 2026-07-24..07-25 [USER] D036 AMENDED by D081: The cover letter has its own always-present editor
  page and starts from the user's own letter, tailored to the job and truthful
  evidence; it is plain correspondence (no resume sections, rules, columns,
  bullets, or resume spacing settings; AMENDED by D083: it has the resume's
  Spacing menu over its line spacing and header gaps) with the same toolbar family, named
  variants and history like base resumes, and the same PDF rename prompt. New
  letters use double line spacing with 0.5 in top/bottom and 0.75 in side
  margins (2026-07-27, which also recorded 8 pt after each paragraph);
  2026-07-28 [USER]: the default rhythm is explicit 8 pt space-before on every
  paragraph. (Page defaults AMENDED by D081: a new letter takes the resume's.)
- 2026-07-25..08-13 [USER+CODE] D037 ACTIVE: Resume and cover letter share `DocumentOpenMenu`
  and `DocumentSaveMenu` (no Starter button); Resume Open accepts only strict
  `.resume` and Cover Open only strict `.cover`. Cover-letter startup mirrors
  the resume's, and automatic title changes no longer cancel it or Prepare's
  selection; base cover letters are flush-left block letters; app-produced
  titles follow `Name_Company_Resume` / `Name_Company_Cover_Letter`.
- 2026-07-27..07-31 [USER+CODE] D038 ACTIVE: Apply snapshots each included document; each
  then keeps its own saved state and an "Update application" row that commits
  source bytes plus its tracker fields atomically against the current revision;
  nothing saves on an effect. Applications store only editable sources
  (`resume.resume` / `cover.cover`) and render PDF on demand; extra PDF
  attachments (8 MB each, 10 per application) download only. Apply's prompt
  names each included PDF separately and Apply is single-flight. Both editors
  keep per-tab recovery drafts via `lib/autosaveDraftStorage.ts`.
- 2026-08-11..08-12 [USER+CODE] D039 ACTIVE: A fresh preparation creates a tracker row only
  on Apply or Skip & save job (and, since 2026-10-07, as a Draft on a first
  Answers Save); opening a saved record updates that exact id; Application
  Detail and the Applications inspector share one presentation. Recovery is
  interruption-only: a fresh tab never adopts a closed tab's draft, same-tab
  entries expire after 24 hours, and an excluded dirty document releases once
  its recovery write succeeds; concurrent Application Detail edits fail closed.
- 2026-08-10 [USER+CODE+TOOL] D040 ACTIVE: Preparation stabilization: draft and committed
  preparation are distinct; Stop or input changes cannot publish late success;
  candidate facts are tri-state declarations; authored blank resumes are
  applicant-owned; workspace saves use an invocation-order queue and a monotonic
  baseline revision. Browser interaction QA is UNCONFIRMED.
- 2026-09-04 [USER+CODE+TOOL] D041 ACTIVE: Stages group as Active (Applied, Interviewing,
  Offer) and Inactive (Skipped, Rejected, Withdrawn) with movement either way; a
  formerly applied record keeps its date, documents, and attachments when
  Skipped. Applications and Analytics show layout-shaped skeletons (browser QA
  unverified). 2026-08-08..08-15 [USER+CODE+TOOL]: search covers only company,
  role/title, and a readable posting ID; the table keeps native scrollbars, a
  sticky head, and an aligned Fit column; the inspector and Prepare rail contain
  long values without widening the page; Prepare and Applications keep a stable
  desktop height above 1080px. 2026-09-03 [USER+CODE+TOOL]: **Bold keywords in
  bullets** (Settings > Guidance, default on).
- 2026-09-28 [USER+CODE] D042 ACTIVE: Settings > About you became **Profile**: declared facts
  plus one **Background** (`profileBackground`). Every stage sending candidate
  context gets the whole Background up to 12,000 characters and declines above
  it (user-approved, no clipping); servers reject merged context above 13,000;
  storage allows 60,000. Per-source Experience evidence rows were removed into a
  `## Experience by type` block. 2026-08-09: GPA (0–4.0, only with declared
  education) and earliest-start availability are optional facts. 2026-07-25
  [USER]: facts emit nothing until declared, so an undeclared citizenship,
  clearance, or degree never becomes groundable wording.
- 2026-08-06..09-29 [USER+CODE] D043 ACTIVE: Naming: Distill became **Job analysis**; stages
  `job-analysis`, `fit-assessment`, `resume-polish`, `cover-polish`,
  `application-answers`, `application-review`; keys `<camelCase stage
  id>Provider|SelectedModel|CliReasoningEffort`; routes `/api/job-analysis`,
  `/api/resume-polish`, `/api/cover-polish`; `candidateContext` is facts plus
  Background; auto-run keys `fitAssessmentAuto`,
  `resumePolishAuto`/`coverPolishAuto` plus `…AutoThreshold`. Old names convert
  once in `migrateStoredSettings`. [ASSUMPTION] Reload open tabs after
  upgrading; back up before a rollback.
- 2026-09-29 [USER+CODE] D044 ACTIVE: Profile-aware Resume Polish: a Background heading
  naming exactly one standard entry links its text to that entry
  (`linkProfileBlocks`); Polish may rewrite that entry's bullets from it and
  fill two `new-bullet` slots per linked entry; grounding failures stay warnings
  (CR001 Option A). UNCONFIRMED: the user's decisions on CR002 v2
  (enclosing-heading rule) and the stricter ownership check, and live-provider
  behavior of linked-entry rewrites and new-bullet slots. [USER]
  Profile-driven swapping and entry-level removal/reorder stay deferred.
- 2026-10-01 [USER+CODE] D045 ACTIVE: Job-link import selects the exact posting from Ashby
  boards, JobPosting JSON-LD, Oracle, iCIMS, Dayforce, Workable, and UKG data;
  missing LinkedIn, Greenhouse, Ashby, and Jobvite jobs fail with
  paste/extension guidance. Known limit: a non-Greenhouse URL with `gh_jid` plus
  `for`/`board` fails instead of falling back. [USER+CODE] A Profile line's own
  source type wins over its heading in Fit's source-type check.
- 2026-09-08 [USER+CODE] D046 ACTIVE: Paragraph-cited cover evidence, bounded Resume targets
  with advisory suggestions, and an optional session-only final review of
  included materials; legacy Fit/date representations stay readable.
- 2026-07-25..08-01 [USER] D047 AMENDED by D093: One Settings dialog, opened from the studio rail's
  foot, holds every preference and shows no runtime diagnostics (those belong to
  RoleFit Companion); Reset sits at the foot of the section rail; rows are
  frameless, never card-in-card. [CODE+USER] Custom instructions are per stage
  over a shared default (Job analysis and Fit take none); an emptied override is
  deleted. [CODE] `src/config/aiStages.ts` is the single stage declaration;
  `normalizeSettings` may repair and remove but never add. [USER+CODE+TOOL] The
  masthead owns only identity and Apply; Sessions sits in the studio-rail
  utilities. (D093: the masthead is now the rail head with the brand only;
  Apply floats over the workspace.)
- 2026-10-18 [USER+CODE] D084 AMENDED by D085: **A letter's Blank and Starter match the
  resume's** ("blank resume/letter should same default font/style. use resume
  as the default, same for start bundler for both and the editor file name").
  Cover Blank and Starter (and restoring an application with no saved letter,
  which opens a Blank) reset the persisted letter style to the D081 defaults,
  as the resume's Blank does, and take their title from the resume's
  (`Name_Company_Resume` -> `Name_Company_Cover_Letter`, `Resume` ->
  `Cover Letter`). Saved `.cover` files keep their own style, and the letter
  shown on page load keeps the browser's stored style until the next Blank or
  Starter. (Title AMENDED by D085: a fresh letter is titled for its own
  letterhead name only.)
- 2026-10-18 [USER+CODE] D085 ACTIVE: **A document's title follows its
  identity until the user names it** ("opening a bundle starter would
  sometime display resume instead of your_name_resume ... typing a name doesnt
  change resume title ... unify the behavior"). Both editors title a document
  `Name_Company_<Kind>` from its own header name only and the PREPARED
  company (a draft edit to the job source never retitles) ("remove that fallback": a nameless Blank letter is `Cover_Letter`,
  never the resume's name). Blank and Starter
  open with that title for the document they open; editing the name, opening
  another document, or the job and resume loading in either order retitle any
  automatic title (a placeholder, or a title pairing any current or previous
  name, or for a letter the resume's applicant name an earlier build used, with
  any of their companies, either part optional); a title the user typed is
  never rewritten. An automatic
  retitle keeps a clean letter clean. A newly prepared job is a new session and
  still retitles both, typed titles included ([USER] confirmed); so does
  editing the prepared job's role or company in Prepare. Accepted tradeoff: a
  typed letter title that exactly matches the resume-applicant form is treated
  as automatic.
- 2026-10-18 [USER+CODE] D086 ACTIVE: **A new session opens both Starters**
  ("new session for resume / letter should either both start on
  template/blank"). With no saved document of its kind, each editor opens its
  bundled Starter (the letter used to stay blank); a saved one still opens
  instead. The letter's page-load Starter keeps the stored style and title
  (D084). The templates already share the `Your Name` letterhead and stay as
  they are: the resume's sample is gated by its `starter` origin, the letter's
  by its `[bracket]` slots (`coverLetterReady` needs none).

- 2026-10-22 [USER+CODE+TOOL] D093 ACTIVE: **RoleFit's look is a calm native
  workspace, in light and dark.** The user replaced the green-paper "Drafting
  Desk" visuals (serif titles, tracked mono eyebrows, hairline-framed cards)
  with an Apple-apps / Things 3 direction: neutral cool grays, one blue accent,
  borderless groups separated by tone, filled inputs and controls, system UI
  type with tabular figures. Liquid glass was considered and dropped because
  Firefox lacks backdrop refraction. Every color is a `light-dark()` token; the
  OS decides unless Settings › App › Appearance pins Light or Dark, a
  per-browser view preference (`rolefit:appearance`) that never enters
  workspace preferences or documents and is untouched by Reset all settings.
  Document pages stay paper (`color-scheme: light`). Scope is RoleFit host
  chrome only: `packages/editor` re-themes through RoleFit tokens unchanged.
  (AMENDED 2026-10-22 [USER]: the public landing page follows the same system, importing
  `src/styles/tokens.css` and the OS theme with no override; its structure and
  claims stay, and its app screenshots were retaken, the companion shot after
  the companion restyle.) (AMENDED 2026-10-22 [USER+CODE]: the desktop companion
  follows the same system too. `desktop/companion.css` mirrors the token values
  (it never imports app CSS, and its local-file CSP stays closed) and follows
  the OS theme; its fixed 760×480 window is a unified shell with a hidden
  native title bar. One brand mark, the accent tile with an Inter Bold "R", is
  generated by `desktop/assets/generate_icons.py` for the desktop icons and the
  browser, landing, and extension SVGs; the extension's toolbar icon and
  in-progress badge moved to the accent.) (AMENDED 2026-10-23 [USER+CODE]: the
  extension popup follows the same system too. `extension/popup.css` mirrors
  the token values (it never imports app CSS), follows the OS theme with no
  override, and uses the system UI stack; its structure, copy, 344px width, and
  its own compact type sizes stay.)
  The top bar is gone: a full-height
  studio rail is headed by the brand (which collapses the rail; the rail also
  resizes and drags shut, a per-browser preference), and the global Apply
  action floats at the workspace's bottom-right, naming the prepared posting
  and its readiness in words. This supersedes the "compact masthead" shell
  wording. `apps/role-fit-ai/DESIGN.md` owns the system.

### AI providers, defaults, and benchmark outcomes

- 2026-09-30 [USER+CODE+TOOL] D048 AMENDED by D070, D087: GPT-6.1 Sol (`gpt-6.1-sol`) and Claude Sonnet 5.5
  (`claude-sonnet-5-5`) are the Codex and Claude defaults for new or unset
  stages and the server fallback; saved selections are not moved; Sonnet 5.5 on
  the API sends `thinking: {type: "between_tools"}`; retired Codex ids repair to
  GPT-6.1 Sol. The 2026-10-07 per-stage startup defaults override this for their
  stages. Observed Claude Code 2.1.285 (Sonnet 5.5 needs 2.1.284+) and
  Codex CLI 0.159.2. Receipt: `apps/role-fit-ai/docs/engineering/ai-server.md`.
  UNCONFIRMED: live provider calls.
- 2026-09-27 [USER+CODE] D049 AMENDED by D076, D087: GPT-6 Astra/Sol/Luna and Claude Fable 5.1 / Opus 5.5
  joined the CLI/API catalogs (the user waived the Product Partner flow); Codex
  5.4, 5.4 Mini, and Spark were removed; GPT-5.5 remains until its announced
  2026-10-14 retirement. [CODE+TOOL] Retired Codex selections repair within
  their stage/provider; one app-owned CLI effort contract serves settings,
  validation, and Claude argv.
- 2026-08-08 [USER+CODE+TOOL] D050 AMENDED by D080: Five integrations (Claude CLI, Codex CLI,
  Antigravity CLI, OpenAI API, Claude API) and no speculative provider;
  Antigravity's full calibration matrix is unconfirmed. 2026-08-09: a private
  71-application Fit calibration found GPT-5.5 medium the strongest balanced
  configuration and rejected a broader prescriptive rubric.
- 2026-07-24 [TOOL] D051 ACTIVE: Application-writing guidance sources and the resulting
  prompt policy are in `apps/role-fit-ai/docs/engineering/ai-server.md`.
- 2026-10-17 [USER+CODE] D076 ACTIVE: GPT-5.5 left the Codex catalog after its
  2026-10-14 retirement; a saved GPT-5.5 stage selection repairs to the Codex
  default within its stage, as the earlier retired Codex models do.
- 2026-10-17 [USER+CODE] D080 ACTIVE: **Antigravity CLI (`agy`, `antigravity-cli`)
  support is removed** ("remove support for agy, everywhere in this app"). Four
  integrations remain: Claude Code CLI, Codex CLI, OpenAI API, Claude API.
  [CODE] Saved state stays readable: a stage saved with Antigravity is set to its
  own Claude Code or Codex default before strict validation (browser cache,
  workspace preferences, backups; Final review never inherits Fit's provider); a provider
  vault listing `antigravity-cli` drops the id and keeps its API keys and
  other providers; any other unknown id still fails closed. The manual
  ready-to-verify state and the space/parenthesis allowance in model names
  went with it. Historical release notes are unchanged.
- 2026-10-18 [USER+CODE] D087 ACTIVE: **CLI and API behave the same; plans and
  transport are one-shot rewrites** ("either both get a off option or both
  dont ... keep the reasoning effort level the same for both cli and apis").
  - Effort: no off setting on either transport; a vendor's API takes its CLI's
    effort scale and defaults (Codex `ultra` stays CLI-only). Claude API sends
    adaptive thinking with `output_config.effort`, OpenAI API `reasoning.effort`;
    32,000 output tokens, 240 s timeout. Supersedes D048's `between_tools`.
  - Naming: *Claude · CLI/API* and *OpenAI · CLI/API* in the browser, companion,
    and server messages; Claude Code and Codex only for install/sign-in. Ids
    and the `…CliReasoningEffort` keys are unchanged.
  - Settings > Models: **Plan** (Hybrid recommended, Claude only, OpenAI only)
    and per-vendor **CLI/API** controls rewrite every affected stage once,
    including Application questions; their state is derived from the rows,
    never persisted. Hybrid is the fresh/reset default.
  - [USER+CODE] Catalog: current models only (Claude Fable 5.1, Opus 5.5,
    Sonnet 5.5, Haiku 5.5; GPT-6 Astra, GPT-6.1 Sol, GPT-6 Luna) on both
    transports; removed ids repair to a same-tier successor before strict
    validation; the OpenAI API default is GPT-6.1 Sol.
  - [USER] Single-vendor plans were to be benchmarked on budget models until
    usage ran out, then shipped as best guesses; results are in
    `apps/role-fit-ai/docs/engineering/benchmarks.md`.
  - [TOOL] Live Claude API smoke passed: Fable 5.1, Opus 5.5, Sonnet 5.5, and
    Haiku 5.5 at Low and Max through this branch's companion (one synthetic
    Job analysis each). UNCONFIRMED: the OpenAI API body live (no credits),
    including `xhigh`/`max` on Astra and Luna.

### Tracker, storage, and workspace

- 2026-07-26 [USER+CODE] D052 ACTIVE: The data root is `workspace/`:
  `resumes/<variant>.resume` and `cover-letters/<variant>.cover`, each with its
  own `.trash/`; tracker, applications, and preferences stay at the root.
- 2026-08-09..08-10 [USER+CODE+TOOL] D053 ACTIVE: Preferences live in owner-only
  `workspace-preferences.json` (localStorage is a fail-open cache); backup,
  preference, and restore-marker contracts are schema v1 only; 0.6.0 backups do
  not restore into 0.7.0+. 2026-10-19 [USER+CODE]: backups include saved
  `.cover` variants and their history (superseding the 2026-07-26 exclusion);
  history is best-effort (newest first within the limits, invalid history left
  out); files kept from deleted applications (`applications/.trash/`) stay
  local until a real "Recently deleted" exists. Still schema v1, so these
  backups need this build or newer.
- 2026-09-29..09-30 [USER+CODE] D054 ACTIVE: Preference writes require `baseRevision`
  (SHA-256 of the stored bytes); a mismatch returns `409 { stale, current }` and
  the tab rebases once. Contract:
  `apps/role-fit-ai/docs/engineering/workspace-backup.md`, which also documents
  a known race (2026-10-01): the pending-edits record does not name its tab, so
  a new tab can write a live sibling's older value.
- 2026-07-27 [USER+CODE] D055 ACTIVE: Tracker PUTs send only `upsert` records; the server
  keeps existing order and prepends new records; explicit Refresh and `409`
  snapshots are fully fresh (write responses became revision-aware and sparse on
  2026-10-09). [USER+CODE+TOOL] The cold duplicate scan runs after the first
  Applications paint and is cached across tab visits; the 27-record corpus pins
  all 351 pairs (candidate pairs replaced the all-pairs loop on 2026-10-09).
  2026-08-11 [CODE]: duplicates link by posting group or record a reviewed
  separation.
- 2026-08-09 [USER+CODE+TOOL] D056 ACTIVE: Tracker reads fail closed on unknown fields,
  retired shapes, duplicate ids, and malformed data; only a redundant derived
  Fit summary leaf is normalized for comparison; the tracker key `initialFit`
  stays a storage-boundary name. [USER+CODE] Legacy tracker-schema compatibility
  was left to a one-user preview migration.
- 2026-10-20 [USER+CODE+TOOL] D091 ACTIVE: **Submitted applications keep a dated
  stage history** (`stageHistory`): stage changes after submission, interviews
  with a kind and a derived round, employer responses, and follow-ups sent.
  Dates are day-granular (time of day declined by the user for now). The stored
  stage stays the source of truth; the server refuses a stage change on a
  submitted record without a new matching stage entry. Each timeline entry
  saves on its own, apart from Application Detail's Save changes, and only
  saving a new interview on an Applied record moves the stage. Older builds
  reject a tracker or backup that holds history (user-accepted). Its
  "derived, never stored" ghosted sentence is AMENDED by D092.
- 2026-10-20 [USER+CODE] D092 ACTIVE: **No response is derived; Ghosted is a
  stored stage.** An Applied or Interviewing application whose latest activity
  (the submission or any timeline entry, a sent follow-up included; a
  future-dated interview or a follow-up planned for today or later keeps it
  fresh) is at least `ghostedAfterDays` local days old (default 21, whole days
  7-180, committed only when settled, never mid-typing) is flagged No
  response, never stored.
  The user marks flagged records **Ghosted**, an inactive stage, one at a time
  or in one atomic bulk write dated today, and may opt in to automatic marking
  (`autoMarkGhosted`, default off; the user chose both over manual-only): each
  automatic mark is dated the day the threshold passed, runs after a fresh
  re-read under a same-origin tab lock (rechecking the shared settings cache),
  skips the record open in Application Detail in its own tab (open records are
  not shared across tabs: a mark under another tab's open record makes that
  tab's save report a conflict, never overwrite), re-runs at local midnight,
  and tries a record at most once per session; tabs on different origins are
  not coordinated. Ghosted can return to Applied, Interviewing, Offer,
  Rejected, or Withdrawn, or be Skipped like any record; a move back, or a newly logged interview (which reopens it as
  Interviewing), records a dated entry that restarts the count. Older
  builds (0.18.x included) reject a tracker or backup carrying `ghosted`, and
  reject the workspace preferences file for every user of this build, since it
  always writes the two new keys (confirmed by reading 0.18's code, not run).

### Extension

Pre-October popup, pairing, port-storage, and shortcut detail is app-operational
and lives in the app ledger.

- 2026-07-27 [USER+CODE+TOOL] D057 ACTIVE: The companion writes its validated port into the
  materialized extension runtime config, which since 2026-08-01 is only the
  first-install seed.
- 2026-10-17 [USER+CODE] D077 ACTIVE: Extension intake is an ordinary Prepare:
  automatic Polish after it follows only the Settings switches and thresholds
  (D028), and the extension has no automation control of its own.

### Desktop companion, distribution, and release/deploy state

- 2026-10-01 [TOOL] D058 AMENDED by D075: 0.8.0: `rolefit-preview-v0.8.0-beta.1` on `d7f12a0`
  (#161), run 36862392970, five installers plus `SHA256SUMS.txt`; extension
  1.2.1. `docs/releases/0.8.0-beta.1.md` discloses that `.resume` files without
  `bulletIndentPt` are rejected (add `"bulletIndentPt": 14.73` to `style`).
  Its Typeset build-cache sentence moved verbatim to `docs/continuity/2026-10.md`.
- 2026-10-15 [USER+CODE+TOOL] D075 ACTIVE: **The Typeset EC2 host never builds.**
  It is a t3.micro (1 GiB, x86_64, no swap). After #219, `tsc` and `vite build`
  peaked near 1.3 GB, and the on-host build hung the instance. The deploy now
  ships the image the `container` job built (`--platform linux/amd64`) and
  HTTP-probed. The host only checks it is x86_64, then runs `docker load`, retags
  and swaps the container. A host with a different architecture or type must
  update the platform and the guard together. [CODE] 2026-10-15: before the
  swap the host tags the serving image `typeset:previous`; when the new
  container fails to start or does not answer within 10 s, it restarts that
  image and the job still fails.
- 2026-08-10 [USER+CODE+TOOL] D059 ACTIVE: **1.0 is deliberately not claimed**; its criteria
  are a genuinely signed release and a compatibility policy promising migrations
  for `.resume`, `.cover`, and `.rolefit-backup`; 0.x minors carry behavioral
  breaks. 0.7.0 shipped with extension 1.2.0 (tag
  `rolefit-preview-v0.7.0-beta.1`); [TOOL] 2026-10-09 `gh release view` shows
  it published 2026-08-10T22:19:45Z.
- 2026-08-10 [USER+CODE+TOOL] D060 ACTIVE: Landing screenshots are 2x captures from a
  synthetic pack served through `ROLEFIT_WORKSPACE_DIR` on a spare port.
  `landing/screenshot-manifest.json` plus `assertScreenshotVersionStamps` check
  any version printed in a screenshot in both release workflows and the Pages
  `verify` job; capture is not automated in CI and used Edge over CDP because
  this machine's Chrome policy sets `DeveloperToolsDisabled=1`. Companion
  recaptures from 0.8.0 on used isolated user data, an empty workspace, and
  port 5181 (see 2026-10-08).
- 2026-08-01 [USER+CODE+TOOL] D061 ACTIVE: 0.6.0 (extension 1.1.0, API 12) published via run
  `30717428328`. API 12 added a bounded main-owned extension-setup copy
  operation with no generic renderer clipboard/path capability. 2026-07-26
  [USER]: the release after 0.3.0 was to be a larger step than 0.4.0; [CODE] it
  became 0.5.0.
- 2026-07-27 [USER+CODE+TOOL] D062 ACTIVE: Only the live private utility handle proves this
  companion started the server; Stop and Restart revalidate RoleFit identity and
  send one graceful `SIGTERM`; unknown listeners are never signalled and
  external ones never force-killed.
- 2026-09-30 [USER+CODE] D063 ACTIVE: Companion UX: inline Access card (pending requests
  first, **Approve & restart**, two-step Remove), per-browser install guides,
  and copy fields. Contract: `apps/role-fit-ai/desktop/AGENTS.md`. UNCONFIRMED:
  a live extension install against the real companion and
  screen-reader/forced-colors rendering.

### Process and workflow decisions

- 2026-07-24 [USER] D064 ACTIVE: Before requested pushes, review and update affected README
  and docs and commit compact, privacy-safe continuity with the behavior slice;
  a version change is complete only after a triggered, successful
  release/publish workflow.
- 2026-09-08 [USER+CODE] D065 RESOLVED (one-time authorization): Authorized review, browser QA, and merge of the
  accumulated RoleFit evidence-grounded drafting work (an authorization for that
  work, not a standing rule).

### Decisions from dated entries (2026-10-04..10-11)

- 2026-10-04 [USER+CODE] D066 ACTIVE: **Resume Polish prompt v5** (the user asked for the review,
  benchmark, and implementation): rewrites keep each bullet's tense; a
  materiality rule omits churn; separate facts and broader posting terms never
  become a new claim; an entry gets removals or one reorder; the current-role
  present-tense rule (shared `accomplishmentStyleRules`) is gone. The user
  declined a page-impact line or any warning in the review rail. [TOOL] v5 beat
  the previous prompt with every judge; judges show family self-preference, so
  cross-model comparisons rest on agreement (results in ignored
  `apps/role-fit-ai/workspace/tailor-benchmark/`).
- 2026-10-04 [USER+CODE] D067 ACTIVE: Round 3: [USER] one page is a soft target and never blocks an edit
  or decides materiality. [CODE] Warnings name up to three concerns;
  "object-oriented" grounds "OOP"; tense-only or trivial rewrites settle as
  `UNCHANGED`. [USER] The saved Resume Polish instruction carries a soft
  one-page paragraph (it beat the "must be paid for" paragraph 40–4; private
  data, backed up).
- 2026-10-05 [USER+CODE] D068 ACTIVE: **Cover Letter Polish benchmark, evidence guard, and base letter**
  (task `cover-polish-benchmark-20261005`; the user asked to improve all three
  the way Resume Polish was proven).
  - The prompt is unchanged: a restraint variant won on Sonnet 5.5 and Opus 5.5
    but lost on GPT-6.1 Sol medium, which prefers the shipped prompt; with it
    Sol beat Sonnet 25–2 and Opus 16–0 where judges agreed, with the fewest
    unsupported sentences (3.4% vs 12.6% and 13.4%). [USER] 2026-10-06: the
    cover stage is Codex / GPT-6.1 Sol / medium. Harness under
    `workspace/cover-benchmark/harness/`.
  - [CODE] Cited deterministic slot ids are dropped, not repaired (114 of 120
    baseline runs had paid a repair call). The evidence guard (rules in
    `server/ai/AGENTS.md`) scopes citations to whole entries with Profile
    sections linked by heading. [TOOL] Replay of 120 letters: precision 12.4% →
    27.8%, recall 16.9% → 5.8%; probes in
    `cover-letter-warning-precision-probes.mjs`. Residuals: a capitalised word
    opening a clause after a denied list is absorbed; a company name under three
    characters reads as another employer; "I had hoped for" reads as a past job.
  - [USER+CODE] **One base cover letter**: specialized variants added nothing
    measurable, so [USER] there is one variant, as the resume has one
    (`default.cover`, plain first-person voice). [USER+CODE] Second round
    (2026-10-06): the opening slot asks for one checkable posting detail and one
    closing slot names a concrete team responsibility; it beat the installed
    letter 34–0 where judges agreed (unsupported facts 3.2%). Old letters are in
    `cover-letters/.trash/`.
- 2026-10-06 [USER+CODE] D069 ACTIVE: **Prepare correctness, the Prepare benchmark, and Polish gates**
  (task `prepare-benchmark-20261006`; "go with all the recommendations as
  needed"). [CODE] The brief's 9,000-character cap budgets whole items (required
  first); Fit's input limits are measured before dispatch. The Fit consistency
  runner became the Prepare benchmark; `coverLetterJudge.ts` (benchmark-only)
  scores whole letters and `EVAL_JUDGE=panel` refuses a Sol judge.
  - [TOOL] On a live screen and a 20-posting x 3 holdout, combined Sonnet 5.5
    low (median 4.9 s, extraction 0.997) was about three times faster than the
    split Codex pair (17.5 s, 0.993) at equal Fit outcomes; a matched test on
    ten real applications showed the brief's source does not measurably change
    Polish, so Prepare is chosen on speed and cost (receipts in ignored
    `workspace/fit-assessment-eval/`).
  - [USER] 2026-10-06: the user adopted the recommendation; Job analysis and Fit
    are Claude CLI / Sonnet 5.5 / low, so Prepare takes the combined path.
  - Deferred: application-level result caching and AI variant selection (measure
    repeat preparations first).
- 2026-10-07 [USER+CODE] D070 ACTIVE: **Per-stage startup defaults** (`src/lib/stageSettings.ts`):
  Prepare/Fit Claude CLI Sonnet 5.5 low; Resume Polish and Cover Codex CLI
  GPT-6.1 Sol medium; Answers Claude CLI Opus 5.5 high; Final review Sonnet 5.5
  low (retained user choice). Saved choices stay. Answers' setting comes from a
  blinded synthetic comparison (Opus high a modest lead; Sol medium the OpenAI
  alternative; no human calibration; receipts in the app ledger); results and
  costs are in `docs/engineering/testing.md` and
  `docs/engineering/benchmarks.md`.
- 2026-10-07 [USER+CODE] D071 ACTIVE: **Resume Polish fresh/reset default is Codex CLI / GPT-6.1 Sol /
  medium**, superseding Claude CLI / Opus 5.5 / high; saved choices stay and the
  user's own selection was switched (app ledger). [TOOL] On 39 synthetic cases
  Sol medium passed 39/39 with 0 unsupported edits and Opus high 35/39 with 3
  (all combining separate facts); real applications pull both ways (the
  2026-10-04 holdout favored Opus 11–5). A user-directed, safety-first choice;
  the only fact-check judge is Astra, Sol's vendor.
  - [USER+TOOL] The paired real-application rerun ran 2026-10-20 (Stage 2B),
    over 20 applications with blinded Astra + Opus judges in both orders.
    Neither arm made an unsupported edit. Judges split by family (Astra Sol
    13–6, Opus Opus 15–1). The default stands pending the user's decision;
    numbers are in `apps/role-fit-ai/docs/engineering/benchmarks.md`.
  - [CODE] Fixed 2026-10-10 (see that day). Was: a Claude-only user got a
    generic "check AI settings" Polish blocker instead of "add Codex";
    switching Resume Polish to Claude CLI seeded Sonnet 5.5 low rather than
    Opus 5.5 high.
- 2026-10-07 [USER+CODE] D072 ACTIVE: The Settings > Automation Fit toggle governs only automatic runs
  and the automatic Polish that depends on them; **Assess fit** / **Reassess
  fit** always run once a posting is prepared and never carry an automation
  token; a mid-Prepare toggle change cancels that Prepare and its Fit request.
  The user chose this option in chat.
- 2026-10-08 [USER+CODE] D073 ACTIVE: Submitted metrics follow the code's rule (user choice): a job-only
  Skipped decision never counts as submitted or as a calendar submission, an
  application later marked Skipped keeps its original submission, and no Skipped
  record counts toward follow-up hygiene; the app docs now say so.
- 2026-10-10 [USER+TOOL] D074 ACTIVE: **Stage 2A: the opt-in Resume Polish review stays off by
  default** (user-accepted). A paired run over the 39 synthetic cases failed
  the 2026-10-07 default-on bar on both Sol medium and Opus high; numbers are in
  `apps/role-fit-ai/docs/engineering/benchmarks.md`. Stage 2B (the paired
  real-application rerun) ran 2026-10-20 on the current prompt (see D071).
  [TOOL] Codex CLI 0.162.1 was installed on this machine
  (npm global); the Codex desktop app's bundled binaries are not on PATH.
