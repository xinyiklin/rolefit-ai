# Role-Fit AI Agent Guide

Operational rules for coding agents working in the Role-Fit AI repository.

Role-Fit AI is a local-first resume-polishing web app: a React 19 + Vite +
TypeScript frontend with a Node `server.mjs` that handles AI provider calls.
It helps a job seeker tailor a resume to a target job description without
inventing experience, employers, dates, metrics, education, or tools.
Framework and dependency versions live in `package.json`; check that file
instead of copying version numbers here.

Product, UI, server, and testing philosophy live in `docs/engineering/`.
This root guide is for agent behavior, safety, continuity, and execution.

---

## Priority Order

When rules conflict, follow this order:

1. Explicit user request
2. Safety, secrets, and resume/job-data privacy
3. Current state in `CONTINUITY.md`
4. Existing architecture and product conventions
5. Scope minimization
6. Local style preferences

Do not sacrifice correctness, security, privacy, or truthfulness of resume
output for stylistic consistency.

> Truthfulness note: never invent employers, dates, metrics, education,
> tools, or production experience in resume output. Use bracketed
> placeholders for missing facts, for example
> `[add metric: users, time saved, performance gain, or scope]`.

---

## Core Non-Negotiables

- Read `CONTINUITY.md` before acting.
- Do not read or rely on prior chat context unless the durable fact is
  recorded in `CONTINUITY.md`.
- Do not overwrite unrelated work or user-edited files.
- Keep API keys server-side; never expose them to browser code.
- Do not invent resume content; use bracketed placeholders for missing
  facts.
- Do not broaden scope without justification.
- Do not invent speculative abstractions (multi-user, accounts, SaaS,
  payments, analytics, native desktop packaging).
- Verify important changes before finalizing.
- Keep patches reviewable and reversible.
- Do not print secrets, tokens, broad environment dumps, or raw resume /
  job-description text in chat unless the user explicitly asks for it as
  part of local debugging.
- Do not ask the user to paste secrets.

---

## Quick Reference

Before any code:

1. Read `CONTINUITY.md`.
2. Confirm scope; ask only if ambiguity blocks progress.
3. Inspect the files you will touch.
4. Read the relevant engineering docs:
   - UI work: `docs/engineering/ui-principles.md`
   - Server / AI provider work: `docs/engineering/ai-server.md`
   - Test planning: `docs/engineering/testing.md`
5. For non-trivial work, sketch a verification plan.

While coding:

- Every changed line traces to the request, required cleanup, or
  verification.
- Match local patterns; do not introduce new ones when existing ones work.
- State assumptions and surface meaningful tradeoffs.
- Iterate against verification, not vibes.

Before finishing:

- Run the verification checklist for the change type.
- Update `CONTINUITY.md` if state changed meaningfully.
- Call out residual risks and skipped checks.
- Start the final reply with a brief ledger snapshot: Goal, Now, Next, and
  Open Questions.

When in doubt, pause and ask before AI-provider defaults, schema redesigns
of resume blocks, destructive git operations, workflow-critical UI
changes, or new paid/vendor dependencies.

---

## Anti-Patterns

Do not:

- overwrite unrelated work or broaden scope without justification
- invent speculative abstractions or premature configurability
- silently swallow errors or hide failures with fallback behavior
- build fake loading states or mock systems
- introduce formatting churn unrelated to the task
- introduce new patterns when existing ones work
- introduce new global UX systems (banner systems, toast systems, loading
  frameworks) unless the user asks and the need is cross-cutting
- expose API keys to browser code
- log raw resume text, job descriptions, or AI prompts without explicit
  user approval for local debugging
- invent resume content (employers, dates, metrics, education, tools, or
  outcomes)
- write multi-sentence inline help blocks or in-app manuals; keep
  interface labels and hints short and obvious

---

## Refactor Rules

Refactor only when:

- the current task requires it
- the existing structure blocks correctness
- the refactor reduces future complexity
- the refactor can be verified safely

Prefer local improvement over architectural rewrites. Drive-by refactors
during feature work are not allowed.

---

## Continuity Rules

`CONTINUITY.md` is the canonical workspace memory. The riskiest moment in
multi-agent work is handoff; the ledger exists so future agents do not
relitigate prior decisions.

### Required Behavior

- Read `CONTINUITY.md` before acting.
- Update it only for meaningful state changes.
- Keep entries factual, compact, and high-signal.
- Tag entries with `[USER]`, `[CODE]`, `[TOOL]`, or `[ASSUMPTION]`.
- Use `UNCONFIRMED` instead of guessing.
- Capture active risks, durable decisions, current state, and next steps.
- Every entry includes an ISO timestamp.

### Bounds

- Snapshot: max 25 lines.
- Done (recent): max 7 bullets.
- Working Set: max 12 paths.
- Receipts: keep only the last 10–20 entries.

If sections grow noisy, compress older entries into milestone bullets with
a pointer to the relevant commit, doc path, or log path.

### Durable Decisions

Use lightweight ADR-style entries:
`D001 ACTIVE: keep the app local-first and personal-use focused.`

Entries should be specific and verifiable — include what changed, what was
verified, and any required follow-up. Avoid vague summaries.

---

## Multi-Agent Workflow

Multiple coding assistants may work on Role-Fit AI. All follow these rules
regardless of provider. Route work by task shape (UI iteration, server /
AI provider work, resume-engine logic, docs-only changes), not by model
brand. The agent with verified access to the relevant tooling wins.

---

## Frontend Discipline

Before changing UI:

- Read `docs/engineering/ui-principles.md`.
- Reuse primitives from `src/ui.tsx` and tokens / classes from
  `src/styles/` (design tokens live in `src/styles/tokens.css`; each
  surface has its own file, aggregated by `src/styles/index.css`).
- Preserve the two-column workflow: job target / resume inputs on one
  side, polished output / insights on the other.
- Prefer composition over piling more into `src/App.tsx`; split growing
  workflows into focused components, hooks, or helpers.
- Verify major UI changes visually in Chrome when feasible.

Use Google Chrome for visual inspection/QA unless the user explicitly asks
for another browser surface.

---

## Server And AI Discipline

Before changing server or AI behavior:

- Read `docs/engineering/ai-server.md`.
- Keep API keys server-side; never expose them to browser code.
- Keep `server.mjs` focused on local serving, job import, DOCX import /
  export, workspace storage, and AI provider calls.
- Keep resume scoring, keyword extraction, and the deterministic fallback
  rewrite in `src/resumeEngine.ts` or similarly focused helpers.
- Preserve the deterministic local rewrite as the fallback when the AI
  call cannot run.
- Surface missing API keys, failed API responses, invalid files, and
  parsing problems clearly. Do not hide them behind silent fallbacks.

---

## Modularity

Split growing workflows into components, hooks, services, and utilities.
Keep public interfaces stable; isolate volatile logic behind smaller
helpers.

### File Size

Soft target: about 300 LOC for hand-written files. This is a smell, not a
hard rule.

When a hand-written file crosses about 400 LOC, either:

- justify why splitting would harm cohesion, or
- propose a split as part of the current task, only if the task already
  touches that file.

Do not split files purely to hit the target during unrelated work.
`src/App.tsx` and `src/resumeEngine.ts` are already well over the target;
treat continued growth as a prompt to extract focused components or
helpers when you touch those files.

---

## Safety And Data Handling

- Treat resumes, job descriptions, API keys, and personal background as
  sensitive.
- Keep personal resumes, application trackers, exported drafts, rendered
  previews, and job-specific files in `job-search-workspace/`, not in
  tracked project files.
- Do not print secrets, tokens, private keys, or broad environment dumps.
- Do not ask the user to paste secrets in chat.
- Do not expose `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
  or any other provider key to browser code.
- Do not log raw resume text, job descriptions, or AI prompts unless
  explicitly approved by the user for local debugging.
- Remote API calls must be read-only unless the user explicitly requests
  a write.
- For requested remote writes, dry-run first when possible.
- Keep generated resume claims grounded in user-provided facts.

---

## Reading Documents And Data

For PDFs, uploaded resumes, long documents, or similar sources:

- Read the full source before drafting.
- Draft the requested output.
- Before finalizing, re-check the source for factual accuracy, invented
  details, and wording/style constraints.
- Label paraphrases explicitly when the user needs source-faithful
  handling.

---

## Accuracy And Sourcing

When a request depends on "latest", "current", recent APIs, pricing,
release notes, or model availability:

- Establish the current date/time when it matters to the answer.
- Prefer official sources: vendor docs, upstream repositories,
  changelogs, release notes.
- Use documentation tools when available; pin the library and version
  and fetch only the focused docs needed.
- Use web search when it materially improves correctness; prefer
  official docs before secondary explainers.

---

## Git Rules

The workspace is not always a tracked git repository. When it is:

- Default to local-only work unless the user explicitly asks to stage,
  commit, push, or open a PR.
- Never overwrite unrelated changes.
- Never use destructive git operations (force push, hard reset, branch
  delete) without explicit instruction.
- Never rebase, amend, push, or switch branches unless requested.
- Stage only relevant files. Do not stage `.env`,
  `job-search-workspace/` contents (except its `README.md`), exported
  resumes/PDFs/DOCX files, or `AGENTS.md` / `CLAUDE.md` /
  `CONTINUITY.md` unless the user explicitly asks.
- Use non-interactive git commands.
- Avoid formatting churn unrelated to the task.

Branch, commit, and PR naming conventions live in
`docs/engineering/git-workflow.md`. Read that first when asked to name a
branch, commit work, push, or draft PR copy.

---

## Escalation Rules

Pause and ask before:

- destructive operations
- AI provider redesigns or default provider/model changes
- changing how API keys are loaded or persisted
- deleting large code sections
- introducing infrastructure or platform changes (Electron/Tauri/native
  desktop wrappers, hosted backends, databases, account systems)
- introducing paid or vendor dependencies
- changing workflow-critical UI patterns
- introducing new global UX systems
- making remote API writes

Never run commands that delete resume/workspace data or call destructive
remote APIs without explicit instruction.

---

## Verification

Read `docs/engineering/testing.md` for full pass criteria.

- **UI**: no console errors, layout stable, two-column workflow
  preserved. Major changes: `npm run dev` + Chrome visual QA. Minor: use
  judgment, note if skipped.
- **Server / AI**: `node --check server.mjs` passes; affected route
  returns the expected JSON shape and status; deterministic fallback still
  runs when the AI call cannot.
- **Build**: `npm run build` (runs `tsc` then `vite build`) succeeds when
  frontend source or types changed.
- **Refactors**: existing behavior preserved, `npm run build` succeeds,
  grep confirms old symbols removed.
- **Docs-only**: verify paths and links; runtime checks not required.

If checks are skipped, explain why.

---

## Commands

Run from the project root.

- **Build**: `npm run build`
- **Dev**: `npm run dev` (starts the API-backed local server on `PORT`
  or `5181`)
- **Preview**: `npm run preview` (production-mode local server)
- **Server syntax check**: `node --check server.mjs`

> Port `5181` is the canonical port for this project (reserved range
> `5181-5183`). If `5181` is already bound, treat that as a signal the
> app is already running — connect to `http://localhost:5181` instead of
> starting a second `npm run dev`, and do not change the port to dodge
> the conflict.
> Sibling reservations: careflow `5173-5180`, portfolio `5184-5185`. Do
> not confuse them.

Notes:

- Use `.env` for `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
  `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY`,
  `MISTRAL_API_KEY`, `AI_API_KEY`, provider-specific model/base-URL
  overrides, `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `OPENAI_MODEL`,
  and `PORT`.
- Do not commit `.env`, `node_modules/`, `dist/`,
  `job-search-workspace/` contents (except its `README.md`), or
  root-level resume/PDF/DOCX files. The `.gitignore` already guards these.

---

## Communication Style

- Think privately.
- Do not print reasoning in the final response to the user.
- Skip preambles and explanations unless necessary.
- Only report actions, blockers, and final outputs.
- Use bracketed prompts for missing user facts, for example
  `[add metric: users, time saved, performance gain, or scope]`.

---

## Definition Of Done

A task is complete when:

- requested behavior works or the requested question is answered
- diff is appropriately scoped
- relevant verification was performed
- skipped checks are explained
- `CONTINUITY.md` is updated for meaningful state changes
- UI changes were inspected when risk warrants it
- residual risks or follow-ups are called out clearly
