# Git Workflow

These conventions apply to the whole monorepo. Git actions remain local-only
unless the user explicitly asks to stage, commit, push, open a PR, or merge.

## Branch names

Use lowercase kebab-case with a type prefix:

```text
<type>/<short-kebab-task>
```

Common types are `feature`, `fix`, `refactor`, and `docs`. Name the behavior
slice, not merely the workspace: `fix/rolefit-distill-gate` is clearer than
`fix/app`; `refactor/editor-toolbar-contract` is clearer than `refactor/shared`.

## Commits

Use Conventional Commit subjects:

```text
<type>(<scope>): <imperative summary>
```

Useful monorepo scopes include `engine`, `editor`, `typeset`, `rolefit`,
`server`, `ai`, `extension`, `workspace`, `deps`, `docs`, and `ci`. Keep one
coherent behavior slice per commit. A package change and the necessary consumer
updates belong together when splitting them would leave the branch broken.

## Pull requests

- Prefer reviewable behavior slices over one PR per physical workspace.
- State which workspaces changed and which checks ran.
- For shared package changes, list every affected consumer and its verification.
- Use squash merge unless the user requests another strategy.
- Keep unrelated agent-guide or documentation changes out of a code PR unless
  they describe the behavior or ownership changed by that PR.

## Review and exact-head merge gate

Complete implementer self-review and the fresh independent review required by
`AGENTS.md` as separate checks. Before merge, record the PR head SHA and confirm
it is the exact reviewed commit, required CI is green, GitHub reports the PR
mergeable and conflict-free, and requested changes or unresolved threads are
handled. Any new commit or conflict resolution requires fresh affected checks
and a new exact-head review.

## Staging and safety

- Inspect `git status --short` before staging; this repository often has
  concurrent or uncommitted work.
- Stage exact paths. Do not use broad staging as a shortcut around a dirty tree.
- Never stage `.env`, personal RoleFit workspace data, exported resumes/PDFs,
  `node_modules`, app `dist/`, or generated app font mirrors.
- Treat `AGENTS.md`, `CLAUDE.md`, READMEs, product/design docs, and package docs
  as normal tracked files when they are part of the requested change.
- Never force-push, amend, rebase, switch branches, or rewrite history without
  explicit authorization.

After an authorized squash merge, verify the resulting base-branch commit and
tree, update the local base branch with `git pull --ff-only`, and remove feature
branches only when that cleanup was authorized and is safe for other work.

## Documentation, continuity, and releases

Before a requested push, review the affected README and product/engineering
documentation. Update the visitor-facing README when behavior, commands, or
availability changes, and update engineering documentation when a contract
changes. Include the compact, privacy-safe `CONTINUITY.md` receipt in the
behavior-slice commit; do not record personal resume/job content, credentials,
or provider responses.

When changing a product version, update the canonical package/app version and
user-facing version references together. During a requested push, merge, or
deploy of that versioned change, trigger the matching required tag and
release/publish workflow, wait for successful completion, and retain the
workflow or live-environment receipt. A versioned change is incomplete until
that release/deploy completion is confirmed.

## Minimum PR receipt

Report:

1. behavior/ownership changed;
2. workspaces and important files touched;
3. focused checks;
4. broader consumer checks;
5. skipped visual/live checks and residual risks.

Reference: [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
