# Testing

Role-Fit AI testing should prove the changed behavior, protect API key
isolation, and avoid wasting time on broad checks when a targeted one
gives stronger feedback. The lightweight gates below are what the project
relies on; an offline `node:test` suite (`npm test`) runs the deterministic
AI-safety probes.

## Offline Test Suite

`npm test` runs `node --test offline-evals.test.mjs` — the repo-wide offline
regression gate. It recursively discovers every `.mjs` under any `__evals__`
directory in the repo and runs each as a child process (bounded by a 60s
timeout), asserting exit 0. No model calls, no network, no provider keys; runs
in a couple of seconds. A new offline eval — or a whole new `__evals__`
directory — is gated automatically; no static directory list or runner edit is
needed.

Each eval still runs standalone for a per-case PASS/FAIL list, e.g.
`node server/ai/__evals__/sanitize-probes.mjs`. On a failed case the runner
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

- `npx tsc -p tsconfig.server.json` passes after server edits (the server runs
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
  placeholder evidence, bucket sums, gap caps). Include a case proving an
  ungrounded model-authored coverage status is corrected before it reaches
  display rows, scoring, or caps
- prompt-budget changes must add probes that build oversized structured
  payloads, extract each emitted JSON fragment (`tailor_scope`,
  `context_sections`, `proposed_changes`, or equivalent), and parse it again;
  serialized JSON must never be truncated by raw character count
- distill-grounding changes must cover `roleDescription` and `jobType`
  alongside title/company/location, including negated, benefits-only, and
  qualification-only wording that must not false-ground tracking metadata
- tailor-quality changes can grade live consistency on the real resume:
  `node server/ai/__evals__/tailor-quality-eval.mjs job-search-workspace/tailor-eval/samples/<jd>.json 3`
  (metrics-only output; full responses land in gitignored
  `job-search-workspace/tailor-eval/`); a matched JD should produce
  evidence-backed suggestions with a small honest lift, a bad-fit JD a
  stable DON'T APPLY
- when an AI tailor/review/cover call fails, the stage shows a failed card
  with Retry (no local draft — D011); the deterministic DISTILL fallback and
  the local fit estimate still run. Application-answer generation also has no
  local draft fallback
- resume import (`.txt` / `.md` / `.csv`, or paste) reaches the structured editor
  as a one-time conversion into `ResumeData`; a `.resume` file loads its
  `ResumeData` directly, and export offers PDF + `.resume`
- `job-search-workspace/` reads / writes stay inside the workspace
  folder

Useful commands:

```bash
npm test
npx tsc -p tsconfig.server.json
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
- a failed cover pass renders an explicit failure card with Retry while the
  successful resume/review result remains usable
- the owned typeset page stays the sole editor; Preview opens as a toolbar
  overlay, `ReviewRail` docks only after polish produces review output, and a
  hovered/focused review card highlights and scrolls to its exact editor field
- production builds keep `TrackerTab`, `AnalyticsTab`, and
  `ApplicationModal` in lazy chunks, and opening each surface loads cleanly
- components reuse shared CSS classes and tokens from `src/styles/` instead of
  one-off styles
- job-import distiller changes prove the before/after shape without
  printing raw private text: the resulting job field should keep role
  intro / responsibilities / requirements while stripping empty bullets,
  apply/navigation furniture, duplicated titles, low-value Workday
  metadata, company/culture marketing, and trailing benefits / legal
  boilerplate
- owned-engine layout changes keep
  `src/typeset/__evals__/linebreak-parity.mjs`, `vertical-parity.mjs`, and
  `pdf-roundtrip.mjs` green. The truth fixtures are committed static regression
  data for the owned engine and are frozen (no external regeneration path)
- editor changes keep `src/sections/editor/__evals__/typeset-editing.mjs` and
  `src/hooks/__evals__/resume-editor-structure.mjs` green so display/value
  mapping and summary split/merge remain atomic

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

- `npm run build` succeeds
- grep for old symbol names returns no meaningful hits after renames
- no new imports of deprecated paths
- affected call sites still use the intended public interface
- the AI polish path still works, and a failed AI call still surfaces a
  failed stage card with Retry (local fallbacks exist only for distill and
  the fit estimate — D011)

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
