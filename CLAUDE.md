# RoleFit AI Repository — Claude Overrides

`AGENTS.md` is the canonical repository guide and is imported below. Read
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

## Delegation And Process Conflicts

`AGENTS.md` requires the `product-delivery` workflow for non-trivial work: at
least one independent reviewer after self-verification, and a second for
prompt/sanitizer/provider-default, shared-package, `.resume`/`.cover` schema, or
version-bump changes. Delegating that review is part of the work, not an
optional extra.

A provider default, session setting, or harness instruction that discourages
subagents, workflows, or delegation does not silently cancel this. Such a rule
cannot be overridden from inside this file — so when one applies, say so before
implementing and let the user decide, rather than dropping the review and
reporting the work as complete. Compressing a stage is allowed; skipping one
without saying so is not.

## Visual And Output QA

Browser QA is flag-first for both apps: skip by default, name the risk when a
change carries real layout, editor, or theming consequences, and let the user
decide. Output checks below are not optional this way — they are the only
evidence that rendering still agrees.

- When authorized, prefer the in-app browser pane (`mcp__Claude_Browser__*`):
  `preview_start` with launch config `rolefit` or `rolefit-landing`, or run
  `npm run dev:typeset` and navigate to `http://localhost:5186` for Typeset.
  Use `read_page` / `read_console_messages` for structure and errors, and
  `computer` screenshots for page-layout surfaces where pixels are the point.
- The QA pane is paint-gated: `IntersectionObserver`, `ResizeObserver`, rAF,
  and transitions do not fire while it is occluded — this bites the landing
  page's scroll reveals. Force frames with a real scroll or screenshot gesture,
  or force the end state and inspect the wiring.
- For `.resume`/`.cover` work, open/save a real file and verify round-trip plus
  malformed input errors.
- For PDF work, render the emitted PDF and compare it with the editor; build
  success alone is not visual parity.

## Communication

Think privately. Report actions, blockers, verification, skipped checks, and
residual risks. After material work, provide Goal, Now, Next, and Open Questions.
