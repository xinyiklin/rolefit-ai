# RoleFit AI Repository Agent Guide

Provider-agnostic working agreements for the RoleFit AI npm-workspaces
repository. It contains two products over two private shared packages:

- **RoleFit AI** is a local-first resume-tailoring workbench with a loopback
  Node server, AI providers, local workspace storage, and a browser extension.
- **Typeset** is a static, browser-only resume editor.

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

- `README.md` / `docs/README.md` — workspace entry point and doc index.
- `docs/` — `architecture.md` (boundaries, dependency direction,
  shared-versus-host ownership), `development.md` (commands, ports, generated
  assets, verification matrix), `git-workflow.md` (branch, commit, PR, staging).
- `apps/role-fit-ai/{README,PRODUCT,DESIGN}.md` + `docs/engineering/` — RoleFit
  behavior and engineering contracts.
- `apps/typeset/AGENTS.md` + `{README,PRODUCT,DESIGN}.md` — Typeset shell,
  behavior, visual contract.
- `packages/{engine,editor}/AGENTS.md` — package boundaries and public
  contracts; their nested guides own resume domain/files and deterministic
  layout/PDF, and hooks/chrome/direct editing respectively.
- `CONTINUITY.md` — monorepo decisions and handoff state. RoleFit's scoped
  ledger may hold app-only operational detail; never duplicate a fact in both.

## Delivery Workflow

Non-trivial work runs through the portable `product-delivery` workflow
(Product Partner → Delivery Lead → Verifier) installed at
`~/.agents/workflows/product-delivery/`. That package owns the process: the two
exact user-approval gates, Change Request escalation, and honest verification
reporting. Do not copy it here. This repo may strengthen it, never weaken it.

- **Independent review:** after the implementer's own verification, one fresh
  reviewer by default. Only the user may waive it for a specific change. If the
  user asks for more reviewers, give a firm risk-based recommendation first,
  then honor the request.
- **Expect a second reviewer** for changes to `packages/engine` or
  `packages/editor` that both apps consume, `.resume`/`.cover` schema or codec
  behavior, AI prompt/sanitizer/provider defaults, and any version bump that
  triggers a release workflow.
- **Extra Change Request triggers** beyond the portable list: moving app code
  into a package, changing the dependency direction, or any change that could
  weaken evidence-grounded AI output or the local-only data posture.
- **Task artifacts** live under `.agent-work/tasks/<task-id>/`; keep them local
  while a task is active. Because this repo tracks its agent guidance *and*
  `CONTINUITY.md`, commit the completed task folders that continuity references
  with `[TASK <task-id>]`, so the ledger never points at missing local files.

The seven workflow templates are building blocks, not mandatory files. A normal
task uses Product Brief, Delivery Plan, Alignment Review, Implementation
Report, and Verification Report; create a Decision Log or Change Request only
when its trigger occurs.

## Workspace Ownership

The dependency direction is:

```text
@typeset/engine -> @typeset/editor -> apps/typeset
                                  -> apps/role-fit-ai
```

- `packages/engine/` — deterministic document behavior: `ResumeData`, the
  constrained cover-letter paragraph adapter, document style, the strict
  `.resume`/`.cover` codecs, bundled fonts, measurement, layout, DOM/print
  painting, PDF emission. Mostly React-free; `typeset/render/dom.tsx` is the
  intentional rendering boundary, and **Node server imports must stay on
  React-free engine subpaths**.
- `packages/editor/` — the reusable React editing surface: document/history
  hooks, contenteditable adapter, formatting toolbar/popovers, editor chrome,
  shared editor styles. Depends on the engine, never on an app.
- `apps/typeset/` — only the standalone product shell: file lifecycle, browser
  autosave, Typeset identity, static deployment, package composition.
- `apps/role-fit-ai/` — RoleFit orchestration: job intake, AI workflow,
  provider settings, tracker/workspace persistence, browser extension, host
  navigation, review rail, the RoleFit-only editor overlay.
- Root — lockfile, shared TS config, cross-workspace scripts, repo docs, CI,
  app-specific deploy workflows.

Apps never import from each other. Packages never import from apps. A package
must not absorb an app-specific workflow merely because two components look
similar.

## Modularity, Reuse, And Maintainability

- Choose the simplest design that fully satisfies the current requirement. Do
  not add indirection, configuration, abstractions, compatibility layers, or
  speculative flexibility without a demonstrated need. Keep a change local
  until a real ownership or reuse boundary justifies extraction.
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
- Comment only when the code cannot express an important constraint, bug
  prevention, or contract. Keep it to one or two lines; do not narrate
  self-evident code, restate types, or leave process notes. Remove redundant or
  stale comments in touched code. Durable rationale belongs in the scoped
  `AGENTS.md`; a paragraph-long comment is filed in the wrong place.
- Keep domain logic independent of React and the DOM where practical.
  Components adapt deterministic helpers to state and events; hooks own
  cohesive state/effect lifecycles; app shells compose them.
- Keep side effects at explicit boundaries: browser/file lifecycle in app
  shells or focused hooks, editor DOM work in the editor adapter, PDF/download
  work at export boundaries, server I/O in RoleFit server modules.
- Keep state close to its owner: derive rather than synchronize, keep reducer
  transitions serializable and atomic, and pass values and callbacks into
  reusable controls instead of giving them hidden storage access.
- Shared component changes must preserve every host's accessibility, error
  handling, responsive behavior, and styling seams. Never weaken validation,
  privacy, deterministic layout, or truthful AI behavior to ease reuse.
- Treat files near 300 lines, unrelated effects in one hook/component, or
  repeated edits across distant modules as prompts to inspect cohesion. A large
  cohesive controller may stay intact when extraction would only thread refs
  without isolating behavior; record that decision in its scoped guide.

Before moving app code into a package, verify all five: two real consumers need
the same behavior (not merely similar markup); the API needs no host state or
product language; the dependency direction stays acyclic; styling and
accessibility stay host-safe; and focused package tests plus both integrations
can verify the move.

## Shared Product And Data Invariants

- `ResumeData` is the canonical resume model in both apps and the shared
  editor's in-memory document shape. RoleFit cover letters adapt an ordered
  paragraph document into that shape without exposing resume sections.
- `.resume` uses `format: "typeset-resume"` and its sole current
  `schemaVersion: 1`. `.cover` uses `format: "typeset-cover-letter"` and its
  sole current `schemaVersion: 1`. Both documents persist an explicit optional
  header object; no alternate runtime schema is accepted. Each is the strict portable
  editable format for its own document kind. PDF is final output.
- Session ids never cross the file boundary. View-only preferences such as zoom
  and spell-check never enter `.resume` or `.cover` files.
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
root `dev`, `build`, or `preview` command — name the app:

```bash
npm install
npm run dev:rolefit          # also dev:typeset
npm run build:rolefit        # also build:typeset
npm run check                # full gate; npm test for offline evals
npm run check --workspace packages/engine   # or editor / apps/*
```

See `docs/development.md` for the verification matrix and focused evals.

Ports: RoleFit `5181`, landing `5182`, Typeset `5186` (HMR `24686`); the
workspace reserves `5181-5183` and `5186`. A bound canonical port means that
app is already running — reuse it rather than selecting another.

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
- Keep implementation scope literal. An improvement you notice but the request
  does not require gets presented to the user and waits for approval, even in a
  file you are already editing.
- Make one responsibility-level extraction at a time and verify before stacking
  another structural change.
- At the end of each coherent stage, review that stage's diff before continuing.
  Check scope, correctness, ownership, naming, duplication, error paths, test
  evidence, and maintainability; fix issues before stacking the next stage.
- Surface actionable failures; do not add silent fallbacks or empty catches.
- Ask before adding a dependency or changing schemas, provider defaults,
  deployment shape, public runtime exposure, or paid services.
- Once a dependency change is approved, read the root `package.json`,
  `package-lock.json`, and the affected workspace manifest for the runtime and
  range policy already in force, then verify the current stable release from
  npm or the maintainer's release notes — never choose a version from memory.
  Prefer the latest compatible stable release, keep npm workspaces and the
  existing range style, update the lockfile, and explain any deliberate pin to
  an older or prerelease version. Engine changes must stay React-free on the
  subpaths the Node server imports.

## Verification And Definition Of Done

- Run the narrowest owner-level check while iterating, then every affected
  consumer check in proportion to blast radius.
- A package change is not verified by one app build. Check the package and each
  app whose integration contract changed.
- Browser QA is flag-first: skip it by default, and when a change carries real
  layout, interaction, responsive, or theming risk, name the risk and let the
  user decide rather than starting a dev server unasked. State why visual QA
  was not needed. Rendered-output checks below are not optional this way.
- PDF changes require rendered-output comparison; file changes require valid
  round trips plus malformed-input rejection.
- AI/prompt/sanitizer changes require the relevant offline adversarial probes.
  Live provider evals run only when explicitly justified and authorized.
- Documentation-only changes require path/link/command verification rather
  than an unnecessary runtime build.
- Update affected docs and continuity when behavior, ownership, or a durable
  decision changes.
- Before declaring completion, review the complete diff and affected surrounding
  code as one change. Remove accidental complexity, redundant comments, dead
  paths, duplication, and temporary scaffolding; confirm the result remains
  readable and maintainable, then run the proportionate final checks.

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
  Unlike the sibling repositories in this workspace, `CONTINUITY.md` is
  **tracked** here, so it is a legitimate staging candidate; `.claude/` is not.
- Never bypass hooks (`--no-verify`, `--no-gpg-sign`); fix the cause instead.

Before a requested push, review the affected README and product/engineering
docs: update visitor-facing docs for changed behavior, commands, or
availability, and engineering docs for changed contracts. Include the compact,
privacy-safe continuity receipt in the behavior-slice commit.

A version bump carries extra obligations: update the canonical version and
every user-facing reference, then — during the requested push, merge, or deploy
— trigger the matching release/publish workflow and required tag, wait for it
to finish successfully, and retain the workflow or live-environment receipt.
**A versioned change is incomplete until that completion is confirmed.**

## Continuity

Keep continuity factual and bounded. Tag entries with an ISO date and
`[USER]`, `[CODE]`, `[TOOL]`, or `[ASSUMPTION]`; write `UNCONFIRMED` rather than
guessing. Root continuity owns cross-workspace architecture and deploy state;
app continuity owns only app-specific detail. Supersede changed facts instead
of appending contradictory narratives.
