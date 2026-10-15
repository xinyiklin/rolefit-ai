# RoleFit AI Continuity

Cross-workspace handoff state, capped at 160 lines. Rules in force live in
[docs/decisions.md](docs/decisions.md) (read before changing a rule); resolved
history lives in [docs/continuity/](docs/continuity/) (read on demand). App-only
operational detail belongs in the affected app documentation.

## Current state

Current: RoleFit 0.12.0 preview (`rolefit-preview-v0.12.0-beta.1` on `9ee863c`),
extension 1.4.0, desktop bridge API 13. 0.13.0 is prepared, not yet released
(below). Release history: `docs/continuity/2026-10.md` and D-entries in
`docs/decisions.md`.

## Next actions

- Release 0.13.0 and record its receipt here (tag workflow per
  `docs/git-workflow.md`).
- Deferred by the user: Stage 2B, the paired real-application Resume Polish
  rerun (D071, D074).

## Deferred backlog

- 2026-10-14 [TOOL] RoleFit's Cover letter toolbar container is 338px at a
  390px viewport (52px rail), below the shared disclosure ladder's ~355px
  floor: the formatting row overflows 17px and More overhangs the column by
  5px (same at 0.13.0). The section no longer scrolls into that overhang
  (`overflow: clip`); re-measuring the ladder is a shared-package change.
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
  - Release receipt: PENDING.
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
  and portable schema versions remain; older builds reject unfamiliar font ids.
- [USER+CODE] Approved on-demand loading covers document/inline families and
  next-typing caret choices. Menus are bounded and scrollable. Failed loads are
  visible; obsolete completions cannot replace newer state. Reopening clears
  prior transient typing format, and menu focus restoration explicitly refreshes
  the caret even when the browser emits no selection-change event.
- [TOOL] Node 24.18.0: full `npm run check` and Chromium core/extended pass.
  Checks cover 30 families × 6 roles, 6,565,710 shaping comparisons, 3,414 PDF
  width/text runs, file round trips/rejection, both app builds and reproducible
  assets. All 30 screen/print/dedicated-PDF samples were rendered and compared.
  Synthetic browser QA covers menus, compact layouts, native typing/history,
  held/rejected font loads, stale completions and accurate next-typing carets.
- [TOOL] Two fresh independent reviews passed; all observed asset, loading,
  selection and caret findings were resolved and retested. No outstanding finding.
- [USER+CODE] Follow-up review fix: the DOM painter withholds pages only for a
  family its loader has not confirmed, so adding/removing an already-loaded
  inline family (toolbar, undo/redo) no longer remounts pages behind the loading
  state. Chromium phase `loaded inline fonts` was red on the prior gate.
