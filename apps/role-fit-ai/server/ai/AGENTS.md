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
- `distill.ts`, `coverLetter.ts`, and `applicationAnswers.ts` own their routes.
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
- Validation collects repairable violations and runs exactly one silent repair
  request carrying them plus the rejected output. A second failure fails closed,
  returns only deterministic user-safe blocker records, and keeps the candidate's
  existing letter; never return the rejected provider output. Proposal acceptance
  remains a client-side boundary, not another server stage. Never route a
  model-authored slip into a candidate-facing planning step.
- Bracketed slot text is a drafting instruction, never candidate evidence and
  never voice. Only a slot naming a private fact (a referral, a prior personal
  relationship) may ask the candidate; every other slot is generative, and the
  model may legitimately leave one unused.
- Length is a warning, never a gate. Do not restore a word-count or
  verbatim-source-phrase acceptance check: both reject genuinely better letters.
- `json.ts` and `errors.ts` own response parsing and user-safe failure mapping.

## Trust and scoring contract

- The selected Review model owns coverage, scores, verdict, reason, gaps, and
  recommendation. Validate exact shape, enums, bounds, and score/verdict band
  consistency; reject invalid output instead of recomputing it.
- Tailor emits targeted suggestions grounded in submitted resume/honest context.
  Never import JD-only skills or fabricate claims.
- Review-only audits the current edited draft. The Review leg of Both receives
  only sanitized suggestions from that same Tailor run.
- A failed stage fails plainly and stops downstream work. Distill may return a
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
