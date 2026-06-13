# Testing

Role-Fit AI testing should prove the changed behavior, protect API key
isolation, and avoid wasting time on broad checks when a targeted one
gives stronger feedback. There is no automated test suite today; the
gates below are the lightweight checks the project relies on.

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

- `node --check server.mjs` passes after server edits
- the affected route returns the expected JSON shape and HTTP status
- `/api/polish` accepts a structured `tailorScope`, does not require or read
  full-resume `resumeText`, and returns only suggestions targeting IDs from
  the submitted scope
- missing / invalid API keys surface a clear, user-safe error rather
  than a silent fallback
- prompt-honesty changes prove that JD-only skills are not injected into
  the suggestion list or polished preview; when possible, use a synthetic
  missing-skill case such as a no-Kubernetes resume against a
  Kubernetes-required JD
- live prompt-eval changes can use
  `EVAL_MODE=both node server/ai/__evals__/fabrication-eval.mjs` to check
  strict-review and regular-polish modes, including one exact-evidence
  positive case from honest context and an inferred-evidence OS case
- sanitizer or scoring-rule changes must keep
  `node server/ai/__evals__/sanitize-probes.mjs` green — it is offline,
  deterministic, and replays every live fabrication/evasion found during
  the 2026-06-11 hardening (editor `<b>` tokens, ungrounded JD terms,
  placeholder evidence, bucket sums, gap caps)
- tailor-quality changes can grade live consistency on the real resume:
  `node server/ai/__evals__/tailor-quality-eval.mjs job-search-workspace/tailor-eval/samples/<jd>.json 3`
  (metrics-only output; full responses land in gitignored
  `job-search-workspace/tailor-eval/`); a matched JD should produce
  evidence-backed suggestions with a small honest lift, a bad-fit JD a
  stable DON'T APPLY
- the deterministic local rewrite still runs when the AI call cannot
- DOCX import / export roundtrips do not corrupt the format
- `job-search-workspace/` reads / writes stay inside the workspace
  folder

Useful commands:

```bash
node --check server.mjs
npm run dev
```

When iterating on a single route, hit it directly with `curl` against
`http://localhost:5181/api/...` rather than driving the full UI. If
port `5181` is already bound, the server is likely already running;
reuse it instead of starting a second `npm run dev`.

## Frontend Coverage

Good frontend verification covers:

- affected route renders without runtime / console errors
- changed controls are reachable by keyboard
- loading / data refresh does not cause avoidable layout shift
- API error states show user-safe messaging (no raw provider bodies)
- components reuse shared primitives from `src/ui.tsx` and tokens from
  `src/styles/` instead of one-off styles
- job-import distiller changes prove the before/after shape without
  printing raw private text: the resulting job field should keep role
  intro / responsibilities / requirements while stripping empty bullets,
  apply/navigation furniture, duplicated titles, low-value Workday
  metadata, company/culture marketing, and trailing benefits / legal
  boilerplate

Useful commands:

```bash
npm run build
npm run dev
```

`npm run build` runs `tsc` (type check) then `vite build`. Run it
before finalizing whenever frontend source or types changed.

## Chrome Visual QA

Chrome visual QA is flag-first: skip by default, flag changes with real
layout/theming risk, and let the user decide. When it runs, check:

- the affected control in the normal navbar-inputs + studio workflow
- tab open/close behavior in the output panel when tabs changed
- no overlapping text or controls in resume / output panels
- no spinner / loading / shimmer effects unless requested
- long resume / job-description text wraps without overlap

For tiny copy or class-only edits, visual QA may be skipped with a
short reason.

## Refactors

Good refactor verification proves behavior parity:

- `npm run build` succeeds
- grep for old symbol names returns no meaningful hits after renames
- no new imports of deprecated paths
- affected call sites still use the intended public interface
- the AI polish path **and** the deterministic fallback both still work

Avoid drive-by refactors. Refactor only when the current task requires
it, the existing structure blocks correctness, or the improvement can
be verified safely.

## Docs-Only Changes

For docs-only changes:

- no frontend build or server check is required
- verify paths and links exist
- run a spelling / grep sanity check when useful
- update `CONTINUITY.md` if the docs change durable workflow,
  decisions, active risks, or next steps

Document skipped runtime checks as not applicable.
