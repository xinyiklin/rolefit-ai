# Testing

RoleFit AI testing should prove the changed behavior, protect API key
isolation, and avoid wasting time on broad checks when a targeted one
gives stronger feedback. The lightweight gates below are what the project
relies on. Run commands below from the repository root unless stated otherwise.
The RoleFit workspace's offline `node:test` suite runs the deterministic
AI-safety probes; the root `npm test` additionally runs package-owned evals.

## Offline Test Suite

`npm test --workspace apps/role-fit-ai` runs the app's
`offline-evals.test.mjs`. It recursively discovers every `.mjs` under an
`__evals__` directory in RoleFit and runs each as a child process (bounded by a
60s timeout), asserting exit 0. There are no model calls, network requests, or
provider keys. A new offline eval is gated automatically unless it is explicitly
classified as live.

Each eval still runs standalone for a per-case PASS/FAIL list, e.g.
`node apps/role-fit-ai/server/ai/__evals__/resume-proposal-probes.mjs`. On a failed case the runner
attaches the child's last output lines to the assertion so you can see which
case broke without re-running.

The live cover-letter and Resume Proposal quality evals are excluded via the
runner's `LIVE` denylist: they drive a real provider, cost tokens, and need a configured provider. Any
new network/model eval must be added to `LIVE` so it stays out of `npm test`.

`src/lib/__evals__/job-identity-golden.mjs` is a CHARACTERIZATION test, not a
correctness one. It pins the duplicate matcher's verdict for every pair of a
fixed corpus to whatever it is today, so a refactor claiming "same results,
less work" is reviewable. The matcher drives pipeline warnings, posting-link
suggestions, and explicit manual-merge discovery, and its failure mode is silent — a dropped tier does
not throw. When a matcher change is INTENTIONAL, regenerate the golden block
with
`ROLEFIT_GOLDEN_UPDATE=1 node apps/role-fit-ai/src/lib/__evals__/job-identity-golden.mjs`
and review every changed line as a behavior change. Its coverage assertions
fail if the corpus stops exercising a tier, so a body edit cannot leave the
golden green but meaningless.

`src/lib/__evals__/duplicate-scan-eval.mjs` also logs a benchmark of the
tracker-wide duplicate scan. It asserts cache and correctness behavior only —
never wall-clock, so a shared CI machine cannot make it flaky — and defaults to
small sizes. For the full 50/100/300/500 sweep when changing the matcher or the
scan cache, run it standalone with
`ROLEFIT_DUPLICATE_BENCH=full node apps/role-fit-ai/src/lib/__evals__/duplicate-scan-eval.mjs`.

Listener/companion-process integration tests are also explicit rather than
auto-discovered.
`server/__evals__/server-lifecycle-probes.test.mjs` intentionally uses the
`.test.mjs` suffix, which the offline child-process runner excludes. Run it with
`npm run test:server-lifecycle --workspace apps/role-fit-ai`; it binds an
ephemeral loopback port, uses an isolated temporary workspace, checks the
health/Host/Origin/lifecycle contract, and proves the listener can be released
and rebound.

## Testing Mindset

- Define success before coding: reproduce or identify the behavior,
  change it, and run the smallest meaningful verification.
- Prefer targeted checks while iterating, then broaden when the blast
  radius is shared or user-facing.
- If a check fails, treat the failure as evidence. Fix the smallest
  real cause and rerun the smallest meaningful check before broader
  ones.
- If checks are skipped, explain why in the final response.

## Server / AI Coverage

Good server verification covers:

- `npx tsc -p apps/role-fit-ai/tsconfig.server.json --noEmit` passes after
  server edits (the server runs under Node's native TypeScript type stripping;
  the NodeNext, rewrite, and erasable-syntax options make this the type +
  native-runtime syntax gate)
- the affected route returns the expected JSON shape and HTTP status
- normal `/api/polish` accepts `mode: "resume-proposal"` plus a structured
  `resumeScope`, does not require full-resume `resumeText`, and owns exactly one
  provider dispatch. It prompts with flat `target-N` IDs only; only bullets and
  actual Skills lists are mutable, while category labels, standard role/employer/subtitle/date,
  education, and omitted sections never become targets. Oversized fixtures prove complete
  JSON stays within budget, later job-relevant targets survive, response ids
  outside the selected set are withheld, and the omitted count round-trips
- one malformed, unknown, duplicate, unchanged, or unsupported edit is dropped
  without discarding valid siblings. Malformed optional summary/gap items are
  independently ignored. An all-drop returns Withheld, not a completed proposal;
  explicit empty output can return No changes
- the browser makes one `/api/polish` request per normal Resume Polish run,
  exposes no Tailor/Review/Both selector, and classifies a parsed invalid wire
  result as validation rather than `Parsing error`
- Resume and Cover Letter Polish prompts include a silent pre-response audit of
  evidence, claims, identifiers, and output shape. Probes cover focused,
  standard, and deep wording while provider reasoning effort remains a request
  setting rather than a second audit request
- positive Fit Assessment starts enabled Resume and Cover proposals independently;
  neither automatic request awaits or suppresses the other, and each failure is
  confined to its own document workflow
- `/api/polish` rejects every mode except `resume-proposal` and carries no cover,
  Review, score, or multi-stage request fields
- missing/unready configured providers and missing managed credentials surface
  a clear, user-safe error rather than a silent fallback
- provider failures distinguish authentication, rate-limit/quota,
  configuration, timeout, and generic failures without exposing provider
  bodies; cancellation remains a silent termination/Stop state, not a surfaced
  provider error
- browser disconnect and Stop cancellation reach the active native fetch or CLI
  child process; no hidden request continues and no later stage advances
- prompt-honesty changes prove that JD-only skills are not injected into
  the suggestion list or polished preview; when possible, use a synthetic
  missing-skill case such as a no-Kubernetes resume against a
  Kubernetes-required JD
- resume-proposal and Polish self-audit prompt changes must keep their focused
  offline probes green, including ungrounded terms, invented numbers, invalid
  targets, and all-withheld outcomes
- prompt-budget changes must add probes that build oversized structured
  payloads, extract each emitted JSON fragment (`editable_targets`,
  `resume_context`, `proposed_changes`, or equivalent), and parse it again;
  serialized JSON must never be truncated by raw character count. Resume target
  selection must also prove it avoids prefix-order bias and sanitizes against
  only the selected targets
- job-analysis grounding changes must cover `roleDescription` and `jobType`
  alongside title/company/location, including negated, benefits-only, and
  qualification-only wording that must not false-ground tracking metadata
- the Job analysis rename contract must keep current code and docs free of the
  retired term except for explicit rejection probes and intentional historical
  release/continuity records
- compact Fit Assessment probes must prove that disabling it omits resume/context
  data entirely, enabled Prepare requests Job analysis plus fit in one prompt,
  invalid fit preserves valid job fields, the prompt contains the direct rubric
  as one identical system-level block in combined and reassessment paths, includes
  the conservative lower-category and stable posting-order tie breaks, all
  match/gap/eligibility anchors are exact current-source excerpts without
  whitespace rewriting, both sides of accepted match evidence reach the client,
  every non-Limited verdict has at least one accepted match, public lists cap at
  three and reject duplicates, malformed enums or anchors fail unavailable,
  `CHECK` preserves its posting condition, `BLOCKED` preserves that condition
  plus the explicit conflicting candidate fact, fixed public summaries replace
  provider prose, and reassessments omit the Job analysis schema
- `src/lib/__evals__/ai-job-analysis-request-eval.mjs` must exercise the one
  browser request boundary with combined and reassessment success, provider HTTP
  failure, unreadable and invalid responses, network failure, and abort
  propagation and server-resolved provider/model/reasoning/attempt metadata.
  Focused lifecycle and entry-point guards must keep one endpoint request helper
  and one Fit Assessment outcome helper so entry paths cannot grow separate
  settlements
- `src/hooks/__evals__/job-intake-entry-points.mjs` executes URL, paste,
  extension, and imported-posting Retry intake with both duplicate gates, local
  and provider fallback, prepared-resume resolution, Fit Assessment on/off, and
  snapshot commit order. They also prove the separate first Fit remains awaited,
  identical Prepare runs receive distinct automation receipts, queued intake
  captures settings only after it owns the lock, and settings changes during
  readiness invalidate stale execution context. Stop, source changes, and restore
  cancel in-flight resolution, while too-short and thrown-error paths settle Fit
  out of `running`. Structural guards keep all four entry points on the single private
  post-acquisition coordinator
- auto-polish policy probes must cover every categorical threshold boundary,
  preserve the threshold values/order/labels, and keep automation policy out of
  the shared Fit Assessment contract
- resume proposal probes must keep category labels out of the target set, allow
  grounded list reordering/additions, reject category substitutions, job-only
  skills, every upward ownership inflation (including level 1 to 2), and
  `spearheaded`/`oversaw`/`orchestrated` inflation; unrelated sibling or broad
  context leadership cannot authorize the target, and safe sibling edits remain
  preserved
- application storage probes must prove compact Fit Assessment snapshots
  round-trip while numeric scores, full recruiter reviews, and missing-skill
  compatibility fields are omitted at the storage boundary. Current preview
  field names are strict; a contract rename requires an explicit private data
  rewrite rather than a runtime alias
- when Job analysis or Fit Assessment fails, Prepare keeps the immediate local
  brief editable and manual Polish available; Fit Assessment is separately
  retryable and cannot invalidate valid job fields. Resume Polish failure or
  Withheld keeps the current resume unchanged and locally retryable
- duplicate warnings before or after Job analysis must distinguish exact saved
  applications, interested drafts, and similar matches. Opening/continuing an
  existing record prevents the current and every downstream AI request; new
  work captures a posting relationship; high/possible matches require Link or
  Keep separate; and the decision is acknowledged for that target so the
  pipeline does not prompt twice
- cover-letter tailoring and application-answer generation have no local
  fallback and retain their own retryable task progress. Cover-letter probes
  must prove the **one-click contract**: a template-only starter, a blank
  document, and every base-variant job family reach Polish with zero extra
  fields; only a missing name/role/company or an unanswered private slot
  blocks; a recipient named in the source survives and an impersonal greeting
  falls back to the company hiring team; markdown links, citations, array
  indexes, and escaped brackets stay literal. Probes must show the normal path
  is exactly one provider request, that a violation triggers exactly one silent
  repair carrying its reasons, and that a second failure fails closed with the
  existing letter kept. Rejections must cover unknown evidence or slot ids, an
  uncited paragraph, a residual template token, a body-level greeting or
  sign-off, a missing role or company, generic phrasing, and ungrounded
  candidate terms, numbers, and outcomes — while an employer-subject sentence
  drawn from the posting must not widen candidate evidence. Length is asserted
  as a warning, never a gate. The thirteen-fixture synthetic corpus spans
  general full-stack, frontend, backend/platform, healthcare, applied AI, a
  role whose strongest lead is not the most prominent project, relevant
  AI-workflow honest context, and honest context that must be omitted; it
  grades evidence grounding, resume-dump behavior, generic language, exact
  correspondence, role/company specificity, word range, and page count. It is
  offline by default; run the real-provider harness deliberately with
  `npm run eval:live:cover-letter --workspace apps/role-fit-ai -- [fixture-id|all] [runs]`.
  Both halves use only the tracked synthetic corpus: neither reads ignored
  `workspace/cover-letters/` variants or copies personal letter text into a
  fixture, console output, or provider request.
- Fit Assessment has a manual synthetic consistency calibration:
  `npm run eval:live:fit-assessment --workspace apps/role-fit-ai -- [fixture-id[,fixture-id]|all] [runs]`.
  It runs three to five repetitions through both combined Prepare and standalone
  Retry prompts, measures verdict and eligibility distributions, non-adjacent
  jumps, invalid responses, provider errors, repairs, and material-theme overlap,
  and writes full synthetic receipts under gitignored
  `workspace/fit-assessment-eval/`. `EVAL_PROVIDER`, `EVAL_MODEL`, and
  `EVAL_REASONING_EFFORT` select one supported configuration; `EVAL_MATRIX`
  accepts a JSON array of supported configurations. `EVAL_REPORT_ONLY=1`
  recomputes the aggregate from existing receipts without provider calls. The
  runner stops one provider configuration after its first provider failure and
  is explicitly excluded from `npm test`.
  Its seventeen tracked fixtures include the four verdicts, three eligibility
  states, prompt injection, preferred-only gaps, adjacent technologies, unshown
  years/degree, project-accepted entry-level work, specialized production-AI
  gaps, partial compound requirements, one isolated duration gap, and a content-
  poor application form. Private corpus calibration stays gitignored and is
  reported only through anonymized aggregate counts.
- Resume Proposal has a separate synthetic-only live smoke harness:
  `npm run eval:live:resume-proposal --workspace apps/role-fit-ai -- [runs]`.
  Every run checks an aligned fixture where `NO_CHANGES` is valid and an
  improvable fixture that must yield at least one safe proposal. It independently
  verifies allowed target ids, locked skill labels, grounded tools/numbers/outcomes,
  and target-specific ownership. It reads no workspace resume, prints only status/count summaries, writes full
  synthetic receipts under gitignored `workspace/resume-proposal-eval/`, and is
  never part of `npm test`.
- resume import (`.txt` / `.md` / `.csv`, or paste) reaches the structured editor
  as a one-time conversion into `ResumeData`; a `.resume` file loads its
  `ResumeData` directly, and export offers PDF + `.resume`
- cover-letter import accepts `.cover`, `.txt`, and `.md`; `.cover` round trips
  its optional shared header, ordered paragraphs, and cover-specific print style
  without session ids, accepts only the current schema v1 shape, rejects
  malformed/unknown data and every other version, and editor/PDF output uses the
  cover-letter layout
- `workspace/` reads / writes stay inside the workspace; tracker and
  base-resume mutations are serialized/atomic, duplicate application ids are
  rejected, stale same-record tracker writes return `409` with the current
  snapshot, only sparse tracker mutations are accepted, server-authoritative
  unmutated rows retain deterministic ordering, successful own writes retain
  unchanged record references, and corrupt application JSON or malformed strict
  `.resume` data fails closed without destructive reseeding
- portable workspace backup includes only app-managed resumes/history, tracker
  data, saved application `.resume` / `.cover` sources and PDF-only
  replacements, and canonical allowlisted workspace preferences; validates
  decoded sizes and SHA-256 digests; rejects duplicate/traversing paths and
  malformed domain files; excludes standalone saved cover-letter variants and
  their history; and completes backup -> restore -> backup without byte drift.
  Every restore failure must leave the active workspace unchanged,
  a successful restore retains the previous saved workspace as a sibling
  safety copy and stages `source: "restore"` preferences, restore refuses with
  409 while live tab presence is reported, and a corrupt preference record
  never blocks backing up resumes
- routine AI logs remain shape-only and exclude model-authored target IDs,
  free-form error text, provider bodies, and private prompt content

Useful commands:

```bash
npm test --workspace apps/role-fit-ai
npm run test:document-workflows --workspace apps/role-fit-ai
npm run test:server-lifecycle --workspace apps/role-fit-ai
npm run test:editor:browser
npx tsc -p apps/role-fit-ai/tsconfig.server.json --noEmit
npm run dev:rolefit
```

When iterating on a single route, hit it directly with `curl` against
`http://localhost:5181/api/...` rather than driving the full UI. If
port `5181` is already bound, the server is likely already running;
reuse it instead of starting a second `npm run dev:rolefit`.

## Frontend Coverage

Good frontend verification covers:

- affected route renders without runtime / console errors
- changed controls are reachable by keyboard
- loading / data refresh does not cause avoidable layout shift
- API error states show user-safe messaging (no raw provider bodies)
- Prepare is the first/default tab in the PREPARE group and the only production
  job-intake surface: URL fetch and pasted text appear there, no `JobMenu` or
  masthead `jobControl` remains, and the masthead contains only the RoleFit
  identity plus the shared Apply command. Read-only Sessions sits immediately
  above Settings in the bottom studio-rail utilities group, outside
  `OUTPUT_TABS` and the APG tablist
- extension receipt and delivery select Prepare before updating visible intake
  state; every delivered posting and Retry asks the selected provider for Job
  analysis after the local preview is published. Provider failure leaves that
  preview usable, and retry/stale guards cannot apply an earlier posting to the
  current session
- extension intake never launches Resume Polish; multiple saved resume
  variants may still be ranked from their actual strict document contents and
  a clear high-confidence winner selected while the editor is clean, but that
  is source selection, not tailoring, and no variant metadata is persisted
- the prepared-resume resolution runs as REAL sequences rather than source
  regexes (`src/hooks/__evals__/prepared-resume-resolution.mjs`): an import
  arriving before workspace hydration, exactly one saved variant, a
  starter-only workspace, a ranked winner, option addition/deletion during a
  read, a same-filename candidate overwrite during a read, a changed candidate
  before adoption, a protected document, and a refused adoption with no stale
  recommendation. `src/lib/__evals__/resume-proposal-decisions-eval.mjs`
  pins content-derived proposal identity, keyed resets, undo, and manual-match
  behavior. `src/lib/__evals__/variant-candidate-reads-eval.mjs` pins ONE
  request per candidate read at 1, 5, and 20 variants for both document kinds,
  and `server/__evals__/workspace-candidate-batch-probes.mjs` pins the batch
  routes' name guards, bounded size, skip-on-corrupt behavior, and that they
  return candidates and nothing else
- a valid Fit Assessment survives a local job-analysis fallback
  (`src/lib/__evals__/job-analysis-fallback-fit-eval.mjs`), and the compact fit
  contract has threshold-boundary, exact-source-anchor, malformed-response, fixed-
  summary, deduplication, and eligibility adversarial probes in
  `server/ai/__evals__/fit-assessment-probes.mjs`
- `src/hooks/__evals__/fit-assessment-lifecycle.mjs` executes combined-request and
  reassessment provenance, canonical source replacement, displayed-brief independence,
  cleared-resume invalidation, provider/model/reasoning identity invalidation,
  friendly-label exclusion, setting-toggle restoration, explicit same-source reassessment,
  and zero-provider-dispatch cases for starter-only, blank-origin edited, and
  40-79-character stub documents
- `src/hooks/__evals__/job-intake-entry-points.mjs` pins the configuration
  boundary: matching Job analysis/Fit Assessment provider triples use one
  combined request, while any difference sends Job analysis without candidate
  evidence and dispatches assessment-only through Fit's provider/model/effort.
- `src/lib/__evals__/workspace-preferences-sync-eval.mjs` pins latest-response
  ownership, protects local edits that arrive during a focus refresh, and proves
  a corrupt canonical record cannot be adopted or seeded from one browser cache.
  `server/__evals__/workspace-preferences-probes.mjs` also refuses later ordinary
  settings writes until that invalid record is explicitly repaired or restored.
  The client probe keeps an unchanged focus adoption from consuming the user's
  next real save;
  `src/hooks/__evals__/application-persistence-guards.mjs` keeps tracker conflict,
  explicit create/update commit ordering, recovery clearing, and modal-save
  failure contracts covered after the retired monolithic workflow guard was
  removed. `src/lib/__evals__/preparation-application-commit.mjs` proves fresh
  Apply creates, interested-draft Apply updates the same id, later-stage updates
  preserve identity/date/stage, missing explicit targets fail closed, and all
  primary surfaces use the shared action descriptor.
  `src/hooks/__evals__/duplicate-relationship-resolution.mjs` executes the
  multi-choice duplicate gate, exact-draft continuation, confirmed linking,
  remembered Keep separate decisions, and the create-then-atomic-link boundary;
  it also pins destructive merge as a separate tracker operation.
  `src/lib/__evals__/not-applying-application.mjs` proves new, draft, repeated,
  and update-only Not applying commits; job-only AI provenance; decision-date
  preservation; sent-artifact removal; exact dialog/receipt copy; and that the
  quiet action remains in Prepare rather than the masthead. The storage probes
  additionally verify decision metadata roundtrips while `appliedAt` and sent
  document fields are omitted.
  `src/lib/__evals__/explicit-application-write-targets.mjs` proves first-answer
  draft creation, exact-id answer updates, missing-target failure, document-sync
  ID ownership, relationship handling, and the absence of the retired
  `findForTarget` and ordinary `upsert` write APIs.
  `src/lib/__evals__/application-status-transitions.mjs` pins the forward-only
  status graph, including the interested-to-Not-applying decision and the ban on
  rewriting submitted or terminal history. `src/lib/__evals__/prepared-source-replacement.mjs`
  exercises same-posting corrections, reused generic URLs, conflicting posting
  ids, and the update-mode guard order/copy that runs before duplicate review or
  provider analysis.
- URL and paste intake remain enabled without an AI provider and produce the
  deterministic local brief; only provider-backed enrichment stays unavailable
- Fit Assessment shows only verdict, selected resume, summary, up to three
  compact match explanations and gaps, and a relevant eligibility warning with
  its accepted anchors. It exposes no score, confidence, broad evidence ledger,
  recommendation, saved audit, or analytics metric
- changing the selected resume dispatches only `mode: "fit-assessment"`; disabling
  Fit Assessment sends no resume/context data. Resume and Cover Letter each use an
  independent automatic Polish switch and categorical minimum-fit threshold;
  `CHECK` remains eligible and only `BLOCKED` stops a threshold match. Manual
  Polish remains available for every fit state
- Fit Assessment never derives tracker priority: explicit user priority wins,
  Interviewing/Offer may derive High, and every other record defaults Medium;
  `fitAssessmentRank` remains available for explicit sorting
- Resume and Cover Letter render the same material-card structure with separate
  variant selectors and Include toggles, neither is labeled optional, and a
  fresh prepared job starts with Resume included and Cover Letter excluded
- masthead and Prepare primary actions invoke the same handler, action copy, and readiness model:
  a matching completed preparation is required, each included material must be
  ready while its work is idle, neither material is required, and non-empty
  source alone remains blocked. Applying with both excluded records the job;
  excluding a previously saved material on a later update preserves that artifact
- every prepared JD field can be corrected locally on Prepare after partial or
  failed extraction without invalidating the matching prepared source snapshot:
  tracked job facts through one role context, responsibilities, required/preferred
  qualifications, technical keywords, seniority/domain signals, and benefits.
  Deterministic extraction gaps remain visible until addressed; View
  source and Prepare again retain the captured posting, Apply stores the full
  corrected brief, and reopening restores benefits without adding them to the
  Resume Polish projection
- opening a stored application validates its job and strict document sources,
  preserves the dirty-document confirmation, restores the session, and lands
  on Prepare through **Continue preparation** for an interested draft or **Edit
  preparation** for an acted-on record
- Applications routes its new-work action to Prepare, while its modal edits
  existing committed records and exposes no independent job-intake controls
- a failed cover-letter request stays local to its page with safe retry copy and
  typed bounded issues, never replaces the letter, and filters unfinished
  Guidance prompts at both evidence boundaries; a successful one stages a
  fingerprinted whole-letter proposal, only explicit acceptance loads it into
  the editor with an exact one-click Restore, and that Restore plus its result
  summary disappear together the moment the user edits, opens another document,
  or runs Polish again. Duration grounding covers equivalent word and digit forms
- the owned typeset page stays the sole editor and live preview; the tracker may
  render or open a saved application document as PDF. Resume's proposal rail
  shows only What improved, Edits ready, and a withheld line;
  individual cards support Accept/Edit/Discard and still highlight their exact
  editor field, while no evidence/risk/keyword chips return
- production builds keep `TrackerTab`, `AnalyticsTab`, and
  `ApplicationModal` in lazy chunks, and opening each surface loads cleanly
- components reuse shared CSS classes and tokens from `src/styles/` instead of
  one-off styles
- AI setup renders every configured stage expanded together with no
  per-section collapse control or persisted collapse state; only explicitly
  configured providers appear, configured-but-unready selections stay visible
  and disabled, and no API key appears in DOM, browser storage, or HTTP requests
- at 720px and below, only precise Resume authoring is replaced by the width
  notice; Prepare, masthead/navigation, Cover letter, Materials, Applications,
  and Analytics remain reachable, including under high browser zoom
- Sessions and Settings remain reachable in order in expanded and collapsed
  rail states; the compact Sessions count/working indicator remains visible,
  its popover opens rightward without viewport clipping, and it is absent from
  output-tab arrow/Home/End navigation
- job-import analyzer changes prove the before/after shape without
  printing raw private text: the resulting structured brief should keep role
  intro / responsibilities / requirements while stripping empty bullets,
  apply/navigation furniture, duplicated titles, low-value Workday
  metadata, company/culture marketing, and trailing benefits / legal
  boilerplate
- shared-engine integration changes keep
  `src/typeset/__evals__/linebreak-snapshot.mjs`,
  `vertical-layout-snapshot.mjs`, and `pdf-roundtrip.mjs` green. The PDF probe
  emits every supported family and face, covers shaping/links/underlines, and
  exports a multi-page cover letter. Set `ROLEFIT_PDF_AUDIT_DIR` to an ignored
  or temporary directory when external-viewer artifacts are needed. These are
  RoleFit integration and migration guards; the canonical engine checks live
  under `packages/engine/`
- editor changes keep the shared
  `packages/editor/src/sections/editor/__evals__/typeset-editing.mjs` and
  `packages/editor/src/hooks/__evals__/resume-editor-structure.mjs` checks green
  so display/value mapping, history coalescing, and summary split/merge remain
  atomic
- `npm run test:editor:browser` uses headless Chrome through the DevTools
  protocol to exercise header mark preservation and undo, disabled open
  controls, popover focus return, one-block rich document paste, the Typeset
  explicit-save dirty baseline, and live two-tab workspace adoption

Useful commands:

```bash
npm run build:rolefit
npm run dev:rolefit
```

`npm run build:rolefit` runs the RoleFit workspace build. Run it
before finalizing whenever frontend source or types changed.

## Public Product/Download Page Coverage

The public page is a separate build and security boundary, not a Drafting Desk
route:

```bash
npm run build:rolefit:landing
npm run test:landing --workspace apps/role-fit-ai
```

The build must emit only `apps/role-fit-ai/dist-landing/`. Its guard requires
the public marker and one landing manifest entry and rejects known loopback
origins and product API paths. The offline release probe covers valid complete
signed and unsigned-preview releases, signed-release precedence, and malformed
tags, mismatched draft/prerelease state, wrong origins, zero-sized, missing,
duplicate, and unexpected assets.

Real-browser QA must cover desktop and 390px widths, a clean console, keyboard
focus, and both release states: the live empty/unavailable response links every
platform row to GitHub Releases, while mocked complete signed and unsigned
preview releases produce the exact Apple silicon DMG/ZIP, Intel DMG/ZIP,
Windows x64 EXE, and checksum links. Preview QA must show the unsigned warning
and format labels at both widths; a signed release must outrank every preview.
Request inspection must show only static page assets and public
`api.github.com` release metadata, never RoleFit `/api/*`, localhost probing, or
companion detection.

## Browser / Provider Companion Coverage

Companion static policy checks are part of the RoleFit `check` gate. The process
integration smoke stays explicit because it launches Electron:

```bash
npm run build:rolefit:desktop
npm run test:desktop:vault --workspace apps/role-fit-ai
npm run test:desktop:security --workspace apps/role-fit-ai
npm run test:desktop:contracts --workspace apps/role-fit-ai
npm run test:desktop:cli --workspace apps/role-fit-ai
npm run test:desktop:settings --workspace apps/role-fit-ai
npm run test:desktop:ipc --workspace apps/role-fit-ai
npm run test:rolefit:desktop
```

The browser remains the product host, so companion verification must prove that
Electron renders only its compact local setup page, never the Drafting Desk,
and does not own workspace/tracker files. Focused companion probes should cover:

- numeric-loopback-only server start, explicit compatible/foreign conflict
  outcomes, closed companion/standalone launch provenance, private-handle-only
  ownership, graceful-only POSIX Stop/Restart, listener-PID parsing for
  `lsof`/`netstat`, alternate-port persistence, owned process shutdown, and
  rejection of mode/workspace/arbitrary-listener mismatch;
- a strict local-file CSP, denied renderer permissions, absent Node globals,
  blocked renderer `window.open`, and main-owned external targets reachable
  only through fixed typed IPC methods;
- exact trusted main-frame and exact `file:` URL validation for every IPC call,
  a frozen self-contained preload, fixed named methods, and rejection of unknown
  providers or extra arguments;
- desktop API 13 extension setup copy probes for **Copy path**, **Copy port**,
  the exact Chrome/Edge/Firefox address targets, closed target validation, main-owned
  clipboard writes, sanitized failures, and no returned renderer path or
  renderer clipboard permission; companion UI coverage also verifies native
  click-to-copy buttons, local hover/focus feedback, no panel-wide render call,
  and one visually hidden polite status region;
- extension bundle materialization after active-server resolution, strict
  first-install-seed validation, packaged inclusion of `settings.js` and
  `runtime-config.js`, and
  read-only pairing controls whenever the current companion does not own the
  service;
- fake-encryption/file-adapter cases for API-key save/remove, atomic versioned
  registry round trips, malformed input, insecure-backend refusal, and proof
  that saved keys never appear in IPC results, HTTP, logs, argv, environment, or
  browser storage;
- shape-only installed/signed-in/signed-out/unknown CLI status with no executable
  paths, account identifiers, environment values, tokens, stdout, or stderr;
- installed/configured Antigravity is request-eligible as ready-to-verify while
  `authState` remains unknown; it is never labeled signed in, and the first
  actual provider request owns authentication verification and recovery errors;
- fake-binary cases for absent, malformed, timed-out, and oversized status
  output, plus fixed external-terminal sign-in argv, the install/sign-in-guide
  URL opening, sanitized child environments, and redacted failures;
- the default/saved/environment local-site-port states, integer/range and
  occupied-port rejection, atomic settings persistence under isolated
  `userData`, environment locking, and `Apply & restart` using the normal clean
  quit/relaunch lifecycle;
- `Open RoleFit` launching the selected `http://localhost:<port>` in the system
  browser without granting privileged IPC to that browser content;
- private owned-server provider snapshots, atomic replacement/clearing, a
  shape-only `/api/providers` response, an empty authoritative snapshot before
  listening, disabled `.env` loading/no managed credentials in the owned child
  environment, refusal to inject vault data into a reused standalone listener,
  rejected provider mutations while that reused listener remains active, and a
  main-owned refresh after the setup renderer closes;
- browser selectors showing only configured providers, preserving unready
  selections without a paid fallback, disabling only AI when none exist, and
  awaiting initial discovery for extension Job analysis instead of
  recording a transient loading state as failure;
- browser autosave/editor/tracker behavior remaining independent of Electron,
  plus the existing `npm run dev:rolefit` and extension contract staying green;
- extension analyze/import rejecting unapproved extension callers, accepting
  and reflecting only exact configured Chrome/Firefox/Safari origins, allowing
  valid unapproved origins to enqueue only a bounded short-lived pairing
  request, and rejecting near-match, path-bearing, absent, malformed, and
  oversized identities without CORS;
- extension preparation omitting retired `autoTailor`, `distillAi`, and
  pre-extracted `fields`, while preserving `extensionImport`, `claimToken`,
  `tabId`, and the `"preparing"` progress contract;
  sending the same claim token in the import body and fresh-tab query; claiming
  a reserved inbox entry only from its intended tab; opening an independent tab
  in the current Firefox container when available with the ordinary fresh-tab
  fallback elsewhere; and keeping duplicate, required-AI, retry, and stale-response
  guards intact;
- same-port status rejecting a wrong service before any posting text is sent,
  returning only the marker plus `paired:false` for a privileged origin-less
  GET, rejecting invalid explicit origins and origin-less preflights, separating
  unavailable from unpaired state, and never enqueuing pairing;
- changing app ports being reported as a new browser-storage origin, the
  materialized runtime config remaining only an install seed, saved extension
  storage winning, and popup Settings reconnecting without an extension reload;
- both extension entry points — the popup button and the `import-job` keyboard
  command — clearing the same `confirmPairedService` gate before any page text
  is sent, opening no request path of their own, and adding no permission
  beyond the popup's `activeTab`/`scripting`/`storage`/`cookies` set;
- the keyboard command declaring a Chrome service worker and a Firefox event
  page over one module, guarding against a held-key burst of duplicate imports,
  and recording a bounded, TTL-expiring one-shot failure notice that the popup
  shows and clears without ever blocking the port record from loading;
- every local extension request carrying an abort timeout, with a timed-out
  request reported differently from an unreachable port, verified end to end
  against a stub that rejects on abort exactly as `fetch` does;
- each extension failure reaching the recovery that fits it: only a failed
  status handshake offers the port form, a slow analyze offers retry, and an
  unanswered pairing request reports approval as unconfirmed rather than missing;
- an import failure remaining visible after a successful reconnect, and a
  completed import reaching a terminal labeled state instead of a permanent
  "Preparing" — both exercised against a stub that fails only the import call;
- the popup's live region persisting outside the re-rendered root and carrying
  progress text, and keyboard focus surviving a render: restored to the same
  control on a same-view rebuild, parked on the new view when the control is
  gone, and never taken on first paint. The browser-QA pane runs unfocused, so
  `.focus()` there sets `activeElement` without firing `focusin`; dispatch the
  event explicitly or the focus tracker looks broken when it is not;
- the loadable extension directory containing no reserved `_` name, nothing
  beyond the shipped set defined once in `desktop/extension-bundle.cts` plus its
  two guides, and no missing shipped file — while tolerating dotfiles the
  browser ignores;
- no live provider login, hosted-page CORS/pairing, or paid AI call during
  automated verification.

Automated smoke must not replace the operator's current OS clipboard contents.
Instead, executable helper and IPC probes cover every exact copied value and the
main-owned writer callback, source inspection pins that callback to Electron's
`clipboard.writeText`, and the real Electron smoke dispatches pointer-leave and
blur through the installed renderer listeners. The final OS clipboard click is
manual visual QA.

The existing desktop script names remain the command entry points while the
source layout converges on the companion contract. A smoke that still passes by
loading the React app in a `BrowserWindow` does not satisfy this coverage; the
window must load only the static companion surface.

## Packaged Companion And Release Coverage

Use Node 24 for Forge packaging. Package and smoke only on a matching native
host: macOS arm64/x64 or Windows x64. Cross-compilation is intentionally
rejected.

```bash
npm run build:rolefit:desktop:package
npm run test:desktop:package-layout --workspace apps/role-fit-ai
npm run package:rolefit:desktop -- --arch=arm64 --platform=darwin
npm run test:rolefit:desktop:packaged -- --arch=arm64 --platform=darwin
npm run make:rolefit:desktop -- --arch=arm64 --platform=darwin
npm run collect:desktop:artifacts --workspace apps/role-fit-ai -- --arch=arm64 --platform=darwin
npm run test:rolefit:release
```

Use `--arch=x64 --platform=darwin` on an Intel Mac and
`--arch=x64 --platform=win32` on Windows. Generated staging, unpacked apps,
maker output, and normalized artifacts live beneath
`apps/role-fit-ai/.forge/` and remain untracked.

The staged-layout probe must reject `.env`, personal workspace/provider data,
tests, source maps, unrelated workspace apps, and any `.resume` other than the
bundled starter. The packaged process smoke starts from a foreign working
directory with isolated `userData`, verifies the browser bundle/font/workspace
and vault locations, then proves clean utility-server shutdown and
port release. Native release verification additionally checks the macOS app,
ZIP, and DMG signatures/notarization or both the Windows app executable and
installer Authenticode signature plus trusted timestamp. Windows then silently
installs that exact normalized setup, invokes the common packaged smoke with
the absolute installed executable, uninstalls through Squirrel in `finally`,
and verifies the install root was removed.

The release-contract tests remain offline: they verify canonical
`rolefit-vX.Y.Z` tags, package-version equality, main ancestry, exact artifact
names/counts, and publication fail-closed behavior. An actual signed release is
not a local test. It requires `rolefit-macos-signing`,
`rolefit-windows-signing`, and `rolefit-release` GitHub environments restricted
to `rolefit-v*`, protected `rolefit-v*` tags, CI secrets, and the publish-time
remote-tag commit recheck.

## Chrome Visual QA

Chrome visual QA is flag-first: skip by default, flag changes with real
layout/theming risk, and let the user decide. When it runs, check:

- for public landing changes, the complete desktop/390px page, release status,
  installer rows, and absence of horizontal overflow;
- the affected control in the Prepare + studio workflow
- Sessions/Settings reachability and ordering in the expanded and collapsed
  studio rail, including the rightward viewport-bounded Sessions popover and
  its exclusion from APG output-tab navigation
- the typeset editor itself (its own WYSIWYG preview), rather than a legacy HTML
  editor or a separate compile-preview surface
- tab open/close behavior in the output panel when tabs changed
- no overlapping text or controls in resume / output panels
- no spinner / loading / shimmer effects unless requested
- long resume / job-description text wraps without overlap

For tiny copy or class-only edits, visual QA may be skipped with a
short reason.

## Refactors

Good refactor verification proves behavior parity:

- `npm run build:rolefit` succeeds
- grep for old symbol names returns no meaningful hits after renames
- no new imports of deprecated paths
- affected call sites still use the intended public interface
- the AI polish path still works, and a failed AI call surfaces a specific,
  retryable failed step without running any later selected step; Job analysis may
  keep its deterministic brief, but the failure remains a failure

Avoid drive-by refactors. Refactor only when the current task requires
it, the existing structure blocks correctness, or the improvement can
be verified safely.

## Docs-Only Changes

For docs-only changes:

- no frontend build or server check is required
- verify paths and links exist
- run a spelling / grep sanity check when useful
- update root `CONTINUITY.md` for cross-workspace decisions and the app ledger
  only for RoleFit-specific operational state

Document skipped runtime checks as not applicable.
