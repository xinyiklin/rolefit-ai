# jakeforge Agent Guide

Generic working agreements for coding agents on this project. `AGENTS.md` is the
provider-agnostic source of truth; `CLAUDE.md` adds Claude-specific overrides.
A more specific or deeper doc (a nested `AGENTS.md`, README, or engineering doc)
wins over this file when it is current.

jakeforge is a local-first, single-template resume editor: fill in a form-driven
on-page resume and export it in the Jake Gutierrez LaTeX style. A React 19 + Vite
+ TypeScript frontend renders the editable document; a small Node `server.mjs`
exposes only the LaTeX endpoints (template list, resume → `.tex`/PDF render via
Tectonic, `.tex` import). The editor surface, structured model, and LaTeX
pipeline were ported from the `role-fit-ai` sibling, with its AI, job-tracker,
applications, and DOCX surfaces removed.

## Instruction Precedence

1. User instructions for the current task.
2. Safety, data integrity, and secret handling — before stylistic preferences.
3. The nearest, most specific guidance file, when current.
4. Durable facts in the nearest `CONTINUITY.md`, over older chat context.
5. Existing architecture and conventions.

Do not preserve stale rules. If the project shape changes, update the relevant
docs and the continuity ledger together.

Keep this file a router: state agent behavior and high-level conventions here,
and keep detailed rules in the narrowest relevant document (a nested `AGENTS.md`,
README, or engineering doc). When content overlaps, point to the deeper doc
instead of duplicating it.

## Project Shape

- Stack: React 19 + TypeScript + Vite 7; Node `server.mjs` for the LaTeX API.
  npm. Tectonic (system binary) compiles `.tex` → PDF when installed.
- Layout:
  - `src/lib/` — resume data model + parse/serialize/LaTeX-extract helpers.
  - `src/hooks/` — `useResumeEditor` (structured reducer), `useDocStyle`
    (typography, localStorage), `useTemplates` (API client), `useResumeExport`.
  - `src/sections/editor/` — the editable on-page resume (sections, entries,
    bullets, skills, drag-reorder via `@dnd-kit`).
  - `src/sections/` — read-only document + off-screen print layer.
  - `src/components/` — reusable `Modal` shell and `ImportModal`.
  - `src/styles/` — `tokens.css`/`base.css` (design tokens), `resume-*.css`
    (document + editor), `index.css` (imports + app shell).
  - `server/latex/` — Jake's template renderer, plain-text/LaTeX parser, Tectonic
    wrapper. `server/docx.mjs` — DOCX text extractor (zero-dep, shells to `unzip`).
- Entry points: `src/main.tsx` → `src/App.tsx` (UI); `server.mjs` (serves the
  Vite app in dev / `dist` in prod, plus `/api/templates`,
  `/api/render-resume-latex`, `/api/import-resume-tex`, `/api/import-resume-docx`).
- External services: none; local-only. Optional deps: a local Tectonic install
  for LaTeX PDF output, and the system `unzip` (standard) for DOCX import.
- Deployment: optional self-hosted Docker image (see `Dockerfile` and README's
  "Deploying" section). The image bundles Tectonic + `unzip` and requires
  `ALLOWED_HOSTS` (comma-separated public hostnames) at runtime — the server
  refuses to start without it when bound beyond loopback.

Treat the project as local-first. The resume is the user's personal data — keep
it in `localStorage` only; never send it anywhere but the app's own LaTeX
endpoints (the local server in dev, the user's own self-hosted instance when
deployed). No third-party services either way.

Viewport support is desktop/tablet first. The editor does not need to provide a
full phone-sized authoring experience; if mobile maintenance starts creating
awkward compromises, it is acceptable to use the same kind of small-screen
restriction/gate already used in the `role-fit-ai` sibling instead of polishing
every mobile layout.

## Commands

Run from the project root.

- Install: `npm install`
- Run / dev: `npm run dev` (starts `server.mjs` on `PORT` or 5186; Vite in
  middleware mode)
- Build: `npm run build` (`tsc` typecheck + `vite build` → `dist/`)
- Preview prod: `npm run preview` (`NODE_ENV=production node server.mjs`)
- Server syntax check: `node --check server.mjs`

There is no test harness yet. Verify with the build, a server syntax check, and a
browser check of the editor + a Tectonic PDF render when LaTeX paths change.

### Port reservations

Sibling projects in this workspace use fixed, non-overlapping dev-server ranges
so a bound port means "the app is already running," not "pick another." The port
is pinned with Vite `strictPort: true`; when 5186 is bound, connect to the
running app instead of starting a second server or switching ports.

- careflow: `5173-5180`
- role-fit-ai: `5181-5183`
- portfolio: `5184-5185`
- jakeforge: `5186` (Vite HMR socket on `24686`)

## Start-Of-Task Checklist

Before changing code or project files:

1. Read `CONTINUITY.md` if it exists.
2. Read the nearest `AGENTS.md`, `CLAUDE.md`, README, or docs that apply.
3. Identify the goal, acceptance criteria, scope, and constraints.
4. Inspect the files you will touch before choosing an implementation.
5. If the request depends on current or recency-sensitive facts, establish the
   date/time and prefer authoritative sources.
6. For non-trivial tasks, state a compact plan with concrete verification checks.
7. Ask one targeted clarifying question only when ambiguity could cause
   user-facing confusion or irreversible work. Otherwise make a reasonable
   assumption and proceed.

## Accuracy, Recency, And Sourcing

When a request depends on "latest", "current", "today", recent APIs, pricing,
release notes, security advisories, or compatibility:

- Establish the current date/time (e.g. `date -Is`; on macOS,
  `date '+%Y-%m-%dT%H:%M:%S%z'`) and state it when it affects the answer.
- Prefer official or primary sources: vendor docs, upstream repositories,
  changelogs, release notes, standards, or maintainer announcements.
- For safety-, compatibility-, legal-, medical-, or financial-sensitive details,
  cross-check reputable sources and call out source dates when relevant.
- Use library/API documentation tools when available. Pin the library and version
  when known, fetch only the focused docs needed, and summarize rather than
  dumping large source text.
- Use web search when it materially improves correctness; prefer official docs
  before secondary explainers.

## Agent Operating Principles

- Think before coding. State important assumptions, surface tradeoffs, and ask
  when confusion would change the solution.
- Keep it simple. Write the minimum durable code that solves the request; do not
  add speculative features, knobs, abstractions, or future-proofing.
- Make surgical changes. Every changed line should trace to the request, a
  cleanup caused by it, or a verification fix.
- Match the codebase. Prefer existing style, naming, patterns, framework choices,
  and helper APIs over personal preference.
- Clean up only your own wake. Remove imports, state, helpers, files, or docs
  made obsolete by your change; mention unrelated dead code instead of deleting
  it.
- Define success in verifiable terms: reproduce the issue, make the change, run
  the relevant test/build, and inspect the result.
- Loop until verified. If a check fails, use the failure as evidence, adjust, and
  rerun the smallest meaningful check before broader ones.
- Use judgment on tiny tasks. A typo or one-line answer does not need ceremony.
- Push back when the requested path is riskier, broader, or more brittle than a
  simpler way to satisfy the same goal.

## Development And Editing

- Default to read-only exploration before edits.
- Keep changes scoped and reviewable.
- Prefer patch-style edits over full rewrites unless a clean replacement is
  requested or the file is no longer relevant.
- Preserve existing style and conventions.
- Keep hand-written source files modular. Treat files over ~300 lines as a prompt
  to check boundaries; split when it improves readability or future change. Do
  not cap necessary scope just to hit a line count.
- Keep public entrypoints stable where practical; isolate volatile logic behind
  smaller helpers.
- Do not add default fallbacks during development just to hide failures. If a
  required value is missing, fail visibly enough to fix the real cause.
- Do not leave empty `catch` blocks or silently swallow errors.
- Do not reinvent the wheel. When a mature library would reduce risk, ask before
  adding it and help qualify the choice.
- Design UI for the end user and workflow, not for the database schema.
- Verify major UI changes in a real browser when feasible, rather than relying
  only on static inspection. The Claude-specific tool choice (Chrome vs Preview)
  lives in `CLAUDE.md`.

## Secrets And Safety

- Never print secrets, tokens, private keys, credentials, or broad environment
  dumps. Do not ask the user to paste secrets.
- Never commit secrets or `.env` files; keep them git-ignored.
- Avoid commands that may expose secrets (dumping shell environments, reading
  private key files). Redact sensitive strings in shared output.
- Remote API calls must be read-only unless the user explicitly requests a write;
  dry-run requested writes first when possible.
- Pause and confirm before irreversible or destructive actions: bulk deletes,
  history rewrites, schema or data drops, production/remote writes, or adding
  paid or vendor dependencies.

## Containers And Tooling

- Never install system packages on the host unless the user explicitly asks.
- Prefer the project's existing workflow when one exists (`Dockerfile`, compose
  files, Make targets, or documented scripts).
- If no workflow exists and dependencies are needed, discuss a minimal,
  project-scoped setup before adding one.

## Reading Documents And Data

For PDFs, uploads, long documents, spreadsheets, or CSVs:

- Read the full source before drafting.
- Draft the requested output.
- Before finalizing, re-check the source for factual accuracy, invented details,
  and wording/style constraints.
- Label paraphrases explicitly when source-faithful handling matters.

## Continuity Ledger

Maintain one compact `CONTINUITY.md` for the project. It is the durable handoff
memory; keep it factual and bounded — no transcripts, raw logs, or chat dumps.

- Read it at the start of each task before acting.
- Update it only for meaningful deltas: goal, constraints, durable decisions,
  state, open questions, working set, or important tool outcomes.
- Tag every entry with an ISO date and a provenance tag: `[USER]`, `[CODE]`,
  `[TOOL]`, or `[ASSUMPTION]`. Write `UNCONFIRMED` rather than guessing.
- Supersede changed facts explicitly instead of silently rewriting history.
- Keep `Snapshot` to ~25 lines, `Done (recent)` to ~7 bullets, and `Working set`
  to ~12 paths. Compress older noise into milestone bullets that point to a
  commit, PR, doc, or log.
- Record durable choices as ADR-lite entries, e.g.
  `D001 ACTIVE: chosen stack is ...`.
- In replies after material work, include a brief snapshot: Goal, Now, Next, and
  Open Questions. Print the full ledger only when it changed materially or the
  user asks.

## Verification And Definition Of Done

A task is done when:

- The requested change is implemented or the question is answered.
- Relevant verification was attempted — build, lint, tests, typecheck, document
  rendering, or browser checks (see Commands). UI changes that alter layout,
  styling, animation, or other visible surfaces get a real-browser check.
- Errors and warnings are fixed or explicitly listed as out of scope.
- Impact is explained: what changed, where, and why.
- Docs are updated for impacted behavior, setup, or workflow.
- `CONTINUITY.md` is updated when the change materially affects state, decisions,
  risks, or next steps.
- If no build or test harness exists, say so and verify by the strongest
  available lightweight check.

## Git And Existing Work

- The working tree may contain user edits or generated output.
- Run git commands from the relevant repository root; use non-interactive flags.
- Do not stage, commit, push, amend, reset, rebase, or switch branches unless the
  user asks.
- Stage and commit `AGENTS.md` and `CLAUDE.md` like any other tracked file when
  they're part of the change; do not single them out to exclude. `CONTINUITY.md`
  and `.claude/` are gitignored, so they never appear as staging candidates.
- Never revert, delete, or overwrite changes you did not make unless explicitly
  asked.
- Never force-push a shared branch or rewrite published history without an
  explicit request.
- Avoid broad cleanup, drive-by refactors, and formatting churn.
- When asked to commit, prefer one coherent commit per reviewable unit. Follow
  project-specific commit rules when present; otherwise use Conventional Commit
  subjects such as `fix(scope): preserve calendar scroll`.
