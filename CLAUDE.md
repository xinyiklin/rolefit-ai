# Role-Fit AI — Claude Overrides

`AGENTS.md` is the canonical guide. It is imported below, so its rules load
into context every session — no separate read step. `CONTINUITY.md` is **not**
imported (it changes constantly); read it fresh before acting. This file adds
only Claude-tool-specific behavior; when it conflicts with `AGENTS.md`, this
file wins.

@AGENTS.md

## Tool Use

- `Read` before `Edit` / `Write`; never `Write` without reading first.
- Prefer `Grep` / `Glob` over shell `grep` / `find` for codebase searches.
- Use `Edit` for targeted changes; reserve `Write` for new files or
  intentional full-file replacements of a file you have already read.
- Run commands via `Bash` from the project root. (Port `5181` rules and the
  env/command reference live in `AGENTS.md` › Commands.)

## Visual QA

Verify major UI changes in a browser when feasible (`AGENTS.md` default).
Pick the tool by what you're verifying:

- **Layout / responsive / visual fidelity** → **Claude in Chrome**
  (`mcp__Claude_in_Chrome`): real window, accurate at any width
  (`resize_window`, e.g. 1440 / 768 / 375), faithful screenshots.
- **Content / computed styles / tokens / console** → **Claude Preview**
  (`mcp__Claude_Preview`): `preview_snapshot` / `preview_inspect` are
  deterministic (no pixel-guessing); `preview_screenshot` for a glance, fall
  back to snapshot/inspect if blank.
- If the chosen tool's bridge isn't connected, use the other and note the gap.

**Default: skip visual QA.** Only run it when the change carries real
layout/theming risk (new components, responsive breakpoints, editor surfaces,
token/color changes). When that threshold is met, flag it and let the user
decide — don't run unsolicited. When running: Chrome is the default tool;
`navigate` to `http://localhost:5181` after `npm run dev`, then
`get_page_text` / `read_page` / `computer`.

## Resume And Job Data Handling

`AGENTS.md` covers resume/job-data privacy in full. Claude-tool-specific
addition: do not `Read` `.env` to display its contents in chat — to confirm a
key is present, check `process.env` access patterns in `server.ts` instead.
