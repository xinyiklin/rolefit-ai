# RoleFit Hooks Guide

Applies to `apps/role-fit-ai/src/hooks/`. Hooks own product workflows and
browser-side effects; components render them and App composes them.

## Ownership

- `useJobIntake` owns link/paste/extension import, Distill progress/retry, and
  auto-polish intent.
- `usePolishPipeline` owns Tailor/Review orchestration, abort/retry, and progress.
- `useDuplicateGuard` owns duplicate acknowledgments and pipeline/apply gates.
- `useAiSettings` owns per-stage provider/model/effort preferences, never API
  credentials.
- `useAvailableProviders` owns the one same-origin provider-registry fetch and
  reconciliation lifecycle. It keeps the closed catalog metadata separate from
  configured/readiness state and must not silently select a paid replacement.
- `useWorkspaceResume`, `useApplyFlow`, and `useApplications` own their local
  server/storage lifecycles.
- `useResumeEditor` is a RoleFit adapter over the shared editor hook; keep
  reusable history/reducer behavior in `@typeset/editor`.

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
