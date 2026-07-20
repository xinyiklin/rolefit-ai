// AI provider error types shared across the polish + application-answers routes.

export class UserSafeAiError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "UserSafeAiError";
    this.status = status;
  }
}

// Actionable claude-cli failure messages. The adapter wraps these in
// UserSafeAiError with the correct HTTP status. A 401 means the provider-owned
// session needs attention; recovery belongs in RoleFit Companion.
export const CLAUDE_CLI_AUTH_MESSAGE =
  "Claude Code couldn't authenticate (401). Open RoleFit Companion, sign in or reconnect Claude Code, then check providers and retry.";
export const CLAUDE_CLI_FAILED_MESSAGE =
  "Claude Code couldn't complete the request. In RoleFit Companion, check the Claude Code connection, confirm the selected model is available, then retry.";
export const CLAUDE_CLI_TIMEOUT_MESSAGE =
  "Claude Code timed out before finishing. Try again, or switch to a faster model or lower the reasoning effort.";

// Provider/CLI configuration errors that carry their own actionable, already
// user-safe wording. Routes map these to a 400 (not a generic 500) so the user
// sees the precise remediation. Shared by /api/polish and /api/application-answers.
const SAFE_CONFIG_MESSAGES = new Set([
  "codex is not installed or not on PATH.",
  "claude is not installed or not on PATH.",
  "agy is not installed or not on PATH.",
  "Antigravity CLI could not complete the request. Run `agy` and complete Google sign-in, confirm the selected model is available, then try again."
]);

// Returns the message verbatim when it is a known actionable config error, else
// null. Lets each route surface a 400 with the exact remediation text.
export function safeConfigErrorMessage(message: string): string | null {
  return SAFE_CONFIG_MESSAGES.has(message) ? message : null;
}
