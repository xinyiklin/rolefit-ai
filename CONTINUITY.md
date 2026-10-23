# RoleFit AI Continuity

Cross-workspace handoff state, capped at 160 lines. Rules in force live in
[docs/decisions.md](docs/decisions.md) (read before changing a rule); resolved
history lives in [docs/continuity/](docs/continuity/) (read on demand). App-only
operational detail belongs in the affected app documentation.

## Current state

Current: extension 1.5.0, desktop bridge API 13. The published RoleFit release
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
- 2026-10-20..22 [USER+TOOL] Open from #257/#258 (entries rotated to
  `docs/continuity/2026-10.md`): a bare Rejected move is not counted as a
  reply; Ghosted to Applied skips back past Interviewing; the Timeline count
  includes automatic stage entries; timeline and Analytics unchecked in Firefox.

## 2026-10-23

- [USER+CODE+TOOL] **Popup restyle** (D093 amended): the extension popup mirrors
  the workspace tokens and OS theme (chrome masthead, card body, filled
  controls, sentence-case labels, system UI type) with its structure and copy
  unchanged; `minimum_chrome_version` is now 123 for `light-dark()`. Verified:
  extension evals, the RoleFit check (197/197), token parity with
  `tokens.css`, contrast math, and browser QA of all 24 popup states in light
  and dark against stubbed extension APIs (focus, hover, simulated increased
  contrast); independent review passed. Unverified: real unpacked installs,
  Firefox, forced colors. Merged as #262. 0.20.0 preview prepared (minor:
  light/dark appearance, #260-#262; extension 1.5.0 for the popup restyle);
  notes `apps/role-fit-ai/docs/releases/0.20.0-beta.1.md`.

## 2026-10-22

- [USER+CODE+TOOL] **Companion restyle** (D093 amended): the desktop companion
  mirrors the workspace tokens and OS theme in a fixed 760×480 unified shell
  (hidden native title bar with theme-matched controls, icon-led nav, visually
  hidden page titles, status lines in the content, the port copy field only in
  Settings). `generate_icons.py` now makes every brand mark (desktop icons and
  the browser, landing, and extension SVGs); the extension badge uses the
  accent, and the landing companion shot was retaken. Verified: desktop checks,
  release contract, Electron smoke, the RoleFit check, synthetic captures in
  light and dark; independent reviews passed. Unverified: native window
  controls rendering, macOS, forced colors. Merged as #261.
- [USER+CODE+TOOL] **Workspace redesign** (D093): calm native light/dark look
  replacing the green-paper visuals across RoleFit host CSS, plus Settings ›
  App › Appearance. The top bar is gone: a full-height rail headed by the
  brand, which toggles it, with drag resize/collapse, and a floating Apply
  pill at the bottom-right; every page head is one compact 48px row. The
  landing page wears the same tokens; its app captures and the README shots
  were retaken. Verified: tsc, the RoleFit check (197/197 evals, landing and
  desktop builds), contrast math, and headless-Edge captures of a synthetic
  workspace in light and dark; the Chromium host audit now expects light pages
  and OS-following RoleFit chrome; independent reviews passed. Firefox/Safari and
  print UNCONFIRMED. Open with the user: white vs gray workspace plane,
  stacked state labels. Merged as #260.

## 2026-10-18

- [TOOL] `draft/document-chat` is local-only at `../role-fit-ai-document-chat-draft`.
