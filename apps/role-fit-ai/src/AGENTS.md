# RoleFit Client Guide

Applies to `apps/role-fit-ai/src/`. Follow root and app guides first. This scope
owns the RoleFit React host and its integration with shared Typeset packages.

## Boundaries

- `App.tsx` composes state owners and shared/app surfaces. Keep new domain logic,
  async workflows, persistence, and complex derived state out of App.
- `hooks/` owns cohesive RoleFit state/effect lifecycles. Read its guide.
- `lib/` owns deterministic RoleFit helpers: job extraction/identity, AI request
  adapters, failure classification, workflow state, downloads, and evidence.
- `resume/` owns deterministic mechanical resume analysis and suggestion/diff
  types. It never calculates fit score or verdict; AI Review owns those.
- `sections/` owns UI composition. Read its guide before component work.
- Shared document behavior comes from `@typeset/engine` and `@typeset/editor`.
  Do not recreate resume types, file parsing, editing, formatting toolbar,
  layout, fonts, or PDF emission under this app.

## Integration rules

- Use explicit extension-bearing package subpaths, matching the workspace
  exports contract.
- RoleFit may adapt shared hooks/components through thin host adapters and
  documented slots. Keep provider/job/tracker state outside the packages.
- The editor always paints the full `ResumeData`. Tailor/Include/Off controls AI
  payload scope; they do not project or filter the document.
- Keep server/client request fields explicit and aligned. Unknown responses are
  untrusted until validated/coerced.
- Keep failure, retry, stop, and downstream-stage semantics explicit. A failed
  stage never advances by inference or fallback.
- Keep the complete provider/model catalog app-owned for validation, but render
  only providers returned as configured by the same-origin provider registry.
  Configured-but-unready selections remain visible and disabled; no-provider
  state disables AI without disabling the rest of the browser app.
- The browser must never collect, persist, render, or submit managed API keys.
  Provider setup and secret mutation belong to the Electron companion; browser
  requests contain provider/model/effort choices only.

## Maintainability

- Derive view state from the owning hook/domain value; avoid synchronized
  mirrors in App and components.
- Keep pure logic in `lib/` or `resume/`, with deterministic evals when durable.
- Use focused adapters instead of broad barrels or product-wide context.
- When a shared package seam changes, verify Typeset as well as RoleFit.
