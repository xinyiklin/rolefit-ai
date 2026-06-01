# Role-Fit AI — Claude Overrides

`AGENTS.md` is the canonical guide. Read it and `CONTINUITY.md` before
acting. This file adds Claude-specific behavior; when it conflicts with
`AGENTS.md`, this file wins.

## Tool Use

- `Read` before `Edit` / `Write`. Never `Write` without reading first.
- Prefer `Grep` / `Glob` over shell `grep` / `find` for codebase searches.
- Use `Edit` for targeted changes; reserve `Write` for new files or
  intentional full-file replacements after first reading the existing
  file.
- Run commands via `Bash` from the project root. The dev server uses
  port `5181` by default (reserved range `5181-5183`). If `5181` is
  already in use, the app is almost certainly already running — connect
  to `http://localhost:5181` instead of launching another `npm run dev`,
  and do not switch ports to sidestep the conflict. (Sibling
  reservations: careflow `5173-5180`, portfolio `5184-5185`.)

## Visual QA

For UI changes, use `mcp__Claude_in_Chrome` when available:
`navigate` to `http://localhost:5181` after `npm run dev` (or directly
if the server is already running on `5181`), then `get_page_text`,
`read_page`, or `computer` (screenshot) to verify the change. Note the
gap in the final response if Chrome tooling is unavailable.

## Resume And Job Data Handling

- Do not print raw resume text, job descriptions, or AI prompts in chat
  unless the user explicitly asks for local debugging.
- Treat anything under `job-search-workspace/` (including `applications.json`
  and `base-resume.*`), `.env`, and root-level `*.docx` / `*.pdf` /
  `*resume*.*` files as sensitive local data.
- Do not `Read` `.env` to display its contents in chat. If you need to
  confirm a key is present, check `process.env` access patterns in
  `server.mjs` instead.

## Git

The workspace is not currently a tracked git repository. If it becomes
one, do not stage `CLAUDE.md`, `AGENTS.md`, or `CONTINUITY.md` unless
the user explicitly asks.

## Communication

Think privately. Report actions, blockers, and outputs only. Skip
preambles and reasoning unless asked.
