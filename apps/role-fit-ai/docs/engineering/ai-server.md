# AI / Server Guidelines

Role-Fit AI's server is a single Node entry point (`server.ts`) that
serves the Vite frontend in development, exposes a small set of local
API routes, and owns all outbound AI provider calls. Keys loaded from
`.env` never leave the server. A key entered in the AI menu is a transient
page-memory value sent to a same-origin local `/api/*` route for that request;
the local server uses it only as authentication for the selected hosted or
custom provider endpoint. It must never be persisted, logged, or echoed.

## Port

The canonical dev/preview port is `5181` (overridable via `PORT`;
reserved range `5181-5183`). If `5181` is already bound, the app is
almost certainly already running — reuse the existing instance instead
of starting a second process or switching ports. Sibling reservations:
careflow `5173-5180`, portfolio `5184-5185`; do not mix them up.

## Server Boundaries

The server layer (`server.ts` routing to focused `server/` modules) owns:

- local HTTP serving with Vite middleware in development
- `.env` loading and process environment hygiene
- `/api/polish` AI provider routing — subscription CLIs (Claude Code,
  Codex CLI, Antigravity CLI) shelled out to local subprocesses,
  plus hosted APIs (OpenAI, Anthropic, Google, OpenRouter, Groq,
  Together AI, Mistral, OpenAI-compatible). The route supports independent
  `tailor` and `review` requests plus a backward-compatible/headless `both`
  request. The current UI implements Both as two sequential requests: Tailor
  first (`stages: "tailor"`, with the optional cover pass), then Review
  (`stages: "review"`) with only the sanitized suggestions from that same run.
  A headless `stages: "both"` request instead runs targeted suggestions first,
  then runs its strict audit and optional cover pass in parallel. No single
  model response is forced to suggest edits, score, audit, and draft a letter
  at the same time. Review-only skips the suggestion pass and audits the
  current edited draft exactly as submitted; it must not regenerate or replay
  stale tailoring changes. The suggestion pass
  returns only structured `suggestedChanges` (no full-text rewrite, no fit
  score — evidence-based scoring belongs to the audit pass; when no usable AI
  score exists, the client may still display its separate local fit estimate,
  but the Review stage itself fails rather than receiving a local substitute);
  the `polishedText` preview is derived server-side by applying only sanitized
  suggestions to the scoped text. Every applied suggestion has passed the
  current deterministic grounding and sanitization gates before the audit,
  cover letter, or UI diff sees it. Those gates reduce fabrication risk; they
  are not proof of truth, and human review remains required. The polish request
  sends a structured `tailorScope` of user-selected editable sections instead
  of the full resume; identity, contact, education, and any omitted sections remain
  locked out of the rewrite prompt unless the user selects them. In a combined
  run, the audit pass receives the clipped original sections plus the SANITIZED
  proposed changes (`<proposed_changes>`, slim JSON) instead of a second full
  resume copy — the polished resume is derivable from them, and dropping the
  redundant copy cuts the audit prompt by up to ~28k chars. Review-only instead
  receives the current edited draft as its audit target. The cover pass uses a
  clipped copy of the tailored sections. The Tailor stage supplies the
  primary provider for suggestion generation, cover letters, and application
  answers. The Review stage can use its own provider/model (request `audit*`
  fields, resolved by `resolveAuditProviderRequest`); when audit fields are
  absent the server reuses the primary config. Only the non-rewriting audit
  can differ inside `/api/polish`, so a reviewer model can never alter the
  editor's resume output. A `/api/polish` response that ran Tailor echoes the
  resolved `provider` / `model` / `reasoningEffort` plus `attempts`
  (tailor-pass dispatch count); Review-only intentionally omits `attempts`
  because it made no Tailor dispatch. Whenever the review pass ran (stages
  `review` / `both`, i.e.
  `strictReview`), the response ALWAYS carries `auditProvider` / `auditModel` /
  `auditReasoningEffort` (the resolved audit values, even when identical to the
  primary) plus `auditAttempts` — so "review ran with the same provider" is
  distinguishable from "no review". The response also reports
  `coverStatus: "off" | "ok" | "failed"`; clients must not infer cover state
  from a missing letter, and a cover failure must not discard successful
  tailor/review results. The client surfaces "reviewed by" when either the
  audit provider or audit model differs from the Tailor configuration.
  `/api/cover-letter` and
  `/api/application-answers` likewise echo the resolved `provider` / `model` /
  `reasoningEffort`.
- resume import into the structured editor: a `.txt` / `.md` / `.csv` (or pasted)
  resume is parsed once into `ResumeData`, the source of truth thereafter (no DOCX
  or LaTeX import — the original is converted a single time into the editor
  format); a previously saved `.resume` file loads its `ResumeData` directly
- job posting import (`/api/import-job`, `server/jobImport.ts`): fetch a public posting URL —
  Workday CXS JSON when the host is recognized (`*.myworkdayjobs.com`,
  `/job/` and `/details/` links), LinkedIn visible job body + criteria
  rows when present, otherwise a generic HTML→text scrape — behind SSRF
  guards that re-validate the host and resolved IP on every redirect hop
  and reject private / loopback / link-local targets. Distilling is
  AI-first (`/api/distill`, below) with the deterministic
  `src/lib/jobExtract.ts` engine as the fallback; it then splits the result
  into compact model-facing tailoring text and tracking-only facts (role summary,
  company, location, job type, work-auth note, compensation). The visible
  job-description field is a structured brief with Job Title,
  Company/Product Context, Core Responsibilities, Required Qualifications,
  Preferred Qualifications, Tech Stack/Keywords, Seniority Signals, and
  Domain Signals. The link itself is kept only for pipeline tracking and is
  never sent to the AI.
- AI job distiller (`/api/distill`, `server/ai/distill.ts`): sends the
  raw (tag-stripped) posting text to the Distill-stage provider and returns
  the SAME structured fields the deterministic engine emits, resolved
  semantically so novel ATS layouts, inline-prose duties, and unusual
  headings parse where the regex heading tables can't. Server-side grounding
  checks supplement the prompt: scalar facts (including title, company,
  location, salary, `roleDescription`, `jobType`, and tech) and content-list
  items (responsibilities, required/preferred qualifications) are checked
  against the source and dropped when the current deterministic matchers cannot
  ground them. This reduces unsupported output but does not replace human
  review. The source URL is never sent to the model
  (it can carry private ATS tokens, so only the posting text is forwarded).
  The client (`src/lib/aiDistill.ts`) is AI-first with the deterministic
  `jobExtract.ts` engine as the offline/no-key fallback on any non-200,
  timeout, or unusable reply — so distillation always produces a brief. The
  route sits behind the localhost CSRF/Host guard. `.env` keys stay server-side;
  a menu-entered key reaches the route only in that transient request and is
  never returned. The
  success response echoes the RESOLVED `provider` / `model` / `reasoningEffort`
  (never `apiKey` / `apiBaseUrl`) plus `attempts` (dispatch count, ≥1) so the
  client can record which model produced the brief.
- browser-extension API (`/api/extension/*`, helpers in
  `server/extension/index.ts`): `analyze` (POST) returns a local
  keyword-overlap fit estimate of the workspace base resume against the
  posted page text, plus a LAYERED duplicate lookup of any matching tracked
  application (`findMatchingApplication` now delegates to the shared
  `findDuplicateApplications` in `src/lib/jobIdentity.ts`: ATS posting id /
  normalized URL / requisition id in the posted text / company + title +
  description overlap — the posted `text` is passed as jobText so a duplicate
  is caught even when the URL differs across boards). The response keeps the
  existing `previousApp` shape (built from the best match) and adds
  `match: { level, confidence, evidence }` (evidence capped at 3 strings), or
  `previousApp`/`match` null when nothing matches; `import` (POST) stores the
  page text and returns immediately, then a BACKGROUND server pass only
  RESOLVES the raw job text (e.g. fetching the full Greenhouse posting body) —
  it makes no AI call, because the server cannot read the receiving tab's
  provider settings. The background pass survives the popup closing on focus
  loss, and a burst of imports is serialized to one in-flight resolve; `inbox`
  (GET) reports `{status:"distilling"}` while that prepare runs, then hands
  the resolved raw text (`fields: null`) to the claiming app tab once before
  clearing it, and the tab distills client-side through `/api/distill` with
  its own Distill provider — or skips the AI request entirely when the
  import's `distillAi` flag is off. Extension imports include a short
  claim token and open a fresh app tab with that token, so a new posting starts
  a new independent tailoring session instead of replacing an existing tab's
  job target. The import also carries an optional `autoTailor` flag from the
  popup's "Polish automatically after import" toggle, so the app can jump
  straight to polish once the brief and a base resume are ready, plus an
  optional `distillAi` flag from the popup's "Distill with AI" toggle
  (`body.distillAi === false` → false, anything else → true, so older extension
  builds that omit it keep distilling); both flags are stored on the inbox entry
  and returned in the `inbox` delivery payload so the claiming tab knows whether
  to run the AI distiller or fall straight to the deterministic parser.
  `analyze` / `import` are
  reachable cross-origin from the
  extension popup and are gated to extension-scheme Origins
  (`chrome-extension://`, `moz-extension://`, `safari-web-extension://`)
  with the validated Origin reflected back — never a wildcard, never an
  absent Origin; `inbox` is polled same-origin by the app and stays behind
  the localhost CSRF/Host guard with no CORS header. The quick score
  reports only overlap of known tech keywords — it never invents resume
  content. `/api/polish` provides the fuller provider-backed review, with
  deterministic grounding/sanitization checks; its output still requires
  human review.
- workspace file storage under `job-search-workspace/` (auto-load,
  upload, save, reload — `server/workspace.ts`, which also owns the
  base-resume version history in `.trash/`)

Resume scoring and keyword extraction live in `src/resumeEngine.ts` (or
similarly focused helpers). Keep that logic out of `server.ts`.

When a workflow grows, split it into focused helpers (file readers,
provider clients, request handlers) rather than packing more code into
one large route.

The `/api/polish` flow follows that rule — it is split across focused
modules under `server/ai/` so no single file carries the whole pipeline:

- `polish.ts` — the `handlePolish` route (request parsing, the
  suggest → parallel audit + cover orchestration, derived `polishedText`
  assembly) only.
- `providers.ts` — provider identity + per-request config resolution
  (`normalizeProvider`, default provider/model, key/base-URL lookup,
  `resolveProviderRequest`, `resolveAuditProviderRequest`).
- `clients.ts` — the outbound provider clients (OpenAI Responses,
  OpenAI-compatible chat, Anthropic Messages, Gemini) and the
  `callConfiguredProvider` dispatch.
- `prompts.ts` — every system/user prompt and the shared
  honest-tailoring / anti-fabrication rule helpers (also imported by
  `applicationAnswers.ts`). Untrusted text (job description, resume,
  honest context, custom instructions, pass-1 output) is interpolated
  through `fenceUntrusted`, which neutralizes literal fence-tag
  look-alikes so pasted content cannot escape its `<job_description>`-style
  delimiters; the input-firewall rule tells the model fenced content is
  data, never instructions. Prompt budgets are structural: clip individual
  fields/arrays before `JSON.stringify` (or parse, shrink, and re-serialize),
  never character-slice serialized JSON into an invalid payload.
- `sanitize.ts` — missing-skill, structured suggestion, and strict-review
  response validation (`sanitizeStrictReview`: enum
  fallbacks, string clips, array caps, markup rejection on rewrites).
  The markup gate allows exactly the editor's inline-mark vocabulary
  (`<b>`/`<i>`/`<u>`, no attributes) because formatted bullets carry those
  tokens in `currentText` and a faithful suggestion echoes them; all other
  tags, LaTeX commands, and newlines still reject. `sanitizeTailorSuggestions`
  takes an optional drop-stats collector and the route warns (shape-only)
  when a reply's suggestions are ALL dropped — a silent all-drop is
  otherwise indistinguishable from "no changes needed".
  Hit-keyword grounding: a suggestion whose claimed JD
  keyword appears in `proposedText` but whose significant words exist
  nowhere in the scope text or honest context is dropped
  (`ungroundedKeyword`) — the model-prose evidence field cannot launder an
  inferred fact (e.g. "clinics run Windows") into the resume.
- `scoring.ts` — fit arithmetic and verdict derivation over the reviewer's
  `requirementCoverage` evidence (`scoreFromRequirementCoverage`,
  `coverageHasEligibilityBlocker`, `missingRequiredFromCoverage`).
  Coverage statuses must be grounded against the submitted resume evidence
  before the same rows reach the display table, bucket math, or gap caps; an
  unsupported model-authored "covered" status cannot inflate any of them.
  `applyGapCapsAndVerdict` derives the server verdict from the fit score
  conservatively: a graduated cap scales with the number of genuinely missing
  required skills (≥1 → 79, ≥2 → 69, ≥3 → 60; a BLOCKER or unmet eligibility
  gate → 45 / DON'T APPLY), taking the STRONGER of the reported HIGH gaps and
  the missing `requirementCoverage` rows so gaps can't be under-reported; base
  AND tailored scores clamp DOWN to that cap and the verdict is
  `verdictForScore(tailored)` — never inflated, with a deterministic `capReason`
  naming the mechanism. With no usable numeric score the sanitized verdict
  passes through unchanged (a hard eligibility blocker still forces DON'T
  APPLY). `displayCoverageFromRequirements` derives the user-visible
  `strictReview.coverage` table from the same sanitized rows — the model no
  longer authors a second copy of the requirement table, so the display and
  the score can't disagree.
- `eligibilityLexicon.ts` — the one home for every work-auth / credential
  term list (the distiller's `AUTH_STEMS` grounding stems, scoring's
  `ELIGIBILITY_BLOCKER` hard gate, and the seniority-bucket regex); its
  header documents how the three deliberately differ. Add new gate terms
  there, considering all three lists together.
- `grounding.ts` — deterministic JD-term grounding helpers used by the
  sanitizers. The proposed-text gate compares normalized JD terms against the
  submitted resume scope and honest context; unsupported JD-only terms produce
  structured grounding drops before a suggestion can be applied. Treat the
  current normalization/matching rules as implementation detail and keep their
  behavior locked by grounding/sanitizer probes rather than documenting one
  prefix heuristic as a stable contract.
- `json.ts` — `parseAiJson` (fenced / prose-wrapped / outermost-brace
  + trailing-comma repair). `errors.ts` — `UserSafeAiError` and the
  config-error → 400 mapping.

## API Design

- Keep API routes explicit and loopback-only by default. There is no auth
  layer. `HOST=0.0.0.0` is an explicit, unauthenticated LAN-exposure override;
  never use it on a public or untrusted network.
- Validate and coerce recognized boundary fields before use, and reject invalid
  required values. Do not claim that unknown fields are rejected unless the
  route has an explicit allowlist check and a regression test.
- Return stable JSON response shapes for the frontend.
- Cap request payloads (current limit: `maxRequestBytes = 8_000_000`).
- Surface provider errors with safe, user-facing messages; never leak
  raw provider response bodies, stack traces, or internal paths to the
  browser.

## AI Provider Layer

The provider is chosen per request. The frontend AI menu has separate
Distill, Tailor, and Review stage configs: `/api/distill` receives the
Distill config, `/api/polish` receives the Tailor config as `provider` /
`model` / `reasoningEffort`, and the strict-review pass receives the
Review config as `audit*` fields. If a request omits provider fields
(headless/API use), the server defaults to the **Claude Code CLI**
(`claude-cli`) — an account-backed CLI path rather than a separately configured
hosted API key (`getDefaultProvider()` in `server/ai/providers.ts`). Setting
`AI_PROVIDER` supplies that headless fallback. A non-empty, unrecognized
`AI_PROVIDER` is a fail-fast configuration error; it does not silently select
OpenAI. When OpenAI is selected explicitly, its model comes from
`OPENAI_MODEL` (`gpt-5.5` default). The other account-backed CLIs (Codex CLI
and the Antigravity CLI `agy`, which replaced the retired Gemini CLI) are
similar paths for their vendors. They avoid a separate metered API key in
RoleFit, but access and usage limits remain governed by the installed CLI and
signed-in provider account. The frontend already defaults
all three stages to `claude-cli`, so this mostly affects the headless /
no-provider request path.

Per-provider rules:

- **Subscription CLIs** (Claude Code `claude-cli`, Codex CLI `codex-cli`, and
  the Antigravity CLI `antigravity-cli` — the `agy` binary that replaced the
  retired Gemini CLI) shell out to local subprocesses via `server/ai-cli/`
  using the CLI's existing account auth. RoleFit needs no API key for these
  paths; provider entitlements and usage limits still apply.
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
  values from the UI for ad-hoc use. An `apiKey` may live only in page memory
  for the session and in the same-origin request body. The local server uses it
  only to authenticate the selected hosted/custom provider call; never persist,
  log, or echo it. Distill uses
  that same request shape on `/api/distill`; Review uses the parallel
  `auditProvider`, `auditApiKey`, `auditApiBaseUrl`, `auditModel`, and
  `auditReasoningEffort` fields on `/api/polish`.
- `.env` keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
  `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY`, and
  `MISTRAL_API_KEY`. `OPENAI_COMPATIBLE_API_KEY` applies only to the headless
  `openai-compatible` provider, and `LOCAL_AI_API_KEY` applies only to
  Local/custom; neither is a global fallback. `AI_API_KEY` is the explicit
  shared fallback when a provider-specific key is absent.
- Default provider: `AI_PROVIDER`.
- Provider-specific model overrides: `OPENAI_MODEL`, `ANTHROPIC_MODEL`,
  `GEMINI_MODEL`, `OPENROUTER_MODEL`, `GROQ_MODEL`, `TOGETHER_MODEL`,
  `MISTRAL_MODEL`, `LOCAL_AI_MODEL`, `CLAUDE_CLI_MODEL`, `CODEX_CLI_MODEL`,
  and `ANTIGRAVITY_CLI_MODEL`. For request resolution, `AI_MODEL` is only the
  generic model override for the headless `openai-compatible` provider; it does
  not replace the provider-specific variables above.
- Provider-specific base-URL overrides: `OPENROUTER_BASE_URL`,
  `GROQ_BASE_URL`, `TOGETHER_BASE_URL`, `MISTRAL_BASE_URL`, and
  `LOCAL_AI_BASE_URL`. `AI_BASE_URL` / `OPENAI_COMPATIBLE_BASE_URL` apply only
  to the headless `openai-compatible` provider, not to every provider.

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
  `scoring.ts`) — the model extracts evidence, the server does the math, so
  verdict and score cannot disagree. Model-authored numbers (`fitScore` /
  `fitBuckets`) never enter scoring. The reviewer acts as a
  validator of the polish pass — unsupported inserted terms lower the
  tailored coverage, never raise it
- write bullets as engineering accomplishments in plain language — no
  brochure vocabulary, no claims the candidate could not defend in an
  interview, and proposed text stays close to the current field's length
  so the one-page layout survives
- keep strict review non-rewriting: in a combined run it compares the original
  scope with the sanitized tailored result; in review-only it audits the
  current edited draft as-is

The only LOCAL fallbacks are the deterministic distiller
(`src/lib/jobExtract.ts`) and the local fit estimate (D011, 2026-07-06):
when the AI tailor, review, or cover-letter call cannot run or returns
nothing usable, the stage fails plainly with a classified reason and a
Retry — no locally generated draft stands in. Application-answer generation
also has no local draft fallback.

## Job Posting Import

Keep the import pipeline split by responsibility:

- `server/network.ts` fetches the page safely, handles Workday CXS JSON
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

- The structured `ResumeData` model, edited through the owned typeset page, is
  the source of truth. `.txt` / `.md` / `.csv` (or pasted) resumes are parsed once
  into that model; PDF-only sources must be pasted as extracted text. There is no
  DOCX or LaTeX import/export.
- `.resume` is the portable save format for resume data: a lossless JSON envelope
  (`{ format: "rolefit.resume", version: 1, data: <ResumeData> }`) written and read
  entirely client-side (like the PDF export — no server route). `src/lib/resumeFile.ts`
  owns `serializeResumeFile` / `parseResumeFile`; the latter coerces shape
  defensively and remaps ids on load so a file from a prior session cannot collide
  with the in-memory id counter.
- D014: `src/typeset/` is the canonical layout path for the editor and PDF
  export. Both consume the same layout result so line breaks, vertical flow, and
  pagination stay aligned — the editor is its own WYSIWYG preview, so there is no
  separate compile-preview overlay, and typesetting/PDF generation run in the
  browser with no external toolchain.
- `src/sections/ResumePrintLayer.tsx` remains an internal/manual browser-print
  surface, not a second advertised PDF engine. The typeset eval fixtures under
  `src/typeset/__evals__/` are committed static regression truth for the owned
  engine; they are frozen (no external regeneration path).
- Keep `job-search-workspace/` the canonical location for personal
  resumes, application trackers, exported drafts, and job-specific
  files. The folder is gitignored except for its `README.md`.
- On startup, the server discovers root-level base resumes named
  `base-resume.resume` or `base-resume-*.resume`, loading `base-resume.resume`
  first when present, then named variants; when none exist it seeds the bundled
  `server/starter.resume`. Legacy `.txt`, `.md`, and `.csv` base resumes remain
  readable as fallback plain text for old local workspaces.

## Deployment And Infrastructure

- Current shape is local-first: no hosted RoleFit backend, no database, no
  account system. The server binds to loopback by default; the optional
  `HOST=0.0.0.0` override exposes the unauthenticated app to the LAN and must
  never be used on a public or untrusted network.
- Do not introduce infrastructure, platform changes, or paid / vendor
  dependencies without asking.
- Do not add Electron / Tauri / native desktop packaging unless the user
  explicitly requests it.
- Do not make remote API writes unless explicitly requested. Dry-run
  write-oriented remote commands first when possible.
