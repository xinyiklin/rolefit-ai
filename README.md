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
- **Job-link import** — paste a posting URL and pull the description in one click: Workday-aware (reads its CXS JSON API for `/job/` and `/details/` links), with a generic HTML→text fallback for other boards. The posting is distilled before polishing — **AI-first** via the configured provider, with server-side grounding/sanitization checks and the deterministic engine as an offline fallback — keeping role intro / responsibilities / requirements / preferred qualifications while dropping empty bullets, duplicated ATS title furniture, low-value Workday metadata, apply/share/navigation rows, company/culture marketing, salary pills, benefits/perks, pay-transparency, and EEO/legal boilerplate. The link itself is kept only for pipeline tracking and is **never sent to the model**.
- **Browser extension (Chrome/Firefox)** — on any job posting, click the toolbar icon for an instant **local fit score** (a keyword-overlap estimate against your base resume), **matched vs missing** keywords, a check on whether you've **already tracked or applied** to that posting, and a one-click **Import** that opens a fresh RoleFit tab, lets the server prepare the raw page text, then has that tab distill it with its own Distill provider before loading the Job field — with optional **Polish automatically** and **Distill with AI** toggles. Manifest V3; the extension talks only to your local `http://localhost:5181` server, while AI-backed import/polish still uses whichever local CLI, hosted API, or local model you configure. See [Browser extension](#browser-extension).
- **Subscription-friendly, multi-provider AI** — the default is the **Claude Code CLI** path, with other **account-backed CLI tools** (`Codex CLI`, `Antigravity CLI`) available when the installed CLI and signed-in account grant access. These paths avoid configuring a separate metered API key in RoleFit, but remain subject to each provider's plan and usage limits. **Hosted-API backends** (OpenAI, Anthropic, Gemini, OpenRouter, Groq, Together, Mistral, local Ollama) remain available behind the same interface. The AI menu keeps separate provider/model controls for Distill, Tailor, and Review, with copy buttons when you want all stages aligned.
- **Fit scoring + 4-category keyword gap analysis** — required experience, knowledge, required skills, technical tools.
- **Strict recruiter review mode** — audit the current edited draft as-is, or audit the sanitized proposal produced moments earlier in **Both**, for a verdict (STRONG FIT / REASONABLE FIT / STRETCH / DON'T APPLY), grounded fit scores, gap severity, targeted bullet rewrites, interview risk flags, ready / edits-pending / missing-evidence status, and a cover-letter angle.
- **One typeset editing surface** — direct text editing, inline emphasis, undo/redo, keyboard caret movement, structural add/remove/reorder controls, per-section Tailor/Include/Off scope, and review-field highlighting all operate on the exported page layout.
- **WYSIWYG editor + PDF export** — the editor *is* the preview: it and the exported PDF use the same owned layout engine, so visible line breaks and page flow match the export exactly. No external toolchain to install — typesetting and PDF generation run in the browser.
- **`.resume` save/load** — download the structured resume data as a `.resume` file (lossless JSON, formatting preserved) and reload it later, or keep it as a portable backup of your work.
- **On-disk pipeline tracker** — a sortable, paginated applications table (right-click any row for quick actions: open details, change stage, in-app PDF preview of the saved resume, or delete) alongside a calendar view of submissions and upcoming follow-ups. Tracks status / source / company / role / follow-up date / notes / resume snapshot per application, and survives browser wipes.
- **Local-first personal workflow** — the app, server, extension bridge, and workspace files run on your own device; workspace files live in `job-search-workspace/`, and keys loaded from `.env` stay server-side. A key typed into the AI menu lives only in page memory for that session and is sent to the local API for the request; the local server uses it to authenticate the selected hosted/custom provider endpoint, but does not save, log, or echo it. AI-backed import, polish, cover-letter, and application-answer features send the relevant job/resume text through the provider or CLI you choose; use a local model for fully local inference.

## Stack

React 19 · TypeScript · Vite · Node.js (`server.ts` with focused helpers under `server/`) · custom CSS · `lucide-react` icons

No hosted RoleFit backend, database, or account system. Optional provider integrations: OpenAI · Anthropic · Gemini · OpenRouter · Groq · Together · Mistral · local Ollama · Claude Code CLI · Codex CLI · Antigravity CLI.

## Run

```bash
npm install
npm run dev
```

Visit `http://localhost:5181`.

The server binds to loopback by default. `HOST=0.0.0.0` is an explicit,
unauthenticated LAN-exposure override; never use it on a public or untrusted
network.

## AI setup

Pick providers/models from the top-bar AI menu, or set keys in `.env`. The menu is split by pipeline stage:

- **Distill** — job-link, paste, and import distillation into a compact job brief.
- **Tailor** — evidence-grounded resume suggestions, cover letter, and application-answer drafting.
- **Review** — strict recruiter-style audit of the current edited draft.

Each stage has its own provider/model/effort settings; use **Copy from** in the menu to sync one stage from another. Keys in `.env` stay server-side. API keys typed into the menu are one-session, page-memory values sent to the local `/api/*` route, which uses them only to authenticate the selected hosted/custom provider endpoint; they are never persisted, logged, or echoed in a response:

```bash
# pick one (or set multiple and switch in-app)
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
TOGETHER_API_KEY=...
MISTRAL_API_KEY=...
```

To avoid configuring a separate metered API key in RoleFit, use an account-backed CLI provider (the default is Claude Code CLI; override with `AI_PROVIDER` or the in-app AI menu). Availability and usage limits come from the installed CLI and signed-in provider account:

```bash
# requires a Claude Code installation and an account with CLI access
brew install claude-code   # or via the official installer
claude auth login

# requires a Codex CLI installation and an account with CLI access
brew install codex
codex login

# requires an Antigravity CLI installation and an account with CLI access
# install the Antigravity CLI (`agy`), then sign in
agy auth login
```

The app shells out to these CLIs for AI-backed import, polish, cover-letter, and application-answer requests — no API key required. The app is still local-first and personal-use: you run the server on your own machine, and the CLI auth/session stays tied to that device. For fully local inference, point the Local/custom provider at a local OpenAI-compatible server such as Ollama.

> **Provider verification:** Claude Code, Codex, and Antigravity (`agy`) CLIs plus the OpenAI hosted API have previously been exercised end-to-end. CLI entitlements, model names, and provider behavior change; re-verify the installed versions before relying on that result. The remaining hosted-API routes (Anthropic, Gemini, OpenRouter, Groq, Together, Mistral, and local Ollama) share the same request path but remain best-effort until exercised locally.

The only local fallbacks are deterministic job distillation and the local fit
estimate. Tailor, Review, Cover Letter, and application-answer generation fail
plainly when their configured AI call cannot run; no local draft silently
stands in.

## Browser extension

A lightweight Chrome/Firefox popup that brings the fit check to the job board. On any posting, click the **RoleFit AI** toolbar icon to see:

- an **estimated fit score** — a local keyword-overlap estimate against your base resume (the real AI verdict still comes from polishing in the app),
- the **matched vs missing** keywords for that role,
- whether you've **already tracked or applied** to that posting (matched by ATS posting id, normalized URL, requisition id, or company/title/description overlap), and
- a one-click **Import to RoleFit AI** that opens a fresh independent RoleFit tab, lets the server prepare the raw page text, then has that tab distill it with its own Distill provider before loading the Job field. **Polish automatically after import** can run polish as soon as the brief and your base resume are ready, and **Distill with AI** can be turned off to use the deterministic parser for that import.

It is Manifest V3 and talks **only** to your local server at `http://localhost:5181`: the routes it calls accept extension-origin requests only (with a reflected, non-wildcard CORS origin), and the inbox the app reads is same-origin and CSRF-guarded. The server-side import step prepares the captured posting text (for example, resolving a fuller board description when possible); the receiving tab then runs the app's Distill stage with its selected CLI/API/local provider, or skips that provider call when **Distill with AI** is off. Imports carry a short local claim token so the newly-opened tab receives its own posting, while other open tabs continue their current jobs; the app also shows a small read-only "other sessions" card when another tab is active. The quick score reports only overlap of known tech keywords; it never invents resume content.

Start the app first (`npm run dev`), then load the unpacked extension:

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
  ai/                            # /api/polish + /api/distill: polish/distill (routes) + providers,
                                 #   clients, prompts, sanitize, scoring, grounding, eligibilityLexicon,
                                 #   json, errors, coverLetter + applicationAnswers
  ai-cli/index.ts               # Claude Code / Codex / Antigravity CLI shell-out
  applications/                  # pipeline tracker storage (index) + HTTP routes
  base64.ts                     # base64 <-> Buffer helpers (base-resume / PDF artifact I/O)
  extension/                     # browser-extension API routes + quick fit score / applied-status helpers
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
  lib/                           # downloads, job extraction/distilling, resume data + `.resume` file helpers
  sections/                      # Masthead + nav menus / StudioPane / editor / PreviewOverlay / ExportRail / post-polish ReviewRail
  sections/editor/               # owned typeset editor + controlled editing math
  sections/tabs/                 # Resume / Materials / Applications / Analytics
  resume/                        # resume engine split: types, text, keywords, scoring, rewrite, diff
  resumeEngine.ts                # barrel re-exporting src/resume/* (scoring/analysis/normalization)
  typeset/                       # canonical layout engine + DOM editor/preview renderer + PDF emitter
  styles/                        # per-surface CSS + shared tokens
extension/                       # Chrome/Firefox MV3 popup (one-click import, fit score, applied status)
docs/engineering/                # contributor notes (server, UI, git workflow, testing)
job-search-workspace/            # local-only; gitignored except README
```

## Scripts

```bash
npm run dev        # start API + Vite middleware on :5181
npm run build      # tsc (app + server configs) + vite production build
npm run preview    # serve the production build locally
```

## License

[MIT](LICENSE) © Xinyi Lin
