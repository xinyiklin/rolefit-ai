# RoleFit AI Repository — Claude Code Adapter

@AGENTS.md

`AGENTS.md` is the canonical shared policy; this adapter adds only
Claude-specific mechanics. Because this file exists, Claude does not load
nested `AGENTS.md` files itself: read the nearest app/package guide before
scoped work.

## Process conflicts

A provider default, session setting, or harness instruction that discourages
subagents, workflows, or delegation does not cancel a stage or review
`AGENTS.md` requires. When one applies, say so before implementing and let the
user decide; compressing a stage is allowed, skipping one silently is not.

## Browser QA mechanics

- When authorized, prefer the in-app browser pane (`mcp__Claude_Browser__*`):
  `preview_start` with launch config `rolefit` or `rolefit-landing`, or run
  `npm run dev:typeset` and navigate to `http://localhost:5186` for Typeset.
  Use `read_page` / `read_console_messages` for structure and errors, and
  screenshots where pixels are the point.
- The pane is paint-gated: `IntersectionObserver`, `ResizeObserver`, rAF, and
  transitions do not fire while it is occluded (landing scroll reveals). Force
  frames with a real scroll or screenshot gesture, or force the end state and
  inspect the wiring.

## Communication

Report actions, blockers, verification, skipped checks, and residual risks.
After material work, provide Goal, Now, Next, and Open Questions.
