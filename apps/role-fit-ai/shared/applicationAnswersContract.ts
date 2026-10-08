export const ANSWER_QUESTION_MAX_CHARS = 12_000;
export const ANSWER_TEXT_MAX_CHARS = 16_000;
export const ANSWER_REFINEMENT_MAX_CHARS = 4_000;
export const ANSWER_CONVERSATION_MAX_REVISIONS = 60;
export const ANSWER_FACTS_MAX = 20;
export const ANSWER_FACTS_MAX_CHARS = 12_000;
export const ANSWER_INVALID_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

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
export type AnswerUserFacts = { provenance: "user-declared"; facts: string[] };
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
  // The user's own statements for this question; only Save attaches them.
  userFacts?: AnswerUserFacts;
};

export function normalizeAnswerText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

// The request's explicit-fact limits. Saved facts follow the same rule, so a
// restored set can always be sent again.
export function answerFactsWithinLimits(facts: readonly unknown[]): facts is string[] {
  return facts.length <= ANSWER_FACTS_MAX
    && facts.every((fact) => typeof fact === "string" && Boolean(fact.trim()) && fact.length <= ANSWER_REFINEMENT_MAX_CHARS && !ANSWER_INVALID_CONTROL.test(fact))
    && facts.join("\n").length <= ANSWER_FACTS_MAX_CHARS;
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
// drafting placeholder, mark prose that is not finished. Numeric brackets,
// editorial marks and code-style indexes are ordinary prose.
export function hasUnresolvedAnswerPlaceholder(text: string): boolean {
  return /(?<![\w\]])\[(?!(?:[\d.,%\s\-–—]+|sic|redacted|citation needed)\])[^\]\r\n]{1,240}\]|\{\{[^}\r\n]{1,240}\}\}/i.test(text);
}

const SMALL_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMBER_WORDS: Record<string, number> = { ...SMALL_NUMBERS, ...TENS };
const ONES = `(?:${Object.keys(SMALL_NUMBERS).slice(0, 9).join("|")})`;
const WORD_NUMBER = `(?:(?:${Object.keys(TENS).join("|")})(?:[-\\s]${ONES})?|(?:${Object.keys(SMALL_NUMBERS).join("|")}))`;
const COMPOUND_NUMBER = `(?:(?:${WORD_NUMBER}\\s+)?thousand(?:\\s+(?:and\\s+)?(?:${WORD_NUMBER}\\s+)?hundred)?(?:\\s+(?:and\\s+)?${WORD_NUMBER})?|(?:${WORD_NUMBER}\\s+)?hundred(?:\\s+(?:and\\s+)?${WORD_NUMBER})?|${WORD_NUMBER})`;
// Digits with optional thousands separators ("1,500", "2.000") or number words
// ("seventy-five", "one thousand five hundred"). The lookbehind keeps "2.000"
// or "3.5" from yielding a trailing "000" or "5".
const NUMBER = `(?<![\\d.,])(?:\\d{1,3}(?:[.,]\\d{3})+|\\d+|${COMPOUND_NUMBER})`;
const UNIT = "(words?|characters?|chars?|sentences?)";
function numberValue(value: string): number {
  if (/^\d/.test(value)) return Number(value.replace(/[.,]/g, ""));
  let total = 0;
  let current = 0;
  for (const word of value.toLowerCase().split(/[\s-]+/)) {
    if (word === "hundred") current = (current || 1) * 100;
    else if (word === "thousand") { total += (current || 1) * 1000; current = 0; }
    else if (word in NUMBER_WORDS) current += NUMBER_WORDS[word];
  }
  return total + current;
}
const unitValue = (value: string): keyof AnswerCounts => value.toLowerCase().startsWith("word") ? "words" : value.toLowerCase().startsWith("sent") ? "sentences" : "characters";
const CEILING_QUALIFIER = /^(?:more than|over|above|beyond|exceeds?|exceeding|go(?:es|ing)? (?:over|beyond)|longer than|greater than)$/;
// A negation up to four words before a comparison turns it into a ceiling;
// a short parenthetical may follow the negation ("do not, under any
// circumstances, exceed"), words such as "penalty", "limit" or "hesitate"
// end that reach ("no penalty for going over 300 words" sets no ceiling),
// and "whether or not" is not a negation.
const NEGATION_WORDS = "(?:no|(?<!whether\\s+or\\s+)not|never|nobody|none|nothing|no\\s+one|neither|nor|don['’]t|doesn['’]t|didn['’]t|isn['’]t|aren['’]t|cannot|can['’]t|mustn['’]t|shouldn['’]t|won['’]t|wouldn['’]t|without|avoid|refrain\\s+from)";
const NEGATION_PARENTHETICAL = "(?:,\\s*[A-Za-z’' ]{1,40},)?";
const NEGATION_FILLER = "(?:(?!(?:penalty|penalties|problem|issue|harm|limit|limits|cap|maximum|restriction|hesitate|worry|mind|matter)\\b)[A-Za-z’']+\\s+){0,4}";
const NEGATED_BEFORE = new RegExp(`\\b${NEGATION_WORDS}${NEGATION_PARENTHETICAL}\\s+${NEGATION_FILLER}$`, "i");
const NEGATION_IN_CLAUSE = new RegExp(`\\b${NEGATION_WORDS}\\b`, "i");
const CONDITIONAL_IN_CLAUSE = /\b(?:if|when|whenever|unless|where|wherever|in\s+case|should\s+you)\b/i;
const CONDITIONAL_AFTER = /\b(?:only\s+(?:if|when|where)|unless|if\s+(?:necessary|needed|required)|when\s+(?:necessary|needed))\b/i;
// A count introduced as a suggestion or a typical length is advice, not the
// employer's limit ("Up to 500 words; we suggest 200-300 words").
const ADVISORY_BEFORE = /\b(?:suggest(?:ed|s)?|recommend(?:ed|s)?|ideally|typical(?:ly)?|usually|often|tend\s+to|prefer(?:ably|red|s)?|target|aim\s+for|(?:most|many)\s+(?:answers|responses|candidates|applicants|people|submissions)|(?:strong|good|great)\s+(?:answers|responses))\b/i;
// A penalty or suggestion belongs to the nearest count: the window stops at a
// contrastive conjunction, a comma-joined "and", or the next count.
const SEGMENT_BREAK = /\b(?:and|but|though|although|however|while|whereas|with)\b|,/i;
const ADVISORY_AFTER = /^(?:[^.;!?\n,]{0,30}?\b(?:usually|typical(?:ly)?|enough|plenty|target|ideal(?:ly)?|(?:is|are)\s+preferable|recommended|suggested|sufficient|fine|works?\s+(?:well|best)|is\s+common|ample|a\s+good\s+length)\b|\s+or\s+so\b|\s*,?\s*(?:ideally|preferably|if\s+(?:you\s+can|possible))\s*(?:[.;!?)\n]|$))/i;
const FLOOR_QUALIFIER = /^(?:under|below|fewer than|less than|shorter than)$/;
// "Answer in 3 sentences" or "Keep it to 150 words" instructs; another bare count
// beside a worded maximum of a different unit reads as advice ("A 250-word
// answer works"), as does a permitted or negated length ("Feel free to answer in
// 150 words", "You don't have to answer in 200 words").
const INSTRUCTED_COUNT_BEFORE = /\b(?:in|use|using|write|(?:answer|respond|reply)\s+with|(?:should|must)\s+be|(?:keep|limit)\s+(?:it|this|them|your\s+(?:answer|response))\s+to)\s+$/i;
const NEGATED_COUNT_BEFORE = /\b(?:don['’]t|do\s+not|doesn['’]t|no\s+need\s+to|needn['’]t|not\s+(?:required|necessary)\s+to)\b[^.;!?\n,]{0,25}$/i;
// Advice later in the question ("…, which is usually enough") softens the count too.
const LATER_ADVICE = /^[^\n]{0,80}?(?:\b(?:usually|is|are)\s+(?:enough|plenty|sufficient|ample|fine)\b|['’]s\s+(?:enough|plenty|sufficient|ample|fine)\b|\bno\s+penalty\b|\blonger\s+is\s+(?:fine|ok(?:ay)?)\b)/i;
const PERMITTED_COUNT_BEFORE = /\b(?:(?:free|welcome)\s+to|can|could|may|might)\s+(?:answer|respond|reply|write|use|do\s+(?:this|it))(?:\s+(?:in|with|using))?\s+$/i;
const KEEP_BEFORE = /\b(?:keep(?:\s+(?:it|answers|responses|them|this))?|stay|staying|be|remain|aim|write|writing|submit|use|using|please|answer|respond|limit)\s+$/i;
const COUNT_PATTERN = () => new RegExp(`${NUMBER}\\s*[-‐‑]?\\s*${UNIT}`, "gi");
// "under N words will not be considered" states a floor only when the penalty
// verb follows the count directly, optionally sharing it with an "or over M
// words" pair; a comma or "or/otherwise/since" starts a new consequence.
const FLOOR_PENALTY_AFTER = new RegExp(`^\\s*(?:or\\s+(?:over|above|beyond|more\\s+than|longer\\s+than|exceeding)\\s+${NUMBER}\\s*[-‐‑]?\\s*${UNIT}\\s*)?(?:will|may|might|would|won['’]t|cannot|can['’]t|are|is|get|gets)\\b`, "i");
// "You don't need more than 250 words" states sufficiency, not a limit, when
// the question already states a worded maximum.
const SUFFICIENCY_FILLER = /\b(?:need|have\s+to|feel|required|necessary)\b/i;
// An un-negated "more than N words" is a hard floor only after a positive
// instruction, with no negation or condition earlier in the clause; otherwise
// it is not a limit at all, so an unrecognised negation can never drive a
// repair past an employer's ceiling.
const PERMISSIVE_BEFORE = /\b(?:may|can|could|free\s+to|allowed\s+to|welcome\s+to|no\s+limit)\b[^.;!?\n]{0,30}$/i;
const INSTRUCTION_BEFORE = /\b(?:please|write|writing|use|using|include|provide|give|submit|expect(?:ed|s)?|should(?:\s+be)?|must(?:\s+be)?|needs?\s+to(?:\s+be)?|ha(?:s|ve)\s+to(?:\s+be)?|(?:must|should|needs?\s+to|ha(?:s|ve)\s+to)\s+(?:contain|include|have|require|run)|minimum\s+of|at\s+least|(?:response|answer|statement|essay)\s+of)\s+$/i;
// "Responses that exceed 250 words will not be read" states a ceiling through
// its penalty; without the penalty the same words state a floor.
const PENALTY_CLAUSE = /\b(?:will|may|might|would|could|shall|is|are|get|gets|being|we['’]ll|they['’]ll)\b(?:(?!\b(?:not|never|no)\b|n['’]t\b)[^.;!?\n]){0,24}?\b(?:truncat|cut\s*off|cut\b|reject|ignor|discard|disqualif|penali[sz]|lost\b|unread|stop\s+reading|skip|skim)|\b(?:not|never|won['’]t|cannot|can['’]t)\b[^.;!?\n]{0,16}?\b(?:read|review(?:ed)?|consider(?:ed)?|accept(?:ed)?|score[sd]?|count(?:ed)?|process(?:ed)?|assess(?:ed)?)\b/i;

export function extractAnswerConstraints(question: string): AnswerConstraint[] {
  const constraints: AnswerConstraint[] = [];
  const occupied: Array<[number, number]> = [];
  const FIELD_MARKER = /(?:^|\n)\s*(?:\d+[.)]|(?:question|field)\s*\d+[:.)])/gi;
  const multipleFields = (question.match(/\?/g)?.length ?? 0) > 1
    || (question.match(FIELD_MARKER)?.length ?? 0) > 1;
  const FIELD_BREAK = new RegExp(`\\?|${FIELD_MARKER.source}`, "i");
  // A builder returns null to leave the span for later rules, or false to claim
  // it without a constraint ("more than 100 words" must not fall through to the
  // bare "100 words" rule as a ceiling).
  type Build = (match: RegExpMatchArray, clause: { before: string; after: string }) => Omit<AnswerConstraint, "scope" | "source"> | null | false;
  // Bare counts ("250 words") are the weakest signal: suggestion wording after
  // them, or a worded hard maximum (see the demotion rule below), makes them advice.
  const bareIndexes: number[] = [];
  const instructedIndexes: number[] = [];
  const starts: number[] = [];
  const rangeIndexes: number[] = [];
  const addMatches = (pattern: RegExp, build: Build, options: { bare?: boolean; bareWhen?: (match: RegExpMatchArray) => boolean; range?: boolean } = {}) => {
    for (const match of question.matchAll(pattern)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (occupied.some(([left, right]) => start < right && end > left)) continue;
      const before = question.slice(Math.max(0, start - 120), start).split(/[.;!?\n]/).pop() ?? "";
      const after = question.slice(end, end + 160).split(/[.;!?\n]/)[0];
      const built = build(match, { before, after });
      if (built === null) continue;
      occupied.push([start, end]);
      if (built === false) continue;
      if (ADVISORY_BEFORE.test(before.split(SEGMENT_BREAK).pop() ?? "")) built.hard = false;
      if (options.bare || options.bareWhen?.(match)) {
        if (ADVISORY_AFTER.test(after)) built.hard = false;
        if (options.range) rangeIndexes.push(constraints.length);
        else if (!/\s(?:maximum|max|limit|or (?:less|fewer|more)|at most|minimum|min|exactly)$/i.test(match[0])) {
          bareIndexes.push(constraints.length);
          if (INSTRUCTED_COUNT_BEFORE.test(before) && !PERMITTED_COUNT_BEFORE.test(before) && !NEGATED_COUNT_BEFORE.test(before)
            && !LATER_ADVICE.test(question.slice(end))) instructedIndexes.push(constraints.length);
        }
      }
      const context = `${before.slice(-35)} ${match[0]} ${after.slice(0, 45)}`;
      const scope = /\b(?:each|per)\s+(?:answer|response|field)|\b(?:answer|response|field)\s+each\b/i.test(context) ? "each"
        : /\b(?:total|combined|altogether|across (?:both|all))\b/i.test(context) ? "total" : "answer";
      starts[constraints.length] = start;
      constraints.push({
        ...built, scope, source: match[0],
        ...(scope === "each" && multipleFields ? { unresolvedScope: true as const } : {})
      });
    }
  };
  addMatches(new RegExp(`\\b(?:(about|around|approximately|roughly)\\s+)?(?:between\\s+)?(${NUMBER})\\s*(?:[-–—]|to|and)\\s*(${NUMBER})\\s*[-‐‑]?\\s*${UNIT}\\b`, "gi"), (match) => {
    const min = numberValue(match[2]);
    const max = numberValue(match[3]);
    // "seventy-five words" is one number, not a 70–5 range; leave the span free.
    return min > max ? null : { unit: unitValue(match[4]), min, max, hard: !match[1] };
  }, { bare: true, range: true });
  // A negated comparison runs first and claims its span, so "no longer than
  // 300 words" never reaches the un-negated ceiling rule below.
  const comparison = "(more\\s+than|less\\s+than|fewer\\s+than|longer\\s+than|shorter\\s+than|greater\\s+than|over|above|beyond|under|below|exceed(?:s|ing)?|go\\s+over|go\\s+beyond|fall\\s+below|go\\s+below)";
  addMatches(new RegExp(`\\b${NEGATION_WORDS}${NEGATION_PARENTHETICAL}\\s+${NEGATION_FILLER}${comparison}\\s+(${NUMBER})\\s*[-‐‑]?\\s*${UNIT}\\b`, "gi"), (match) => ({
    unit: unitValue(match[3]),
    ...(/^(?:less|fewer|shorter|under|below)|below$/i.test(match[1]) ? { min: numberValue(match[2]) } : { max: numberValue(match[2]) }),
    hard: true
  }), { bareWhen: (match) => SUFFICIENCY_FILLER.test(match[0].slice(0, match[0].indexOf(match[1]))) });
  addMatches(new RegExp(`\\b(exactly|about|around|approximately|roughly|under|below|no fewer than|no less than|fewer than|less than|at most|no more than|more than|over|above|beyond|exceeds?|exceeding|go(?:es|ing)? (?:over|beyond)|longer than|greater than|up to|maximum(?: of)?|max\\.?|limit(?:ed)?(?: (?:to|of|is))?|cap(?:ped)?(?: (?:at|of))?|within|at least|minimum(?: of)?|min\\.?)\\s*:?\\s*(${NUMBER})\\s*[-‐‑]?\\s*${UNIT}\\b`, "gi"), (match, clause) => {
    const n = numberValue(match[2]);
    const qualifier = match[1].toLowerCase().replace(/\s+/g, " ");
    const approximate = /^(?:about|around|approximately|roughly)$/.test(qualifier);
    const nextCount = clause.after.search(COUNT_PATTERN());
    const penaltyAfter = (nextCount >= 0 ? clause.after.slice(0, nextCount) : clause.after).split(/\b(?:but|though|although|however|while|whereas)\b|,\s*and\b/i)[0];
    const lastCount = [...clause.before.matchAll(COUNT_PATTERN())].pop();
    const penaltyBefore = (lastCount ? clause.before.slice(lastCount.index! + lastCount[0].length) : clause.before).split(/\b(?:and|so|but|though|although|however|while|whereas)\b/i).pop() ?? "";
    const penalised = PENALTY_CLAUSE.test(penaltyAfter) || PENALTY_CLAUSE.test(penaltyBefore);
    if (FLOOR_QUALIFIER.test(qualifier) && FLOOR_PENALTY_AFTER.test(clause.after) && PENALTY_CLAUSE.test(clause.after) && !KEEP_BEFORE.test(clause.before)) {
      return { unit: unitValue(match[3]), min: n, hard: true };
    }
    if (CEILING_QUALIFIER.test(qualifier)) {
      if (NEGATED_BEFORE.test(clause.before) || penalised) return { unit: unitValue(match[3]), max: n, hard: true };
      const instructed = INSTRUCTION_BEFORE.test(clause.before) && !PERMISSIVE_BEFORE.test(clause.before)
        && !NEGATION_IN_CLAUSE.test(clause.before) && !CONDITIONAL_IN_CLAUSE.test(clause.before) && !CONDITIONAL_AFTER.test(clause.after);
      return instructed ? { unit: unitValue(match[3]), min: n + 1, hard: true } : false;
    }
    const bounds = qualifier === "exactly" ? { exact: n }
      : /^(?:at least|no fewer than|no less than|min)/.test(qualifier) ? { min: n }
      : approximate ? { exact: n }
      : { max: /^(?:under|below|fewer|less)/.test(qualifier) ? Math.max(0, n - 1) : n };
    return { unit: unitValue(match[3]), ...bounds, hard: !approximate };
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
  }), { bare: true });
  // A worded hard maximum makes bare counts of its unit advice, and uninstructed
  // bare counts of any unit, as well as an instructed count that sits between
  // two questions with a question break before the cap (it may belong to one
  // question only); an unworded range below a worded maximum of the same unit
  // is advice too.
  const wordedIndexes = constraints.flatMap((other, index) => !bareIndexes.includes(index) && !rangeIndexes.includes(index) && other.hard && (other.max !== undefined || other.exact !== undefined) ? [index] : []);
  const worded = wordedIndexes.map((index) => constraints[index]);
  const separated = (a: number, b: number) => multipleFields
    && FIELD_BREAK.test(question.slice(0, starts[a]))
    && FIELD_BREAK.test(question.slice(starts[a] + constraints[a].source.length))
    && FIELD_BREAK.test(question.slice(Math.min(starts[a], starts[b]) + 1, Math.max(starts[a], starts[b])));
  for (const index of bareIndexes) {
    const bare = constraints[index];
    const instructed = instructedIndexes.includes(index);
    if (wordedIndexes.some((other) => constraints[other].unit === bare.unit || !instructed || separated(index, other))) bare.hard = false;
  }
  for (const index of rangeIndexes) {
    const range = constraints[index];
    if (worded.some((other) => other.unit === range.unit && (other.max ?? other.exact ?? 0) > (range.max ?? 0))) range.hard = false;
  }
  return constraints.filter((constraint) => [constraint.min, constraint.max, constraint.exact].every((n) => n === undefined || (Number.isSafeInteger(n) && n <= 1_000_000))
    && (constraint.min === undefined || constraint.max === undefined || constraint.min <= constraint.max));
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
