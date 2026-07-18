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
`node apps/role-fit-ai/server/ai/__evals__/sanitize-probes.mjs`. On a failed case the runner
attaches the child's last output lines to the assertion so you can see which
case broke without re-running.

The LIVE evals (`fabrication-eval.mjs`, `tailor-quality-eval.mjs`) are excluded
via the runner's `LIVE` denylist: they drive a real provider, cost tokens, and
need a configured key. Run those by hand (see below). Any new network/model
eval must be added to `LIVE` so it stays out of `npm test`.

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
  server edits (the server runs
  under Node's native TypeScript type stripping; this is the type + syntax gate)
- the affected route returns the expected JSON shape and HTTP status
- `/api/polish` accepts a structured `tailorScope`, does not require or read
  full-resume `resumeText`, and returns only suggestions targeting IDs from
  the submitted scope
- a fresh standalone Review skips tailoring and sends `suggestedChanges: []`
  so it audits the current edited draft as submitted; the internal Review leg
  of Both may send only the sanitized suggestions returned by that same Tailor
  run, never stale suggestions from an earlier run
- combined responses always classify cover work with
  `coverStatus: "off" | "ok" | "failed"`; a failed cover pass preserves any
  successful tailor/review result
- missing / invalid API keys surface a clear, user-safe error rather
  than a silent fallback
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
- live prompt-eval changes can use
  `EVAL_MODE=both node apps/role-fit-ai/server/ai/__evals__/fabrication-eval.mjs` to check
  strict-review and regular-polish modes, including one exact-evidence
  positive case from honest context and an inferred-evidence OS case
- sanitizer or AI-review contract changes must keep
  `node apps/role-fit-ai/server/ai/__evals__/sanitize-probes.mjs` green — it is offline,
  deterministic, and replays every live fabrication/evasion found during
  the 2026-06-11 hardening (editor `<b>` tokens, ungrounded JD terms,
  and placeholder evidence). Lock the AI-owned score/verdict contract: valid
  model output must pass through unchanged; malformed, out-of-range, or
  band-inconsistent output must be rejected rather than recomputed. Also lock
  semantic-boundary guidance such as treating alternatives like
  "Bachelor's or Master's" as alternatives rather than conjunctions
- prompt-budget changes must add probes that build oversized structured
  payloads, extract each emitted JSON fragment (`tailor_scope`,
  `context_sections`, `proposed_changes`, or equivalent), and parse it again;
  serialized JSON must never be truncated by raw character count
- distill-grounding changes must cover `roleDescription` and `jobType`
  alongside title/company/location, including negated, benefits-only, and
  qualification-only wording that must not false-ground tracking metadata
- tailor-quality changes can grade live consistency on the real resume:
  `node apps/role-fit-ai/server/ai/__evals__/tailor-quality-eval.mjs apps/role-fit-ai/job-search-workspace/tailor-eval/samples/<jd>.json 3`
  (metrics-only output; full responses land in gitignored
  `job-search-workspace/tailor-eval/`); a matched JD should produce
  evidence-backed suggestions with a small honest lift, a bad-fit JD a
  stable DON'T APPLY
- when an AI Distill/Tailor/Review call fails, the shared workflow identifies
  the classified cause, keeps the failed step current, and leaves later steps
  as not run; Distill may retain a deterministic local brief for inspection,
  but that failed run cannot auto-launch Tailor or Review
- duplicate warnings before or after Distill must offer Continue/Stop; Stop
  prevents the current and every downstream AI request, while Continue is
  acknowledged for the same job target so the pipeline does not prompt twice
- cover-letter and application-answer generation have no local fallback and
  retain their own retryable task progress
- resume import (`.txt` / `.md` / `.csv`, or paste) reaches the structured editor
  as a one-time conversion into `ResumeData`; a `.resume` file loads its
  `ResumeData` directly, and export offers PDF + `.resume`
- `job-search-workspace/` reads / writes stay inside the workspace; tracker and
  base-resume mutations are serialized/atomic, duplicate application ids are
  rejected, stale same-record tracker writes return `409` with the current
  snapshot, legacy rows without `updatedAt` receive a stable first-edit
  revision, and corrupt application JSON or malformed strict `.resume` data
  fails closed without destructive reseeding
- routine AI logs remain shape-only and exclude model-authored target IDs,
  free-form error text, provider bodies, and private prompt content

Useful commands:

```bash
npm test --workspace apps/role-fit-ai
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
- a failed cover pass renders an explicit failure card with Retry while the
  successful resume/review result remains usable
- the owned typeset page stays the sole editor and live preview; the tracker may
  preview the saved application PDF, `ReviewRail` docks only after polish
  produces review output, and a
  hovered/focused review card highlights and scrolls to its exact editor field
- production builds keep `TrackerTab`, `AnalyticsTab`, and
  `ApplicationModal` in lazy chunks, and opening each surface loads cleanly
- components reuse shared CSS classes and tokens from `src/styles/` instead of
  one-off styles
- AI setup behaves as a one-open-section accordion; collapsed stages retain
  their provider/model summary, CLI providers show no API-key field, and native
  API keys remain session-memory only
- at 720px and below, only precise Resume authoring is replaced by the width
  notice; masthead/navigation and Materials, Applications, and Analytics remain
  reachable, including under high browser zoom
- job-import distiller changes prove the before/after shape without
  printing raw private text: the resulting job field should keep role
  intro / responsibilities / requirements while stripping empty bullets,
  apply/navigation furniture, duplicated titles, low-value Workday
  metadata, company/culture marketing, and trailing benefits / legal
  boilerplate
- shared-engine integration changes keep
  `src/typeset/__evals__/linebreak-parity.mjs`, `vertical-parity.mjs`, and
  `pdf-roundtrip.mjs` green. These are RoleFit integration and migration guards;
  the canonical engine checks live under `packages/engine/`
- editor changes keep the shared
  `packages/editor/src/sections/editor/__evals__/typeset-editing.mjs` and
  `packages/editor/src/hooks/__evals__/resume-editor-structure.mjs` checks green
  so display/value mapping, history coalescing, and summary split/merge remain
  atomic

Useful commands:

```bash
npm run build:rolefit
npm run dev:rolefit
```

`npm run build:rolefit` runs the RoleFit workspace build. Run it
before finalizing whenever frontend source or types changed.

## Chrome Visual QA

Chrome visual QA is flag-first: skip by default, flag changes with real
layout/theming risk, and let the user decide. When it runs, check:

- the affected control in the normal navbar-inputs + studio workflow
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
  retryable failed step without running any later selected step; Distill may
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
