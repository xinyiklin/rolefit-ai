# AI / Server Guidelines

Paths in this document are relative to `apps/role-fit-ai/`. Run commands from
the repository root.

The [content warning policy](../../PRODUCT.md#content-and-evidence-warning-policy)
keeps usable AI output reviewable with bounded warnings, without an acknowledgment
step. Security, structure, resource, mutation-target, persistence, and stale-response
protections remain blocking. Generation prompts still require truthful source use.

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
- `/api/resume-polish` AI provider routing — subscription CLIs (Claude Code,
  Codex CLI, Antigravity CLI) shelled out to local subprocesses,
  plus the native OpenAI and Anthropic APIs. Normal Resume Polish sends
  `mode: "resume-proposal"` and performs one provider operation. An optional
  boolean `reviewEdits` (sent only when Settings > Guidance > Review edits
  before showing them is on; absent means off, a non-boolean is a 400) adds one
  keep/drop review dispatch in the same request, on the same resolved provider,
  model, effort, and abort signal, when at least one sanitized change remains.
  The response then carries `review: { outcome: "REVIEWED" | "UNAVAILABLE",
  attempts, heldBack: [{ change, reason: "LOW_IMPACT" | "INCORRECT", note? }] }`;
  `changes` holds only kept edits, a fully held-back proposal settles as
  `NO_CHANGES` with an empty summary, and any review failure except Stop returns
  the unreviewed proposal as `UNAVAILABLE`. The browser validates held-back
  changes exactly like kept ones. The server
  flattens mutable fields to `target-1`, `target-2`, and so on, keeps their
  document mapping private, and returns only outcome, changes with optional
  per-change warnings, short feedback, optional result warnings, withheld
  counts, prompt-omitted target count, and provider provenance. Bounded
  `sourceWarnings` about earlier generated resume wording reach the prompt as
  fenced `<earlier_output_concerns>`; they do not verify that wording. If the
  complete target set exceeds 42,000 serialized characters, the server selects
  material bullets, summaries, actual skill lists, and job-relevant fields
  without prefix-order bias. It serializes only complete target objects and
  validates the reply against exactly that selected set. Skills category labels
  are locked; actual skill lists remain targets. Unsupported new skills, category
  substitutions in a list target, and other content concerns produce warnings.
  Unknown/duplicate targets and malformed or unsafe mutations remain blocked;
  unchanged text is a no-op. Optional feedback concerns do not erase safe siblings.
  Only bullets, actual Skills lists, two `new-bullet` slots per in-scope
  standard entry with linked Profile text, and one `bullet-order` target
  (`order-N`, listing its bullet `target-N` ids) per standard entry with two or
  more bullets are mutable targets. A standard bullet change may carry
  `action: "remove"` instead of a replacement; an order change carries `order`,
  a complete permutation. The server withholds a removal of an entry's last
  bullet, a remove on a non-standard target, a remove of a bullet it also
  rewrites, a non-permutation, and a reorder of an entry that also loses
  bullets; an unchanged order is a no-op. An order target is sent only when all
  of its bullets are, and never counts as an omitted field. Identity, contact,
  education, and standard-entry role/employer/subtitle/date fields remain
  read-only evidence; omitted sections are absent. `shared/resumePolishContract.ts`
  derives the same positional `target-N`, `order-N`, and `add-N` ids on server and client from
  the scope plus `candidateContext`. New-bullet slots use only the prompt budget
  that existing targets leave, and linked Profile text travels in a separate
  fenced `entry_profiles` block outside that budget, so a linked Profile never
  changes which existing fields a pass can edit. Changes that rely on linked
  text carry `evidence: "profile"`; advice may quote `profileExcerpt`, and
  `add-from-profile` advice names a heading block that names no resume entry.
  Every change echoes its server `target`, and the client fails the proposal
  when an echo differs from its own target. A new-bullet change must repeat its
  slot's `entryId`. Both sides reduce structural marks the same way before
  numbering targets, and `locked.omittedEntryNames` (never sent to a provider)
  keeps a heading that also names an omitted entry unlinked. A heading links by
  an entry's title or subtitle; every enclosing heading must name that entry or
  be a grouping heading (resume section names or `GROUPING_HEADINGS`).
  `/api/resume-polish` accepts only the one-pass `resume-proposal` contract. Its prompt
  includes a silent self-audit before the provider returns JSON; the selected
  reasoning effort controls provider reasoning and the audit's breadth, while
  the audit remains internal and never becomes a second route or response.
  Cover letters and application answers use their own routes.
  `/api/cover-polish` is **one operation**, not a staged workflow. It takes
  `sourceCoverLetterText`, the whole `evidenceItems` corpus, the job
  description, `resolvedContext` hints, any `slotAnswers`, and optional
  app-supplied `employerContext`; there is no mode, plan, or selection field.
  Shared deterministic preflight resolves date, candidate name, role, company,
  greeting, and sign-off. Missing role/company inputs return `422 needs_input`;
  candidate name and private template details are optional warnings. An authored
  recipient is preserved, otherwise the company hiring team is used.
  The model chooses from the full completed candidate corpus. Unresolved Guidance
  prompts are filtered as evidence at both boundaries. Model paragraphs name their
  source ids; known ids remain available without certifying their claims.
  Content checks detect unlocated evidence, missing citations, safe placeholders,
  target wording, generic prose, and unsupported terms, metrics, or outcomes.
  Those issues return usable text with warnings and never trigger repair. A
  citation grounds its whole entry (the resume entry's other bullets and the
  Profile section whose heading names it), and a value only the candidate's own
  base letter supports is returned with a warning naming it. Technical issues,
  including unusable paragraphs, unsafe markup, a template slot id the source
  never had (a cited deterministic role or company slot is dropped, not
  repaired; a cited unanswered private slot is returned as a warning on its
  paragraph), correspondence assembly defects, and resource limits, may trigger
  one repair. Repeated technical failure returns `422`, `status: "blocked"`,
  `reason: "technical_checks"`, and at most eight display-safe issue records.
  Internal repair instructions and rejected provider bodies never reach the UI.
  A usable response is staged as a fingerprinted proposal: **Accept proposal**
  applies it, **Discard proposal** does not mutate the editor, and stale content
  identity prevents applying to another document. Resume-only changes retain the
  proposal with an earlier-resume warning. The response carries two bounded
  lists: `concerns` (claim findings about the wording: unsupported terms,
  numbers, outcomes, ownership, employer claims, conflicting or base-letter-only
  evidence, attribution, and a cited unanswered private slot, plus echoed
  `sourceWarnings`) and `warnings` (this draft's structure, quality, citation
  bookkeeping, leftover template tokens, phrasing, length, and, last, up to
  three model notes prefixed `Model note:`, read from the model's optional
  `warnings` field; malformed metadata is ignored). The review rail shows both;
  after acceptance only the `concerns` carry into the next request with an
  earlier-wording label, while draft warnings are recomputed, so a corrected
  length, bracket, or citation never recurs. Model notes are display-only: they
  are stripped from the repair prompt's rejected output and never carried into a
  later request. Restore follows the editor's own snapshot lifetime.
  The 180–420-word preference is advisory. Employer facts use employer evidence;
  implied candidate experience still goes through candidate checks. Equivalent
  word/digit durations receive the same support check.
  Historical batch `/api/application-answers` retains each usable answer/role description with item
  warnings for unsupported claims or wrong-entry attribution. Wrong question/role
  bindings and unsafe structures still fail. Both routes accept bounded
  `sourceWarnings` for known uncertainty in earlier Resume wording and carry them
  into prompts and results. This propagation does not verify the source. Both
  echo resolved `provider`, `model`, and `reasoningEffort`, never credentials.
  Answers chat uses `mode: "conversation"` and
  `server/ai/applicationAnswerConversation.ts`: exact question identity/revision,
  selected resume, whole Profile, edited job brief, original posting, and explicit
  user facts are supplied once per turn. Previous answer text is editing context,
  never factual evidence; current cover-letter prose is not included. Prompt v4
  (the benchmarked v3 writing guidance plus an input firewall naming the Answers
  sections, which `prompts.ts` also fences)
  favors the smallest requested edit, preserves supporting responsibility, and
  avoids unasked lessons, pitches, disclaimers and padding. Oversized inputs fail visibly (question 12,000,
  answer 16,000, refinement 4,000 characters); the route does not truncate.
  One generation and at most one formatting repair share deterministic counts
  with the UI and persistence. A hard-limit failure stays a draft; content
  concerns remain advisory. Metadata carries the resolved model/effort, attempts,
  prompt version and SHA-256 source fingerprints, without duplicating source text.
  Necessary missing facts return a separate clarification; a repair that asks
  one instead keeps the draft text. Bracketed or doubled-brace placeholders keep
  an answer a draft. The explicit Save operation appends the exact revision
  through the normal application mutation queue; initial saves create one Draft
  without a submission date. Stored revisions are shape-checked on load, so a
  later count or limit rule never invalidates a tracker; reconcile verifies a
  new revision's limits and counts against the current rules.
- resume input into the structured editor: pasted resume text is parsed once into
  `ResumeData`, the source of truth thereafter; a previously saved `.resume` file
  loads its `ResumeData` directly. The file picker accepts only `.resume` (no DOCX,
  LaTeX, PDF, or plain-text file import).
- job posting import (`/api/import-job`, `server/jobImport.ts`): fetch a public posting URL —
  Workday CXS JSON when the host is recognized (`*.myworkdayjobs.com`,
  `/job/` and `/details/` links), Ashby's public posting API for direct board
  URLs, approved branded `ashby_jid` wrappers, and branded pages that embed
  exactly one Ashby board, Greenhouse canonical job HTML for direct
  board URLs and branded wrappers that expose a numeric `gh_jid` plus a
  validated board slug in their HTML, Oracle candidate-experience requisition
  details, the iCIMS job frame, Dayforce page data, Workable's public posting
  API, UKG opportunity data, LinkedIn visible job body + criteria rows,
  otherwise generic HTML→text, replaced by a bound schema.org JobPosting when
  that text is unreadable or lacks the posting — behind SSRF
  guards that re-validate the host and resolved IP on every redirect hop
  and reject private / loopback / link-local targets. A recognized source
  whose selected job is missing fails with paste/extension guidance instead
  of importing a board, login, or careers page. Job-analysis calls use
  `/api/job-analysis` (below); the deterministic `src/lib/jobExtract.ts` engine
  supplies the local parsing baseline and the inspectable failure brief. RoleFit then splits the result
  into compact model-facing tailoring text and tracking-only facts (role
  summary, company, location, job type, work-auth note, compensation). The
  model-facing job-description field is a structured brief with Job Title,
  Company/Product Context, Core Responsibilities, Required Qualifications,
  Preferred Qualifications, Tech Stack/Keywords, Seniority Signals, and Domain
  Signals. Prepare adapts those fields plus the retained raw source into its
  complete editable review brief, including benefits and deterministic
  extraction gaps. Benefits remain review context and are not added to
  the Resume Polish prompt. Apply persists that complete review brief and the
  immutable captured posting separately; reopening reconstructs the same
  editable/model-facing projections. The link itself is kept only for pipeline
  tracking and is never sent to the AI.
- AI job analysis (`/api/job-analysis`, `server/ai/jobAnalysis.ts`): sends the
  raw (tag-stripped) posting text to the Job analysis provider and returns
  the SAME structured fields the deterministic engine emits, resolved
  semantically so novel ATS layouts, inline-prose duties, and unusual
  headings parse where the regex heading tables can't. The model owns extraction,
  summaries, and qualification classification. The server normalizes strings,
  lists, enums, and finite salary numbers, strips markup, and enforces bounds.
  It does not compare fields against the posting, replace generated conditions,
  or produce evidence warnings. Missing currency or salary-period metadata stays
  unspecified. Historical job-warning metadata remains readable in saved records
  but is not displayed or included in drafting context. The original captured
  posting remains separate from the editable brief. The source URL is never sent
  to the model (it can carry private ATS tokens, so only posting text is forwarded).
  The client (`src/lib/aiJobAnalysis.ts`) always calls the configured Job analysis
  provider after publishing the deterministic local brief. Combined analysis and
  reassessment pass through one private request boundary that owns JSON decoding,
  HTTP and network error translation, abort propagation, and mode-specific response
  validation. When the request fails, that local brief remains editable and manual
  Polish stays available.

### Fit Assessment integration boundary

The canonical prompt, structured-output, source-checking, provider, request-
identity, and verification contract lives in
[`server/ai/README.md`](../../server/ai/README.md#fit-assessment-technical-contract).
At the server boundary, combined Job analysis and reassessment remain modes of
the same guarded `/api/job-analysis` handler. Managed credentials remain server-
side, and the response may echo resolved provider/model/reasoning provenance and
dispatch attempts but never an API key.

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
  (GET) reports `{status:"preparing"}` while preparation runs, then hands only
  `{text, url}` to the claiming app tab once before clearing it. The tab requests
  provider-backed Job analysis with its selected provider after publishing its
  local brief; if that request fails, the deterministic brief remains usable
  and manual Polish stays available. Extension imports include a short
  `claimToken` and open a fresh app tab with that token and its own `tabId`, so
  a new posting starts a new independent preparation session instead of
  replacing an existing tab's job. The first progress or delivered-posting
  callback selects Prepare before updating intake state, and extension intake
  stops there after Job analysis and the duplicate gates. `extensionImport`,
  `claimToken`, `tabId`, and the `"preparing"` progress token remain stable;
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
  the base resume or calculates a local fit estimate. Fit Assessment runs only
  inside the app against its selected resume. RoleFit does not
  create or persist a detailed numeric fit score.
- workspace file storage under the host-supplied `workspaceDir` (auto-load,
  upload, save, reload; source development defaults to `workspace/`,
  while packaged runs use `app.getPath("userData")/workspace/`).
  Resume and cover-letter histories live beside their variants under
  `resumes/.trash/` and `cover-letters/.trash/`.

Deterministic keyword and mechanical resume analysis live in focused client
helpers under `src/resume/` and `src/resumeEngine.ts`. They may describe text or
evidence, but never calculate a fit score or verdict. Keep that logic and
model-backed judgment out of `server.ts` orchestration.

When a workflow grows, split it into focused helpers (file readers,
provider clients, request handlers) rather than packing more code into
one large route.

The resume AI flows follow that rule — they are split across focused
modules under `server/ai/` so no single file carries the whole pipeline:

- `resumePolish.ts` — the `handleResumePolish` route for the sole
  `mode: "resume-proposal"` request. It normalizes the editable scope and
  dispatches `resumeProposal.ts`; cover letters and answers have dedicated
  routes and cannot enter this handler.
- `resumeScope.ts` — defensive normalization and plain-text serialization for
  the structured editable resume scope.
- `resumeProposal.ts` and `shared/resumePolishContract.ts` — flat target
  construction (with category labels locked and `skill-list` semantics), the
  compact one-pass prompt/wire contract, deterministic per-edit grounding, and
  Proposal / No changes / Withheld derivation.
- `providers.ts` — provider identity + per-request config resolution
  (`normalizeProvider`, default provider/model, provider-specific key lookup,
  and `resolveProviderRequest`).
- `clients.ts` — the outbound provider clients (OpenAI Responses and
  Anthropic Messages), CLI dispatch, and the
  `callConfiguredProvider` dispatch.
- `prompts.ts` — every system/user prompt and the shared
  honest-tailoring / anti-fabrication rule helpers (also imported by
  `applicationAnswers.ts`). Untrusted text (job description, resume,
  candidate Profile, custom instructions, pass-1 output) is interpolated
  through `fenceUntrusted`, which neutralizes literal fence-tag
  look-alikes so pasted content cannot escape its `<job_description>`-style
  delimiters; the input-firewall rule tells the model fenced content is
  data, never instructions. Prompt budgets are structural: clip individual
  fields/arrays before `JSON.stringify` (or parse, shrink, and re-serialize),
  never character-slice serialized JSON into an invalid payload.
- `sanitize.ts` — shared markup and numeric-claim guards used by the current
  Resume Polish, Cover Letter, and Application Answers flows.
  The markup gate allows exactly the editor's inline-mark vocabulary
  (`<b>`/`<i>`/`<u>`, no attributes) because formatted bullets carry those
  tokens in `currentText` and a faithful suggestion echoes them; all other
  tags, LaTeX commands, and newlines still reject. Resume-specific proposal
  sanitization lives beside its wire contract in `resumeProposal.ts`, which also
  rejects a replacement whose entire body is inline marks (`<b></b>`) — balanced,
  so the shared tag gate passes it, but accepting it would blank the field. It
  owns the `boldBulletKeywords` preference: when it is off the prompt keeps `<b>` in
  the preserve list but forbids it in a bullet replacement, and the sanitizer
  strips `<b>` from every `bullet` replacement, so a model that bolds anyway
  still yields an unbolded bullet. Only bold is affected; `<i>` and `<u>` pass
  through untouched. Scoping matters in both layers — a rule that dropped
  `<b>` from the preserve list outright would invite the model to strip a skill
  list's existing bold, which nothing downstream would catch. An absent flag
  means an older client and keeps the marks; a present non-boolean is rejected
  with 400 rather than coerced, because either coercion would silently decide a
  preference the user owns. Both sides of the unchanged comparison are stripped
  the same way, so turning the preference off never proposes a bold-only edit.
  Those drops settle as `NO_CHANGES`, not `WITHHELD`, when the provider supplied
  a valid non-Withheld status: UNCHANGED means the model returned text the resume
  already has. An explicit `WITHHELD` status remains withheld, and one safety
  drop beside an echo also raises the withheld card. `withheld.count` carries
  only technical safety drops, so the rail never counts content warnings or
  an echo as unusable edits; `withheld.reasons` still lists UNCHANGED as the
  diagnostic record. A response longer than the examined window cannot settle
  as `NO_CHANGES`,
  because its tail was never read; each beyond-window change is recorded as a
  malformed safety drop. Every change in the window is examined (rewrites, then
  removals, reorders, and additions, so conflicts resolve the same way), and the
  wire cap keeps the first 12 usable changes in the model's own order: when more
  are usable, the prefix up to the twelfth is examined again without the cut
  tail, repeating until stable, so a change the cap cuts can never have won a
  conflict against one listed earlier. The prompt states that limit and asks for
  the most valuable changes first, so an addition the model listed first
  survives twelve rewrites. The kept set is still emitted rewrites, removals,
  reorders, then additions. The never-examined tail is reported with the
  omission warning, not as withheld. `stripBoldMarks` is
  case-insensitive and re-collapses whitespace on purpose: the markup gate
  accepts `<B>`, and removing a tag can join the spaces around it.
  Content checks warn when proposed terminology lacks support in the target's
  evidence; model-authored rationale is not independent proof. The client derives
  a separate preservation advisory from current accepted decisions, a supported
  baseline, and the current job/document identity. Required/preferred terminology
  uses prepared-job distinctions before flat keyword limits. True aliases differ
  from related concepts, and negated or uncertain text does not establish support.
- `fitAssessment.ts` — executable prompt, response schema, and bounded source/relationship validation
  for the [Fit Assessment technical contract](../../server/ai/README.md#fit-assessment-technical-contract).
  Safe model summary text is retained with evidence warnings when needed; fixed
  summary copy is used only when no model summary was supplied.
- Candidate facts reach the model only through `candidateContext`. The client's
  `buildCandidateFactsContext` (`src/lib/candidateFacts.ts`) prepends declared
  citizenship, work authorization, sponsorship, education level, field of
  study, optional 4.0-scale GPA, and earliest-start availability to the Profile
  Background (stored as `profileBackground`), and that combined string is
  what the grounding allowlist is built from. `shared/candidateProfileContract.ts`
  owns the one length contract, measured as the longer of the raw and
  NFKC-normalized length: the Background is at most 12,000 characters, every
  stage that sends candidate context declines above it on the client, and
  servers reject (never slice) a merged string above 13,000 before any provider
  call. In a combined Prepare request an oversized Profile skips only Fit. Every field is therefore opt-in
  by construction: an unset value contributes no line, so an undeclared
  citizenship, clearance eligibility, degree, GPA, or start date can never
  become groundable wording. Citizenship, work authorization, and sponsorship
  are independently declared; citizenship never contributes clearance or
  employment-eligibility wording. Education level gates the field of study and
  GPA; a specific availability
  date must be a real ISO calendar date. Any new fact added there widens the
  allowlist and needs the grounding/sanitizer probes re-run.
- `grounding.ts` — deterministic JD-term grounding helpers used by the
  sanitizers. Proposed-text checks compare normalized JD terms against the
  submitted resume scope and candidate Profile; unsupported JD-only terms produce
  visible warnings without preventing acceptance. Treat the
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
registry. Settings > Models holds a separate config per stage and shows only
providers the user explicitly added: `/api/job-analysis` receives the Job analysis config,
`/api/resume-polish` receives the Resume Polish config as `provider` / `model` /
`reasoningEffort`,
`/api/cover-polish` receives the Cover letter Polish config, and
`/api/application-answers` receives the Application questions config. Each stage
uses one name for its stage id, settings prefix, and route (for example
`cover-polish`, `coverPolishProvider`, `/api/cover-polish`); settings saved
under the pre-2026-09-29 names convert once in `migrateStoredSettings` before
strict validation. `src/lib/stageSettings.ts` owns task-specific startup defaults;
explicit saved choices remain authoritative. A model-only saved selection keeps
the earlier implied Claude CLI provider, so changing a stage's default provider
cannot create an incompatible pair. Final application review retains its one-time
Fit inheritance when first introduced; other stages seed independently.
Workspace settings drop retired preview keys during
strict normalization, and portable workspace preferences carrying them fail
closed. Each stage persists the keys declared by `src/config/aiStages.ts`.

`customInstructions` is resolved PER STAGE in the browser before the request is
sent: a stage with its own non-blank override sends that text, otherwise it sends
 the shared instructions. Resume Polish is one proposal request (the opt-in
review runs inside it). Its prompt
 performs the internal evidence, claim, identifier, and schema audit before
 returning, with breadth adapted to the selected reasoning effort. The server
 contract remains one `customInstructions` string per request.

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

### Model catalog receipt — 2026-09-30

GPT-6.1 Sol (`gpt-6.1-sol`) joins Codex and OpenAI API, and Claude Sonnet 5.5
(`claude-sonnet-5-5`, released 2026-09-28) joins Claude CLI and API. They become
the Codex and Claude defaults for new or unset stages and the server fallback.
Saved selections, including GPT-6 Sol and Sonnet 5, stay selected; no
migration moves them. Retired Codex ids now repair to GPT-6.1 Sol.

- GPT-6.1 Sol is list-visible in the provider-reported Codex catalog (client
  0.159.0, fetched 2026-09-30) with low through ultra, which the picker follows.
  The Codex models page still calls Ultra "coming later", and older Codex
  clients do not list the model. It is rolling out to Plus, Pro, Business,
  Enterprise, and Edu, and is off by default for Enterprise and Edu until an
  administrator enables it. On the API, GPT-6.1 Sol succeeds GPT-6 Sol and keeps
  GPT-5.6's API capabilities; RoleFit's Responses body is unchanged.
- Sonnet 5.5 supports low through max in Claude Code, which requires 2.1.284+;
  Claude Code 2.1.285 and Codex CLI 0.159.2 were observed on 2026-09-30. Without
  tools, `between_tools` returns only text, as `disabled` did on Sonnet 5. On
  the API it rejects
  `thinking: {type: "disabled"}`, so RoleFit sends `between_tools`, its lowest
  setting. That setting is accepted at the model's default `high` effort, and
  RoleFit sends no effort for it. Non-default `temperature`/`top_p`/`top_k` are
  rejected; RoleFit sends none.

Sources: [Codex models](https://learn.chatgpt.com/docs/models),
[GPT-6.1 Sol API guide](https://developers.openai.com/api/docs/guides/latest-model),
[Claude models](https://platform.claude.com/docs/en/models/overview),
[What's new in Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5), and
[Claude Code model config](https://code.claude.com/docs/en/model-config).
Live provider execution was not run.

### Model catalog receipt — 2026-09-27 (defaults superseded 2026-09-30)

`src/config/aiOptions.ts` owns the curated model choices. The provider-reported
Codex catalog (client 0.158.0, fetched 2026-09-27) lists GPT-6 Astra/Sol/Luna,
GPT-5.6 Sol/Terra/Luna, and GPT-5.5. Codex's default is GPT-6 Sol in both the
browser and server fallback. GPT-5.4 and GPT-5.4 Mini retired from ChatGPT
sign-in on August 31; Spark is absent from this visible catalog, which is not
proof of global API retirement. GPT-5.5 is retained with its announced October
14 retirement in the label. API and subscription catalogs have separate lifecycles.
The existing Claude legacy choices have no confirmed retirement in this refresh
and are retained alongside Fable 5.1 and Opus 5.5.

`shared/cliReasoning.ts` owns CLI effort capabilities for the picker, settings,
request validation, and Claude argv. GPT-6 Astra/Sol and GPT-5.6 Sol/Terra support
low through ultra; both Luna models stop at max; GPT-5.5 stops at xhigh. Claude
Haiku has no effort flag, Opus/Sonnet 4.6 omit xhigh, and the other listed Claude
models expose low through max. CLI modes are not assumed to be API parameters.
Model changes reconcile effort in the same state update; startup and persisted
settings use the same helper. Unsupported nonempty efforts are rejected at the
server boundary, except Haiku's obsolete effort is discarded.

Strict workspace and backup parsing permits only known provider-catalog repairs:
the three removed Codex ids move to the current Codex default, and previously
recognized CLI efforts reconcile against a known model. Unknown model ids,
unknown efforts, invalid provider pairs, extra keys, and unrelated invalid fields
remain rejected. Reads do not rewrite the canonical file; the next normal save
persists the repaired selection. Supported choices and independent stages remain
unchanged, and no migration calls a provider.

Claude Opus 5.5 needs Claude Code 2.1.280+; Fable 5.1 needs 2.1.257+.
Publication review observed Claude Code 2.1.283 and Codex CLI 0.157.1;
the Codex shell version is distinct from the app catalog client above. Version
observations do not prove live compatibility or account access. The app
provides update guidance without installing or upgrading either CLI.

Verification: RoleFit app/server/landing builds, desktop contracts, all 122
offline probes, and document-workflow regressions passed. Two independent
reviews found no blocking provider or settings issues, including a synthetic
six-stage hook-switching check and strict migration tests. Live provider
execution and rendered browser QA were
not run. Publication review did not upgrade local CLI binaries or restart the
running companion.

Sources: [Codex availability and retirements](https://learn.chatgpt.com/docs/models),
[GPT-6 API migration](https://developers.openai.com/api/docs/guides/latest-model),
[Claude models](https://platform.claude.com/docs/en/models/overview),
[Claude retirements](https://platform.claude.com/docs/en/about-claude/model-deprecations),
[Claude Code models and effort](https://code.claude.com/docs/en/model-config), and
[Opus 5.5 migration](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide).

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
  local process argument list briefly contains the request. RoleFit submits the
  stable slug from the first column of `agy models`; settings saved by older
  builds migrate their display-name values before dispatch.
- **OpenAI API** uses the Responses API with `store:false` and native JSON mode.
  The catalog includes GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol/Luna, and GPT-5.6
  Sol/Terra/Luna; the balanced default remains `gpt-5.6-terra`.
- **Claude API** uses Anthropic Messages. The call sends no `temperature` and no
  trailing assistant prefill because current Claude models reject those patterns.
  JSON is enforced by the strict-output prompt plus `parseAiJson`. The current
  catalog includes Fable 5.1, Opus 5.5, and Sonnet 5.5 (the default) alongside
  Fable 5, Opus 5, Sonnet 5, Haiku 4.5, and Opus 4.8. Sonnet 5 and Opus 5 default
  to adaptive thinking, so this bounded JSON workflow disables it explicitly.
  Sonnet 5.5 rejects a disable, so it sends `between_tools`, its lowest
  setting, at the default effort. Fable 5/5.1 and Opus 5.5
  require adaptive thinking; their requests use low effort to leave room for
  JSON in the shared reasoning/output budget. Actual model quality and token
  consumption require separately authorized live evaluation.
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

- polish only the provided `resumeScope` sections for the job description
- keep each role to no more than five bullets
- emphasize entry-level SDE / full-stack fit
- strengthen wording and structure
- return normal Resume Polish changes using only the flat target IDs sent by
  the server; composite section, entry, bullet, field, evidence, risk, and
  keyword-hit metadata are not part of this contract
- select oversized target sets before serialization by materiality and job
  relevance, never by a raw JSON slice; reject response ids outside the exact
  selected set and report the separate omitted-target count
- preserve truthfulness — never invent employers, dates, metrics,
  education, tools, or outcomes
- never edit identity, contact, education, standard-entry role/employer/subtitle/date
  fields, Skills category labels, or omitted sections; only bullets (rewrite or
  remove), actual Skills lists, standard-entry bullet orders, and new-bullet
  slots for entries with linked Profile text are mutable
- treat the candidate Profile as optional evidence; when it is blank, rely only
  on the resume
- never import a JD-only skill/tool into the resume or skills section
  without exact evidence in the resume or optional candidate Profile
- omit an edit when material support is missing; do not add drafting
  placeholders or ungrounded gap judgments to the resume workflow
- return up to three concise improvements. The server derives
  Proposal / No changes / Withheld from accepted mutations, and the editor
  remains the final source of truth
- write bullets as engineering accomplishments in plain language — no
  brochure vocabulary, no claims the candidate could not defend in an
  interview, and proposed text stays close to the current field's length
  so the one-page layout survives
- keep the Polish self-audit internal and non-rewriting: it validates evidence,
  claims, identifiers, and output shape before the proposal is returned. The
  deterministic proposal sanitizer remains the final acceptance boundary

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

The cover-letter prompt wording was benchmarked by blinded pairwise judging on
the user's real applications on 2026-10-05/06; a restraint-and-length variant
won on the Claude models and lost on GPT-6.1 Sol, the configured cover model,
so the wording stayed. `server/ai/AGENTS.md` records the trade-off.

These are prompt-quality inputs, not permission to fabricate. The shared
truthfulness, source-attribution, grounding, and sanitization rules remain
authoritative.

The deterministic job analyzer (`src/lib/jobExtract.ts`) is Prepare's immediate
usable baseline. Job analysis may improve it, but an AI-backed failure leaves
the baseline editable and does not block manual Polish. Fit Assessment is advisory
and independently unavailable when its provider output is unusable. Resume
Polish, cover-letter tailoring, and application-answer failures have no local
substitutes; no locally generated draft, score, review, or verdict stands in.

## Resume PDF Import

Product contract: [PRODUCT.md › Resume PDF import](../../PRODUCT.md#resume-pdf-import).

- **Local reading.** The browser reads the PDF with the contract-pinned
  `pdfjs-dist` (configured once in `src/lib/browserPdfjs.ts`) and builds the
  draft in `src/resume/pdfImport/`. No request is made and no workspace file is
  written; the server is not involved until the user saves.
- **`POST /api/resume-import`** (`server/ai/resumeImport.ts`) runs only from the
  review's Interpret action, on the Resume import stage's own provider, model,
  and effort, with one dispatch and no repair. The body carries the provider
  fields plus `lines`: page, region, x, size, bold, italic, a marker flag, and
  the line's text pieces (`p<N>` ids). `shared/resumeImportContract.ts` refuses
  malformed or oversized lines (400) before provider resolution: at most 1,500
  lines, 3,000 pieces, 2,000 characters per piece, and 40,000 characters in all.
- **Reply contract.** The model returns `{name, contact, sections}` whose
  leaves are piece references (`"p12"` or `{"piece": "p12", "text": "exact
  substring"}`), never text. An unsent piece, a substring not found verbatim in
  its piece, an unknown section type, or an oversized reply rejects the reply
  (422, user-safe message, local reading kept). Unknown fields are ignored.
  The PDF text travels only inside the registered `resume_source_lines` fence.
- **Client checks.** The browser validates the reply again against the lines it
  sent, rebuilds the document from its own pieces, and requires the same
  preservation audit as the local import (no character lost, none added or
  duplicated); text the reply leaves out is listed as Not placed. Stop aborts
  the request and the CLI subprocess; a late or stale reply is dropped.

## Job Posting Import

Keep the import pipeline split by responsibility:

- `server/jobImport.ts` recognizes sources, builds fixed public targets, and
  sequences fetches, caches, and HTTP outcomes; `server/jobImportContent.ts`
  is the pure HTML→text converter and exact-posting parser for every source.
  `server/network.ts` performs each public fetch, enforces timeouts and the
  byte cap, and applies SSRF checks on the original URL and every redirect hop.
- Selection is exact: an API item, page-data object, or JobPosting must match
  the requested job id, URL selector (whole path segment or selector value, not
  a slug fragment), or canonical requisition, and ambiguity fails. The
  Greenhouse embed and iCIMS frame are bound by their request target (board +
  token, same-origin same-id frame), not re-checked in their content.
  Structured page data is parsed with `JSON.parse` only — never evaluated.
  Follow-up targets are fixed same-origin or provider API URLs, never
  page-supplied endpoints.
- A direct Ashby board that omits the job, answers 404/410, or exceeds the
  byte cap falls back to that exact job page's bound JobPosting. Only the
  byte-cap error (`ResponseTooLargeError`) is caught; every other network
  rejection propagates. A provider's other non-OK status (rate limit, outage)
  is reported as that HTTP status rather than as a missing job.
- URL import fails a recognized source without its selected JD. Extension
  enrichment uses the same recognized-source resolution but keeps the
  captured page text on any failure and never substitutes a generic scrape.
  A source-reported closed opportunity keeps its public JD with a
  `Status: Closed` line; JD presence does not imply the opening is active.
- Known import limits (2026-10-01 audit), all of which fall back to paste or
  extension capture:
  - Unrecognized pages are accepted on readable text alone (≥200 chars, not
    code-shaped). A careers or cookie/navigation shell without a bound
    JobPosting can still pass; there is no universal page classifier.
  - A branded `gh_jid` page without Greenhouse board evidence stays a generic
    import, so a careers shell there is not detected.
  - A non-Greenhouse URL carrying `gh_jid` plus `for`/`board` fails when the
    embed lacks the job instead of falling back to the page.
  - Not imported: LinkedIn sign-in pages and rate limits (no guest endpoints
    or authentication), Workday tenants whose CXS API answers 403, sites that
    serve challenge shells or 403 (for example IBM and Indeed), client-rendered
    boards without a constrained public source (for example Gem, Eightfold,
    TEKsystems), JobPosting data on a 404 page or bound to another posting,
    and postings removed from their board.
  - Oracle recognition covers `*.oraclecloud.com` plus one observed branded
    origin; other branded Oracle origins stay generic.
- `src/lib/jobExtract.ts` is the dependency-free analyzer. It should keep
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

Job analysis should stay conservative: do not cut trailing boilerplate until
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
  the source of truth. Pasted resume text is parsed once into that model; PDF-only
  sources must be pasted as extracted text. Resume File Open accepts only `.resume`;
  there is no DOCX, LaTeX, or plain-text Resume file import/export.
- `.resume` is the portable save format for resume data: the sole strict shared
  Typeset v1 envelope
  (`{ format: "typeset-resume", schemaVersion: 1, document, style }`). Portable
  file downloads and uploads stay client-side; workspace variants use the local
  loopback routes and the same strict codec. Runtime boundaries reject retired
  wire shapes; private pre-release data must already be rewritten before the
  current app reads it. The
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
  the same row changed in another tab. The tracker holds at most 2,000
  applications (`MAX_APPLICATIONS`). The server keeps the last fully validated
  `applications.json` in memory while the file's identity (device, inode,
  size, mtime, ctime) is unchanged, re-validating after any outside change or
  restore, and names each validated state with an in-memory `revision`: GET
  answers `304` to `If-None-Match` for the current revision, and a PUT whose
  `baseRevision` matches gets only its upserted rows plus the id `order`
  (otherwise the full tracker, which the client adopts as-is like a GET). A
  write is cached only when stat shows the renamed file as its own (same
  device, inode, size, mtime); otherwise the cache is dropped and the response
  carries no revision. Stat cannot observe a same-size in-place edit within one
  file timestamp tick (up to 15.6 ms on Windows) of RoleFit's own write or
  validated read. Every RoleFit writer replaces the file or drops the cache, so
  only a foreign in-place writer acting within that tick can be missed; a
  writer racing RoleFit that closely can already lose an edit to a save's own
  rename. Backup validates the exact `applications.json` bytes it packages.
  Creation/update timestamps are required
  canonical ISO values, and an existing upsert must advance `updatedAt`
  strictly after its matched revision. Retired tracker fields, dual
  source-and-PDF artifact claims, duplicate ids, corrupt application JSON, and
  malformed strict `.resume` data fail closed with a user-safe error; never
  silently replace them with an empty store or guessed document.
- On startup, the server discovers `resumes/<variant>.resume`, loading
  `resumes/default.resume` first when present, then named variants. It migrates
  no retired root-level document layouts and falls back to the bundled
  `server/starter.resume` when no base exists.
  Legacy `.txt`, `.md`, and `.csv` base resumes remain untouched on disk and in
  backups, but are not opened or offered as restorable editor history.

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

Final review and Fit v7 compact-response and evidence boundaries are specified in the [AI runtime contract](../../server/ai/README.md). The `/api/application-review` endpoint is read-only and uses a single explicit provider dispatch.
