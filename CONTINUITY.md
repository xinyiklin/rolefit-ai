# RoleFit Continuity

Cross-workspace handoff state, capped at 160 lines. Rules in force live in
[docs/decisions.md](docs/decisions.md) (read before changing a rule); resolved
history lives in [docs/continuity/](docs/continuity/) (read on demand). App-only
operational detail belongs in the affected app documentation.

## Current state

Current: extension 1.5.2, desktop bridge API 13. The published RoleFit release
is the newest `rolefit-*` entry in `gh release list` (not recorded here;
see `docs/git-workflow.md`). Release history: `docs/continuity/2026-10.md` and
D-entries in `docs/decisions.md`.

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
- 2026-10-26 [USER] 0.24.0: after the release PR's squash merge and the user's
  go-ahead, tag `rolefit-preview-v0.24.0-beta.1` and confirm the workflow.
  Pre-tag: merge the dev-smoke fix (Vite watcher scope, below).

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

- [TOOL] **Bug-hunt round nine**: a cover letter past the .cover limits no
  longer crashes RoleFit (it reads changed, recovery keeps its last valid
  version, saves refuse with the codec's message); accented names keep their
  letters in file names; Undo works on a row settled by hand; diff views keep
  each side's spacing; PDF import splits contact items at dingbat icons and
  sets rating runs aside. Each reviewed. Reverted after two failed reviews:
  icon-prefixed headings and private-use separators (open, src/resume/AGENTS.md).
- [TOOL] **Bug-hunt round eight** (product-delivery; two reviewers per shared
  package): the editor never applies a toolbar command to a replaced
  document's selection; PDF export drops U+00AD and primes each face, so a
  soft hyphen no longer turns every later "-" blank and U+2010/U+2011 no
  longer change how "-" extracts (content byte-identical otherwise, 30
  families); Ghosted marks are dated after a follow-up hold; pinned job
  fetches fall back across every validated address. Residual: layout still
  measures U+00AD as 0.5 em (measure.ts; a layout decision).

## 2026-10-29

- [TOOL] **Bug-hunt round seven**: an unreadable saved resume is an error on
  the snapshot, not a failed workspace (variants, history and letters stay
  reachable); over-limit contacts are refused, not cut; tracker months group
  by local day; a new Typeset tab never writes its restored draft back over
  another tab's. Each reviewed. Follow-up: variant lists skip directories and
  links that do not resolve to a file; the unreadable file is named and the
  variant last open is reopened; the companion's Providers summary says when
  a reused service does not use its providers. Accepted: Prepare and Polish
  duplicate gates may name a lost-reply record (it is saved).
- [TOOL] **Bug-hunt round six** (round five's failing cover-letter probe fixed
  first). Cover letters send slot answers only for slots the letter still has;
  duplicate detection compares non-English descriptions (ASCII unchanged); an
  Apply or Skip retry after a lost reply writes over its own record (the retry
  wins, the row keeps its dates, stage, history and later tracker edits) and
  is never offered as its own duplicate; a new shortcut import clears a stale
  failure notice; MCP `draft_answer` saves its call's facts as `userFacts`,
  and MCP calls go over node:http (no 5-minute header cutoff). Each reviewed.
  Reverted after review: template-trim hardening (the editor already trims)
  and an MCP latest-answer merge (the tracker modal edits answers in place, so
  list order is not recency); a plain MCP correction still sits beside a
  drafted revision. Open: a migrated undated record moved to Skipped sheds its
  documents (refuse the move or change the schema: the user's call).
- [TOOL] **Bug-hunt round five** (first scan of the intake/polish hooks and
  shared contracts): a failed resume-candidate read is no longer cached;
  accepting a warned Resume edit no longer dead-ends a pending cover-letter
  proposal (resume-derived warnings sit in the resume fingerprint); Undo
  restores the exact text an accept replaced. Each reviewed; refuted: the
  Prepare recommendation clear (silent by design) and last-bullet removal
  after a manual edit. Its slot-answer residual was fixed in round six.
