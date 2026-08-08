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

type NumericClaim = { key: string; display: string };

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

function numericClaims(value: unknown): NumericClaim[] {
  const text = String(value ?? "");
  const claims: NumericClaim[] = [];
  const seen = new Set<string>();
  const push = (key: string, display: string) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    claims.push({ key, display });
  };

  for (const match of text.matchAll(DURATION_CLAIM_PATTERN)) {
    const number = normalizedNumber(match[1]);
    if (!number) continue;
    const unit = match[2].toLowerCase().replace(/s$/, "");
    push(`duration:${unit}:${number}`, match[0]);
    push(`number:${number}`, match[1]);
  }

  for (const match of text.matchAll(/\d[\d,_]*(?:\.\d+)?/g)) {
    const number = normalizedDigit(match[0]);
    if (number) push(`number:${number}`, match[0]);
  }
  return claims;
}

export function findUngroundedNumericClaim(value: unknown, grounding: unknown): string | null {
  const grounded = new Set(numericClaims(grounding).map((claim) => claim.key));
  return numericClaims(value).find((claim) => !grounded.has(claim.key))?.display ?? null;
}

export function hasUngroundedNumericClaim(value: unknown, grounding: unknown): boolean {
  return findUngroundedNumericClaim(value, grounding) !== null;
}
