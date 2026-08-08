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
- `finalCheck.ts` owns the separate optional current-resume check: one provider
  dispatch, an independent compact contract, deterministic issue grounding,
  partial valid issue survival, and server-derived status. It never returns a
  score, fit verdict, recommendation, or rewrite. Every provider issue carries
  a private exact source excerpt from the current document (Unsupported /
  Clarity) or posting (Missing); each detail must refer to its own anchor, which
  is validated and never returned.
- `polish.ts` accepts only `mode: "resume-proposal"` and routes it to that
  contract. Cover letters and current-document checks use their own routes.
- `jobAnalysis.ts`, `quickFit.ts`, `coverLetter.ts`, and `applicationAnswers.ts`
  own their routes and prompt contracts. Prepare may ask `jobAnalysis.ts` for
  Job analysis plus optional compact Initial Fit in one provider dispatch;
  their response subsections sanitize independently. `mode: "initial-fit"`
  reruns only the compact fit for a changed resume. Initial Fit requires the
  provider to assess up to five material requirements selected from the full
  prepared job and permits at most one provider-added requirement. `quickFit.ts`
  validates exact posting/candidate anchors, caps semantically unrelated evidence,
  and derives the four-category public result and eligibility; the hidden basis
  is never returned or persisted.
  Cover-letter tailoring is **one call**. It requires the candidate's source
  letter and the evidence corpus derived from their own resume, notes, and
  answers; it never generates from resume/job inputs alone. The route shares
  deterministic preflight with the browser, returns `422 needs_input` before
  provider dispatch only for a genuinely unresolvable fact, and cannot return
  `ready` with template tokens or unresolved correspondence fields.
- `grounding.ts` and `eligibilityLexicon.ts` provide deterministic evidence
  checks. The only deterministic fit classifier is the compact category rubric
  in `quickFit.ts`; do not add numeric scores or a visible/persisted ledger.
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
  Only bullets and Skills category labels/lists are mutable targets; standard
  entry role, employer, subtitle, and date fields remain read-only evidence.
  Unknown, duplicate, unchanged, malformed, or unsupported edits are dropped
  independently. Skill labels and lists retain separate semantics, so a label/list
  swap or unsupported new list item is dropped without erasing safe siblings.
  Optional summary/gap failures never erase safe siblings, while an all-drop
  returns Withheld rather than a successful empty proposal.
- Final Check audits the current edited draft only when enabled or explicitly
  rerun. Validate its issue kinds, exact private source anchors, each detail's
  semantic connection to its own anchor, and grounding independently; drop
  malformed siblings, and
  derive READY / REVIEW / NEEDS_EVIDENCE from the surviving issues. Its failure
  is non-blocking and cannot alter Polish or Apply.
- Polish failures fail plainly without changing the document.
  Job analysis and Initial Fit failures are advisory to Prepare: the local brief
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
- Live provider evals cost tokens and may expose private inputs; run them only
  with explicit authorization and synthetic or approved fixtures.
