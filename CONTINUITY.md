# RoleFit AI Continuity

Cross-workspace handoff state, capped at 160 lines. Rules in force live in
[docs/decisions.md](docs/decisions.md) (read before changing a rule); resolved
history lives in [docs/continuity/](docs/continuity/) (read on demand). App-only
operational detail belongs in the affected app documentation.

## Current state

Current: extension 1.4.0, desktop bridge API 13. The published RoleFit release
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
  Follow-ups offered: skipped-history count in the companion (plus the
  always-false `includesPreferences` flag), "Recently deleted" applications,
  and a history retention cap. Restore still rejects a backup whose history
  fails today's validators (e.g. pre-August 2026 backups); unaddressed.
  0.18.0 preview prepared (minor: backup format); notes
  `apps/role-fit-ai/docs/releases/0.18.0-beta.1.md`.

## 2026-10-18

- [TOOL] `draft/document-chat` is local-only at `../role-fit-ai-document-chat-draft`.
- [USER+CODE+TOOL] **Repository review and cleanup** (#250, #251, #252,
  merged 2026-10-18): dead exports removed (12
  app/server/shared, the retired local polisher's verb list, engine
  `readCoverLetterFile`) plus 31 unreferenced CSS classes (RoleFit, editor);
  a `HOST` override keeps a Host/Origin guard (`requestGuardError`); restore
  staging folders are ignored; job import refuses file-typed responses;
  packaged macOS adds fnm/nvm CLI paths; a Typeset tab whose draft another
  tab replaced warns on leave; the companion smoke runs the pairing ownership
  guard; preview ZIP links say Unsigned; `deps:check` fails a stale install;
  root `npm test` runs Typeset evals. Also fixed: base-resume Save keeps the
  editor document, an open proposal, and the cover workflow (identity-only
  commit; clean only if unchanged since sent); a corrupt provider vault no
  longer blocks the companion (smoke run proves it starts and leaves the file
  untouched); IME composition over a cross-field selection now commits like
  typing (new real-IME Chromium contract); metrics now measure Latin-1 symbols,
  Latin Extended-A, and `‚„†‡‰‹›′″€™−→←↑↓≤≥` where a face has them (documents
  using only the original characters lay out identically; D088); Typeset's
  nginx gzips text (main script 5.7 MB raw, 1.1 MB sent). The two pending Plans
  screens ran (benchmarks.md): OpenAI import keeps Sol Low, Claude Polish keeps
  Opus High. A measured character a face lacks now borrows from Tinos/Arimo
  (D089; 419/419 local and starter layouts unchanged); stale shadow, landing,
  and companion CSS removed. Browser-verified: base-resume Save keeps an open
  proposal and Undo; Typeset's two-tab warning in both directions; IME in
  Firefox (new opt-in `test:editor:firefox-ime`, 10/10). Unverified: Safari
  IME (no WebDriver composition API), the packaged macOS CLI lookup. Decided
  under the user's "your call": the HOST override stays strict (IPs and this
  machine's name only) and the metrics cost (+420 KB gzip per uncached Typeset
  load) stands. Shipped as three squash merges; `main`'s tree equals the
  reviewed tree.
