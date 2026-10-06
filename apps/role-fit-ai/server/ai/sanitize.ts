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
// A group separator must be followed by digits, so "React 18, reducing" ends at 18.
const DIGIT_NUMBER_PATTERN = String.raw`\d+(?:[,_]\d+)*(?:\.\d+)?`;
const DURATION_CLAIM_PATTERN = new RegExp(
  String.raw`\b(${DIGIT_NUMBER_PATTERN}|${WORD_NUMBER_PATTERN})\s*(?:\+|plus)?\s+(years?|months?|weeks?|days?|hours?)\b`,
  "gi"
);

// modifiers: the words between a count and the noun it counts ("critical" in "14 critical bugs").
export type NumericClaim = { key: string; display: string; context: string; subject: string; modifiers: string[] };

// Words ending in "s" that are not the plural noun a count attaches to.
const NOT_PLURAL_NOUNS = new Set(["as", "is", "was", "has", "its", "this", "thus", "plus", "versus", "across", "less", "unless", "various", "previous", "continuous", "numerous", "serious", "focus", "status", "process", "basis", "analysis", "always", "perhaps", "towards", "whereas", "yes"]);

// Spelling variants of one counted noun ("140 evaluations" and "140 evals").
const COUNT_UNIT_ALIASES = new Map([["evaluation", "eval"], ["specification", "spec"], ["repository", "repo"], ["configuration", "config"]]);
const countUnit = (word: string): string => { const unit = word.toLowerCase().replace(/s$/, ""); return COUNT_UNIT_ALIASES.get(unit) ?? unit; };

// Letters glued to digits that make a name, not a quantity: 5G, 3GPP, 2FA, 3D ("30d" is a duration).
const GLUED_NAME = /^(?:[gG]|[gG][pP][pP]|[fF][aA]|D|[lL][tT][eE]|[nN][rR])(?![A-Za-z])/;

// A count's noun phrase ends at the next preposition.
const PHRASE_BOUNDARY = new Set(["for", "of", "to", "in", "on", "at", "per", "by", "with", "from", "across", "into", "over", "under", "that", "which", "who", "whose", "where", "while", "when"]);
// "regression and adversarial evals" is one noun phrase; "1 dashboard and APIs" is two.
const CONJUNCTIONS = new Set(["and", "or", "but"]);

// A magnitude after the digits is part of the count: "4k users" is not "4 users".
const UNSCALED_MAGNITUDES = String.raw`[kmb]|bn|mm|x|hundred|trillion|dozen`;
const MAGNITUDE_PREFIX = new RegExp(String.raw`^(${UNSCALED_MAGNITUDES})\b`, "i");

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
  const push = (key: string, display: string, index: number, length: number, modifiers: string[] = []) => {
    // A quantity cannot borrow the metric from a neighboring coordinated clause.
    const boundary = /[\n;,!?]|\.(?:\s|$)|\b(?:and|but|while|whereas)\b/i;
    const before = text.slice(0, index).split(boundary).at(-1) ?? "";
    const after = text.slice(index + length).split(boundary)[0];
    claims.push({ key, display, context: `${before}${display}${after}`, subject: measurementSubject(before, after, key), modifiers });
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
  const countPhrase = String.raw`(?:(?:${UNSCALED_MAGNITUDES})\b\s*)?(?:(?!(?:and|or|but|for|of|to|with|from|by|in|on|at|per|${UNSCALED_MAGNITUDES})\b)[A-Za-z][A-Za-z-]*\s+){0,3}?(?:${countUnits})\b`;
  // "300+ tests" and "300-plus tests" count tests: the qualifier never separates a
  // count from its noun, and a count never takes its noun from the next line.
  const measurement = new RegExp(
    String.raw`\b(${DIGIT_NUMBER_PATTERN}|${WORD_NUMBER_PATTERN}(?![A-Za-z]))[ \t]*(?:\+|-?plus\b)?[ \t]*(%|percentage\s+points?|percent\b|${countPhrase}|thousand\b|million\b|billion\b|[A-Za-z][A-Za-z-]*\b)`, "gi"
  );
  for (const match of text.matchAll(measurement)) {
    if (occupied.some(([start, end]) => match.index! >= start && match.index! < end)) continue;
    if (/^(?:and|or|of|to|in|on|at|for|by|from|with|is|was|were|as|a|an|the|i)$/i.test(match[2]) || /^(?:19|20)\d{2}$/.test(match[1])) continue;
    // "3GPP" or "5G" is a name, not a count: letters glued to digits are a unit only as a magnitude.
    if (GLUED_NAME.test(text.slice(match.index! + match[1].length))) continue;
    // "one shared lock" counts locks: a participle after "one" describes the unit that follows it.
    const described = /^one$/i.test(match[1]) && /ed$/i.test(match[2])
      ? text.slice(match.index! + match[0].length).match(/^\s+([A-Za-z][A-Za-z-]*)/)?.[1] : undefined;
    const currency = text.slice(Math.max(0, match.index! - 12),match.index!).match(/(?:\b(?:USD|CAD|EUR|GBP)|[$€£])\s*$/i)?.[0].trim().toUpperCase();
    // "120+ documented API endpoints" counts endpoints: a single generic word
    // after the count yields to the first plural noun before the next preposition.
    let afterConjunction = false;
    // A percent keeps its own metric ("25 percent lower costs" is not "25 percent" of anything else).
    const headNoun = described || !/^[A-Za-z][A-Za-z-]*$/.test(match[2].trim()) || /s$/i.test(match[2]) || /^percent/i.test(match[2])
      ? null
      : [...(text.slice(match.index! + match[0].length).match(/^((?:[ \t]+[A-Za-z][A-Za-z-]*){1,4})/)?.[1] ?? "").matchAll(/\S+/g)]
        .reduce<{ word: string; length: number } | null | false>((found, wordMatch) => {
          const word = wordMatch[0];
          const lower = word.toLowerCase();
          if (found !== null) return found;
          if (CONJUNCTIONS.has(lower)) { afterConjunction = true; return null; }
          if (PHRASE_BOUNDARY.has(lower) || /^[a-z]{3,}ing$/i.test(word)) return false;
          const plural = /[a-z]s$/i.test(word) && !NOT_PLURAL_NOUNS.has(lower);
          if (plural && afterConjunction) return false;
          if (!plural) { afterConjunction = false; return null; }
          return { word, length: (wordMatch.index ?? 0) + word.length };
        }, null) || null;
    const matchedLength = match[0].length + (headNoun?.length ?? 0);
    const suffix = text.slice(match.index! + matchedLength).match(/^\s*(?:\/|per\s+)(second|minute|hour|day|month|year)s?\b/i);
    const unit = /^(?:%|percent)$/i.test(match[2]) ? "percent"
      : /^percentage/i.test(match[2]) ? "percentage-point"
        : `count:${match[2].trim().match(MAGNITUDE_PREFIX)?.[1].toLowerCase() ?? ""}${countUnit(described ?? headNoun?.word ?? match[2].trim().split(/\s+/).at(-1)!)}`;
    const phraseWords = text.slice(match.index! + match[1].length, match.index! + matchedLength).trim().split(/\s+/).filter(Boolean);
    const modifiers = unit.startsWith("count:")
      ? phraseWords.slice(0, -1).map((word) => word.toLowerCase()).filter((word) => /^[a-z]/.test(word) && !/^(?:plus|and|or|thousand|million|billion)$/.test(word) && !MAGNITUDE_PREFIX.test(word))
      : [];
    push(`${currency ? `currency:${currency}:` : ""}${unit}${suffix ? `/${suffix[1].toLowerCase()}` : ""}:${scaledMeasurementNumber(match[1], match[2])}`, text.slice(match.index!, match.index! + matchedLength) + (suffix?.[0] ?? ""), match.index!, matchedLength + (suffix?.[0].length ?? 0), modifiers);
  }
  for (const match of text.matchAll(new RegExp(DIGIT_NUMBER_PATTERN, "g"))) {
    const index = match.index!;
    if (occupied.some(([start, end]) => index >= start && index < end)) continue;
    // "3GPP", "5G": digits glued to letters name a standard, not a quantity.
    if (GLUED_NAME.test(text.slice(index + match[0].length))) continue;
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

// A count must match the evidence's number and noun, and may drop the evidence's
// modifiers but never gain one the evidence does not state anywhere.
export function findUngroundedNumericClaim(value: unknown, grounding: unknown): string | null {
  const grounded = numericClaims(grounding);
  const groundingWords = new Set((String(grounding ?? "").toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) ?? []).map((word) => word.replace(/[.-]+$/, "")));
  return numericClaims(value).find((claim) =>
    !grounded.some((source) => claim.key === source.key && (!claim.subject || claim.subject === source.subject))
    || claim.modifiers.some((modifier) => !groundingWords.has(modifier))
  )?.display ?? null;
}

export function hasUngroundedNumericClaim(value: unknown, grounding: unknown): boolean {
  return findUngroundedNumericClaim(value, grounding) !== null;
}
