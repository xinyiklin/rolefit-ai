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
  multi-pass: targeted suggestion generation first, then the strict
  recruiter audit (when enabled) and the cover letter (when requested)
  run in parallel, so one model response is not forced to suggest edits,
  score, audit, and draft a letter at the same time. The suggestion pass
  returns only structured `suggestedChanges` (no full-text rewrite, no fit
  score — scoring belongs to the audit pass, with the local engine as
  fallback); the `polishedText` preview is derived server-side by applying
  the sanitized suggestions to the scoped text, so every tailored
  character has passed the exact-evidence gate before the audit, the
  cover letter, or the UI diff sees it. The polish request sends a structured
  `tailorScope` of user-selected editable sections instead of the full
  resume; identity, contact, education, and any omitted sections remain
  locked out of the rewrite prompt unless the user selects them. The audit
  pass receives the clipped original sections plus the SANITIZED proposed
  changes (`<proposed_changes>`, slim JSON) instead of a second full resume
  copy — the polished resume is derivable from them, and dropping the
  redundant copy cuts the audit prompt by up to ~28k chars; the cover pass
  uses a clipped copy of the tailored sections. The audit pass can
  optionally use an *independent reviewer* provider/model (request `audit*`
  fields, resolved by `resolveAuditProviderRequest`); when unset it reuses
  the primary config. The suggestion and cover-letter passes always use the
  primary provider — only the non-rewriting audit can differ, so a reviewer
  model can never alter the editor's resume output.
- DOCX import / export (text extraction, format-preserved updates)
- job posting import (`/api/import-job`): fetch a public posting URL —
  Workday CXS JSON when the host is recognized (`*.myworkdayjobs.com`,
  `/job/` and `/details/` links), LinkedIn visible job body + criteria
  rows when present, otherwise a generic HTML→text scrape — behind SSRF
  guards that re-validate the host and resolved IP on every redirect hop
  and reject private / loopback / link-local targets. Client-side
  distilling in `src/lib/jobExtract.ts` then splits the result into compact
  model-facing tailoring text and tracking-only facts (role summary,
  company, location, job type, work-auth note, compensation). The visible
  job-description field is a structured brief with Job Title,
  Company/Product Context, Core Responsibilities, Required Qualifications,
  Preferred Qualifications, Tech Stack/Keywords, Seniority Signals, and
  Domain Signals. The link itself is kept only for pipeline tracking and is
  never sent to the AI.
- workspace file storage under `job-search-workspace/` (auto-load,
  upload, save, reload)

Resume scoring, keyword extraction, and the deterministic fallback
rewrite live in `src/resumeEngine.ts` (or similarly focused helpers).
Keep that logic out of `server.mjs`.

When a workflow grows, split it into focused helpers (file readers,
provider clients, request handlers) rather than packing more code into
one large route.

The `/api/polish` flow follows that rule — it is split across focused
modules under `server/ai/` so no single file carries the whole pipeline:

- `polish.mjs` — the `handlePolish` route (request parsing, the
  suggest → parallel audit + cover orchestration, derived `polishedText`
  assembly) only.
- `providers.mjs` — provider identity + per-request config resolution
  (`normalizeProvider`, default provider/model, key/base-URL lookup,
  `resolveProviderRequest`, `resolveAuditProviderRequest`).
- `clients.mjs` — the outbound provider clients (OpenAI Responses,
  OpenAI-compatible chat, Anthropic Messages, Gemini) and the
  `callConfiguredProvider` dispatch.
- `prompts.mjs` — every system/user prompt and the shared
  honest-tailoring / anti-fabrication rule helpers (also imported by
  `applicationAnswers.mjs`). Untrusted text (job description, resume,
  honest context, custom instructions, pass-1 output) is interpolated
  through `fenceUntrusted`, which neutralizes literal fence-tag
  look-alikes so pasted content cannot escape its `<job_description>`-style
  delimiters; the input-firewall rule tells the model fenced content is
  data, never instructions.
- `sanitize.mjs` — fit-score, missing-skill, structured suggestion, and
  strict-review response validation (`sanitizeStrictReview`: enum
  fallbacks, string clips, array caps, markup rejection on rewrites).
  The markup gate allows exactly the editor's inline-mark vocabulary
  (`<b>`/`<i>`/`<u>`, no attributes) because formatted bullets carry those
  tokens in `currentText` and a faithful suggestion echoes them; all other
  tags, LaTeX commands, and newlines still reject. `sanitizeTailorSuggestions`
  takes an optional drop-stats collector and the route warns (shape-only)
  when a reply's suggestions are ALL dropped — a silent all-drop is
  otherwise indistinguishable from "no changes needed".
  `reconcileFitVerdict` enforces verdict/score agreement conservatively:
  scores (base AND tailored) clamp DOWN to a pessimistic verdict's band,
  optimistic verdicts downgrade to the score's band — neither signal is
  ever inflated. Hit-keyword grounding: a suggestion whose claimed JD
  keyword appears in `proposedText` but whose significant words exist
  nowhere in the scope text or honest context is dropped
  (`ungroundedKeyword`) — the model-prose evidence field cannot launder an
  inferred fact (e.g. "clinics run Windows") into the resume.
- `grounding.mjs` — `findUngroundedJdTerm`: the proposedText-level JD-term
  gate behind `ungroundedJdTerm` drops. Detector 1 catches capitalized
  tokens (incl. a non-verb first word); detector 2 catches a curated
  lowercase tech-concept lexicon (microservices, machine learning, ci/cd…)
  that deliberately mirrors the concept-class entries of
  `src/resume/keywords.ts` (the TS module can't be imported from Node due
  to its extensionless TS import chain). Matching is fuzzy (60% prefix) so
  honest inflections survive.
- `json.mjs` — `parseAiJson` (fenced / prose-wrapped / outermost-brace
  + trailing-comma repair). `errors.mjs` — `UserSafeAiError` and the
  config-error → 400 mapping.

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
absent that, the server defaults to the **Claude Code CLI** (`claude-cli`) — a
**zero per-token cost** subscription path — not a hosted API
(`getDefaultProvider()` in `server/ai/providers.mjs`). Setting `AI_PROVIDER`
(or picking a provider in the AI menu) overrides this; an *unknown*
`AI_PROVIDER` still coerces to OpenAI, and `AI_MODEL` / `OPENAI_MODEL` select
the OpenAI model (`gpt-5.5` default). The other subscription CLIs (Codex CLI,
Gemini CLI / Antigravity) are the same zero-cost path for their vendors. The
frontend already defaults to `claude-cli`, so this only affects the
headless / no-provider request path.

Per-provider rules:

- **Subscription CLIs** (Claude Code, Codex CLI, Gemini CLI / Antigravity)
  shell out to local subprocesses via `server/ai-cli/` using your existing
  subscription auth — no API key, no per-token cost.
- Use each provider's native API (Anthropic Messages, Gemini
  `generateContent`) where supported. The Anthropic Messages call sends
  **no `temperature`** and **no trailing assistant prefill**: both return
  a 400 on the current models this app offers (`temperature` is removed on
  Opus 4.7/4.8; a last-assistant-turn prefill is rejected on Sonnet 4.6 and
  Opus 4.6+). JSON is enforced by the "return strict JSON only" prompt plus
  `parseAiJson`, not by prefilling `{`.
- Use compatible `/chat/completions` endpoints for OpenRouter, Groq,
  Together AI, Mistral, and Local/custom.
- Accept one-request `apiKey`, `provider`, `apiBaseUrl`, and `model`
  values from the UI for ad-hoc use, but do not persist them. The optional
  reviewer override accepts the parallel `auditProvider`, `auditApiKey`,
  `auditApiBaseUrl`, `auditModel`, and `auditReasoningEffort` fields; the
  reviewer API key is likewise never persisted.
- Allow `.env` to set provider-specific keys (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`,
  `GROQ_API_KEY`, `TOGETHER_API_KEY`, `MISTRAL_API_KEY`, `AI_API_KEY`)
  and provider/model/base-URL overrides (`AI_PROVIDER`, `AI_BASE_URL`,
  `AI_MODEL`, `OPENAI_MODEL`).

The AI must:

- tailor only the provided `tailorScope` sections to the job description
- keep each role to no more than five bullets
- emphasize entry-level SDE / full-stack fit
- strengthen wording and structure
- return structured `suggestedChanges` that target existing section,
  entry, and bullet IDs, so the user can accept, edit, or discard changes
  in the resume editor
- preserve truthfulness — never invent employers, dates, metrics,
  education, tools, or outcomes
- never edit identity, contact, education, or omitted sections unless the
  user explicitly selects those sections in the editor
- treat honest context as optional evidence; when it is blank, rely only
  on the resume
- never import a JD-only skill/tool into the resume or skills section
  without exact evidence in the resume or optional honest context; surface
  missing required skills as gaps instead
- add bracketed placeholders where facts or metrics are missing
- return a concise `changeSummary` (what changed and why, or why nothing
  needed to); the selected-section text preview used for scoring/audit is
  derived server-side from the sanitized suggestions, and the editor
  remains the final source of truth
- score fit from evidence, not model-authored numbers: the strict reviewer
  returns `requirementCoverage` rows with base/tailored coverage status,
  importance, and evidence for each decision-relevant JD requirement. The
  SERVER maps those rows into fixed buckets (required tech 40 / domains 25 /
  seniority and hard filters 15 / preferred 10 / evidence clarity 10), caps
  for the reviewer's own reported gaps (HIGH gaps cap at 79 / 69 / 60 by
  count, BLOCKER gap → DON'T APPLY band), and derives the verdict from the
  total (`scoreFromRequirementCoverage` + `applyGapCapsAndVerdict` in
  `sanitize.mjs`) — the model extracts evidence, the server does the math, so
  verdict and score cannot disagree. Legacy `fitBuckets` and holistic
  `fitScore` replies remain compatibility fallbacks. The reviewer acts as a
  validator of the polish pass — unsupported inserted terms lower the
  tailored coverage, never raise it
- write bullets as engineering accomplishments in plain language — no
  brochure vocabulary, no claims the candidate could not defend in an
  interview, and proposed text stays close to the current field's length
  so the one-page layout survives
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
  résumé-tailoring content (role intro, seniority/employment metadata,
  responsibilities, requirements, preferred qualifications) in a compact
  structured prompt payload and remove scrape artifacts or non-tailoring page
  furniture: empty list markers, duplicate adjacent lines, ATS title
  furniture such as `Job Application for...`, low-value Workday metadata
  pairs, duplicated pre-description company/culture marketing blocks,
  apply/share/navigation rows, salary pills, benefits/perks blocks,
  pay-transparency text, application instructions, EEO/legal boilerplate,
  cookie prompts, and similar noise. Extract tracking-only facts separately
  instead of leaving compensation and boilerplate in the model-facing job
  description.

Distilling should stay conservative: do not cut trailing boilerplate until
meaningful role content has already been seen, and keep uncertain text
rather than risking removal of real requirements. If role title, company,
role summary, location, compensation, or the job description itself cannot
be extracted, surface manual review/input instead of guessing. Never log or
print raw job-description text during routine debugging.

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
  sources preserve LaTeX in place automatically. PDF-only sources must be
  pasted as extracted text.
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
- On startup, the server discovers root-level LaTeX base resumes named
  `base-resume.tex` or `base-resume-*.tex`, loads `base-resume.tex`
  first when present, then named variants. Legacy `base-resume.docx`,
  `.txt`, `.md`, and `.csv` files remain fallback-only for old local
  workspaces.

## Deployment And Infrastructure

- Current shape is local-only: no hosted backend, no database, no
  account system.
- Do not introduce infrastructure, platform changes, or paid / vendor
  dependencies without asking.
- Do not add Electron / Tauri / native desktop packaging unless the user
  explicitly requests it.
- Do not make remote API writes unless explicitly requested. Dry-run
  write-oriented remote commands first when possible.
