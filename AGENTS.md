# Role-Fit AI Agent Guide

Operational rules for coding agents working in the Role-Fit AI repository.

Role-Fit AI is a local-first resume-polishing web app: a React 19 + Vite +
TypeScript frontend with a Node `server.mjs` API layer for AI provider calls.
It helps a job seeker tailor a resume to a target job description without
inventing experience, employers, dates, metrics, education, tools, or
production outcomes. Framework and dependency versions live in `package.json`.

Product, UI, server, and testing philosophy live in `docs/engineering/`.
This root guide is the operating contract: safety, continuity, scope, and
verification.

---

## Priority Order

When rules conflict, follow this order:

1. Explicit user request
2. Safety, secrets, and resume/job-data privacy
3. Current state in `CONTINUITY.md`
4. Existing architecture and product conventions
5. Scope minimization
6. Local style preferences

Never sacrifice correctness, security, privacy, or truthful resume output for
style. Use bracketed placeholders for missing facts, for example
`[add metric: users, time saved, performance gain, or scope]`.

---

## Non-Negotiables

- Read `CONTINUITY.md` before acting.
- Do not rely on prior chat context unless the durable fact is recorded in
  `CONTINUITY.md`.
- Do not overwrite unrelated work or user-edited files.
- Keep API keys server-side; never expose provider keys to browser code.
- Do not print secrets, tokens, broad environment dumps, raw resume text, raw
  job descriptions, or AI prompts in chat unless the user explicitly requests
  that local debugging output.
- Do not ask the user to paste secrets.
- Do not invent employers, dates, metrics, education, tools, experience, or
  outcomes in resume output.
- Do not broaden scope, add speculative abstractions (multi-user, accounts,
  SaaS, payments, analytics, native packaging), or introduce new global UX
  systems unless the request requires it.
- Keep patches reviewable, reversible, and tied to the request.
- Verify important changes before finalizing; explain skipped checks.

---

## Working Checklist

Before code:

1. Read `CONTINUITY.md`.
2. Confirm scope; ask only if ambiguity blocks safe progress.
3. Inspect the files you will touch.
4. Read the relevant engineering doc:
   - UI: `docs/engineering/ui-principles.md`
   - Server / AI provider: `docs/engineering/ai-server.md`
   - Tests: `docs/engineering/testing.md`
   - Git workflow: `docs/engineering/git-workflow.md`
5. For non-trivial work, name the verification plan.

While coding:

- Match local patterns and helpers before adding new ones.
- Prefer local improvements over architecture rewrites.
- Avoid formatting churn unrelated to the task.
- Do not build fake loading states or mock systems.
- Surface meaningful errors; do not hide failures behind silent fallbacks.

Before finishing:

- Run the relevant verification checklist.
- Update `CONTINUITY.md` only for meaningful state changes.
- Call out residual risks and skipped checks.
- For non-trivial tasks, start the final reply with a compact ledger snapshot:
  Goal, Now, Next, and Open Questions. Trivial Q&A may skip it.

Pause and ask before changing AI-provider defaults, resume-block schemas,
API-key loading or persistence, destructive git operations, workflow-critical
UI patterns, infrastructure/platform shape, paid/vendor dependencies, or
remote writes.

---

## Continuity

`CONTINUITY.md` is the canonical workspace memory for handoff. Keep entries
factual, compact, and verifiable.

Required behavior:

- Tag entries with `[USER]`, `[CODE]`, `[TOOL]`, or `[ASSUMPTION]`.
- Include an ISO timestamp on every entry.
- Use `UNCONFIRMED` instead of guessing.
- Capture active risks, durable decisions, current state, and next steps.

Bounds:

- Snapshot: max 25 lines.
- Done (recent): max 7 bullets.
- Working Set: max 12 paths.
- Receipts: keep only the last 10-20 entries.

If a section grows noisy, compress older entries into milestone bullets with a
commit, doc path, or log path pointer. Durable decisions use lightweight
ADR-style entries, for example:
`D001 ACTIVE: keep the app local-first and personal-use focused.`

---

## Task Routing

Use the relevant docs and repo surfaces by task shape:

- UI work: read `docs/engineering/ui-principles.md`; reuse `src/ui.tsx` and
  `src/styles/`; preserve the two-column job/resume to output/insights
  workflow; keep labels and hints short; verify major UI changes visually in
  Google Chrome when feasible.
- Server / AI work: read `docs/engineering/ai-server.md`; keep API keys
  server-side; keep `server.mjs` focused on local serving, job import, DOCX
  import/export, workspace storage, and AI provider calls.
- Resume engine work: keep scoring, keyword extraction, and deterministic
  fallback rewrite in `src/resumeEngine.ts` or similarly focused helpers.
- Testing work: read `docs/engineering/testing.md`; choose checks based on
  affected behavior and blast radius.
- Git/PR work: read `docs/engineering/git-workflow.md` before naming a branch,
  committing, pushing, or drafting PR copy.

Multiple agents may work in this repo. Route by task shape and verified tool
access, not model brand.

---

## Refactors And Modularity

Refactor only when the current task requires it, the existing structure blocks
correctness, or the change clearly reduces future complexity and can be safely
verified. No drive-by refactors during feature work.

Split growing workflows into components, hooks, services, and utilities when
that improves cohesion. Keep public interfaces stable and isolate volatile
logic behind small helpers.

File-size guidance:

- About 300 LOC for hand-written files is a soft target, not a rule.
- Above about 400 LOC, either justify cohesion or propose a focused split if
  the task already touches that file.
- `src/App.tsx` and `src/resumeEngine.ts` are already over the target; treat
  continued growth as a prompt to extract focused helpers when touching them.

---

## Safety And Data

- Treat resumes, job descriptions, API keys, and personal background as
  sensitive.
- Keep personal resumes, application trackers, exported drafts, rendered
  previews, and job-specific artifacts in ignored local storage, primarily
  `job-search-workspace/`.
- Remote API calls must be read-only unless the user explicitly requests a
  write; dry-run requested writes when possible.
- Never run commands that delete resume/workspace data or call destructive
  remote APIs without explicit instruction.
- Do not commit `.env`, `node_modules/`, `dist/`, exported resumes/TEX/PDF/DOCX
  files, root-level resume artifacts, or `job-search-workspace/` contents
  except its `README.md`.
- Keep generated resume claims grounded in user-provided facts.

For PDFs, uploaded resumes, long documents, or similar sources, read the full
source before drafting, then re-check the source before finalizing for factual
accuracy, invented details, and style constraints. Label paraphrases when the
user needs source-faithful handling.

---

## Accuracy And Current Info

When a request depends on "latest", "current", recent APIs, pricing, release
notes, model availability, or similar changing facts:

- Establish the current date/time when it matters.
- Prefer official sources: vendor docs, upstream repositories, changelogs, and
  release notes.
- Use documentation tools when available; pin the relevant library and version.
- Use web search when it materially improves correctness, preferring official
  docs over secondary explainers.

---

## Git Rules

Default to local-only work unless the user explicitly asks to stage, commit,
push, open a PR, or merge.

- Never overwrite unrelated changes.
- Never use destructive git operations without explicit instruction.
- Never rebase, amend, push, switch branches, or delete branches unless
  requested.
- Check `git status --short` before staging so unrelated work is visible.
- Stage only relevant files.
- Do not stage `.env`, `job-search-workspace/` contents except
  `job-search-workspace/README.md`, or exported resumes/TEX/PDF/DOCX files. The
  `.gitignore` already guards these; verify with `git status --short`.
- Stage and commit `AGENTS.md` and `CLAUDE.md` like any other tracked file when
  they're part of the change; do not single them out to exclude. `CONTINUITY.md`
  and `.claude/` are gitignored and won't appear as staging candidates.
- Use non-interactive git commands.

---

## Verification

Read `docs/engineering/testing.md` for full pass criteria.

- UI: no console errors, stable layout, two-column workflow preserved. Major
  changes: `npm run dev` plus Chrome visual QA when feasible. Minor changes:
  use judgment and note if visual QA was skipped.
- Server / AI: `node --check server.mjs` passes; affected routes return the
  expected status and JSON shape; deterministic fallback still runs when the AI
  call cannot.
- Build: `npm run build` succeeds when frontend source or types changed.
- Refactors: existing behavior preserved, `npm run build` succeeds, and search
  confirms old symbols are gone.
- Docs-only: verify referenced paths and links; runtime checks are not
  required.

---

## Commands

Run from the project root.

- Build: `npm run build`
- Dev: `npm run dev` (starts the API-backed local server on `PORT` or `5181`)
- Preview: `npm run preview`
- Server syntax check: `node --check server.mjs`

Port `5181` is canonical for this project (reserved range `5181-5183`). If
`5181` is already bound, treat that as a signal the app is already running and
connect to `http://localhost:5181` instead of starting a second dev server or
changing ports. Sibling reservations: careflow `5173-5180`, portfolio
`5184-5185`.

Use `.env` for provider keys and overrides:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
`OPENROUTER_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY`, `MISTRAL_API_KEY`,
`AI_API_KEY`, `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `OPENAI_MODEL`, and
`PORT`.

---

## Communication

- Think privately.
- Skip preambles unless they help.
- Report actions, blockers, verification, and final outputs.
- Do not print hidden reasoning.
- Use bracketed prompts for missing user facts, for example
  `[add metric: users, time saved, performance gain, or scope]`.

---

## Definition Of Done

A task is complete when the requested behavior works or the question is
answered, the diff is scoped, relevant checks ran or were explained, meaningful
continuity state is updated, and residual risks are clear.
