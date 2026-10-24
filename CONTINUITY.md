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

## 2026-10-24

- [USER+CODE+TOOL] **0.22.1 prepared** (patch: #279's shared editor focus and
  30% zoom floor, #280's per-family font metrics, #281's companion pairing
  retry; #278 is landing-only and already deployed). Notes
  `apps/role-fit-ai/docs/releases/0.22.1-beta.1.md`; extension 1.5.2 and
  desktop bridge API 13 unchanged. Preflight on Windows x64, Node 24.22.1:
  check 202/202, Electron smoke, release contract 14/14, `make` (Squirrel
  0.22.1), packaged smoke (win32-x64 unpacked). macOS packaging: release CI only.
- [CODE+TOOL] **Companion pairing startup retry**: right after start, the
  owned dev server stalls requests for up to ~7 s (measured 1.0/3.7/0.9 s,
  then ~1 ms), tripping main's 1 s pairing fetch. Failures before any success
  now keep Loading and retry 4x at 1.5 s. This explains the 0.11.1/0.12.0
  smoke flake; the 750 ms health probe can still read "unreachable".
- [USER+CODE+TOOL] **Agent commit: Drafts, duplicate guard, dry run; MCP
  resume reads** (D100) on `feature/rolefit-mcp-agent-commit`. Verified:
  server tsc, commit and MCP probes, `npm run check` (202/202), read tools over
  the real workspace handlers. Open: no MCP tool attaches documents to a
  submitted Draft (the route exists); real MCP clients not re-run.
- [USER+CODE+TOOL] **Landing download buttons and resize guard**: equal-width
  buttons with Apple/Windows glyphs; file type, size, and "Unsigned" moved to
  a caption linked by `aria-describedby`. `resizeGuard.ts` drops the glass blur
  while the width changes (user-confirmed it ends the blank-card glitch on drag).
  Plus visual-QA polish (wrap and alignment fixes). Verified: landing build,
  browser QA at 1440/1024/768/390/320 in light and dark, two independent
  reviews. Unverified: forced colors, Firefox/Safari, a real screen reader.
- [USER+CODE+TOOL] **Typeset brand refresh + Preview A touch-ups** (D098,
  D099). Verified: browser 1280 to 390px, RoleFit tokens via the editor
  harness, editor/Typeset/engine checks, RoleFit build, independent reviews.
  Unverified: `npm run test:editor:browser` locally (Chrome refuses CDP attach),
  the real RoleFit app and dark mode, Firefox/Safari, print, forced colors. The
  shared default `--shadow-rest` (`packages/editor` tokens) still clips if a
  host keeps it.
- [USER+CODE+TOOL] **RoleFit rename, ribbon-R brand, landing redesign** (D097):
  visible name, packaged app, and release assets are RoleFit (internal IDs
  kept); `generate_icons.py` renders the vector mark (extension now ships PNG
  icons); landing follows the user's mockup with brand ribbons, frosted glass
  cards, Codex-generated accent art, and retaken synthetic screenshots.
  Verified: `npm run check` (202/202), landing build guard, headless Chromium
  at 1440/1280/1024/900/390 in light and dark (no overflow, AA contrast over
  glass), three independent reviews. Unverified: reduced-transparency and
  no-blur fallbacks in a real browser, Firefox/Safari rendering, Windows
  installer, the new extension icon in an installed browser.

## 2026-10-18

- [TOOL] `draft/document-chat` is local-only at `../role-fit-ai-document-chat-draft`.
