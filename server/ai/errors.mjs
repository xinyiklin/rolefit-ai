// AI provider error types shared across the polish + application-answers routes.

export class UserSafeAiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "UserSafeAiError";
    this.status = status;
  }
}

// Provider/CLI configuration errors that carry their own actionable, already
// user-safe wording. Routes map these to a 400 (not a generic 500) so the user
// sees the precise remediation. Shared by /api/polish and /api/application-answers.
const SAFE_CONFIG_MESSAGES = new Set([
  "Add an OpenAI-compatible base URL.",
  "Enter a valid OpenAI-compatible base URL.",
  "AI base URL must start with http:// or https://.",
  "Use https:// for remote AI providers. http:// is only allowed for localhost.",
  "Private-network AI base URLs are blocked. Use localhost for local AI or a public https provider URL.",
  "Claude Code is not authenticated. Run `claude auth login` and try again.",
  "codex is not installed or not on PATH.",
  "claude is not installed or not on PATH.",
  "gemini is not installed or not on PATH.",
  "Gemini CLI could not complete the request. Run `gemini` once to sign in, confirm the selected model is available, then try again."
]);

// Returns the message verbatim when it is a known actionable config error, else
// null. Lets each route surface a 400 with the exact remediation text.
export function safeConfigErrorMessage(message) {
  return SAFE_CONFIG_MESSAGES.has(message) ? message : null;
}
