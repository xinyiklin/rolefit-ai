# RoleFit AI Runtime Guide

Applies to `apps/role-fit-ai/server/ai/` and `server/ai-cli/`. Prompt and
sanitizer code is executable product behavior and anti-fabrication-critical.

## Content and evidence policy

The [canonical product policy](../../PRODUCT.md#content-and-evidence-warning-policy)
requires content/evidence failures to preserve otherwise usable output with
warnings across all RoleFit generation, analysis, assessment, and review paths.
Keep truthful prompts and existing checks; do not add an AI analysis stage or
policy engine. Unknown source references or unconfirmed excerpts are evidence
warnings, never verified citations or links to unrelated sources. Invalid edit
targets, unsafe markup, unusable structures, unauthorized mutations, and stale
application retain blocking technical guards.

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
  contract: both paths render one exported rules block and request exact
  current-source excerpts. Unlocated references and explicit conflicts remain
  visible as warnings; safe conclusions and summary prose are preserved.
  The model owns semantic judgment; no requirement ledger, completeness gate,
  deterministic verdict calculation, or guessed fallback is permitted.
  Cover-letter tailoring is one operation over the source letter and candidate
  evidence. Shared preflight requires a prepared role/company and a usable resume
  corpus; a missing candidate name or private fact is advisory. Safe placeholders
  remain usable text with warnings. No additional evidence-planning stage exists.
- `grounding.ts` and `eligibilityLexicon.ts` provide deterministic evidence
  checks. The direct category rubric in `fitAssessment.ts` is provider-applied; do
  not add a deterministic fit classifier, numeric scores, or a visible/persisted
  ledger.
- Evidence selection belongs to the model, not to the candidate and not to a
  prompt-enforced count. The server sends the whole corpus, verifies the ids
  that come back, and reports provenance. Do not reintroduce a preparation plan,
  a use/skip classification pass, or a selected-evidence request field.
- Cover-letter validation separates content findings from technical defects.
  A usable body returns `ready` with warnings without repair. Unusable structure
  may receive one silent repair; a repeated technical failure returns bounded
  user-safe issues and leaves the editor unchanged. Never expose internal repair
  instructions or treat source-id location as factual verification. Acceptance
  remains a client-side boundary, not another server stage.
- Unfinished Guidance prompts are not evidence. Filter unresolved bracketed
  context in the browser corpus builder and independently at the server request
  boundary. Numeric grounding normalizes equivalent digit and word durations
  (for example, `3 years` and `three years`). A duration absent from candidate
  evidence must produce a warning, not discard usable text.
- A pure employer fact may stay outside the candidate-claim surface, but an
  employer-led sentence that compares the employer with candidate experience or
  implies a candidate background remains inside the grounding checks. Grammatical
  subject alone is not an evidence exemption.
- Bracketed slot text is a drafting instruction, never candidate evidence and
  never voice. The model may legitimately leave a slot unused. Optional private
  facts can be flagged but must not require user input before usable output
  proceeds; they do not become operational requirements merely by appearing in
  a template.
- Length is a warning, never a gate. Do not restore a word-count or
  verbatim-source-phrase acceptance check: both reject genuinely better letters.
- `json.ts` and `errors.ts` own response parsing and user-safe failure mapping.

## Trust contracts

- Resume Polish prompts require suggestions grounded in the submitted
  resume/honest context; never instruct JD-only skill insertion or fabrication.
  Only bullets and actual Skills lists are mutable targets; category labels and standard
  entry role, employer, subtitle, and date fields remain read-only evidence.
  Unknown/duplicate targets and unsafe or unusable mutation structures retain
  technical guards; unchanged text remains a no-op. Unsupported edits,
  category-like text in actual Skills targets, unfinished placeholders, and
  feedback concerns remain reviewable with warnings. Withheld counts describe
  invalid/unusable operations, never content concerns or unchanged echoes.
  Changes beyond the bounded response window remain disclosed as malformed.
  Proposal decisions include run identity; supported-term preservation compares
  actual accepted edits with the current document, job, and supported baseline.
  True aliases can preserve a mention; related tools never establish support.
  Keep this advisory separate from Fit, without a score or coverage guarantee.
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

## Evidence-grounding ownership

- `shared/evidencePolarity.ts` owns clause-level polarity for client and server.
  `claimEvidence.ts` and `jobConditionEvidence.ts` own claim and job-condition checks. `fitEvidence.ts` catches focused explicit conflicts;
  do not expand it into a lexical proof of semantic support or a second classifier.
  Fit is advisory: leave tool coverage and responsibility/ownership judgments to
  the model. Retain citation integrity, polarity, and explicit experience-source
  restrictions without importing document-generation word-matching gates.
- Resume replacement checks detect unfinished tokens and unsupported atoms;
  content-only failures become warnings. Complete
  target enumeration precedes budgeting. Optional structural advice is separately
  validated and never changes the document. Education uses the shared RoleFit
  classifier; credential-shaped titles stay locked even under mixed headings.
  Each selected entry is serialized once; targets reference its stable identity.
  Do not require auxiliary claim records or literal paraphrase proof after actual
  replacement checks pass. Advice is editorial guidance, not replacement text.
- `coverLetterParagraphEvidence.ts` checks explicit factual conflicts against
  paragraph-cited sources, narrowing to explicitly named work when identifiable.
  Employer claims use employer evidence. Run one typed factual pass per claim;
  explicit affiliations need candidate evidence, but generic capitalization is
  not proof of an invented name. Do not require sentence bindings or literal
  wording for paraphrases; ambiguous attribution is advisory, not repair.
- Job headings and category concerns inform source-linked advice, never a second
  semantic classifier. Preserve explicit conditions and negation; ordinary duties
  may remain concise even when they contain must or bonus.
- `applicationReview.ts` permits exactly one dispatch, local findings on failure,
  and no persistence. Posting-only evidence cannot authorize candidate revisions;
  current-document references expose conflicts, not independent factual support.
