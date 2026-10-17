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

- [USER+CODE] Branch `claude/nostalgic-goldwasser-716680`, not pushed, no PR:
  - **CLI argv delivery** (audit H2; 9b9d626, 2792e4a, a5e81ff, 37e73e8): an
    npm `claude.cmd` shim made cmd.exe keep only the system prompt's first
    line and drop `--model`/`--effort`. Claude Code now reads the unchanged
    prompt via `--append-system-prompt-file` (private temp file); `runCli`
    refuses multi-line or over-8,191-character argv through cmd.exe. [TOOL] Two
    `mb-verifier` reviews PASS; UNCONFIRMED: macOS and a real npm shim.
  - **Antigravity (`agy`) removed** (D076), with read-repairs for saved stage
    selections and provider vaults; the packaged smoke now enables a fake
    `claude` and pins only snapshot shape. UNCONFIRMED: the packaged smoke run.

## 2026-10-16

- [CODE] **Engine/editor audit patches** (branch `fix/engine-editor-audit`,
  not pushed; autonomous audit of `packages/engine` and `packages/editor`). A
  bullet, skills row, or heading taller than a page fills its page and
  continues at a wrapped line (continuations carry `emergencyBreakBefore`;
  `layout.ts` splits an over-tall chain at the last boundary that fits; a
  page-sized bullet still moves whole). The breaker stops scanning at the first
  overfull start (9,600 differential cases identical; 16,000 words 1.2 s →
  ~10 ms). PDF link URIs escape `\ ( )` and percent-encode non-ASCII (an
  unbalanced `)` made a PDF pdf-lib could not reload). Uppercase headings keep
  `<link=…>` destinations; `<size=0>`/`<size=999>` take an inert slot in all
  three tag walkers; impossible ports are not links and a balanced trailing `)`
  stays in an auto-link (linear trimming); download names strip every inline
  mark; a leading BOM parses; `<indent>` is clamped at impossible margins. New
  evals `eval:inline-marks`, `eval:pdf-links`, `tall-paragraphs.mjs`.
  - [TOOL] `npm run check` for `packages/engine` (incl. fonts:check),
    `packages/editor`, `apps/typeset`, `apps/role-fit-ai` (offline 182/182)
    exit 0 on Node 24.18.0; 277 page-fitting documents lay out byte-identical
    to `HEAD`. Browser QA in Typeset (Chromium pane, 3,000-word bullet over 4
    pages) passed: no overflow; caret, typing, arrows, drag selection, copy,
    menus, and grip across the split; PDF page count and per-page baselines
    match; a kept bullet moves whole. Reviews: `code-reviewer` (no High; Med
    findings fixed: linear bracket trimming, 48,000-word breaker bound, a
    kept-bullet fixture that crosses a page; its follow-up found a
    stranded-heading split, fixed) and `mb-verifier` (nine claims PASS over
    48,768 breaker and 11 pagination fixtures; residual: a cover glyph wider
    than the clamp's 1 em overshoots a 3-inch margin by <0.4 bp).
  - [CODE] Not changed, recorded: one unbreakable 20,000-character token costs
    ≈0.8 s, growing faster than linearly; uppercase headings paint `ß` as `SS`
    while the editor display map keeps one char; a cover base size outside
    9–13 pt throws in `documentStyleToCoverLetterStyle` (unreachable in
    RoleFit). Editor DOM modules were exercised only through the QA above.

## 2026-10-15

- [USER+CODE] The parked document chat draft is branch `draft/document-chat`
  (worktree `../role-fit-ai-document-chat-draft`).
- [CODE] **Repository audit patches** (PR #230, four behavior commits): the
  loopback Host/Origin guard covers every non-extension
  request, and development Vite runs with CORS off and the workspace directory
  denied (before, another localhost-origin page could read `workspace/` from
  the development server; the packaged server was unaffected); Typeset keeps a
  draft its parser refuses under `typeset-resume.autosave.v2.unreadable`
  instead of overwriting it; the Typeset image sends CSP, nosniff, frame
  denial, no-referrer, and hashed-asset caching from `apps/typeset/nginx.conf`,
  which CI's container probe asserts; the Typeset deploy rolls back to the
  previous image when the new container is not healthy.
  - [TOOL] Verified: `test:server-lifecycle` with new page-level guard
    assertions; a 5183 development server probe set (foreign Host/Origin 403,
    workspace and `/@fs/` 403, same-origin 200); `npm run check` for
    `apps/typeset` and `apps/role-fit-ai` (offline 182/182); `nginx -t` and the
    live headers in the pinned image; the built Typeset under that CSP in the
    browser pane with no console errors.
  - [CODE] The guard change touches server network exposure, a product-delivery
    trigger; the full workflow was not run for this user-directed autonomous
    audit, and one `code-reviewer` review was run instead. Its one Med (a
    failed `docker run` skipped the rollback) and six Low findings were fixed:
    asset 404s no longer cached immutable, the IPv6 listener dropped (IPv4
    only), the workspace deny glob escaped, a refused draft storage will
    not keep reported as lost, the development font route moved behind the
    guard, and the CI probe now asserts referrer and asset caching headers.
    Not covered by a test: the development-mode Vite settings (`cors: false`,
    the workspace deny); the lifecycle probe runs production mode only.
  - Still open from the 2026-10-03 review (the Antigravity
    `--dangerously-skip-permissions` item ended with D076): the Typeset deploy
    trusts the host key on first use (`ssh-keyscan`) and needs a pinned
    known-hosts secret; Electron stays at
    its runtime-contract pin with Dependabot PRs open. Never deep-audited:
    extension popup UI logic (its DOM is built with `textContent`; no HTML
    sinks), evals quality, and a full docs-drift sweep (the engine and the
    editor's pure modules were audited 2026-10-16, above).
