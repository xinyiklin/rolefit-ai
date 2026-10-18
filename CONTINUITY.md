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

## 2026-10-18

- [USER+CODE+TOOL] **CLI/API parity, Plans, model refresh** (D087; branch
  `feature/rolefit-provider-plans`): API calls send the stage effort (no off
  setting anywhere); labels are Claude/OpenAI · CLI/API; Settings > Models adds
  Plan (Hybrid / Claude only / OpenAI only) and per-vendor CLI/API rewrites;
  catalogs keep current models only, retired ids repair to successors. Offline
  188/188; live Claude API smoke passed (4 models, Low and Max); Models page
  browser-checked (desktop + 375px, Chromium pane; Firefox and the Background
  view switch unchecked); OpenAI API live not run. Pending after the Codex limit
  reset: OpenAI Resume import and Claude Resume Polish screens (benchmarks.md).
- [USER+CODE+TOOL] **Agent attribution guard** (#242): tracked
  `.githooks/commit-msg` rejects Claude co-author and "Generated with Claude
  Code" lines (`npm install` sets `core.hooksPath`; run it once in the main
  checkout); squash merges use an explicit subject/body; rename a harness
  `claude/<name>` branch before its first push. Typeset image build verified.
- [USER+CODE+TOOL] **Letter Blank/Starter reset** (D084): both reset a
  customized letter style to the defaults. **Titles follow identity** (D085,
  supersedes D084's title): each title tracks its own header name + company
  until the user renames it (Starter `Your_Name_Resume`; typing a name
  retitles). **Both Starters on a new session** (D086, #241). RoleFit check passed;
  browser QA passed (user and agent, worktree server).
- [USER+CODE+TOOL] **Per-field text sizes; resume and letter unified** (D081,
  D082; branch `feature/per-field-text-sizes`): no base size or LaTeX scale; one
  default per role for both documents; Styles adds Name and Body rows; letters
  share the resume's keys, defaults, header behavior, and alignment; alignment
  never moves line breaks. Parsers convert retired keys; 398 workspace files
  rewritten (backup under ignored `.agent-work/`), 10 pt resumes and 70/81
  letters identical; 10.5 pt resumes shift bullet text 0.74 pt (user-accepted).
- [USER+CODE+TOOL] **Engine CI runs only when the engine can change**:
  `scripts/ci-coverage-selection.mjs` skips `Engine codecs, layout, and PDF`
  unless `packages/engine/**` or a root input changed, and the ~7 min
  `fonts:check` moved to a parallel `Engine font assets` job for font paths.
  A RoleFit version-only release prep (parsed manifest/lockfile diff) now also
  skips the engine jobs and both Chromium suites.

## 2026-10-17

- [USER+CODE+TOOL] **Repository audit, round 2** (16 read-only slices; every
  High re-checked by the coordinator; report kept local). Fixed in this batch:
  tracker attachment overwrites and silent notes clipping (#232), quadratic
  job-import parsing (#233), literal tag text, and the CLI argv fix (both
  below). Still open, by severity:
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
- [USER+CODE] **CLI argv delivery and Antigravity removal** (#235): Claude
  Code reads its unchanged system
  prompt via `--append-system-prompt-file` (an npm `claude.cmd` shim made
  cmd.exe keep only its first line and drop `--model`/`--effort`); `runCli`
  refuses multi-line or over-8,191-character argv through cmd.exe. Antigravity
  (`agy`) support is removed (D080): retired stages take their own CLI default
  and vaults drop the id, keeping API keys. The 0.16.0 release PR changes the
  landing fact strip to "2 CLIs + 2 APIs".
  - [TOOL] App check 183/183; packaged smoke passed on win32-x64 (macOS
    UNCONFIRMED); two mb-verifier reviews per change, all findings fixed.
- [USER+CODE] **0.16.0 prepared** (minor: Antigravity removed, GPT-5.5
  retired; the user asked for the preview). Since
  `rolefit-preview-v0.15.0-beta.1`: #230-#233, GPT-5.5 retirement (D076),
  literal tag text (D079), and #235 (D080). Notes
  `apps/role-fit-ai/docs/releases/0.16.0-beta.1.md`; extension 1.4.0 and
  desktop bridge API 13 unchanged; no file format change.
  - [TOOL] Preflight on Windows x64 with Node 24.18.0: `test:desktop:release`
    14/14, `npm run check --workspace apps/role-fit-ai` exit 0 (offline
    186/186), `test:rolefit:desktop` passed on rerun (first run hit companion
    request timeouts under load), `make:rolefit:desktop` plus
    `test:rolefit:desktop:packaged` (win32-x64, unpacked) passed, and
    `test:rolefit:windows-runtime` passed. Not run locally: the Windows
    installer smoke (it installs into the real profile; the release workflow
    runs it) and any macOS packaging (no Mac here; the changed packaged smoke
    first runs on darwin in the tag's jobs).
  - [TOOL] Two fresh mb-verifier reviews. Mechanics: READY (the CONTINUITY
    receipt was missing; added). Notes: three Medium and eight Low wording
    findings fixed (job-import and Claude Code claims narrowed, cover-letter
    and Edit-box known issues corrected, the Polish hidden-link fix added).
