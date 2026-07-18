# RoleFit Hooks Guide

Applies to `apps/role-fit-ai/src/hooks/`. Hooks own product workflows and
browser-side effects; components render them and App composes them.

## Ownership

- `useJobIntake` owns link/paste/extension import, Distill progress/retry, and
  auto-polish intent.
- `usePolishPipeline` owns Tailor/Review orchestration, abort/retry, and progress.
- `useDuplicateGuard` owns duplicate acknowledgments and pipeline/apply gates.
- `useAiSettings` owns per-stage provider/model/effort preferences and
  transient in-memory API keys.
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
- Add a focused eval for durable sequencing, identity, or state-transition
  rules that can be tested without React/browser orchestration.
