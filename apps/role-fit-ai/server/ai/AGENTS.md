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
- `polish.ts` orchestrates Tailor, Review, and optional cover work.
- `distill.ts`, `coverLetter.ts`, and `applicationAnswers.ts` own their routes.
- `grounding.ts` and `eligibilityLexicon.ts` provide deterministic evidence
  checks, never a local fit-scoring system.
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
