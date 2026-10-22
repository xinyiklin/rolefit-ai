# RoleFit AI Continuity

Cross-workspace handoff state, capped at 160 lines. Rules in force live in
[docs/decisions.md](docs/decisions.md) (read before changing a rule); resolved
history lives in [docs/continuity/](docs/continuity/) (read on demand). App-only
operational detail belongs in the affected app documentation.

## Current state

Current: extension 1.4.1, desktop bridge API 13. The published RoleFit release
is the newest `rolefit-*` entry in `gh release list` (not recorded here;
see `docs/git-workflow.md`). Release history: `docs/continuity/2026-10.md` and
D-entries in `docs/decisions.md`.

## Next actions

- Deferred by the user: Stage 2B, the paired real-application Resume Polish
  rerun (D071, D074).

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
- 2026-10-17..18 [TOOL] Unverified from merged work: #235's packaged smoke on
  macOS (win32 only); D087's OpenAI API live calls, its Models page in
  Firefox, and the Background view switch.

## 2026-10-20

- [USER+CODE+TOOL] **Application stage history** (D091): submitted applications
  keep a dated `stageHistory` (stage changes after submission, interviews with
  kind and derived round, employer responses, follow-ups sent; day-granular).
  Application Detail's Timeline button opens a popover beside the status card;
  each entry saves on its own, only saving a new interview on an Applied record
  moves the stage, and every exit asks before discarding an unsaved entry. The
  server refuses an unrecorded stage change on a submitted record; older builds
  reject trackers and backups with history (user-accepted). Verified by
  `stage-history-probes.mjs`, `application-stage-history-eval.mjs`,
  `date-input-eval.mjs` (six zones), the RoleFit check (192/192), and browser QA
  on a synthetic workspace (1280/820/720/375 px). The first independent review
  failed the UTC+13/+14 date round trip (an older helper bug, also in Detail's
  Key dates); that and its other findings are fixed in `361ed62`, and the exact
  pushed head is re-reviewed before merge. Known gaps: the Timeline count
  includes automatic stage entries; no time of day; confirm and focus flows are
  pinned by source evals and browser QA, not DOM tests. Merged as #257.
- [USER+CODE+TOOL] **Analytics redesign + Ghosted** (D092, merged as
  #258): derived No response (default 21 days,
  7-180; a planned follow-up holds it) and a stored inactive Ghosted stage,
  marked per row, in bulk from Analytics, or automatically (opt-in, off by
  default). Analytics now follows the user's second mockup (DESIGN.md
  "Analytics Insights"): a grouped KPI row (Total vs the same span one
  period earlier; stages as shares, since cross-cohort stage changes mislead),
  activity stacked by stage (weekly/monthly), the No response callout,
  silence bars, a stage distribution with shares and a stage filter, a Needs
  your attention table with next step and row menu, and a dated Coming up,
  in a muted validated stage palette. A Fit-verdict breakdown was dropped
  (Fit has no analytics role). Older builds reject trackers and backups
  carrying the new stage, and every user's preferences file (code reading). Verified: evals, the
  RoleFit check, npm test, layout measurements at 5 widths and a 35-step
  interaction script on synthetic data (Chromium; Firefox UNCONFIRMED).
  The threshold reads "Mark as Ghosted after" in Settings and on Analytics
  (user, 2026-10-22). Open user questions: a bare Rejected move
  is not a reply; Ghosted to Applied skips back past Interviewing.
  0.19.0 preview prepared (minor: tracker and preferences format; extension
  1.4.1 for the Ghosted popup label); notes
  `apps/role-fit-ai/docs/releases/0.19.0-beta.1.md`.

## 2026-10-19

- [USER+CODE+TOOL] **Workspace backup scope** (D053): a companion backup failed
  on 14 July resume-history snapshots carrying the retired `letterSpacingPt`.
  Backup now skips history that no longer validates, fits history newest-first
  within the 5,000-file/256 MB limits, names an invalid live file, and includes
  saved cover letters and their history; deleted-application files
  (`applications/.trash/`) stay local. Still schema v1; older builds reject
  these backups. Verified by probes, `npm test`, the RoleFit check, and a
  byte-identical round trip of a real-workspace copy; two independent reviews,
  no blockers. Unverified: the companion UI flow itself (no packaged run).
  Restore likewise leaves out history that fails today's validators (integrity
  stays strict), so later validator changes cannot strand a backup.
  Follow-ups offered: skipped-history count in the companion (plus the
  always-false `includesPreferences` flag), "Recently deleted" applications,
  and a history retention cap.
  0.18.0 preview prepared (minor: backup format); notes
  `apps/role-fit-ai/docs/releases/0.18.0-beta.1.md`.

## 2026-10-18

- [TOOL] `draft/document-chat` is local-only at `../role-fit-ai-document-chat-draft`.
