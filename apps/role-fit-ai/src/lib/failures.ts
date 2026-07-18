// Classifies a caught error from a fetch to the LOCAL API (server.ts / server/ai/*)
// into a general, user-safe failure type for the progress-card UI. Server error
// messages are already user-safe (see server/ai/*.ts catch blocks) — we mostly
// pass the message through as `detail` and attach a general `headline`. Browser/
// fetch-level errors (network failures, TypeErrors) are NOT user-safe, so those
// get a replaced, friendly detail instead of the raw message.
//
// Kept as a small pure module (no imports beyond types) so it's easy to unit test.

export type FailureKind =
  | "timeout"
  | "auth"
  | "rate-limit"
  | "config"
  | "too-large"
  | "truncated"
  | "parse"
  | "validation"
  | "network"
  | "api";

export type ClassifiedFailure = {
  kind: FailureKind;
  headline: string;
  detail: string;
};

// Thrown by API-calling code that has an HTTP status to attach (fetch calls to
// server.ts / server/ai/* routes). `httpStatus` lets classifyFailure use the
// server's response code as a stronger signal than message-sniffing alone.
export class ApiError extends Error {
  httpStatus?: number;

  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = "ApiError";
    this.httpStatus = httpStatus;
  }
}

const HEADLINES: Record<FailureKind, string> = {
  timeout: "Timed out",
  auth: "Authentication error",
  "rate-limit": "Rate limit reached",
  config: "Configuration error",
  "too-large": "Request too large",
  truncated: "Response cut off",
  parse: "Parsing error",
  validation: "Missing input",
  network: "Network error",
  api: "API error"
};

// Trim exactly one trailing "." from a server message — server copy tends to end
// sentences with a period, but the headline already supplies the terminal tone.
function trimTrailingPeriod(message: string): string {
  return message.endsWith(".") ? message.slice(0, -1) : message;
}

function classifiedFrom(kind: FailureKind, detail: string): ClassifiedFailure {
  return { kind, headline: HEADLINES[kind], detail };
}

export function classifyFailure(error: unknown): ClassifiedFailure {
  if (!(error instanceof Error)) {
    return classifiedFrom("api", "Request failed");
  }

  const message = error.message ?? String(error);
  const detail = trimTrailingPeriod(message);
  const httpStatus = error instanceof ApiError ? error.httpStatus : undefined;

  // 1. Browser/fetch-level network failure — raw messages here are techy
  // ("Failed to fetch", "NetworkError when attempting to fetch resource"), so
  // replace the detail entirely rather than surfacing them.
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message)) {
    return classifiedFrom("network", "Couldn't reach the local server");
  }

  // 2. Auth — missing/expired API key or CLI subscription/login.
  if (/authenticat|(^|[^0-9])401([^0-9]|$)|not logged in|log ?in|api key|subscription/i.test(message)) {
    return classifiedFrom("auth", detail);
  }

  // 3. Provider account quota / rate limit.
  if (httpStatus === 429 || /rate limit|quota/i.test(message)) {
    return classifiedFrom("rate-limit", detail);
  }

  // 4. Timeout.
  if (httpStatus === 504 || /timed out|timeout/i.test(message)) {
    return classifiedFrom("timeout", detail);
  }

  // 5. Request too large for the provider/model.
  if (httpStatus === 413 || /too large/i.test(message)) {
    return classifiedFrom("too-large", detail);
  }

  // 6. Provider cut its response short before finishing (output-token limit).
  if (/cut its response|output-token limit|truncated/i.test(message)) {
    return classifiedFrom("truncated", detail);
  }

  // 7. 400s: split provider/model/base-url/reasoning-effort misconfiguration
  // from plain missing-input validation errors.
  if (httpStatus === 400) {
    if (/base url|provider|model|reasoning effort/i.test(message)) {
      return classifiedFrom("config", detail);
    }
    return classifiedFrom("validation", detail);
  }

  // 8. Provider returned something we couldn't use (bad JSON, empty body, etc).
  if (httpStatus === 502 || /did not include usable|unparseable|did not return json|parse/i.test(message)) {
    return classifiedFrom("parse", detail);
  }

  // 9. Generic provider/server failure (matches the 500 fallback status).
  return classifiedFrom("api", detail);
}

// The single, uniform reason shown as the bold headline on EVERY card where an
// AI step didn't produce a usable result — Distill, Tailor, Review, cover. A
// config error, timeout, auth failure, and a thin/absent reply all read the
// same here on purpose: those cards appear together in one flow, and each step
// can hit a different sub-cause (or a different provider — the extension distill
// uses the server default), so a per-card classified reason reads as three
// unrelated problems when it's really one "the AI isn't producing right now".
// The specific detail, when useful, lives in the inline status line, not here.
// (classifyFailure stays for genuinely different, non-AI-outage cases: bad
// input → "Missing input", a failed link fetch → "Network error", etc.)
export const AI_UNAVAILABLE = "AI unavailable";
