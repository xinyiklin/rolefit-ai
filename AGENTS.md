# Typeset Workspace Agent Guide

Provider-agnostic working agreements for the npm-workspaces monorepo. The
repository contains two products over two private shared packages:

- **Typeset** is a static, browser-only resume editor.
- **RoleFit AI** is a local-first resume-tailoring workbench with a loopback
  Node server, AI providers, local workspace storage, and a browser extension.

Do not apply one app's runtime, privacy, product, or deployment assumptions to
the other. `CLAUDE.md` adds provider-specific tool guidance; the nearest
`AGENTS.md` wins for its scope.

## Instruction Precedence

1. The user's current request.
2. Safety, data integrity, secret handling, and truthful resume output.
3. This guide and the nearest scoped `AGENTS.md`.
4. The affected app's `PRODUCT.md` and `DESIGN.md`.
5. Root architecture/development docs and the relevant engineering docs.
6. Current continuity decisions and existing conventions.

Do not preserve stale guidance. When ownership or a durable contract changes,
update the owning guide and documentation in the same change.

## Documentation And Guidance Map

- `README.md` — workspace entry point and common commands.
- `docs/README.md` — documentation index.
- `docs/architecture.md` — workspace boundaries, dependency direction, and
  shared-versus-host ownership.
- `docs/development.md` — commands, ports, generated assets, and verification
  matrix.
- `docs/git-workflow.md` — repository-wide branch, commit, PR, and staging
  conventions.
- `apps/typeset/AGENTS.md` and `{README,PRODUCT,DESIGN}.md` — standalone
  Typeset shell, behavior, and visual contract.
- `apps/role-fit-ai/{README,PRODUCT,DESIGN}.md` and
  `apps/role-fit-ai/docs/engineering/` — RoleFit behavior and engineering
  contracts.
- `packages/engine/AGENTS.md` — engine package boundary and public contract;
  its nested guides own resume domain/files and deterministic layout/PDF.
- `packages/editor/AGENTS.md` — editor package boundary, shared styles, and
  host seams; its nested guides own hooks, chrome, and direct editing.
- `CONTINUITY.md` — monorepo decisions and handoff state. RoleFit's scoped
  ledger may hold app-only operational detail; do not duplicate the same fact
  in both ledgers.

## Workspace Ownership

The dependency direction is:

```text
@typeset/engine -> @typeset/editor -> apps/typeset
                                  -> apps/role-fit-ai
```

- `packages/engine/` owns deterministic, reusable resume-domain behavior:
  `ResumeData`, document style, the strict `.resume` codec, bundled fonts,
  measurement, layout, DOM/print painting, and PDF emission. Most of the
  package is React-free; `typeset/render/dom.tsx` is the intentional rendering
  boundary. Node server imports must stay on React-free engine subpaths.
- `packages/editor/` owns the reusable React editing surface: document/history
  hooks, the contenteditable adapter, formatting toolbar/popovers, editor
  chrome, and shared editor styles. It depends on the engine, never on an app.
- `apps/typeset/` owns only the standalone product shell: file lifecycle,
  browser autosave, Typeset identity, static deployment, and composition of the
  shared packages.
- `apps/role-fit-ai/` owns RoleFit orchestration: job intake, AI workflow,
  provider settings, tracker/workspace persistence, browser extension, host
  navigation, review rail, and the RoleFit-only editor overlay.
- The root owns the lockfile, shared TypeScript configuration, cross-workspace
  scripts, repository docs, CI, and app-specific deploy workflows.

Apps never import from each other. Packages never import from apps. A package
must not absorb an app-specific workflow merely because two components look
similar.

## Modularity, Reuse, And Maintainability

- Find the current owner before adding a type, transform, option list, state
  field, component, or CSS rule. Extend one source of truth rather than creating
  a parallel representation.
- Share behavior when the contract is genuinely common to both consumers or
  forms a stable domain boundary. Keep feature-specific composition beside its
  app until a second real consumer demonstrates the shared contract.
- Extract by responsibility, not line count. Useful seams isolate pure logic,
  side effects, volatile provider/platform behavior, or a focused test surface.
  Avoid pass-through wrappers, speculative utilities, broad barrels, and
  components that grow unrelated modes and boolean props.
- Keep domain logic independent of React and the DOM where practical. React
  components adapt deterministic helpers to state and events; hooks own
  cohesive state/effect lifecycles; app shells compose them.
- Keep side effects at explicit boundaries: browser/file lifecycle in app
  shells or focused hooks, editor DOM work in the editor adapter, PDF/download
  work at export boundaries, and server I/O in RoleFit server modules.
- Keep state close to its owner. Prefer derived state over synchronized copies;
  keep reducer transitions serializable and atomic; pass values and callbacks
  into reusable controls rather than giving them hidden storage access.
- Use shared primitives and tokens for repeated interaction and visual
  contracts. Shared component changes must preserve every host's accessibility,
  error handling, responsive behavior, and styling seams.
- Treat files near 300 lines, unrelated effects in one hook/component, or
  repeated edits across distant modules as prompts to inspect cohesion. A large
  cohesive controller may remain intact when extraction would only thread many
  refs without isolating behavior; document that decision in its scoped guide.
- Do not weaken validation, privacy, deterministic layout, or truthful AI
  behavior to make an abstraction easier to reuse.

Before moving app code into a package, verify:

1. At least two consumers need the same behavior, not merely similar markup.
2. The API can be expressed without importing host state or product language.
3. The dependency direction stays acyclic.
4. Styling and accessibility contracts remain host-safe.
5. Focused package tests and both affected integrations can verify the move.

## Shared Product And Data Invariants

- `ResumeData` is the canonical editable model in both apps.
- `.resume` uses `format: "typeset-resume"` and `schemaVersion: 1`; it is the
  only portable editable format. PDF is final output.
- Session ids never cross the file boundary. View-only preferences such as zoom
  and spell-check never enter `.resume` files.
- Editor, browser print, and dedicated PDF output derive from the same document,
  style, fonts, metrics, and layout contract.
- Treat resume and job-search content as personal data. Typeset never sends
  resume content to an application service. RoleFit sends only the inputs
  required for the user-selected local CLI or API workflow and keeps its local
  workspace ignored.
- AI output must remain evidence-grounded. Never invent employers, dates,
  metrics, education, tools, experience, or outcomes.

## Commands

Run commands from the repository root. There is intentionally no ambiguous
root `dev`, `build`, or `preview` command.

```bash
npm install
npm run dev:typeset
npm run dev:rolefit
npm run build:typeset
npm run build:rolefit
npm run check
npm test
```

Use workspace commands for focused work:

```bash
npm run check --workspace packages/engine
npm run check --workspace packages/editor
npm run check --workspace apps/typeset
npm run check --workspace apps/role-fit-ai
```

See `docs/development.md` for the verification matrix and focused evals.
Typeset uses port 5186 (HMR 24686); RoleFit uses port 5181. A bound canonical
port normally means that app is already running; reuse it rather than selecting
another port.

## Working Method

Before changing code or project files:

1. Read `CONTINUITY.md`, this guide, and the nearest scoped guide.
2. Read the affected app's product/design contract or package README.
3. Map callers, state owner, side effects, output paths, and all consumers of a
   shared contract.
4. Define acceptance criteria and the smallest meaningful verification.
5. Inspect the dirty worktree and preserve unrelated changes.

While working:

- Keep changes tied to the request and its necessary cleanup.
- Make one responsibility-level extraction at a time and verify before stacking
  another structural change.
- Surface actionable failures; do not add silent fallbacks or empty catches.
- Ask before adding a dependency or changing schemas, provider defaults,
  deployment shape, public runtime exposure, or paid services.

## Verification And Definition Of Done

- Run the narrowest owner-level check while iterating, then every affected
  consumer check in proportion to blast radius.
- A package change is not verified by one app build. Check the package and each
  app whose integration contract changed.
- UI changes require browser evidence when layout, interaction, or responsive
  behavior materially changes; otherwise state why visual QA was not needed.
- PDF changes require rendered-output comparison; file changes require valid
  round trips plus malformed-input rejection.
- AI/prompt/sanitizer changes require the relevant offline adversarial probes.
  Live provider evals run only when explicitly justified and authorized.
- Documentation-only changes require path/link/command verification rather
  than an unnecessary runtime build.
- Update affected docs and continuity when behavior, ownership, or a durable
  decision changes.

A task is complete only when the requested outcome works, affected contracts
agree, checks are reported honestly, and residual risks are explicit.

## Safety And Git

- Never expose secrets, broad environment dumps, private resume/job text, or
  provider response bodies.
- Never commit `.env`, personal workspace data, generated resume/PDF artifacts,
  `node_modules`, or `dist`.
- Do not stage, commit, push, switch branches, rewrite history, or make remote
  writes unless the user asks.
- Never overwrite unrelated work or use destructive git commands without clear
  authorization.
- Run git commands from the repository root; stage exact paths and keep
  behavior slices reviewable.
- Treat `AGENTS.md` and `CLAUDE.md` as normal tracked files when requested.

## Continuity

Keep continuity factual and bounded. Tag entries with an ISO date and
`[USER]`, `[CODE]`, `[TOOL]`, or `[ASSUMPTION]`; write `UNCONFIRMED` rather than
guessing. Root continuity owns cross-workspace architecture and deploy state;
app continuity owns only app-specific detail. Supersede changed facts instead
of appending contradictory narratives.
