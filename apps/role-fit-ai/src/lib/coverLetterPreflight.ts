import {
  analyzeCoverLetterTemplate,
  templateHasUnresolvedSlots,
  type CoverLetterTemplateAnalysis,
  type CoverLetterTemplateSlot
} from "./coverLetterTemplate.ts";

// Only facts RoleFit genuinely cannot resolve on its own. Everything a model can
// derive from the posting, the resume, or honest context is generated, not asked.
export type CoverLetterDetailKey = "candidate_name" | "role" | "company";

export type CoverLetterDetailValues = Partial<Record<CoverLetterDetailKey, string>>;

export type MissingCoverLetterField = {
  key: CoverLetterDetailKey;
  label: string;
  reason: string;
};

export type ResolvedCoverLetterContext = {
  candidateName: string;
  role: string;
  company: string;
  date: string;
  recipientName: string;
  greeting: string;
  signoff: string;
};

export type CoverLetterPreflight = {
  template: CoverLetterTemplateAnalysis;
  authoredText: string;
  authoredWordCount: number;
  hasCompletedGreeting: boolean;
  missingFields: MissingCoverLetterField[];
  // Template slots naming a private fact RoleFit cannot infer (a referral, a
  // prior personal relationship). These are the only slots that block Tailor.
  privateSlots: CoverLetterTemplateSlot[];
  blockers: string[];
  resolved: ResolvedCoverLetterContext;
  values: CoverLetterDetailValues;
  canTailor: boolean;
};

type BuildCoverLetterPreflightInput = {
  text: string;
  candidateName?: string;
  role?: string;
  company?: string;
  values?: CoverLetterDetailValues;
  slotAnswers?: Record<string, string>;
  date?: string;
};

const DIRECT_GREETING = /^\s*Dear\s+([^\n,]+),?/im;
const SIGNOFF_LINE = /^\s*(Sincerely|Best(?: regards)?|Regards|Respectfully|Thank you),?\s*$/im;
// A greeting that names no person: it carries no recipient to preserve.
const IMPERSONAL_RECIPIENT =
  /^(?:hiring|recruit|talent|people|to whom|sir|madam|team\b)|\b(?:hiring team|hiring manager|hiring committee|recruiting team|search committee)\b/i;

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function findCoverLetterPlaceholders(text: string): string[] {
  return [...new Set(analyzeCoverLetterTemplate({ text }).slots.map((slot) => slot.raw))];
}

export function hasUnresolvedCoverLetterTokens(text: string): boolean {
  return templateHasUnresolvedSlots(text);
}

export function coverLetterUsesResolvedCorrespondence(
  text: string,
  resolved: ResolvedCoverLetterContext
): boolean {
  if (hasUnresolvedCoverLetterTokens(text)) return false;
  const normalized = text.replace(/\r\n/g, "\n");
  const greetingCount = normalized
    .split("\n")
    .filter((line) => line.trim().toLowerCase() === resolved.greeting.trim().toLowerCase()).length;
  const signoffPresent = normalized.toLowerCase().includes(resolved.signoff.toLowerCase());
  const datePresent = normalized
    .split("\n")
    .some((line) => line.trim().toLowerCase() === resolved.date.trim().toLowerCase());
  return greetingCount === 1 && signoffPresent && datePresent;
}

export function stripCoverLetterTemplateText(text: string): string {
  return analyzeCoverLetterTemplate({ text }).authoredProse;
}

function completedGreeting(text: string): boolean {
  const match = text.slice(0, 500).match(DIRECT_GREETING);
  return Boolean(match?.[1]?.trim()) && !hasUnresolvedCoverLetterTokens(match?.[0] ?? "");
}

// A recipient the writer already named survives tailoring. Without one the
// greeting falls back to the company hiring team — never a question.
function authoredRecipient(text: string): string {
  const match = text.slice(0, 500).match(DIRECT_GREETING);
  const name = clean(match?.[1]);
  if (!name || hasUnresolvedCoverLetterTokens(name) || IMPERSONAL_RECIPIENT.test(name)) return "";
  return name;
}

function existingSignoff(text: string, candidateName: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const signoffIndex = lines.findIndex((line) => SIGNOFF_LINE.test(line));
  if (signoffIndex >= 0) {
    const closing = lines[signoffIndex];
    const name = lines
      .slice(signoffIndex + 1)
      .find((line) => line && !hasUnresolvedCoverLetterTokens(line));
    if (candidateName || name) {
      return `${closing.replace(/,?$/, ",")}\n${candidateName || name}`;
    }
  }
  return `Sincerely,${candidateName ? `\n${candidateName}` : ""}`;
}

function field(
  key: CoverLetterDetailKey,
  label: string,
  reason: string
): MissingCoverLetterField {
  return { key, label, reason };
}

// Resolves everything a tailoring request needs and reports only the facts that
// genuinely cannot be resolved. A blank document, a bare template, or a letter
// full of generative prompts is tailorable; a missing employer is not.
export function buildCoverLetterPreflight({
  text,
  candidateName,
  role,
  company,
  values = {},
  slotAnswers = {},
  date
}: BuildCoverLetterPreflightInput): CoverLetterPreflight {
  const resolvedCandidateName = clean(values.candidate_name) || clean(candidateName);
  const resolvedRole = clean(values.role) || clean(role);
  const resolvedCompany = clean(values.company) || clean(company);
  const recipientName = authoredRecipient(text);
  const resolvedDate =
    clean(date) ||
    new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(new Date());
  const greeting = recipientName
    ? `Dear ${recipientName},`
    : resolvedCompany
      ? `Dear ${resolvedCompany} Hiring Team,`
      : "Dear Hiring Team,";
  const template = analyzeCoverLetterTemplate({
    text,
    candidateName: resolvedCandidateName,
    role: resolvedRole,
    company: resolvedCompany,
    recipientName,
    date: resolvedDate,
    slotAnswers
  });
  const missingFields: MissingCoverLetterField[] = [];

  if (!resolvedCandidateName) {
    missingFields.push(
      field("candidate_name", "Your name", "No name was found in the resume for the sign-off.")
    );
  }
  if (!resolvedRole) {
    missingFields.push(field("role", "Role", "The job description did not resolve a role title."));
  }
  if (!resolvedCompany) {
    missingFields.push(field("company", "Company", "The job description did not resolve a company."));
  }

  const blockers: string[] = [
    ...missingFields.map((item) => item.reason),
    ...template.requiredInputs.map((slot) =>
      slot.resolution.kind === "needs_input"
        ? slot.resolution.question
        : `Answer ${slot.normalizedPrompt}.`
    )
  ];

  return {
    template,
    authoredText: template.authoredProse,
    authoredWordCount: template.authoredWordCount,
    hasCompletedGreeting: completedGreeting(text),
    missingFields,
    privateSlots: template.userInputSlots,
    blockers,
    resolved: {
      candidateName: resolvedCandidateName,
      role: resolvedRole,
      company: resolvedCompany,
      date: resolvedDate,
      recipientName,
      greeting,
      signoff: existingSignoff(text, resolvedCandidateName)
    },
    values,
    canTailor: blockers.length === 0
  };
}
