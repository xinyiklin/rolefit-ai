# RoleFit AI Agent Guide

Applies to `apps/role-fit-ai/`. Follow the repository root `AGENTS.md` first.
RoleFit AI is the local-first resume-tailoring host over shared
`@typeset/engine` and `@typeset/editor` packages. It adds a loopback Node
server, AI workflow, local workspace/tracker, and browser extension; it does not
own a second resume model, editor, layout engine, or PDF implementation.

## Guidance map

- `README.md` — product setup, providers, extension, workspace, and app layout.
- `PRODUCT.md` — RoleFit behavior, workflow, and trust contract.
- `DESIGN.md` — Drafting Desk visual system and host/shared styling boundary.
- `docs/engineering/ui-principles.md` — host UI and responsive behavior.
- `docs/engineering/ai-server.md` — AI/server request and trust boundaries.
- `docs/engineering/testing.md` — RoleFit-focused verification.
- root `docs/{architecture,development,git-workflow}.md` — monorepo ownership,
  commands, and repository workflow.
- `src/AGENTS.md` — client orchestration and shared-package integration.
- `src/hooks/AGENTS.md` — cohesive workflow/state hooks.
- `src/sections/AGENTS.md` — RoleFit UI composition and reusable host controls.
- `server/AGENTS.md` — local server, workspace, job import, applications, and
  extension route boundaries.
- `server/ai/AGENTS.md` — provider, prompt, sanitizer, review, and eval rules.
- `extension/AGENTS.md` — MV3 popup and local bridge contract.
- root/package guides — shared engine/editor behavior. Read those before
  changing a package or shared control.

## Product and safety invariants

- Resume/job data and provider credentials are sensitive. Never print or log
  raw resumes, job descriptions, prompts, provider bodies, API keys, or broad
  environments without explicit local-debug authorization.
- `.env` keys stay server-side. A key entered in the AI menu may live only in
  page memory and the same-origin request that uses it; never persist, log, or
  echo it.
- Never invent employers, dates, metrics, education, tools, experience, or
  outcomes. Missing facts become gaps or bracketed prompts for human evidence.
- AI Review is the sole owner of fit score, coverage, verdict, reason, gaps,
  and recommendation. The server validates the response contract and
  anti-fabrication-sensitive edits; it does not calculate a replacement review.
- A failed Distill/Tailor/Review stage stops the selected pipeline. Distill may
  retain a deterministic local brief for inspection, but a failed AI Distill
  cannot auto-launch Tailor or Review.
- Duplicate checks gate the pipeline before and after Distill. Stop means no
  downstream request; Continue is acknowledged for that job target.
- Keep the server loopback-only by default. `HOST=0.0.0.0` exposes an
  unauthenticated local tool to the LAN and is never acceptable on an untrusted
  or public network.
- Keep personal artifacts inside ignored `job-search-workspace/`; never commit
  its contents except the instructional README.

## App ownership

RoleFit owns:

- `server.ts` and `server/`: local HTTP/Vite composition, provider calls, safe
  job import, workspace/application persistence, and extension routes;
- `src/hooks/`: RoleFit workflow state and effects;
- `src/sections/`: masthead, menus, tabs, tracker, materials, review rail,
  reusable AI workflow progress, dialogs, and host composition;
- `src/sections/editor/RoleFitEditorOverlay.tsx`: the section-scope and review
  overlay injected into the shared editor;
- `src/lib/` and `src/resume/`: RoleFit-only job, workflow, evidence, and
  deterministic mechanical analysis helpers;
- `extension/`: a vanilla MV3 client of the local extension API.

RoleFit consumes, but does not fork:

- `@typeset/engine`: canonical resume model, `.resume` codec, layout, fonts,
  DOM/print, and PDF;
- `@typeset/editor`: document/history/style hooks, direct editor, toolbars,
  popovers, and shared editor styles.

If behavior belongs to both apps, evaluate the package contract using root
`docs/architecture.md`. If it carries RoleFit provider, tracker, job, review,
or workspace state, keep it here and expose the smallest host seam instead.

## Maintainability and reuse

- Keep `App.tsx` as composition. New workflow state belongs in a focused hook;
  deterministic transforms belong in `src/lib/` or `src/resume/`; reusable
  presentation belongs in a focused section component.
- One hook owns one cohesive async/state lifecycle. Do not split ownership of
  the same progress, abort, retry, or persistence state between App and a hook.
- Reuse `AiWorkflowProgress` for ordered/retryable task stages and existing
  dialog/menu primitives for repeated interactions. Do not build parallel
  progress cards, modal shells, provider selectors, or status vocabularies.
- Keep host components declarative: values/callbacks in, UI out. Network,
  storage, and cross-tab effects stay in hooks or server modules.
- Keep client and server request types/conventions aligned. Validate unknown
  data at boundaries and preserve user-safe classified errors.
- Prefer small explicit interfaces over mode-heavy components. Extract only a
  stable responsibility, real duplication, a useful test seam, or volatile
  platform/provider behavior.
- Prompt wording is executable behavior. Prompt, grounding, sanitizer, or
  review-contract changes require adversarial probes and must not be treated as
  docs-only edits.

## Working method

Before editing:

1. Read root and app continuity plus the nearest scoped guide.
2. Read the affected product/design or engineering contract.
3. Trace callers, state owner, request/response shape, persistence, and shared
   package consumers.
4. Define fail/stop/retry behavior for any async workflow change.
5. Inspect the dirty tree and preserve unrelated work.

Pause before changing provider defaults, editable schema, API-key handling,
public exposure, destructive storage behavior, deploy shape, paid dependencies,
or remote writes.

## Commands and verification

Run from the repository root:

```bash
npm run dev:rolefit
npm run build:rolefit
npm run check --workspace apps/role-fit-ai
npm test --workspace apps/role-fit-ai
npx tsc -p apps/role-fit-ai/tsconfig.server.json --noEmit
```

RoleFit uses port 5181. Reuse a bound canonical listener rather than starting a
second server.

- Client/type changes: RoleFit build, plus focused evals.
- Server/AI changes: server TypeScript gate, affected route/eval, and full app
  check when the contract is shared.
- Shared engine/editor changes: follow root impact matrix and verify both apps.
- Material UI changes: follow RoleFit's flag-first visual-QA policy and report
  whether browser QA ran.
- Docs-only changes: verify local links, paths, commands, and stale references;
  runtime builds are not required unless the audit uncovers a code mismatch.

Update root continuity for cross-workspace decisions and the app ledger only
for RoleFit-specific operational detail. Do not duplicate the same receipt.

## Git

Follow root `docs/git-workflow.md`. Work locally unless the user asks for git
actions. Never stage `.env`, generated outputs/fonts, resumes/PDFs, or private
workspace data. Stage exact paths in this frequently dirty worktree.
