# RoleFit AI Continuity

Cross-workspace handoff state, capped at 160 lines. Rules in force live in
[docs/decisions.md](docs/decisions.md) (read before changing a rule); resolved
history lives in [docs/continuity/](docs/continuity/) (read on demand). App-only
operational detail belongs in the affected app documentation.

## Current state

Current: RoleFit 0.14.0 preview (`rolefit-preview-v0.14.0-beta.1` on `3fb6405`),
extension 1.4.0, desktop bridge API 13. Release history:
`docs/continuity/2026-10.md` and D-entries in `docs/decisions.md`.

## Next actions

- Deferred by the user: Stage 2B, the paired real-application Resume Polish
  rerun (D071, D074).

## Deferred backlog

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
  surfaces: Prepare states and 1080/980/860/720px breakpoints and the Firefox
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

## 2026-10-14

- [USER+CODE] **0.14.0 prepared** (minor: #219's 30-family font catalog; the
  user approved the release). Notes `apps/role-fit-ai/docs/releases/0.14.0-beta.1.md`;
  extension 1.4.0 and desktop bridge API 13 unchanged. The notes' rollback
  section covers 0.13.0 rejecting an added document font (resume history and
  application copies block every backup) and showing added inline fonts as
  tags. Resume PDF import mapped only the original six families in 0.14.0
  (Known issues); all 30 map from the next release.
  - [TOOL] Preflight on macOS arm64 with Node 24.18.0: `test:desktop:release`
    14/14, `npm run check --workspace apps/role-fit-ai` exit 0 (offline
    182/182), `test:rolefit:desktop` passed, and `make:rolefit:desktop` plus
    `test:rolefit:desktop:packaged` (darwin-arm64, unpacked) passed. Windows and
    macOS x64 packaging run only in the release workflow.
  - [TOOL] 2026-10-15 release receipt: run 38665284283 succeeded; prerelease
    `rolefit-preview-v0.14.0-beta.1` published 01:37Z with macOS arm64/x64
    dmg+zip, Windows x64 exe, and SHA256SUMS.

## 2026-10-15

- [USER+CODE] **0.15.0 prepared** (minor; the user approved the release). Since
  `rolefit-preview-v0.14.0-beta.1`: #228 (stop Polish from its own button, rail
  run ledger, Answers model only in its composer), #224/#226 (PDF import maps
  all 30 families), #225/#227 (narrow toolbar fixes), #223 (metrics packing).
  Notes `apps/role-fit-ai/docs/releases/0.15.0-beta.1.md`; extension 1.4.0 and
  desktop bridge API 13 unchanged; no stored-data or format change.
  - [TOOL] Preflight on macOS arm64 with Node 24.18.0: `test:desktop:release`
    14/14, `npm run check --workspace apps/role-fit-ai` exit 0 (offline
    182/182), `test:rolefit:desktop` passed, and `make:rolefit:desktop` plus
    `test:rolefit:desktop:packaged` (darwin-arm64, unpacked) passed.
  - [USER] Waived the second reviewer for this bump (one review) and browser
    QA for the version bump.
- [USER+CODE] The parked document chat draft is branch `draft/document-chat`
  (worktree `../role-fit-ai-document-chat-draft`).
