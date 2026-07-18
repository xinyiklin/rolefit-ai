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

## Minimum PR receipt

Report:

1. behavior/ownership changed;
2. workspaces and important files touched;
3. focused checks;
4. broader consumer checks;
5. skipped visual/live checks and residual risks.

Reference: [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
