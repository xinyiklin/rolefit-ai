# RoleFit AI — Claude Overrides

The app `AGENTS.md` is canonical and imported below; the root guide already
loads from the repository root. The import does not load nested guides; read
the nearest `src/`, `server/`, `server/ai/`, or `extension/` guide before
scoped work.

@AGENTS.md

## Tool use

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

Never use browser or shell inspection to print API keys, raw resume/job
content, prompts, or private workspace files. Use synthetic fixtures for
routine tests.
