# AI CLI Adapter Guide

Applies to RoleFit's account-backed CLI subprocess adapters. Also read
`../ai/AGENTS.md`; provider request/response and truthfulness contracts remain
owned by the AI layer.

## Rules

- Treat each CLI as a volatile external interface. Discover current models and
  reasoning efforts from the installed binary where supported; do not maintain
  invented aliases, custom IDs, or stale hand-curated availability lists.
- Keep provider-specific argv, stdin, timeout, cancellation, output parsing,
  and executable discovery in focused adapters behind one normalized contract.
- Pass prompts through the mechanism the current CLI actually supports. Never
  log commands when argv may contain private prompt text or credentials.
- Preserve bounded execution, abort handling, output-size caps, safe error
  classification, and child-process cleanup.
- A missing executable, auth failure, unavailable model, malformed output, or
  non-zero exit is a visible provider failure. Never silently select another
  provider or synthesize a result.
- User-facing model labels should avoid redundant provider branding while
  remaining unambiguous in the provider-specific control.

Add or update offline contract probes for parser, argument, discovery, and
failure-path changes. Live CLI smoke tests are opt-in because they use provider
accounts and may consume quota.
