# RoleFit Hooks Guide

Applies to `apps/role-fit-ai/src/hooks/`. Hooks own product workflows and
browser-side effects; components render them and App composes them.

## Ownership

- `useJobIntake` owns Prepare's link/paste/extension intake, immediate local
  preview, Job analysis progress/retry, and compact Fit Assessment lifecycle. Its extension progress callback
  and first delivered-posting callback select Prepare before visible intake
  state changes; claim tokens and fresh-tab ownership remain transport
  concerns. The imported snapshot carries the complete editable Prepare brief,
  including benefits and extraction gaps, alongside the exact model-facing
  tailoring text. Job analysis and Fit Assessment settle independently in both
  directions — a local job-analysis fallback keeps a valid screening — and a fit
  retry or resume change must not rerun Job analysis. Matching provider/model/
  effort settings may use one combined request; different settings must commit
  Job analysis and dispatch Fit Assessment through its own stage configuration.
  Intake does not choose the
  resume: it calls `usePreparedResume` once per preparation and records the fit's
  provenance as content fingerprints of exactly what it sent. Combined and
  assessment-only results must pass through one private Fit Assessment outcome helper so
  ready/unavailable state and provenance cannot drift by entry path. URL, paste,
  extension delivery, and imported-posting Retry keep acquisition and recovery
  copy local but share one private post-acquisition coordinator for duplicate
  checks, preview, prepared-resume resolution, analysis/fallback, snapshot
  commit, and fit settlement. Opening a tracked application hydrates the same
  retained prepared-job receipt. Its compact saved assessment is historical —
  visible and reassessable, but never eligible to trigger automatic Polish —
  because tracker storage cannot reconstruct exact current-input provenance.
  Current-result provenance derives a structured job/resume/candidate-context/
  assessment-setup change list. An out-of-date state retains the timestamped
  snapshot for display as a previous assessment, while its non-ready status keeps
  it out of automation. Do not replace that receipt with a generic stale string.
- `usePolishPipeline` owns the one-request Resume Polish proposal, abort/retry,
  stale-request cancellation, and progress. It must not dispatch the Review
  provider or expose the retired Tailor/Review/Both selector. It stages flat-ID
  edits and outcome metadata without seeding or replacing the editor.
- `useResumeProposalDecisions` owns accept/edit/discard for the proposal's
  individual edits. It lives above the review list because the resulting resume
  only exists once every edit has a decision, and that is when the check runs;
  `outstanding` re-derives from the live document so an undo makes an edit
  pending again. Its proposal key includes outcome, target id, original text,
  replacement text, and reason. A changed key derives empty decisions during
  render and initializes keyed state only from the next user decision.
- `useDuplicateGuard` owns duplicate acknowledgments and pipeline/apply gates.
- `useDuplicateScan` owns the Applications tab's tracker-wide duplicate
  clusters: it schedules the O(n²) scan after first paint, cancels a pending
  scan on unmount or a changed scan identity, and rehydrates the cached
  id-based result against the live applications array. It deliberately depends
  on the scan identity rather than the array, so per-keystroke notes edits
  cannot starve a pending scan. Clusters are never cached as records — the
  merge modal reads current status, dates, artifacts, and attachments.
- `useAiSettings` owns per-stage provider/model/effort preferences and the
  candidate-declared About you profile, never API credentials. Browser storage
  is a fail-open cache; `lib/workspacePreferencesSync.ts` makes the owner-only
  workspace preference file canonical across browsers/origins and reconciles
  live hook state after a startup/focus adoption.
- `useAvailableProviders` owns the one same-origin provider-registry fetch and
  reconciliation lifecycle. It keeps the closed catalog metadata separate from
  configured/readiness state and must not silently select a paid replacement.
- `useWorkspaceResume`, `useApplyFlow`, `useApplications`, and
  `useApplicationFiles` own their local server/storage lifecycles.
  `useApplyFlow` consumes the shared readiness result used by both masthead and
  Prepare controls; it requires the prepared job and readiness only for
  included materials. It captures the Resume/Cover Letter Include selection
  before duplicate or download dialogs, permits either or both to be excluded,
  and leaves a previously saved excluded artifact untouched on re-Apply. Apply
  stores the complete editable prepared brief (including benefits) while
  Resume Polish receives the benefits-excluded model-facing projection. The captured
  posting remains immutable and separately persisted even when it initially
  matches that prepared projection.
  `useWorkspaceResume` may read actual saved resume documents to support
  Prepare's deterministic recommendation, but that decision stays session-only
  and never adds persisted variant metadata. It reads every variant through one
  batch request (`lib/baseResumeWorkspaceRepository.ts`), caches the result
  against a candidate revision, and exposes a settled signal callers await
  instead of sampling `isWorkspaceBootstrapping` mid-flight. Authoritative
  workspace snapshots invalidate both the ranking key and the cached bytes,
  because a saved variant can change without changing its filename; automatic
  selection must also cancel before commit if the session becomes linked to an
  application of record.
- `usePreparedResume` owns the ONE prepared-resume resolution for a
  preparation. The ordering rules live in `lib/preparedResume.ts` — pure, so the
  hydration wait, the terminal states, and the adoption guards are executable in
  tests rather than only inspectable as source. Do not reintroduce a second
  selector or a post-preparation re-ranking effect for the resume. Candidate
  bytes, ordered option metadata, and the numeric candidate revision must share
  one snapshot. Read the live revision at resolution time so a same-filename
  overwrite invalidates an in-flight read; retry one changed snapshot, then
  retain current. The guarded loader returns the exact committed
  document receipt, failed adoption clears the recommendation, and cancellation
  clears both the recommendation and visible resolving flag.
- `useApplications` sends only mutation-named upsert records, keeps optimistic
  updates serial, and reconciles successful own-write snapshots by id/revision
  so unchanged objects retain identity. Manual refreshes and conflict snapshots
  remain fresh authoritative objects.
- `useApplyFlow` persists the latest completed Fit Assessment as an application
  receipt independently of material inclusion. A stale snapshot is still the
  latest completed assessment and must be saved; when the session has none,
  re-Apply preserves the existing application snapshot instead of clearing it.
- `useApplicationDocumentSync` owns the session's application link and the two
  explicit per-document saves that follow Apply. Saving is always user
  initiated; no effect may write a document into an application. Apply or
  tracker restore establishes an application of record, and editing its
  prepared brief must not sever that identity; only fresh intake may release
  the link.
  `useApplicationFiles` sends the current application revision and refreshes
  the authoritative tracker after the server atomically commits one strict
  source or explicit PDF with that document's metadata. Saved-state comparison
  includes the complete source fingerprint, so style-only edits remain
  retryable and updating one document never rewrites the other.
- `useResumeEditor` is a RoleFit adapter over the shared editor hook; keep
  reusable history/reducer behavior in `@typeset/editor`.
- `useCoverLetterEditor` composes RoleFit's separate letter lifecycle while
  delegating file transport to `coverLetterWorkspaceRepository`, export and
  application-artifact construction to `coverLetterExport`, title/baseline
  state to `useCoverLetterDocumentIdentity`, and the exact one-snapshot
  lifecycle to `useCoverLetterPreTailorSnapshot`. History, editing, layout, and
  PDF primitives remain in the shared packages. `useCoverLetter` owns deterministic
  preflight inputs, the single tailoring request, stale-response invalidation,
  one typed blocked-failure state, and one fingerprinted whole-document proposal
  — it never holds the live document. Validate blocked payloads at the loopback
  boundary; a semantic input change clears stale failure state, and only
  `acceptProposal` crosses into the editor and creates the exact
  pre-tailor snapshot; discarding a proposal performs no editor mutation, and a
  changed source letter, job, non-resume evidence, or polishing instruction marks
  it stale without conflating provider selection with document content. A later
  resume edit leaves the already-validated proposal reviewable with a warning
  that it was checked against the earlier resume; accepting a sibling Resume
  proposal must not dead-end the Cover Letter decision. Keep that
  request/proposal boundary in one coordinator:
  splitting its abort refs, fingerprints, and transitions across hooks would
  weaken the atomic transition; extract pure contracts into `lib/`. Restore and
  the applied-result summary share one lifetime (`tailorApplied`), so the rail
  cannot advertise an undo the editor can no longer perform.
- Both editors recover unsaved work the same way: `useAutosaveDraft` and
  `useCoverLetterAutosaveDraft` each own one document's debounced draft, over
  the shared per-tab rules in `lib/autosaveDraftStorage.ts` (tab scoping, live
  siblings, orphan migration, expiry). A draft is cleared only where its own
  document becomes durable, and a restore seeds CLEAN so a crash right after it
  still has something to recover. Accepting a cover-letter proposal also keeps
  one exact in-memory pre-tailor `.cover` snapshot because the AI reseed clears editor
  history; its Restore expires on the next edit, open, or Polish and does not
  replace crash recovery or workspace variants/history.
- `useRestoredScroll` preserves each document tab's reading position across its
  unmount. It receives both the desktop editor scroller and the narrow stacked
  workbench scroller, then resolves the active owner from computed overflow at
  restore and cleanup; do not assume one element owns scrolling at every width.
- Every user-initiated load in that hook goes through its own `openDocument`
  rather than the shared `seedData`, so no open path can forget to fire
  `onOpenDocument` (the host's "put the caret in the new letter"). Applying a
  TAILORED result deliberately calls `seedData` directly: it is not an open.
  The resume side gets the same guarantee by wrapping `seed`/`seedData` in App
  before they reach `useWorkspaceResume`.

## Rules

- One state owner per workflow. Return state and intent-level actions; do not
  expose setters when a named action can preserve invariants.
- Keep document mutations fail-closed. Only accepted Resume Polish edits may
  enter the editor; Withheld is not a completed proposal. Prepare's deterministic brief is independently usable when
  Job analysis or compact Fit Assessment is unavailable. Preserve abort
  controllers, retry provenance, and stale-input guards inside the owner.
  The outer preparation request token is part of prepared-resume resolution;
  Stop, input replacement, restore, and cleanup invalidate both owners before
  adoption. Too-short and thrown-error exits after Fit starts must terminalize
  its visible state instead of leaving `running` without an active request.
- Store hot transient values in refs when they must survive async callbacks
  without driving presentation. Keep visible state serializable and explicit.
- Effects depend on stable primitive/derived signals, not freshly created
  objects. Use functional updates when based on prior state.
- Hooks do not render UI, read component internals, or own shared package
  layout. They may call deterministic helpers and local APIs.
- Surface classified user-safe errors. Never expose raw provider bodies, secret
  values, or private inputs in status text.
- Provider availability effects fetch shape-only state; they never request,
  cache, or infer API keys, account identity, executable paths, or raw CLI
  output.
- Automatic extension intake must await both the shared initial provider fetch
  and an authoritative applications snapshot; transient `loading` is not a
  terminal provider failure, and duplicate gates must never inspect the
  mount-time empty applications array. Provider readiness is a preflight
  signal, not semantic request input, so background readiness polls must not
  invalidate an already-running AI request.
- Automatic variant selection remains on Prepare. It may not replace a dirty
  editor without an explicit user action. When multiple saved resume or
  cover-letter variants exist, compare their actual strict document contents
  with weighted prepared-job sections and auto-select a meaningful unique
  winner while the editor is clean and not application-owned. A tie or
  incomplete comparison keeps the current selection without inventing a
  recommendation. An explicitly uploaded resume is authoritative even while
  clean and is never an automatic-adoption target. A successful automatic proposal run must not force the Resume tab;
  user-initiated Resume Polish retains its normal reveal behavior.
- Job analysis stale-input guards cover the job source, Fit Assessment setting,
  and both stages' AI settings. The selected resume is captured immediately
  before dispatch; later resume changes use the assessment-only request instead of
  cancelling or repeating Job analysis.
- Fit Assessment retains one normalized captured posting for combined Prepare,
  reassessment, provenance, and staleness. The editable displayed brief may
  keep changing, but it never silently replaces that screening source.
- Fit Assessment automation has independent Resume and Cover Letter switches plus
  categorical minimum verdict thresholds. Both switches default off; Resume
  defaults to Reasonable or better and Cover Letter to Strong only. `CHECK`
  remains eligible, only `BLOCKED` stops automatic Polish, and manual Polish
  remains available for every verdict and fit failure. Only the first assessment
  launched by Prepare carries automation eligibility; reassessment, retry,
  resume-change assessment, and restored history default to advisory-only even
  when their verdict clears a threshold. Reuse an unchanged ready fit instead of
  dispatching another provider request.
- Add a focused eval for durable sequencing, identity, or state-transition
  rules that can be tested without React/browser orchestration.
