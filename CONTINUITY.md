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

## 2026-10-11

- [USER+CODE] **0.13.0 prepared** (minor: #214 adds Fit findings to Resume
  Polish, per-gap statements, and posting-term coverage; the user approved the
  release). Notes `apps/role-fit-ai/docs/releases/0.13.0-beta.1.md`; extension
  1.4.0 and desktop bridge API 13 unchanged; no stored-data or format change.
  - [TOOL] Preflight on macOS arm64 with Node 24.18.0: `npm run check
    --workspace apps/role-fit-ai` exit 0 (offline 182/182),
    `test:desktop:release` 14/14, `test:rolefit:desktop` passed on the first
    run, and `make:rolefit:desktop` plus `test:rolefit:desktop:packaged`
    (darwin-arm64, unpacked) passed. Windows and macOS x64 packaging run only in
    the release workflow.
  - [TOOL] Release receipt: run 38157704047 succeeded on `51d20c4`; the
    pre-release published 2026-10-11T17:07Z with five artifacts plus
    `SHA256SUMS.txt`.
- [USER+TOOL] Guidance audit applied: root `CLAUDE.md` reduced to Claude-only
  mechanics; root `AGENTS.md` adopts the product-delivery hook (named-work
  activation) and one independent review for every change except typo/link/format/comment-only; the
  dependency procedure moved to `docs/development.md`; this ledger was
  compacted (durable rules to `docs/decisions.md` D001–D074, resolved entries
  to `docs/continuity/2026-10.md`). Starters synced to machine-bootstrap
  a1ecaf5 (PR-template wording adopted; its PR-size section and
  `docs/engineering/git-workflow.md` path skipped as project choices).

## 2026-10-14

- [USER+CODE] Shared font catalog expanded by 24 families to 30; locally
  bundled browser/PDF assets, pinned sources/licenses and generation details
  are documented in `packages/engine/fonts/README.md`. Original six/defaults
  and portable schema versions remain; older builds reject an unfamiliar
  document font id and show an unfamiliar inline font mark as literal text.
- [USER+CODE] Approved on-demand loading covers document/inline families and
  next-typing caret choices. Menus are bounded and scrollable. Failed loads are
  visible; obsolete completions cannot replace newer state. Reopening clears
  prior transient typing format, and menu focus restoration explicitly refreshes
  the caret even when the browser emits no selection-change event.
- [USER+CODE] Follow-up review fix: the DOM painter withholds pages only for a
  family its loader has not confirmed, so adding/removing an already-loaded
  inline family (toolbar, undo/redo) no longer remounts pages behind the loading
  state. Chromium phase `loaded inline fonts` was red on the prior gate.
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

- [TOOL] **Typeset outage.** The deploy for #219 (run 38656943748) built on the
  EC2 host. `tsc && vite build` gave no output for 4.5 minutes, then SSH broke
  ("Broken pipe"). The next deploy (run 38665258020) failed at `ssh-keyscan`,
  and the site timed out.
  - Cause, measured locally: #219 grew `metrics.gen.ts` from 1.17 MB to
    10.17 MB. `tsc` peak RSS rose from 365 MB to 1.30 GB, and `vite build` from
    541 MB to 1.29 GB.
  - The host is a t3.micro (1 GiB, x86_64). The host's own OOM log is
    UNCONFIRMED.
- [USER+CODE+TOOL] Fix (D075, user-approved): the deploy ships the CI-built and HTTP-probed
  linux/amd64 image, and the host only loads it. A local rehearsal of
  build/save/load/tag/run served Typeset with all 337 synced font files
  (30 families) from a 62 MB archive.
- [TOOL] Typeset restored 2026-10-15 by deploy run 38673945200 (#222,
  5e1c9778) after the user rebooted the instance; all 30 families served.
- [USER+CODE] Follow-up implemented (PR #223): the generator emits
  `metrics.gen.ts` as one `JSON.parse` string with alias faces by name and
  class-matrix pair kerning; `typeset/metrics.ts` unpacks a face on first use.
  Lossless, consumers unchanged. 10.17 MB → 3.30 MB; Typeset tsc 1.31 GB →
  263 MB; Typeset index JS 9.50 MB (3.51 MB gz) → 3.58 MB (729 kB gz); RoleFit
  tsc 1.41 GB → 363 MB. Per-family lazy loading (the painter finds families
  from the layout, so it needs a schema-level scanner) is not done.
  - [TOOL] Decoded tables deep-equal for 180 faces; 60-layout + 5.45M-measure
    fingerprint and 60-PDF byte hash unchanged; `fonts:check` reproduces.
- [USER+CODE] Application questions left Settings › Models: the Answers composer
  picker is its only model control (`modelControl: "composer"` in
  `apps/role-fit-ai/src/config/aiStages.ts`); its Guidance override and Reset
  are unchanged. Uncommitted on `main`. The parked document chat draft is
  branch `draft/document-chat` (worktree `../role-fit-ai-document-chat-draft`).
