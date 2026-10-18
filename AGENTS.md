# RoleFit AI Repository Agent Guide

Provider-agnostic working agreements for the RoleFit AI npm-workspaces
repository. It contains two products over two private shared packages:

- **RoleFit AI** is a local-first resume-tailoring workbench with a loopback
  Node server, AI providers, local workspace storage, and a browser extension.
- **Typeset** is a static, browser-only resume editor.

Do not apply one app's runtime, privacy, product, or deployment assumptions to
the other. `CLAUDE.md` adds provider-specific mechanics; the nearest
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
  shared-versus-host ownership), `development.md` (commands, ports,
  dependencies, generated assets, verification matrix), `git-workflow.md`
  (branch, commit, PR, staging, release, versioning).
- `apps/role-fit-ai/{README,PRODUCT,DESIGN}.md` + `docs/engineering/` — RoleFit
  behavior and engineering contracts.
- `apps/typeset/AGENTS.md` + `{README,PRODUCT,DESIGN}.md` — Typeset shell,
  behavior, visual contract.
- `packages/{engine,editor}/AGENTS.md` — package boundaries and public
  contracts; their nested guides own resume domain/files and deterministic
  layout/PDF, and hooks/chrome/direct editing respectively.
- Nested `AGENTS.md` files under each app and package — read the nearest one
  yourself before scoped work.
- `CONTINUITY.md` — bounded handoff state; `docs/decisions.md` — numbered rules
  in force, read before changing one. RoleFit's local app ledger may hold
  app-only operational detail; never duplicate a fact in both.

## Product-Delivery Hook

The installed `~/.agents/workflows/product-delivery/` contract is inactive for
ordinary work. Its complete flow activates when the user selects Delivery Lead
or Product Partner, explicitly requests the complete workflow, continues an
active Implementation Plan, or a condition below matches. Selecting the
Verifier activates independent verification only. When active, follow the
installed contract without copying its rules or artifacts here. Project
additions:

- **Named work that activates the workflow:** changes to `packages/engine` or
  `packages/editor`; `.resume`/`.cover` schema or codec behavior; AI prompt,
  sanitizer, or provider-default changes; API-key handling or server network
  exposure; moving app code into a package or changing the dependency
  direction; a version bump that triggers a release workflow.
- **Maintenance outside those conditions:** typo/link corrections, reflow,
  tests of unchanged behavior, and internal refactors preserving the named
  contracts. A change to a named contract still activates the flow; record the
  classification.
- **Additional material-change triggers:** the named work above, or anything
  that could weaken evidence-grounded AI output or the local-only data posture.
- **Required checks:** the verification matrix in `docs/development.md`.
- **Task artifacts** stay local under ignored `.agent-work/tasks/<task-id>/`;
  never force-add them. Durable decisions and verification summaries go
  self-contained into tracked docs and `CONTINUITY.md`.

When a listed condition matches and the workflow or its review is not run, say
so in the response and record the reason.

## Independent Review

After your own verification and before local completion, every change gets one
fresh independent review by a reviewer that did not implement it: the
`code-reviewer` agent in Claude for code diffs, otherwise the installed
Verifier (`mb-verifier` in Claude, `mb_verifier` in Codex). A change confined
to typos, broken links, formatting, or comments with no change in meaning,
behavior, or configuration needs only your own verification; state that
classification. Add a **second reviewer** for the shared packages, `.resume`/
`.cover` schema or codec behavior, AI prompt/sanitizer/provider defaults, and
release-triggering version bumps. Only the user may waive a required review;
record the waiver, never a pass. If a reviewer is unavailable, report the gap.
If the user asks for more reviewers, give a firm risk-based recommendation
first, then honor the request.

## Workspace Ownership

The dependency direction is:

```text
@typeset/engine -> @typeset/editor -> apps/typeset
                                  -> apps/role-fit-ai
```

- `packages/engine/` — deterministic document behavior: `ResumeData`, the
  constrained cover-letter paragraph adapter, document style, the strict
  `.resume`/`.cover` codecs, bundled fonts, measurement, layout, DOM/print
  painting, PDF emission. Mostly React-free; DOM painting under `typeset/render/`
  is the intentional React boundary, and **Node server imports must stay on
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

## Modularity And Ownership

- Choose the simplest design that fully satisfies the current requirement: no
  speculative abstraction, configuration, compatibility layer, pass-through
  wrapper, broad barrel, or mode-heavy component.
- Find the current owner before adding a type, transform, option list, state
  field, component, or CSS rule, and extend that one source of truth.
- Keep domain logic independent of React and the DOM where practical, and keep
  side effects at explicit boundaries: browser/file lifecycle in app shells or
  focused hooks, editor DOM work in the editor adapter, PDF/download work at
  export boundaries, server I/O in RoleFit server modules.
- Keep state close to its owner: derive rather than synchronize, keep reducer
  transitions serializable and atomic, and pass values and callbacks into
  reusable controls instead of giving them hidden storage access.
- Shared component changes must preserve every host's accessibility, error
  handling, responsive behavior, and styling seams. Never weaken validation,
  privacy, deterministic layout, or truthful AI behavior to ease reuse.
- Comment only for a constraint, bug prevention, or contract the code cannot
  express, in one or two lines; durable rationale belongs in the scoped
  `AGENTS.md`. Remove stale comments in touched code.
- Treat files near 300 lines or unrelated effects in one hook/component as
  prompts to inspect cohesion. A cohesive controller may stay intact when
  extraction would only thread refs; record that decision in its scoped guide.

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
- AI generation instructions must remain evidence-grounded: never instruct
  invention of employers, dates, metrics, education, tools, experience, or
  outcomes. RoleFit content/evidence judgments follow its
  [user-directed warning policy](apps/role-fit-ai/PRODUCT.md#content-and-evidence-warning-policy):
  otherwise usable output remains reviewable with warnings, while security and
  data-integrity protections remain blocking. This policy does not change Typeset
  or portable document schemas.

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

- Keep implementation scope literal. An improvement you notice but the request
  does not require gets presented to the user and waits for approval, even in a
  file you are already editing.
- Make one responsibility-level extraction at a time and verify before stacking
  another structural change; review each stage's diff before continuing.
- Surface actionable failures; do not add silent fallbacks or empty catches.
- Ask before adding a dependency or changing schemas, provider defaults,
  deployment shape, public runtime exposure, or paid services. Follow
  `docs/development.md` for approved dependency changes.

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
  code as one change; remove accidental complexity, redundant comments, dead
  paths, duplication, and temporary scaffolding, then run the proportionate
  final checks.

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
- No agent attribution in commits, PR bodies, or squash messages, and rename a
  harness `claude/…` worktree branch before its first push; both rules live in
  `docs/git-workflow.md`.

Read `docs/git-workflow.md` before any push, PR, merge, release, or version
bump; it owns the pre-push doc review, the continuity receipt, and release
suggestions. Bump a version only after the user agrees. **A versioned change is
incomplete until its release/publish workflow is confirmed complete.**

## Continuity

Keep `CONTINUITY.md` within its 160-line cap and limited to current state,
next actions, and open questions. Keep rules in force in `docs/decisions.md`
and rotate resolved entries verbatim to `docs/continuity/YYYY-MM.md`; archives
are append-only and read only on demand. The shared `continuity` skill does
this. Tag entries with an ISO date and `[USER]`, `[CODE]`, `[TOOL]`, or
`[ASSUMPTION]`; write `UNCONFIRMED` rather than guessing. Root continuity owns
cross-workspace architecture and deploy state; app continuity owns only
app-specific detail.
Supersede changed facts instead of appending contradictory narratives.
