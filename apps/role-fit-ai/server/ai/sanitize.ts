import { INLINE_MARK_TAG_PATTERN } from "@typeset/engine/lib/inlineMarksText.ts";
import { actionVerbPast, findUngroundedCuratedClaimTerm, findUngroundedToolClaimTerm, isClaimTermGroundedInSource } from "./grounding.ts";

// Shared deterministic guards used by the current document workflows.

const GRAMMAR_TOKEN_RE = new RegExp(INLINE_MARK_TAG_PATTERN, "gi");

export function containsStructuredMarkup(value: unknown): boolean {
  const text = String(value ?? "");
  if (/[\r\n]/.test(text)) return true;
  if (/\\(?:begin|end|section|subsection|item|href)\b/i.test(text)) return true;
  // Read the text the way the engine will: any grammar token other than
  // b/i/u and the literal `<lt>` is structure. This also catches a <link=…>
  // whose destination swallows "<lt>" or "<b>" and so hides from the checks
  // below.
  for (const match of text.matchAll(GRAMMAR_TOKEN_RE)) {
    if (!/^<\/?(?:b|i|u)>$|^<lt>$/i.test(match[0])) return true;
  }

  // The editor's exact inline-mark vocabulary is allowed only when nested and
  // closed correctly, plus the literal-"<" token `<lt>`. All other HTML-like
  // markup is rejected.
  const stack: string[] = [];
  for (const match of text.matchAll(/<(\/)?(b|i|u)>/gi)) {
    const tag = match[2].toLowerCase();
    if (!match[1]) stack.push(tag);
    else if (stack.pop() !== tag) return true;
  }
  if (stack.length) return true;
  return /<\/?[a-z][^>]*>/i.test(text.replace(/<\/?(?:b|i|u)>|<lt>/gi, ""));
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
  // "30d", "5yrs", and "2 weeks" are durations; "3D" is a name (uppercase only).
  // Only digits glue ("tend" is not ten days).
  String.raw`\b(?:(${DIGIT_NUMBER_PATTERN}|${WORD_NUMBER_PATTERN})\s*(?:\+|plus)?\s+(years?|months?|weeks?|days?|hours?)\b|(${DIGIT_NUMBER_PATTERN})(yrs?|mos?|wks?|d|hrs?|h)(?![A-Za-z]))`,
  "gi"
);

// modifiers: the words between a count and the noun it counts ("critical" in "14 critical bugs").
// metric: a percent's metric word ("time" in "cut deploy time by 85%"). scope: the
// words of its sentence the quantity speaks for. quantity: its size, for scale words.
export type NumericClaim = {
  key: string; display: string; context: string; subject: string; modifiers: string[];
  index: number; end: number; metric: string; scope: string; quantity?: { noun: string; value: number };
};

// Words ending in "s" that are not the plural noun a count attaches to.
const NOT_PLURAL_NOUNS = new Set(["as", "is", "was", "has", "its", "this", "thus", "plus", "versus", "across", "less", "unless", "various", "previous", "continuous", "numerous", "serious", "focus", "status", "process", "basis", "analysis", "always", "perhaps", "towards", "whereas", "yes"]);

// Spelling variants of one counted noun ("140 evaluations" and "140 evals").
const COUNT_UNIT_ALIASES = new Map([["evaluation", "eval"], ["specification", "spec"], ["repository", "repo"], ["configuration", "config"]]);
const GLUED_DURATIONS = new Map([["d", "day"], ["h", "hour"], ["hr", "hour"], ["wk", "week"], ["mo", "month"], ["yr", "year"]]);
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
const MAGNITUDE_VALUES: Record<string, number> = { k: 1e3, m: 1e6, mm: 1e6, b: 1e9, bn: 1e9, hundred: 100, trillion: 1e12, dozen: 12 };
// "millions of users" or "a million users" claims at least a million; a plural scale must
// quantify something ("of", "in", a lead verb, or its clause end), unlike "a thousands separator".
const SCALE_VALUES: Record<string, number> = { tens: 10, dozens: 12, hundreds: 100, thousands: 1e3, millions: 1e6, billions: 1e9, dozen: 12, hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9 };
const SCALE_CLAIM = /\b(?:(tens|dozens|hundreds)\s+of\s+|(an?|half\s+a)\s+(?=(?:dozen|hundred|thousand|million|billion)\b))?(dozens|hundreds|thousands|millions|billions|dozen|hundred|thousand|million|billion)\b/gi;
const SCALE_LEAD = /\b(?:by|to|for|across|among|over|reach(?:ed|es|ing)?|serv(?:e|ed|es|ing)|impact(?:ed|s|ing)?|affect(?:ed|s|ing)?|handl(?:e|ed|es|ing)|process(?:ed|es|ing)?|sav(?:e|ed|es|ing)|generat(?:e|ed|es|ing))\s+$/i;
const MONEY_NOUNS = new Set(["dollar", "euro", "pound", "usd"]);
const IRREGULAR_PLURALS = /^(?:people|staff|personnel|children|men|women)$/;
// People counted under any of these names are one population ("millions of people" and "2 million users").
const PEOPLE_NOUNS = new Set(["user", "customer", "member", "patient", "student", "consumer", "shopper", "visitor", "player", "subscriber", "people", "person", "client", "learner", "reader", "viewer", "listener"]);
const sameCountedNoun = (a: string, b: string) => a === b || (PEOPLE_NOUNS.has(a) && PEOPLE_NOUNS.has(b));

// A percent's metric: the noun before it ("deploy time by 85%"), else after it ("99% uptime").
const METRIC_STOP_WORDS = new Set(["a", "an", "the", "our", "my", "its", "their", "his", "her", "this", "that", "these", "those", "with", "while", "as", "for", "at", "on", "in", "into", "across", "per", "of", "from", "to", "by", "and", "or", "but", "than", "i", "we", "it", "is", "was", "were", "are", "be", "been", "year", "years", "month", "months", "quarter", "week", "day", "yoy", "mom", "qoq"]);
const METRIC_LEAD_WORDS = new Set(["by", "to", "of", "at", "from", "around", "about", "nearly", "almost", "over", "under", "roughly", "approximately", "an", "a", "the", "estimated", "just", "only", "up", "down", "than", "more", "less", "some", "above", "below", "within", "~"]);
const CHANGE_WORDS = new Set(["faster", "slower", "lower", "higher", "fewer", "more", "less", "better", "smaller", "larger", "bigger", "cheaper", "quicker", "shorter", "longer", "reduction", "drop", "decrease", "increase", "improvement", "gain", "boost", "lift", "decline", "growth", "cut", "rise", "jump", "fall", "uplift", "saving", "savings", "raise", "raised", "rose", "fell", "grew", "hit", "reached", "achieved", "maintained", "kept", "held", "sustained", "brought", "pushed", "drove", "improve", "reduce", "increase"]);
const verbLike = (word: string) => CHANGE_WORDS.has(word) || /^[a-z]{3,}(?<!e)ed$/.test(word);
const stem = (word: string) => word.toLowerCase().replace(/['’]s$/, "").replace(/(?<=[a-z]{2})ies$/, "y").replace(/(?<=[a-z]{3}[^su])s$/, "");
// A generic measure takes the word before it: "deploy time" is the deploys' metric.
const GENERIC_METRICS = new Set(["time", "times", "speed", "speeds", "rate", "rates", "duration", "durations"]);

function percentMetric(before: string, after: string): string {
  const words = (value: string) => value.toLowerCase().match(/[a-z][a-z0-9-]*|[~\d][\d.,%]*/g) ?? [];
  const lead = words(before);
  while (lead.length && (METRIC_LEAD_WORDS.has(lead.at(-1)!) || /^[~\d]/.test(lead.at(-1)!) || verbLike(lead.at(-1)!))) lead.pop();
  const phrase: string[] = [];
  while (lead.length && !METRIC_STOP_WORDS.has(lead.at(-1)!) && !verbLike(lead.at(-1)!) && phrase.length < 3) phrase.unshift(lead.pop()!);
  if (!phrase.length) {
    for (const word of words(after)) {
      if (!phrase.length && (word === "of" || word === "in" || CHANGE_WORDS.has(word))) continue;
      if (METRIC_STOP_WORDS.has(word) || verbLike(word) || /^[~\d]/.test(word) || phrase.length === 3) break;
      phrase.push(word);
    }
  }
  const metric = phrase.filter((word) => !CHANGE_WORDS.has(word));
  return stem((GENERIC_METRICS.has(metric.at(-1) ?? "") ? metric.at(-2) : undefined) ?? metric.at(-1) ?? "");
}

// A line break or ". ! ?" before a space, never inside "e.g.", "U.S.", or "Inc.".
const SENTENCE_END = /\n|(?<!\.[A-Za-z]|\b(?:etc|vs|approx|incl|Inc|Ltd|Co|Corp|Jr|Sr|Dr|Mr|Ms|Mrs|St|No))[.!?](?=\s|$)/g;
const CONJUNCTION_WORD = /^(?:and|or|but|while|whereas)$/i;

// Each word speaks for the nearest quantity of its kind in the sentence (words between,
// plus three across a comma, bullet, or conjunction); a range ("from 60% to 85%") shares.
function attributeScopes(text: string, claims: NumericClaim[]): void {
  // Years, versions, and bare numbers ("p95") name things; they take no words.
  const attractors = claims.filter((claim) => !/^(?:year|version|number)[:/]/.test(claim.key));
  const kind = (claim: NumericClaim) => /^percent/.test(claim.key) ? "percent" : claim.key.startsWith("duration:") ? "duration" : "other";
  for (const group of ["percent", "duration", "other"]) {
    for (const [claim, scope] of attributeWords(text, attractors.filter((claim) => kind(claim) === group))) claim.scope = scope.join(" ");
  }
}

function attributeWords(text: string, unsorted: NumericClaim[]): Map<NumericClaim, string[]> {
  const attractors = [...unsorted].sort((a, b) => a.index - b.index);
  const words = new Map<NumericClaim, string[]>(attractors.map((claim) => [claim, [claim.display]]));
  if (!attractors.length) return words;
  const sentenceOf = new Map<NumericClaim, number>();
  let start = 0;
  for (const boundary of [...[...text.matchAll(SENTENCE_END)].map((match) => match.index!), text.length]) {
    const nearby = attractors.filter((claim) => claim.index >= start && claim.index < boundary);
    for (const claim of nearby) sentenceOf.set(claim, start);
    if (nearby.length) {
      const tokens = [...text.slice(start, boundary).matchAll(/[\p{L}\p{N}][\p{L}\p{N}+#'’-]*/gu)]
        .map((match) => ({ word: match[0], start: start + match.index!, end: start + match.index! + match[0].length }));
      // breaks[k]: commas, bullets, or conjunctions among the first k token gaps, so any gap is O(1).
      const breaks = [0];
      for (const [position, token] of tokens.entries()) {
        const next = tokens[position + 1];
        breaks.push(breaks[position] + (next && (/[,•▪|]/.test(text.slice(token.end, next.start)) || CONJUNCTION_WORD.test(next.word)) ? 1 : 0));
      }
      // Each quantity's first and last token position in the sentence.
      let cursor = 0;
      const spans = nearby.map((claim) => {
        while (cursor < tokens.length && tokens[cursor].end <= claim.index) cursor += 1;
        let last = cursor - 1;
        while (last + 1 < tokens.length && tokens[last + 1].start < claim.end) last += 1;
        return { claim, first: cursor, last: Math.max(last, cursor - 1) };
      });
      // A farther quantity on the same side is never nearer, so each word compares only the
      // closest quantity before it and the closest after it (linear in the sentence).
      let following = 0;
      for (const [position, token] of tokens.entries()) {
        while (following < spans.length && spans[following].last < position) following += 1;
        if (following < spans.length && spans[following].first <= position) continue;
        const candidates = [spans[following - 1], spans[following]].filter((span) => span !== undefined);
        const distances = candidates.map(({ first, last }) => position < first
          ? first - position - 1 + (breaks[first] - breaks[position] > 0 ? 3 : 0)
          : position - last - 1 + (breaks[position] - breaks[Math.max(last, 0)] > 0 ? 3 : 0));
        const nearest = Math.min(...distances);
        for (const [index, { claim }] of candidates.entries()) if (distances[index] === nearest) words.get(claim)!.push(token.word);
      }
    }
    start = boundary + 1;
  }
  for (const [position, claim] of attractors.entries()) {
    const next = attractors[position + 1];
    const range = next && sentenceOf.get(next) === sentenceOf.get(claim) && /^\s*(?:to|-|–|—|and|or|through)?\s*$/i.test(text.slice(claim.end, next.index));
    if (range) {
      const shared = [...words.get(claim)!, ...words.get(next)!];
      words.set(claim, shared);
      words.set(next, shared);
    }
  }
  return words;
}

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
  const push = (key: string, display: string, index: number, length: number, modifiers: string[] = [], quantity?: NumericClaim["quantity"]) => {
    // A quantity cannot borrow the metric from a neighboring coordinated clause.
    const boundary = /[\n;,!?]|\.(?:\s|$)|\b(?:and|but|while|whereas)\b/i;
    const before = text.slice(0, index).split(boundary).at(-1) ?? "";
    const after = text.slice(index + length).split(boundary)[0];
    claims.push({
      key, display, context: `${before}${display}${after}`, subject: measurementSubject(before, after, key), modifiers,
      index, end: index + length, metric: /^percent|^percentage/.test(key) ? percentMetric(before, after) : "", scope: display,
      ...(quantity && Number.isFinite(quantity.value) ? { quantity } : {})
    });
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
    const number = normalizedNumber(match[1] ?? match[3]);
    // "3D" and "2H" are names; only lowercase letters glue a duration.
    if (!number || (match[4] && /[A-Z]/.test(match[4]))) continue;
    const rawUnit = (match[2] ?? match[4]).toLowerCase().replace(/s$/, "");
    const unit = GLUED_DURATIONS.get(rawUnit) ?? rawUnit;
    push(`duration:${unit}:${number}`, match[0], match.index!, match[0].length, [], { noun: unit, value: Number(number) });
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
    const magnitude = match[2].trim().match(MAGNITUDE_PREFIX)?.[1].toLowerCase() ?? "";
    const noun = unit.slice("count:".length + magnitude.length);
    const quantity = unit.startsWith("count:") && magnitude !== "x"
      ? { noun: currency || MAGNITUDE_VALUES[noun] || /^(?:thousand|million|billion)$/.test(noun) || !noun ? "" : noun, value: Number(scaledMeasurementNumber(match[1], match[2])) * (MAGNITUDE_VALUES[magnitude] ?? 1) }
      : undefined;
    push(`${currency ? `currency:${currency}:` : ""}${unit}${suffix ? `/${suffix[1].toLowerCase()}` : ""}:${scaledMeasurementNumber(match[1], match[2])}`, text.slice(match.index!, match.index! + matchedLength) + (suffix?.[0] ?? ""), match.index!, matchedLength + (suffix?.[0].length ?? 0), modifiers, quantity);
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
    push(`${unit}${rate ? `/${rate.toLowerCase()}` : ""}:${normalizedDigit(match[0])}`, match[0], index, match[0].length, [],
      /^(?:currency|number)/.test(unit) ? { noun: "", value: Number(normalizedDigit(match[0])) } : undefined);
  }
  for (const match of text.matchAll(SCALE_CLAIM)) {
    const index = match.index!;
    if (occupied.some(([start, end]) => index >= start && index < end)) continue;
    const rest = text.slice(index + match[0].length);
    // "a million users" is always a quantity; a plural scale must quantify something.
    // "in thousands" is a unit ("numbers formatted in thousands"), not a quantity.
    const dollarAdjective = /^-dollar\b/i.test(rest);
    if (!match[2] && !dollarAdjective && (/\bin\s+$/i.test(text.slice(0, index)) || (!/^\s+(?:of|in)\b|^\s*(?:[.,;!?)]|$)/i.test(rest) && !SCALE_LEAD.test(text.slice(0, index))))) continue;
    // "a hundred percent committed" and "a thousand-line module" size nothing; "a
    // million-dollar deal" sizes money.
    if (match[2] && /^\s*(?:percent\b|-)/i.test(rest) && !dollarAdjective) continue;
    // The scale's noun is the first plural after it ("millions of finance users", "a
    // million users"); words before it are modifiers. "millions in revenue" is money.
    let noun = dollarAdjective || /^\s+in\s+(?:revenue|sales|savings|arr|mrr|funding|bookings|profit|costs?|spend)\b/i.test(rest) ? "dollar" : "";
    let length = match[0].length;
    const modifiers: string[] = [];
    for (const word of noun ? [] : rest.match(/^(?:\s+of)?(?:[ \t]+[A-Za-z][A-Za-z-]*){1,4}/)?.[0].matchAll(/[A-Za-z][A-Za-z-]*/g) ?? []) {
      const lower = word[0].toLowerCase();
      if (lower === "of" && word.index === rest.search(/\S/)) continue;
      if (PHRASE_BOUNDARY.has(lower) || CONJUNCTIONS.has(lower) || SCALE_VALUES[lower]) break;
      if ((/[a-z]s$/i.test(word[0]) && !NOT_PLURAL_NOUNS.has(lower)) || IRREGULAR_PLURALS.test(lower)) {
        noun = countUnit(word[0]);
        length += word.index! + word[0].length;
        break;
      }
      modifiers.push(lower);
    }
    const value = (match[1] ? SCALE_VALUES[match[1].toLowerCase()] : /^half|half-$/i.test(match[2] ?? text.slice(Math.max(0, index - 5), index)) ? 0.5 : 1) * SCALE_VALUES[match[3].toLowerCase()];
    push(`scale:${noun}:${value}`, text.slice(index, index + length), index, length, noun ? modifiers : [], { noun, value });
  }
  // "a multimillion-dollar budget" or "a seven-figure deal" sizes something too.
  for (const match of text.matchAll(/\bmulti-?(million|billion)|\b(six|seven|eight|nine)-figure\b/gi)) {
    const value = match[1] ? 2 * SCALE_VALUES[match[1].toLowerCase()] : 10 ** ({ six: 5, seven: 6, eight: 7, nine: 8 }[match[2].toLowerCase()]!);
    push(`scale::${value}`, match[0], match.index!, match[0].length, [], { noun: "", value });
  }
  attributeScopes(text, claims);
  return claims;
}

// The same evidence is checked repeatedly, so keep the last few parses (FIFO).
const GROUNDING_CACHE_MAX = 4;
const groundingCache = new Map<string, { grounded: NumericClaim[]; groundingWords: Set<string> }>();
function groundingQuantities(grounding: string) {
  const cached = groundingCache.get(grounding);
  if (cached) return cached;
  const entry = {
    grounded: numericClaims(grounding),
    groundingWords: new Set((grounding.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) ?? []).map((word) => word.replace(/[.-]+$/, "")))
  };
  groundingCache.set(grounding, entry);
  if (groundingCache.size > GROUNDING_CACHE_MAX) groundingCache.delete(groundingCache.keys().next().value!);
  return entry;
}

// A count must match the evidence's number and noun, and may drop the evidence's
// modifiers but never gain one the evidence does not state anywhere.
export function findUngroundedNumericClaim(value: unknown, grounding: unknown): string | null {
  const { grounded, groundingWords } = groundingQuantities(String(grounding ?? ""));
  return numericClaims(value).find((claim) =>
    !grounded.some((source) => supportsClaim(source, claim))
    || claim.modifiers.some((modifier) => !groundingWords.has(modifier))
  )?.display ?? null;
}

function supportsClaim(source: NumericClaim, claim: NumericClaim): boolean {
  if (claim.key.startsWith("scale:")) {
    // At least as large a count of the same noun, never a bare number (an id or ZIP code);
    // a count with no noun of its own ("Users: 3M") is named by its scope's words.
    const { noun, value } = claim.quantity!;
    if (!source.quantity || source.quantity.value < value || /^number[:/]/.test(source.key)) return false;
    if (!noun) return true;
    if (MONEY_NOUNS.has(noun)) return source.key.startsWith("currency:") || MONEY_NOUNS.has(source.quantity.noun);
    if (source.quantity.noun) return sameCountedNoun(source.quantity.noun, noun);
    return !source.key.startsWith("currency:") && source.scope.split(/\s+/).some((word) => sameCountedNoun(countUnit(word.replace(/[^A-Za-z]/g, "")), noun));
  }
  if (claim.key !== source.key || (claim.subject && claim.subject !== source.subject)) return false;
  // A percent keeps its own metric: "deploy time by 85%" is not "coverage to 85%".
  if (claim.metric && !source.scope.split(/\s+/).some((word) => stem(word) === claim.metric)) return false;
  // A duration keeps its own skills: "6 years of Java" does not ground "6 years of Python".
  return !claim.key.startsWith("duration:")
    || (!findUngroundedCuratedClaimTerm(claim.scope, source.scope) && durationNames(claim).every((name) => isClaimTermGroundedInSource(name, source.scope)));
}

// A capitalized skill named right beside a duration ("6 years of Go", "Rust for 6
// years", "Swift (6 years)"), which the curated term lists may not know.
const DURATION_NAME = String.raw`\p{Lu}[\p{L}\p{N}+#.]*`;
const NOT_DURATION_NAMES = /^(?:I|Experience|Industry|Professional|Software|Engineering|Development|Work|Programming|Coding|Leadership|Management)$/;
function durationNames(claim: NumericClaim): string[] {
  const at = claim.context.indexOf(claim.display);
  const after = claim.context.slice(at + claim.display.length).match(new RegExp(String.raw`^\s+(?:of|with|in|writing|using|building|programming|coding|developing)(?:\s+(?:in|with))?\s+(${DURATION_NAME})`, "u"))?.[1];
  const before = claim.context.slice(0, at).match(new RegExp(String.raw`(?:^|\s)(${DURATION_NAME})\s*(?:\(|:|[-–]|for|over)\s*$`, "u"))?.[1];
  // An abbreviation ("U.S.") is not a skill.
  return [after, before].filter((name): name is string => Boolean(name) && !NOT_DURATION_NAMES.test(name!.replace(/[.]+$/, "")) && !/^(?:\p{Lu}\.)+\p{Lu}?\.?$/u.test(name!))
    .map((name) => name.replace(/[.]+$/, ""));
}

// Where a posting-scale clause ends (rules in AGENTS.md); never at a restrictive "which"
// or "that", so "I built tools that serve millions" stays one clause.
const SCALE_CLAUSE_BREAK = /[\n;•▪]|(?<!\.[A-Za-z]|\b(?:etc|vs|Inc|Ltd|Co|Corp))[.!?](?=\s|$)|,\s*(?=(?:which|who)\b)|\b(?:because|since|although|though|whereas|while)\b|\b(?:struck|impressed|excited|glad|amazed|surprised|thrilled|drawn|inspired|eager|hope|hoping|want|wants|would|could|['’]d|['’]ll|maps?|mapped|aligns?|aligned|fits?|translates?|transfers?|prepares?|prepared|suits?|suited|relevant|applicable)\b|\b(?:me|us)\s+(?:that|how)\b/giu;
// Case-sensitive: ", and Harbor's tooling…" and "I noticed Harbor serves…" open a clause;
// ", and grew it to…" and "I found bugs affecting…" do not.
const COORDINATION_BREAK = /,\s*(?=(?:and|but|so|while|whereas)\s+(?:(?:I|[Ww]e|[Ii]t|[Tt]hey|[Hh]e|[Ss]he|[Tt]his|[Tt]hat|[Tt]hese|[Tt]hose|[Tt]he|[Yy]our|[Ii]ts|[Tt]heir|[Oo]ur|[Mm]y)\b|\p{Lu}))|\b(?:noticed|learned|saw|see|read|know|knew|heard|found|realized|admire|appreciate|love|like|believe|think)\s+(?:that|how|what|why|(?=(?:your|its|it|they|this|their)\b|\p{Lu}))/gu;
const FIRST_PERSON = /\b(?:I|[Mm]e|[Mm]y|[Mm]ine|[Ww]e|us|[Oo]ur)\b/;

// Blanks a scale the posting itself states ("The platform handles billions of transactions")
// unless its clause speaks of the candidate: first person, or a resume-style opening verb.
export function withoutPostingScaleFacts(text: string, postingText: string): string {
  const plain = text.replace(/<\/?(?:b|i|u)>/gi, "");
  const breaks = [...plain.matchAll(SCALE_CLAUSE_BREAK), ...plain.matchAll(COORDINATION_BREAK)].map((match) => ({ start: match.index!, end: match.index! + match[0].length }));
  const sentenceStarts = [0, ...[...plain.matchAll(SENTENCE_END)].map((match) => match.index! + match[0].length)];
  const aboutCandidate = (claim: NumericClaim) => {
    const start = Math.max(0, ...breaks.filter((item) => item.end <= claim.index).map((item) => item.end));
    const end = Math.min(plain.length, ...breaks.filter((item) => item.start >= claim.end).map((item) => item.start));
    const opening = plain.slice(start).match(/^\W*([A-Za-z]+)/)?.[1] ?? "";
    const resumeVerb = sentenceStarts.some((sentence) => plain.slice(sentence, start).trim() === "")
      && /^[A-Z]/.test(opening) && (actionVerbPast(opening.toLowerCase()) === opening.toLowerCase() || /^[A-Z][a-z]{2,}(?<!e)ed$/.test(opening));
    // First person after the scale counts only nearby, before a comma, likeness, or intention:
    // "Millions of users relied on the service I built", not "…merchants, I see a fit".
    const nearby = (to: number) => plain.slice(claim.end, to).split(/\s+/).slice(0, 9).join(" ").split(",")[0].split(/\b(?:like|such as|similar to)\b/i)[0];
    const keptByFollowing = FIRST_PERSON.test(nearby(end)) && !/\b(?:would|could|will|want|hope|love|eager)\b|['’](?:d|ll)\b/i.test(nearby(plain.length));
    return resumeVerb || FIRST_PERSON.test(plain.slice(start, claim.index)) || keptByFollowing;
  };
  return numericClaims(plain)
    .filter((claim) => claim.key.startsWith("scale:") && findUngroundedNumericClaim(claim.display, postingText) === null && !aboutCandidate(claim))
    .reduce((kept, claim) => kept.slice(0, claim.index) + " ".repeat(claim.end - claim.index) + kept.slice(claim.end), plain);
}

export function hasUngroundedNumericClaim(value: unknown, grounding: unknown): boolean {
  return findUngroundedNumericClaim(value, grounding) !== null;
}
