import {
  analyzeCoverLetterTemplate,
  templateHasUnresolvedSlots,
  type CoverLetterSourceMode,
  type CoverLetterTemplateAnalysis
} from "./coverLetterTemplate.ts";

export type { CoverLetterSourceMode } from "./coverLetterTemplate.ts";

export type CoverLetterPreparationFieldKey =
  | "candidate_name"
  | "role"
  | "company"
  | "recipient_name"
  | "why_role"
  | "lead_experience"
  | "tone";

export type CoverLetterPreparationValues = Partial<Record<CoverLetterPreparationFieldKey, string>>;

export type MissingCoverLetterField = {
  key: CoverLetterPreparationFieldKey;
  label: string;
  required: boolean;
  reason: string;
  fallback: string | null;
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
  sourceMode: CoverLetterSourceMode;
  template: CoverLetterTemplateAnalysis;
  authoredText: string;
  authoredWordCount: number;
  hasCompletedGreeting: boolean;
  missingFields: MissingCoverLetterField[];
  preparationBlockers: string[];
  resolved: ResolvedCoverLetterContext;
  values: CoverLetterPreparationValues;
  requiresUserVoiceAnchor: boolean;
  canPrepare: boolean;
  sourceReadyToSend: boolean;
};

type BuildCoverLetterPreflightInput = {
  text: string;
  sourceMode: CoverLetterSourceMode;
  candidateName?: string;
  role?: string;
  company?: string;
  values?: CoverLetterPreparationValues;
  slotAnswers?: Record<string, string>;
  date?: string;
};

const DIRECT_GREETING = /^\s*Dear\s+([^\n,]+),?/im;
const SIGNOFF_LINE = /^\s*(Sincerely|Best(?: regards)?|Regards|Respectfully|Thank you),?\s*$/im;

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
  key: CoverLetterPreparationFieldKey,
  label: string,
  reason: string,
  fallback: string | null = null,
  required = true
): MissingCoverLetterField {
  return { key, label, required, reason, fallback };
}

export function buildCoverLetterPreflight({
  text,
  sourceMode,
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
  const recipientName = clean(values.recipient_name);
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
  const authoredText = template.authoredProse;
  const authoredWordCount = template.authoredWordCount;
  const requiresUserVoiceAnchor = sourceMode === "guided_draft" && !template.hasAuthoredVoice;
  const missingFields: MissingCoverLetterField[] = [];

  if (!resolvedCandidateName) {
    missingFields.push(field("candidate_name", "Candidate name", "Needed for the sign-off."));
  }
  if (!resolvedRole) {
    missingFields.push(field("role", "Role", "The job description did not resolve a role."));
  }
  if (!resolvedCompany) {
    missingFields.push(
      field("company", "Company", "The job description did not resolve a company.")
    );
  }
  if (!recipientName) {
    missingFields.push(
      field(
        "recipient_name",
        "Hiring contact",
        "The posting does not name a hiring contact.",
        greeting,
        false
      )
    );
  }
  if (requiresUserVoiceAnchor) {
    if (!clean(values.why_role)) {
      missingFields.push(
        field(
          "why_role",
          "Why this role?",
          "Give the draft a genuine motivation in your own words."
        )
      );
    }
    if (!clean(values.lead_experience)) {
      missingFields.push(
        field(
          "lead_experience",
          "Experience to lead with",
          "Choose one or two verified experiences the letter should emphasize."
        )
      );
    }
  }

  const preparationBlockers: string[] = [];
  if (sourceMode === "authored_letter" && authoredWordCount < 80) {
    preparationBlockers.push("Write or open at least 80 authored words before polishing.");
  }
  for (const slot of template.requiredInputs) {
    preparationBlockers.push(
      slot.resolution.kind === "needs_input"
        ? slot.resolution.question
        : `Complete ${slot.normalizedPrompt}.`
    );
  }
  if (missingFields.some((item) => item.required)) {
    preparationBlockers.push("Complete the required tailoring details.");
  }

  const canPrepare = preparationBlockers.length === 0;
  return {
    sourceMode,
    template,
    authoredText,
    authoredWordCount,
    hasCompletedGreeting: completedGreeting(text),
    missingFields,
    preparationBlockers,
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
    requiresUserVoiceAnchor,
    canPrepare,
    sourceReadyToSend:
      sourceMode === "authored_letter" &&
      canPrepare &&
      coverLetterUsesResolvedCorrespondence(text, {
        candidateName: resolvedCandidateName,
        role: resolvedRole,
        company: resolvedCompany,
        date: resolvedDate,
        recipientName,
        greeting,
        signoff: existingSignoff(text, resolvedCandidateName)
      })
  };
}
