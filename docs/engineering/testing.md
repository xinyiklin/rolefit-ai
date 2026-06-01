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
- missing / invalid API keys surface a clear, user-safe error rather
  than a silent fallback
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

Useful commands:

```bash
npm run build
npm run dev
```

`npm run build` runs `tsc` (type check) then `vite build`. Run it
before finalizing whenever frontend source or types changed.

## Chrome Visual QA

Chrome visual QA is expected for major UI changes when feasible.

Check:

- the affected control in the normal two-column workflow
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
