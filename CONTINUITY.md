# RoleFit AI Continuity

Cross-workspace decisions and handoff state. Keep entries factual, dated, and
bounded; app-only operational detail belongs in the affected app documentation.

## 2026-08-06

- [TOOL] `job-analysis-rename-contract.mjs` now takes its file list from
  `git ls-files --cached --others --exclude-standard` instead of a directory
  walk. Git reports POSIX separators, so its ledger keys matched only on Linux
  CI and the check could never pass on Windows; git's ignore rules also keep an
  ignored personal workspace out of the scan and out of test output. The
  ledger's 20 entries and exact counts are unchanged, and the full RoleFit gate
  passes on Windows for the first time with all 69 offline evaluations green.

## 2026-08-01

- [USER+CODE+TOOL] The standalone Typeset app and the private
  `@typeset/engine` and `@typeset/editor` workspace packages establish a 0.2.0
  document-platform milestone together. This is metadata-only: workspace link
  ranges remain `*`; RoleFit remains 0.6.0; runtime code and UI are untouched;
  and no exported package contract, portable-file schema, or browser-storage
  schema changed.
  npm 11.16.0 regenerated exactly the three owning workspace-version entries
  in the root lockfile, and a clean install passed with a task-scoped cache
  after the running RoleFit companion released its native-module handle. The
  matching publication mechanism is the existing Typeset static-container
  deployment from `main`, not a Git tag, GitHub Release, or npm publication;
  PR checks, merge, the `Typeset CI and Deploy` main run, and the live-site
  receipt remain UNCONFIRMED.
- [USER+CODE+TOOL] The frozen RoleFit milestone is prepared as source version
  0.6.0 with browser extension 1.1.0 and the existing desktop bridge API 12;
  within that RoleFit release, Typeset, shared-package, manifest-format,
  backup, document, settings, and runtime-config schema versions remained
  unchanged. Preview identity stays in the
  `rolefit-preview-v0.6.0-beta.1` tag rather than the package version, and the
  curated note records the exact extension/API mapping. The
  release-tuple regression check has a red/green proof and all 12 desktop
  release-contract tests pass. The full RoleFit build/landing/desktop gate and
  all 64 offline evaluations pass outside the managed esbuild filesystem
  boundary; source Electron smoke, the 129-file allowlisted package layout, and
  unpacked Windows x64 packaged smoke also pass. A local Squirrel installer
  make is UNCONFIRMED because this execution account cannot create Electron's
  `AppData\Local\SquirrelTemp`; the authoritative native workflow superseded
  that host limitation after user QA and merge commit `e4c67ea`: run
  `30717428328` published the six-asset unsigned GitHub prerelease successfully.
- [USER+CODE+TOOL] Desktop API 12 adds one bounded extension-setup copy
  operation for `directory`, `chrome`, `edge`, and `firefox`. The companion
  renderer sends only that fixed target; Electron main maps it to the private
  materialized extension path or exact browser setup address and owns
  `clipboard.writeText`, with no generic renderer clipboard/path capability.
  The setup card uses quiet native buttons with control-local hover/focus,
  pending, success, and error feedback; success holds for 1.1s and fades before
  restoring its prompt, the panel never rerenders or shifts, and an always-
  present visually hidden live region reports results across tab changes. The
  user approved visual QA on port 5181. The full RoleFit gate (64 offline
  evaluations), 129-file package-layout probe, source Electron smoke, unsigned
  Windows x64 Forge package, and packaged smoke pass; packaged smoke now
  normalizes ASAR separators across Windows and POSIX. The product/extension
  release version remains unchanged for the separate release PR.
- [USER+CODE+TOOL] Live browser-tab Sessions awareness moved from the masthead
  into the bottom studio-rail utilities group immediately above Settings. It
  remains read-only and outside `OUTPUT_TABS` and the APG tablist; the expanded
  rail shows a stable total, the collapsed rail preserves a compact count and
  working cue, and the menu uses a viewport-clamped rightward popover that
  escapes the clipped studio shell. The masthead now owns only RoleFit identity
  and Apply. Product, design, engineering, testing, and scoped ownership docs
  now describe the same boundary. The RoleFit production build, 371 workflow
  guards, and all 64 offline evaluations pass; the seven esbuild evaluations
  that cannot traverse the managed Windows filesystem sandbox were rerun
  successfully outside it. Desktop visual QA on port 5181 remains UNCONFIRMED
  pending the user's pre-merge review.
- [USER+CODE+TOOL] A focused review of Apply's multi-document download change
  closed three async-contract gaps and two dialog/name edge cases. The naming
  dialog now remains mounted and busy until every selected PDF attempt settles,
  preventing cover-letter edits from changing the style after its application
  artifact was saved. A pure sequential export helper catches `false` and
  rejected results per document, so a failed resume export cannot suppress the
  cover-letter attempt. Manual resume selection owns a separate reactive busy
  lifetime in addition to its synchronous ref guard, keeping Apply and Tailor
  blocked when it overlaps an automatic recommendation load. Download-only
  checkboxes now say so explicitly, retain a 24px label target, and expose a
  polite in-dialog progress receipt. Dotted kind suffixes round-trip without
  stacking (`Jane.Doe.Resume` -> `Jane.Doe.Cover.Letter`). The executable PDF
  sequencing evaluator, 18 naming probes, 345 workflow guards, RoleFit build,
  and all 64 offline evaluations pass. Browser QA of the changed dialog remains
  UNCONFIRMED under the flag-first policy.

## 2026-07-31

- [USER+CODE] **Apply's download prompt now covers every included, exportable
  material instead of the resume alone.** A cover-letter-only Apply prompts, and
  an Apply with both gives each document its own row: checkbox plus its own
  editable name field, replacing the single shared "File name" input. The two
  documents stay two PDFs because ATS uploads are per-document and a merged file
  breaks resume parsing. The letter's field is seeded with
  `swapDocumentTitleKind` (`Name_Company_Resume` -> `Name_Company_Cover_Letter`),
  reusing the existing document-title convention rather than stacking a second
  suffix onto a base that already carries a kind, and remains independently
  editable. Downloads run sequentially,
  and both PDF export helpers now resolve a success flag so Apply's own status
  names a failed export instead of losing it to an editor status the user has
  navigated away from; that message appends to the artifact-save result rather
  than replacing it. Apply is synchronously single-flight from duplicate
  resolution through a direct commit and through the selected post-commit PDF
  exports; the pre-commit naming prompt remains interactive. Explicit manual
  resume or cover-letter selection now preempts in-flight recommendation work,
  and included cover-letter ranking keeps Apply and Cover Tailor blocked until
  selection settles. The prompt gates the resume on the structured model, not
  the looser export-rail flag, so a text-only polish result no longer offers a
  PDF that cannot be typeset. The 15-case `apply-download-names-eval` plus
  the focused `apply-download-lifecycle.mjs` evaluator pin the naming, ordering,
  and outer busy lifecycle. The workflow guards now pass 344 checks. The
  RoleFit
  check, `deps:check`, the server TypeScript gate, and all 63 offline
  evaluations pass. Browser QA of the dialog is UNCONFIRMED.
- [USER+CODE+TOOL] CI ran the engine suite three times per push — once in
  `Document workflow CI` and again inside each deploy workflow's verify job.
  Only `generate_font_assets.py` reaches the network, and it refetches every
  pinned upstream source on a cold runner with a 60s socket timeout and no
  retry, so each duplicate run was an independent chance to fail. Observed on
  `22b1fd1`: the engine job succeeded while `RoleFit verify` timed out against
  the same sources minutes apart, and a re-run of the identical commit passed
  with no code change. `Document workflow CI` is now the sole per-push owner of
  the package suites; the deploy workflows build and ship only their own app
  and no longer install Python at all. An app build still compiles both shared
  packages from source, so type and integration breakage still fails a deploy —
  but a deploy passing alone no longer proves the package suites passed, so
  `Document workflow CI` is the gate that must stay green on `main`.
- [CODE] Every job that runs `generate_font_assets.py` now caches
  `/tmp/typeset-fonts`, keyed on that script plus `requirements-fonts.txt`,
  which name the immutable pinned commits. Both release workflows carry the
  same cache so a signed or preview release cannot fail on a slow mirror.
  Retry was deliberately not added: caching removes the download on warm
  runners rather than papering over a failure, and it is worth seeing whether
  cold-runner misses still flake before adding backoff.
- [CODE] Both deploy workflows exclude `**/*.md` and `packages/*/scripts/**`
  from their triggers. `22b1fd1` changed only a Python wrapper, a package
  script field, and docs, yet republished the RoleFit site and swapped the
  Typeset container; neither path can change a built bundle. The existing
  warning still applies: a skipped workflow never reports, so a deploy verify
  job must not become a required status check.

- [USER+CODE+TOOL] `npm run check` could not pass on Windows for
  `packages/engine`, for two independent reasons now fixed. The repository had
  no `.gitattributes`, so a Windows checkout under `core.autocrlf=true`
  rewrote the generated font assets to CRLF while the generators emit LF;
  `generate_font_assets.py --check` compares byte for byte and therefore
  reported correct committed assets as stale. Confirmed by measurement rather
  than inference: `fonts/Arimo-OFL.txt` held 93 CR in the working tree and 0 in
  its committed blob, and stripping CR made the working file hash-identical to
  the blob. Every committed text blob in the repository was already LF, so
  `* text=auto eol=lf` changes no blob; only Windows working trees renormalize
  on re-checkout. Second, `fonts:check` invoked `python3`, which Windows
  installs do not provide — they ship `python.exe`, `pythonw.exe`, and a `py`
  launcher, and a bare `python` may resolve to the Microsoft Store alias stub.
  It now runs through `packages/engine/scripts/run-python.mjs`, which prefers
  the `.font-tools` virtualenv over any ambient interpreter and requires a real
  "Python 3" banner. `__pycache__/` is now ignored.
- [TOOL] Verified on Windows 11 with Python 3.12.10 and the pinned
  fontTools 4.60.2 / brotli 1.2.0 virtualenv: `npm run fonts:check` passes both
  generators ("Verified 40 generated files against pinned sources", "Verified
  33 fonts, 11.80 MB total"), and the full `packages/engine` check passes for
  the first time on this platform. CI behavior is unchanged — it already
  checked out LF and had `python3` on PATH.

- [USER+CODE+TOOL] A dependency-ownership follow-up closes three phantom
  dependencies that the default hoisted install was satisfying without any
  manifest declaring them. RoleFit now declares `pdfjs-dist` 5.4.296 directly,
  superseding the 2026-07-29 record of it as a React-PDF transitive: RoleFit
  resolves the PDF.js worker by subpath in `PreviewOverlay`, and its PDF
  round-trip eval imports the legacy build. A contract pins that version to
  whatever React-PDF requires, because an API/worker split fails at runtime in
  the preview rather than at build time. RoleFit also declares
  `@electron/asar` 3.4.1, imported by the packaged smoke test, and the root
  declares `react`/`react-dom` 19.2.8 for the root-owned browser-contract
  fixture. The lockfile gained four manifest lines and no packages: every
  version was already resolved at exactly these numbers.
- [CODE] `check-dependency-contracts.mjs` now walks `scripts/`, `apps/*`, and
  `packages/*` recursively across `.js/.mjs/.cjs/.ts/.tsx/.cts/.mts`, resolving
  each import against its nearest owning `package.json` and allowing only that
  manifest's dependencies, root-owned tooling, workspace packages, or Node
  builtins. It previously scanned only immediate `.js/.mjs/.cjs` files under
  `scripts/`, so it could not see any of the three. Textual scanning matches
  escaped imports inside regex literals, so candidates must also parse as legal
  npm package names. Dependency CI adds `deps:tree` and
  `deps:audit:production`; the root gains a `devEngines` block that fails a
  mismatched runtime or package manager before install.
- [TOOL] Verified on this branch: `deps:check` passes and a negative test
  (declarations removed) reproduces all three findings with file and owner
  attribution; `deps:tree` exits clean; the production audit is zero while the
  development tree keeps its 30 known no-fix Forge packaging advisories; engine
  typecheck and evals including 1,266,912 PDF shaping comparisons, the editor
  check, and both app checks pass with 57 RoleFit tests green. Engine
  `fonts:check` was NOT run locally — this Windows host has no Python 3, so CI
  is the first environment to exercise it. `devEngines` is accepted by npm
  11.16.0 but its enforcement on a mismatched toolchain is UNCONFIRMED.

## 2026-07-30

- [USER+CODE+TOOL] **Prepare now exposes one concise Role context instead of
  separate Role summary and Company / product context textareas.** Existing
  prepared or restored jobs still combine and deduplicate the legacy split
  values so no captured context disappears. Once the user edits the unified
  field, its tracker-backed `roleDescription` becomes authoritative and the
  hidden legacy `companyContext` value is cleared atomically, preventing stale
  prose from reaching Tailor beside the edit. Extraction gaps now use the same
  Role context label. The focused prepared-job eval, all 314 client workflow
  guards, the RoleFit production build, and all 61 offline evaluations pass;
  the suite's loopback probes required a non-sandboxed rerun after the sandbox
  correctly rejected `server.listen` with `EPERM`. Browser QA was not run under
  the flag-first policy; the unified textarea's rendered width at responsive
  breakpoints remains unconfirmed.
- [USER+CODE+TOOL] **Prepare's Resume and Cover Letter groups now use one
  concise recommendation contract.** The screenshot showed the root failure:
  equal raw keyword counts were broken alphabetically, so a tied source was
  still called recommended; Resume then asked for confirmation while Cover
  Letter required a separate Use action. `recommendVariant` now weights the
  prepared job's title, required qualifications, declared technology,
  responsibilities, seniority, domain, preferred qualifications, and context.
  A tie, negligible edge, or incomplete candidate read returns no
  recommendation. A meaningful unique winner is auto-selected for either
  document through its existing guarded loader only while the editor is clean
  and not application-owned. The normal UI now uses the selector as the receipt:
  both groups say `Selecting best match…` while ranking and expose the same
  Tailor/Open actions, with no counts, tie explanation, Use button, confirmation
  step, or duplicate success receipt. A compact `Recommended: <label> · Select`
  fallback appears only when safe replacement was blocked. This supersedes the
  earlier same-day cover-letter recommend-only/high-confidence resume contract.
  The weighted/tie/incomplete evals, all 312 client workflow guards, the RoleFit
  production/landing/desktop builds and probes, and all 61 offline evaluations
  pass. Browser QA was not run under the flag-first policy; rendered density in
  the supplied rail layout remains unconfirmed.
- [USER+CODE+TOOL] **Resume and cover-letter output identity now stays paired,
  and Prepare reports fit without guessing.** Selecting a saved cover-letter
  variant changes its content source but preserves the current application
  title, matching resume selection and keeping exports on the
  `Name_Company_Resume` / `Name_Company_Cover_Letter` contract. Both editor
  toolbars now use only the same `Role at Company` sublabel instead of adding
  AI-source text to Resume. After preparation, the flat Application rail shows
  the matching current AI Review verdict and score, falls back to a matching
  saved verdict explicitly labeled Historical Review, or says `Not reviewed`
  with a route to Review; it never derives a local fit judgment. All 305 client
  workflow guards, naming and fit-verdict focused checks, the RoleFit
  production/landing/desktop builds and probes, and all 61 offline evaluations
  pass. Browser QA was not run under the flag-first policy; the new compact Fit
  row's rendered wrapping at rail breakpoints remains unconfirmed.
- [USER+CODE] **Prepare now changes shape with the job lifecycle instead of
  reserving a sparse readiness column.** Before preparation, a centered Source
  panel is the whole task: URL and pasted text are APG-tabbed methods, only the
  selected method renders, the URL action says what it does ("Prepare from
  URL"), and the paste editor is capped at a compact working height. Empty Job
  brief, Materials, and readiness scaffolds are absent. After preparation,
  Source keeps its existing collapsed captured-posting paths, the editable brief
  leads the main column, and one sticky Application rail combines the stacked
  Resume/Cover Letter choices, readiness, saved-application summary, and Apply.
  Material DOM order now matches the visible identity/Include/variant/actions
  sequence; the existing preparation, recommendation, inclusion, and Apply
  contracts are unchanged. The Impeccable layout detector is clean, all 296
  client workflow guards and 61 offline evaluations pass, and the RoleFit
  production build passes. Browser QA was not run under the flag-first policy;
  rendered empty/prepared states and the 1080/860/720px transitions remain
  unconfirmed.
- [USER+CODE+TOOL] **The Include toggle's hidden checkbox had no containing
  block.** `.prepare-include-toggle input` is `position: absolute` while its
  label was `static`, so the input resolved against the INITIAL containing block
  and did not move with the studio-body scroller. Measured in the running app at
  1512x620, scrolled to the end: the label sat at y530 while its own checkbox was
  stranded at y342, 188px away; adding `position: relative` to the label pins it
  inside at every scroll offset (A/B run in one probe, both directions). This is
  the failure mode already recorded on 2026-07-25 for popovers — an absolutely
  positioned descendant extends its scroll container's scrollable area — and it
  explains a blank band under the last material row after clicking Include,
  which focuses that stranded input. `.prepare-main` is now positioned as a
  backstop for the sr-only recommendation live region in the same column.
  Chromium (the QA pane) clamps the visible symptom: sidebar, studio body, pane,
  and shell all measured flush to the window bottom before and after, so **the
  user's reported footer band is Firefox-observed and its disappearance is
  UNCONFIRMED** — the stranding it comes from is fixed and guarded.
- [USER+CODE+TOOL] **Prepare now recommends a cover letter too, and stops
  calling a saved template "No draft."** `resumeVariantRecommendation.ts` became
  `variantRecommendation.ts` (`recommendVariant`, `VariantCandidate`,
  `VariantRecommendation`) with a per-caller usable-length floor: 80 characters
  for a resume, 40 for a letter. `readCoverLetterVariantCandidates` reads each
  saved `.cover` through the same validated select route the editor opens with —
  verified in the running app to be a pure read that leaves the open letter
  alone — parses it, and skips any variant that fails rather than ranking it
  empty. A second App effect ranks them on the same debounced prepared job and
  invalidates on a new `coverLetterCandidatesRevision`, which one
  `adoptCoverWorkspaceSnapshot` owner now advances for every authoritative
  cover-letter snapshot. **It never adopts its own winner**: a letter is short
  enough that keyword coverage cannot honestly reach the confidence that
  justifies replacing an open document, so both materials render one
  `PreparedVariantRecommendation` note carrying a one-click "Use <label>".
  Separately, `coverLetterReady` was right but its label lied: base letters are
  templates, so a legitimately loaded variant with unresolved `[slots]` read as
  "No draft". The state now says `Template · N placeholders to fill`, with
  "Draft too short" and "No draft" as the other real reasons.
  287 client workflow guards (9 new), 61 offline evals including cover-letter
  ranking cases, client typecheck, and the production build pass. Live browser
  checks: all five saved letters fetch and parse through the select route, and
  the state line reads `Template · 6 placeholders to fill`. The recommendation
  itself needs a prepared job, so its rendered form is **UNCONFIRMED** — no live
  provider-backed job analysis was run.
- [USER+CODE] **Prepare's page shape is now flat, dense, and tool-like**
  (user: "more functional/compact/less ai"). Behavior, props, readiness, and the
  Apply contract are unchanged; the chrome is not. Source, Job brief, and
  Materials are hairline-headed panels — title, quiet meta, trailing actions —
  and a prepared source collapses into its own head (captured size and origin)
  with no body. The two material cards became two rows of one Materials panel;
  their icon tiles, the `· Using <variant>` clause, and the `activeBaseResumeLabel`
  / `activeCoverLetterLabel` props are gone because the variant selector already
  names the variant. Every secondary line — blocked-action guidance, live
  status, safety notes, the variant recommendation — is one `.prepare-note`
  text treatment instead of four tinted panels, and each material shows at most
  one: the blocker while its action is unavailable, its status otherwise
  (the cover row previously showed both at once). The extraction/candidate gap
  boxes are flat columns, ending a card-in-card the No Nested Container Rule
  already forbade. The rail is one panel: preparation is a readiness check, so
  its progress card appears only while work runs or a status is outstanding, and
  each check is one line rather than a label over a sentence. Removed as
  decoration: every Sparkles/ShieldCheck/FileText/Mail/ClipboardCheck mark, the
  brief's two-sentence "correct missing details here" preamble, and the
  duplicated role/company brief header. Verbose labels shortened (Tailor,
  View/Replace, Fetch, Open/Review). All 278 client workflow guards, 61 offline
  evals, the RoleFit client typecheck, and the production build pass; the
  guard that pinned "no accent stripe" moved to `.prepare-note` and gained a
  no-nested-card check for the gap columns. **Browser QA was not run** under the
  flag-first policy — layout risk is real and unverified: the 3-column brief
  grid, the 4-column material row, the collapsed-source bar, and the 1080/980/
  860/720px breakpoints.
- [USER+CODE+TOOL] Prepare is the first/default and sole job-intake surface. Its
  editable brief includes tracked job facts, company context,
  responsibilities, required/preferred qualifications, technical keywords,
  seniority/domain signals, benefits, and extraction/candidate-review gaps.
  Resume and Cover Letter share the same card pattern with Include toggles and
  variant selectors; Resume starts included, Cover Letter starts excluded, and
  Apply requires readiness only for included materials while allowing neither.
  Re-Apply preserves any previously saved artifact for an excluded material.
  Current candidate gaps come only from the matching Review result; a restored
  Apply snapshot is labeled historical until Review runs again. Applications
  routes new work back to Prepare and its detail modal edits existing records.
  Resume recommendation ranks actual variant contents and auto-selects only a
  clear high-confidence winner while the editor is clean; ambiguous or dirty
  state pauses without persisted variant metadata or a schema change. Saved
  variant mutations invalidate the ranking, and an in-flight automatic choice
  cannot replace a restored application's resume. The full RoleFit gate passes:
  production and landing builds, desktop contracts, and all 61 offline
  evaluations. Browser QA was not run.

## 2026-07-29

- [USER+CODE+TOOL] The final dependency-modernization tranche SHA-pins every
  third-party GitHub Action, fixes workflow runners to named current images,
  and executes TypeScript 7's native compiler plus all seven configs on Linux
  x64/ARM64, macOS ARM64/x64, and Windows x64. Typeset's Node 24.18.0 and
  unprivileged Nginx bases are multi-architecture digest-pinned; pull requests
  build the image and require an HTTP response before deployment. Native
  Dependabot now groups npm, Actions, Docker, and Python updates without an
  auto-merge path, leaving Vite, TypeScript, Electron, PDF/font, Python, and
  generated-asset changes under their documented manual gates.
- [USER+CODE+TOOL] The PDF dependency audit retains `pdf-lib` 1.17.1,
  `@pdf-lib/fontkit` 1.1.1, React-PDF 10.4.1, and its `pdfjs-dist` 5.4.296
  transitive. RoleFit's unused direct `fontkit` 2.0.4 dev dependency and its
  nine exclusive transitive lockfile records are removed: source search found
  no import, the desktop bundle metafile retains no runtime import, and the
  staged package remains 128 allowlisted files. The strengthened round-trip
  fixture emits all six families and six faces with accents, ligatures,
  kerning, links, and underlines plus a searchable two-page cover letter.
  PDF.js exact-position/extraction checks, 1,266,912 shaping comparisons,
  reproducible web/PDF font checks, both app builds, Poppler renders of every
  retained artifact, and a real React-PDF Source Serif preview pass with no
  browser errors or warnings. Python pins and generated font assets are
  unchanged; the production npm audit remains zero.
- [USER+CODE+TOOL] TypeScript 7.0.2 is the sole workspace compiler after an
  explicit 6.0.3 bridge. The root probe and all six child configs pass without
  diagnostics; browser configs retain their previous options, the Node-native
  server gate alone uses ESNext/NodeNext with relative-import rewriting,
  erasable syntax, verbatim modules, and no emit, and the desktop emit remains
  separate. The editor component probe now loads its TSX through Vite rather
  than TypeScript's removed JavaScript compiler API. On this macOS ARM64 host,
  real wall-clock typechecks changed from 5.04s to 0.86s for RoleFit, 2.67s to
  0.81s for Typeset, 1.98s to 0.46s for engine, and 2.74s to 0.66s for editor.
  Node-native `.ts` evals and desktop `.cts` emit/probes pass. Other native
  compiler platforms remain assigned to the PR CI tranche.
- [USER+CODE+TOOL] Electron 43.2.0 now shares one desktop runtime contract for
  its 43.2 major/minor, embedded Node 24.18, the `node24.18` esbuild target,
  and Node 24-only Forge host. Build staging, Forge, release contracts, IPC
  fixtures, package layout, and packaged smoke consume that owner; the exact
  Electron installer is included in the reviewed lifecycle-script allowlist.
  Source desktop probes, release tests, the real Electron owned/reused server
  smoke, native macOS arm64 packaging, ASAR/PDF-worker presence, security
  fuses, ad-hoc signature, and packaged startup pass. Native macOS x64 and
  Windows x64 remain workflow-only verification on this ARM64 host.
- [USER+CODE+TOOL] RoleFit now shares the root Vite 8.1.5 and React plugin
  6.0.4 with Typeset, with the Vite 7 browser baseline retained explicitly for
  the renderer and public landing page. Dependency checks, both app gates,
  RoleFit/landing builds, lifecycle probes, Chromium lazy-panel/React-refresh
  checks, and the built landing CSP smoke pass. Real saved-resume QA also found
  and fixed a pre-existing CSP omission: `connect-src` now permits only the
  in-memory `blob:` fetch PDF.js needs. The public starter resume, fonts,
  PDF.js worker, and object URL all returned 200 with no browser errors.
- [USER+CODE+TOOL] React and React DOM now resolve once at 19.2.8, and all
  three Lucide consumers resolve once at 1.27.0. Shared-editor checks, the
  Typeset app gate, RoleFit's production build, and the dependency contract
  pass. No product UI code changed; visual QA remains deferred under the
  flag-first policy until the Vite/browser tranche.
- [USER+CODE+TOOL] Dependency-modernization tranche 1 pins the workspace to
  Node 24.18+ below 25 (`.node-version`: 24.18.0) and npm 11.16.0, aligns CI
  and Node types with that runtime, and makes shared TypeScript/Vite/React
  tooling root-owned. A strict, version-pinned install-script allowlist and the
  dependency-contract gate now protect clean installs. RoleFit's Vite 7/plugin
  5 pair remains the sole explicit migration exception until its dedicated
  Vite 8 tranche; Electron Forge's private TypeScript 5.4 compiler is not a
  workspace compiler. Two clean `npm ci` runs preserved the lockfile hash;
  production audit, full repository check, Chromium editor contracts, and
  effective RoleFit tsconfig comparison passed under the pinned toolchain.
  The production audit is zero; the separate full audit still reports 29 high
  and 1 critical no-fix advisories, all in dev-only Electron Forge
  packaging/rebuild transitives, for the Electron tranche to reassess.
- [USER+CODE] Browser downloads now keep their hidden anchor and blob URL alive
  through Chromium's asynchronous handoff. Immediate cleanup could deliver the
  PDF bytes while losing the anchor's requested `.pdf` filename, leaving a
  UUID-named file; the shared download path now cleans up after a bounded delay
  and a focused lifecycle probe pins the filename and cleanup order.
- [USER+CODE+TOOL] PDF export no longer rewrites Latin Modern's name-keyed
  OpenType/CFF program as a CID-keyed `CIDFontType0` resource, a hybrid that
  Firefox 153 / PDF.js 6 painted as missing or remapped glyphs even though
  older PDF.js and Poppler could extract it. The reproducible PDF-font
  generator now converts Latin Modern to metric-preserving TrueType siblings;
  pdf-lib emits every face as `CIDFontType2` + `FontFile2` with the identity
  CID-to-GID map. The engine gate, 1,266,912 font-parity checks, RoleFit and
  Typeset builds, the PDF round-trip, and real-resume Poppler plus PDF.js 5/6
  path-raster probes pass. The broader upstream-source font check remains red
  only because the pre-existing Arimo/Carlito license outputs are stale; the
  focused PDF-font regeneration check passes.
- [USER] 2026-07-29: **Pre-release schema policy, in force until the user lifts
  it.** While the products are in dev/preview/beta there is exactly one live
  schema: whatever the current build writes, still called `schemaVersion: 1`.
  Runtime parsers stay single-shape and reject anything else — no compatibility
  branches, no derived defaults for absent fields, no version negotiation. When
  a change alters a stored shape, the assistant converts the existing documents
  with a throwaway developer script and keeps that script out of the commit.
  The user will say when to lift this and move to real versioning and
  migrations; the assistant may ask whether a lift is warranted.
- [USER+CODE] 2026-07-29: **Spacing is absolute.** Every structural junction is
  the following row's own line advance plus the gap the user set, so 0 adds
  nothing; the retired TeX junction constants and tabular struts are gone from
  the engine. The header keeps its own line spacing of 1 and does not inherit
  the document's, so a gap of 0 is the same distance in a resume and in a
  double-spaced letter, and the header's gaps are the only thing that moves its
  rows. `titleSubGapPt` may go negative (floor -6): an entry head is a pair
  inside one block, traditionally tighter than single spacing, and the ink floor
  still prevents collision. `.cover` persists the three header gaps it actually
  uses; the other eight belong to sections and entries a letter does not have.
  Defaults, presets, and `starter.resume` were rebased so a new document looks
  unchanged, and 21 live workspace documents (9 resume styles, 12 cover styles,
  including snapshots inside application records) were converted with backups
  under `workspace/.spacing-migration-backup/` and
  `workspace/.header-lineheight-backup/`. Documents in `.trash/` and older
  rewrite backups were left alone and will fail to open until converted.
- [CODE] 2026-07-29: `vertical-parity.mjs` and `vertical-truth.json` are
  retired. They measured the engine against a frozen Tectonic compile, and the
  engine owns its layout now. `vertical-layout-snapshot.mjs` replaces them: 75
  recorded lines across the three spacing presets, compared exactly rather than
  within a TeX tolerance, updated only via `--update`. `pdf-roundtrip.mjs` now
  lays out the engine's own starter document instead of the TeX fixture.
- [USER+CODE] 2026-07-29: The three header gaps (`nameContactGapPt`,
  `contactGapPt`, `headerSectionGapPt`) stay style-owned for both document
  kinds; paragraph spacing does not replace them. Only style can express a gap
  inside the header block or between wrapped contact rows, which are layout
  products with no document node. The cover letter, which has no
  document-spacing popover, now exposes them in its Header menu via
  `DocumentStructureControls`'s `headerSpacing` prop; the resume keeps them in
  `SpacingStylePopover`. `DOC_STYLE_BOUNDS` point gaps now round outward to the
  0.1 step so every slider stop is a clean tenth, and the two trim gaps floor at
  -6 pt: both sit on a calibrated baseline skip (13.6 pt name -> contact, 19.18
  pt header -> body, one leading in a cover letter), so their old calibrated
  floors could not close the gap they name. Widening a bound cannot invalidate
  an existing document. UNCONFIRMED: on the cover letter, `headerSectionGapPt`
  and the first paragraph's `space-before` still add rather than override
  (`coverLetterBlocks.ts`), so the header gap is a floor the paragraph control
  cannot reach below.
- [USER+CODE] 2026-07-29: Typing/deletion undo grouping is word-sized, not
  burst-sized (user: live grouping undid every character typed at once, unlike
  Google Docs). A shared-editor text run still ends on an idle pause, field
  change, or structural edit, and now also at a word boundary in the gesture's
  own direction and at a 20-character cap. `TextEditOptions.historyText` is how
  the editor reports the characters an edit moved; an edit that omits it counts
  as one character against the cap. Editor checks and both app builds pass.
- [USER+CODE] 2026-07-29: **SUPERSEDES the resume-v2 and cover-file
  compatibility entries below.** `.resume` and `.cover` each have one strict
  schema version 1. Both persist the same optional structural header contract:
  absent, hidden, visible blank, named, and ordered contact fields remain
  distinct. Retired resume name/contact, resume schema-v2, oldest
  `rolefit.resume`, interim cover-header, and cover schema-v2 shapes are
  accepted only by explicit workspace rewrite tools, never by runtime parsers.
- [CODE] 2026-07-29: The shared editor owns header create/show/hide/remove,
  name/contact editing, right-click actions, keyboard structure edits, rich
  clipboard transfer, and explicit multi-block header/document paste mapping;
  header hover action menus are intentionally absent. Cover letters enable
  header structure while disabling resume sections.
- [TOOL] 2026-07-29: The ignored local workspace was migrated with backups:
  24 resume files and 12 cover files reparse through the sole strict-v1 codecs.
  Seven resume and one cover application source fingerprint were reconciled
  with tracker backups. A post-write audit caught the tracker sanitizer dropping
  structural headers on its second pass; the boundary was corrected and all 249
  affected resume header snapshots were restored exactly from the immediate
  backup. Repeat dry runs report zero source or metadata changes, and all eight
  tracked source fingerprints match their files.
- [USER+CODE+TOOL] 2026-07-29: Header commands now retain stable identity so a
  normal typing render cannot trigger the caret-restoration effect against the
  pre-edit DOM. A synthetic browser reproduction changed from caret `10 -> 0`
  before the fix to `10 -> 11` after it. The header hover add/delete menu and
  its CSS were removed; header structure remains in the toolbar, keyboard, and
  right-click paths. Editor checks and both consumer builds pass.
- [CODE+TOOL] 2026-07-29: The final review made private structural paste
  lossless across single- and multi-field selections, preserved style-only and
  header-only autosaves, disabled every control in an already-open structure
  popover, and added a strict storage-boundary rewrite for retired standalone
  Typeset browser autosaves. The full repository check passes: all four
  workspace gates, 59 RoleFit tests, 143 client workflow guards, both autosave
  migration suites, and 1,266,912 PDF parity checks. Final workspace dry runs
  remain zero-change for all 24 resumes and 12 cover letters.
- [USER+CODE+TOOL] 2026-07-29: Automatic-link deferral no longer swaps an
  editable `<a>`/`<span>` while a primary pointer selection is in flight. That
  swap disconnected the range anchor and collapsed a backward drag beginning
  at a linked contact's trailing edge. The current paint now stays stable until
  mouseup, then the settled single- or multi-field range is restored. Shared
  editor checks and both app builds pass; live RoleFit verified trailing-edge,
  already-deferred, cross-contact, and repeated Shift-selection cases with no
  console errors.
- [USER+CODE+TOOL] 2026-07-29: Contact undo/redo now detects a restored slot
  before comparing field text. A missing trailing contact and a restored empty
  contact both read as `""`, which previously left history without a caret
  target and let the browser collapse before the restored divider. The caret
  now restores at offset zero inside the first added contact. The focused
  regression ran red then green; the editor gate and both app builds pass, and
  live RoleFit verified both undo-restoration and redo-restoration at
  `contact|5`/0 with zero console errors.
- [USER+CODE+TOOL] 2026-07-29: Text history now uses a rolling 700 ms
  field-plus-intent group: typing, backward deletion, and forward deletion are
  independent transactions; selections, formatting, structural edits, field or
  caret moves, pauses, and undo/redo close the group, while background
  persistence does not. React Strict Mode exposed that the shared history clock
  allocated two sequences for one reducer dispatch, so sequence allocation is
  now idempotent for the same state/action pair across both content and style
  reducers. Red/green reducer probes cover held deletion, autosave, direction,
  caret, pause, contacts, and double invocation. Live RoleFit verified grouped
  typing/deletion undo and redo plus the caret-move boundary, restored the
  original contact after each probe, and reported zero console errors.

## 2026-07-28

- [USER+CODE] 2026-07-28: **SUPERSEDES every cover-letter preparation/proposal
  entry below.** The cover letter is one Tailor click. `/api/cover-letter` is a
  single operation with no `mode`, plan, selected-evidence, or override field:
  the server resolves date, candidate, role, company, greeting, and sign-off,
  sends the whole evidence corpus with the typed source template, and the model
  chooses which experiences and honest-context notes the posting warrants. A
  valid letter is applied straight to the editor; the editor keeps the exact
  pre-tailor `.cover` behind one Restore that expires on the next edit, open, or
  Tailor. Removed as user-facing ceremony: the evidence plan, use/skip
  decisions, clarification round-trips, the 1–3 evidence-item contract, the
  "Continue to draft" and "Use this draft" steps, the Polish/Guide mode picker,
  and the guided `why_role` / `lead_experience` / tone fields. Removed as
  gates: the 80-authored-word requirement (now only a prompt voice signal), the
  verbatim four-word source-phrase requirement, and the 180–420-word and
  one-page acceptance checks (now warnings on a delivered letter).
  The reason the branch was reworked rather than reverted: the template parser,
  deterministic correspondence, stale-request cancellation, placeholder
  rejection, and grounding checks were the right parts; the choreography around
  them was not.
- [USER+CODE] 2026-07-28: Questions are the exception path, not the workflow. A
  missing candidate name, role title, or company blocks with one inline field
  each; an unanswered private template slot (a referral, a prior personal
  relationship) blocks with one focused question. Everything else generates: a
  recipient comes from an authored `Dear <name>,` greeting or falls back to the
  company hiring team, and an unrecognized natural-language slot stays
  generative rather than becoming a blocker.
- [CODE] 2026-07-28: Server validation collects _repairable violations_ instead
  of throwing, then runs exactly one silent repair request carrying the
  violations and the rejected output. A second failure returns 422 and keeps the
  candidate's current letter. The normal path is one provider request.
- [ASSUMPTION] 2026-07-28: `/api/cover-letter` accepts an optional
  `employerContext` array of `{fact, source}` and passes it to the prompt for
  employer facts only. Nothing populates it yet — app-owned public company
  research is a deliberate follow-up, must never delay or block Tailor, and must
  never send resume or honest-context text to the fetcher.
- [USER+CODE] 2026-07-28: The cover-letter quality corpus stays synthetic and
  never reads `workspace/cover-letters/`. Ignoring a personal `.cover` protects
  its path, not copied text; pasting it into the tracked fixture would publish
  it, while loading it in the live harness would send it to the selected
  provider and duplicate it in local eval output. The tracked synthetic job
  families remain the portable quality floor without either exposure.
- [TOOL] 2026-07-28: All 57 RoleFit offline evals, both TypeScript gates, and the
  RoleFit production build passed after the rework. Browser QA was not run under
  the repository's flag-first policy; the rail and toolbar changed shape, so
  rendered QA of the Cover letter page is the outstanding check.
- [TOOL] 2026-07-28 (historical, pre-rework): the two-stage flow passed 58
  offline evals and live Claude CLI QA on a Saronic Full Stack Engineer
  application, reaching a validated pending proposal. Recorded because the
  grounding behavior it proved still holds; the workflow it describes does not.
- [TOOL] RoleFit production build, all 57 offline evals, and desktop/390px
  browser interaction QA passed with a clean console. The synthetic live-provider
  harness was added but not run.
- [CODE+TOOL] 2026-07-28: The final review kept employer research out of
  candidate grounding (a public company technology can never substantiate the
  candidate's use of it), made punctuation-heavy employer names safe for
  employer-only sentence classification, and added the four new cover-letter
  prompt wrappers to the shared fence-injection firewall. Adversarial probes
  failed before each fix and passed after it. The full RoleFit gate then passed:
  production and landing builds, desktop contracts, and all 57 offline evals.
  No live provider eval ran.

## 2026-07-27

- [USER+CODE] Ordinary tracker PUTs now send only records named by `upsert`
  mutations; delete-only requests send an empty applications array. The server
  still accepts legacy full snapshots, treats unmutated client rows as
  non-authoritative, prepends genuinely new records in incoming order, and
  retains existing server order for edits and merges. Successful writes still
  return the authoritative full tracker for cross-tab synchronization, but the
  client reuses prior objects whose id and `updatedAt` are unchanged. Explicit
  Refresh and `409` conflict snapshots remain fully fresh, and the shared
  applications lock remains unchanged.

- [USER+CODE] Cover letters now default to double line spacing with 8 pt after
  each paragraph, 0.5 inch top/bottom margins, and 0.75 inch side margins.
  Exact snapshots of both prior shipped defaults migrate to the new default;
  the locally applied 1.15/8 pt and double/0 pt defaults also migrate, while
  customized stored styles remain untouched. The starter and ignored base
  variants add another 8 pt space before `[Date]`.

- [USER+CODE+TOOL] Duplicate scanning remains a full O(n²) pair loop, but PR #92
  schedules its cold run after the first Applications table paint and caches one
  id/edge result across tab visits; rehydration always uses live records and
  re-splits disconnected survivors. PR #93 made description intersections lazy
  behind cheap metadata/size gates without changing any verdict, threshold,
  tier, evidence string, or grouping. The 27-record characterization corpus
  still pins all 351 pairs.
  The reported 71.3 ms at 500 records is an ATS-heavy Node benchmark, not a
  worst-case browser bound. The scan still runs synchronously on the browser
  main thread after scheduling. The pre-#93 browser fixture measured a 155.6 ms
  cold scan, 7.2 ms key construction, an effectively free revisit, and about
  30 ms to read/serialize/parse its 2.75 MB list payload; a post-#93 browser
  trace and mixed/content-heavy fixtures remain unmeasured.
  Cache identity now uses the matcher's exact raw-text fallback and effective
  role selection, observes only the first 15,000 description characters,
  canonicalizes dismissed-id membership, and uses a length-prefixed two-hash
  composite. It remains a conservative cache version: raw URL/metadata changes
  may safely over-invalidate. The per-object `WeakMap` avoids rehashing only
  while references survive. Successful own-write responses now preserve
  unchanged id/revision objects; explicit GET and conflict snapshots stay fresh.
  **DEFERRED / NOT ACTIVE BACKLOG:** bucket candidate indexing and incremental
  edge maintenance. The tracker is capped at 500 records, and neither
  architecture is justified by measured user impact. Reconsider only if
  mixed/content-heavy browser traces show recurring visible scan stalls after
  sparse mutation payloads and note-write coalescing are addressed. If the
  remaining issue is responsiveness rather than total CPU, evaluate a worker or
  cooperative chunking before behavior-pruning buckets.

- [USER+CODE] Apply still creates the application and snapshots each included
  document. The resume and the cover letter are no longer frozen at that
  moment; each carries its own saved/unsaved state and an explicit "Update
  application" row
  in its own Save menu, so a letter tailored after applying is saved to the
  same record instead of being copied by hand. The strict source bytes and only
  that document's tracker fields commit atomically against the current
  application revision, so concurrent edits fail with a refreshable conflict
  instead of rewriting the other document, status, notes, job details, or fit.
  Tracker revisions advance monotonically even for same-millisecond edits, and
  file mutations wait for this tab's pending tracker writes before choosing
  their base revision.
  Nothing saves on an effect: regenerating or editing never rewrites what the
  application holds. Saved-state comparison includes the complete serialized
  source, so style-only edits remain unsaved; missing source remains retryable,
  and Apply preserves each recovery draft until that document's source is
  durable. The session
  remembers the applied/restored record (dropped once the desk points at
  another posting) so repeated updates cannot create a second row. An empty
  editor cannot erase a stored document.

- [USER+CODE] A tracked application now keeps both documents in the same form.
  Apply and each explicit document update store only the editable source
  (`resume.resume` / `cover.cover`); PDF preview/download is rendered from that
  source on demand. An explicit PDF upload replaces the corresponding source
  and remains stored as `resume.pdf` / `cover.pdf`. Both forms use one route
  vocabulary, `/api/applications/:id/documents/:kind[.format]`, replacing the
  resume-only pair; existing saved PDFs keep working. The Documents tab is one
  component rendering both kinds with identical Preview/PDF/source, Upload,
  and confirmed Remove actions, and users can attach extra PDFs —
  extension allowlist + magic-byte check, 8 MB each, 10 per application, stored
  under `applications/<id>/attachments/` and served only as downloads with a
  narrow content type, `nosniff`, and a no-load CSP. Attachment bytes and
  metadata commit atomically against the current application revision, not at
  modal Save.
  Review fixes folded in: attachment names are case-folded and derived
  idempotently (a non-idempotent name orphaned bytes the record could no longer
  reach), the tracker metadata count is authoritative for the attachment cap
  even when managed bytes are missing, and an upload 404s for an untracked id.
  Each document slot stores exactly one representation and clears the
  superseded source/PDF, deleting an application moves its files to
  `applications/.trash/`, and both file routes send the same download headers.
  File downloads also require matching tracker metadata, so orphan bytes are
  not reachable through the loopback API. Exact source fingerprints take
  precedence over lossy tracker text for saved-state comparison, and duplicate
  detection recognizes every absorbed source URL instead of only the primary
  posting URL.
  Workspace backup schema v2 carries each
  tracked application's active managed document paths and PDF attachments,
  validates strict sources during backup and staged restore, requires tracker
  metadata and bundled bytes to match exactly, and excludes orphan application
  directories. Schema v1 remains restore-compatible.

- [USER+CODE] The two editors now behave alike. The cover letter's "Restore
  source" button and the pre-tailoring source state behind it are gone; instead
  the letter keeps its own per-tab recovery draft (serialized `.cover`, so a
  restore brings back style as well as text) with the resume's Recovery
  draft saved / Saving / failed vocabulary and its own restore bar, replacing
  the bare "Unsaved cover letter" warning. Tab scoping, live-sibling
  protection, orphan migration, and expiry moved to one owner
  (`lib/autosaveDraftStorage.ts`) that both drafts share under separate storage
  keys; a workspace restore still clears every draft of both kinds. The letter's
  draft is cleared only where the letter itself becomes durable (workspace
  save, `.cover` download, or a successful application-document save). Apply
  settles the resume and cover-letter recovery state independently, so a failed
  source save cannot clear the other document's protection. Document titles now
  share one rule,
  `Name_Company_Resume` / `Name_Company_Cover_Letter`, applied only to titles the
  app itself produced. Residual risk: an AI reseed clears editor history, so a
  letter that was tailored without ever being edited or saved is recoverable
  only from workspace variants/history — the same footing as the resume.

- [CODE+TOOL] Content and print-style Undo/Redo now share one coordinator per
  document rather than module-global state. A divergent edit invalidates Redo
  across both reducers, loading a document invalidates the prior document's
  history, and editing a second document cannot split the first one's typing
  group. Focused reducer probes, both app builds, and a live Typeset
  style-Undo/content-edit check passed.
- [USER+CODE+TOOL] Desktop health now reports closed standalone/companion launch
  provenance without treating public health as ownership; only the live private
  utility handle proves that this companion started the server. Compatible
  listeners get state-specific Connect/Stop or Use/Restart choices. Stop and
  Restart still revalidate the exact RoleFit identity between two listener-PID
  resolutions and send only one graceful `SIGTERM`; unknown listeners are never
  signalled and external listeners are never force-killed. After resolving the
  active server, the companion writes its validated port into the materialized
  extension runtime config; a port-changing restart explicitly asks for one
  browser extension reload. Reused services expose read-only extension access,
  live status revalidates the full health identity, and the previous owning
  companion exits cleanly after an approved graceful service handoff. Desktop,
  lifecycle, and Electron ownership/reuse smoke checks pass.

## 2026-07-26

- [USER+CODE] Cover letters now mirror resume startup selection: the browser
  stores only the active saved `.cover` filename, reopens it through the
  validated workspace select route, clears stale/detached identity, and falls
  back to the server's first option (Default when present). A startup response
  cannot replace a blank, starter, upload, external letter, or other document
  the user opened while it was in flight.
- [USER+CODE] Base cover-letter variants remain flush-left block letters rather
  than receiving first-line indents. Current university career-center guidance
  favors concise one-page, resume-matched professional formatting; paragraph
  separation supplies the visual boundary while indentation stays optional.
- [USER+CODE] In prose paragraphs, Tab indents and Shift+Tab outdents rather
  than navigating focus; neither moves focus out of the page
  (Escape does). This supersedes the earlier "Shift+Tab is the cover-letter
  focus escape" decision. One tab stop is measured, not fixed: a half inch
  converted through the engine's space advance for the caret's own font and
  size, so it matches a word processor in every family instead of the ~0.11-0.19
  inch four spaces gave. A caret indents at the caret; a selection indents the
  lines it covers and survives, including across paragraphs. A plain
  Backspace/Delete against authored indentation removes exactly one whole stop
  and never a remainder, so a space typed before the Tab survives it, live and
  on the held-key replay path; shorter space runs and word/line deletes are
  unchanged. Structured resume Tab navigation is unchanged and still leaves the
  key to the browser at a document boundary or for a selection crossing fields.
- [USER+CODE] A selected line's band covers its LINE BOX: its ink plus the line
  spacing that line owns, which the engine now publishes per line
  (`VLine.leading` → `PlacedLine.leading` → `--tsd-line-leading`). Measuring the
  band from the DOM gap to the next line instead left the last line of every
  paragraph short and painted the paragraph gap as a tall empty slab at the
  previous block's width (most visible under the contact row); the gap between
  two blocks belongs to neither and stays unpainted. Bands tile rather than
  stack: the offset is signed, so where tight line spacing overlaps two ink
  boxes the band gives height back instead of painting the translucent veil
  twice as a dark stripe over the text.
  Supersedes the earlier "selection paint includes each selected line's owned
  leading/paragraph gap": the line below claimed the same gap, so every
  paragraph gap was painted twice and a short closing line left a floating band
  above the next paragraph, which read as that paragraph owning the previous
  one's spacing.
- [USER+CODE] An endpoint that names no field now resolves to one on BOTH paths,
  because the painter's line separator and line container carry no field key and
  that is exactly where a browser parks a line-end caret or ends a whole-line
  drag. `readSelection` (collapsed carets) resolves through `fieldCaretOf` to
  the end of the last content span at or before the point; `readFieldRanges`
  (ranges) resolves both the covering field and the display offset inside it
  against that field's own painted spans. Before this, a caret at a paragraph's
  end mapped to no field and every command fell back to the last remembered
  range — choosing a line spacing there applied it to the whole paragraph and
  left the whole paragraph highlighted — while a range defaulted to the whole
  field, and a wrapped field tested by its FIRST span resolved to nothing at all,
  greying out the line-spacing menu on ordinary selections. Paragraph space
  before/after remains a paragraph property by design.
- [USER+CODE] Restored ranges convert both endpoints through
  `valueIndexForDisplayIndex`. `valueStart` covers real characters only, so a
  caret at a field's END indexed nothing and the restore paths defaulted its
  start to 0 and its end to the value length — bringing a caret at the end of a
  paragraph back as the whole paragraph SELECTED, even once the edit itself was
  correctly scoped to one line.
- [USER+CODE] The browser's native selection paint is suppressed for the whole
  editable document rather than only field spans, so engine-owned runs that
  belong to no field — the contact divider — stop painting a second darker veil
  of their own.
- [USER+CODE] Pointer selection begun off the text now works: any press that
  places the caret by hand (margins, before the first glyph, after the last, the
  gap between two fields on a row, a bullet marker) also starts the synthetic
  drag, which previously did not exist there because the prevented default had
  already removed the browser's own. Drag anchors snap to a field's outer edges
  instead of every inline-style span boundary, and move/release are tracked on
  the document with unrestricted line resolution so a drag survives leaving the
  sheet, the window, or the page. Focused evals cover the indentation
  arithmetic, the edge anchors, and the drag-versus-click line reach.
- [USER+CODE] The local data root is now `workspace/` in source development and
  packaged runs. Editable bases live in `resumes/<variant>.resume` and
  `cover-letters/<variant>.cover`; each folder owns its `.trash/` history. The
  server migrates recognized root-level prefixed files without overwriting a
  destination, while tracker, applications, preferences, and unrelated files
  remain at the workspace root.
- [USER+CODE] Cover-letter schema v2 adds an optional name/contact header and
  contact separator. Resume and cover-letter pages use the same header layout
  and editor control; v1 paragraph-only `.cover` files remain readable and are
  upgraded on save. AI tailoring replaces paragraphs without clearing the
  candidate-authored header.
- [USER+CODE] Resume and cover-letter Open menus now share “Current variant,”
  “Bundled starter,” “Variants,” empty-state, and history wording. Variant
  filenames no longer repeat their document kind because their containing
  folder and `.resume`/`.cover` extension already establish it.
- [USER+CODE] Shared page margins use the simple Narrow, Normal, and Custom UI:
  Narrow applies 0.5 inches all around, Normal applies 1 inch, and Custom
  remains per-side from 0.25 through 3 inches. Editable files persist only the
  resulting physical values, never the UI preset identity.
- [USER+CODE] Line height is visual-line scoped rather than document-global:
  a caret or partial selection expands to the painted line(s), while selecting
  the complete paragraph applies the value throughout it. The compact shared
  menu offers Single, 1.15, 1.5, Double, paragraph space before/after, and a
  focused Custom spacing modal. Paragraph before/after values remain
  paragraph properties.
- [USER+CODE] Up/Down caret movement uses the shared line-aware placement path,
  so placeholder-backed, whitespace-only, and consecutive blank lines remain
  reachable without browser hit testing escaping to an adjacent text line.
- [CODE] Current `.resume` saves use schema version 2 so physical page margins
  no longer carry a UI preset field. Version 1 files remain readable and
  migrate on the next save.
- [USER] The next desktop release should reflect a larger product step than the
  previously suggested 0.4.0, refresh the public landing page, and remove stale
  README and engineering-document references before publication.
- [CODE] RoleFit's source version is 0.5.0. The jump from 0.3.0 reflects the
  complete candidate-owned cover-letter document workflow, named resume and
  cover-letter variants and history, expanded shared-editor behavior,
  independent configuration for five AI stages, and the rebuilt application
  tracker. It remains below 1.0 while installers are unsigned and auto-update
  is out of scope.
- [CODE] The public landing page now presents RoleFit as an
  application-materials workbench, gives the cover-letter editor its own
  product surface, and uses fresh fictitious-data captures of the current
  companion, resume, cover-letter, tracker, menu, calendar, and application
  detail interfaces.
- [CODE] The versioned examples in the app README, desktop guide, development
  guide, and distribution plan now use 0.5.0. Historical 0.3.0 release notes
  and the documented 0.3.0 recovery lesson remain unchanged.
- [CODE] Portable backup schema version 1 still excludes standalone saved
  `cover-letter*.cover` variants and their history. The app README, backup
  contract, and 0.5.0 preview note now state that boundary and direct users to
  save `.cover` copies separately.
- [TOOL] Publication target is the curated unsigned preview
  `rolefit-preview-v0.5.0-beta.11`; the release is complete only after its
  native macOS and Windows jobs, installed lifecycle checks, checksum gate,
  GitHub prerelease publication, Pages deployment, and live download
  resolution all succeed.

## 2026-07-25

- [TOOL] CORRECTS the standing note that `vertical-parity.mjs` was "already red
  before this work". It is red on THIS BRANCH ONLY: `origin/main` is green on
  the same eval (last three runs successful), and PR #87's CI reproduces the
  failure as its single RoleFit failure. The eval predates main (`e6ce369`), so
  the divergence was introduced by this branch's engine work and has been
  carried forward, not inherited. Treat it as an open regression against main,
  not as a known-bad baseline.
- [USER] `entryEndIndentPt` is the ENTRY's right edge and applies to every row of
  the entry — head rows, bullets, summary paragraphs, skills rows. Deliberately
  NOT Jake, who insets only the head row's `tabular*{0.97\textwidth}` and leaves
  bullets on a plain `itemize` with no right margin. Jake is the style reference,
  not a specification to match exactly.
- [CODE] That application is unchanged from `main` and was never the problem. The
  real difference is the DEFAULT: `main` ships `entryEndIndentPt: 0`, and this
  branch raised it to 5.4 with the Jake-derived starter defaults. A non-zero
  inset narrows every body column by 5.4bp, which wraps one long bullet a word
  earlier than the frozen Tectonic fixture — compiled when the value was
  effectively 0. An earlier cut of this fix moved the inset off the body columns
  to chase the fixture; that was reverted as soon as the preference above was
  stated. Superseded: the note that the body columns were over-applying it.
- [TOOL] `vertical-parity.mjs` therefore sets `entryEndIndentPt: 0` inside its
  own `legacyStyle()`, beside the other legacy-era mappings. The fixture holds
  per-line `{p, y, x0}` and the probe is named for the VERTICAL model; zeroing a
  horizontal width policy the fixture predates keeps it measuring junctions
  rather than line breaking. A vertical regression still fails it. Green again:
  20 lines within ±1.5bp, RoleFit suite 47/48 with only the Windows-only
  `EPERM: symlink` probe red.
- [TOOL] PR #87 (`codex/wip-editor-document-actions` -> `main`) carries the whole
  branch. Its first CI run reproduced the parity failure as RoleFit's single
  red — Typeset green, and the Windows-only backup probe green on Linux, both as
  predicted.

- [USER+CODE] A TOO-LONG MENU no longer runs past the window and shifts the
  document. Reported as "not necessarily a bug"; it was one. Every popover's
  height cap was a viewport fraction assuming the panel starts just below the
  toolbar, so a trigger further down put the panel's end past the window — and
  an absolutely positioned descendant EXTENDS its scroll container's scrollable
  area, so the studio body silently became scrollable under it. Measured at a
  520px-tall window: Styles ran 34px past the bottom and `.studio-body`
  scrollHeight went 463 -> 498. `Popover` now measures the room under its
  trigger on open (and on resize) and publishes `--popover-space`; panels bound
  themselves by it, with a 160px floor. After: the panel ends 9px inside the
  window and scrollHeight is 463 again. At 900px nothing changes — the measured
  space (743) loses to the designed 650px cap.
- [CODE] A panel with its own scrolling body subtracts `--popover-frame` (2px,
  the surface's border) from that value. Without it the panel is exactly two
  pixels too tall for the border-box holding it, and the surface grows a SECOND
  scrollbar beside the body's own — measured before the fix.
- [CODE] REPORTED BUG, fixed: a popover opened from the collapsed toolbar's More
  panel painted OVER the panel. Below 900px the style popovers pin to a fixed
  slot under the toolbar (`top: 102px`) — which is exactly where the open More
  panel sits. Inside an open panel they now use anchored placement, with the
  trigger set `position: static` so the surface resolves against the PANEL: the
  panel wraps to two rows at ~430px, and anchoring to the button would have left
  a first-row popover covering the second row. Forced right-aligned, which
  cannot overflow — the panel is pinned 12px from the edge and these surfaces
  are at most `100vw - 24px` wide. Measured at 900px (panel 159–209, popover 213) and 430px with a wrapped panel (panel 159–247, popover 251).
- [USER] SMALL-CAPS HEADING WOBBLE is font overshoot plus pixel quantization at
  the rendered size, not a layout defect. Measured in LM Roman Caps 10: flat
  small caps have a cap height of 515.6/1000 em, round ones 531.3 — a 3%
  overshoot every serious typeface has. At a 16pt heading that is 8.25 device px
  of ink, which the rasterizer resolves to 8 or 9 whole pixels per glyph. The
  PDF is unaffected. The document now sets `text-rendering: geometricPrecision`
  (paint hint only; measured NO change to painted advances — the heading is
  84.125px either way), so whether it improves the appearance is UNCONFIRMED and
  needs the user's eyes; the QA pane cannot screenshot. The remaining lever is
  snapping each painted baseline to a whole device pixel on screen, which trades
  the documented DOM/PDF baseline agreement and has not been done.
- [USER] Returning to a document tab also restores the SCROLL OFFSET, not just
  the caret. `useRestoredScroll` holds it host-side beside the caret; opening a
  document resets both.
- [CODE] Two non-obvious constraints in that hook, both hit while building it:
  the offset cannot be applied on the first commit (the engine paints after
  layout, so the scroller has no scrollable height yet and the assignment
  silently clamps to 0 — it retries per render until the content is tall
  enough), and it cannot be read from a PASSIVE cleanup (a detached element
  reports `scrollTop` 0). A layout cleanup reading the element captured at mount
  is correct. A scroll listener was tried first and abandoned: it adds a handler
  on a hot path, and scroll events DO NOT FIRE AT ALL in the QA browser pane,
  which made the whole feature unverifiable there.
- [USER] Masthead menu panels (Sessions, Job) anchor to their OWN trigger's right
  edge instead of their group's left edge. The group anchoring existed to align
  the paired Resume/Job and AI provider/Options menus under one another; both
  pairs are gone, and with the surviving controls at the right of the bar a
  380px left-anchored panel ran past the window and was left pressed against the
  edge by the viewport clamp. Measured at 1280px: the Job panel's right edge now
  meets its trigger's, 132px clear of the window.
- [CODE] The clamp had to change with it. A `position: absolute` box offset by
  `right` has an AUTO `left`, which absorbs a `margin-left` and moves nothing —
  the old nudge was silently dead under right anchoring (measured: margin
  applied, rect unchanged). It uses `margin-right` now, and handles left
  overflow, which is the direction a right-anchored panel overflows. Verified at
  420px: the Job panel lands at left 8 instead of -19.7.
- [USER] A document page ALWAYS has a caret. Opening a document puts it at the
  first line and takes focus, and so does arriving at the page for the first
  time; RETURNING to the Resume or Cover letter tab resumes the caret you left
  there.
- [CODE] The first-visit rule was the missing half, reported from the running
  app: the Cover letter tab painted with NO focus and no caret, because its
  blank letter is `useState` initial data rather than a load, so no open path
  ever ran for it. A mount with no stored caret now starts at the document
  start, and a stored caret whose field is gone falls back there instead of
  leaving the page caretless. Re-homing on every tab switch was rejected: it discards your place, and
  the resume's "start" is the NAME field, where one stray keystroke edits the
  most conspicuous line in the document. A tailored AI result does not take
  focus — it lands while you are reading the review.
- [CODE] The studio tabs UNMOUNT the editor, so a returning caret cannot live in
  the editor. `TypesetEditor` gained `initialCaret`/`onCaretExit` (a
  `TypesetCaret` = field key + VALUE index, which survives the repaint) and the
  host holds one per document. `focusDocumentStart()` is the open-time entry
  point; it records the request and forces a paint instead of placing
  immediately, because a host calls it one tick BEFORE the new data is painted —
  placing then would place the caret in the outgoing document. Neither may
  return early from the restore effect, which also reopens the commit gate.
- [CODE] An open never steals focus from a text field outside the editor. The
  workspace load resolves whenever the server answers, which can land while the
  user is typing the job description; buttons and the page background are fair
  game, an input/textarea/select is not, and the caret is still placed so the
  next Tab lands there. Verified live both ways.
- [CODE] No open site has to remember any of this: App wraps `seed`/`seedData`
  before they reach `useWorkspaceResume`, and `useCoverLetterEditor` routes its
  user-initiated loads through one `openDocument`. The tailored-result path
  still calls `seedData` directly, which is the whole distinction.
- [TOOL] Live QA in a FRESH tab (an HMR session that hot-swaps hooks reports
  hook-order and dep-size errors and an App crash that the error boundary
  recovers — artifacts, not defects; a reloaded tab has a clean console): boot
  load focused the resume at `name`/0; a caret at `contact|1`/4 survived a
  round trip through another tab; the guided starter opened focused at `[Date]`;
  Blank opened with the title input focused left focus there and still placed
  the caret; typing and undo still commit. One test artifact worth knowing:
  the caret is recorded on `selectionchange`, which is ASYNC, so placing a
  selection and unmounting in the same tick loses it.
- [USER] The caret LEANS with italic text. It is sheared by the active face's
  own `post.italicAngle` (Carlito -7°, Source Sans 3 -11°, Source Serif 4 and
  Arimo -12°, Latin Modern -14.036°, Tinos -16.333°) about the baseline it
  already reports, so its position at the insertion point is unchanged and only
  its slope moves. Arming italic with a collapsed caret leans it before the
  first character is typed, and a caret placed inside existing italic text leans
  from the text it sits in.
- [CODE] That angle is the ONE font fact `fontRegistry.ts` writes by hand:
  `metrics.gen.ts` does not carry it, regenerating it needs the pinned Python
  toolchain, and the browser cannot report it. `font-assets.mjs` therefore reads
  `post.italicAngle` out of each shipped sfnt sibling and fails on any drift; a
  `FaceAsset` union makes the italic flag and the angle inseparable. Negative-
  tested by declaring a wrong angle.
- [CODE] `sameCaretGeometry` compared position only, so the first cut painted no
  slant at all: a family's upright and italic faces share vertical metrics, so
  arming italic produced an identical box and the memoized upright geometry was
  kept. It compares slope and baseline offset now.
- [USER] Font menu order is recognition first — Tinos (Times New Roman), Carlito
  (Calibri), Arimo (Arial), then Source Serif 4, Source Sans 3, Latin Modern.
  The families a posting or a career office names by name lead; the house faces
  follow. Order is presentation only; the persisted ids did not move.
- [USER] A NEW cover letter now starts in Carlito, not Source Serif 4 — a cover
  letter is business correspondence and Calibri is what business correspondence
  is written in, with metrics that survive a reader opening it in Word. The
  resume default stays Latin Modern. Existing letters are unaffected: the style
  is persisted per browser (`rolefit:coverLetterStyle.v1`) and only an absent
  key falls back to the default.
- [TOOL] `cover-letter-file-v1.mjs` asserted a soft wrap as the fixed pair
  `[" ", ""]`, which is a property of the DEFAULT FAMILY'S ADVANCES — the
  fixture wrapped in Source Serif and fits one line in Carlito. It now asserts
  the separator SHAPE over however many lines the family produces.
- [TOOL] Adding font families is BLOCKED on this machine: no Python is
  installed, and `scripts/generate_font_assets.py` needs Python 3.9+ with
  fonttools 4.60.2 / brotli 1.2.0 plus network access to the digest-pinned
  sources. The natural next candidates are Gelasio (Georgia metrics) and Caladea
  (Cambria metrics), both open and metric-compatible with faces resumes are
  asked for. UNCONFIRMED whether either ships usable italic/caps lookups.
- [TOOL] Verified: engine, editor, and Typeset checks green; RoleFit offline
  suite 46/47 with the two already-recorded reds (`vertical-parity.mjs` fixture
  divergence, `workspace-backup-probes.mjs` Windows `EPERM: symlink`). Live QA
  on the running dev server read the caret's computed transform: upright when
  italic is off, `skewX(-7deg)` on a Carlito cover letter, `skewX(-14.036deg)`
  on a Latin Modern resume both armed and inside existing italic text; menu
  order and the Carlito cover-letter default confirmed; console clean. No
  screenshot: the QA pane was not displayed, so it composites no frames.
- [CODE] AUDIT of the cover-letter workspace slice found three real defects, all
  now fixed and locked by evals:
  1. `variant` is a LABEL the server slugs; `fileName` is a name it only
     validates. The client sent the ACTIVE FILE NAME as `variant`, so "Update
     Growth" re-slugged it and wrote
     `cover-letter-cover-letter-growth-cover.cover` — a mangled duplicate instead
     of an update. Silent: it returned 200 and listed the new file.
  2. The Open menu's saved list called the workspace loaders directly, discarding
     unsaved edits with NO confirm, while Blank/Starter/file-picker all asked and
     the resume's equivalents both call `confirmReplaceEditor`. Now routed through
     `openSaved`/`restoreSaved`.
  3. `activeCoverFileName` survived Blank, Starter, and an uploaded `.cover`, so
     Save still offered "Update <that letter>" and would have overwritten an
     unrelated saved letter with the new document. All three reset it now.
- [CODE] Audit cleanups: `formatHistoryDate` was copied into App and the cover
  toolbar (now `src/lib/historyDate.ts`); `ExportMenu` returned an empty wrapper
  when idle, consuming a flex gap in the action bar, and now returns null.
- [CODE] A11y REGRESSION from the shared Open menu, now fixed: every saved-row
  action rendered as a bare "Open"/"Restore", so a screen-reader button list read
  as identical controls. The `ResumeMenu` it replaced carried
  `title="Load <file>"` / `"Restore <name> from <date>"`, so context was LOST in
  the rewrite. Each row action now has an aria-label naming its document, and
  `SettingsStage`'s "Check providers" (one per blocked stage) names its stage.
  UNVERIFIED LIVE: the populated saved list still has no data in this workspace,
  so only the static expression is confirmed.
- [USER] Menu rows carry a description only when the title is not enough, so
  `description` is optional on both menu action types. Downloads whose title names
  the format (.resume, .cover, PDF) have none; ".txt — content only, no
  formatting" keeps one because it must be told apart from .cover.
- [CODE] The bulk at the bottom of the resume Save menu was `workspaceStatus`
  holding a permanent instructional sentence ("Local workspace ready. Save a base
  resume to use it automatically on startup.") — 48px of in-product manual, which
  `ui-principles.md` already forbids, restating what that menu's own "Save as
  default base" row says at the point of action. `useWorkspaceResume` no longer
  sets it; real save feedback and errors still flow through the same status.
  Resume Save measured 388px -> 297px.
- [USER] The cover letter's PDF export now opens the SAME rename prompt as the
  resume — a PDF is the file you send, so its name is worth confirming for both.
  `downloadPdf` takes an optional base name and `ExportMenu` (dialog only since
  its trigger moved into Save) is mounted in the cover toolbar too.
- [USER] Cover letters now have NAMED VARIANTS and version history, the same as
  base resumes. This needed new storage, not just UI: `server/coverLetterWorkspace.ts`
  stores `cover-letter*.cover` beside `base-resume*.resume`, with
  `/api/workspace/cover-letter`, `/cover-letter/select`, and `/cover-letter/restore`,
  and its snapshot fields ride along on `GET /api/workspace` so one fetch seeds
  both editors. Supersedes the 2026-07-25 note that cover letters are never
  written to the workspace.
- [CODE] That module is a SIBLING of `workspace.ts`, not a generalization of it:
  it imports the storage primitives (lock, atomic write, trash stamping, listing)
  and reimplements only the parts that differ — one extension instead of four, no
  plain-text import path, no bundled-starter fallback. Parameterizing the
  battle-tested base-resume path for a simpler document would have complicated it
  for both.
- [CODE] `workspace.ts` imports `coverLetterWorkspace.ts` and vice versa. The
  cover module therefore reads NO top-level binding from `workspace.ts` during
  evaluation — an earlier cut held `jobWorkspaceDir` in a module-level const,
  which is a TDZ ReferenceError at import time depending on load order. Both
  import orders are now proven to resolve at runtime, not just to typecheck.
- [CODE] Save is one shared `DocumentSaveMenu` for both documents: update the
  active workspace copy, save a named variant, then the downloads. PDF moved in as
  a download row, so both bars are Open/Save/Polish. `ExportMenu` kept the rename
  dialog and status but lost its trigger — it is controlled by `promptOpen` now,
  because the dialog cannot live inside a popover that closes when it opens.
- [TOOL] The new routes are proven by an HTTP round-trip probe
  (`server/__evals__/cover-letter-workspace-probes.mjs`): save → archive on
  overwrite → select → restore, plus traversal keys, a resume payload rejected by
  the cover validator, and an oversized body. They could NOT be verified in the
  running app: port 5181 is the Electron companion's server process, started
  before these changes, so it serves the old routes. A client reload picks up the
  UI but not the server — restart the companion to exercise variants end to end.
- [USER] The Starter button is GONE from both action bars; starting a document and
  reopening a saved one are the same decision, so both live in Open. Resume and
  cover letter now share ONE `DocumentOpenMenu`, grown from the cover letter's
  menu shape: a heading, the start actions (bundled starter / blank / choose a
  file), then the documents already saved in the workspace. `ResumeMenu.tsx` is
  deleted along with 169 lines of its bespoke CSS. Both bars are now
  Open/Save/PDF/Polish.
- [CODE] `DocumentOpenMenu` takes declarative `actions` and `saved.groups`; an
  action resolving `false` keeps the menu OPEN, which preserves the cover
  letter's behavior of not dismissing your choice when you cancel the
  "Replace cover letter?" confirm.
- [CODE] SUPERSEDED the same day by the cover-letter workspace store above. The
  saved list was briefly empty for cover letters because they were download-only;
  `saveCoverFile` now remains as the "take a file away" download beside the
  workspace save.
- [CODE] `activeBaseResumeLabel` is derived once in App; the Open menu's
  description and the Save menu's "update this base" row both name it, and it was
  being recomputed inline at each call site.
- [USER] All preferences live in ONE Settings dialog, opened from the foot of the
  studio tab rail. Its three sections are AI stages, About you, and Guidance,
  with Reset and Done in the dialog footer. The masthead's "AI provider and
  model" and "Options" menus are DELETED (`AiMenu.tsx`, `PolishMenu.tsx`),
  leaving Sessions, Job target, and Apply. A
  modal with a section nav was chosen over a taller anchored popover because five
  provider blocks plus demographics plus four free-text fields do not fit the
  NavMenu pattern.
- [CODE] `src/config/aiStages.ts` is the single declaration of a configurable AI
  stage. `StageId`, the persisted key triples, the settings seeder, the Copy
  settings control, and the Settings dialog all derive from it. This was several
  hand-maintained lists, and the failure mode is silent: the cover-letter and Q&A
  flows were BOTH hardcoded to `stages.tailor` while looking configurable. Both now
  have their own provider/model/effort.
- [CODE] Cover/answers INHERIT Tailor's config when they have none of their own, so
  an install predating the split keeps the provider it was already using. That
  inheritance lives in the new pure `src/lib/stageSettings.ts` seeder, NOT in
  `normalizeSettings`. Putting it there first was a real regression caught by
  `workspace-backup-contract-eval`: that contract accepts a restored settings bag
  only if it round-trips through `normalizeSettings` unchanged, so an additive
  migration rejects every backup written before the key existed. `normalizeSettings`
  may repair and remove; it must never add. The seeder is a pure module purely so
  `stage-settings-eval.mjs` can cover the inheritance without React.
- [CODE] `buildCandidateFactsContext` gates education POSITIVELY (on a known level
  producing a line) rather than on `!== "unspecified"`. Stricter than the
  citizenship gate, and it cannot crash on an absent level the way the first cut
  did — an undefined level entered the block and dereferenced `facts.major`.
- [CODE+USER] Custom instructions are per stage over a shared default: a stage
  with non-blank override text sends it, otherwise it sends the shared box. The
  polish pipeline's `commonBody` no longer carries `customInstructions` — Tailor
  and Review are separate requests, so a shared string sent Review the Tailor
  guidance. An emptied override is DELETED from storage rather than saved as "",
  so blank and absent cannot diverge.
- [USER] Settings > About you adds education level and field of study to the
  candidate facts. `buildCandidateFactsContext` no longer returns early when
  citizenship is unspecified: citizenship gates the work-authorization lines,
  education level gates the field of study, and the two are independent opt-ins.
  Every field still emits nothing until declared, which matters because that
  string becomes the keyword-grounding allowlist — an unset default must never let
  an undeclared citizenship, clearance, or DEGREE become groundable resume wording.
- [USER] The resume Polish action ASKS which stages to run (Tailor and review /
  Tailor only / Review only) and remembers the pick; Settings holds the same value
  as an editable default. `polishStages` stays the one owner, so the chooser SETS
  it and the run starts on the NEXT render. That two-step is required, not
  stylistic: `polishStages` is in the pipeline's input fingerprint and the
  fingerprint effect aborts any in-flight run when it changes, so starting the run
  in the same tick as the setState aborts the run it just started.
- [CODE] The Polish trigger now gates on inputs only (`polishInputsReady`) and each
  stage row gates on its own provider, because one trigger cannot be gated by a
  choice the user has not made yet. `buildPolishContext` requires an editable
  Tailor scope for every selection including Review-only, so the input gate is
  unchanged.
- [USER] Cover letter matches the resume: its action bar says Polish (not Tailor),
  the "Plain correspondence document" context label is gone, and the page header
  is flat and the same fill as the resume header. Two separate causes —
  `.studio-card--flush` kept a 10px radius that only ever CLIPPED content, which
  the Cover letter page's `overflow: hidden` turned into rounded top corners the
  Resume page never showed; and `.cover-letter-tab__toolbar` overrode the primary
  row to `--card-elev`, a shade lighter than the shared `--card`.
- [USER] Settings shows NO runtime diagnostics. The local-server address,
  workspace path, and provider counts belong to RoleFit Companion — they describe
  the machine the companion runs, not a browser preference. The per-stage
  readiness list went with them: it restated each stage row, which already shows a
  blocked provider beside the control that fixes it. `workspacePath` is off the
  `useWorkspaceResume` surface again.
- [USER] That left "Advanced" holding only a reset button, and a nav entry leading
  to a near-empty panel is worse than no entry. Reset is now pinned at the FOOT OF
  THE SECTION RAIL — an action rather than a section, reachable from whichever
  section is open, and the same shape as Settings sitting at the foot of the
  studio rail that opens the dialog. The nav is exactly the three real preference
  groups. No copy was lost: the confirm dialog already carried the full "what this
  clears" explanation. A full-width dialog footer was tried first and read as a
  detached bar under the content; it also cost the panel 51px of height. The
  autosave note ("Changes save as you make them") moved to the dialog header,
  where it answers the missing-Save-button question without a bar of its own.
- [USER] Copy pass over the settings surfaces. Fixed: "Legally authorized to work
  in U.S." (missing article), "Nothing here reaches the model until you set it"
  (no singular antecedent), "A stage with its own instructions in AI stages"
  (location phrase mid-sentence), "Polish runs" (reads as a verb) -> "Default
  Polish stages", and a Reset section whose intro and hint restated each other.
  The per-stage toggle is now "Add instructions" / "Edit instructions" instead of
  two different phrasings both ending in "for this stage".
- [USER] The first cut of Settings > AI stages was bulky and sloppy. Measured:
  each stage was a bordered card INSIDE another bordered card at 317px tall, five
  of them in a 625px panel (2.85x scroll), each with an always-open instruction
  textarea for an optional override. Card-in-card is explicitly rejected by the
  Drafting Desk and I introduced it. Rebuilt as frameless hairline-separated rows
  with the override disclosed: 139px per stage, 1.39x scroll, zero bordered
  descendants. `ProviderSection.tsx` and `MenuSection.tsx` are replaced by
  `SettingsStage.tsx`, and their popover-era CSS (147 lines sized for a 380px
  menu, not an 860px dialog) is deleted.
- [CODE] A collapsed-but-set instruction override renders a two-line clamped
  preview. Guidance that is actually being sent to a provider must never be
  invisible; the disclose label also switches from "Add instructions" to
  "Edit instructions".
- [USER] Stage copy is shorter and free of internal jargon — "Owns the fit score,
  gaps, and verdict" became "Audits your draft like a recruiter and scores the
  fit", and the awkward stage-instruction interpolation is gone. The
  cover stage is titled "Cover letter", not "Cover letter tailor".
- [CODE] Settings' reset clears stored preferences and reseeds in-memory state
  from defaults behind a danger confirm. The debounced auto-save then rewrites the
  defaults, so the storage key returns immediately — that is fine because
  `hasStoredSettings()` is only consulted at boot by `browserPrefsSync`. Documents
  and tracked applications are untouched.
- [TOOL] `requestAnimationFrame` NEVER FIRES in the QA browser pane when the pane
  is not displayed (proven: a scheduled callback had not run across two tool
  calls). `useModalFocus` and `Popover` both place initial focus in a rAF, so
  initial-focus and focus-restore behavior is UNVERIFIABLE there and reads as
  "focus stayed on body". Modal stacking and hit-testing still verify normally —
  the reset confirm was measured painting above the Settings dialog and
  hit-testable. Do not report a rAF-driven focus contract as verified from that
  pane.
- [TOOL] `client-workflow-guards.mjs` counts its own assertions now (93) instead
  of printing a hand-maintained total that had already drifted.
- [TOOL] RoleFit offline suite is 45/47. The two reds are unrelated and both
  pre-existing: `vertical-parity.mjs` (recorded fixture divergence) and
  `workspace-backup-probes.mjs`, which fails on this machine with
  `EPERM: symlink` — Windows needs elevation or Developer Mode for `fs.symlink`,
  and the probe dies in a temp directory before touching product code.
- [USER] Selected-paragraph alignment is ONE trigger with a labelled menu, not
  four buttons. `AlignmentControl` shows the active alignment on the trigger, so
  the collapsed control still reports state. It reclaims ~97px of a 48px row and
  therefore survives three stages further down the responsive ladder. Opening it
  moves focus off the document exactly as the link editor does; that is safe
  because `commandTarget()` falls back to the last recorded selection.
- [USER] RoleFit's formatting-row menus are ICON-ONLY at every width. The host
  seam inverted: `data-toolbar-labels` now takes `"icon"` (RoleFit sets it on both
  editor toolbars) and the old `"text"` label-first bands — including the
  1190.01–1210px interlock and the 900px structure-label exception — are deleted.
  Typeset never sets the attribute and keeps its labels-until-1210px default, so
  its documented desktop appearance is unchanged. Header/Section keep their icons
  now; the seam previously hid them.
- [CODE] The formatting row was CLIPPED, not scrolled, between 1041 and 1080px of
  container width: measured 33px of overflow at 1041 with `studio-body`'s
  `overflow-x: hidden` swallowing it, so Page silently lost its right edge. The
  band existed because the default label collapse fired at 1210 while the More
  overlay only engaged at 1040, and RoleFit's label-first seam kept Header and
  Section wide in between.
- [CODE] The disclosure ladder is now four measured stages on container width —
  style menus at 920, selection typography at 740, alignment at 520, then clear
  formatting + spell check at 460 (which also tightens group spacing). Each
  threshold is the intrinsic width of the set still inline above it, so no width
  leaves a control half-painted. Clear formatting and spell check gain duplicate
  mounts in the overlay rather than being dropped; `LinkControl` deliberately does
  NOT get one, because its `open` state is host-controlled and two mounts would
  both open. Measured with a per-descendant right-edge sweep: RoleFit resume and
  cover letter fit 1140→355px and Typeset fits 1440→355px (formatting row) and
  →365px (primary row), against a documented 400px floor.
- [CODE] `.toolbar-button--icon:has(.toolbar-button__trailing)` un-squares a
  label-less button that still carries a disclosure chevron; the 32px icon box
  crushed the alignment trigger's two glyphs. `.font-family-control` is 112px
  (was 128px); its menu is still content-sized, so no name truncates further.
- [CODE] The clear-formatting tooltip printed `⌘\\`. A JSX attribute string does
  not process escapes, so the shortcut is now an expression constant.
- [TOOL] Verified `@typeset/editor` checks (typecheck + 3 evals), both app
  production builds, and live browser QA on RoleFit resume/cover letter and
  Typeset: all four ladder stages move the right controls into the overlay, the
  overlay stays inside the toolbar and wraps at the narrow edge, an icon-only
  Spacing trigger still opens its popover, and applying Center from the alignment
  menu moved the paragraph and undid in one step with the trigger label following.
  RoleFit's offline suite is 44/46: `vertical-parity.mjs` remains the already
  recorded fixture divergence, and `workspace-backup-probes.mjs` fails on this
  machine with `EPERM: symlink` (Windows needs elevation or Developer Mode for
  `fs.symlink`) — an environment limitation, not a code regression.
- [USER] The hyperlink overlay is driven by the CARET and SELECTION, not by hover:
  it shows when the caret is inside a hyperlink or hyperlinked text is selected.
  The "Detected" badge is gone. Hover was wrong for an editor — it fires while
  reading rather than acting, no keyboard user can reach it, and it competes with
  selection dragging for the pointer.
- [CODE] ROOT CAUSE of the reported caret bug: `autoLinkSuppress` stored a
  SNAPSHOT of the field value, and `renderData` composed fresh data with it, so the
  repaint after every keystroke inside a URL painted pre-edit text — one character
  short. `displayIndexToCaret` then clamped the restore to the end of that shorter
  text, so the caret landed one back. That moved it off the word's trailing edge,
  which cleared the deferral and linked the URL mid-typing, and the next space then
  landed INSIDE the URL: typing `example.com` left the caret before the `m`, and the
  following space produced `example.co m` linked as `example.co`. State now holds a
  display RANGE and `suppressedAutoLinkValue` derives the paint from the current
  value every render, so the paint can never lag the data. Reproduced in the
  browser and proven offline before and after; the offline eval sweeps every prefix
  of `"example.com "` and asserts the paint's display equals the current value.
  The bug needed a repaint between keystrokes, so it appeared at human typing speed
  and NOT under machine-speed synthetic typing.
- [CODE] Link state is not inherited like character formatting. `applyEdit`
  inherited `linkHref` and `linkSuppressed` from the character to the left, so
  typing after a link swallowed the rest of the sentence into it and `<nolink>`
  leaked into everything typed after a de-linked URL, permanently killing
  auto-linking there. Both are now inherited only when the insertion point is
  strictly inside one run.
- [CODE] `expandToLinkRun` expanded from the selection's own bounds, so a selection
  touching two links returned a range labelled with the first href but reaching into
  the second — Remove and Apply then rewrote the neighbouring link's text. It now
  expands only across one href's contiguous run; a crossing selection resolves to
  the first link. Removing BOTH links from one crossing selection would need a
  multi-run command and is not implemented.
- [CODE] `trailingLinkWordAt` deferred explicit links too, so a real hyperlink
  visibly lost its anchor whenever the caret rested at its end. Only automatic links
  are deferred.
- [CODE] `automaticLinkHref` linked bare filenames: `resume.pdf` became
  `https://resume.pdf`, which a resume triggers constantly. The existing code-suffix
  denylist is now a general file-suffix denylist. It stays a denylist of extensions
  rather than an allowlist of TLDs because a real public-suffix list is too large to
  bundle, and denying an extension only costs a link the user can still add
  explicitly while allowing one silently ships a broken destination. Suffixes that
  are also TLDs people type bare (io, co, dev, app) are deliberately excluded.
- [CODE] The cover letter never received `onRequestLinkEditor`, so the menu's
  "Edit link"/"Add link" and the card's Edit were silent no-ops — a regression from
  giving it the context menu while its link-popover state stayed private to its
  toolbar. The state is lifted to `CoverLetterTab`.
- [CODE] Editor overlays are wrapper-relative siblings inside `.typeset-editor`,
  not viewport-fixed portals. The card was `position: fixed` on a one-shot rect and
  detached from its link on scroll (measured: link moved 150px, card moved 0). Scroll
  events are paint-gated and could not be observed at all in the QA pane, so a
  scroll listener was unverifiable; wrapper-relative geometry needs none.
- [TOOL] A hook returning a fresh object each render, consumed by an effect that
  writes state, is an infinite render loop ("Maximum update depth exceeded"). Found
  in the first cut of the selection-driven card. Destructure the hook's stable
  callbacks and make every repeatable state write identity-stable.
- [TOOL] An adversarial multi-agent audit of the link/caret pipeline independently
  confirmed the root cause from three directions and surfaced further defects that
  are CONFIRMED BUT NOT YET FIXED: PDF link annotations are emitted per run so
  interior spaces of a multi-word link are unclickable while the DOM paints one
  continuous anchor; a justified line that stretches past the 1.75x space-join bound
  splits a linked phrase into one anchor and one underline per word; the engine
  auto-links the raw field VALUE while the editor auto-links the ligature-transformed
  DISPLAY string; the engine auto-links name/heading/entry-head/contact fields per
  WHOLE FIELD while the editor works per word; `End`/`Shift+End` cannot reach a
  field's authored trailing spaces; the replay queue stalls when a drained intent
  commits nothing; and RoleFit's right-click menu resolves `position: fixed` against
  the editor scroller rather than the viewport.
- [USER] Resume and Cover letter now use matched document action bars above the
  formatting toolbar. Resume owns Starter, Open, Save, PDF, and Polish there;
  Cover letter owns Starter, Open, Save, PDF, optional Restore source, and Tailor.
  The masthead no longer owns Resume or Polish, and Cover letter no longer shows
  Copy.
- [CODE] `DocumentActionMenu` is the shared RoleFit disclosure shell. Resume Open
  carries base variants, Recent history, and file upload without the old
  Save/Reload/Remove cluster. Resume Save separates updating the active base,
  saving a named `base-resume-<variant>.resume`, and downloading `.resume`.
  Cover Save separates `.cover` from a plain-text copy. The workspace snapshot
  now exposes the bundled starter independently of the active saved base so the
  Starter action never needs to overwrite or disguise that base.
- [CODE] RoleFit injects `DocumentStructureControls` through the shared
  `FormattingToolbar.documentStructureTools` seam, placing Header and Section
  immediately before Spacing. At narrow widths that same order moves into More;
  standalone Typeset keeps its existing DocumentToolbar placement.
- [TOOL] Verified `@typeset/editor` checks, RoleFit production build, focused
  workspace persistence/lifecycle probes, and all desktop contract probes. Live
  browser QA at 1440, 1280, 1000, and 820px confirmed the action order, Open/Save
  surfaces, both starters, responsive disclosure, absent Cover Copy, and a clean
  console. The RoleFit offline suite remains 45/46 because the already-recorded
  `vertical-parity.mjs` fixture divergence is still red and unrelated.

## 2026-07-24

- [USER] Before requested pushes, review and update affected README and
  documentation; commit compact, privacy-safe continuity with the behavior
  slice. Version changes also update canonical/user-facing versions and require
  a triggered, successfully completed matching release/publish workflow before
  the versioned change is complete.
- [TOOL] Local `main` was fast-forwarded to `origin/main` at `58fcf3f`
  (`Harden AI workflows and refresh application tracker`) before the current
  cover-letter work began.
- [USER] Cover letters are moving out of Materials into a dedicated editor page.
  The workflow starts from the user's own written letter and tailors it against
  the job description and truthful candidate evidence; it does not generate a
  new letter from nothing.
- [USER] Cover-letter presentation is a plain correspondence document: one text
  column and paragraphs, without resume sections, rules, columns, or bullets.
- [USER] The cover-letter page uses the same document and formatting toolbar
  family as the resume editor, but it must not expose resume-specific structure,
  heading, entry-indent, or resume-spacing settings.
- [CODE] The portable editable cover-letter format is `.cover`, with magic
  `typeset-cover-letter` and schema version 1. `.resume` remains resume-only,
  while `.rolefit-backup` remains the product-level workspace backup format.
- [CODE] `@typeset/engine` owns the shared measurement, line breaking,
  pagination, font, DOM/PDF painting, and strict portable-file primitives.
  Cover-letter paragraph composition is a separate engine adapter. RoleFit owns
  job/provider orchestration, source-letter intake, tailoring, and review UX.
- [CODE] `FormattingToolbar.documentStyleTools` is the narrow host seam for a
  non-resume document grammar. RoleFit replaces the default resume style menus
  with a focused line-height popover plus the shared page-margin popover; the
  shared history, zoom, selection formatting, alignment, link, and spell-check
  controls remain unchanged for both document types.
- [USER] Direct editing uses word-processor behavior across both document
  layouts: prose Tab/Shift+Tab indent and outdent by one tab stop (superseding
  the earlier focus-escape Shift+Tab), copy/paste retains supported inline
  formatting, mixed font-family selections leave the family control blank, and
  Ctrl/Cmd +/-/0 controls document zoom.
- [USER] Mixed font-family and font-size selections leave both toolbar controls
  blank. Custom typed inline sizes clamp to 1–200 pt without changing the
  curated preset dropdown. Selection highlighting spans the full engine-line
  height determined by its largest inline run.
- [USER] The cover-letter page always presents an editor. With no uploaded,
  restored, or authored base, it starts as a clean blank paragraph; opening a
  source remains optional.
- [CODE] Empty engine paragraphs paint a DOM-only zero-width caret target that
  selection mapping and clipboard handling exclude from document content, so a
  blank cover letter remains immediately editable.
- [USER] Fresh starter resumes, New, and Reset use the canonical Jake-derived
  defaults, including the 10.8 pt start indent and 5.4 pt end indent implied by
  Jake's 0.15 in list plus 0.97-text-width entry rows.
- [USER] The bundled RoleFit starter is the serialized canonical starter, so
  its title, subtitle, and skill-label marks already match Reset text
  formatting instead of changing appearance the first time Reset is used.
- [USER] A collapsed editor caret follows the active next-typing family, face,
  and size and remains visible while toolbar settings own focus. The engine
  wraps otherwise-unbreakable oversized tokens at measured grapheme boundaries
  instead of allowing them to overflow the page; inline font, size, and mark
  boundaries within the token do not create early line breaks. A grapheme that
  cannot fit the current remainder moves intact to the next line, preventing
  single-character formatting runs from oscillating as the user types.
- [USER] Committing a font-family or font-size selection returns keyboard focus
  from the toolbar control to the saved document caret or text range.
- [CODE] Mixed families and sizes remain independent runs on one line. All runs
  share one engine baseline; the DOM painter measures the browser's real CSS
  baseline per bundled face, and pagination expands calibrated line junctions
  for oversized inline ink so adjacent lines cannot collide.
- [ASSUMPTION] A separate AI review pass is not required for the first
  cover-letter editor slice. The product keeps the pre-tailoring source
  recoverable and presents deterministic human-review checks; this decision may
  be revisited with quality evidence.
- [USER] The editor follows word-processor behavior (Word, Google Docs, Pages)
  wherever the two models disagree. Vertical placement therefore depends on the
  fonts and sizes on a line, never on which glyphs were typed: `VLine` carries
  its role-size ink footprint plus `riseOverflow`/`dropOverflow` derived from the
  new `faceExtent`, and pagination adds only that overflow to a calibrated
  junction. Previously the page-top inset and the junction expansion read typed
  ink, so typing a taller letter at a larger inline size moved the line. All-
  nominal rows keep their calibrated distances exactly; `inkExtent` stays only
  for the TeX-calibrated entry title/subtitle strut.
- [CODE] A cleared section heading no longer opens extra space. Its injected
  space measured as zero nominal ink against a full-height row, which added the
  whole heading footprint to both adjacent junctions.
- [CODE+USER] Underline and link rules now come from `underlineSpans` plus a
  face-derived `underlineRule(style)`, superseding the 2026-07-11 per-content
  TeX `\underline` depth. That depth made the rule step between two links in one
  paragraph, and because the DOM painter measures merged style spans while the
  PDF emitter walks single runs, an underlined phrase drew one continuous rule on
  screen and one broken rule per word in the exported PDF.
- [CODE] Enter in a prose paragraph always starts a new paragraph, including from
  an empty one; bullet and skills rows keep the non-empty-only rule. Cover-letter
  authors could not open a blank line between blocks.
- [CODE] Cover-letter New restores the blank document's saved fingerprint, so a
  fresh blank letter is not reported as unsaved.
- [CODE] Bold/italic/underline with a collapsed caret arm the next-typing format.
  Only the toolbar buttons did; the keyboard shortcut and the browser's
  `formatBold`/`formatItalic`/`formatUnderline` intents reached a commit that
  returned early on a collapsed selection. All three now share one path.
- [CODE] Selection rectangles are bounded by each line's painted text. The line
  block spans the whole sheet and a browser stretches mid-selection fragment
  rects to their containing block, so Select All highlighted the page margins
  (measured: 0→815 px across an 816 px sheet). A selected empty paragraph keeps a
  short stub instead of vanishing from the highlight.
- [CODE] Selections that cross field boundaries are editable. `readSelection`
  returns null unless both endpoints map to one field, so Select All silently
  disabled delete, typing, formatting, and the whole toolbar. The new
  `multiFieldSelection.ts` resolves the covered fields and their display ranges,
  and a `batch` reducer action plus `applyFieldEdits` lands the whole change as
  one undo step. Cross-field deletion removes emptied prose paragraphs and
  bullet rows, joins the boundary remainders inside one list, keeps at least one
  row per covered list, and never removes a name, contact, heading, entry-head,
  or skills slot — those belong to the structure controls. Link commands stay
  single-field.
- [CODE] Cross-field resolution reads only document order plus the range's two
  endpoints; it no longer asks `Selection.containsNode` per span. A DOM selection
  is one contiguous range, so the fields it touches are a contiguous slice, and
  the endpoint-only form behaves the same whichever way an engine shapes a
  select-all range (Blink puts the boundaries in the first/last text nodes, Gecko
  can put them on the editing host with child offsets). An endpoint that resolves
  to no field means "from the start"/"to the end". Multiple ranges (Gecko-only)
  span first-start to last-end. A single covered field is allowed, so a
  one-paragraph Select All whose endpoints do not resolve still edits.
- [CODE+USER] Painted lines end with the separator their break stood for (a space
  inside one field, a newline between fields), marked `data-tsds` and rendered
  contentEditable=false inside the font-size-0 line box, so it is invisible and
  zero-width. Without it the browser's word iterator ran the last word of a line
  into the first word of the next: a double-click on the last word of a paragraph
  selected across the break ("gammaDelta"). `lineSeparators` lives in `layout.ts`
  (React-free, testable); caret placement, line-edge movement, and the selection
  rectangle exclude the span.
- [CODE] A range boundary that names no field is resolved by DOCUMENT POSITION,
  not by assuming the document's first or last field. A triple-click ends on a
  line container, so the old assumption made a one-paragraph selection report —
  and copy — the whole document.
- [CODE] Cross-field copy writes plain text from the model, one covered slice per
  field joined by newlines. The DOM-derived path lost paragraph breaks and could
  leak the caret placeholder; the model path also keeps an authored hard break's
  real newline, which the layout separator deliberately does not distinguish.
- [USER] Linking and pasting must work on a multi-paragraph selection. A
  cross-field selection now links every covered range in place, with the link
  popover's text field read-only (`linkTextEditable: false`) because one string
  cannot rewrite multi-paragraph text; remove-link clears them all. Paste replaces
  the selection inside the same batched edit (one undo step), and cut — previously
  a silent no-op across fields — writes the model's text and deletes.
- [CODE] KNOWN GAP: pasting text that contains blank lines inserts hard breaks in
  one paragraph rather than creating paragraphs, so a pasted multi-paragraph
  letter arrives as a single paragraph. `parseCoverLetterText` splits paragraphs
  only on the Open/load path. Fixing it needs a reducer action that replaces one
  paragraph with several, plus a decision for the resume host (pasting into a
  bullet list). Not attempted in this slice.
- [TOOL] The in-app browser driver cannot produce `insertParagraph`, Backspace's
  `deleteContentBackward`, or native Select All (CDP key events carry no editing
  command), so those paths were exercised by dispatching the app's own
  `beforeinput` intent and setting the range directly. Typing, real toolbar
  clicks, marks, and geometry read back normally.
- [USER] Cross-field Select All was confirmed fixed in Firefox by the
  endpoint-only resolution. Gecko puts a select-all range's boundaries on the
  editing host, which no endpoint-based key lookup can name, so `readSelection`
  now falls back to the covered-field resolution and treats a ONE-field selection
  as single-field. Without that, Firefox lost every command needing one run of
  text — the reported symptom was a dead link control on a fully selected
  single-paragraph letter, working in Blink and not in Gecko.
- [CODE] Wrapped continuation lines are editable again. A line break consumes the
  interword glue (or the authored newline) into the break, so that display
  character has no DOM character in either line; both caret mappings in
  `domSelection.ts` desynchronized there. `caretToDisplayIndex` returned null for
  any caret on a continuation line — no typing, no editing, and queued keystrokes
  such as a second space were dropped — and `displayIndexToCaret` resolved a
  restored caret to the end of the line above, so the next character landed in
  the previous word (typing past the margin produced "rightg" instead of "marg").
  A caret AT a break belongs to the end of the broken line; past it, to the start
  of the next. Emergency mid-token breaks and same-line style boundaries consume
  nothing, and the crossing is resolved for blank-line spans too — an authored
  hard break paints a blank line that consumed its own display character, so
  skipping it desynchronized every caret after it.
- [TOOL] `apps/role-fit-ai/src/typeset/__evals__/vertical-parity.mjs` is RED and
  was already red before this work: bullet, summary, and skills columns subtract
  `entryEndIndentPt` (5.4 default), which Jake's source applied only to entry
  head rows, so one truth line reflows by a word. Setting `entryEndIndentPt: 0`
  makes all 20 lines match within ±1.5bp. UNCONFIRMED whether the body columns or
  the fixture should change; the decision reflows every existing resume.
- [USER] The document font list gains the three families resumes are most often
  asked for, as their redistributable metric-compatible equivalents: Tinos
  (Times New Roman), Arimo (Arial), and Carlito (Calibri). The originals are not
  redistributable; these keep the originals' per-character advance widths, so a
  document holds its line and page count when opened in a word processor that
  only has the original. The menu shows each font's real name with its metric twin
  beside it — never the trademark as the font's own name — and previews each row
  in its own face. Verified against the published originals: Tinos and Arimo match
  Times New Roman and Arial with ZERO deviation on the sampled repertoire.
- [CODE] `lib/fontFamilies.ts` is the single list of family ids. The persisted
  style enum, `FONT_FAMILY_OPTIONS`, both `<font=…>` tag automata (engine
  measurement and the editor's display map), `clearInlineOverride`,
  `effectiveFieldFont`, and the engine face registry all derive from it. They were
  eight independent hardcoded copies; the tag automata are regex strings, so a
  missed copy TYPECHECKS and then fails at runtime with the tag painted as
  literal text. `typeset-editing.mjs` now sweeps every family through a
  value→display→value round trip, which is the only mechanical guard on that.
- [CODE] The three new families are drawn on a 2048-unit em, so `metrics.gen.ts`'s
  integer 1000ths cannot represent every advance exactly. The residue is per glyph
  and bounded — `pdf-font-parity` measured 0.1166bp worst case over a 61-character
  run at 10bp, and each painted segment carries an explicit engine width so it
  never accumulates past one segment. The eval now allows 0.005bp/glyph for a
  finer design grid and holds every 1000-unit family to bit-exact parity
  (measured 0.0000bp), so a real shaping divergence still fails. Rescaling their
  outlines to 1000/em was rejected: it would trade an invisible engine-vs-render
  difference for a visible break in the metric compatibility that is the reason
  to ship them.
- [CODE] None of the three ships a usable `smcp` lookup (Carlito's `c2sc` has one
  substitution), so their caps faces carry SYNTHESISED small capitals: uniformly
  scaled capitals baked into the shipped font's cmap. Uniform scaling is not an
  approximation of a different design — Latin Modern's own caps face, a genuine
  TeX design, measures 0.7513 height and 0.7522 advance against its capitals. The
  ratio floors at 0.80 (the median real small-cap height of the three bundled
  families) and rises with a face's x-height, because Arial-metric Arimo's
  x-height would otherwise reach past its own small caps. Synthesis lives in the
  ASSET, not in a layout branch, so the browser, the PDF embedder, and the
  committed metrics agree by construction.
- [CODE] `boldDisplay` aliases `bold` for the three static families. Latin Modern
  and the Source families ship a real display optical size (LM Roman 12,
  `opsz: 24`); a single-design static has none, so both roles share one asset,
  one metrics record, and one `@font-face`.
- [CODE] A new editor eval (`styles/__evals__/font-assets.mjs`) cross-checks the
  registry against the stylesheet and the disk: every face declared exactly once,
  loading its own asset at the right weight/style, with both a webfont and a PDF
  sibling present. That failure mode is silent and severe — an unmatched
  `cssFamily` makes the browser substitute a system font, so text paints at
  advances the engine never measured and every caret position is wrong while it
  still looks like text. Both directions were negative-tested.
- [USER] Every editor host gets the right-click menu. It was gated on
  `structureEditing`, so the cover letter had no menu at all — only the browser's
  native one. That flag now gates only the structural group; clipboard, emphasis,
  clear-formatting, link, and history commands are always present.
- [CODE] The toolbar and the right-click menu now drive one command surface and
  read enabled state from one `InlineFormatState`. The menu had its own
  single-field-only implementations, so it silently kept the pre-cross-field
  behaviour: on a multi-paragraph selection its Cut, Copy, Bold, and link items
  were all disabled. Verified in-browser: a cross-paragraph Cut from the menu
  merged the two paragraphs correctly and undid in one step.
- [USER] Hovering a link shows a card with the destination plus open, copy, edit,
  and remove. Acting on it selects that link's run first and then runs the
  ordinary command, so there is no second link path. Remove works on an
  auto-detected bare URL too — it marks the run `<nolink>`, keeping the text and
  dropping the link.
- [CODE] The font menu is sized to its content. At the toolbar's width the fixed
  128px menu collapsed the name column to nothing, so a row read only
  "Times New Roman" with no font name, and "Source Serif 4" truncated.
- [TOOL] CareerOneStop, MIT CAPD, and Harvard FAS guidance was reviewed for
  concise, specific, active, evidence-based application writing that preserves
  the candidate's own voice. The durable links and resulting prompt policy are
  recorded in `apps/role-fit-ai/docs/engineering/ai-server.md`.
- [USER] 2026-07-26: Resume line height is a global setting inside Spacing.
  Spacing presets and Page margin presets keep their numeric controls expanded
  so the active physical values remain inspectable. Cover-letter inline line
  height adds room below targeted visual lines only.
- [CODE] 2026-07-26: Resume print-style changes and content edits share one
  chronological Undo/Redo order through monotonic history transactions. Zoom,
  spell-check, and the page-preset label remain outside document history.
- [USER] 2026-07-26: Resume Tab/Shift+Tab traverses logical header and section
  fields instead of authoring spaces. A destination is selected as one field
  across wrapping and inline runs; structural headings are skipped. The cover
  letter applies that cycle only to optional name/contact header fields; body
  Tab indents and Shift+Tab outdents along the measured half-inch ladder.
- [CODE] 2026-07-26: Selection paint includes each selected line's owned
  leading/paragraph gap without crossing page boundaries. Cover-letter
  line-height transforms remain visual-line scoped and affect only the outgoing
  junction; focused evals cover inherited paragraph height and hard breaks.
- [USER+CODE+TOOL] 2026-07-26: Cover/summary paragraph leading indentation now
  survives the shared schema, editor repaint, and PDF path. Forgiving selection
  edges anchor from adjacent line whitespace but never snap the moving endpoint;
  measured caret fallback preserves partial forward/reverse selection at first,
  wrapped, and final glyphs. Browser typing/Tab/Undo QA passed.
- [USER] 2026-07-28: Selection paint must be continuous through before/after
  paragraph spacing. Copying from either shared editor into Google Docs must
  preserve logical paragraphs: destination-width reflow is expected, but
  Typeset's visual wrap points must not become separate pasted blocks. Nonzero
  paragraph spacing should paste as a blank paragraph rather than CSS spacing.
- [CODE] 2026-07-28: Supersedes the 2026-07-26 selection-gap detail above.
  Consecutive selected engine lines now tile through their complete calibrated
  junction; exposed paragraph edges use engine-published authored before/after
  spacing without crossing page bounds. External HTML clipboard data is
  serialized from logical model ranges with one block per field, supported
  inline formatting, and one blank block at a nonzero spacing boundary; the
  absolutely positioned visual-line DOM no longer defines pasted paragraphs.
- [TOOL] 2026-07-28: The isolated worktree dev process was started on canonical
  port 5181 after a clean lockfile dependency install; the server returned HTTP 200. Both owner checks and both consumer production builds passed; the
  interface detector reported no findings.
- [USER] 2026-07-28: Cover-letter default paragraph rhythm is explicit 8pt
  space-before on every paragraph, never the generic resume bullet gap. The
  erroneously introduced document-level cover-letter gap field is removed from
  the current beta schema without a schema-version bump or compatibility path.
- [CODE] 2026-07-28: New, imported, starter, and tailored cover-letter text is
  normalized through the shared explicit space-before default. Enter preserves
  paragraph properties on either empty split half. Cover-letter layout ignores
  the generic resume bullet gap, and current `.cover` style parsing rejects the
  removed beta prototype field.
- [USER] 2026-07-28: The beta `.cover` contract has no legacy compatibility
  obligation. Its current strict shape is renumbered as schema version 1, and
  all other cover-letter versions must be rejected.
- [CODE] 2026-07-28: The `.cover` codec now has one schema branch: version 1
  includes the optional header, ordered paragraphs, and current print style.
  The former paragraph-only compatibility branch and its migration probe were
  removed; resume schema compatibility is unchanged.
- [TOOL] 2026-07-28: A privacy-safe shape audit found all five ignored local
  cover-letter variants use schema v2 and the retired `paragraphGapPt` wire
  field; no document text was read or printed.
- [USER+TOOL] 2026-07-28: The v1-only contract above is intentional. The five
  ignored local variants were privately backed up, converted to schema v1, and
  one saved application `.cover` received the same migration. All six active
  files were verified through the strict parser without printing document
  text. Their retired document gap was moved into explicit paragraph marks
  before the wire field was removed; converted files and backups remain
  ignored. The saved application's tracker fingerprint and revision were
  refreshed through the running app's sparse mutation route, with the prior
  tracker snapshot in the ignored migration backup.
- [USER] 2026-07-28: Authored paragraph spacing remains visible at document
  boundaries: the first paragraph/line shows before-space and the final
  paragraph/line shows after-space.
- [CODE] 2026-07-28: Page-start placement now reserves the first line's
  authored before-space. Selection paint claims before-space without requiring
  a predecessor and after-space without requiring a successor, capped at the
  page edge so boundary highlighting cannot cross sheets.
- [USER] 2026-07-28: Google Docs clipboard interop must preserve paragraph
  before/after spacing in both directions and hyperlinks from the shared editor
  to Docs, not only links pasted from Docs into the editor.
- [CODE] 2026-07-28: External clipboard blanks now carry a non-breaking space
  so Docs retains leading/trailing spacing boundaries. Outbound HTML promotes
  both explicit and auto-detected URLs/emails to anchors, while inbound rich
  block margins are converted from CSS points/pixels into explicit paragraph
  before/after marks.
- [USER] 2026-07-28: Enter/new-paragraph editing continues the active text and
  paragraph formatting rather than resetting it.
- [CODE] 2026-07-28: An empty half created by Enter now stores adjacent
  emphasis, family, size, alignment, line-height, spacing, and indentation in
  textless inline wrappers, which later typing reads back. Hyperlink and
  link-suppression state intentionally stop at the paragraph boundary.
- [USER] 2026-07-28: A format selected while the new paragraph is still empty
  persists if the caret moves elsewhere and later returns.
- [CODE] 2026-07-28: Collapsed-caret emphasis, font-family, and font-size
  commands on an empty paragraph now commit a complete effective typing format
  into its textless carrier. Selection synchronization restores that stored
  format, including alignment, instead of relying on the caret-local ref.
- [USER] 2026-07-28: Supersedes the clipboard blank-line expectation above.
  Google Docs interop must preserve before/after spacing as paragraph style,
  not add an empty paragraph or flatten pasted paragraphs into hard lines.
- [CODE] 2026-07-28: Clipboard HTML now exports paragraph spacing as explicit
  top/bottom margins. Inbound block HTML is separated from authored `<br>`
  breaks and an atomic reducer action inserts multiple blocks as distinct
  summary paragraphs or bullets; explicit source spacing wins over empty-target
  defaults. A cross-field paste performs deletion, structural insertion, and
  boundary joining in that same reducer transaction, so one Undo restores it.
- [USER] 2026-07-29: Google Docs clipboard interop must preserve line height in
  both directions, alongside the existing paragraph-spacing contract.
- [CODE] 2026-07-29: Model-derived clipboard HTML now publishes effective
  unitless line height on paragraph blocks and inline runs. Inbound rich HTML
  converts allowlisted unitless, percentage, and font-relative point/pixel line
  heights into explicit inline marks; unsupported CSS remains discarded.
- [USER+TOOL] 2026-07-29: The restarted desktop app passed the user's live
  Google Docs line-height copy/paste round trip.
- [USER] 2026-07-29: The document-workflow hardening review requires one
  current strict v1 shape per portable format, no runtime migration tooling,
  truthful artifact status, tab-safe recovery, and separate behavior/refactor
  commits. The application lock, revision check, client mutation queue, and
  file-byte rollback transaction remain non-negotiable.
- [CODE] 2026-07-29: `.cover` serialization now rejects unrepresentable editor
  state; header-menu edits preserve inline marks; disabled structure controls,
  one-block rich paste, and Typeset save baselines are corrected. Application
  records retain only strict source/PDF artifacts as reloadable documents, and
  sanitization is deterministic.
- [CODE] 2026-07-29: Cover title/style recovery and live-sibling draft
  protection now share the app-owned recovery timer. Retired autosave,
  full-tracker, and workspace-backup compatibility paths are rejected rather
  than migrated. Shared JSON codecs, clipboard/structure seams, cover services,
  and application routes were extracted without moving editor caret ownership
  or changing the application document transaction.
- [TOOL] 2026-07-29: The required clean install, root check/test, standalone
  font provenance gate, both app builds, landing build, server TypeScript and
  lifecycle checks, document-workflow integrations, and headless Chromium
  contracts passed. Live RoleFit QA found no console errors and verified header
  popover focus plus artifact-backed document labels/actions. Layout snapshot
  files are byte-identical to branch base `8016693`. The CI workflow is
  committed but has no remote run because this branch was intentionally not
  pushed.
- [USER] 2026-07-29: Draft PR review found three merge blockers: tracker
  revisions could regress, async document replacement could overwrite newer
  local state, and editing an automatically linked contact could retain its old
  destination. Merge also requires injected document-transaction rollback
  evidence and green remote checks.
- [CODE] 2026-07-29: Tracker reads and writes now require canonical ISO
  revisions, reject retired/lossy fields and dual artifact representations, and
  require existing upserts to advance monotonically after a matched base.
  Resume replacement reads live content/style state at commit time; cover
  replacement includes title changes; restore adoption is idempotent,
  latest-response-only, and does not auto-apply a sibling document.
- [CODE+TOOL] 2026-07-29: Derived email/URL/phone links now follow edited
  visible text while custom label destinations remain stable, with Undo
  restoring both. Production document rollback is fault-injected after real
  source/PDF/deletion mutation. CI provisions pinned Python font tooling and
  waits for Chromium termination before retry-safe profile cleanup.
- [TOOL] 2026-07-29: The final local diff passed `npm run check`, the document
  workflow and server-lifecycle probes, and the real-Chromium editor/recovery
  contracts; no layout snapshot changed. At this local-verification checkpoint,
  draft PR #97 remained unready and unmerged at remote SHA `49ac6cd`;
  publication and required remote checks were still pending.
- [TOOL+CODE] 2026-07-29: The first corrective remote run passed all six
  Document workflow jobs, including engine fonts and Chromium. The separate
  Typeset verify job passed the parity corpus but one dynamically selected CTAN
  mirror failed Python TLS verification; the parallel engine job passed on the
  same Ubuntu image. Font-tool setup now pins `certifi` and exports its CA bundle
  in every engine-checking workflow so mirror trust does not depend on runner
  image timing.
- [TOOL+CODE] 2026-07-29: Superseding the CA-only diagnosis above, the next
  remote engine job reproduced the redirected CTAN mirror's incomplete trust
  chain even with pinned `certifi`. Latin Modern provenance now uses the named
  official Illinois CTAN mirror instead of the proximity redirector while
  retaining exact source digests; the CA pin remains deterministic runner
  setup, not a fallback for an invalid upstream chain.
- [USER+CODE] 2026-07-30: Prepare's brief was redesigned. Multi-item sections
  (responsibilities, required/preferred qualifications, tech keywords,
  seniority/domain signals, benefits) moved from eight stacked textareas into
  one small tablist over per-item editable rows with add/remove; prose fields
  stay inline. Resume and Cover Letter cards collapsed to a single row each.
  Presentation only: `PreparedJobBrief` stays `string[]` per field and
  `onJobBriefChange` keeps its newline-joined string contract. Per-item include
  toggles and drag reordering were offered and declined for this pass.
- [TOOL] 2026-07-30: Verified against the companion's built bundle at
  localhost:5181 with a synthetic posting: edit, remove, and add each persist
  through a tab round-trip, counts track, the new row takes focus, and the APG
  arrow/Home/End/wrap model holds. `npm run check --workspace apps/role-fit-ai`
  passed. Note for future browser QA: the QA pane runs unfocused
  (`document.hasFocus()` false), so `element.blur()` emits no `focusout` and
  React `onBlur` never fires — dispatch `focusout` explicitly or commit-on-blur
  reads as a phantom data-loss bug.
- [USER+CODE] 2026-08-03: RoleFit's Resume tab always mounts a real editor
  document. `createBlankResumeData()` (`src/lib/blankResume.ts`) seeds an
  explicit `{visible, name: "", contact: []}` header over no sections, so the
  empty-state and bootstrapping panels are gone and `editedResume` is non-null
  through the App/ResumeTab/workspace chain. Open gained a Blank action ordered
  Starter, Blank, File. Document existence enables editing and strict `.resume`
  save; `resumeHasContent` separately gates PDF export, Polish, and Apply. The
  replacement guard fingerprints the structural document plus normalized style
  without applying save-time codec limits during React render. Workspace Save
  stays disabled through bootstrap and the state owner rejects bootstrap races;
  starting Blank also clears prior workspace-save feedback. A detached save
  defaults to `default.resume` rather than `default.txt`.
- [USER+CODE] 2026-08-03: The overlay caret owns model-driven editing.
  `.tsd-doc--editable` sets `caret-color: transparent` when the model owns the
  value, because a document with no fields at all (a removed header and no
  sections) otherwise parks a native caret in the page's top-left corner outside
  the margin as though it could accept typing. IME composition is the deliberate
  exception: `.is-composing` restores the browser caret while its DOM value is
  uncommitted and hides the stale overlay until `compositionend`. A range
  selection paints no edge caret; the selection band is its own feedback.
  The blank name's "Type your name" hint became document typography rather than
  UI chrome — `font: inherit` from the run, baseline-aligned by `top: 0` — so it
  agrees with the caret, which is drawn at the field's display size. The DOM
  renderer publishes `--tsd-empty-hint-shift` (how far along the column a
  zero-width run's anchor sits) so a centred header's hint centres on the
  insertion point instead of spilling right from the midpoint.
- [TOOL] 2026-08-03: Small-caps heading letters that look like they sit at
  different heights on screen were measured, not adjusted. The caps faces are
  uniform (Latin Modern's small caps span 0.508-0.531 em, with the round letters
  and A carrying ordinary overshoot, and T 1.2% under the flat-topped letters),
  `pdf/emit.ts` embeds those same `.ttf` files at the same baselines, and the
  PDF at 400% reads level. The residual at 100% is anti-aliasing at a ~6px
  small-cap height, where A's apex and T's crossbar hold too little ink for a
  solid top row; `text-rendering: geometricPrecision` already removes the
  hinting half of it. No code change beyond recording the rationale.
- [TOOL] 2026-08-03: After review remediation, `npm run check` passes for
  `packages/engine`, `packages/editor`, `apps/typeset`, and `apps/role-fit-ai`;
  the RoleFit gate needed host access for its expected loopback server probe.
  Browser QA of the caret and hint change was NOT run under the flag-first
  policy. Unverified in a real browser: hint baseline/size across zoom levels,
  hint centring for centred versus left-aligned headers, and the native-to-overlay
  caret handoff during a physical IME composition session.
- [USER+CODE+TOOL] 2026-08-03: Resume review and Cover Letter tailoring now use
  one collapsible `DocumentWorkbench`; separate preferences persist, hidden
  children stay mounted, and the rail stacks below 1080px. Type/build/app tests
  and the automated Chromium disclosure/layout contract passed.
- [USER+CODE+TOOL] 2026-08-03: Supersedes the 44px collapsed handle above. The
  user rejected that collapse; the rail now closes its whole track to zero and
  is reopened from an icon-only edge tab (full-width bar when stacked); [USER]
  chose the icon over a labelled tab with a count, so no badge API exists.
  Collapsed rails are `inert` rather than `hidden` and focus follows the control
  that replaced the one clicked. RoleFit check (67 evals) and the Chromium workbench contract —
  extended for focus handoff, single control per state, full track return, and
  the stacked bar — passed. Browser QA not run: unverified in a real browser are
  the collapse animation's feel and the edge tab against a scrolled document.
- [CODE+TOOL] 2026-08-03: Workbench review remediation makes the stacked layout
  its vertical scroll owner so editor content and the reopen bar remain
  reachable in the host's clipped tab pane. Fit zoom now observes the exact
  editor pane through an explicit ref and recalculates after rail-width
  transitions, while the structural rail wrapper is neutral so its named child
  review rail remains the sole complementary landmark. The editor package
  check, Typeset build, RoleFit check (67 evals), focused contract probe,
  Chromium workbench regressions, UI detector, and diff check passed. Real-app
  visual QA was not run under the flag-first policy.
- [CODE+TOOL] 2026-08-03: Follow-up review fixed narrow document-tab scroll
  restoration without changing the workbench layout. `useRestoredScroll` now
  receives the desktop editor and stacked layout refs and resolves the active
  owner from computed overflow during restore and layout cleanup. The Chromium
  regression failed first with a saved offset of 0 instead of 180, then passed
  through narrow unmount/remount; the full RoleFit check passed 67 evals and the
  UI detector returned no findings.
- [USER+CODE+TOOL] 2026-08-04: Resume and Cover Letter now share one always-present
  workflow-rail hierarchy while retaining separate orchestration. Resume's
  primary **Polish resume** action runs Tailor then Recruiter audit, with
  one-stage actions secondary and proposal decisions marking the audit stale.
  Cover Letter stages a fingerprinted whole-document proposal; only **Use
  proposal** applies atomically and creates Restore, **Keep current** performs no
  mutation, changed semantic inputs disable acceptance, and deterministic `422`
  blockers omit rejected provider output. Production build, document-workflow
  round trips, focused contracts, and all 67 offline evals passed; real-browser
  visual QA was not run under the flag-first policy.
- [USER+CODE+TOOL] 2026-08-04: Opening a document workflow rail no longer moves
  the workspace. `.studio-body` on the document tabs is `overflow: clip` rather
  than `hidden` — `hidden` left it a scroll container holding ~69px of
  horizontal overflow from closed toolbar popovers, and the rail toggle's focus
  (whose target is outside the box until the track settles) scrolled toolbar,
  title, and editor sideways together; the toggle now focuses with
  `preventScroll`. The rail's track is also paid out of the desk margin before
  the page moves: the pane biases its start padding by the rail width, using the
  rendered page width (`DOC_PAGE_WIDTH_PX × zoom`) threaded through as
  `pageWidthPx`, and both halves animate on one `--document-rail-motion` token
  because the page holds still only while padding gains what the track loses.
  Rail width moved from `clamp(320px, 27vw, 380px)` to `18rem`. Measured page
  shift on open: 0px at 1920, 63px at 1600, 109px at 1365; transition scrubbed
  frame-by-frame with pane width + padding invariant at 1756 throughout. All 67
  offline evals passed. Browser QA ran in the paint-gated pane, so end states and
  scrubbed timelines are verified but real animation frames are not.
- [USER+CODE] 2026-08-04: Supersedes only the earlier "no badge API exists"
  decision for collapsed document rails. The user approved integrating the
  typed cover-letter evidence failure work with the latest workbench branch.
  `DocumentWorkbench` now accepts a generic optional attention count, but RoleFit
  supplies it only for a validated post-draft Cover Letter `blocked` response;
  readiness gaps and generic provider failures remain unbadged. The closed icon
  and accessible label carry the bounded count while the detailed flat issue
  list stays in the existing mounted workflow rail.
- [CODE] 2026-08-04: Cover-letter validation issues now have fixed typed
  code/category/recovery relationships, separate internal repair instructions
  from bounded display-safe fields, and expose at most eight public records after
  the single repair fails. The loopback client validates that wire shape before
  rendering it, semantic input changes clear stale failure state, and proposal
  acceptance remains the only editor replacement boundary. Unfinished Guidance
  prompts are filtered by both corpus boundaries, and numeric grounding treats
  equivalent digit and word durations alike without letting an unrelated number
  support a duration.
- [TOOL] 2026-08-04: The RoleFit production/server build, full app check
  (including desktop contracts), all 67 offline evals, and the headless Chromium
  editor/workbench suite passed. The browser contract now asserts the branch's
  documented `18rem` rail width instead of its stale pre-branch 320-380px range
  and verifies the collapsed issue count, accessible label, persistence,
  desktop disclosure, and stacked in-flow placement. The UI detector found no
  new unresolved issue; its remaining layout-transition warning is the documented
  synchronized padding/track motion that prevents the workspace-shift regression.
  Live provider evaluation and real-app visual QA were not run.
- [USER+CODE+TOOL] 2026-08-04: The primary document action now has one visible owner:
  the workflow rail. Resume and Cover Letter both call it **Polish**; the
  editor header retains file/edit controls (plus Resume's secondary More menu),
  and a state-matched Polish button floats beside the edge tab when the rail is
  collapsed. Full RoleFit checks, the workbench contract, and live browser QA
  passed for both expanded and collapsed document rails.
- [USER+CODE] 2026-08-04: Supersedes the floating collapsed Polish button above.
  The collapsed rail is now one edge dock — action plus reopen tab on a single
  card, a full-width bar when stacked — and both document workspaces share one
  vocabulary: **Polish** / `Polishing…` / `Polish again` everywhere a run
  starts, including the Prepare material cards that previously said `Tailor`;
  `Tailor` and `Audit` remain stage names only. Cover Letter's proposal now uses
  the resume's `Accept` / `Discard` verbs, its status strings stopped naming a
  `Tailoring panel` the UI never shows, the resume dropped its always-ready
  `Workflow` readiness row, and both rails phrase shared gates identically.
  RoleFit check (67 evals) and the Chromium workbench contract — extended for
  the dock's single surface, ordering, edge flushness, and stacked bar — passed.
  Real-app visual QA was not run.
- [USER+CODE] 2026-08-04: Three follow-ups on the collapsed dock and document
  chrome. (1) The docked action lost its own button box — the dock is the single
  surface, so a filled/disabled button inside it no longer reads as a card in a
  card; the shell styles whatever action a host docks there. (2) The Resume
  header's More menu (specialist Tailor-only / Audit-current stage runs) is
  removed at [USER] request; that choice still exists as the remembered Settings
  stage default, and `POLISH_STAGE_ACTIONS`, `polishStageReady`,
  `polishStageBlocker`, `reviewProviderMessage`, and the `.polish-stage-menu`
  rules went with it. (3) The Cover Letter rail no longer restates its workflow
  message under the action while idle — the phase, description, and checks
  already carry it, and the editor's own save/PDF receipts still show; the
  duplicate readiness hint and its `providerMessage` prop are gone. Prepare's
  compact "Inputs changed · polish again." note is unaffected. RoleFit check
  (67 evals) and the Chromium workbench contract passed; real-app visual QA not
  run.
- [USER+CODE] 2026-08-04: Supersedes the collapsed-dock entry above. Polish is
  now one rail action placed by the shell (`rail.action`, not `collapsedAction`):
  it sits at the end of the rail header while the rail is open and on the
  document's edge beside the reopen tab while it is closed, rendered in exactly
  one of the two at a time. No card wraps the collapsed pair, the disclosure
  control is a single 30px shape in both states matched to the compact button
  beside it, and the header's end padding matches the collapsed inset. The rails'
  footers no longer duplicate Polish — they carry only Stop, Retry tailor/audit,
  Accept/Discard proposal, and Restore previous. An intermediate icon-only
  collapsed action was tried and reverted at [USER] request. RoleFit check
  (67 evals) and the Chromium workbench contract passed; real-app visual QA not
  run.
- [USER+CODE] 2026-08-04: The shared document rail is resizable. [USER] set the
  range brief; the chosen contract is 18rem (today's default) as both floor and
  default, 28rem ceiling, one shared width for Resume and Cover Letter under
  `rolefit:document-rail:width` — disclosure stays per-document, width does not,
  because a per-document width would shift the page on every tab switch. Bounds
  are rem-derived and re-clamped on read against the live root font size; the
  dragged value is px. The affordance is a `role="separator"` on the rail's
  divider with pointer drag plus ArrowLeft/Right (Shift for a coarse step), Home,
  End, and double-click to reset; it is hidden once the rail stacks below 1080px.
  Drags write the CSS variable directly and commit once on release, and set
  `data-resizing` to suspend the disclosure transition. RoleFit check (67 evals)
  and the Chromium contract — extended for drag distance, ceiling clamp,
  persistence, the suspended clock, and keyboard parity — passed. Real-app visual
  QA not run.
- [USER+CODE+TOOL] 2026-08-05: Review remediation closed the document-workflow
  and grounding gaps before publication. Cover-letter validation now excludes
  only demonstrably employer-only predicates from the candidate evidence gates;
  the original comparison bypass, two unfamiliar employer-led paraphrases, and
  pure employer facts have end-to-end probes. Resume and Prepare dispatch the
  same Settings-owned Tailor / Recruiter audit / Both workflow, readiness checks
  only the selected providers and Tailor scope, and progress/state labels show
  only stages that actually ran. Visitor, product, engineering, and scoped-agent
  docs now use the shipped Polish and Accept/Discard vocabulary. The README,
  landing page, resume/cover-letter screenshots, and social preview describe and
  show the current workflow with direct functional copy. The complete repository
  `npm run check` passed with loopback access — including app and landing builds,
  desktop contracts, shared packages, and 67/67 RoleFit offline evaluations —
  and the rendered Chromium workbench contract passed. Isolated fictitious-data
  browser QA covered the current Resume and Cover Letter workspaces plus the
  landing page at 1440px and 390px. No live provider evaluation ran.
- [USER+CODE+TOOL] 2026-08-06: PR 1 renames the configurable Distill stage to
  **Job analysis** across settings, runtime identifiers, progress copy, current
  docs, and the canonical `/api/job-analysis` route. Settings and portable
  backups migrate the legacy provider/model/effort/instruction keys before
  strict normalization; historical tracker provenance is read under the new
  label and subsequent writes use only `job-analysis`. `/api/distill` remains a
  one-preview compatibility alias, extension cleanup still recognizes
  `distillAi`, and historical release notes remain unchanged. No initial-fit
  audit behavior is included in this PR.
- [USER+CODE] 2026-08-07: The fast path is now Prepare → Initial Fit → Polish →
  Apply. Prepare publishes its deterministic local brief before provider work;
  Job analysis improves it when available, while provider failure leaves manual
  Polish usable. Optional Initial Fit shares the normal Prepare dispatch,
  sanitizes independently, and reruns alone when the selected resume changes.
  Its contract is only a four-level verdict, one summary, up to three matches
  and gaps, and a relevant eligibility warning — no score, confidence, ledger,
  evidence quotes, recommendation, persistence, or analytics.
- [USER+CODE] 2026-08-07: Initial Fit defaults on. Independent Resume and Cover
  Letter proposal toggles default off; only Strong or Reasonable without an
  eligibility blocker may start either proposal, and manual Polish remains
  available for every fit outcome. PR #124 and PR #125 were reverted before
  this slice so the new contract does not preserve their audit complexity.
- [TOOL] 2026-08-07: The full RoleFit check passed: browser and server builds,
  landing build, desktop contracts, and 71/71 offline evaluations. The compact
  Initial Fit probes, 403 client workflow guards, settings normalization, and
  analytics regression all passed. The UI detector reported only advisory
  font-size matches already permitted by the documented body/label ramps.
  Live-provider and real-browser visual QA were not run.
- [USER+CODE] 2026-08-07: Normal Resume Polish is one proposal request from
  Resume or Prepare; the Tailor / Review / Both selector and reviewer readiness
  gate are absent from that path. The server flattens editable fields to opaque
  `target-N` ids, keeps identity, contact, education, dates, and omitted sections
  locked, and validates each mutation independently while treating optional
  feedback tolerantly. Proposal, No changes, and Withheld are distinct outcomes;
  all-withheld output is a retryable non-success and never mutates the resume.
  The compact rail shows only What improved, collapsed Edits ready with Apply
  all plus Accept/Edit/Discard, Still missing, and a quiet withheld line.
- [TOOL] 2026-08-07: The full RoleFit check passed with loopback access:
  application and landing builds, desktop contracts, and 72/72 offline
  evaluations including the new one-pass proposal probes and 405 client workflow
  guards. The UI detector reported only advisory matches already covered by the
  documented body/label ramps or pre-existing styles. Live-provider evaluation
  and real-browser visual QA were not run.
- [USER+CODE] 2026-08-07: Final Check replaces Recruiter audit in the normal
  Resume UI as a deliberate optional request after proposal decisions. It sends
  the actual current resume, candidate evidence, and prepared job through its
  own one-call route and independent compact contract; the server grounds up to
  five unsupported, missing, or clarity issues and derives Ready / Review /
  Needs evidence from valid survivors. A failed, stopped, or stale Final Check
  never changes the Polish proposal, editor, or Apply readiness. The legacy
  headless Review modes remain compatibility-only for the final cleanup slice.
- [TOOL] 2026-08-07: The exact PR 3 RoleFit gate passed: application and landing
  builds, desktop contracts, server types, and 73/73 offline evaluations,
  including the independent Final Check route/grounding probes, 419 client
  workflow guards, and document-workbench contract. The UI detector reported
  only advisory font-size/radius/color matches already present in the shared
  review stylesheet or consistent with its existing compact type ramp.
  Live-provider evaluation and real-browser visual QA were not run.
