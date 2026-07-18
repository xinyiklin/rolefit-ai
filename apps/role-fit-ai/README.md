# RoleFit AI

A **local-first** resume tailoring webapp. Import a job posting (paste it, or pull it straight from the link), tailor your base resume from your workspace, score the draft against the job description, and export to PDF or save a re-loadable `.resume` file — without storing your personal data in a hosted app.

> Built for an entry-level SDE job hunt: tight workflow loop, blunt recruiter-style audit before applying, and a local pipeline tracker so you never lose track of a role.

![RoleFit AI resume workspace](docs/screenshot.png)

The on-disk **application tracker** — a sortable, paginated table with right-click quick actions, plus a calendar of submissions and follow-ups:

<table>
<tr>
<td width="50%"><img src="docs/applications-table.png" alt="Applications table with inspector"></td>
<td width="50%"><img src="docs/applications-menu.png" alt="Right-click row actions, including change stage"></td>
</tr>
<tr>
<td width="50%"><img src="docs/applications-calendar.png" alt="Calendar view with submissions and upcoming follow-ups"></td>
<td width="50%"><img src="docs/application-modal.png" alt="Application detail modal"></td>
</tr>
</table>

_Screenshots use demo workspace data and may trail minor UI refinements._

The engine-painted page is the editor and source of truth: type directly in the
export layout, use its margin controls to add, remove, reorder, or scope
sections, and send review cards back to the exact field. The editor is its own
preview — it and the PDF export use the same layout engine, and a `.resume` file
saves the structured resume data so you can reload it later or move it between tabs.

## Highlights

- **Resume input** — ingest a `.txt`, `.md`, or `.csv` resume (or paste text) into the typeset editor as a one-time conversion into the structured model, or load a previously saved `.resume` file directly; paste extracted PDF text when the original is only available as PDF.
- **Job-link import** — paste a posting URL and pull the description in one click: Workday-aware (reads its CXS JSON API for `/job/` and `/details/` links), with Greenhouse-wrapper resolution and a generic HTML→text fallback for other boards. The posting is distilled before polishing — **AI-first** via the configured provider, with server-side grounding/sanitization checks and a deterministic parser that can preserve a local brief for inspection when AI fails. A failed AI Distill remains failed and cannot auto-launch Tailor or Review. The compact brief keeps role context, responsibilities, requirements, preferred qualifications, and technical/domain signals while dropping ATS/navigation/marketing/legal furniture. The link itself is kept only for pipeline tracking and is **never sent to the model**.
- **Browser extension (Chrome/Firefox)** — on any job posting, click the toolbar icon to check whether you've **already tracked or applied** to that posting and **Import** it into a fresh RoleFit tab. The server prepares the raw page text, then that tab distills it with its own Distill provider before loading the Job field — with optional **Polish automatically** and **Distill with AI** toggles. Duplicate gates can stop before or after Distill; an AI failure also stops the selected pipeline. The extension does not estimate fit locally; score and verdict come from AI Review in the app. Manifest V3; the extension talks only to your local `http://localhost:5181` server. See [Browser extension](#browser-extension).
- **Subscription-friendly, verified provider set** — the default is the **Claude Code CLI** path, with other **account-backed CLI tools** (`Codex CLI`, `Antigravity CLI`) available when the installed CLI and signed-in account grant access. These paths avoid configuring a separate metered API key in RoleFit, but remain subject to each provider's plan and usage limits. The only direct API paths are **OpenAI** and **Claude (Anthropic)**. The AI menu keeps separate provider/model controls for Distill, Tailor, and Review in a one-section-at-a-time accordion, with copy controls when you want stages aligned. CLI sections show signed-in-session guidance instead of an irrelevant API-key field.
- **AI-owned fit review** — the selected Review model judges the complete requirement set and returns the coverage table, base/tailored scores, verdict, explanation, gaps, and recommendation. RoleFit validates the response contract but does not recalculate or replace that judgment locally.
- **Strict recruiter review mode** — audit the current edited draft as-is, or audit the sanitized proposal produced moments earlier in **Both**, for a verdict (STRONG FIT / REASONABLE FIT / STRETCH / DON'T APPLY), AI fit scores, gap severity, targeted bullet rewrites, interview risk flags, ready / edits-pending / missing-evidence status, and a cover-letter angle.
- **One typeset editing surface** — direct text editing, inline emphasis, undo/redo, keyboard caret movement, structural add/remove/reorder controls, per-section Tailor/Include/Off scope, and review-field highlighting all operate on the exported page layout.
- **Ordered AI workflow** — Distill, Tailor, and Review share one reusable progress surface with exact step counts, specific failure reasons, Retry/Stop behavior, and later stages marked not run after a failure.
- **WYSIWYG editor + PDF export** — the editor *is* the preview: it and the exported PDF use the same shared Typeset layout engine, so visible line breaks and page flow match the export exactly. No external toolchain to install — typesetting and PDF generation run in the browser.
- **`.resume` save/load** — download the structured resume data as a `.resume` file (lossless JSON, formatting preserved) and reload it later, or keep it as a portable backup of your work.
- **On-disk pipeline tracker** — a sortable, paginated applications table (right-click any row for quick actions: open details, change stage, in-app PDF preview of the saved resume, or delete) alongside a calendar view of submissions and upcoming follow-ups. Tracks status / source / company / role / follow-up date / notes / resume snapshot per application, and survives browser wipes.
- **Local-first personal workflow** — the app, server, extension bridge, and workspace files run on your own device; workspace files live in `job-search-workspace/`, and keys loaded from `.env` stay server-side. A key typed into the AI menu lives only in page memory for that session and is sent to the local API for the request; the local server uses it to authenticate the selected OpenAI or Claude API call, but does not save, log, or echo it. AI-backed import, polish, cover-letter, and application-answer features send the relevant job/resume text through the CLI or API provider you choose.

## Stack

React 19 · TypeScript · Vite · Node.js (`server.ts` with focused helpers under `server/`) · shared `@typeset/engine` / `@typeset/editor` workspaces · custom CSS · `lucide-react` icons

No hosted RoleFit backend, database, or account system. Supported provider integrations: Claude Code CLI · Codex CLI · Antigravity CLI · OpenAI API · Claude API.

## Run

From the repository root:

```bash
npm install
npm run dev:rolefit
```

Visit `http://localhost:5181`.

The server binds to loopback by default. `HOST=0.0.0.0` is an explicit,
unauthenticated LAN-exposure override; never use it on a public or untrusted
network.

## AI setup

Pick providers/models from the top-bar AI menu, or set keys in `.env`. The menu
is a compact accordion split by pipeline stage; at most one section is expanded,
while collapsed sections keep their effective provider/model summary visible:

- **Distill** — job-link, paste, and import distillation into a compact job brief.
- **Tailor** — evidence-grounded resume suggestions, cover letter, and application-answer drafting.
- **Review** — strict recruiter-style audit of the current edited draft.

Each stage has its own provider/model/effort settings; use **Copy from** in the
menu to sync one stage from another. CLI providers use the signed-in local
session, so their sections expose no API-key input. OpenAI/Claude API sections
may accept a one-session key: it stays in page memory, is sent only to the local
`/api/*` route to authenticate that selected call, and is never persisted,
logged, or echoed. Keys in `.env` stay server-side:

```bash
# pick one (or set multiple and switch in-app)
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

To avoid configuring a separate metered API key in RoleFit, use an account-backed CLI provider (the default is Claude Code CLI; override with `AI_PROVIDER` or the in-app AI menu). Availability and usage limits come from the installed CLI and signed-in provider account:

```bash
# requires a current Claude Code installation and an account with CLI access
claude auth login

# requires a current Codex CLI installation and an account with CLI access
codex login

# requires a current Antigravity CLI installation and Google account access
# first launch opens the supported sign-in flow
agy
```

The app shells out to these CLIs for AI-backed import, polish, cover-letter, and application-answer requests — no API key required. The app is still local-first and personal-use: you run the server on your own machine, and the CLI auth/session stays tied to that device. Antigravity 1.1.x requires its non-interactive prompt in the local process argument list; unlike the Claude and Codex wrappers, that path cannot keep resume/job text exclusively on stdin while the subprocess is running.

> **Provider support:** RoleFit intentionally exposes only the three subscription CLIs plus the native OpenAI Responses and Claude Messages APIs. Other adapters were removed until they have current contracts and live verification. CLI entitlements and API model access still depend on the signed-in account.

When **Distill with AI** is off, deterministic job extraction is an intentional
local-only success path. When AI Distill was requested but fails, RoleFit may
load the deterministic brief for inspection while leaving Distill failed and
blocking Tailor/Review. Tailor, Review, Cover Letter, and application-answer
generation fail plainly; no local draft, score, or verdict silently stands in.

## Browser extension

A lightweight Chrome/Firefox popup that brings RoleFit import and duplicate checking to the job board. On any posting, click the **RoleFit AI** toolbar icon to see:

- whether you've **already tracked or applied** to that posting (matched by ATS posting id, normalized URL, requisition id, or company/title/description overlap), and
- a one-click **Import to RoleFit AI** that opens a fresh independent RoleFit tab, lets the server prepare the raw page text, then has that tab distill it with its own Distill provider before loading the Job field. **Polish automatically after import** can run polish as soon as the brief and your base resume are ready, and **Distill with AI** can be turned off to use the deterministic parser for that import.

It is Manifest V3 and talks **only** to your local server at `http://localhost:5181`: the routes it calls accept extension-origin requests only (with a reflected, non-wildcard CORS origin), and the inbox the app reads is same-origin and CSRF-guarded. The server-side import step prepares the captured posting text (for example, resolving a fuller board description when possible); the receiving tab then runs the app's Distill stage with its selected CLI or native API provider, or skips that provider call when **Distill with AI** is off. Imports carry a short local claim token so the newly-opened tab receives its own posting, while other open tabs continue their current jobs; the app also shows a small read-only "other sessions" card when another tab is active. The extension never reads the base resume or produces a fit judgment.

Start the app first (`npm run dev:rolefit` from the repository root), then load
the unpacked extension from `apps/role-fit-ai/extension/`:

- **Chrome / Edge** — open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `extension/` folder.
- **Firefox** — open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and select `extension/manifest.json`.

## Workspace

The app creates `job-search-workspace/` for your private local data:

- `base-resume.resume` (or `.txt`, `.md`, `.csv`) — auto-loaded on startup
- `applications.json` — the pipeline tracker's on-disk store
- Anything else you drop in there

This folder is gitignored except its README. Personal resumes, `.resume`/PDF files, and root-level resume artifacts are also gitignored as a privacy guard.

## Project layout

```
server.ts                       # HTTP entry point: route dispatch + CSRF/Host guard
server/
  ai/                            # /api/polish + /api/distill: routes, providers,
                                 #   clients, prompts, sanitize, grounding, eligibilityLexicon,
                                 #   json, errors, coverLetter + applicationAnswers
  ai-cli/index.ts               # Claude Code / Codex / Antigravity CLI shell-out
  applications/                  # pipeline tracker storage (index) + HTTP routes
  base64.ts                     # base64 <-> Buffer helpers (base-resume / PDF artifact I/O)
  extension/                     # browser-extension API routes, duplicate status, inbox handoff
  http.ts                       # JSON/body/fetch utilities
  jobImport.ts                  # /api/import-job: ATS scrapers (Workday/Greenhouse/LinkedIn → text)
  network.ts                    # job-link fetch + SSRF guards
  starter.resume                # bundled starter resume seeded when the workspace has no base resume
  workspace.ts                  # base-resume workspace storage + .trash version history
src/
  App.tsx                        # state + handlers + composition
  config/aiOptions.ts            # provider/model/reasoning options
  hooks/                          # applications, workspace resume, apply flow, polish pipeline,
                                  #   job intake, per-tab autosave/presence, resume export/analysis, AI settings
  lib/                           # downloads, job extraction/distilling, AI text adapters + review-target mapping
  sections/                      # masthead, nav menus, tabs, workflow progress, saved-PDF preview, review rail
  sections/editor/               # RoleFit-only AI-scope + review-target overlay
  sections/tabs/                 # Resume / Materials / Applications / Analytics
  resume/                        # RoleFit analysis/types/keywords/rewrite/diff (no fit scoring)
  resumeEngine.ts                # compatibility barrel over focused RoleFit resume helpers
  typeset/__evals__/             # RoleFit integration + migration parity checks for the shared engine
  styles/                        # per-surface CSS + shared tokens
../../packages/engine/           # canonical resume model, strict `.resume` codec, layout, DOM/print, PDF, fonts
../../packages/editor/           # shared direct editor, history/style hooks, formatting toolbar, editor CSS
extension/                       # Chrome/Firefox MV3 popup (import + duplicate/applied status)
docs/engineering/                # RoleFit contributor notes (server/AI, UI, testing)
job-search-workspace/            # local-only; gitignored except README
```

## Monorepo and scripts

RoleFit consumes private workspace packages `@typeset/engine` and
`@typeset/editor`; the standalone Typeset app consumes the same packages.
Shared document behavior belongs in those packages, while job/AI/tracker
behavior stays in RoleFit. See the root
[architecture guide](../../docs/architecture.md).

Run from the repository root:

```bash
npm run dev:rolefit
npm run build:rolefit
npm run check --workspace apps/role-fit-ai
npm run preview --workspace apps/role-fit-ai
```

## License

[MIT](../../LICENSE) © Xinyi Lin
