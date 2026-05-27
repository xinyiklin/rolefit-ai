# Git Workflow

Role-Fit AI is a personal job-prep project. The workspace is not always
a tracked git repository; when it is, the conventions below keep local
history, future GitHub PRs, and any later changelog work easy to scan.

## When Git Is Not Initialized

Treat the workspace as local-only. Do not run `git init`, `git add`, or
any other git command unless the user explicitly asks. Continue using
`CONTINUITY.md` as the canonical workspace memory.

## Branch Names

When a git repo exists, use lowercase kebab-case with a type prefix:

```text
<type>/<short-kebab-task>
```

Supported branch types:

- `feature/` for new product or workflow capabilities
- `fix/` for bug fixes
- `refactor/` for behavior-preserving structure changes
- `docs/` for docs-only branches that span multiple files

Rules:

- Keep names lowercase.
- Use kebab-case after the slash.
- Make the task specific enough to scan in branch lists.

Examples:

```text
feature/resume-blocks-editor
fix/openai-key-leak-guard
refactor/extract-provider-clients
docs/ai-server-guidelines
```

## Commit Message Convention

Use Conventional Commit subjects for all normal commits:

```text
<type>: <summary>
```

Rules:

- Use a lowercase type: `feat`, `fix`, `docs`, `style`, `refactor`,
  `test`, `chore`, `build`, `ci`, `perf`, or `revert`.
- Add an optional lowercase noun scope when it helps:
  `<type>(<scope>): <summary>`, such as `ui`, `server`, `polish`,
  `docx`, `workspace`, `deps`, or `workflow`.
- Write the summary in imperative mood: `add`, `fix`, `preserve`,
  `remove`, `split`.
- Keep the summary lowercase unless a proper noun, acronym, or code
  identifier requires capitalization.
- Keep the first line short, with about 50 characters as a soft target.
- Do not end the subject with a period.
- Add a body when the why, tradeoff, or verification context will
  matter later.
- Split unrelated work into separate commits.

Examples:

```text
feat: add deterministic rewrite fallback
fix(server): reject empty api key instead of silent fallback
refactor(ui): extract polish controls component
feat(polish): cap each role to five bullets
docs(engineering): add ai-server guidelines
chore(deps): bump vite to 7.x
```

Breaking changes follow Conventional Commits:

```text
feat(api)!: rename /api/polish payload shape

BREAKING CHANGE: /api/polish now requires `provider` instead of `mode`.
```

## PR Workflow

If / when this repo gains a GitHub remote:

- Open a PR for every change that touches the repo, including
  single-file edits and documentation. Do not commit directly to
  `main`.
- Default merge strategy: **squash and merge**, so each PR collapses to
  one commit on `main`.
- Aim for ≤500 lines changed per PR; treat ≤1000 lines as a hard cap.
  Split larger work.
- Run the minimum local gate before opening a PR:

  ```bash
  node --check server.mjs
  npm run build
  ```

## Safety Rules

- Never force-push to `main`. `--force-with-lease` is acceptable on
  feature branches when rewriting history before merge.
- Never bypass pre-commit hooks (`--no-verify`, `--no-gpg-sign`)
  without an explicit reason recorded in the PR body or commit message.
- Do not stage `.env`, `node_modules/`, `dist/`, `outputs/`,
  `job-search-workspace/` contents (except its `README.md`), or
  root-level resume / PDF / DOCX / tracker files. The `.gitignore`
  already guards these — verify with `git status --short` before
  staging.
- Do not stage `AGENTS.md`, `CLAUDE.md`, or `CONTINUITY.md` unless the
  user explicitly asks.

## Source Basis

- Conventional Commits 1.0.0:
  https://www.conventionalcommits.org/en/v1.0.0/
- Git's `SubmittingPatches` guidance:
  https://git-scm.com/docs/SubmittingPatches
