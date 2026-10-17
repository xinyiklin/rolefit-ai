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
- Claude's strict empty MCP configuration is `{"mcpServers":{}}`; a bare `{}`
  is rejected by current Claude Code before the provider request begins.
- Pass prompts through the mechanism the current CLI actually supports. Never
  log commands when argv may contain private prompt text or credentials.
- Keep prompt text out of Claude and Codex argv. On Windows an npm-installed
  CLI is a `.cmd` shim that runs through cmd.exe, which ends a command line at
  its first newline and refuses one over 8,191 characters. Claude's system
  prompt goes in a private temp file (`--append-system-prompt-file`), removed
  after the call; user prompts go on stdin. Claude Code 2.1.300 hides that flag
  from `--help` (it is named only under `--bare`); confirm support from its
  "Append system prompt file not found" error for a missing path, which needs
  no provider call. `runCli` refuses multi-line or over-long argv through a
  command script, and maps a synchronous `ENAMETOOLONG`/`E2BIG` spawn refusal,
  before the CLI runs. Antigravity, whose prompt is argv-only, reports either
  refusal as its own user-safe error, never as a sign-in problem.
  `cli-argv-delivery-probes.mjs` pins all of this and stops before any prompt
  is sent if a real CLI, not its fake, resolves first on PATH.
- Build every execution child environment through the AI CLI sanitizer. Keep
  normal executable discovery and provider-owned config/session locations, but
  never forward Node/Electron launch controls, native API keys, or alternate
  API/access-token environment variables into Claude, Codex, or Antigravity
  subprocesses.
- Preserve bounded execution, abort handling, output-size caps, safe error
  classification, and child-process cleanup.
- A missing executable, auth failure, unavailable model, malformed output, or
  non-zero exit is a visible provider failure. Never silently select another
  provider or synthesize a result.
- Keep bounded CLI stdout/stderr private for allowlisted failure classification.
  Never return or log raw provider diagnostics.
- User-facing model labels should avoid redundant provider branding while
  remaining unambiguous in the provider-specific control.

Add or update offline contract probes for parser, argument, discovery, and
failure-path changes. Live CLI smoke tests are opt-in because they use provider
accounts and may consume quota.
