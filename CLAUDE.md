# Typeset — Claude Overrides

`AGENTS.md` is the canonical guide and is imported below. `CONTINUITY.md` is not
imported because it changes frequently; read it fresh before acting. This file
adds Claude-specific behavior and wins if it conflicts with `AGENTS.md`.

@AGENTS.md

The import above covers only the root guide. Read the nearest nested
`AGENTS.md` explicitly before editing files in a scoped directory.

## Tool Use

- Read a file before editing it.
- Prefer targeted edits for scoped changes and full replacement only when a file
  is obsolete or a clean rewrite is requested.
- Prefer Glob/Grep for discovery when available; otherwise use `rg`.
- Use the shell for project commands, checks, builds, and git. Do not use shell
  write tricks when the editing tools are safer.
- Keep command output focused. Do not expose broad environments, credentials, or
  large generated logs.
- Run commands from the repository root.
- `npm run dev` starts the Vite development site on port 5186. There is no
  application backend to start separately.
- A bound port 5186 means the app is already running; connect to it rather than
  choosing another port.

## Implementation Workflow

- Before extracting or adding a module, use search to map its callers, existing
  helpers, state owner, and editor/print/PDF consumers. Follow the maintainability
  boundaries in `AGENTS.md`; do not infer reuse from similar names alone.
- Make one responsibility-level extraction at a time. Check the focused behavior
  before continuing so a mechanical move is not confused with a behavior change.
- When a shared path changes, report which consumers were checked. For Typeset,
  sharing is not complete until the relevant editor, browser print, and dedicated
  PDF paths still agree.

## Visual QA

Verify material UI changes in a real browser.

- **Layout, responsive behavior, and visual fidelity:** prefer Claude in Chrome
  with a real window and representative desktop/tablet widths.
- **Content, computed styles, tokens, and console state:** Claude Preview is
  suitable when its deterministic inspection is more useful.
- If the preferred bridge is unavailable, use the other and report the gap.

Default flow: run `npm run dev`, navigate to
[http://localhost:5186](http://localhost:5186), and inspect the editor at a
desktop width first. The resume is a page-layout surface, so use screenshots for
visual evidence and test keyboard focus for toolbar/popover changes.

For file-lifecycle work, open a real `.resume` file, save it again, and confirm
content/style round-trip plus a clear malformed-file error. For Export PDF changes,
render the emitted `.pdf` (the dedicated pdf-lib path, not the browser print
dialog) and confirm it matches the editor: fonts, inline marks, links, rules,
alignment, whitespace, and pagination. For manual browser print (⌘P) changes,
check print media and confirm the application chrome is excluded.

## Communication

Think privately; do not print raw reasoning. Report actions, blockers,
verification, skipped checks, and final outputs. After material work, lead with
a concise Goal, Now, Next, and Open Questions snapshot.
