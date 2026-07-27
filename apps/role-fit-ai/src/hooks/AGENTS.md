# RoleFit Hooks Guide

Applies to `apps/role-fit-ai/src/hooks/`. Hooks own product workflows and
browser-side effects; components render them and App composes them.

## Ownership

- `useJobIntake` owns link/paste/extension import, Distill progress/retry, and
  auto-polish intent.
- `usePolishPipeline` owns Tailor/Review orchestration, abort/retry, and progress.
- `useDuplicateGuard` owns duplicate acknowledgments and pipeline/apply gates.
- `useDuplicateScan` owns the Applications tab's tracker-wide duplicate
  clusters: it schedules the O(n²) scan after first paint, cancels a pending
  scan on unmount or a changed scan identity, and rehydrates the cached
  id-based result against the live applications array. It deliberately depends
  on the scan identity rather than the array, so per-keystroke notes edits
  cannot starve a pending scan. Clusters are never cached as records — the
  merge modal reads current status, dates, artifacts, and attachments.
- `useAiSettings` owns per-stage provider/model/effort preferences, never API
  credentials.
- `useAvailableProviders` owns the one same-origin provider-registry fetch and
  reconciliation lifecycle. It keeps the closed catalog metadata separate from
  configured/readiness state and must not silently select a paid replacement.
- `useWorkspaceResume`, `useApplyFlow`, `useApplications`, and
  `useApplicationFiles` own their local server/storage lifecycles.
- `useApplicationDocumentSync` owns the session's application link and the two
  explicit per-document saves that follow Apply. Saving is always user
  initiated; no effect may write a document into an application.
  `useApplicationFiles` sends the current application revision and refreshes
  the authoritative tracker after the server atomically commits one strict
  source or explicit PDF with that document's metadata. Saved-state comparison
  includes the complete source fingerprint, so style-only edits remain
  retryable and updating one document never rewrites the other.
- `useResumeEditor` is a RoleFit adapter over the shared editor hook; keep
  reusable history/reducer behavior in `@typeset/editor`.
- `useCoverLetterEditor` owns RoleFit's separate letter/file/export lifecycle
  while delegating history, editing, layout, and PDF to the shared packages.
  `useCoverLetter` owns only its grounded AI revision workflow.
- Both editors recover unsaved work the same way: `useAutosaveDraft` and
  `useCoverLetterAutosaveDraft` each own one document's debounced draft, over
  the shared per-tab rules in `lib/autosaveDraftStorage.ts` (tab scoping, live
  siblings, orphan migration, expiry). A draft is cleared only where its own
  document becomes durable, and a restore seeds CLEAN so a crash right after it
  still has something to recover. The letter has no separate pre-tailoring
  restore: the AI reseed clears editor history, so its recovery lives in the
  draft and the workspace variants/history, as it does for the resume.
- Every user-initiated load in that hook goes through its own `openDocument`
  rather than the shared `seedData`, so no open path can forget to fire
  `onOpenDocument` (the host's "put the caret in the new letter"). Applying a
  TAILORED result deliberately calls `seedData` directly: it is not an open.
  The resume side gets the same guarantee by wrapping `seed`/`seedData` in App
  before they reach `useWorkspaceResume`.

## Rules

- One state owner per workflow. Return state and intent-level actions; do not
  expose setters when a named action can preserve invariants.
- Keep async sequencing fail-closed. Only a `done` stage may advance. Preserve
  abort controllers, retry provenance, and stale-input guards inside the owner.
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
- Automatic extension imports must await both the shared initial provider fetch
  and an authoritative applications snapshot; transient `loading` is not a
  terminal provider failure, and duplicate gates must never inspect the
  mount-time empty applications array. Provider readiness is a preflight
  signal, not semantic request input, so background readiness polls must not
  invalidate an already-running AI request.
- Distill stale-input guards cover only the job source and Distill-stage AI
  settings. Resume bootstrap and Tailor-mode reconciliation are downstream
  auto-Tailor inputs; they must not cancel an extension Distill that is already
  running.
- Add a focused eval for durable sequencing, identity, or state-transition
  rules that can be tested without React/browser orchestration.
