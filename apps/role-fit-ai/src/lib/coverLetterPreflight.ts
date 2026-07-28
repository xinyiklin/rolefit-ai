export type CoverLetterSourceMode = "authored_letter" | "guided_draft";

export type CoverLetterPreparationFieldKey =
  | "candidate_name"
  | "role"
  | "company"
  | "recipient_name"
  | "why_role"
  | "lead_experience"
  | "tone";

export type CoverLetterPreparationValues = Partial<
  Record<CoverLetterPreparationFieldKey, string>
>;

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
  placeholders: string[];
  authoredText: string;
  authoredWordCount: number;
  hasCompletedGreeting: boolean;
  missingFields: MissingCoverLetterField[];
  blockingReasons: string[];
  resolved: ResolvedCoverLetterContext;
  values: CoverLetterPreparationValues;
  readyForPreparation: boolean;
  readyToSend: boolean;
};

type BuildCoverLetterPreflightInput = {
  text: string;
  sourceMode: CoverLetterSourceMode;
  candidateName?: string;
  role?: string;
  company?: string;
  values?: CoverLetterPreparationValues;
  date?: string;
};

const BRACKETED_PLACEHOLDER = /\[[^\]\n]{1,240}\]/g;
const MUSTACHE_PLACEHOLDER = /\{\{[^}\n]{1,240}\}\}/g;
const GENERIC_TEMPLATE_TOKEN = /<(?:placeholder|insert|replace)(?:\s[^>]*)?>/gi;
const DIRECT_GREETING = /^\s*Dear\s+([^\n,]+),?/im;
const SIGNOFF_LINE = /^\s*(Sincerely|Best(?: regards)?|Regards|Respectfully|Thank you),?\s*$/im;

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function authoredProseWordCount(text: string): number {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const signoffIndex = lines.findIndex((line) => SIGNOFF_LINE.test(line));
  return wordCount(
    lines
      .filter((line, index) => {
        if (signoffIndex >= 0 && index >= signoffIndex) return false;
        if (/^Dear\b/i.test(line)) return false;
        if (
          /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/i.test(
            line
          )
        ) {
          return false;
        }
        return true;
      })
      .join(" ")
  );
}

export function findCoverLetterPlaceholders(text: string): string[] {
  const matches = [
    ...(text.match(BRACKETED_PLACEHOLDER) ?? []),
    ...(text.match(MUSTACHE_PLACEHOLDER) ?? []),
    ...(text.match(GENERIC_TEMPLATE_TOKEN) ?? [])
  ];
  return [...new Set(matches.map((match) => match.trim()).filter(Boolean))];
}

export function hasUnresolvedCoverLetterTokens(text: string): boolean {
  return /[\[\]]|\{\{|\}\}|<(?:placeholder|insert|replace)(?:\s[^>]*)?>/i.test(text);
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
  return text
    .replace(BRACKETED_PLACEHOLDER, "")
    .replace(MUSTACHE_PLACEHOLDER, "")
    .replace(GENERIC_TEMPLATE_TOKEN, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || /^[,.:;!?()[\]{}<>-]+$/.test(line)) return false;
      if (/^Dear\s*,?$/i.test(line)) return false;
      return true;
    })
    .join("\n")
    .trim();
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
    const name = lines.slice(signoffIndex + 1).find((line) => line && !hasUnresolvedCoverLetterTokens(line));
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
  date
}: BuildCoverLetterPreflightInput): CoverLetterPreflight {
  const resolvedCandidateName = clean(values.candidate_name) || clean(candidateName);
  const resolvedRole = clean(values.role) || clean(role);
  const resolvedCompany = clean(values.company) || clean(company);
  const recipientName = clean(values.recipient_name);
  const resolvedDate =
    clean(date) ||
    new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(
      new Date()
    );
  const greeting = recipientName
    ? `Dear ${recipientName},`
    : resolvedCompany
      ? `Dear ${resolvedCompany} Hiring Team,`
      : "Dear Hiring Team,";
  const placeholders = findCoverLetterPlaceholders(text);
  const authoredText = stripCoverLetterTemplateText(text);
  const authoredWordCount = authoredProseWordCount(authoredText);
  const missingFields: MissingCoverLetterField[] = [];

  if (!resolvedCandidateName) {
    missingFields.push(field("candidate_name", "Candidate name", "Needed for the sign-off."));
  }
  if (!resolvedRole) {
    missingFields.push(field("role", "Role", "The job description did not resolve a role."));
  }
  if (!resolvedCompany) {
    missingFields.push(field("company", "Company", "The job description did not resolve a company."));
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
  if (sourceMode === "guided_draft") {
    if (!clean(values.why_role)) {
      missingFields.push(
        field("why_role", "Why this role?", "Give the draft a genuine motivation in your own words.")
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

  const blockingReasons: string[] = [];
  if (sourceMode === "authored_letter" && authoredWordCount < 80) {
    blockingReasons.push("Write or open at least 80 authored words before polishing.");
  }
  if (sourceMode === "authored_letter" && placeholders.length > 0) {
    blockingReasons.push("Replace every bracketed or template field in the source letter.");
  }
  if (missingFields.some((item) => item.required)) {
    blockingReasons.push("Complete the required tailoring details.");
  }

  const readyForPreparation = blockingReasons.length === 0;
  return {
    sourceMode,
    placeholders,
    authoredText,
    authoredWordCount,
    hasCompletedGreeting: completedGreeting(text),
    missingFields,
    blockingReasons,
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
    readyForPreparation,
    readyToSend:
      sourceMode === "authored_letter" &&
      readyForPreparation &&
      completedGreeting(text) &&
      !hasUnresolvedCoverLetterTokens(text)
  };
}
