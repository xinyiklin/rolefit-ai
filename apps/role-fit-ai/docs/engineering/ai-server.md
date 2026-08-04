# AI / Server Guidelines

Paths in this document are relative to `apps/role-fit-ai/`. Run commands from
the repository root.

RoleFit AI's reusable server runtime (`server/runtime.ts`) serves the Vite
frontend in development, exposes a small set of local API routes, and owns all
outbound AI provider calls. The thin web entry point (`server.ts`) supplies the
current browser-host defaults and owns process-signal shutdown. The Electron
provider companion encrypts managed OpenAI/Claude keys with `safeStorage` and
sends decrypted credentials only in memory to a server process it owns. Keys
never enter browser storage, HTTP, argv, logs, or provider-status payloads.
Explicit `.env` keys remain a server-side standalone/headless fallback.
The Electron-owned utility server starts with an empty authoritative provider
snapshot before listening, does not load the app-local `.env`, and receives no
managed API credential through its inherited process environment.

## Port

The canonical standalone dev/preview port is `5181` (overridable via `PORT`;
reserved range `5181-5183`). If `5181` is already bound, the app is almost
certainly already running — reuse the existing instance instead of starting a
second process or silently switching ports. Sibling reservations: careflow
`5173-5180`, portfolio `5184-5185`; do not mix them up.

The Electron-owned server defaults to `5181`, but the companion can save a
validated local site port from `1` through `65535` at
`userData/desktop-settings/settings.json`. Applying it checks loopback
availability and relaunches through normal server cleanup.
`ROLEFIT_DESKTOP_PORT` is a locked per-launch companion override and is
separate from standalone `PORT`. The companion opens the active
`http://localhost:<port>` origin in the system browser, whose API calls remain
relative and same-origin.

Source extension development seeds port `5181`. The companion writes the
resolved active server port into the materialized extension's runtime config as
a first-install default; the versioned `chrome.storage.local` settings record
is authoritative afterward. The companion shows and copies the active port so
the user can update the popup setting without reloading the extension. The
extension does not scan localhost or use another listener. An app-port change
also changes the browser origin: origin-scoped `localStorage` is separate at
the new port, while the workspace and provider state remain under `userData`.
This service is not a general cross-origin desktop bridge. Do not add blanket
CORS or turn the hosted product/download page into a client of the local server.

## Browser / Companion Trust Boundary

- The browser is the only RoleFit product UI. Electron must not load the React
  renderer or become a second tracker/editor/workspace host. Its compact local
  `file:` page is the setup surface for the closed catalog of three CLIs and two
  API providers.
- The existing local `/api/*` surface is same-origin and unauthenticated. Its
  Host/Origin guard reduces DNS-rebinding and browser CSRF risk; it does not
  authenticate native processes, prove server identity, or authorize a hosted
  web origin.
- The companion uses typed IPC between its exact local main frame and Electron
  main for write-only API-key setup, shape-only provider status, opening the
  official CLI install/sign-in guide (official docs), a fixed main-owned
  external-terminal sign-in, and opening RoleFit in the system browser. The
  renderer supplies only a closed provider id for terminal handoff, never a
  command, arguments, shell text, working directory, or environment values.
  Stored keys are never
  returned. Renderer `window.open` requests are always denied; typed IPC can
  reach only main-owned official install guides or the selected local RoleFit
  origin. There is no RoleFit login/pairing system.
- `/api/providers` is an ordinary read-only, same-origin server route, not an
  Electron management endpoint. It exposes only closed provider ids, kind,
  configured/readiness, and bounded auth state so the browser can show only
  providers the user added.
- The local server remains the only owner of AI execution. The companion may
  start fixed, allowlisted CLI status probes and the external-terminal sign-in,
  and send one bounded credential snapshot to its owned server over their
  private parent/child channel, but it must not expose executable paths, raw
  stdout/stderr, broad
  environment data, provider tokens, renderer-supplied argv, filesystem
  methods, or workspace/tracker routes.
- Reused standalone listeners never receive the Electron vault. In that mode
  the provider route reports `companionManaged: false`; only explicit `.env`
  credentials remain available for standalone/headless use. Companion
  save/remove/enable actions are refused until the user stops that listener and
  reopens RoleFit through the companion, so setup cannot report success while
  the browser registry remains unchanged.
- CLI credentials remain owned by the provider CLI. Parse bounded status output
  into installed/signed-in/signed-out/unknown booleans, discard the output, and
  never return account identifiers. Every desktop status/sign-in child and
  every server AI CLI child receives a deliberately sanitized environment:
  preserve executable and provider-config discovery such as `PATH`, home, and
  CLI config locations, but strip native API/token/service-account credentials
  and Electron/Node injection variables so a subscription-CLI request cannot
  silently fall through to browser- or server-managed API credentials.
- Antigravity 1.1.x exposes no non-interactive auth-status command. Its
  installed/configured manual state is request-eligible as ready-to-verify
  while `authState` remains unknown; this must never be presented as detected
  sign-in. The first real Antigravity provider request verifies the
  provider-owned session and returns sanitized recovery guidance on auth
  failure.
- Browser-extension origins and inbox claim tokens are a separate trust domain.
  Never route extension requests through companion IPC or treat a claim token
  as authentication for CLI status/sign-in actions.

## Server Boundaries

The server layer (`server/runtime.ts` routing to focused `server/` modules)
owns:

- local HTTP serving with Vite middleware in development
- an explicit start/close lifecycle for the local web server and isolated
  server probes; importing the runtime never binds a port or creates storage
- separate application and workspace paths so launch working directories cannot
  redirect personal data; application assets come from `appRoot`, while all
  writable resume/tracker state stays under `workspaceDir`
- `/api/health`, a non-content identity/version probe with an opaque workspace
  fingerprint (never a workspace path) used only for local compatibility
  checks. It is predictable metadata, not authentication, and must never grant
  companion access or establish browser trust
- `.env` loading and process environment hygiene
- a validated in-memory provider snapshot from the owning Electron parent,
  atomically replaced and cleared on shutdown; it contains the only decrypted
  managed API credentials and must never be accepted from HTTP, environment,
  argv, or a reused listener
- `/api/providers`, a shape-only same-origin registry of configured/readiness
  state. It never returns keys, account identifiers, executable paths, versions,
  raw CLI output, operation ids, or workspace details
- `/api/polish` AI provider routing — subscription CLIs (Claude Code,
  Codex CLI, Antigravity CLI) shelled out to local subprocesses,
  plus the native OpenAI and Anthropic APIs. The route supports independent
  `tailor` and `review` requests plus a backward-compatible/headless `both`
  request. The current UI implements Both as two sequential requests: Tailor
  first (`stages: "tailor"`), then Review
  (`stages: "review"`) with only the sanitized suggestions from that same run.
  A headless `stages: "both"` request instead runs targeted suggestions first,
  then runs its strict audit and optional cover pass in parallel. No single
  model response is forced to suggest edits, score, audit, and revise a letter
  at the same time. The optional cover leg remains only for older/headless
  clients and runs only when they supply a candidate-authored source letter.
  Review-only skips the suggestion pass and audits the
  current edited draft exactly as submitted; it must not regenerate or replay
  stale tailoring changes. The suggestion pass
  returns only structured `suggestedChanges` (no full-text rewrite and no fit
  score — scoring belongs exclusively to the audit pass). When the audit does
  not return a usable review and score, the Review stage fails visibly and the
  client does not calculate or substitute a local fit judgment;
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
  receives the current edited draft as its audit target. The Tailor stage
  supplies the primary provider for suggestion generation, cover-letter
  revision, and application answers. The Review stage can use its own
  provider/model (request `audit*`
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
  `/api/cover-letter` is **one operation**, not a staged workflow. It takes
  `sourceCoverLetterText`, the whole `evidenceItems` corpus, the job
  description, `resolvedContext` hints, any `slotAnswers`, and optional
  app-supplied `employerContext`; there is no mode, plan, or selection field.
  Shared deterministic preflight resolves date, candidate name, role, company,
  greeting, and sign-off, and returns `422 needs_input` before any provider
  dispatch only when a fact truly cannot be resolved: a missing candidate name,
  role, or company, or an unanswered private template slot. Generative template
  slots never block. A recipient named in the source greeting is preserved;
  otherwise the company hiring team is the fallback.
  The model receives the full corpus and chooses what to use — that selection is
  its job, not the candidate's. It returns body paragraphs with the evidence ids
  it actually used and the generative slot ids it resolved; the server assembles
  date, greeting, body, and sign-off. Server validation collects **repairable
  violations** rather than failing outright: unknown evidence or slot ids, a
  paragraph citing nothing, a residual template token, a greeting/sign-off/date
  inside the body, a missing role or company, a second greeting, generic
  brochure phrasing, and ungrounded candidate terms, numbers, or outcomes. Any
  violation triggers exactly **one silent repair request** carrying the
  violations and the rejected output. A second failure returns `422` with
  `status: "blocked"`, a user-safe error, and deterministic blocker records
  (`code`, `detail`, `recovery`, and an optional bounded excerpt); it never
  returns the rejected provider text. The client keeps the current letter
  unchanged and offers recovery near the workflow heading. A valid response is
  also staged client-side as a fingerprinted proposal: only **Use proposal**
  applies it, **Keep current** does not touch the editor, and changed semantic
  inputs disable acceptance until Tailor runs again. The flow never escalates
  into asking the candidate to plan evidence. Length is advisory — outside
  180-420 words the letter still returns, with a warning attached. Employer-subject sentences are
  excluded from the candidate-claim surface, so a posting fact never widens
  candidate evidence. It and `/api/application-answers` echo the resolved
  `provider` / `model` / `reasoningEffort`.
- resume import into the structured editor: a `.txt` / `.md` / `.csv` (or pasted)
  resume is parsed once into `ResumeData`, the source of truth thereafter (no DOCX
  or LaTeX import — the original is converted a single time into the editor
  format); a previously saved `.resume` file loads its `ResumeData` directly
- job posting import (`/api/import-job`, `server/jobImport.ts`): fetch a public posting URL —
  Workday CXS JSON when the host is recognized (`*.myworkdayjobs.com`,
  `/job/` and `/details/` links), Ashby's public posting API for direct board
  URLs and approved branded `ashby_jid` wrappers, Greenhouse canonical job HTML for direct
  board URLs and branded wrappers that expose a numeric `gh_jid` plus a
  validated board slug in their HTML, LinkedIn visible job body + criteria
  rows when present, otherwise a generic HTML→text scrape — behind SSRF
  guards that re-validate the host and resolved IP on every redirect hop
  and reject private / loopback / link-local targets. Distilling is
  AI-first (`/api/distill`, below) with the deterministic
  `src/lib/jobExtract.ts` engine as the deterministic non-AI path; it then splits the result
  into compact model-facing tailoring text and tracking-only facts (role
  summary, company, location, job type, work-auth note, compensation). The
  model-facing job-description field is a structured brief with Job Title,
  Company/Product Context, Core Responsibilities, Required Qualifications,
  Preferred Qualifications, Tech Stack/Keywords, Seniority Signals, and Domain
  Signals. Prepare adapts those fields plus the retained raw source into its
  complete editable review brief, including benefits and extraction or
  candidate-review gaps. Benefits remain review context and are not added to
  the resume-tailoring prompt. Apply persists that complete review brief and the
  immutable captured posting separately; reopening reconstructs the same
  editable/model-facing projections. The link itself is kept only for pipeline
  tracking and is never sent to the AI.
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
  The client (`src/lib/aiDistill.ts`) is AI-first. When AI Distill is disabled,
  the deterministic `jobExtract.ts` path completes without a provider call.
  When AI Distill is selected but the request fails, a deterministic brief may
  remain available for inspection, but the stage stays failed and cannot
  auto-launch Tailor or Review. The
  route sits behind the localhost CSRF/Host guard. `.env` keys stay server-side;
  a menu-entered key reaches the route only in that transient request and is
  never returned. The
  success response echoes the RESOLVED `provider` / `model` / `reasoningEffort`
  (never `apiKey`) plus `attempts` (dispatch count, ≥1) so the
  client can record which model produced the brief.
- browser-extension API (`/api/extension/*`, helpers in
  `server/extension/index.ts`): `status` (GET) is the content-free same-port
  service marker. For a syntactically valid extension Origin it returns the
  exact RoleFit marker, schema, `status:"ok"`, and whether that Origin is paired,
  with `Cache-Control: no-store`. Privileged extension-page GETs may omit
  `Origin`; only that absent-Origin GET may receive the same marker with
  `paired:false`, after which the origin-bearing pairing POST confirms or
  requests approval. Explicit invalid origins and origin-less preflights fail
  closed, and checking status never queues pairing. `analyze` (POST) extracts posting identity and
  performs a LAYERED duplicate lookup of any matching tracked
  application (`findMatchingApplication` now delegates to the shared
  `findDuplicateApplications` in `src/lib/jobIdentity.ts`: ATS posting id /
  normalized URL / requisition id in the posted text / no-id company + title +
  description overlap. Shared posting or requisition ids are exact; normalized
  URL equality is exact unless explicit ids conflict. Different explicit ids
  default to separate postings, but an ultra-high
  company/title/location/content guard can raise a `possible` review warning in
  case an id was entered incorrectly; it never auto-merges. An id on only one
  side still stops before fuzzy comparison. The no-id fallback requires
  substantial descriptions with strong lexical, ordered-phrase, and
  length-ratio agreement, so shared company/title metadata or boilerplate
  cannot trigger it. The posted `text` is passed as jobText so a duplicate can
  still be caught when neither URL exposes an id).
  The response keeps the
  existing `previousApp` shape (built from the best match) and adds
  `match: { level, confidence, evidence }` (evidence capped at 3 strings), or
  `previousApp`/`match` null when nothing matches. `import` (POST) accepts only
  the posting `text`, `url`, and the bounded `claimToken`, stores the page text,
  and returns immediately; a background server pass only
  RESOLVES the raw job text (e.g. fetching the full Workday, Ashby, or Greenhouse posting body) —
  it makes no AI call, because the server cannot read the receiving tab's
  provider settings. The background pass survives the popup closing on focus
  loss, and a burst of imports is serialized to one in-flight resolve. `inbox`
  (GET) reports `{status:"distilling"}` while preparation runs, then hands only
  `{text, url}` to the claiming app tab once before clearing it. The tab always
  runs provider-backed AI Distill with its selected provider; if that request
  fails, the deterministic brief may remain visible for inspection while the
  stage stays failed. Extension imports include a short
  `claimToken` and open a fresh app tab with that token and its own `tabId`, so
  a new posting starts a new independent preparation session instead of
  replacing an existing tab's job. The first progress or delivered-posting
  callback selects Prepare before updating intake state, and extension intake
  stops there after Distill and the duplicate gates. `extensionImport`,
  `claimToken`, `tabId`, and the `"distilling"` progress token remain stable;
  the retired `autoTailor`, `distillAi`, and pre-extracted `fields` values are
  ignored and never cross the inbox handoff. Ordinary Prepare may still rank
  strict saved variants and select a clear winner, but that is source selection,
  not automatic tailoring or a persisted schema extension.
  `status` / `analyze` / `import` are reachable cross-origin from the extension
  popup. `analyze` and `import` require the popup's exact, explicitly configured
  `EXTENSION_ALLOWED_ORIGINS` identity (`chrome-extension://`,
  `moz-extension://`, or `safari-web-extension://`). Whenever `Origin` is
  present, only the validated exact value is reflected back — never a wildcard,
  scheme-only match, path-bearing value, or malformed Origin. When the allowlist
  is unset, invalid, or does not contain the caller, `analyze` and `import`
  return `403`. A valid unapproved extension may call only the content-free
  status handshake and bounded
  `/api/extension/pairing-request`; the trusted companion reads the
  short-lived pending origin and requires explicit approval before persisting
  it and restarting the owned server. Manifest host permission provides
  connectivity only and cannot authorize the caller.
  `inbox` is polled same-origin by the app and stays behind
  the localhost CSRF/Host guard with no CORS header. The extension never reads
  the base resume or calculates a local fit estimate. Fit score, coverage, and
  verdict come only from AI Review in the app; its output still requires human
  review.
- workspace file storage under the host-supplied `workspaceDir` (auto-load,
  upload, save, reload; source development defaults to `workspace/`,
  while packaged runs use `app.getPath("userData")/workspace/`).
  Resume and cover-letter histories live beside their variants under
  `resumes/.trash/` and `cover-letters/.trash/`.

Deterministic keyword and mechanical resume analysis live in focused client
helpers under `src/resume/` and `src/resumeEngine.ts`. They may describe text or
evidence, but never calculate a fit score or verdict. Keep that logic and the AI
Review judgment out of `server.ts` orchestration.

When a workflow grows, split it into focused helpers (file readers,
provider clients, request handlers) rather than packing more code into
one large route.

The `/api/polish` flow follows that rule — it is split across focused
modules under `server/ai/` so no single file carries the whole pipeline:

- `polish.ts` — the `handlePolish` route (request parsing, the
  suggest → parallel audit + cover orchestration, derived `polishedText`
  assembly) only.
- `providers.ts` — provider identity + per-request config resolution
  (`normalizeProvider`, default provider/model, provider-specific key lookup,
  `resolveProviderRequest`, `resolveAuditProviderRequest`).
- `clients.ts` — the outbound provider clients (OpenAI Responses and
  Anthropic Messages), CLI dispatch, and the
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
- AI Review owns the complete fit judgment. Its response contains one
  evidence table (`strictReview.coverage`), one verdict and reason, and one
  numeric comparison (`aiScore.base` / `aiScore.tailored`). The server validates
  JSON shape, exact enums, numeric bounds, and that the tailored score belongs
  to the declared verdict band. It does not recalculate scores, reinterpret
  coverage statuses, count missing rows into caps, or replace the verdict.
  Invalid or incomplete review output fails the Review stage instead of being
  repaired into a different judgment. Suggestion and rewrite evidence still
  passes the existing anti-fabrication sanitizers before reaching the editor.
- `eligibilityLexicon.ts` — work-authorization and credential stems used only
  to ground facts extracted by the job distiller. Eligibility judgment belongs
  to AI Review; this module does not gate, score, or select a verdict.
- Candidate facts reach the model only through `honestContext`. The client's
  `buildCandidateFactsContext` (`src/lib/candidateFacts.ts`) prepends declared
  citizenship, work authorization, sponsorship, education level, and field of
  study to the user's honest context, and that combined string is what the
  grounding allowlist is built from. Every field is therefore opt-in by
  construction: an unset value contributes no line, so an undeclared
  citizenship, clearance eligibility, or DEGREE can never become groundable
  wording. Citizenship gates the work-authorization lines; education level gates
  the field of study. Any new fact added there widens the allowlist and needs the
  grounding/sanitizer probes re-run.
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
- Preserve the loopback Host/Origin guard across the supported local spellings:
  `localhost`, `127.0.0.1`, and `[::1]`. Do not broaden it into arbitrary Host,
  Origin, or wildcard acceptance.
- Validate and coerce recognized boundary fields before use, and reject invalid
  required values. Do not claim that unknown fields are rejected unless the
  route has an explicit allowlist check and a regression test.
- Return stable JSON response shapes for the frontend.
- Cap request payloads (current limit: `maxRequestBytes = 8_000_000`).
- Surface provider errors with safe, user-facing messages; never leak
  raw provider response bodies, stack traces, or internal paths to the
  browser.
- Carry request cancellation through the entire provider boundary. A browser
  disconnect or explicit Stop aborts native API fetches and terminates the
  matching CLI subprocess; cancellation must not leave hidden provider work
  running or advance the workflow.

## AI Provider Layer

The provider is chosen per request from the companion-managed configured
registry. Settings > AI stages holds a separate config per stage and shows only
providers the user explicitly added: `/api/distill` receives the Distill config,
`/api/polish` receives the Tailor config as `provider` / `model` /
`reasoningEffort`, the strict-review pass receives the Review config as `audit*`
fields, `/api/cover-letter` receives the Cover config, and
`/api/application-answers` receives the Answers config. Cover and Answers ran on
the Tailor config before they became separately configurable; an install that
predates the split migrates them from Tailor on load, so its behavior does not
change across the upgrade.

`customInstructions` is resolved PER STAGE in the browser before the request is
sent: a stage with its own non-blank override sends that text, otherwise it sends
the shared instructions. Tailor and Review are separate requests, so one polish
run may carry different guidance for each. The server contract is unchanged — one
`customInstructions` string per request.

Browser requests contain provider, model, and
reasoning settings but no API credentials. If a request omits provider fields
(standalone/headless API use), the server defaults to the **Claude Code CLI**
(`claude-cli`) — an account-backed CLI path rather than a separately configured
hosted API key (`getDefaultProvider()` in `server/ai/providers.ts`). Setting
`AI_PROVIDER` supplies that headless fallback. A non-empty, unrecognized
`AI_PROVIDER` is a fail-fast configuration error; it does not silently select
OpenAI. When OpenAI is selected explicitly, its model comes from
`OPENAI_MODEL` (`gpt-5.6-terra` default). The other account-backed CLIs (Codex CLI
and the Antigravity CLI `agy`, which replaced the retired Gemini CLI) are
similar paths for their vendors. They avoid a separate metered API key in
RoleFit, but access and usage limits remain governed by the installed CLI and
signed-in provider account. This default is a standalone/headless request
fallback, not permission for the browser to show or select an unconfigured
provider.

Per-provider rules:

- **Subscription CLIs** (Claude Code `claude-cli`, Codex CLI `codex-cli`, and
  the Antigravity CLI `antigravity-cli` — the `agy` binary that replaced the
  retired Gemini CLI) shell out to local subprocesses via `server/ai-cli/`
  using the CLI's existing account auth. RoleFit needs no API key for these
  paths; provider entitlements and usage limits still apply. Antigravity 1.1.x
  has no non-interactive auth-status command, so an installed/configured
  Antigravity provider stays `authState: "unknown"` and is ready-to-verify on
  first use rather than falsely labeled signed in. It also requires the print
  prompt as `-p`'s argv value; stdin is not a supported prompt source, so its
  local process argument list briefly contains the request.
- **OpenAI API** uses the Responses API with `store:false` and native JSON mode.
  The supported GPT-5.6 choices are Sol, Terra, and Luna; the balanced default is
  `gpt-5.6-terra`.
- **Claude API** uses Anthropic Messages. The call sends no `temperature` and no
  trailing assistant prefill because current Claude models reject those patterns.
  JSON is enforced by the strict-output prompt plus `parseAiJson`.
- Managed browser requests accept provider/model/effort identifiers only. The
  server resolves an OpenAI/Claude key from the companion-owned in-memory
  credential snapshot immediately before dispatch; there is no browser
  `apiKey` or `auditApiKey` request field. Never persist, log, echo, or expose
  the decrypted snapshot.
- `.env` keys: `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`. Keys are strictly
  provider-specific; no generic key falls through to another vendor. They are
  an explicit standalone/headless fallback, not companion-managed storage.
- Default provider: `AI_PROVIDER`.
- Provider-specific model overrides: `OPENAI_MODEL`, `ANTHROPIC_MODEL`,
  `CLAUDE_CLI_MODEL`, `CODEX_CLI_MODEL`, and `ANTIGRAVITY_CLI_MODEL`.
  `AI_MODEL` remains an explicit model override for the headless/default path.
- The only known provider ids are `claude-cli`, `codex-cli`,
  `antigravity-cli`, `openai`, and `anthropic`. Removed ids fail closed even if
  an old tab or saved setting submits one.

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
- make one holistic, evidence-backed fit judgment: the strict reviewer returns
  `aiScore`, `strictReview.verdict`, `strictReview.verdictReason`, and a concise
  `strictReview.coverage` table in the same response. Score and verdict must use
  the documented bands (85-100 STRONG FIT, 70-84 REASONABLE FIT, 46-69 STRETCH,
  0-45 DON'T APPLY). The model must distinguish a genuinely absent requirement
  from a differently worded or adjacent qualification, avoid duplicating one
  requirement into several gaps, and treat acceptable ranges such as 0-6 years
  as ranges. No score lift is allowed unless proposed changes make existing
  evidence materially clearer. The server rejects malformed or band-inconsistent
  output but never calculates a replacement score or verdict
- write bullets as engineering accomplishments in plain language — no
  brochure vocabulary, no claims the candidate could not defend in an
  interview, and proposed text stays close to the current field's length
  so the one-page layout survives
- keep strict review non-rewriting: in a combined run it compares the original
  scope with the sanitized tailored result; in review-only it audits the
  current edited draft as-is

### Career-writing guidance

Prompt language follows stable public career-center guidance rather than trying
to mimic a single sample:

- MIT CAPD: a cover letter should be specific and genuine, use brief evidence
  stories, avoid repeating the resume, stay under one page, and be read aloud
  or reviewed for voice:
  <https://capd.mit.edu/resources/career-toolkit-writing-a-cover-letter/>
- CareerOneStop: tailor each letter, keep it concise (normally 200–400 words
  and 3–4 paragraphs), and edit AI-assisted text so it remains the candidate's
  unique voice:
  <https://cloudfront.careeronestop.org/JobSearch/Resumes/cover-letters.aspx>
- Harvard FAS and MIT CAPD resume guidance: keep claims specific, active,
  direct, fact-based, and easy to scan; emphasize relevant impact rather than
  copying a job description:
  <https://careerservices.fas.harvard.edu/resources/hes-create-impactful-resumes-and-cover-letters/>
  and <https://capd.mit.edu/resources/career-toolkit-crafting-an-effective-resume/>

These are prompt-quality inputs, not permission to fabricate. The shared
truthfulness, source-attribution, grounding, and sanitization rules remain
authoritative.

The only deterministic non-AI alternative is the job distiller
(`src/lib/jobExtract.ts`). It is a successful path only when the user has AI
Distill turned off. If a requested AI Distill call fails, the local brief may be
retained for inspection but the selected stage remains failed. Tailor, Review,
cover-letter tailoring, and application-answer failures have no local
substitutes. No
locally generated draft, score, review, or verdict stands in.

## Job Posting Import

Keep the import pipeline split by responsibility:

- `server/jobImport.ts` selects constrained Workday CXS, Ashby public-posting,
  Greenhouse, LinkedIn, or generic HTML extraction. `server/network.ts` performs
  each public fetch, enforces timeouts, and applies SSRF checks on the original
  URL and every redirect hop.
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
  description. The client may recover benefits from the retained raw source for
  Prepare's editable human-review brief, but it must not put that material back
  into the model-facing tailoring text.

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
- Do not add default fallbacks that hide missing provider state. An
  unconfigured or unready provider must fail loudly, not silently call a
  different provider or return canned text.
- Do not leave empty `catch` blocks. Surface provider errors with
  user-safe, classified wording. Authentication, rate-limit/quota, provider
  configuration, timeout, and generic provider failures must not collapse into
  a misleading single cause. Cancellation is silent provider termination plus
  client Stop state rather than a surfaced error category.
- Avoid leaking secrets, tokens, raw provider responses, or full
  resume / job-description text in error messages.

## Logging

- Do not log raw resume text, job descriptions, or AI prompts by
  default.
- Keep routine AI diagnostics shape-only: stable local classifications, counts,
  and drop reasons. Do not log model-supplied target IDs, free-form error text,
  or response fragments.
- Local debug logs that include sensitive text require explicit user
  approval and should be temporary.
- Never log API keys.

## Document Workflow

- The structured `ResumeData` model, edited through the owned typeset page, is
  the source of truth. `.txt` / `.md` / `.csv` (or pasted) resumes are parsed once
  into that model; PDF-only sources must be pasted as extracted text. There is no
  DOCX or LaTeX import/export.
- `.resume` is the portable save format for resume data: the sole strict shared
  Typeset v1 envelope
  (`{ format: "typeset-resume", schemaVersion: 1, document, style }`) written and
  read entirely client-side (like PDF export — no server route). Runtime
  boundaries reject retired wire shapes; private pre-release data must already
  be rewritten before the current app reads it. The
  `@typeset/engine` codec owns exact-key validation, strips session ids at the
  file boundary, restores fresh ids on load, and includes persistent document
  style while excluding view-only zoom and spell-check preferences.
- `@typeset/engine` is the canonical structured-document, layout, DOM/print, and
  PDF path. `@typeset/editor` owns direct editing, history, formatting chrome,
  and geometry. Both RoleFit and the standalone Typeset site consume those
  packages so the editor and PDF share line breaks, vertical flow, pagination,
  fonts, and document style. RoleFit adds only its host-specific AI-scope and
  review-target overlay.
- The shared `ResumePrintLayer` remains an internal/manual browser-print
  surface, not a second advertised PDF engine. RoleFit's integration fixtures
  under `src/typeset/__evals__/` guard hard breaks, migration-era layout parity,
  and PDF round trips; the engine package owns the canonical deterministic
  layout and font-parity suites.
- Keep the host-supplied runtime workspace the canonical location for personal
  resumes, application trackers, exported drafts, and job-specific files.
  Source development uses `workspace/`, which is gitignored except
  for its `README.md`; packaged runs use `app.getPath("userData")/workspace/`.
- Serialize tracker/base-resume mutations and publish them atomically so
  concurrent local requests cannot expose a partial file. Tracker writes name
  every changed id plus its pre-edit `updatedAt`; the server keeps unmutated
  rows from the latest disk snapshot and returns `409` with that snapshot when
  the same row changed in another tab. Creation/update timestamps are required
  canonical ISO values, and an existing upsert must advance `updatedAt`
  strictly after its matched revision. Retired tracker fields, dual
  source-and-PDF artifact claims, duplicate ids, corrupt application JSON, and
  malformed strict `.resume` data fail closed with a user-safe error; never
  silently replace them with an empty store or guessed document.
- On startup, the server discovers `resumes/<variant>.resume`, loading
  `resumes/default.resume` first when present, then named variants. It migrates
  recognized legacy root-level documents without overwriting a destination,
  and falls back to the bundled `server/starter.resume` when no base exists.
  Legacy `.txt`, `.md`, and `.csv` base resumes remain readable as plain text.

## Deployment And Infrastructure

- Current shape is local-first: no hosted RoleFit backend, database, or account
  system. The ordinary browser entry remains the product host. The extracted
  server lifecycle and explicit `appRoot` / `workspaceDir` contract remain the
  canonical local web-server foundation. Electron uses that lifecycle to keep
  the service available, but it loads only its compact static companion page;
  RoleFit itself opens in the default browser. The packaged production server
  is bundled beneath read-only application resources, while its workspace,
  provider vault, and desktop settings write only beneath operating-system
  `userData`. The standalone web entry binds to loopback by default; its
  optional `HOST=0.0.0.0` override exposes the unauthenticated app to the LAN
  and must never be used on a public or untrusted network.
- Do not introduce infrastructure, platform changes, or paid / vendor
  dependencies without asking.
- Companion work follows the saved
  [architecture plan](desktop-architecture-plan.md) and
  [distribution plan](distribution-cloud-plan.md). Native macOS arm64/x64 and
  Windows x64 packaging plus the fail-closed signed-release workflow are the
  authorized D0-D4 slice. No database, RoleFit authentication, synchronization,
  hosted credential service, hosted download/R2 change, custom protocol,
  auto-update, or site-to-companion pairing belongs to that slice.
- Do not make remote API writes unless explicitly requested. Dry-run
  write-oriented remote commands first when possible.
