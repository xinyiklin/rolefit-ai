# RoleFit AI Runtime Guide

Applies to `apps/role-fit-ai/server/ai/` and `server/ai-cli/`. Prompt and
sanitizer code is executable product behavior and anti-fabrication-critical.

## Module ownership

- `providers.ts` resolves provider identity, defaults, credentials, models, and
  reasoning effort.
- `clients.ts` owns native API/CLI dispatch. `server/ai-cli/` owns subprocess
  invocation and provider-specific process constraints.
- `prompts.ts` owns fenced input construction and truthfulness/output rules.
- `sanitize.ts` owns shared deterministic markup and numeric-claim guards. Stage
  modules own their response schemas and outcome derivation.
- `resumeProposal.ts` owns normal Resume Polish: one provider dispatch, flat
  target IDs, deterministic mutation grounding, tolerant optional feedback,
  and truthful Proposal / No changes / Withheld outcomes. Oversized target sets
  are ranked by materiality and job relevance into complete JSON; the response
  is validated only against that selected set and reports the omitted count.
- `polish.ts` accepts only `mode: "resume-proposal"` and routes it to that
  contract. Cover letters and application answers use their own routes.
- `jobAnalysis.ts`, `fitAssessment.ts`, `coverLetter.ts`, and `applicationAnswers.ts`
  own their routes and prompt contracts. Prepare may ask `jobAnalysis.ts` for
  Job analysis plus optional compact Fit Assessment in one provider dispatch only
  when their provider/model/reasoning settings match; otherwise the client commits
  Job analysis before using `mode: "fit-assessment"` with Fit's own configuration.
  Their response subsections sanitize independently. `mode: "fit-assessment"`
  reruns only the compact fit after a relevant input changes. Fit Assessment must
  follow the canonical
  [`server/ai/README.md`](README.md#fit-assessment-technical-contract)
  contract: both paths render one exported rules block, every finding uses exact
  current-source excerpts, and server acceptance stays mechanical rather than
  becoming a second classifier or guessed fallback.
  Cover-letter tailoring is **one call**. It requires the candidate's source
  letter and the evidence corpus derived from their own resume, notes, and
  answers; it never generates from resume/job inputs alone. The route shares
  deterministic preflight with the browser, returns `422 needs_input` before
  provider dispatch only for a genuinely unresolvable fact, and cannot return
  `ready` with template tokens or unresolved correspondence fields.
- `grounding.ts` and `eligibilityLexicon.ts` provide deterministic evidence
  checks. The direct category rubric in `fitAssessment.ts` is provider-applied; do
  not add a deterministic fit classifier, numeric scores, or a visible/persisted
  ledger.
- Evidence selection belongs to the model, not to the candidate and not to a
  prompt-enforced count. The server sends the whole corpus, verifies the ids
  that come back, and reports provenance. Do not reintroduce a preparation plan,
  a use/skip classification pass, or a selected-evidence request field.
- Validation collects typed issues with separate internal repair instructions
  and runs exactly one silent repair request carrying those instructions plus
  the rejected output. A second failure fails closed, returns at most eight
  deterministic user-safe issue records (`code`, `category`, `detail`,
  `recovery`, and optional bounded claim/value fields), and keeps the
  candidate's existing letter; never return the repair instruction, internal
  evidence ids, or rejected provider output. Proposal acceptance remains a
  client-side boundary, not another server stage. Never route a model-authored
  slip into a candidate-facing planning step.
- Unfinished Guidance prompts are not evidence. Filter unresolved bracketed
  context in the browser corpus builder and independently at the server request
  boundary. Numeric grounding normalizes equivalent digit and word durations
  (for example, `3 years` and `three years`) while still rejecting a duration
  absent from candidate evidence.
- A pure employer fact may stay outside the candidate-claim surface, but an
  employer-led sentence that compares the employer with candidate experience or
  implies a candidate background remains inside every grounding gate. Grammatical
  subject alone is not an evidence exemption.
- Bracketed slot text is a drafting instruction, never candidate evidence and
  never voice. Only a slot naming a private fact (a referral, a prior personal
  relationship) may ask the candidate; every other slot is generative, and the
  model may legitimately leave one unused.
- Length is a warning, never a gate. Do not restore a word-count or
  verbatim-source-phrase acceptance check: both reject genuinely better letters.
- `json.ts` and `errors.ts` own response parsing and user-safe failure mapping.

## Trust contracts

- Resume Polish emits targeted suggestions grounded in the submitted
  resume/honest context. Never import JD-only skills or fabricate claims.
  Only bullets and actual Skills lists are mutable targets; category labels and standard
  entry role, employer, subtitle, and date fields remain read-only evidence.
  Unknown, duplicate, unchanged, malformed, or unsupported edits are dropped
  independently. A category phrase or unsupported new list item is dropped
  without erasing safe siblings.
  Optional summary/gap failures never erase safe siblings, while an all-drop
  returns Withheld rather than a successful empty proposal.
- Polish failures fail plainly without changing the document.
  Job analysis and Fit Assessment failures are advisory to Prepare: the local brief
  remains usable, invalid fit never invalidates valid job fields, and neither
  failure authorizes silent fabrication or a substitute AI result.
- Propagate request cancellation into native API fetches and CLI subprocesses.
  Browser disconnect or Stop must terminate matching provider work and never
  advance a later stage.
- Credentials are provider-specific. Supported providers are Claude Code,
  Codex, and Antigravity CLIs plus native OpenAI and Anthropic APIs. Browser
  requests never carry managed API keys: a companion-owned server resolves API
  credentials from its private in-memory snapshot, while standalone/headless
  use may resolve explicit provider-specific `.env` keys. Unknown, removed,
  unconfigured, or unready providers fail closed without a paid fallback.

## Maintainability

- Keep provider quirks in provider clients/CLI adapters, not route orchestration.
- Clip structured fields before serialization; never slice serialized JSON.
- Share prompt rule helpers where behavior is intentionally identical, but keep
  stage schemas and responsibilities explicit.
- Avoid catch-all AI service classes and hidden retry/fallback chains. Response
  provenance and attempt counts must remain explicit.
- Keep errors user-safe but classified: auth, rate-limit/quota, configuration,
  timeout, and generic provider failure are distinct recovery cases.
  Cancellation is silent provider termination plus client Stop state, not an
  error class. Routine logs are shape-only; never include model-supplied target
  IDs, free-form provider/model errors, response fragments, or private inputs.
- Keep deterministic grounding/sanitizing functions separately testable.

## Verification

- Run the server TypeScript gate.
- Run the nearest offline eval under `server/ai/__evals__/`.
- Prompt, grounding, sanitizer, provider-contract, or scoring-contract changes
  require adversarial probes and a diff review before handoff.
- Fit Assessment changes require `fit-assessment-probes.mjs` and
  `fit-assessment-consistency-contracts.mjs`; shared request or lifecycle changes
  additionally require the client request, lifecycle, and intake entry-point
  evals named in the app guide.
- Live provider evals cost tokens and may expose private inputs; run them only
  with explicit authorization and synthetic or approved fixtures.
