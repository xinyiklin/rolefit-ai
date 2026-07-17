# Typeset Agent Guide

Provider-agnostic working agreements for this repository. `CLAUDE.md` adds
Claude-specific overrides. More specific current guidance wins for its scope.

Typeset is a local-first React 19 + TypeScript + Vite 8 resume editor. The
browser owns the structured document, deterministic layout, persistence,
`.resume` file I/O, and client-side PDF export. Production is a static site with
no application backend or runtime API.

## Instruction Precedence

1. User instructions for the current task.
2. Safety, data integrity, and secret handling.
3. The nearest current `AGENTS.md` or provider-specific guide.
4. `PRODUCT.md` for product behavior and `DESIGN.md` for visual behavior.
5. Durable facts and decisions in `CONTINUITY.md`.
6. Existing architecture and conventions.

Do not preserve stale rules. Update the relevant guide and continuity ledger
when the project shape or a durable decision changes.

## Guidance Map

- `PRODUCT.md` — product purpose, interaction principles, privacy, and supported
  authoring experience.
- `DESIGN.md` — visual system, editor grammar, responsive behavior, and
  accessibility expectations.
- `apps/typeset/src/lib/AGENTS.md` — canonical resume model, document style and
  typography, inline transforms, strict `.resume` codec, versioning, validation.
- `apps/typeset/src/components/AGENTS.md` — reusable chrome primitives and the
  toolbar family: popover conventions, option-list ownership, control contracts.
- `apps/typeset/src/sections/editor/AGENTS.md` — direct-editing boundaries,
  caret/selection mapping, context commands, and structure-overlay behavior.
- `apps/typeset/src/typeset/AGENTS.md` — deterministic measurement, layout,
  fonts, DOM/print rendering, PDF emission, and parity checks. Also read it for
  changes under `apps/typeset/scripts/` or `apps/typeset/public/fonts/` that
  affect the typesetting contract.
- `CONTINUITY.md` — active decisions, recent verified state, open risks, and
  current working set.

## Workspace

This repository is an npm-workspaces monorepo. The workspace root owns the
lockfile, shared tooling, and the deployment pipeline; each app owns its own
build and checks.

- `apps/typeset/` — the Typeset editor (static site; the only app today).
- `packages/` — shared packages. Empty until the engine is extracted; see
  `CONTINUITY.md` for the in-flight extraction plan.
- Root `Dockerfile` builds `apps/typeset` from the workspace root, because npm
  workspaces resolve from the root manifest and lockfile.

Run everything from the repository root. Root `check`/`test` fan out to every
workspace; app-specific work uses `--workspace apps/typeset`.

## Architecture

Paths below are relative to `apps/typeset/`.

- `src/main.tsx` -> `src/App.tsx` is the application entry path.
- `src/lib/` owns reusable, non-visual resume-domain logic, the document-style
  contract, and shared typography values.
- `src/hooks/` owns editor history/state and browser persistence for document
  and view preferences.
- `src/sections/editor/` adapts the engine to direct input, DOM selection/caret
  mapping, context commands, and structure controls.
- `src/typeset/` owns the exact layout-input adapter and shared deterministic
  layout consumed by the editor, browser print layer, and dedicated PDF emitter.
- `src/components/` owns reusable editor chrome (`Modal`, `Popover`, and the
  `toolbar/` family — see its `AGENTS.md`); `src/styles/` owns tokens, shell,
  toolbar, popover, document, and print styles.
- `public/fonts/` and `scripts/` hold reproducible font assets and generators.
  The generators anchor paths to the app root via `__file__`; keep them beside
  the assets they produce.

Keep production static. Do not add analytics, hosted AI, accounts, remote
persistence, runtime services, or resume-data requests without explicit user
approval.

## Product And Data Invariants

- Treat resume content as personal data. It stays in browser storage and files
  the user explicitly opens or downloads.
- `.resume` is the sole editable source format. PDF is final output, not an
  editable input or alternate source path.
- The current and first `.resume` contract is `schemaVersion: 1`; no prototype
  file versions are supported. Future schema changes require an explicit
  version/migration decision, round-trip checks, and matching docs.
- Session ids do not cross the file boundary. Zoom and the spell-check toggle
  are local view preferences (`DocStyle` fields) that are never written to a
  `.resume` file.
- Editor, browser print, and dedicated PDF output must derive from the same
  structured document, style values, and layout contract.
- Preserve the desktop/tablet-first authoring experience and the clear
  small-screen gate described in `apps/typeset/PRODUCT.md` and
  `apps/typeset/DESIGN.md`.

## Commands

Run commands from the repository root.

- Install: `npm install` (installs every workspace from the root lockfile)
- Development: `npm run dev`
- Build: `npm run build` (`tsc` + Vite -> `apps/typeset/dist/`)
- Preview: `npm run preview`
- Full local/CI verification: `npm run check` (every workspace's own check)

Root `dev`/`build`/`preview` currently delegate to `apps/typeset`; they gain
per-app names when a second app lands. The named evals are app-scoped:

- Editable-file eval: `npm run eval:resume-file --workspace apps/typeset`
- Direct-editor eval: `npm run eval:editor --workspace apps/typeset`
- PDF font-parity eval: `npm run eval:pdf-font-parity --workspace apps/typeset`
- All evals for the app: `npm test --workspace apps/typeset`

There is no separate lint command. `npm run check` is the unified build and
deterministic-eval gate; use the narrowest named eval while iterating. Material
UI changes still require a real-browser check.

Typeset uses port `5186` and HMR port `24686` with Vite `strictPort: true`. A
bound port means the app is already running; use it instead of selecting another
port. Sibling reservations are careflow `5173-5180`, role-fit-ai `5181-5183`,
and portfolio `5184-5185`.

## Start-Of-Task Checklist

Before changing code or project files:

1. Read `CONTINUITY.md` and the nearest applicable guides.
2. Identify the goal, acceptance criteria, scope, and constraints.
3. Inspect the files, callers, state owner, and output paths involved.
4. Establish current authoritative sources for recency-sensitive work.
5. For non-trivial tasks, state a compact plan with verification checks.
6. Ask only when ambiguity could materially change or endanger the result;
   otherwise make a bounded assumption and proceed.

## Working Principles

- Keep changes surgical. Every changed line should trace to the request, its
  necessary cleanup, or verification.
- Prefer the minimum durable solution; avoid speculative features, knobs,
  abstractions, and compatibility fallbacks that hide failures.
- Match existing naming, style, framework choices, and helper APIs.
- Read before editing and preserve user changes in a dirty worktree.
- Remove only dead code created by your change; report unrelated cleanup.
- Keep actionable failures visible. Do not silently swallow errors or leave
  empty `catch` blocks.
- Ask before adding a dependency when bundle size, security, or maintenance is
  affected.
- Reproduce, change, verify, and inspect. Use failures as evidence and rerun the
  smallest meaningful check before broader checks.

## Maintainability, Modularity, And Reuse

- Search for the existing owner before adding a type, constant, transform, or
  control. Do not create parallel representations of one concept.
- Keep domain logic independent of React where practical. Components and hooks
  should adapt deterministic helpers to state, effects, DOM events, and UI.
- Keep side effects at explicit boundaries: storage/file lifecycle near
  `App`/hooks, DOM selection in the editor adapter, and PDF/download work in the
  export boundary.
- Keep dependencies directed. Domain and typesetting modules must not depend on
  toolbar components or application orchestration; avoid circular imports and
  broad barrel exports.
- Extract only a stable responsibility, demonstrated duplication, a useful test
  seam, or a volatile concern. Do not generalize one speculative use case or add
  pass-through components solely to reduce line count.
- Reuse established primitives and tokens for repeated interaction and visual
  contracts. Keep feature-specific composition beside its consumer rather than
  growing generic components through unrelated modes and boolean props.
- Keep state close to its owner. Reducer transitions remain explicit and
  serializable; reusable controls receive values and callbacks; derived state is
  computed rather than duplicated.
- Treat files around 300 lines, unrelated effects in one component, or repeated
  edits across distant regions as prompts to review boundaries. Split by
  responsibility, not an arbitrary line target.
- Preserve every caller's real contract when sharing code. Reuse must not weaken
  validation, accessibility, error reporting, privacy, or deterministic layout.
- Verify extracted logic and each affected integration path.

## Verification And Definition Of Done

A task is done when:

- The requested behavior is implemented or the question is answered.
- The nearest focused checks and broader build were attempted as appropriate.
- UI work has real-browser evidence; PDF work checks rendered output; file work
  checks round trips and rejection behavior.
- Errors and warnings are fixed or explicitly reported as out of scope.
- Affected behavior, setup, architecture, and workflow docs are current.
- `CONTINUITY.md` records meaningful state, decision, risk, or next-step changes.
- The final report explains impact, verification, limitations, and remaining
  questions without overstating what was checked.

## Safety And Static Hosting

- Never expose secrets, credentials, private keys, or broad environment dumps.
  Never commit secrets or `.env` files.
- Remote calls are read-only unless the user explicitly authorizes a write.
- Confirm before destructive actions, history rewrites, production writes, or
  paid/vendor dependencies.
- Do not install host system packages without explicit approval.
- Prefer the existing Vite and Docker workflows. The Docker image serves `dist/`
  from unprivileged Nginx on port 8080 and needs no runtime environment values.
- Bind self-hosted containers to loopback behind HTTPS unless public exposure is
  explicitly intended and secured.

## Continuity Ledger

- Keep one bounded `CONTINUITY.md`; no transcripts, chat dumps, or raw logs.
- Tag entries with an ISO date and `[USER]`, `[CODE]`, `[TOOL]`, or
  `[ASSUMPTION]`; write `UNCONFIRMED` rather than guessing.
- Supersede changed facts explicitly. Keep Snapshot near 25 lines, Done (recent)
  near 7 bullets, and Working set near 12 paths by compressing older detail.
- Record durable choices as compact ADR-style entries and report Goal, Now,
  Next, and Open Questions after material work.

## Git And Existing Work

- Run git commands from the repository root with non-interactive flags.
- Do not stage, commit, push, amend, reset, rebase, or switch branches unless the
  user asks.
- Treat `AGENTS.md` and `CLAUDE.md` like normal tracked files when requested;
  `CONTINUITY.md` and `.claude/` are ignored.
- Never revert, delete, or overwrite work you did not make without explicit
  permission. Never force-push or rewrite published history without approval.
- Avoid broad cleanup and formatting churn. When asked to commit, prefer one
  coherent reviewable unit with a concise Conventional Commit subject.
