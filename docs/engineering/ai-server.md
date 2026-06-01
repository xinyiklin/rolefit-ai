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
- `/api/polish` AI provider routing (OpenAI, Anthropic, Google,
  OpenRouter, Groq, Together AI, Mistral, OpenAI-compatible)
- DOCX import / export (text extraction, format-preserved updates)
- job posting import (`/api/import-job`): fetch a public posting URL —
  Workday CXS JSON when the host is recognized (`*.myworkdayjobs.com`,
  `/job/` and `/details/` links), otherwise a generic HTML→text scrape —
  behind SSRF guards that re-validate the host and resolved IP on every
  redirect hop and reject private / loopback / link-local targets. The
  imported text fills the job-description field; the link itself is kept
  only for pipeline tracking and is never sent to the AI.
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

Default provider is OpenAI Responses API. The default model is
`gpt-5.5`; allow `AI_MODEL` or `OPENAI_MODEL` to override.

Per-provider rules:

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
- add bracketed placeholders where facts or metrics are missing
- return copy-ready resume text plus concise strengths and fixes

The deterministic local rewrite in `src/resumeEngine.ts` must remain
the fallback when the AI call cannot run.

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

- DOCX is the format-preserving path; PDF and text-only paths are
  text-only or clean-template exports. The clean-template PDF
  (`src/pdfResume.ts`) is generated locally with real Helvetica AFM
  metrics and `WinAnsiEncoding`, so accented characters render and the
  text stays selectable/parseable; it writes single-byte (Latin-1) output
  so the cross-reference offsets stay valid.
- Treat uploaded DOCX bytes as transient — extract text, perform the
  edit, and write back without persisting unrelated copies.
- Keep `job-search-workspace/` the canonical location for personal
  resumes, application trackers, exported drafts, and job-specific
  files. The folder is gitignored except for its `README.md`.
- On startup, the server auto-loads `base-resume.docx` first when it
  exists, then text fallbacks (`base-resume.txt`, `base-resume.md`,
  `base-resume.csv`). Preserve that order.

## Deployment And Infrastructure

- Current shape is local-only: no hosted backend, no database, no
  account system.
- Do not introduce infrastructure, platform changes, or paid / vendor
  dependencies without asking.
- Do not add Electron / Tauri / native desktop packaging unless the user
  explicitly requests it.
- Do not make remote API writes unless explicitly requested. Dry-run
  write-oriented remote commands first when possible.
