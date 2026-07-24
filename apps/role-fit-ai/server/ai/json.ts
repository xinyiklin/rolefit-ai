import type { IncomingMessage } from "node:http";
import { readBody } from "../http.ts";
import { UserSafeAiError } from "./errors.ts";

// Best-effort JSON extraction from a model reply. Tries, in order: a fenced
// ```json block, the raw text, and the outermost {...} span (which drops any
// prose a model wraps around the JSON). Each candidate also gets a
// trailing-comma repair pass. Every workflow reply is an object contract, so a
// candidate that parses to null or a bare primitive is just as unreadable as
// unparseable text — rejecting it here keeps the 502 classification (and
// callConfiguredProvider's one-shot JSON-only retry) instead of a downstream
// null-property TypeError misreported as a provider-config failure. Throws a
// user-safe 502 only when every attempt fails.
export function parseAiJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new UserSafeAiError("AI returned an empty response. Try again or switch models.", 502);

  const candidates: string[] = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) candidates.push(fenced.trim());
  candidates.push(trimmed);
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed !== null && typeof parsed === "object") return parsed;
  }
  throw new UserSafeAiError("AI returned a response the app could not read. Try again or switch models.", 502);
}

// Request-boundary counterpart for the AI routes: read and parse the request
// body as a JSON object, mapping transport/shape failures to user-safe request
// errors (413/400) instead of letting them fall through to the route's generic
// provider-flavored 500 when no provider call ever ran.
export async function readAiJsonBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readBody(req, maxBytes);
  } catch (error) {
    if (error instanceof Error && error.message === "Request is too large.") {
      throw new UserSafeAiError("Request is too large. Shorten the input text and try again.", 413);
    }
    throw new UserSafeAiError("The request body could not be read.", 400);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UserSafeAiError("Request body must be valid JSON.", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UserSafeAiError("Request body must be a JSON object.", 400);
  }
  return parsed as Record<string, unknown>;
}

// Parse JSON, retrying once with trailing commas (`,}` / `,]`) stripped — the
// most common model JSON defect. Returns undefined (never a valid JSON value)
// when the text cannot be parsed, so callers can fall through to the next
// candidate.
function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      // Repair only after the original parse fails. This handles the common
      // model defect `,}` / `,]`; it is deliberately not a general JSON fixer.
      return JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1"));
    } catch {
      return undefined;
    }
  }
}
