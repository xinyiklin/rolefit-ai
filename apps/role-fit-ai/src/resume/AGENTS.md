# RoleFit Resume Analysis Guide

Applies to `apps/role-fit-ai/src/resume/`. The shared structured document and
file/layout contracts remain in `@typeset/engine`.

## Scope

- Own deterministic mechanical analysis used to describe resume text,
  sections, keywords, and proposed edits.
- Keep transformations evidence-preserving and target stable document IDs.
- Do not calculate, cap, recompute, or substitute a fit score, verdict,
  eligibility decision, or missing-qualification count. AI Review owns the
  complete fit judgment; invalid Review output fails visibly.
- Do not promote job-description-only terms into resume evidence. Rewrites may
  clarify facts already present in the resume or honest user context, never
  invent experience, tools, metrics, employers, dates, or outcomes.

## Maintainability

- Keep analysis pure and serializable. React, requests, provider logic, and
  storage belong elsewhere.
- Reuse the shared engine's `ResumeData` and inline-mark grammar rather than
  defining local document shapes.
- Separate extraction/normalization from presentation wording so UI copy can
  change without changing evidence semantics.
- Add focused offline evals for changes to section parsing, keyword extraction,
  rewrite application, or evidence boundaries.
