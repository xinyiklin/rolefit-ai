import { findUngroundedToolClaimTerm } from "./grounding.ts";

// Shared deterministic guards used by the current document workflows.

export function containsStructuredMarkup(value: unknown): boolean {
  const text = String(value ?? "");
  if (/[\r\n]/.test(text)) return true;
  if (/\\(?:begin|end|section|subsection|item|href)\b/i.test(text)) return true;

  // The editor's exact inline-mark vocabulary is allowed only when nested and
  // closed correctly. All other HTML-like markup is rejected.
  const stack: string[] = [];
  for (const match of text.matchAll(/<(\/)?(b|i|u)>/gi)) {
    const tag = match[2].toLowerCase();
    if (!match[1]) stack.push(tag);
    else if (stack.pop() !== tag) return true;
  }
  if (stack.length) return true;
  return /<\/?[a-z][^>]*>/i.test(text.replace(/<\/?(?:b|i|u)>/gi, ""));
}

const SMALL_NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19
};

const TENS_NUMBER_WORDS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90
};

const SMALL_NUMBER_PATTERN = Object.keys(SMALL_NUMBER_WORDS).join("|");
const TENS_NUMBER_PATTERN = Object.keys(TENS_NUMBER_WORDS).join("|");
const WORD_NUMBER_PATTERN =
  `(?:${SMALL_NUMBER_PATTERN}|(?:${TENS_NUMBER_PATTERN})(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)`;
const DIGIT_NUMBER_PATTERN = String.raw`\d[\d,_]*(?:\.\d+)?`;
const DURATION_CLAIM_PATTERN = new RegExp(
  String.raw`\b(${DIGIT_NUMBER_PATTERN}|${WORD_NUMBER_PATTERN})\s*(?:\+|plus)?\s+(years?|months?|weeks?|days?|hours?)\b`,
  "gi"
);

export type NumericClaim = { key: string; display: string; context: string; subject: string };

function normalizedDigit(value: string): string {
  return value.replace(/[, _]/g, "").replace(/^0+(?=\d)/, "");
}

function normalizedWordNumber(value: string): string | null {
  const parts = value.toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    const number = SMALL_NUMBER_WORDS[parts[0]] ?? TENS_NUMBER_WORDS[parts[0]];
    return number === undefined ? null : String(number);
  }
  if (parts.length === 2 && TENS_NUMBER_WORDS[parts[0]] !== undefined) {
    const ones = SMALL_NUMBER_WORDS[parts[1]];
    if (ones !== undefined && ones > 0 && ones < 10) {
      return String(TENS_NUMBER_WORDS[parts[0]] + ones);
    }
  }
  return null;
}

function normalizedNumber(value: string): string | null {
  return /^\d/.test(value) ? normalizedDigit(value) : normalizedWordNumber(value);
}

function scaledMeasurementNumber(value: string, unit: string): string | null {
  const number = normalizedNumber(value);
  const multiplier = unit.match(/\b(thousand|million|billion)\b/i)?.[1].toLowerCase();
  if (!number || !multiplier) return number;
  const places = { thousand: 3, million: 6, billion: 9 }[multiplier]!;
  const [whole, fraction = ""] = number.split(".");
  const digits = whole + fraction.padEnd(places, "0");
  const split = whole.length + places;
  return (digits.slice(0, split) + (digits.length > split ? "." + digits.slice(split) : "")).replace(/^0+(?=\d)/, "");
}

function measurementSubject(before: string, after: string, unit: string): string {
  if (unit.includes("percent")) {
    const metrics = /\b(latency|turnaround|conversion|costs?|revenue|throughput|accuracy|errors?)\b/gi;
    const preceding = [...before.matchAll(metrics)].at(-1)?.[0];
    const following = [...after.matchAll(metrics)][0]?.[0];
    return (preceding ?? following ?? "").toLowerCase().replace(/s$/, "");
  }
  if (unit.startsWith("duration")) {
    const scope = `${before} ${after}`;
    if (/\b(personal|academic|volunteer|open.source)\b/i.test(scope)) return "non-employment";
    if (/\b(professional|paid|employment|industry|commercial)\b/i.test(scope)) return "employment";
  }
  return "";
}

export function numericClaims(value: unknown): NumericClaim[] {
  const text = String(value ?? "").replace(/<\/?(?:b|i|u)>/gi, "");
  const claims: NumericClaim[] = [];
  const occupied: Array<[number, number]> = [];
  const push = (key: string, display: string, index: number, length: number) => {
    // A quantity cannot borrow the metric from a neighboring coordinated clause.
    const boundary = /[\n;,!?]|\.(?:\s|$)|\b(?:and|but|while|whereas)\b/i;
    const before = text.slice(0, index).split(boundary).at(-1) ?? "";
    const after = text.slice(index + length).split(boundary)[0];
    claims.push({ key, display, context: `${before}${display}${after}`, subject: measurementSubject(before, after, key) });
    occupied.push([index, index + length]);
  };

  // Named software versions stay versions when followed by a noun such as scripts.
  for (const match of text.matchAll(/\b([A-Za-z][\w+#.]*)\s+v?(\d+\.\d+(?:\.\d+)*)/g)) {
    if (!findUngroundedToolClaimTerm(match[1], "")) continue;
    const after = text.slice(match.index! + match[0].length);
    if (/^\s*(?:%|percent(?:age)?\b|thousand\b|million\b|billion\b|years?\b|months?\b|weeks?\b|days?\b|hours?\b)/i.test(after)) continue;
    const index = match.index! + match[0].length - match[2].length;
    push(`version:${match[1].toLowerCase()}:${match[2]}`, match[2], index, match[2].length);
  }
  for (const match of text.matchAll(DURATION_CLAIM_PATTERN)) {
    const number = normalizedNumber(match[1]);
    if (!number) continue;
    const unit = match[2].toLowerCase().replace(/s$/, "");
    push(`duration:${unit}:${number}`, match[0], match.index!, match[0].length);
  }

  const countUnits = "invoices?|users?|requests?|tests?|endpoints?|customers?|developers?|tickets?|services?";
  const countPhrase = String.raw`(?:(?!(?:and|or|but|for|of|to|with|from|by|in|on|at|per)\b)[A-Za-z][A-Za-z-]*\s+){0,3}?(?:${countUnits})\b`;
  const measurement = new RegExp(
    String.raw`\b(${DIGIT_NUMBER_PATTERN}|${WORD_NUMBER_PATTERN})\s*(%|percentage\s+points?|percent\b|${countPhrase}|thousand\b|million\b|billion\b|[A-Za-z][A-Za-z-]*\b)`, "gi"
  );
  for (const match of text.matchAll(measurement)) {
    if (occupied.some(([start, end]) => match.index! >= start && match.index! < end)) continue;
    if (/^(?:and|or|of|to|in|on|at|for|by|from|with|is|was|were|as|a|an|the|i)$/i.test(match[2]) || /^(?:19|20)\d{2}$/.test(match[1])) continue;
    const currency = text.slice(Math.max(0, match.index! - 12),match.index!).match(/(?:\b(?:USD|CAD|EUR|GBP)|[$€£])\s*$/i)?.[0].trim().toUpperCase();
    const suffix = text.slice(match.index! + match[0].length).match(/^\s*(?:\/|per\s+)(second|minute|hour|day|month|year)s?\b/i);
    const unit = /^(?:%|percent)$/i.test(match[2]) ? "percent"
      : /^percentage/i.test(match[2]) ? "percentage-point"
        : `count:${match[2].trim().split(/\s+/).at(-1)!.toLowerCase().replace(/s$/, "")}`;
    push(`${currency ? `currency:${currency}:` : ""}${unit}${suffix ? `/${suffix[1].toLowerCase()}` : ""}:${scaledMeasurementNumber(match[1], match[2])}`, match[0] + (suffix?.[0] ?? ""), match.index!, match[0].length + (suffix?.[0].length ?? 0));
  }
  for (const match of text.matchAll(/\d[\d,_]*(?:\.\d+)?/g)) {
    const index = match.index!;
    if (occupied.some(([start, end]) => index >= start && index < end)) continue;
    const before = text.slice(Math.max(0, index - 30), index);
    const after = text.slice(index + match[0].length, index + match[0].length + 20);
    const currency = before.match(/(?:\b(USD|CAD|EUR|GBP)|([$€£]))\s*$/i)?.[0].trim();
    const version = before.match(/\b([A-Za-z][\w+#.]*)\s+v?$/)?.[1];
    const unit = currency ? `currency:${currency.toUpperCase()}`
      : /\.\d/.test(match[0]) && version ? `version:${version.toLowerCase()}`
        : /^(?:19|20)\d{2}$/.test(match[0]) ? "year"
          : "number";
    const rate = after.match(/^\s*(?:\/|per\s+)(second|minute|hour|day|month|year)s?\b/i)?.[1];
    push(`${unit}${rate ? `/${rate.toLowerCase()}` : ""}:${normalizedDigit(match[0])}`, match[0], index, match[0].length);
  }
  return claims;
}

export function findUngroundedNumericClaim(value: unknown, grounding: unknown): string | null {
  const grounded = numericClaims(grounding);
  return numericClaims(value).find((claim) => !grounded.some((source) =>
    claim.key === source.key && (!claim.subject || claim.subject === source.subject)
  ))?.display ?? null;
}

export function hasUngroundedNumericClaim(value: unknown, grounding: unknown): boolean {
  return findUngroundedNumericClaim(value, grounding) !== null;
}
