# AI / Server Guidelines

Role-Fit AI's server is a single Node entry point (`server.mjs`) that
serves the Vite frontend in development, exposes a small set of local
API routes, and proxies AI provider calls so API keys stay off the
browser.

## Port

The canonical dev/preview port is `5181` (overridable via `PORT`;
reserved range `5181-5183`). If `5181` is already bound, the app is
almost certainly already running — reuse the existing instance instead
of starting a second process or switching ports. Sibling reservations:
careflow `5173-5180`, portfolio `5184-5185`; do not mix them up.

## Server Boundaries

`server.mjs` owns:

- local HTTP serving with Vite middleware in development
- `.env` loading and process environment hygiene
- `/api/polish` AI provider routing — subscription CLIs (Claude Code,
  Codex CLI, Gemini CLI / Antigravity) shelled out to local subprocesses,
  plus hosted APIs (OpenAI, Anthropic, Google, OpenRouter, Groq,
  Together AI, Mistral, OpenAI-compatible). The route is intentionally
  multi-pass: rewrite first, strict recruiter audit second when enabled,
  and cover letter third only when requested, so one model response is not
  forced to rewrite, score, audit, and draft a letter at the same time.
  Audit and cover-letter passes use clipped copies of very long documents
  to keep those follow-up prompts inside a predictable context budget.
- DOCX import / export (text extraction, format-preserved updates)
- job posting import (`/api/import-job`): fetch a public posting URL —
  Workday CXS JSON when the host is recognized (`*.myworkdayjobs.com`,
  `/job/` and `/details/` links), otherwise a generic HTML→text scrape —
  behind SSRF guards that re-validate the host and resolved IP on every
  redirect hop and reject private / loopback / link-local targets.
  Client-side distilling in `src/lib/jobExtract.ts` then removes page
  furniture before the text fills the job-description field. The link
  itself is kept only for pipeline tracking and is never sent to the AI.
- workspace file storage under `job-search-workspace/` (auto-load,
  upload, save, reload)

Resume scoring, keyword extraction, and the deterministic fallback
rewrite live in `src/resumeEngine.ts` (or similarly focused helpers).
Keep that logic out of `server.mjs`.

When a workflow grows, split it into focused helpers (file readers,
provider clients, request handlers) rather than packing more code into
one large route.

## API Design

- Keep API routes explicit and local-only. There is no auth layer
  because the server only runs on the user's machine.
- Reject unknown or unsupported fields rather than silently dropping
  them when accepting structured input.
- Return stable JSON response shapes for the frontend.
- Cap request payloads (current limit: `maxRequestBytes = 8_000_000`).
- Surface provider errors with safe, user-facing messages; never leak
  raw provider response bodies, stack traces, or internal paths to the
  browser.

## AI Provider Layer

The provider is chosen per request (top-bar AI menu) or via `AI_PROVIDER`;
absent that, the server falls back to the OpenAI Responses API with default
model `gpt-5.5` (`AI_MODEL` / `OPENAI_MODEL` override) — so the technical
default provider is OpenAI. For **zero per-token cost**, the recommended path
is the subscription CLIs (Claude Code, Codex CLI, Gemini CLI / Antigravity),
a preferred opt-in (set `AI_PROVIDER` or pick one in the AI menu) that uses
existing subscriptions instead of API billing.

Per-provider rules:

- **Subscription CLIs** (Claude Code, Codex CLI, Gemini CLI / Antigravity)
  shell out to local subprocesses via `server/ai-cli/` using your existing
  subscription auth — no API key, no per-token cost.
- Use each provider's native API (Anthropic Messages, Gemini
  `generateContent`) where supported.
- Use compatible `/chat/completions` endpoints for OpenRouter, Groq,
  Together AI, Mistral, and Local/custom.
- Accept one-request `apiKey`, `provider`, `apiBaseUrl`, and `model`
  values from the UI for ad-hoc use, but do not persist them.
- Allow `.env` to set provider-specific keys (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`,
  `GROQ_API_KEY`, `TOGETHER_API_KEY`, `MISTRAL_API_KEY`, `AI_API_KEY`)
  and provider/model/base-URL overrides (`AI_PROVIDER`, `AI_BASE_URL`,
  `AI_MODEL`, `OPENAI_MODEL`).

The AI must:

- tailor the resume to the provided job description
- keep each role to no more than five bullets
- emphasize entry-level SDE / full-stack fit
- strengthen wording and structure
- preserve truthfulness — never invent employers, dates, metrics,
  education, tools, or outcomes
- treat honest context as optional evidence; when it is blank, rely only
  on the resume
- never import a JD-only skill/tool into the resume or skills section
  without exact evidence in the resume or optional honest context; surface
  missing required skills as gaps instead
- add bracketed placeholders where facts or metrics are missing
- return copy-ready resume text plus concise strengths and fixes
- keep strict review as an audit of the original resume plus polished
  resume, not as a second full rewrite

The deterministic local rewrite in `src/resumeEngine.ts` must remain
the fallback when the AI call cannot run.

## Job Posting Import

Keep the import pipeline split by responsibility:

- `server/network.mjs` fetches the page safely, handles Workday CXS JSON
  when available, falls back to HTML→text extraction, enforces timeouts,
  and applies SSRF checks on the original URL and every redirect hop.
- `src/lib/jobExtract.ts` is the dependency-free distiller. It should keep
  résumé-tailoring content (role intro, responsibilities, requirements,
  preferred qualifications) and remove scrape artifacts or non-tailoring
  page furniture: empty list markers, duplicate adjacent lines, ATS title
  furniture such as `Job Application for...`, low-value Workday metadata
  pairs, duplicated pre-description company/culture marketing blocks,
  apply/share/navigation rows, salary pills, benefits/perks blocks,
  pay-transparency text, application instructions, EEO/legal boilerplate,
  cookie prompts, and similar noise.

Distilling should stay conservative: do not cut trailing boilerplate until
meaningful role content has already been seen, and keep uncertain text
rather than risking removal of real requirements. Never log or print raw
job-description text during routine debugging.

## Resume-Job Keyword Review

When the user asks to compare a resume against a job description, the
review should be organized around:

- required job or work experience
- job knowledge areas
- required skills
- technical skills

In the response:

- identify which relevant keywords are already covered by the resume
- identify which relevant keywords are missing, weak, or unconfirmed
- reduce emphasis on generic transferable skills unless they tie
  clearly to the target role
- do not invent coverage, experience, employers, dates, metrics, tools,
  or domain knowledge that is not present in the resume
- ask for the missing job description or resume text when either input
  is empty

## Validation And Error Handling

- Validate request data before calling a provider.
- Do not add default fallbacks that hide missing required values — an
  empty `apiKey` should fail loudly, not silently call a different
  provider or return canned text.
- Do not leave empty `catch` blocks. Surface provider errors with
  user-safe wording while logging enough context locally to debug.
- Avoid leaking secrets, tokens, raw provider responses, or full
  resume / job-description text in error messages.

## Logging

- Do not log raw resume text, job descriptions, or AI prompts by
  default.
- Local debug logs that include sensitive text require explicit user
  approval and should be temporary.
- Never log API keys.

## Document Workflow

- DOCX is the format-preserving path for uploaded Word resumes; `.tex`
  sources preserve LaTeX in place when Preserve format is enabled. PDF-only
  sources must be pasted as extracted text.
- The clean PDF path is local HTML print: `src/lib/resumeDocument.ts`
  parses the tailored text, `src/sections/ResumeDocument.tsx` renders the
  document, and `src/sections/ResumePrintLayer.tsx` exposes that same HTML
  to `window.print()` / browser Save as PDF. The output stays selectable,
  ATS-readable text, but pixel-faithful formatting should use LaTeX export.
- Treat uploaded DOCX bytes as transient — extract text, perform the
  edit, and write back without persisting unrelated copies.
- Keep `job-search-workspace/` the canonical location for personal
  resumes, application trackers, exported drafts, and job-specific
  files. The folder is gitignored except for its `README.md`.
- On startup, the server auto-loads `base-resume.docx` first when it
  exists, then text fallbacks (`base-resume.tex`, `base-resume.txt`,
  `base-resume.md`, `base-resume.csv`). Preserve that order.

## Deployment And Infrastructure

- Current shape is local-only: no hosted backend, no database, no
  account system.
- Do not introduce infrastructure, platform changes, or paid / vendor
  dependencies without asking.
- Do not add Electron / Tauri / native desktop packaging unless the user
  explicitly requests it.
- Do not make remote API writes unless explicitly requested. Dry-run
  write-oriented remote commands first when possible.
