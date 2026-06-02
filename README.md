# RoleFit AI

A **local-first** resume tailoring webapp. Import a job posting (paste it, or pull it straight from the link), tailor your base resume from your workspace, score the draft against the job description, and export to LaTeX / DOCX / PDF — without storing your personal data in a hosted app.

> Built for an entry-level SDE job hunt: tight workflow loop, blunt recruiter-style audit before applying, and a local pipeline tracker so you never lose track of a role.

![RoleFit AI pipeline workspace with demo data](docs/screenshot.png)

_Screenshot uses demo workspace data._

## Highlights

- **Multi-format resume I/O** — ingest `.docx`, `.pdf`, `.tex` (Jake's-style), or plain text; export back to each.
- **Job-link import** — paste a posting URL and pull the description in one click: Workday-aware (reads its CXS JSON API for `/job/` and `/details/` links), with a generic HTML→text fallback for other boards. The client distills the scrape before polishing, keeping role intro / responsibilities / requirements / preferred qualifications while dropping empty bullets, duplicated ATS title furniture, low-value Workday metadata, apply/share/navigation rows, company/culture marketing, salary pills, benefits/perks, pay-transparency, and EEO/legal boilerplate. The link itself is kept only for pipeline tracking and is **never sent to the model**.
- **Subscription-first, multi-provider AI** — runs on **subscription-CLI tools** (`Claude Code`, `Codex CLI`, `Gemini CLI` / Antigravity) that route through existing Claude Max / ChatGPT Plus / Google subscriptions instead of per-token billing, with **hosted-API backends** (OpenAI, Anthropic, Gemini, OpenRouter, Groq, Together, Mistral, local Ollama) available behind the same interface.
- **Fit scoring + 4-category keyword gap analysis** — required experience, knowledge, required skills, technical tools.
- **Strict recruiter review mode** — verdict (STRONG FIT / REASONABLE FIT / STRETCH / DON'T APPLY), gap severity, targeted bullet rewrites, interview risk flags, cover-letter angle.
- **LaTeX export pipeline** with three resume templates (Jake's, Awesome-CV, Deedy) + **one-click Overleaf submission** via form POST + optional local PDF compile through **Tectonic**.
- **DOCX format preservation** through direct OpenXML paragraph edits.
- **Clean ATS PDF export** — a dependency-free PDF generated locally with real Helvetica metrics and WinAnsi encoding, so accented names (e.g. "José Müller") render and the text stays selectable for ATS parsing.
- **On-disk pipeline tracker** with status / source / company / role / follow-up date / notes / resume snapshot per application — survives browser wipes.
- **Local-first storage** — workspace files live in `job-search-workspace/`; API keys stay server-side in `.env`. Cloud AI providers receive resume/job text only when you choose them for a polish request.

## Stack

React 19 · TypeScript · Vite · Node.js (`server.mjs` with focused helpers under `server/`) · custom CSS · `lucide-react` icons

No SaaS dependencies. Optional integrations: OpenAI · Anthropic · Gemini · OpenRouter · Groq · Together · Mistral · local Ollama · Claude Code CLI · Codex CLI · Gemini CLI (Antigravity) · Tectonic · Overleaf.

## Run

```bash
npm install
npm run dev
```

Visit `http://localhost:5181`.

## AI setup

Pick a provider/model from the top-bar AI menu, or set a key in `.env`:

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

For **zero per-token cost**, use the subscription-CLI providers (default):

```bash
# requires Claude Max
brew install claude-code   # or via the official installer
claude auth login

# requires ChatGPT Plus / Codex Plus
brew install codex
codex login

# requires Google Gemini access (or drive it via Antigravity)
# install Google's Gemini CLI, then sign in
gemini   # run once to sign in
```

The app shells out to these CLIs for polish requests — no API key required. For fully local inference, point the Local/custom provider at a local OpenAI-compatible server such as Ollama.

## Optional local LaTeX

```bash
brew install tectonic
```

When installed, the `PDF · LaTeX` button in the export rail compiles your polished `.tex` directly to PDF in-app. Without it, use the **Overleaf** button instead — one click sends the `.tex` to a new Overleaf tab for compile.

## Workspace

The app creates `job-search-workspace/` for your private local data:

- `base-resume.docx` (or `.tex`, `.txt`, `.md`, `.csv`) — auto-loaded on startup
- `applications.json` — the pipeline tracker's on-disk store
- Anything else you drop in there

This folder is gitignored except its README. Personal resumes, PDFs, and DOCX files at the repo root are also gitignored as a privacy guard.

## Project layout

```
server.mjs                       # main HTTP server
server/
  ai/polish.mjs                  # provider routing + prompt assembly
  ai-cli/index.mjs               # Claude Code / Codex / Gemini CLI (Antigravity) shell-out
  applications/index.mjs         # pipeline tracker storage
  docx.mjs                       # DOCX import/export helpers
  http.mjs                       # JSON/body/fetch utilities
  latex/                         # parser + 3 template renderers + optional Tectonic compile
  network.mjs                    # job-link fetch + SSRF guards
src/
  App.tsx                        # state + handlers + composition
  config/aiOptions.ts            # provider/model/reasoning options
  hooks/{useApplications, useTemplates}.ts
  lib/                           # downloads, job extraction/distilling, resume format/block helpers
  sections/                      # Masthead / SourcesPane / StudioPane / ExportRail
  sections/tabs/                 # Resume / Review / StrictReview / CoverLetter / Pipeline
  resumeEngine.ts                # scoring + analysis + deterministic local fallback
  pdfResume.ts                   # clean ATS PDF (real Helvetica metrics + WinAnsi)
  styles/                        # per-surface CSS + shared tokens
docs/engineering/                # contributor notes (server, UI, git workflow, testing)
job-search-workspace/            # local-only; gitignored except README
```

## Scripts

```bash
npm run dev        # start API + Vite middleware on :5181
npm run build      # tsc + vite production build
npm run preview    # serve the production build locally
```

## License

[MIT](LICENSE) © Xinyi Lin
