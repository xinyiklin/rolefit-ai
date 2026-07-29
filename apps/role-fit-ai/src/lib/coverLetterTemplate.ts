export type CoverLetterTemplateSlotResolution =
  | {
      kind: "deterministic";
      field: "date" | "recipient" | "candidate_name" | "company" | "role";
      value: string;
    }
  | {
      kind: "generate";
      source:
        | "job_context"
        | "candidate_evidence"
        | "job_and_candidate"
        | "unclassified";
    }
  | {
      kind: "needs_input";
      question: string;
    };

export type CoverLetterTemplateSlot = {
  id: string;
  raw: string;
  normalizedPrompt: string;
  paragraphIndex: number;
  occurrence: number;
  resolution: CoverLetterTemplateSlotResolution;
};

export type CoverLetterTemplateSegment =
  { kind: "prose"; text: string } | { kind: "slot"; slotId: string };

export type CoverLetterTemplateAnalysis = {
  authoredProse: string;
  authoredWordCount: number;
  structuredTemplate: Array<{
    paragraphIndex: number;
    segments: CoverLetterTemplateSegment[];
  }>;
  slots: CoverLetterTemplateSlot[];
  // Slots that name a genuinely private fact (a referral, a prior personal
  // relationship). Everything else is generative and never blocks Tailor.
  userInputSlots: CoverLetterTemplateSlot[];
  requiredInputs: CoverLetterTemplateSlot[];
  hasAuthoredVoice: boolean;
};

export type CoverLetterSourceContext = {
  rawTemplateText: string;
  structuredTemplate: CoverLetterTemplateAnalysis["structuredTemplate"];
  authoredProse: string;
  slots: CoverLetterTemplateSlot[];
};

export type AnalyzeCoverLetterTemplateInput = {
  text: string;
  date?: string;
  recipientName?: string;
  candidateName?: string;
  company?: string;
  role?: string;
  slotAnswers?: Record<string, string>;
};

const TEMPLATE_TOKEN =
  /\[[^\]\r\n]{1,240}\]|\{\{[^}\r\n]{1,240}\}\}|<(?:placeholder|insert|replace)(?:\s[^>]*)?>/gi;
const SIGNOFF_LINE =
  /^(?:Sincerely|Best(?: regards)?|Regards|Respectfully|Thank you),?\s*$/i;
const DATE_LINE =
  /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/i;
// A voice-classification signal only: enough authored prose that the model
// should preserve the writer's idiom rather than compose from scratch. It never
// decides whether tailoring is allowed.
export const COVER_LETTER_AUTHORED_VOICE_WORDS = 80;

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function coverLetterHasAuthoredVoice(text: string): boolean {
  return (
    clean(text).split(/\s+/).filter(Boolean).length >=
    COVER_LETTER_AUTHORED_VOICE_WORDS
  );
}

function normalizePrompt(raw: string): string {
  return raw
    .replace(/^\[\s*|\s*\]$/g, "")
    .replace(/^\{\{\s*|\s*\}\}$/g, "")
    .replace(/^<(?:placeholder|insert|replace)\b|\s*\/?>$/gi, "")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function isLiteralBracketMatch(
  text: string,
  start: number,
  raw: string,
): boolean {
  if (!raw.startsWith("[")) return false;
  if (start > 0 && text[start - 1] === "\\") return true;
  const end = start + raw.length;
  if (text[end] === "(") return true;
  if (start > 0 && /[A-Za-z0-9_$\])]/.test(text[start - 1] ?? "")) return true;
  const prompt = normalizePrompt(raw);
  return /^\d+(?:[,\s-]\d+)*$/.test(prompt);
}

function slotResolution(
  normalizedPrompt: string,
  context: AnalyzeCoverLetterTemplateInput,
): CoverLetterTemplateSlotResolution {
  const prompt = normalizedPrompt.toLowerCase();
  if (/^(?:the\s+)?date$/.test(prompt)) {
    return { kind: "deterministic", field: "date", value: clean(context.date) };
  }
  if (
    /^(?:your|candidate(?:'s)?|applicant(?:'s)?)\s+(?:full\s+)?name$/.test(
      prompt,
    ) ||
    /^(?:candidate|applicant)\s+name$/.test(prompt)
  ) {
    return {
      kind: "deterministic",
      field: "candidate_name",
      value: clean(context.candidateName),
    };
  }
  if (
    /^(?:the\s+)?(?:company|company name|employer|employer name|organization)$/.test(
      prompt,
    )
  ) {
    return {
      kind: "deterministic",
      field: "company",
      value: clean(context.company),
    };
  }
  if (
    /^(?:the\s+)?(?:exact\s+)?(?:position|position title|job title|role|role title)$/.test(
      prompt,
    )
  ) {
    return { kind: "deterministic", field: "role", value: clean(context.role) };
  }
  // A recipient is never asked for: an authored greeting supplies one, and the
  // company hiring team is always a correct fallback.
  if (
    /^(?:(?:the\s+)?hiring (?:manager|team|contact|committee)(?:'s)?(?: name)?(?: or hiring team)?|recipient(?: name)?)$/.test(
      prompt,
    )
  ) {
    const recipient = clean(context.recipientName);
    const company = clean(context.company);
    return {
      kind: "deterministic",
      field: "recipient",
      value: recipient
        ? `Dear ${recipient},`
        : `Dear ${company ? `${company} ` : ""}Hiring Team,`,
    };
  }
  if (
    /\b(?:referral|referred by|referrer's?|personal relationship|prior relationship|private personal reason)\b/.test(
      prompt,
    )
  ) {
    return {
      kind: "needs_input",
      question: `Provide the private factual detail requested by ${normalizedPrompt}.`,
    };
  }

  const jobContext =
    /\b(?:job description|job posting|posting|company|employer|product|mission|team|problem|responsibilit|role requirement|their work)\b/.test(
      prompt,
    );
  if (/^(?:the\s+)?(?:job description|job posting|posting)$/.test(prompt)) {
    return { kind: "generate", source: "job_context" };
  }
  const candidateContext =
    /\b(?:candidate|your|you did|experience|project|job|connection|achievement|accomplishment|skill|background|work you)\b/.test(
      prompt,
    );
  if (
    (jobContext && candidateContext) ||
    /\bwhy (?:this|the) (?:company|role|position|team)\b/.test(prompt) ||
    /\b(?:fit|connect)\b.*\b(?:company|role|posting|team)\b/.test(prompt)
  ) {
    return { kind: "generate", source: "job_and_candidate" };
  }
  if (candidateContext)
    return { kind: "generate", source: "candidate_evidence" };
  if (jobContext) return { kind: "generate", source: "job_context" };
  // Wording RoleFit has not seen before stays generative: the model classifies
  // it from its actual text. Unfamiliar is not the same as private.
  return { kind: "generate", source: "unclassified" };
}

function proseWithoutCorrespondence(text: string): string {
  const lines = text
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\\([\[\]])/g, "$1")
        .replace(/\s+/g, " ")
        .trim(),
    );
  const signoffIndex = lines.findIndex((line) => SIGNOFF_LINE.test(line));
  return lines
    .filter((line, index) => {
      if (!line || (signoffIndex >= 0 && index >= signoffIndex)) return false;
      if (/^Dear\b/i.test(line) || DATE_LINE.test(line)) return false;
      return !/^[,.:;!?()[\]{}<>-]+$/.test(line);
    })
    .join("\n")
    .trim();
}

export function analyzeCoverLetterTemplate(
  input: AnalyzeCoverLetterTemplateInput,
): CoverLetterTemplateAnalysis {
  const text = String(input.text ?? "").replace(/\r\n/g, "\n");
  const paragraphs = text.split(/\n{2,}/);
  const slots: CoverLetterTemplateSlot[] = [];
  const structuredTemplate: CoverLetterTemplateAnalysis["structuredTemplate"] =
    [];
  const occurrences = new Map<string, number>();
  const proseParagraphs: string[] = [];
  const userInputSlots: CoverLetterTemplateSlot[] = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const segments: CoverLetterTemplateSegment[] = [];
    let cursor = 0;
    let prose = "";
    TEMPLATE_TOKEN.lastIndex = 0;
    for (const match of paragraph.matchAll(TEMPLATE_TOKEN)) {
      const raw = match[0];
      const start = match.index ?? 0;
      if (isLiteralBracketMatch(paragraph, start, raw)) continue;
      const before = paragraph.slice(cursor, start);
      if (before) {
        segments.push({ kind: "prose", text: before });
        prose += before;
      }
      const normalizedPrompt = normalizePrompt(raw);
      const key = normalizedPrompt.toLowerCase();
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      const id = `slot:${paragraphIndex}:${occurrence}:${fnv1a(key)}`;
      const classifiedResolution = slotResolution(normalizedPrompt, input);
      const suppliedAnswer = clean(input.slotAnswers?.[id]);
      const slot: CoverLetterTemplateSlot = {
        id,
        raw,
        normalizedPrompt,
        paragraphIndex,
        occurrence,
        resolution:
          classifiedResolution.kind === "needs_input" && suppliedAnswer
            ? { kind: "generate", source: "candidate_evidence" }
            : classifiedResolution,
      };
      if (classifiedResolution.kind === "needs_input") {
        userInputSlots.push({
          ...slot,
          resolution: classifiedResolution,
        });
      }
      slots.push(slot);
      segments.push({ kind: "slot", slotId: id });
      cursor = start + raw.length;
    }
    const after = paragraph.slice(cursor);
    if (after) {
      segments.push({ kind: "prose", text: after });
      prose += after;
    }
    structuredTemplate.push({ paragraphIndex, segments });
    proseParagraphs.push(prose);
  });

  const authoredProse = proseWithoutCorrespondence(
    proseParagraphs.join("\n\n"),
  );
  const authoredWordCount = authoredProse
    ? authoredProse.split(/\s+/).filter(Boolean).length
    : 0;
  const hasAuthoredVoice = coverLetterHasAuthoredVoice(authoredProse);
  return {
    authoredProse,
    authoredWordCount,
    structuredTemplate,
    slots,
    userInputSlots,
    requiredInputs: userInputSlots.filter(
      (slot) => !clean(input.slotAnswers?.[slot.id]),
    ),
    hasAuthoredVoice,
  };
}

export function templateHasUnresolvedSlots(text: string): boolean {
  return analyzeCoverLetterTemplate({ text }).slots.length > 0;
}
