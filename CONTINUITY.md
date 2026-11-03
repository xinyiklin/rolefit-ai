# RoleFit Continuity

Cross-workspace handoff state, capped at 160 lines. Rules in force live in
[docs/decisions.md](docs/decisions.md) (read before changing a rule); resolved
history lives in [docs/continuity/](docs/continuity/) (read on demand). App-only
operational detail belongs in the affected app documentation.

## Current state

Current: extension 1.5.3 (since 0.25.0), desktop bridge API 13. The published
RoleFit release is the newest `rolefit-*` entry in `gh release list` (not
recorded here; see `docs/git-workflow.md`). Release history:
`docs/continuity/2026-10.md` and D-entries in `docs/decisions.md`.

## Next actions

- 2026-10-20 [USER+TOOL] Open for the user: the Resume Polish default after
  Stage 2B (D071). The paired rerun over 20 real applications on this machine
  (its workspace is the user's real data) found 0 unsupported edits in either
  arm. Astra preferred Sol 13–6 and the Opus judge preferred Opus 15–1, so there
  is no cross-judge winner. Sol was faster in 17 of 20 pairs. The default
  stays Sol Medium until the user decides. Details are in
  `apps/role-fit-ai/docs/engineering/benchmarks.md`; the harness is in ignored
  `.agent-work/tasks/2026-10-20-stage2b-real-polish/`.
- 2026-10-23 [TOOL] Open for the user: an extension distribution channel.
  Firefox needs a reload after every restart because the unpacked add-on loads
  as temporary; free unlisted AMO signing would end that. Options, costs, and
  required changes are in
  `apps/role-fit-ai/docs/engineering/distribution-cloud-plan.md` (Browser
  extension distribution). Nothing is decided or changed.
- 2026-10-24 [TOOL] Shared-editor startup: font metrics load per family
  (`metrics/<family>.gen.ts`; layout awaits `ensureLayoutMetrics`). Typeset's
  main bundle fell 5.8 → 0.5 MB and a two-page resume's first page paints in
  290 ms instead of 715 (production, cold). Open: exercise RoleFit's editor and
  exports in a browser; only its build and offline suite were run.
- 2026-11-03 [USER] Open for the user: a structured pipeline-block reason
  (captcha, sign-in wall, dead posting). Drafts have no timeline, so it needs a
  stored-data change and a release; until then block reasons stay in notes.

## Deferred backlog

- 2026-10-18 [CODE+TOOL] `main` has no required status checks and the `ec2`
  environment no branch policy (repository settings, the user's call).
- 2026-10-18 [TOOL] Claude Resume Polish (Opus and Sonnet High) marked 2 Fit
  gaps ADDRESSED on no-evidence labels, the same two cases in both arms
  (benchmarks.md); unreviewed whether the labels or the rule are at fault.
- 2026-10-15 [TOOL] At a 360px viewport RoleFit's 308px Cover letter toolbar
  still overflows by ~10px after ladder Stage 6. Fitting it needs 1px control
  gaps or zoom in More (a second zoom control); 360 is not a documented target.
- 2026-10-14 [TOOL] Original-family ligature-boundary edge differences remain
  outside the font expansion: 46 added probes also failed against the prior
  implementation (for example Carlito `Vff` and Latin Modern italic `fll`).
  Existing metrics/reflow and inherited parity checks are preserved; the new
  families have explicit glyph-boundary kerning and broader parity coverage.
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

## Open questions and UNCONFIRMED items

- 2026-07-25..10-06 [TOOL] Browser QA never run (flag-first) for shipping
  surfaces: prepared Prepare states, 980/860px, Firefox intake, and the Firefox
  footer band (2026-07-30); prepared two-pane scrolling (2026-08-07); Apply's
  download dialog (2026-07-31); Sessions rail placement (2026-08-01); Fit
  staleness and inspector layout (2026-08-08..08-09); populated Open-menu
  labels (2026-07-25); the add-evidence focus path (2026-09-28, still
  unexercised 2026-10-06; the redesigned Settings pages themselves were
  browser-checked 2026-10-06); the Show evidence 16rem scroll bound
  (2026-10-06); the running Polish action's hover-to-Stop swap and rail run
  ledger (2026-10-15, skipped by the user).
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
- 2026-10-17..18 [TOOL] Unverified from merged work: D087's OpenAI API live
  calls, its Models page in Firefox, and the Background view switch. (#235's
  packaged smoke passed on macOS arm64 on 2026-10-23.)
- 2026-10-20..22 [USER+TOOL] Open from #257/#258 (entries rotated to
  `docs/continuity/2026-10.md`): a bare Rejected move is not counted as a
  reply; Ghosted to Applied skips back past Interviewing; the Timeline count
  includes automatic stage entries; timeline and Analytics unchecked in Firefox.
- 2026-10-23 [TOOL] Unverified from D095 (#268): a real downgrade between
  installed builds. From D094 (#266): the installed companion and a
  non-default port.
- 2026-10-22..23 [USER+TOOL] Open from #260-#262 (entries rotated to
  `docs/continuity/2026-10.md`): white vs gray workspace plane and stacked
  state labels (user's call); unverified Firefox/Safari, print, forced colors,
  macOS, native window-control rendering, and real unpacked popup installs.

## 2026-10-30

- [TOOL] **Bug-hunt round fourteen** (five-area sweep, 18 confirmed, 17
  fixed): invisible format characters measure zero and merged runs measure
  whole, as the PDF draws them (engine, two reviewers); paragraph merges keep
  the upper format, link Apply keeps edge spaces, nested-block and trailing-br
  paste, quoted copied fonts (editor, two reviewers); Typeset warns on another
  tab's rename and blocked storage; RoleFit restores pre-Interested-migration
  backups, reads past 40 variants, hides fs errno text, and keeps closed
  records out of next actions/Upcoming. Full check passed. Linked emails/URLs
  now preserve typed punctuation (cdc2f68). Open: a .resume summary with no
  bullets (codec change, needs [USER]); a "-" pair split by a mark or paragraph
  tag shows an en dash.
- [TOOL] **Bug-hunt round thirteen**: a vanished extension posting no longer
  leaves Prepare on "Receiving"; narrow-window toolbar undo/redo follows the
  editor's history rule (grouped steps move together); U+202F and U+2007 act
  like U+00A0 (engine, two reviewers). Each reviewed; full checks 216/216.
  Residual: other Unicode spaces (U+2009, U+3000) still keep their own glyph
  in single-line fields; letter style has no undo history.

## 2026-11-01

- [USER+CODE+TOOL] **Agent pipeline gaps** (D103, #289) and **0.25.0 prepared**
  (minor). Linux x64, Node 24.22.1: check (desktop probes, offline 206/206),
  Electron dev smoke (non-root, Xvfb), release contract 14/14. Not run: native
  `make` + packaged smoke (only the workflow's; a failure burns beta.1), an
  agent client, live providers, browser QA of the tracker notice.

## 2026-11-02

- [USER+CODE+TOOL] **Header popover edits keep formatting** (266c068): a
  header popover edit diffs the stored text, so marks, links, punctuation,
  the caret and typing history survive. A review of the whole branch trimmed
  over-long comments, guide history, dead code and duplicated helpers with no
  behavior change, and merged main's #289/#290. Browser QA not run
  (flag-first).

## 2026-11-03

- [USER+CODE+TOOL] **Agent tools read record defaults** (D104): `assess_fit`
  and both polishes take a record `id`, `search_applications` takes
  `requisitionId`, and `get_submission_package` adds notes and pay. MCP only.
  Not run: an agent client and live providers.
- [USER+CODE+TOOL] **Cover-only agent submissions** (D105, amends D101):
  `resumeNotRequested: true` lets a commit or first submission save its
  `.cover` alone; the flag is not stored. Not run: an agent client.
