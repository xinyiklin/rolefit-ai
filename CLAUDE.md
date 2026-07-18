# Typeset Workspace — Claude Overrides

`AGENTS.md` is the canonical workspace guide and is imported below. Read
`CONTINUITY.md` fresh before acting. The root import does not load nested
guides: explicitly read the nearest app/package `AGENTS.md` before scoped work.

@AGENTS.md

## Tool Use

- Read a file before editing it.
- Prefer targeted edits; use a full replacement only after reading the whole
  file and deciding its current structure is obsolete.
- Prefer Glob/Grep for discovery when available; otherwise use `rg`.
- Run project commands from the repository root and include the workspace in
  the command. There is no generic root `npm run dev` or `npm run build`.
- Keep output focused. Never expose broad environments, credentials, private
  resume/job text, or generated artifacts.

## Implementation Workflow

- Map callers, state owners, package/app boundaries, and consumers before
  extracting or sharing a module.
- Follow `docs/architecture.md` for shared-versus-host ownership. Similar names
  or markup are not enough evidence to move code into a package.
- Make one responsibility-level extraction at a time. For shared changes,
  report which package checks and app integrations were verified.
- Keep Typeset's static runtime and RoleFit's loopback server contract distinct.

## Visual And Output QA

- Typeset: run `npm run dev:typeset`, then inspect
  `http://localhost:5186` at representative desktop/tablet/compact widths.
- RoleFit: run `npm run dev:rolefit`, then inspect
  `http://localhost:5181` when the change carries real layout or interaction
  risk; follow its scoped flag-first visual-QA rule.
- For `.resume` work, open/save a real file and verify round-trip plus malformed
  input errors.
- For PDF work, render the emitted PDF and compare it with the editor; build
  success alone is not visual parity.

## Communication

Think privately. Report actions, blockers, verification, skipped checks, and
residual risks. After material work, provide Goal, Now, Next, and Open Questions.
