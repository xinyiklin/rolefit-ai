export const ANSWER_QUESTION_MAX_CHARS = 12_000;
export const ANSWER_TEXT_MAX_CHARS = 16_000;
export const ANSWER_REFINEMENT_MAX_CHARS = 4_000;
export const ANSWER_CONVERSATION_MAX_REVISIONS = 60;

export type AnswerCounts = { words: number; characters: number; sentences: number };
export type AnswerConstraint = {
  unit: keyof AnswerCounts;
  min?: number;
  max?: number;
  exact?: number;
  hard: boolean;
  scope: "answer" | "each" | "total";
  source: string;
  unresolvedScope?: true;
};
export type ApplicationAnswerRevision = {
  id: string;
  applicationId: string;
  originId?: string;
  questionId: string;
  questionRevision: number;
  question: string;
  answer: string;
  clarification?: string;
  status: "ready" | "draft" | "needs-input";
  constraints: AnswerConstraint[];
  counts: AnswerCounts;
  compliant: boolean;
  warnings?: string[];
  previousAnswerId?: string;
  refinement?: string;
  generation?: {
    provider: string;
    model: string;
    reasoningEffort: string;
    createdAt: string;
    attempts: number;
    promptVersion: string;
  };
  sources?: {
    resumeFingerprint: string;
    profileFingerprint: string;
    jobFingerprint: string;
    rawJobFingerprint: string;
    factsFingerprint: string;
  };
};

export function normalizeAnswerText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function countAnswerText(value: string): AnswerCounts {
  const text = normalizeAnswerText(value);
  // Keep abbreviations and decimals inside their sentence. UTF-16 length mirrors
  // HTML text-field limits; apostrophes and hyphens stay within one word.
  const sentenceText = text
    .replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)\./gi, (match, offset: number, original: string) => {
      const endsSentence = /^etc\.$/i.test(match) && /^\s+["'“‘(]*\p{Lu}/u.test(original.slice(offset + match.length));
      return endsSentence ? match : match.replace(/\./g, "\uE000");
    })
    .replace(/\b(?:[A-Za-z]\.){2,}/g, (match, offset: number, original: string) => {
      const endsSentence = /^\s+(?:I|We|They|It|This|That|My|Our|The|Then|However)\b/.test(original.slice(offset + match.length));
      return endsSentence ? match.slice(0, -1).replace(/\./g, "\uE000") + "." : match.replace(/\./g, "\uE000");
    })
    .replace(/(?<=\d)\.(?=\d)/g, "\uE000")
    .replace(/\b([A-Z])\.(?=\s+[A-Z][a-z])/g, "$1\uE000");
  return {
    words: text.match(/\p{N}+(?:[.,]\p{N}+)+|[\p{L}\p{N}]+(?:[’'\-‐‑][\p{L}\p{N}]+)*/gu)?.length ?? 0,
    characters: text.length,
    sentences: sentenceText.split(/[.!?]+(?:["'”’)]*)(?:\s+|$)|\n\s*\n/u).filter((part) => /[\p{L}\p{N}]/u.test(part)).length
  };
}

// Bracketed or doubled-brace slots, including the historical "[add: …]"
// drafting placeholder, mark prose that is not finished.
export function hasUnresolvedAnswerPlaceholder(text: string): boolean {
  return /\[[^\]\r\n]{1,240}\]|\{\{[^}\r\n]{1,240}\}\}/.test(text);
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90
};
const WORD_NUMBER = `(?:${Object.keys(NUMBER_WORDS).join("|")})`;
// Digits with optional thousands separators ("1,500", "2.000"), a bare or
// compound number word ("two hundred fifty"), or one number word. The
// lookbehind keeps "2.000" or "3.5" from yielding a trailing "000" or "5".
const NUMBER = `(?<![\\d.,])(?:\\d{1,3}(?:[.,]\\d{3})+|\\d+|(?:${WORD_NUMBER}\\s+)?(?:hundred|thousand)(?:\\s+(?:and\\s+)?${WORD_NUMBER})?|${WORD_NUMBER})`;
const UNIT = "(words?|characters?|chars?|sentences?)";
function numberValue(value: string): number {
  if (/^\d/.test(value)) return Number(value.replace(/[.,]/g, ""));
  let total = 0;
  for (const word of value.toLowerCase().split(/\s+/)) {
    if (word === "hundred") total = (total || 1) * 100;
    else if (word === "thousand") total = (total || 1) * 1000;
    else if (word in NUMBER_WORDS) total += NUMBER_WORDS[word];
  }
  return total;
}
const unitValue = (value: string): keyof AnswerCounts => value.toLowerCase().startsWith("word") ? "words" : value.toLowerCase().startsWith("sent") ? "sentences" : "characters";
const CEILING_QUALIFIER = /^(?:more than|over|above|beyond|exceeds?|exceeding|go(?:es|ing)? over|longer than|greater than)$/;
// "Responses that exceed 250 words will not be read" states a ceiling through
// its penalty; without the penalty the same words state a floor.
const PENALTY_CLAUSE = /\b(?:will|may|might|would|could|shall|is|are|get|gets|being)\b[^.;!?\n]{0,20}?\b(?:truncat|cut\s*off|cut\b|reject|ignor|discard|disqualif|penali[sz]|lost\b|unread)|\b(?:not|never|won['’]t|cannot|can['’]t)\b[^.;!?\n]{0,12}?\b(?:read|reviewed|considered|accepted|scored|counted|processed|assessed)\b/i;

export function extractAnswerConstraints(question: string): AnswerConstraint[] {
  const constraints: AnswerConstraint[] = [];
  const occupied: Array<[number, number]> = [];
  const multipleFields = (question.match(/\?/g)?.length ?? 0) > 1
    || (question.match(/(?:^|\n)\s*(?:\d+[.)]|(?:question|field)\s*\d+[:.)])/gi)?.length ?? 0) > 1;
  const addMatches = (pattern: RegExp, build: (match: RegExpMatchArray, trailing: string) => Omit<AnswerConstraint, "scope" | "source"> | null) => {
    for (const match of question.matchAll(pattern)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (occupied.some(([left, right]) => start < right && end > left)) continue;
      const trailing = question.slice(end, end + 45).split(/[.;!?\n]/)[0];
      const preceding = question.slice(Math.max(0, start - 35), start).split(/[.;!?\n]/).pop() ?? "";
      const built = build(match, trailing);
      if (!built) continue;
      const context = `${preceding} ${match[0]} ${trailing}`;
      const scope = /\b(?:each|per)\s+(?:answer|response|field)|\b(?:answer|response|field)\s+each\b/i.test(context) ? "each"
        : /\b(?:total|combined|altogether|across (?:both|all))\b/i.test(context) ? "total" : "answer";
      constraints.push({
        ...built, scope, source: match[0],
        ...(scope === "each" && multipleFields ? { unresolvedScope: true as const } : {})
      });
      occupied.push([start, end]);
    }
  };
  addMatches(new RegExp(`\\b(?:(about|around|approximately|roughly)\\s+)?(?:between\\s+)?(${NUMBER})\\s*(?:[-–—]|to|and)\\s*(${NUMBER})\\s*[-‐‑]?\\s*${UNIT}\\b`, "gi"), (match) => ({
    unit: unitValue(match[4]), min: numberValue(match[2]), max: numberValue(match[3]), hard: !match[1]
  }));
  const negation = "(?:no|not|never|do\\s+not|don['’]t|must\\s+not|mustn['’]t|should\\s+not|shouldn['’]t|cannot|can['’]t)";
  const action = "(?:(?:write|use|include|provide|submit|return|give|be|need|want|require|take|spend)\\s+)?";
  const comparison = "(more\\s+than|less\\s+than|fewer\\s+than|over|under|exceed|go\\s+over|fall\\s+below|go\\s+below)";
  addMatches(new RegExp(`\\b${negation}\\s+(?:to\\s+)?${action}(?:to\\s+)?${comparison}\\s+(${NUMBER})\\s*[-‐‑]?\\s*${UNIT}\\b`, "gi"), (match) => ({
    unit: unitValue(match[3]),
    ...(/^(?:less|fewer|under)|below$/i.test(match[1]) ? { min: numberValue(match[2]) } : { max: numberValue(match[2]) }),
    hard: true
  }));
  addMatches(new RegExp(`\\b(exactly|about|around|approximately|roughly|under|below|no fewer than|no less than|fewer than|less than|at most|no more than|more than|over|above|beyond|exceeds?|exceeding|go(?:es|ing)? over|longer than|greater than|up to|maximum(?: of)?|max\\.?|at least|minimum(?: of)?|min\\.?)\\s*:?\\s*(${NUMBER})\\s*[-‐‑]?\\s*${UNIT}\\b`, "gi"), (match, trailing) => {
    const n = numberValue(match[2]);
    const qualifier = match[1].toLowerCase().replace(/\s+/g, " ");
    const bounds = qualifier === "exactly" ? { exact: n }
      : /^(?:at least|no fewer than|no less than|min)/.test(qualifier) ? { min: n }
      : CEILING_QUALIFIER.test(qualifier) ? (PENALTY_CLAUSE.test(trailing) ? { max: n } : { min: n + 1 })
      : /^(?:about|around|approximately|roughly)$/.test(qualifier) ? { exact: n }
      : { max: /^(?:under|below|fewer|less)/.test(qualifier) ? Math.max(0, n - 1) : n };
    return { unit: unitValue(match[3]), ...bounds, hard: !/^(?:about|around|approximately|roughly)$/.test(qualifier) };
  });
  // "Character limit: 1,500", "Word count: 250 max", "Minimum word count: 100".
  addMatches(new RegExp(`\\b(?:(maximum|max\\.?|minimum|min\\.?|at most|at least|up to)\\s+)?${UNIT}\\s*(limit|count|maximum|max\\.?|minimum|min\\.?|cap)?\\s*(?:is|of|:|=|[-–—])?\\s*(${NUMBER})\\b(?:\\s*(max\\.?|maximum|min\\.?|minimum|or more|or fewer|or less))?`, "gi"), (match) => {
    if (!match[1] && !match[3]) return null;
    const n = numberValue(match[4]);
    const wording = `${match[1] ?? ""} ${match[3] ?? ""} ${match[5] ?? ""}`.toLowerCase();
    return { unit: unitValue(match[2]), ...(/\b(?:min\.?|minimum|at least|or more)\b/.test(wording) ? { min: n } : { max: n }), hard: true };
  });
  addMatches(new RegExp(`\\b(${NUMBER})\\s*[-‐‑]?\\s*${UNIT}(?:\\s+(?:maximum|max|limit|or (?:less|fewer|more)|at most|minimum|min|exactly))?\\b`, "gi"), (match) => ({
    unit: unitValue(match[2]),
    ...(/\b(?:minimum|min|or more)$/i.test(match[0]) ? { min: numberValue(match[1]) } : /\bexactly$/i.test(match[0]) ? { exact: numberValue(match[1]) } : { max: numberValue(match[1]) }),
    hard: true
  }));
  return constraints.filter((constraint) => [constraint.min, constraint.max, constraint.exact].every((n) => n === undefined || (Number.isSafeInteger(n) && n <= 1_000_000)));
}

export function validateAnswerConstraints(text: string, constraints: readonly AnswerConstraint[]): {
  counts: AnswerCounts; compliant: boolean; violations: string[];
} {
  const counts = countAnswerText(text);
  const violations = constraints.filter((constraint) => constraint.hard).flatMap((constraint) => {
    if (constraint.unresolvedScope) return ["Send each employer field as a separate question so its own limit can be checked."];
    const count = counts[constraint.unit];
    if (constraint.exact !== undefined && count !== constraint.exact) return [`Use exactly ${constraint.exact} ${constraint.unit} (currently ${count}).`];
    if (constraint.min !== undefined && count < constraint.min) return [`Use at least ${constraint.min} ${constraint.unit} (currently ${count}).`];
    if (constraint.max !== undefined && count > constraint.max) return [`Use at most ${constraint.max} ${constraint.unit} (currently ${count}).`];
    return [];
  });
  return { counts, compliant: violations.length === 0, violations };
}
