// AI provider error types shared across the polish + application-answers routes.

export class UserSafeAiError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "UserSafeAiError";
    this.status = status;
  }
}

// Actionable claude-cli failure messages. Exported so server/ai-cli/index.ts
// throws the EXACT strings the SAFE set matches (single source of truth — the
// set is exact-match, so a drifting copy would silently fall back to a generic
// 500). A 401 here usually means the spawned `claude` had no valid login,
// commonly because the app server was launched from a context without the
// user's Claude Code auth (e.g. started from inside another Claude Code session).
export const CLAUDE_CLI_AUTH_MESSAGE =
  "Claude Code couldn't authenticate (401). Run `claude` in your terminal to sign in, then start the app from that same terminal and try again.";
export const CLAUDE_CLI_FAILED_MESSAGE =
  "Claude Code couldn't complete the request — the `claude` CLI errored. Run `claude` in your terminal to confirm it's signed in and the model is available, then start the app from that same terminal and try again.";
export const CLAUDE_CLI_TIMEOUT_MESSAGE =
  "Claude Code timed out before finishing. Try again, or switch to a faster model or lower the reasoning effort.";

// Provider/CLI configuration errors that carry their own actionable, already
// user-safe wording. Routes map these to a 400 (not a generic 500) so the user
// sees the precise remediation. Shared by /api/polish and /api/application-answers.
const SAFE_CONFIG_MESSAGES = new Set([
  "Add an OpenAI-compatible base URL.",
  "Enter a valid OpenAI-compatible base URL.",
  "AI base URL must start with http:// or https://.",
  "Use https:// for remote AI providers. http:// is only allowed for localhost.",
  "Private-network AI base URLs are blocked. Use localhost for local AI or a public https provider URL.",
  CLAUDE_CLI_AUTH_MESSAGE,
  CLAUDE_CLI_FAILED_MESSAGE,
  CLAUDE_CLI_TIMEOUT_MESSAGE,
  "codex is not installed or not on PATH.",
  "claude is not installed or not on PATH.",
  "agy is not installed or not on PATH.",
  "Antigravity CLI could not complete the request. Run `agy auth login` to sign in, confirm the selected model is available, then try again."
]);

// Returns the message verbatim when it is a known actionable config error, else
// null. Lets each route surface a 400 with the exact remediation text.
export function safeConfigErrorMessage(message: string): string | null {
  return SAFE_CONFIG_MESSAGES.has(message) ? message : null;
}
