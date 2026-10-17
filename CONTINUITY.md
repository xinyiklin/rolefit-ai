# RoleFit AI Continuity

Cross-workspace handoff state, capped at 160 lines. Rules in force live in
[docs/decisions.md](docs/decisions.md) (read before changing a rule); resolved
history lives in [docs/continuity/](docs/continuity/) (read on demand). App-only
operational detail belongs in the affected app documentation.

## Current state

Current: RoleFit 0.15.0 preview (`rolefit-preview-v0.15.0-beta.1` on `cd12b2c2`,
release run 38833828940 succeeded; published 2026-10-16T01:33:48Z with 6 assets),
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

- 2026-10-17 [TOOL] The parked document chat draft recorded on 2026-10-15
  (branch `draft/document-chat`, worktree `../role-fit-ai-document-chat-draft`)
  is absent locally and on origin; where it lives is UNCONFIRMED.
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

## 2026-10-17

- [USER+CODE+TOOL] **Repository audit, round 2** (16 read-only slices; every
  High re-checked by the coordinator; report kept local). Fixed in this batch:
  tracker attachment overwrites and silent notes clipping (#232), quadratic
  job-import parsing (#233), and literal tag text (below). The Claude CLI
  Windows argv fix is on branch `claude/nostalgic-goldwasser-716680`, not yet
  merged. Still open, by severity:
  - High: Typeset tabs overwrite one autosave key and the losing tab gets no
    leave warning; the engine measures characters outside its metric set at
    0.5 em (`→ ™ £ ©`, Polish/Czech letters overlap or drift in the PDF) and
    paints a face's missing glyphs as `.notdef` with the wrong ToUnicode;
    editor IME composition over a selection can diverge from the model (code
    path; unverified in a browser); the companion's extension-pairing
    ownership guard has no executing test; `AGENTS.md` requires a
    `code-reviewer` agent that is not installed (`mb-verifier` is).
  - Medium (selected): `HOST=0.0.0.0` drops the Origin check; restore staging
    folders sit unignored beside `workspace/`; job import ignores
    Content-Type; a corrupt provider vault blocks companion startup; packaged
    macOS CLI lookup omits nvm/fnm; base-resume Save discards open proposals;
    landing ZIP links lack "Unsigned"; `main` has no required status checks
    and the `ec2` environment no branch policy.
- [USER+CODE] **GPT-5.5 retired** from the Codex catalog; saved selections,
  workspace preferences, and backups repair to the Codex default (D076). Docs
  aligned with code: extension intake follows the automatic Polish settings
  (D077), and a Typeset autosave clears unsaved changes (D078).
  - [TOOL] Mutation-checked: the backup contract eval fails without the
    repair entry. `npm run check --workspace apps/role-fit-ai` passed;
    mb-verifier READY after one fix round.
- [USER+CODE+TOOL] **Literal tag text** (D079): `<lt>` is a literal `<`
  written only where a raw `<` would start a tag, so typed or pasted `<b>`,
  `<size=12>`, or `<link=…>` stays text in both apps; merges and whole-field
  style changes keep it; screen, PDF text, copy-out, and the PDF Title decode
  it. The Polish markup gate now rejects every grammar tag except b/i/u and
  `<lt>`, closing a hidden-link bypass (also an older `<link=…<b>` variant).
  - [TOOL] Engine, editor, Typeset, and RoleFit checks passed (183/183);
    in-app browser QA in both apps (typing, Enter/Backspace, paste, Styles);
    two mb-verifier reviews READY after three rounds. Headless Chrome
    contracts could not start on this Windows machine (Chrome refused the CDP
    attach; Edge failed to start); Document CI runs them.
  - [USER] Deferred: the RoleFit proposal Edit box still edits raw grammar.
    Limits: Final review evidence and cover-letter AI output read decoded text
    back as grammar; PDF import excludes tag-shaped source text.
