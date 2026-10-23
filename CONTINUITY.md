# RoleFit AI Continuity

Cross-workspace handoff state, capped at 160 lines. Rules in force live in
[docs/decisions.md](docs/decisions.md) (read before changing a rule); resolved
history lives in [docs/continuity/](docs/continuity/) (read on demand). App-only
operational detail belongs in the affected app documentation.

## Current state

Current: extension 1.5.1, desktop bridge API 13. The published RoleFit release
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
- 2026-10-23 [USER+CODE] The release that ships D095 must say: the tracker now
  carries a format version; this build and later open a workspace saved by a
  newer RoleFit with an update notice and leave it unchanged, while earlier
  builds still report such files as unreadable. It changes no other format.

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
- 2026-10-22..23 [USER+TOOL] Open from #260-#262 (entries rotated to
  `docs/continuity/2026-10.md`): white vs gray workspace plane and stacked
  state labels (user's call); unverified Firefox/Safari, print, forced colors,
  macOS, native window-control rendering, and real unpacked popup installs.

## 2026-10-23

- [USER+CODE+TOOL] **Workspace schema versioning** (D095): `applications.json`
  carries `schemaVersion: 1`; unversioned trackers migrate once through
  `server/applications/trackerVersion.ts` (one fixture per legacy shape); a
  tracker or preferences file newer than the build answers `423
  workspace-newer` on every route, backup, and restore, never written, with a
  Drafting Desk notice. Verified: types, focused probes (each tracker route
  leaves a newer workspace byte-identical), the RoleFit check, two independent
  reviews and a follow-up review of the fixes. Browser QA (user-authorized, a
  throwaway workspace, in-app pane at 1280/730/375px in light and dark; contrast
  by computed color because pane screenshots timed out) found and fixed three
  gaps: a settings-only lock showed no notice, Applications looked empty, and
  Prepare said to retry. Unverified: a real downgrade between installed builds.
- [USER+TOOL] **0.21.0 preview prepared** (minor: agent tracker writes and
  MCP server, #266; extension 1.5.1 for #265's popup fixes; no stored-format
  change); notes `apps/role-fit-ai/docs/releases/0.21.0-beta.1.md`. The MCP
  server also ran under a real Claude Code and Codex 0.162.1 client against a
  throwaway server.
- [USER+CODE+TOOL] **Agent tracker writes** (D094): atomic
  `POST /api/applications/commit` with field-path refusals, server-side
  `POST /api/applications/<id>/status` sharing the row menu's rule and
  transform, later-answers and timeline-event routes, and a dependency-free
  stdio MCP server (six tools) in `apps/role-fit-ai/mcp/`.
  Verified: types, new probes, the RoleFit check, a throwaway-server stdio run,
  the packaged bundle; two independent reviews and a follow-up review of the
  fixes. Unverified: the installed companion and a non-default port.
- [USER+CODE+TOOL] **Redesign leftovers** fixed after the 0.20.0 preview: the
  extension failure badge uses the new `--danger`; the popup's Offer and
  Withdrawn dots match the tracker; hovering a field no longer fades the
  increased-contrast outline (Prepare brief rows, companion key and port
  fields); one off-hue PDF-preview color; stale doc wording. Verified: the
  RoleFit check (197/197) and Firefox 158 computed-style probes in light, dark
  and increased contrast. Chrome automation is blocked on this machine by a
  DeveloperToolsDisabled policy. Ships as extension 1.5.1 in 0.21.0.

## 2026-10-18

- [TOOL] `draft/document-chat` is local-only at `../role-fit-ai-document-chat-draft`.
