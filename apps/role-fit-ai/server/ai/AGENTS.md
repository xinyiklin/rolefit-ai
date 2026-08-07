# RoleFit AI Runtime Guide

Applies to `apps/role-fit-ai/server/ai/` and `server/ai-cli/`. Prompt and
sanitizer code is executable product behavior and anti-fabrication-critical.

## Module ownership

- `providers.ts` resolves provider identity, defaults, credentials, models, and
  reasoning effort.
- `clients.ts` owns native API/CLI dispatch. `server/ai-cli/` owns subprocess
  invocation and provider-specific process constraints.
- `prompts.ts` owns fenced input construction and truthfulness/output rules.
- `sanitize.ts` validates suggestions and Review output; it does not invent or
  recalculate a replacement judgment.
- `polish.ts` orchestrates Tailor and Review; its optional cover leg is retained
  only for compatibility with older clients.
- `jobAnalysis.ts`, `coverLetter.ts`, and `applicationAnswers.ts` own their routes.
  Cover-letter tailoring is **one call**. It requires the candidate's source
  letter and the evidence corpus derived from their own resume, notes, and
  answers; it never generates from resume/job inputs alone. The route shares
  deterministic preflight with the browser, returns `422 needs_input` before
  provider dispatch only for a genuinely unresolvable fact, and cannot return
  `ready` with template tokens or unresolved correspondence fields.
- `grounding.ts` and `eligibilityLexicon.ts` provide deterministic evidence
  checks, never a local fit-scoring system.
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

## Trust and assessment contract

- Initial Fit owns the categorical candidate-fit verdict, confidence,
  requirement ledger, eligibility result, and advisory recommendation. Review
  owns only post-polish document readiness. Validate exact shape, enums,
  evidence references, and semantic consistency; reject invalid output instead
  of synthesizing a replacement.
- Every requirement carries and displays its exact `sourceRequirement` excerpt
  from the posting, and every candidate evidence excerpt must be a normalized
  exact source quotation. Source excerpts are unique within each ledger, and
  eligibility rows cannot reappear as capability requirements. Derived
  requirement lists may cover all 40 rows; only independent advice lists keep
  the 16-item cap.
- Initial Fit `MISSING` requires explicit adverse evidence or a deterministically
  anchored minimum-years mismatch while `UNCERTAIN` has none. Sponsorship
  polarity is evaluated around each sponsorship clause. Submission visibility
  may retain `HONEST_CONTEXT` evidence for a `MISSING` row only when non-adverse,
  relevant evidence positively proves the qualification can be surfaced.
  Eligibility never changes the fit verdict, and only unresolved eligibility
  may recommend `CONFIRM_ELIGIBILITY`.
- User-facing assessment prose derives from the validated ledger wherever
  possible. Remaining Review advice must pass technology, proper-claim,
  numeric, and outcome grounding before it can be returned.
- Tailor emits targeted suggestions grounded in submitted resume/honest context.
  Never import JD-only skills or fabricate claims.
- Review-only audits the current edited draft. The Review leg of Both receives
  only sanitized suggestions from that same Tailor run.
- A failed stage fails plainly and stops downstream work. Job analysis may return a
  deterministic local brief to the client for inspection, but that does not
  convert the failed AI stage into success.
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
