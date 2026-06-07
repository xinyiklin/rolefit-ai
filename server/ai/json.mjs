import { UserSafeAiError } from "./errors.mjs";

// Best-effort JSON extraction from a model reply. Tries, in order: a fenced
// ```json block, the raw text, and the outermost {...} span (which drops any
// prose a model wraps around the JSON). Each candidate also gets a
// trailing-comma repair pass. Throws a user-safe 502 only when every attempt
// fails.
export function parseAiJson(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new UserSafeAiError("AI returned an empty response. Try again or switch models.", 502);

  const candidates = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) candidates.push(fenced.trim());
  candidates.push(trimmed);
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed !== undefined) return parsed;
  }
  throw new UserSafeAiError("AI returned a response the app could not read. Try again or switch models.", 502);
}

// Parse JSON, retrying once with trailing commas (`,}` / `,]`) stripped — the
// most common model JSON defect. Returns undefined (never a valid JSON value)
// when the text cannot be parsed, so callers can fall through to the next
// candidate.
function tryParseJson(raw) {
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
