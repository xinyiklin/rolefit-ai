# RoleFit AI — Claude Overrides

The root and app `AGENTS.md` files are canonical and imported below. Read
`CONTINUITY.md` fresh. The imports do not load nested guides; read the nearest
`src/`, `server/`, `server/ai/`, or `extension/` guide before scoped work.

@../../AGENTS.md
@AGENTS.md

## Tool use

- Read before editing; prefer targeted edits over full replacement.
- Run commands from the repository root with the RoleFit workspace named.
- Use `npm run dev:rolefit` for port 5181. A bound port usually means the app is
  already running; inspect and reuse it.
- Do not inspect or print `.env` values. Verify credential wiring from code.

## Visual QA

Default to the app's flag-first policy. When a change has real layout,
responsive, editor, or theming risk, flag it for the user before browser work.
If authorized, inspect `http://localhost:5181` in the normal masthead + studio
workflow, including keyboard behavior and console state.

## Sensitive data

Never use browser or shell inspection to print transient AI-menu keys, raw
resume/job content, prompts, or private workspace files. Use synthetic fixtures
for routine tests.
