# RoleFit AI Continuity

Cross-workspace decisions and handoff state. Keep entries factual, dated, and
bounded; app-only operational detail belongs in the affected app documentation.

> Compacted 2026-10-09; full prior text is in git history (CONTINUITY.md at commit 8ed2e374).

## Durable state (compacted through 2026-10-02)

Bullets keep the date and tag of their source entries; the dated entries below
win on conflict.

### Monorepo, packages, toolchain, and CI

- 2026-07-24 [CODE] `@typeset/engine` owns measurement, line breaking,
  pagination, fonts, DOM/PDF painting, and the strict portable-file primitives;
  RoleFit owns job/provider orchestration, source-letter intake, tailoring, and
  review UX; `FormattingToolbar.documentStyleTools` and `documentStructureTools`
  are the host seams.
- 2026-08-01 [USER+CODE+TOOL] Typeset and the private `@typeset/engine` /
  `@typeset/editor` packages share a 0.2.0 milestone (metadata only; link ranges
  stay `*`), published by the Typeset static-container deploy from `main`; that
  milestone's PR checks, `Typeset CI and Deploy` run, and live-site receipt are
  UNCONFIRMED.
- 2026-07-29 [USER+CODE+TOOL] Toolchain: Node 24.18+ below 25 (`.node-version`:
  24.18.0), npm 11.16.0, root-owned TypeScript 7.0.2/Vite/React tooling, a
  pinned install-script allowlist, and the dependency-contract gate; Electron
  43.7.9 (bundled Node 24.21.0; superseded 43.2.0 on 2026-10-09, see that day).
  Actions are SHA-pinned; Dependabot has no auto-merge and checks npm monthly
  (2026-10-09); Vite, TypeScript, Electron, PDF/font, and Python bumps stay
  manual.
- 2026-07-29..07-31 [USER+CODE+TOOL] PDF dependencies stay `pdf-lib` 1.17.1,
  `@pdf-lib/fontkit` 1.1.1, and React-PDF 10.4.1; RoleFit declares `pdfjs-dist`
  5.4.296 (contract-pinned to React-PDF's). `devEngines` enforcement on a
  mismatched toolchain is UNCONFIRMED. `.gitattributes` sets `* text=auto
  eol=lf`; `fonts:check` runs via `packages/engine/scripts/run-python.mjs`.
- 2026-07-31..09-29 [USER+CODE+TOOL] `Document workflow CI` is the sole per-push
  owner of the package suites and app correctness and must stay green on `main`;
  deploy workflows build only their own app (a skipped workflow never reports,
  so a deploy verify job must not be a required check). [USER+CODE] Core and
  extended browser-contract groups own disjoint cases (Product Partner waived).
- 2026-09-08 [USER+CODE+TOOL] Root ignore rules follow Machine Bootstrap (root
  `.npmrc` stays shared). `.agent-work/` stays local, including completed task
  artifacts; durable summaries are self-contained and task IDs are plain labels.

### Document formats and the shared engine/editor

- 2026-07-29 [USER] **Pre-release schema policy, in force until the user lifts
  it.** While the products are in dev/preview/beta each format has exactly one
  live schema, still `schemaVersion: 1`; runtime parsers stay single-shape (no
  compatibility branches, derived defaults, or version negotiation). When a
  stored shape changes, the assistant converts existing documents with a
  throwaway script kept out of the commit. The user will say when to lift it;
  the assistant may ask.
- 2026-07-29 [USER+CODE] `.resume` and `.cover` each have one strict schema v1
  with the same optional structural header; retired shapes are accepted only by
  explicit workspace rewrite tools. [USER] One strict shape per portable format,
  no runtime migration tooling, truthful artifact status, tab-safe recovery, and
  separate behavior/refactor commits; the application lock, revision check,
  client mutation queue, and file-byte rollback are non-negotiable; PR #97's
  three merge blockers (tracker revision regression, async replacement
  overwrite, stale auto-link destination) were fixed.
- 2026-09-27 [USER+CODE] `.resume` style requires `bulletIndentPt` (0–36 pt,
  default 14.73, absolute points); older files and stale autosaves are rejected
  (user accepted); `.cover` carries an inert 0 and shares `.resume`'s header
  limits (`DOCUMENT_HEADER_LIMITS`). 2026-09-16 [USER+CODE]: title/subtitle rows
  are Add/Remove-only, stored as paired strings or paired nulls; older builds
  reject null rows.
- 2026-07-29 [USER+CODE] **Spacing is absolute**: each junction is the next
  row's line advance plus the user's gap; the header keeps line spacing 1;
  `titleSubGapPt` may reach -6; the three header gaps stay style-owned for both
  kinds. UNCONFIRMED: on the cover letter, `headerSectionGapPt` and the first
  paragraph's `space-before` add rather than override (`coverLetterBlocks.ts`).
- 2026-10-02 [USER+CODE] Spacing presets: fixed Compact/Balanced/Spacious plus
  up to eight named saved presets in a shared-editor local preference
  (`typeset-resume.docStyle.spacingPresets.v1`), synced across tabs, never in
  files or history; the old `typeset-resume.docStyle.custom.v1` preset migrates
  in as "Custom".
- 2026-07-26 [USER+CODE] Page margins are Narrow (0.5 in), Normal (1 in), or
  Custom per side; files store only physical values. [USER] Resume line height
  is a global setting inside Spacing; preset numeric controls stay expanded;
  cover-letter inline line height adds room below the targeted lines only.
  [USER+CODE] The line-height menu offers Single, 1.15, 1.5, Double, paragraph
  before/after, and Custom; a caret or partial selection applies to the painted
  lines.
- 2026-07-24..07-26 [USER] The editor follows word-processor behavior wherever
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
- 2026-07-25 [USER] A document page always has a caret: an open or first arrival
  starts at the document start, returning to the Resume or Cover letter tab
  restores caret and scroll offset, and an open never steals focus from an
  outside text field. The caret leans by the face's `post.italicAngle`.
- 2026-07-28..07-29 [USER] Enter continues the active formatting, and a format
  set on an empty paragraph persists. Authored spacing shows at document
  boundaries; a selected line's highlight spans its full engine-line height and
  is continuous through before/after spacing without crossing pages. Google Docs
  clipboard interop keeps logical paragraphs, before/after spacing as paragraph
  style, line height both ways, and outbound links; [USER+TOOL] the user's live
  line-height round trip passed.
- 2026-07-24..07-25 [USER] Every editor host has the self-owned right-click
  menu; linking and pasting work on multi-paragraph selections; the link overlay
  follows caret and selection, not hover; alignment is one labelled-menu
  trigger; RoleFit's formatting-row menus are icon-only (Typeset keeps labels
  until 1210px); menu rows carry a description only when the title is not
  enough.
- 2026-07-24..07-25 [USER] Tinos, Carlito, and Arimo ship as metric-compatible
  equivalents under their own names, the metric twin shown beside them; menu
  order is Tinos, Carlito, Arimo, Source Serif 4, Source Sans 3, Latin Modern.
  New cover letters start in Carlito; resumes default to Latin Modern.
  `entryEndIndentPt` is the entry's right edge for every row; Jake is the style
  reference, not a spec; fresh starters use the Jake-derived defaults (10.8 pt
  start, 5.4 pt end) and the bundled starter is the canonical starter.
  Small-caps "wobble" is overshoot plus pixel quantization; the benefit of
  `text-rendering: geometricPrecision` is UNCONFIRMED. [CODE]
  `lib/fontFamilies.ts` is the single family-id list.
- 2026-07-27..07-29 [USER+CODE] History: a field-plus-intent text run closes on
  a 700 ms pause, field or caret move, selection, formatting, structural edit,
  undo/redo, a word boundary, or a 20-character cap; content and style share one
  coordinator per document. Header structure lives in the toolbar, keyboard, and
  right-click (no hover menu); auto-link deferral holds the paint stable during
  a pointer selection; contact undo restores a removed slot.
- 2026-08-03 [USER+CODE] RoleFit's Resume tab always mounts a real editor
  document; existence enables editing and strict save, while `resumeHasContent`
  gates PDF export, Polish, and Apply. The overlay caret owns editing except
  during IME composition (real-browser IME handoff and hint placement
  unverified).
- 2026-09-17..09-27 [USER+CODE] Measured wrapping covers paired entry fields,
  section titles, names, and contacts; header baselines use font-face metrics;
  the selectable DOM and PDF text follow logical field order; the PDF carries
  kern adjustments (TJ); year ranges and numeric dates no longer auto-link as
  phones. [CODE] Residual: non-year number ranges still auto-link; OS IME,
  screen readers, native Find UI, and other browsers are unverified.
- 2026-07-24 [CODE+USER] Underline and link rules come from `underlineSpans` and
  a face-derived `underlineRule(style)`; painted lines end with the separator
  their break stood for (`data-tsds`), so word selection never runs across a
  line break.
- 2026-07-29..09-28 [USER+CODE] PDF export embeds every face as `CIDFontType2` +
  `FontFile2`; downloads keep the anchor and blob URL alive so the `.pdf` name
  survives; the emitter disables pdf-lib's timer-based yields. Firefox
  background prioritization (consistent with Mozilla bug 1960734) still delays
  hidden tabs; the READMEs give the foreground workaround; the user's exact
  10–20 s case is unverified.

### RoleFit product behavior and trust decisions

- 2026-09-18 [USER] Content and evidence checks warn across RoleFit while usable
  output and actions stay available; acceptance is not verification; truthful
  prompts and technical/stale-document protections stay blocking. Policy:
  `PRODUCT.md#content-and-evidence-warning-policy` (RoleFit only).
- 2026-09-27 [USER+CODE] Still blocking: confirmed BLOCKED eligibility stops
  automatic Polish; BLOCKED without explicitly conflicting excerpts becomes
  CHECK; Apply needs 40 authored words and no template slots in the cover
  letter; Resume Polish withholds edits containing placeholders; metadata-only
  Job analysis falls back to the local brief.
- 2026-09-30 [USER+CODE] Job analysis is plain structured JD extraction: the
  user trusts the selected model and wants no fact checking; the parser keeps
  type, enum, markup, and size guards without source matching, condition
  replacement, or evidence warnings.
- 2026-08-08..09-28 [USER+CODE+TOOL] Fit Assessment (formerly Initial Fit) is
  advisory: a categorical verdict (Strong, Reasonable, Stretch, Limited) with
  bounded exact excerpts, validated mechanically; semantic word-matching vetoes
  are gone (2026-09-18) while citation integrity and explicit-conflict checks
  remain; insufficient information is a neutral outcome; prompt
  `fit-assessment-direct-rubric-v7` (2026-09-28). Fit has its own stage
  settings, sharing Prepare's request only when they match Job analysis;
  **Reassess fit** always runs fresh; a stale run shows as **Previous
  assessment**; only the first Prepare-launched run may trigger automatic
  Polish; Apply keeps the latest assessment as one timestamped snapshot.
- 2026-09-30 [USER+CODE] Fit gap notes are not claim-checked (user-accepted: an
  invented claim there shows unflagged); `Match N:`, `Gap N:`, and
  `Eligibility:` warnings render beside their finding.
- 2026-08-07..08-08 [USER+CODE] Fit runs automatically by default; Resume and
  Cover automatic Polish are independent switches, off by default, with
  minimum-fit thresholds (fresh defaults Reasonable and Strong); only
  exact-evidence BLOCKED stops an eligible run. Polish turns on only the
  polished document's Include toggle.
- 2026-07-30..08-11 [USER+CODE+TOOL] Prepare is the default and sole job-intake
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
- 2026-08-08 [USER+CODE+TOOL] The shared input firewall derives its data-only
  instruction and escaping pattern from one fence list.
- 2026-08-07..08-09 [USER+CODE] The fast path is Prepare → Fit → Polish → Apply:
  Prepare publishes the local brief first and provider failure leaves manual
  Polish usable; numeric scores, recruiter reviews, and Tailor/Review/Both
  settings were removed; each workflow owns a named progress card and every
  active request exposes Stop.
- 2026-08-07..09-30 [USER+CODE] Resume Polish is one proposal request over
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
- 2026-08-09 [USER+CODE+TOOL] Accepting is one interaction for both documents
  through the footer `ProposalDecisionBar` (`Accept all` / `Discard all`,
  `Accept proposal` / `Discard proposal`) and one `ProposalDiff`; every resume
  decision is reversible; a resume-only change leaves a pending cover proposal
  acceptable with a warning. Browser QA of the bar and letter diff is
  UNCONFIRMED.
- 2026-08-04 [USER+CODE] Workbench: Polish is one rail action (header when open,
  beside the reopen tab when closed); vocabulary **Polish** / `Polishing…` /
  `Polish again` and Accept/Discard; footers carry only Stop, Retry,
  Accept/Discard, and Restore previous; the Resume More menu was removed at the
  user's request; the rail closes to zero behind an icon-only edge tab ([USER]
  chose it over a labelled tab), with a count only for a validated post-draft
  Cover Letter `blocked` response. Opening the rail does not shift the page
  (`.studio-body` uses `overflow: clip`), and the idle Cover Letter rail does
  not restate its workflow message. [USER] The rail resizes from 18rem (default)
  to 28rem with one shared width (`rolefit:document-rail:width`).
- 2026-07-28..08-05 [USER+CODE] Cover Letter Polish is one operation: the server
  resolves date, names, greeting, and sign-off and sends the whole evidence
  corpus with the user's template; the model chooses the evidence; a failure
  gets one silent repair, then 422; a valid letter is staged as a fingerprinted
  whole-document proposal. Questions are the exception path (missing name, role,
  or company; an unanswered private slot). Employer facts never count as
  candidate evidence. [USER+CODE] The cover quality corpus stays synthetic and
  never reads `workspace/cover-letters/`. [ASSUMPTION] Future employer research
  must never block Polish or send resume or Profile text to a fetcher.
- 2026-07-24..07-25 [USER] The cover letter has its own always-present editor
  page and starts from the user's own letter, tailored to the job and truthful
  evidence; it is plain correspondence (no resume sections, rules, columns,
  bullets, or resume spacing settings) with the same toolbar family, named
  variants and history like base resumes, and the same PDF rename prompt. New
  letters use double line spacing with 0.5 in top/bottom and 0.75 in side
  margins (2026-07-27, which also recorded 8 pt after each paragraph);
  2026-07-28 [USER]: the default rhythm is explicit 8 pt space-before on every
  paragraph.
- 2026-07-25..08-13 [USER+CODE] Resume and cover letter share `DocumentOpenMenu`
  and `DocumentSaveMenu` (no Starter button); Resume Open accepts only strict
  `.resume` and Cover Open only strict `.cover`. Cover-letter startup mirrors
  the resume's, and automatic title changes no longer cancel it or Prepare's
  selection; base cover letters are flush-left block letters; app-produced
  titles follow `Name_Company_Resume` / `Name_Company_Cover_Letter`.
- 2026-07-27..07-31 [USER+CODE] Apply snapshots each included document; each
  then keeps its own saved state and an "Update application" row that commits
  source bytes plus its tracker fields atomically against the current revision;
  nothing saves on an effect. Applications store only editable sources
  (`resume.resume` / `cover.cover`) and render PDF on demand; extra PDF
  attachments (8 MB each, 10 per application) download only. Apply's prompt
  names each included PDF separately and Apply is single-flight. Both editors
  keep per-tab recovery drafts via `lib/autosaveDraftStorage.ts`.
- 2026-08-11..08-12 [USER+CODE] A fresh preparation creates a tracker row only
  on Apply or Skip & save job (and, since 2026-10-07, as a Draft on a first
  Answers Save); opening a saved record updates that exact id; Application
  Detail and the Applications inspector share one presentation. Recovery is
  interruption-only: a fresh tab never adopts a closed tab's draft, same-tab
  entries expire after 24 hours, and an excluded dirty document releases once
  its recovery write succeeds; concurrent Application Detail edits fail closed.
- 2026-08-10 [USER+CODE+TOOL] Preparation stabilization: draft and committed
  preparation are distinct; Stop or input changes cannot publish late success;
  candidate facts are tri-state declarations; authored blank resumes are
  applicant-owned; workspace saves use an invocation-order queue and a monotonic
  baseline revision. Browser interaction QA is UNCONFIRMED.
- 2026-09-04 [USER+CODE+TOOL] Stages group as Active (Applied, Interviewing,
  Offer) and Inactive (Skipped, Rejected, Withdrawn) with movement either way; a
  formerly applied record keeps its date, documents, and attachments when
  Skipped. Applications and Analytics show layout-shaped skeletons (browser QA
  unverified). 2026-08-08..08-15 [USER+CODE+TOOL]: search covers only company,
  role/title, and a readable posting ID; the table keeps native scrollbars, a
  sticky head, and an aligned Fit column; the inspector and Prepare rail contain
  long values without widening the page; Prepare and Applications keep a stable
  desktop height above 1080px. 2026-09-03 [USER+CODE+TOOL]: **Bold keywords in
  bullets** (Settings > Guidance, default on).
- 2026-09-28 [USER+CODE] Settings > About you became **Profile**: declared facts
  plus one **Background** (`profileBackground`). Every stage sending candidate
  context gets the whole Background up to 12,000 characters and declines above
  it (user-approved, no clipping); servers reject merged context above 13,000;
  storage allows 60,000. Per-source Experience evidence rows were removed into a
  `## Experience by type` block. 2026-08-09: GPA (0–4.0, only with declared
  education) and earliest-start availability are optional facts. 2026-07-25
  [USER]: facts emit nothing until declared, so an undeclared citizenship,
  clearance, or degree never becomes groundable wording.
- 2026-08-06..09-29 [USER+CODE] Naming: Distill became **Job analysis**; stages
  `job-analysis`, `fit-assessment`, `resume-polish`, `cover-polish`,
  `application-answers`, `application-review`; keys `<camelCase stage
  id>Provider|SelectedModel|CliReasoningEffort`; routes `/api/job-analysis`,
  `/api/resume-polish`, `/api/cover-polish`; `candidateContext` is facts plus
  Background; auto-run keys `fitAssessmentAuto`,
  `resumePolishAuto`/`coverPolishAuto` plus `…AutoThreshold`. Old names convert
  once in `migrateStoredSettings`. [ASSUMPTION] Reload open tabs after
  upgrading; back up before a rollback.
- 2026-09-29 [USER+CODE] Profile-aware Resume Polish: a Background heading
  naming exactly one standard entry links its text to that entry
  (`linkProfileBlocks`); Polish may rewrite that entry's bullets from it and
  fill two `new-bullet` slots per linked entry; grounding failures stay warnings
  (CR001 Option A). UNCONFIRMED: the user's decisions on CR002 v2
  (enclosing-heading rule) and the stricter ownership check, and live-provider
  behavior of linked-entry rewrites and new-bullet slots. [USER]
  Profile-driven swapping and entry-level removal/reorder stay deferred.
- 2026-10-01 [USER+CODE] Job-link import selects the exact posting from Ashby
  boards, JobPosting JSON-LD, Oracle, iCIMS, Dayforce, Workable, and UKG data;
  missing LinkedIn, Greenhouse, Ashby, and Jobvite jobs fail with
  paste/extension guidance. Known limit: a non-Greenhouse URL with `gh_jid` plus
  `for`/`board` fails instead of falling back. [USER+CODE] A Profile line's own
  source type wins over its heading in Fit's source-type check.
- 2026-09-08 [USER+CODE] Paragraph-cited cover evidence, bounded Resume targets
  with advisory suggestions, and an optional session-only final review of
  included materials; legacy Fit/date representations stay readable.
- 2026-07-25..08-01 [USER] One Settings dialog, opened from the studio rail's
  foot, holds every preference and shows no runtime diagnostics (those belong to
  RoleFit Companion); Reset sits at the foot of the section rail; rows are
  frameless, never card-in-card. [CODE+USER] Custom instructions are per stage
  over a shared default (Job analysis and Fit take none); an emptied override is
  deleted. [CODE] `src/config/aiStages.ts` is the single stage declaration;
  `normalizeSettings` may repair and remove but never add. [USER+CODE+TOOL] The
  masthead owns only identity and Apply; Sessions sits in the studio-rail
  utilities.

### AI providers, defaults, and benchmark outcomes

- 2026-09-30 [USER+CODE+TOOL] GPT-6.1 Sol (`gpt-6.1-sol`) and Claude Sonnet 5.5
  (`claude-sonnet-5-5`) are the Codex and Claude defaults for new or unset
  stages and the server fallback; saved selections are not moved; Sonnet 5.5 on
  the API sends `thinking: {type: "between_tools"}`; retired Codex ids repair to
  GPT-6.1 Sol. The 2026-10-07 per-stage startup defaults override this for their
  stages. Observed Claude Code 2.1.285 (Sonnet 5.5 needs 2.1.284+) and
  Codex CLI 0.159.2. Receipt: `apps/role-fit-ai/docs/engineering/ai-server.md`.
  UNCONFIRMED: live provider calls.
- 2026-09-27 [USER+CODE] GPT-6 Astra/Sol/Luna and Claude Fable 5.1 / Opus 5.5
  joined the CLI/API catalogs (the user waived the Product Partner flow); Codex
  5.4, 5.4 Mini, and Spark were removed; GPT-5.5 remains until its announced
  2026-10-14 retirement. [CODE+TOOL] Retired Codex selections repair within
  their stage/provider; one app-owned CLI effort contract serves settings,
  validation, and Claude argv.
- 2026-08-08 [USER+CODE+TOOL] Five integrations (Claude CLI, Codex CLI,
  Antigravity CLI, OpenAI API, Claude API) and no speculative provider;
  Antigravity's full calibration matrix is unconfirmed. 2026-08-09: a private
  71-application Fit calibration found GPT-5.5 medium the strongest balanced
  configuration and rejected a broader prescriptive rubric.
- 2026-07-24 [TOOL] Application-writing guidance sources and the resulting
  prompt policy are in `apps/role-fit-ai/docs/engineering/ai-server.md`.

### Tracker, storage, and workspace

- 2026-07-26 [USER+CODE] The data root is `workspace/`:
  `resumes/<variant>.resume` and `cover-letters/<variant>.cover`, each with its
  own `.trash/`; tracker, applications, and preferences stay at the root.
- 2026-08-09..08-10 [USER+CODE+TOOL] Preferences live in owner-only
  `workspace-preferences.json` (localStorage is a fail-open cache); backup,
  preference, and restore-marker contracts are schema v1 only; 0.6.0 backups do
  not restore into 0.7.0+. 2026-07-26 [CODE]: backups exclude standalone saved
  `.cover` variants and history.
- 2026-09-29..09-30 [USER+CODE] Preference writes require `baseRevision`
  (SHA-256 of the stored bytes); a mismatch returns `409 { stale, current }` and
  the tab rebases once. Contract:
  `apps/role-fit-ai/docs/engineering/workspace-backup.md`, which also documents
  a known race (2026-10-01): the pending-edits record does not name its tab, so
  a new tab can write a live sibling's older value.
- 2026-07-27 [USER+CODE] Tracker PUTs send only `upsert` records; the server
  keeps existing order and prepends new records; explicit Refresh and `409`
  snapshots are fully fresh (write responses became revision-aware and sparse on
  2026-10-09). [USER+CODE+TOOL] The cold duplicate scan runs after the first
  Applications paint and is cached across tab visits; the 27-record corpus pins
  all 351 pairs (candidate pairs replaced the all-pairs loop on 2026-10-09).
  2026-08-11 [CODE]: duplicates link by posting group or record a reviewed
  separation.
- 2026-08-09 [USER+CODE+TOOL] Tracker reads fail closed on unknown fields,
  retired shapes, duplicate ids, and malformed data; only a redundant derived
  Fit summary leaf is normalized for comparison; the tracker key `initialFit`
  stays a storage-boundary name. [USER+CODE] Legacy tracker-schema compatibility
  was left to a one-user preview migration.

### Extension

Pre-October popup, pairing, port-storage, and shortcut detail is app-operational
and lives in the app ledger.

- 2026-07-27 [USER+CODE+TOOL] The companion writes its validated port into the
  materialized extension runtime config, which since 2026-08-01 is only the
  first-install seed.

### Desktop companion, distribution, and release/deploy state

Current: RoleFit 0.10.0 preview (`rolefit-preview-v0.10.0-beta.1` on `4e33fb8`),
extension 1.3.0, desktop bridge API 13 (see 2026-10-08).

- 2026-10-01 [TOOL] 0.8.0: `rolefit-preview-v0.8.0-beta.1` on `d7f12a0`
  (#161), run 36862392970, five installers plus `SHA256SUMS.txt`; extension
  1.2.1. `docs/releases/0.8.0-beta.1.md` discloses that `.resume` files without
  `bulletIndentPt` are rejected (add `"bulletIndentPt": 14.73` to `style`).
  [USER+CODE] The Typeset remote deploy runs `docker builder prune -af
  --keep-storage 1gb` before building (the user's "your call"); run 36865789743
  reclaimed 4.42 GB and typeset.xinyiklin.com answered 200.
- 2026-08-10 [USER+CODE+TOOL] **1.0 is deliberately not claimed**; its criteria
  are a genuinely signed release and a compatibility policy promising migrations
  for `.resume`, `.cover`, and `.rolefit-backup`; 0.x minors carry behavioral
  breaks. 0.7.0 shipped with extension 1.2.0 (tag
  `rolefit-preview-v0.7.0-beta.1`); [TOOL] 2026-10-09 `gh release view` shows
  it published 2026-08-10T22:19:45Z.
- 2026-08-10 [USER+CODE+TOOL] Landing screenshots are 2x captures from a
  synthetic pack served through `ROLEFIT_WORKSPACE_DIR` on a spare port.
  `landing/screenshot-manifest.json` plus `assertScreenshotVersionStamps` check
  any version printed in a screenshot in both release workflows and the Pages
  `verify` job; capture is not automated in CI and used Edge over CDP because
  this machine's Chrome policy sets `DeveloperToolsDisabled=1`. Companion
  recaptures from 0.8.0 on used isolated user data, an empty workspace, and
  port 5181 (see 2026-10-08).
- 2026-08-01 [USER+CODE+TOOL] 0.6.0 (extension 1.1.0, API 12) published via run
  `30717428328`. API 12 added a bounded main-owned extension-setup copy
  operation with no generic renderer clipboard/path capability. 2026-07-26
  [USER]: the release after 0.3.0 was to be a larger step than 0.4.0; [CODE] it
  became 0.5.0.
- 2026-07-27 [USER+CODE+TOOL] Only the live private utility handle proves this
  companion started the server; Stop and Restart revalidate RoleFit identity and
  send one graceful `SIGTERM`; unknown listeners are never signalled and
  external ones never force-killed.
- 2026-09-30 [USER+CODE] Companion UX: inline Access card (pending requests
  first, **Approve & restart**, two-step Remove), per-browser install guides,
  and copy fields. Contract: `apps/role-fit-ai/desktop/AGENTS.md`. UNCONFIRMED:
  a live extension install against the real companion and
  screen-reader/forced-colors rendering.

### Process and workflow decisions

- 2026-07-24 [USER] Before requested pushes, review and update affected README
  and docs and commit compact, privacy-safe continuity with the behavior slice;
  a version change is complete only after a triggered, successful
  release/publish workflow.
- 2026-09-08 [USER+CODE] Authorized review, browser QA, and merge of the
  accumulated RoleFit evidence-grounded drafting work (an authorization for that
  work, not a standing rule).

### Deferred backlog

- 2026-09-27 [CODE] Engine/editor: codec-accepted unrendered fields (a schema
  decision), context-menu keyboard navigation, space-kern DOM drift
  (unconfirmed), refactor/simplification items.
- 2026-07-25 [TOOL] Confirmed but not fixed then (status after the September
  editor passes UNCONFIRMED): PDF link annotations per run; a justified line
  past the 1.75x join bound splits a linked phrase; engine and editor auto-link
  different strings and scopes; `End`/`Shift+End` cannot reach authored trailing
  spaces; RoleFit's right-click menu resolves `position: fixed` against the
  scroller. The replay-queue stall was fixed 2026-09-27.
- 2026-07-24 [CODE] Plain-text paste with blank lines inserts hard breaks in one
  paragraph (rich HTML multi-block paste exists since 2026-07-28). 2026-07-25
  [TOOL]: font candidates Gelasio and Caladea; UNCONFIRMED whether either ships
  usable italic/caps lookups.

### Open questions and UNCONFIRMED items

- 2026-07-25..10-06 [TOOL] Browser QA never run (flag-first) for shipping
  surfaces: Prepare states and 1080/980/860/720px breakpoints and the Firefox
  footer band (2026-07-30); prepared two-pane scrolling (2026-08-07); Apply's
  download dialog (2026-07-31); Sessions rail placement (2026-08-01); Fit
  staleness and inspector layout (2026-08-08..08-09); populated Open-menu
  labels (2026-07-25); the add-evidence focus path (2026-09-28, still
  unexercised 2026-10-06; the redesigned Settings pages themselves were
  browser-checked 2026-10-06); the Show evidence 16rem scroll bound
  (2026-10-06).
- 2026-08-08..09-18 [TOOL] Live-provider behavior of the extension-arrival race
  and automatic flows (2026-08-08) is UNCONFIRMED; live providers, vendor ATS
  behavior, and hiring outcomes are unverified and no efficacy is claimed
  (2026-09-18); the original 2026-09-18 Fit failure remains unconfirmed.
- 2026-09-27..10-07 [CODE+TOOL] Smaller open items carried from dated entries:
  positive kern pairs of at least 0.1em can yield a stray pdf.js space, and
  cover-only Shift+Tab and spacing-dialog focus are proven only by evals
  (2026-09-27); VoiceOver may flatten the `<h2>` inside `<summary>`
  (2026-09-30); a lowercase non-curated or article-led tool after a denied list still warns
  (2026-10-05);
  other-variant notes appear under Other notes, typing a heading into the
  preamble loses focus, the server links on a clipped scope, and an oversized
  first brief item renders its placeholder (2026-10-06); a declined typed-link
  or paste source stays "stopped" (2026-10-07).

## 2026-10-09

- [USER+CODE+TOOL] **Resume PDF import** (task `2026-10-09-resume-pdf-import`;
  the user approved brief v1 and plan v1 with the recommended D1–D7 and in-app
  browser QA). Contract: `apps/role-fit-ai/PRODUCT.md#resume-pdf-import`.
  - [USER] Decisions: import reconstructs and never improves (separate from
    Polish, which is blocked during review); a new **Resume import** AI stage
    (default Claude CLI · Sonnet 5.5 · low); the PRODUCT/`server/ai/AGENTS.md`
    "no extra AI analysis stage" rule now records this exception; 10 MB / 10
    pages; gates: zero characters lost or added, field P/R 0.98 single-column
    and 0.90 hard, reading order 0.98.
  - [CODE] Forward-only settings: this build writes the three `resumeImport*`
    keys on its first launch (settings are materialized), so an older build
    then refuses to save settings, omits preferences from its own backups, and
    rejects this build's backups (reviewer probe against HEAD). Release notes
    must say "after any launch", not "after using import".
  - [CODE] RoleFit-only: `src/resume/pdfImport/` (injected pdf.js adapter,
    lines/columns, structure, style, preservation audit, AI-reply rebuild,
    `importErrors.ts`), `useResumeImport`, `useWorkspaceResume`
    commit/replace/restore, the rail's `ResumeImportReview`,
    `shared/resumeImportContract.ts`, and `server/ai/resumeImport.ts`
    (`/api/resume-import`). No package, Typeset, `.resume`, or tracker change.
    The model returns piece references, never text; both sides validate
    verbatim, and the client rebuilds from its own pieces. Each field must be
    one run of the PDF's text in order (a cut piece only ends or starts it; it
    may pass over whole lines or another segment of a line, never words inside
    its own), so reordered, reused, spliced, or partly used text is rejected
    (splits may drop only whitespace, separators, and a label colon followed by
    a space, across fields); then the audit re-runs. Checks for stretches out
    of their column's order, fields joining columns, and fields passing over
    unused text are as of round 6 below. An import that
    cannot account for every character, or that would form formatting code
    once the importer's marks are removed, is refused. The import seeds the
    editor as unsaved (`seedData(..., { unsaved: true })`) and detaches the
    variant identity in memory only, so no workspace file or preference is
    written until Save; the review lasts while that seed is in the editor;
    Discard restores the exact prior document, style, identity, and unsaved
    state and clears the import's recovery draft; a second import keeps the
    first one's Discard destination; a refusal raised during a review ends
    with it. Every Resume Polish route is gated during review, and the dock
    hides a failed run's Retry. Filled form fields, viewer-added text boxes,
    and annotations painting non-dingbat glyphs refuse the import
    (`overlay-text`). `src/lib/browserPdfjs.ts`
    owns the one browser pdf.js setup (React-PDF's default worker path had
    overwritten a separately set worker when it loaded second).
  - [TOOL] Two independent reviews (mb-verifier; content fidelity, lifecycle).
    Reviewer 1 FAILED it with a blocker: an AI reply could splice verbatim
    substrings (swapped metrics, reversed ranges, a dropped "not", "-", or
    "Un") and pass both validators and the audit; plus silent leftover-glyph
    consumption, filled form fields lost silently, a Symbol-font "≥" read as a
    bullet, equal-width right-aligned dates read as a column, per-glyph runs
    refused as scans, a recurring role title dropped as a running header,
    split superscripts, and formatting code split across runs or hidden by the
    importer's own bold marks. Reviewer 2 FAILED AC12 (the dock's failed-Polish
    Retry bypassed the gate) and found a workspace-preference write on import,
    an invisible refusal during a review, a stale recovery draft after
    Discard, a declined import stopping an interpretation, import-over-import
    losing the Discard destination, `pdfLayout` in the main bundle, and no
    automated coverage of the AC8/AC12 guards (its mutation passed 175/175).
    All fixed with regression tests (`pdf-import-edge-cases.mjs`,
    `resume-import-lifecycle.mjs`, recombination cases in
    `pdf-import-interpretation.mjs`); the reviewers' own mutations now fail.
    Re-verification round 2: reviewer 1 FAILED it again (no blocker, two
    High): a sentence spliced from one bullet's head and another section's
    tail with zero findings, and a bold "not" skipped from the middle of a
    field; also a year swap by splitting a section, a same-baseline right
    sidebar read as one column (a regression from the dates fix), FreeText text
    lost silently, a ratio split at its colon, per-glyph garbage imported, and
    per-glyph word counts. Reviewer 2 passed with test gaps (snapshot reuse
    unfalsifiable, stale-reply and edits-during-request guards untested) and
    three small issues (a refusal outliving its review, a silent Retry, Discard
    wording). All fixed in round 3 (one-run fields, document-wide per-column
    reading-order Checks, row-value rule, `overlay-text`, lone-glyph adjacency,
    joined-text word count, `endSession`, hidden Retry); 18 scripted mutations
    each fail their eval.
  - [TOOL] Round 3 (reviewer 1 FAILED, no blocker; reviewer 2 passed with
    test gaps) found: AI fields appending text past other fields' text with
    no Check (order was checked on a field's first piece only); left-tab-stop
    row values on 3+ rows detached as a column; overlay text lost from a text
    widget with an appearance but no value and from a Stamp; alternating
    private-use glyphs imported; two untested `isCurrent` re-checks.
  - [CODE+TOOL] Round 4 fixed those; both round-4 reviews FAILED it (no
    blocker): a line taken from another column or page still got no Check; a
    new dates-and-places gutter cue misread a skill-list sidebar with one dated
    row; honest titles wrapped beside a date got spurious Checks; Acrobat-style
    checked boxes were refused; lifecycle abort paths were untested.
  - [CODE+TOOL] Round 5 fixed those; round-5 content review FAILED it (one
    High, three Medium): a date moved into the field ending on the line above
    with no Check (round 5's same-line exemption was too loose); a dated
    sidebar beside dingbat or no bullets read as row values (round-5
    regression); page 2's top band shared page 1's; the two halves of the
    skipped-segment rule were untested. The lifecycle review found Lows only.
  - [CODE] Round 6 (current state):
    - An AI field splits into stretches; a skip keeps one only past the rest of
      the previous line (a date beside a wrapped title) or for a right-hand
      value wrapping past a row's start (both pieces in the right half). Each
      stretch is order-checked in its region; a field spanning regions gets
      "Joins text from different columns", and each page's top band is its own
      region (columns flow across pages).
    - Gutter: a right band is row values when shared-baseline and narrow, or
      at least 40% dated (`rowDates.ts` `hasDate`, which finds the date in
      "· place" or "(4 yrs)" values) with no bullet beside it (dingbat glyphs
      included) and no heading-styled line; then it stays rows if flush right,
      at most two rows at a time, or dated. The round-4 place cue is gone.
    - Overlay: an annotation whose appearance paints non-space, non-dingbat
      glyphs refuses (`overlay-text`, copy names stamps); the font is graphics
      state, restored by Q and reset per annotation. Outside dingbat faces
      every private-use glyph counts toward the 10% unreadable share.
    - `useResumeImport` is unchanged. Its eval gives each case a fresh hook
      whose state setters cannot reach the next case, and covers reseeds
      during each confirm, Stop, single flight, aborts when a review ends, and
      an unedited AI reading discarded without asking.
  - [TOOL] Round-6 self-verification (Node 24.18.0): interpretation 42/42,
    edge cases 22/22, units 22/22, corpus gates at P/R 1.000 and order 1.000,
    lifecycle 22/22, and `npm run check --workspace apps/role-fit-ai` 178/178.
    Each new rule fails a case under its mutation, and both round-5
    reviewers' repros now land as intended. Equivalent by design: a
    controller's `finally` clearing only itself and Discard's own abort
    (redundant with `endSession`); both rely on the modal confirm.
  - Residual (Low or pre-existing, all content-preserving):
    - spurious "different columns" Checks on honest replies when a summary's
      last line falls below the gutter cut or a bullet crosses into a page
      with another layout;
    - checkbox marks drawn with a letter and signature appearances refuse as
      overlay text;
    - in the hook, two Interpret calls during the first confirm both send,
      and a reply landing while Discard asks queues a stale confirm (both
      need the modal dialog to be bypassed or raced; no data harm);
    - tab-stop shapes still read as a column as at HEAD: three rows per
      entry (37% dated), places only, ISO or "Q3 2016" dates;
    - whitespace is not audited; invisible text imports like any text; the
      shared firewall leaves zero-width or fullwidth tag variants; a tag
      formed only across a hyphen-joined line refuses the whole import; the
      local reading puts a page-1 running header into the contact list and
      makes a wrapped title's continuation its own entry.
  - [USER] Decisions 2026-10-09: no live benchmark (`eval:live:resume-import`
    stays unrun); merge once no Blocker or High remains and nothing regresses
    from HEAD. Approved as a follow-up PR: Cover letter Polish also waits for
    an import review (it reads the editor's resume), and tab-stop values go to
    the right-hand slot.
  - [USER+TOOL] **Merged** as #205, squash `9296fb12` on `main` (head
    `c7bfe0ee`, CI green, tree identical to the reviewed head). The exact-head
    review found no Blocker or High and one Medium that the user accepted for
    the follow-up: a mostly dated sidebar with plain headings beside a main
    column without bullet glyphs read as one column.
  - [USER+CODE+TOOL] Follow-up PR #206 (`fix/rolefit-pdf-import-followups`):
    - Cover letter Polish waits for an import review on every route (button,
      Prepare card, automatic Polish, the dock's Retry, the rail's Retry); the
      Cover Letter rail names the review as its resume blocker. Passed two
      independent reviews.
    - A title or subtitle row's last segment that is a date (not a
      parenthesized year) and starts within 1.5pt of another body row's last
      segment (not a header line or bullet) goes to the right-hand slot; anything else short of the margin
      stays combined with a Check as on `main`. [USER] Narrowed twice after
      review: to dated values when places, coursework, and awards at a tab
      stop read worse than `main` (head `aa9f8475`), then to pure dates when
      two-column lists with years ("CKA (2021)") paired with no Check (head
      `14f32755`). No text was lost in either. Against `main` on the
      reviewers' 103 synthetic layouts: 82 identical; the other 21 only move
      a date into its row's right-hand slot and drop that row's "combined"
      Check, one of them the accepted Low.
    - [USER] The accepted #205 Medium stays a documented limitation: a dated
      sidebar whose headings look like its entries, beside a column without
      bullets, reads as one column (no text lost). Three section-title cues
      were tried; each review (heads `9469ddd3`, `e27f0102`) found tab-stop or
      sidebar layouts made worse than `main`, so column detection stays as on
      `main`. Residual Low: in that misread layout, tab-stop placement pairs
      dated sidebar lines into rows without the "combined" Check `main` gave.
  - [TOOL] Corpus: 7 engine + 6 foreign fixtures (one truly two pages with a
    running header) and 8 refusal kinds; synthetic and written alongside the
    parser, so real-world accuracy is UNCONFIRMED.
  - [TOOL] In-app browser QA on an isolated 5183 server with a scratch
    workspace and a synthetic PDF: guard decline/replace, review rail and
    original preview, Show highlight, Discard with and without edits, Save
    variant (strict file re-parsed), refusal, Prepare's Polish blocker, and the
    Interpret running/success/rejected/Stop states against an in-page stubbed
    reply. No provider call was made; the live benchmark
    (`eval:live:resume-import`) is unrun and live interpretation is UNCONFIRMED.
- [USER+CODE+TOOL] **Tracker limit 500 → 2,000; candidate-only duplicate scan;
  revision-aware saves; backup limits sized for 2,000** (task
  `2026-10-08-tracker-scale`; the user's real tracker had reached 500, a cap
  with no recorded rationale since the initial commit).
  - **Limit.** `MAX_APPLICATIONS = 2_000` (`server/applications/schema.ts`) is
    the only limit. The user chose it over "unlimited": the single-file store
    and single-envelope backup have practical ceilings, and streaming backup is
    the next one.
  - **Duplicate scan.** `groupDuplicateApplications` compares only candidate
    pairs (a shared ATS key, requisition ID, normalized URL, or company;
    id-less, company-less records also pair with id-less records of the same
    role or no role), evaluated in all-pairs order, so results are identical.
    Description features are built lazily and `matchSignatures` checks metadata
    first. `DuplicateScanMemo` (client) reuses signatures and pair verdicts by
    record object; "no match" verdicts are kept only below 250k candidate pairs.
  - **Server.** `storage.ts` caches the validated, deep-frozen tracker while the
    bigint stat identity (dev/ino/size/mtimeNs/ctimeNs) holds; writes
    re-sanitize only new or edited records; a write is cached only if the
    renamed file is provably its own (dev/ino/size/mtime against the temp file),
    otherwise the cache drops and the response carries no revision; restore
    invalidates the cache; backup strictly validates the exact
    `applications.json` bytes it packages. An in-memory revision drives GET
    `304` and sparse PUT responses (`order` plus upserted rows, only for a
    matching `baseRevision`).
  - **Client.** `useApplications` keeps `confirmedRevision` beside the confirmed
    snapshot and updates both inside the write queue; a full response (stale
    base) is adopted as-is, an unusable sparse response falls back to one full
    read, and refresh is conditional.
  - **Backup limits:** 5,000 files, 48 MB per file (also the companion count
    read), 256 MB decoded, 384 MB JSON; the format is unchanged.
  - [TOOL] Receipts (Node 24.18; synthetic data plus the real tracker's counts,
    timings, and digests only): real 500 records identical to the HEAD matcher,
    scan 290 → 19 ms (0.19% of pairs); realistic 2,000: 1,818 → 75 ms cold, 2.5
    ms rescan, 0.10% of pairs, per-job check 423 → 16 ms; stress: one 300-record
    company 174 ms, 5,000 records 256 ms; worst case (no company, role, or ID on
    any record) 8.0 s, the same as HEAD, with the memo at 1 MB. Save at 2,000
    (27 MB): median 36 ms and 43 KB instead of about 180 ms plus 27 MB; a `304`
    takes 0.2 ms; the first save after a restart, restore, or outside edit
    re-validates once (131–199 ms).
  - [TOOL] Backup round trip at 2,000 (165 MB decoded, 212 MB JSON): peak RSS
    about 1.0–1.1 GB with ASCII text; with non-Latin-1 text, backup peaks at
    1.2–1.9 GB and restore at about 1.3 GB. The JavaScript heap needs under 1 GB
    (restore fails only below a 1,024 MB heap cap); the rest is Buffer memory.
    The approved plan's 1.5 GB RSS Change Request trigger fired (peaks were
    1.2–1.9 GB); the limits were kept under the user's delegated ownership,
    rather than lose backup past about 790 applications. Packaged Electron IPC
    at that size is UNVERIFIED; streaming backup is the follow-up.
  - [TOOL] Two independent reviews (adversarial; cache-integrity verifier): no
    blocker or high. Fixed with regression probes: stale rows after a full
    response, the post-rename race (which lost an outside writer's record), a
    revision paired with another state, cache-backed backup validation,
    round-trip evals reading the cache, and degenerate-tracker memo memory.
    Mutation checks fail as expected in `duplicate-scan-scale-eval`,
    `tracker-revision-probes`, `applications-revision-sync`, and the five
    round-trip evals.
  - **Release notes:** an older build refuses a tracker over 500 records (fails
    closed, no data loss) and backups over its old limits.
- [USER+CODE+TOOL] **Desktop companion Electron 43.2.0 → 43.7.9** (task
  `2026-10-09-electron-43-security`). 43.2.0 carried four high advisories:
  GHSA-gr2m-v5gq-v685, GHSA-j84w-jfhq-vhvj, and GHSA-9qh4-3jw8-366w (fixed in
  43.4.1), and GHSA-qmv3-fv6v-rmhq (fixed in 43.5.0).
  `deps:audit:production` cannot see them because `electron` is a
  devDependency. 43.7.9 bundles Node 24.21.0 and Chromium 150.0.7871.250.
  - [USER+CODE] Only the desktop runtime moves. `runtime-versions.mjs` expects
    43.7.x with Node 24.21.x and esbuild target `node24.21`. `.node-version`,
    CI, Docker, and npm stay on 24.18.0 / 11.16.0, so the README and
    `docs/development.md` no longer say the toolchain matches Electron. Moving
    the toolchain to Node 24.21 / npm 11.19 is a follow-up, together with #145.
  - [CODE] Electron 43.x ships no npm install script; its binary downloads on
    the first `require("electron")`. The `allowScripts` entry is policy that the
    checker keeps in step.
  - [TOOL] The lockfile changes only the `electron` entry and the RoleFit
    workspace's declared pin, and the integrity matches the registry. The 43.2.0 → 43.7.9 `install.js` diff only makes the
    extractor `require` lazy. `npm audit` shows no Electron entry (40 → 39).
    `deps:check`, `deps:tree`, `deps:audit:production`, and
    `test:desktop:release` (14/14) pass.
  - [TOOL] Windows x64, Node 24.18.0: the root `npm run check` passed (RoleFit
    170/170 offline evals), and so did `test:rolefit:desktop`.
    `make:rolefit:desktop` staged 135 files, and `test:rolefit:desktop:packaged`
    passed (win32-x64). The packaged companion reports
    `electron=43.7.9 node=24.21.0`. No macOS host; the release workflow's
    native jobs cover macOS.
  - [TOOL] `test:rolefit:desktop` is flaky on Windows under machine load, on
    both Electron versions. Its development-mode phases intermittently fail
    the companion's 750 ms / 1 s loopback probes ("connection status
    contract", or a pairing-settings `TimeoutError`). Measured: 0.10.0, #198,
    and #143 passed on a quiet machine; later, 4 of 4 interleaved runs passed
    on each of 43.2.0 and 43.7.9 on this branch. CI does not run this smoke.
  - [TOOL] A Windows `safeStorage` probe (isolated user data, synthetic value)
    encrypted with 43.2.0 and decrypted with 43.7.9: MATCH,
    `shouldReEncrypt=false`. macOS upgrade decryption is UNVERIFIED.
  - [TOOL] Quick-quit probe on Windows: the companion's `before-quit` →
    cleanup → `app.exit()` path keeps a newly created key, at any delay.
    - A key is lost only if `app.exit()` runs in the same task as its creation,
      which the companion never does. It also needs no key at startup until an
      API provider is configured (`main.cts` `readProviderConnectionState`).
    - Residual risk, which 0.10.0 also had: a hard kill within about 10 s of the
      first-ever API-key save loses the key. Local State commits on a timer, so
      the probe lost it at 1 s and 5 s and kept it at 12 s. The provider then
      shows reconnect guidance and re-entering the key recovers it. No change:
      forcing key creation at startup would add a macOS Keychain prompt for
      users without API keys.
  - [TOOL] `tracker-revision-probes` failed once inside the full root check on
    Windows ("an outside same-size edit mints a new revision"), then passed 6/6
    alone. It is an NTFS timestamp race in #198's probe, unrelated to
    Electron; confirmed and fixed the same day (see the probe entry below).
- [USER+CODE+TOOL] Dependency maintenance:
  - Dependabot now checks npm monthly (#199). The esbuild 0.28.2 allowlist
    entry (#143) and Vite 8.3.3 (#116, which clears the nanoid, postcss, and
    source-map-js advisories) are merged.
  - [USER+TOOL] Dependabot triage: #151 (`@types/node` 24.19.1) and #152
    (React 19.3.0, lucide-react 1.52.0; independent review passed on the exact
    merged head) are merged. #152 slightly redraws the SpellCheck,
    CheckCircle2, CalendarDays, and CalendarClock icons; browser QA was
    skipped. #132 (Electron 44, conflicting after #202) and #145 (Node 24.18.1
    base image, which the Dockerfile's exact version assert rejects) are
    closed. #167 (Forge 8, which needs `@electron/asar` 4) and #144 (react-pdf
    11, which needs `pdfjs-dist` 6.3.289) stay open, deferred by the user.
  - [CODE+TOOL] #152's lockfile recorded the workspace `lucide-react` specs as
    `^1.52.0` against exact manifest pins. `npm ci` accepted the mismatch, but
    npm 11.16.0 rewrites it on install; the lockfile now records `1.52.0`.
  - [TOOL] Dependabot alerts, and with them security updates, are **disabled**
    for the repository (the alerts API returns 403 "disabled"). That
    contradicts #199's text that security updates still arrive immediately.
    Enabling them is the user's setting; whether they will be enabled is
    UNCONFIRMED.
  - [USER] #201 removed root `CONTINUITY.md` from the RoleFit retired-name
    contract. The ledger is a compacted history, outside RoleFit evals.
- [USER+CODE+TOOL] **`tracker-revision-probes` Windows flake confirmed and made
  deterministic** (task `2026-10-09-tracker-probe-ntfs-race`).
  - [TOOL] Cause: the probe edits `applications.json` in place, same size,
    3–7 ms after RoleFit's cached write. When the file timestamp had not
    advanced in that window, dev, ino, size, mtimeNs, and ctimeNs all matched
    and the cache served the stale snapshot: in 30 instrumented runs, all 12
    failures had an identical identity and all 18 passes a changed one.
    Original-probe failures ranged from 0/100 to 12/30 per batch. Sampling
    every 200 ms, the reviewer saw the Windows timer resolution flip between
    1 ms and its 15.625 ms default within one 14 s stretch (1 ms everywhere
    else), and all 5 failures of that loop fell inside it; what lowers the
    resolution is UNCONFIRMED. Linux CI has not shown the failure.
  - [CODE] Decision (a), probe only, delegated by the user. A missed edit needs
    a foreign process rewriting the file in place, same size, within one tick
    of RoleFit's write or validated read. Every RoleFit writer renames (new
    inode) or invalidates, and a writer racing that closely can already lose
    an edit to a save's own rename. (b) would need a content re-check on reads
    near a write, since stat cannot see the edit, and would still leave that
    race. The probe now repeats its edit until the mtime moves past the cached
    one (same inode and size); `ai-server.md` and two `storage.ts` comments
    state the limit.
  - [TOOL] Receipts (Windows x64, Node 24.18.0): in a 120-run interleaved loop
    the original probe failed 15 times and the fixed probe 0; an instrumented
    copy absorbed 13 same-tick collisions (up to 28 rewrites) and passed every
    run. Dropping the timestamps from the cache identity fails the fixed probe
    10/10 at its assertion. The server TypeScript gate and the RoleFit offline
    suite (170/170) pass. Independent review (mb-verifier): pass with three
    low-severity wording findings, all fixed; its loops ran the fixed probe
    200/200 while the original failed 21/200, and its mutation check failed
    25/25.
- [USER+CODE+TOOL] **RoleFit 0.11.0 preview prepared** (task
  `2026-10-09-electron-43-security`). It is a minor release because #198's
  2,000-application tracker and #205's PDF import are user-visible
  capabilities; Electron 43.7.9 (#202), #203, #206, and #151/#152/#204 ship
  with them.
  - The extension stays 1.3.0 and the desktop API stays 13; neither changed
    since 0.10.0.
  - [USER] 2026-10-10: the prep, first drafted on `3c1eb02`, was rebased onto
    `main` at `9f85410` so the release includes #205 and #206.
  - `docs/releases/0.11.0-beta.1.md` notes:
    - PDF import, its review rail, the Polish gate, and the click-only Interpret
    - the tracker limit, faster scans and partial saves, and the new backup
      limits
    - the four Electron advisories
    - rollback: after any 0.11.0 launch, 0.10.0 and earlier refuse to save
      settings and refuse 0.11.0 backups (#205's `resumeImport*` keys), and
      refuse a tracker over 500 or an oversized backup; all fail closed
    - known issues: packaged backup at the new maximum is unverified; PDF
      import accuracy on real layouts and live interpretation are unmeasured,
      and the two accepted layout residuals
  - The landing screenshot manifest is empty, so no retake.
  - [TOOL] Preflight on `9f85410` plus the prep (Windows x64, Node 24.18.0):
    root `npm run check` (RoleFit 178/178), `test:desktop:release` 14/14, a
    fresh `make:rolefit:desktop` (149 staged files, 0.11.0 nupkg), and
    `test:rolefit:desktop:packaged` pass.
  - [TOOL] `test:rolefit:desktop` failed 3/3 (also on plain `main`) in its
    development phase and passed once Vite's dependency cache was warmed. The
    lockfile change dropped `node_modules/.vite/deps`, and the smoke never
    requests a page, so Vite never commits a new one: every run optimizes cold,
    and the dev server misses the companion's 750 ms health probes (instrumented:
    `TimeoutError` after ready). The packaged runtime has no Vite. The
    2026-10-09 "flaky under load" note is probably this; making the smoke
    deterministic is a follow-up.
  - [TOOL] #198 browser QA ([USER] required before tagging). The dev server ran
    from the release worktree on port 5183 with `ROLEFIT_WORKSPACE_DIR` set to
    a scratch workspace of 620 synthetic applications (46 planted duplicates)
    seeded through `writeApplications`.
    - Applications showed "1–20 of 620" (31 pages), and duplicate review listed
      43 groups.
    - Changing one record's stage and saving sent a partial response (the full
      ID order plus that one record). After a reload, all 620 remained with
      the change kept, and a conditional GET returned 304.
    - No failing resources after the fresh worktree's fonts were synced. The
      only earlier console errors were those font 404s.
    - Merge and delete were not exercised.

## 2026-10-08

- [TOOL] **RoleFit 0.10.0 preview released.** #196 squash-merged as `4e33fb8` (=
  reviewed head `2242afd`); macOS arm64 preflight passed (check 167/167, desktop
  and packaged smokes, release tests 14/14). Annotated tag
  `rolefit-preview-v0.10.0-beta.1` on `4e33fb8` (ruleset-restricted; the push
  bypassed it); run 37873927902 published "RoleFit AI 0.10.0 — unsigned preview
  beta.1" at 2026-10-09T02:25:20Z with arm64/x64 `.dmg`/`.zip`, the Windows x64
  `.exe`, and `SHA256SUMS.txt`; site, Typeset, and Document workflow runs
  succeeded.
- [USER+CODE] **0.10.0 prepared** (minor: the Handshake import is new; no
  stored-data or format change; the user asked to "start the 0.10.0 release"
  after #195 merged). Extension 1.2.1 → 1.3.0 (capture changed; the notes ask
  for one reload); bridge API 13 unchanged; the screenshot manifest stays empty;
  notes in `apps/role-fit-ai/docs/releases/0.10.0-beta.1.md`. Ships #194
  (`bc5b4ba`) and #195 (`e25e55c`). [USER+TOOL] Headless Firefox 157.0.1 in a
  clean profile ran the 1.3.0 ⌘⇧U import on a synthetic Handshake posting
  correctly (the user said not to wait for them); the live Handshake site in
  Firefox stays UNCONFIRMED; Chrome was verified live.
- [USER+CODE] **A saved Skip no longer warns on close; Update offers only
  changed PDFs** (the user reported both). A dirty document beside a Skipped
  (`not_applying`) record follows the Apply-excluded rule and warns only until
  its recovery write succeeds (Prepare's automatic retitle still counts as
  dirty). Update application offers only documents whose sync state is not
  `saved`, saves directly when none changed, and names the target ("Update &
  download cover-letter PDF"). [TOOL] Reproduced and verified live on a 5183
  synthetic workspace; check 167/167; one review, no blockers. Accepted
  trade-off: real edits beside a Skipped record also release once recovery is
  written (same-tab only).
- [USER+TOOL] Firefox's ⌘⇧U import did nothing because of a stale session
  (running since its 157.0.1 update); a restart fixed it. No code change.
- [USER+CODE] **The extension imports signed-in Handshake postings** (the server
  cannot fetch them). `extractPageData` (now exported) adds an adapter for
  `*.joinhandshake.com/jobs/<id>` and `/job-search/<id>` that opens up to four
  section toggles, keeps sections up to Similar Jobs, drops any section linking
  to `/profiles/`, and sends the canonical `/jobs/<id>` URL; `extractJobMeta`
  splits `<Role> | <Employer> | Handshake` titles on `|`; unknown layouts fall
  back to generic capture; only a Handshake posting's capture is async. No
  permission or new route. [TOOL] Verified in the user's signed-in Chrome on the
  three reported postings; 11 synthetic probes in
  `__evals__/extension-handshake-capture.mjs`. A review's two blockers were
  fixed before staging: a fixture had copied live session values (now synthetic;
  the repo is public) and a regex title parse backtracked for up to about 9 s.
  - Residual: an already-open description closes and reopens on capture (no
    `aria-expanded`); capture clicks before the pairing check (no text leaves
    the browser); Similar Jobs is the only stop marker; a hidden kept section
    would contribute its text; `atsPostingKey` has no Handshake key, so one
    posting under two school subdomains matches only through the description
    tier.
- [USER+CODE] `extractJobMeta` no longer stalls the analyze route (crafted
  inputs had taken 6–34 s): LinkedIn and Indeed titles are split and indexed,
  and the route caps resolved text at 50,000 characters; probes in
  `server/extension/__evals__/job-meta-probes.mjs`.
- [USER+TOOL] Supported job sites are documented in the app README. An October
  2026 live check imported one public posting per site in full: Greenhouse
  (board and company wrapper), Lever, Ashby, Workday, SmartRecruiters, Workable,
  iCIMS, Oracle Recruiting, LinkedIn, Amazon, Google, Apple, Built In, Dice, YC,
  Wellfound, Teamtailor, SAP SuccessFactors, and Radancy sites. Refused: Indeed
  401, Glassdoor 403, ZipRecruiter 403, Meta 400.
  - Open (each needs the user's go-ahead): Microsoft Careers link import keeps
    only a 1,792-character summary of a 5,692-character posting (the extension
    captures it fully; its public `position_details` JSON has the full text);
    generic link import accepts a page reached by redirect (Rippling's board
    308-redirects every posting to its careers page); the extension reads only
    the top frame, so iCIMS relies on the server fetch of `*.icims.com` and ATS
    frames embedded in company sites capture nothing useful. Unverified (no live
    posting found): Jobvite, Taleo, Paylocity, ADP, BambooHR, Breezy, JazzHR,
    Recruitee, Personio, and other companies' Rippling boards.
- [TOOL] **RoleFit 0.9.1 preview released.** Annotated tag
  `rolefit-preview-v0.9.1-beta.1` on `4e389af` (#193); run 37857689297 published
  at 2026-10-08T23:15:56Z with the same asset set; product site, Typeset, and
  Document workflow runs succeeded.
- [USER+CODE] **0.9.1 prepared** (patch: #192's fixes; the user approved the
  release brief and plan); notes
  `apps/role-fit-ai/docs/releases/0.9.1-beta.1.md`. [TOOL] The Electron
  development-mode smoke failed once in the main checkout (as at 0.9.0) and then
  passed; root cause not isolated; keep its log next time. [USER+TOOL] At the
  user's request the landing companion screenshot was retaken on macOS arm64
  (empty workspace, port 5181, 2x, 1800x1176), departing from
  `landing/AGENTS.md`'s synthetic-pack/spare-port rule as at 0.8.0.
  - [CODE] Open (pre-existing; a known issue in the 0.9.1 notes):
    `resumeIsStarterSample` requires `applicationOfRecordId === null`
    (`App.tsx`), so once the preparation owns a record, Open > Bundled starter
    makes `resumeReady` true and Answers, Polish, Apply readiness, and
    automatic-proposal inputs can treat the sample as the applicant's resume
    (`usePreparedResume` has the same exception in `lib/preparedResume.ts`),
    contrary to PRODUCT.
- [USER+CODE] **Four open items fixed in #192** (`fc60489`; the user approved
  brief v1 and plan v1). Answers' `generate()` gates on App's `resumeReady`
  ("Add your resume first." while the unowned starter is loaded); a fresh
  preparation's first Answers Save reuses the duplicate choice the guard
  remembers for that posting (`rememberedRelationship`), else the committed one;
  Prepare, the Resume tab, and its rail share `editablePolishSectionCount`, and
  Prepare shows `resumePolishBlocker` first; the companion version test asserts
  the version write. [TOOL] Check 165/165, mutation checks, one review.
  - Still open: no duplicate resolution runs for an answer-created Draft with no
    remembered or committed choice; Answers' first Save does not persist a Keep
    separate (`markPostingRecordsUnrelated`) as Apply's create path does; its
    lookup reads the in-memory tracker without a refresh; Prepare still counts a
    Polish section with no usable targets (non-goal).
- [TOOL] **RoleFit 0.9.0 preview released.** Annotated tag
  `rolefit-preview-v0.9.0-beta.1` on `ea8cc6a` (#190); run 37827489011 published
  at 2026-10-08T18:58:16Z.
- [USER+CODE] 0.9.0 prepared (minor: Answers, multiple Skip reasons, a one-way
  tracker format). Versioning follows `docs/git-workflow.md`: patch for fix-only
  releases, minor for new capability or stored-data changes; agents suggest
  releases but bump only on the user's go-ahead.
- [USER+CODE] The companion shows its version only in Settings (the sidebar
  keeps "Running on <port>"), so `landing/screenshot-manifest.json` may be and
  is empty, and a release test pins the version out of the sidebar.
- [USER+CODE] **Skip records any number of reasons** from a grouped list of 12
  plus an optional note, stored as `notApplyingReasons`;
  `src/lib/notApplying.ts` is the single list; the retired `constraints` reason
  stays valid but is not offered (task `2026-10-08-skip-reasons`; approved under
  the user's delegation). [CODE] Suggestions use local evidence only (no
  provider request). A pre-list scalar `notApplyingReason` reads as a one-item
  list; once the new build saves, an older build refuses the tracker and newer
  backups without changing anything; a revert must fix forward.
- [USER+CODE] Re-skipping a posting matched to an application later moved to
  Skipped, and Save job updates on that record, keep its `appliedAt`,
  sent-document metadata, attachments, and AI receipts (the user chose the
  recommended option); damaged records are not repaired; a server guard against
  removing `appliedAt` was offered and not chosen.
- [USER+CODE] Submitted metrics follow the code's rule (user choice): a job-only
  Skipped decision never counts as submitted or as a calendar submission, an
  application later marked Skipped keeps its original submission, and no Skipped
  record counts toward follow-up hygiene; the app docs now say so.
- [CODE] After four "Timed out starting Chromium" CI failures, the
  browser-contract launcher waits 30 s for DevTools and retries once with a
  fresh profile; assertions are unchanged.

## 2026-10-07

- [USER+CODE] **Materials became Answers** (tasks `answers-redesign-20261006`,
  `answers-tuning-20261007`, `answers-expanded-20261007`; the user waived the
  brief/plan gates and supplied the draft). Answers is a per-preparation
  conversation over `/api/application-answers` `mode: "conversation"`
  (`server/ai/applicationAnswerConversation.ts`, prompt
  `application-answer-conversation-v4`: the benchmarked v3 writing guidance plus
  the input firewall). Each answer keeps the exact employer question and
  revision; evidence is the selected resume, whole Profile, edited brief,
  captured posting, and explicit user facts, never a previous answer or the
  cover letter; one generation plus at most one format repair; only explicit
  hard word/character/sentence limits gate Copy and Save; oversized inputs are
  rejected. `shared/applicationAnswersContract.ts` and
  `shared/applicationAnswerStorage.ts` serve browser, server, and backup
  validation. Save appends an immutable revision (reconcile rejects rewriting a
  saved revision id; manual edits append one); the first Save creates a `draft`
  tracker record (no `appliedAt` or documents, outside submission metrics and
  the calendar, moving only to applied or not_applying) that Apply/Skip promote.
  - [TOOL] Check 153/153; two reviews (Answers sections joined the fence
    registry in `prompts.ts`); the limit parser stays heuristic and an ambiguous
    ceiling yields no limit.
  - Residual: no duplicate resolution runs when a posting's first record is an
    answer-created Draft, and acknowledging that Draft replaces an earlier
    Link/Keep-separate decision; earlier conversations stay in memory for the
    session; "Node.js" and "U.S." count as two words. UNCONFIRMED: live
    generation through the installed companion and browser QA of the stage-menu
    change.
- [USER+CODE] **Per-stage startup defaults** (`src/lib/stageSettings.ts`):
  Prepare/Fit Claude CLI Sonnet 5.5 low; Resume Polish and Cover Codex CLI
  GPT-6.1 Sol medium; Answers Claude CLI Opus 5.5 high; Final review Sonnet 5.5
  low (retained user choice). Saved choices stay. Answers' setting comes from a
  blinded synthetic comparison (Opus high a modest lead; Sol medium the OpenAI
  alternative; no human calibration; receipts in the app ledger); results and
  costs are in `docs/engineering/testing.md` and
  `docs/engineering/benchmarks.md`.
- [USER+CODE] **Resume Polish fresh/reset default is Codex CLI / GPT-6.1 Sol /
  medium**, superseding Claude CLI / Opus 5.5 / high; saved choices stay and the
  user's own selection was switched (app ledger). [TOOL] On 39 synthetic cases
  Sol medium passed 39/39 with 0 unsupported edits and Opus high 35/39 with 3
  (all combining separate facts); real applications pull both ways (the
  2026-10-04 holdout favored Opus 11–5). A user-directed, safety-first choice;
  the only fact-check judge is Astra, Sol's vendor.
  - [USER] Deferred: a paired real-application rerun on the current prompt
    (about 20 applications, blinded Astra + Opus, sides swapped); the user is
    low on Codex usage.
  - [CODE] Not done: a Claude-only user gets a generic "check AI settings"
    Polish blocker instead of "add Codex"; switching Resume Polish to Claude CLI
    seeds Sonnet 5.5 low rather than Opus 5.5 high.
- [USER+CODE] The Settings > Automation Fit toggle governs only automatic runs
  and the automatic Polish that depends on them; **Assess fit** / **Reassess
  fit** always run once a posting is prepared and never carry an automation
  token; a mid-Prepare toggle change cancels that Prepare and its Fit request.
  The user chose this option in chat.
- [USER+CODE] **Prepare picks from a user-chosen eligible pool** (task
  `variant-source-pool-20261007`; brief and plan user-approved). Settings >
  Automation **Prepare picks from** lists saved resumes and cover letters;
  unchecked variants are never read, ranked, or adopted automatically but still
  open by hand. Stored as `excludedResumeVariants` /
  `excludedCoverLetterVariants` file-name exclusions in workspace preferences
  (absent means all eligible); resolvers filter before reading and never
  re-resolve a settled preparation. The app guide's "no persisted variant
  metadata" rule allows only this pool. Rollback: an older build refuses
  settings saves with these keys, and since #179 Settings Reset re-writes
  `resumePolishReview` (which 0.8.0 also rejects), so restore a backup made by
  the older build; backups taken with a customized pool need a newer build.
  [TOOL] Check 154/154; two reviews; approved browser QA with synthetic data.
- [USER+CODE] **Opt-in Resume Polish review** (task
  `polish-edit-review-20261007`; [USER] the brief — opt-in, show the dropped
  edits, fail open, benchmark after the eval fixes — and plan were approved; for
  this path only it supersedes the 2026-08-07 "one proposal request" decision).
  Settings > Guidance > **Review edits before showing them**
  (`resumePolishReview`, default off) makes `/api/resume-polish` (`reviewEdits:
  true`) run one keep/drop dispatch (`server/ai/resumeProposalReview.ts`) after
  sanitizing, on the Resume Polish provider, model, effort, and abort signal.
  The reviewer sees review-local ids with each edit's entry and linked Profile
  evidence, never server ids, reasons, or warnings (`proposed_edits` fence in
  `prompts.ts`); a strict parser needs one KEEP/DROP per id, and any failure
  except Stop fails open with a note. Held-back edits list collapsed with
  Restore; with the setting off, request and result are byte-identical; an older
  build rejects preferences or backups containing the key.
  - [USER] AC6 amended: offline probes prove contract, fencing, parser, and
    plumbing; model judgment belongs to the live probes. The default-on bar in
    `docs/engineering/testing.md` is approved, its key-evidence item restated by
    the user as zero held-back edits to `mustKeepBullets` bullets Astra labels
    supported and material (`keyEvidenceValuableHeldBack`). Live calls are not
    yet authorized.
  - [CODE] `EVAL_POLISH_REVIEW=paired` grades both arms with shared Astra
    labels. UNCONFIRMED: no live run exists; the setting stays off. [TOOL] Check
    157/157; approved browser QA with stubbed calls.
- [USER+CODE] **Answers keep the facts the user adds** (task
  `answers-declared-facts-20261007`; the user approved the brief and delegated
  the rest). A saved revision may carry `userFacts: { provenance:
  "user-declared", facts }` (1–20 facts, 4,000 characters each, 12,000 joined;
  `answerFactsWithinLimits` in `shared/applicationAnswersContract.ts`);
  generated revisions never carry it. Reopen restores exactly that revision's
  facts into `explicitFacts` and lists them as "Your facts (N)"; answer text,
  follow-up questions, refinement instructions, and chips never become facts. A
  follow-up defaults the composer to Add a detail; a chip or Refine this answer
  (user-approved) opens Refine. No migration and no prompt change.
  - [CODE] Forward-only: a build without this change cannot load, back up, or
    restore a tracker holding `userFacts`. Rollback: keep a copy of
    `workspace/applications.json`, then strip the field in that directory with
    `node -e 'const fs=require("fs");const p="applications.json";const d=JSON.parse(fs.readFileSync(p,"utf8"));for(const a of d.applications)for(const r of a.applicationAnswers??[])delete r.userFacts;fs.writeFileSync(p+".tmp",JSON.stringify(d,null,2),{mode:0o600});fs.renameSync(p+".tmp",p)'`
    (probed; the copy keeps the facts). A tab opened before the upgrade refuses
    to save into an application whose answers hold facts, with a misleading
    "exceed the storage limit" message, until reloaded. [TOOL] Ten mutations
    caught; check 159/159; two reviews.
- [CODE] A first Answers Save builds its Draft from the posting as last prepared
  in that conversation; with nothing prepared, Save refuses. Open: Cancel at the
  pre-analysis duplicate check leaves B's raw posting reading as prepared while
  the committed preparation is A, so Apply, Skip, and a new Answers conversation
  can save that raw posting; UNCONFIRMED whether intended.
- [CODE] A fresh preparation's posting relationship is scoped to the Prepare run
  that resolved it; only the Polish and Apply/Skip gates publish through
  `onRelationshipResolved`, and at the user's request they also publish a
  remembered choice for that exact posting.
- [CODE] Answers' Retry, including the dock's, stops at the tab's prepared-job
  gate (`jobReady` from App's `jobPrepared`; "Add the job on Prepare first.").
- [CODE] Every committed Prepare and opening a saved application ask first ("Replace
  Answers?") when the thread holds unsaved work; during a Prepare run Answers is
  read-only except Save and Stop; a decline settles the card as "Preparation
  paused" with Retry. Known gap: a bare failed question is not counted.
- [USER+CODE] UI polish (client-only): one shared `components/FitFindings.tsx`
  renders matches, gaps, and eligibility with their warnings on Prepare, the
  inspector, and the modal; "Review before use" is a hairline note. [USER] Saved
  views may show Fit gap notes, which are not claim-checked. [USER+CODE]
  Prepare's Resume Polish note shows the provider's recovery step, otherwise
  "Set at least one editable resume section to Polish.".
- [CODE] Follow-ups to an external review of `c8cc1d4`: gated benchmark
  opportunities count only edits that reach their named outcome; the no-op
  filter keeps deletions of a narrowing claim word or number; a present-tense
  ownership verb ("Build…") claims its past form's level via `presentLead`.
  Still open: claims that recombine separate facts.

## 2026-10-06

- [USER+CODE] **RoleFit landing redesigned as "the galley proof"** (editor sheet
  beside a proof slip of one synthetic edit, ruled editorial spreads, ledger-row
  downloads; fonts bundled from `@typeset/engine` under `font-src 'self'`); the
  card hover-lift is gone and a proof-mark draw joins the scroll reveal.
  `DESIGN.md` and `landing/AGENTS.md` updated. [USER] The review of the day's
  other work stays separate, so no independent review of the landing diff ran.
  UNCONFIRMED: landing browser QA at desktop and phone widths.
- [USER] Base documents refreshed (task `base-docs-refresh-20261006`; user data
  only): the base resume and the Profile Background were updated (Background at
  11.3k of 12k, every heading still linking); the base cover letter is
  unchanged; the portfolio mirror was synced. [TOOL] One page, 44 lines. Backups
  under `workspace/.trash/` and `workspace/resumes/.trash/`
  (`2026-10-07T02-45-29Z__*`).
- [USER+CODE] **Settings redesign with chosen links** (task
  `settings-redesign-20261006`; brief v2 and plan v2 approved, "approve, include
  QA as needed"). Five pages in two rail groups — You: Profile, Background; AI:
  Guidance, Automation, Models — under `SettingsDialog` with pages in
  `sections/settings/`; the gear reopens the last page. Background is an entry
  list beside the selected note's editor; [USER] links are chosen by hand, so
  **Linked to** rewrites only the heading's name and Not linked renames to
  "<name> notes"; an edit that would change how other notes link is refused.
  [TOOL] 147/147; in-app browser QA at 1024, 700, and 375 px; three review
  passes. UNCONFIRMED in a browser: the add-evidence focus path and the
  line-shift handover. Residual: nested notes cannot be relinked from the
  editor; a typed `#` heading regroups following notes without warning.
- [USER+CODE] **Profile linkage and evidence beside edits** (task
  `profile-linkage-preview-20261006`; "sure, lets go with both").
  `profileHeadingLinkage` reports per heading Linked, Grouping, General context
  (with a reason), or Omitted; every Resume Polish row on a standard entry
  carries `profileEvidence` behind a collapsed Show evidence. [USER] The first
  flat heading list was rejected ("very inconvenient, may as well not produce");
  the user chose an entries-first Profile, so the Background renders by the open
  resume's entries (`sections/settings/ProfileNotes.tsx` over
  `lib/profileNotes.ts`) with a Text view; storage stays one string. Deferred: a
  linkage note on the Resume page and Show evidence on Cover Letter Polish.
- [USER+CODE] **Prepare correctness, the Prepare benchmark, and Polish gates**
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
- [USER+CODE] **Polish review follow-ups** (task
  `polish-review-followups-20261006`; "go with your recommendations"). Cover
  findings split into `concerns` (evidence, attribution, private slots, echoed
  `sourceWarnings`), which survive acceptance, and `warnings` (draft structure,
  quality, length, up to three `Model note:` entries), which do not
  (`isCoverLetterConcern`). Resume Polish examines the whole 40-item window and
  keeps the first 12 usable changes in the model's order. The resume corpus is
  39 fixtures with five opportunity cases. Open: the private
  `workspace/cover-benchmark/harness/run.mjs` should add `concerns` before its
  next rerun.

## 2026-10-05

- [USER+CODE] **Cover Letter Polish benchmark, evidence guard, and base letter**
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

## 2026-10-04

- [USER+CODE] **Resume Polish prompt v5** (the user asked for the review,
  benchmark, and implementation): rewrites keep each bullet's tense; a
  materiality rule omits churn; separate facts and broader posting terms never
  become a new claim; an entry gets removals or one reorder; the current-role
  present-tense rule (shared `accomplishmentStyleRules`) is gone. The user
  declined a page-impact line or any warning in the review rail. [TOOL] v5 beat
  the previous prompt with every judge; judges show family self-preference, so
  cross-model comparisons rest on agreement (results in ignored
  `apps/role-fit-ai/workspace/tailor-benchmark/`).
- [USER+CODE] **Resume Polish follow-ups** (user-chosen items 1–4): the shared
  evidence checks (also used by cover letters, Answers, and Fit) were tuned for
  warning precision (rules in `server/ai/AGENTS.md`), and with the user's
  agreement Python frameworks count as Python evidence. A supporting-role
  sentence keeps "part of a team" wording. Prompt slimming was rejected; only
  `<earlier_output_concerns>` and `<terminology_priorities>` joined the shared
  firewall tags.
- [USER+CODE] Round 2: the prompt follows user_guidance within its rules and
  forbids computed totals such as years from dates; Skills "Name API/SDK/CLI"
  items need evidence attaching that interface. [USER] The base resume and
  Profile were tightened from benchmark evidence (private data, backed up
  locally).
- [USER+CODE] Round 3: [USER] one page is a soft target and never blocks an edit
  or decides materiality. [CODE] Warnings name up to three concerns;
  "object-oriented" grounds "OOP"; tense-only or trivial rewrites settle as
  `UNCHANGED`. [USER] The saved Resume Polish instruction carries a soft
  one-page paragraph (it beat the "must be paid for" paragraph 40–4; private
  data, backed up).
- [CODE] Round 4 (2026-10-05): solo-project authorship, a count-purpose merge
  warning, REST = RESTful, cloud and CI entailments; rules in
  `server/ai/AGENTS.md`. [USER] Approved grounding "AI-assisted <activity>"
  Skills items from a line naming an AI coding tool and that activity. [TOOL]
  Labelled precision 53.5%, recall 54.8%. [USER] An unrecorded local CLI
  usage-receipt feature found uncommitted in the tree was removed at the user's
  request. Check 140/140.
