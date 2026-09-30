// "unspecified" is the neutral default: the app asserts NOTHING about
// citizenship, work authorization, or education until the user explicitly opts
// in from Settings. This matters because buildCandidateFactsContext() output is
// fed into the AI request's honestContext, which the server folds into the
// keyword-grounding allowlist (server/ai/sanitize.ts) — so a concrete default
// like "U.S. citizen, clearance-eligible" or "Bachelor's degree" would let an
// unverified citizenship, clearance, work-auth, or credential claim survive into
// resume output for a user who never set it. Anti-fabrication requires every
// default here to claim nothing.
export type CitizenshipStatus = "unspecified" | "us-citizen" | "permanent-resident" | "foreign-national";

// Employment eligibility claims are independent declarations. A boolean
// cannot represent "not answered", so both questions use an explicit neutral
// state and emit evidence only after the user selects yes or no.
export type DeclaredAnswer = "unspecified" | "yes" | "no";

export const DECLARED_ANSWER_OPTIONS: { value: DeclaredAnswer; label: string }[] = [
  { value: "unspecified", label: "Not specified" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" }
];

// Highest completed level of education. Same opt-in contract as citizenship: an
// unset value emits no line, so the model is never told the candidate holds a
// credential they did not declare. A degree is one of the easiest things for a
// resume model to invent, so this is declared-only and never inferred from the
// resume text.
export type EducationLevel =
  | "unspecified"
  | "high-school"
  | "associate"
  | "bachelor"
  | "master"
  | "doctorate"
  | "professional";

// "unspecified" is intentionally NOT a selectable option in either list below:
// it stays the neutral DEFAULT (asserts nothing — see the file header) and is
// rendered as a disabled placeholder in the select. Keeping it out of these
// lists removes "Prefer not to say" from the dropdowns without letting the
// default assert a fact. settings.ts still treats "unspecified" as valid.
export const CITIZENSHIP_OPTIONS: { value: CitizenshipStatus; label: string }[] = [
  { value: "us-citizen", label: "U.S. citizen" },
  { value: "permanent-resident", label: "Permanent resident" },
  { value: "foreign-national", label: "Foreign national" }
];

export const EDUCATION_LEVEL_OPTIONS: { value: EducationLevel; label: string }[] = [
  { value: "high-school", label: "High school / GED" },
  { value: "associate", label: "Associate degree" },
  { value: "bachelor", label: "Bachelor's degree" },
  { value: "master", label: "Master's degree" },
  { value: "doctorate", label: "Doctorate (PhD)" },
  { value: "professional", label: "Professional degree (JD, MD, …)" }
];

// Free-text field of study. Capped because it reaches a prompt; the cap is
// generous enough for a real double major.
export const MAJOR_MAX_LENGTH = 120;

// GPA is an optional 4.0-scale fact attached to a declared education level.
// It stays numeric and bounded because the value reaches provider prompts.
export function normalizeCandidateGpa(gpa: unknown): number | null {
  if (
    typeof gpa !== "number"
    || !Number.isFinite(gpa)
    || gpa < 0
    || gpa > 4
  ) {
    return null;
  }
  return Math.round(gpa * 100) / 100;
}

// Availability is scheduling context, not experience or a fit label. A
// concrete date is accepted only when its calendar components round-trip so a
// value such as 2026-02-31 cannot become provider-groundable evidence.
export type AvailabilityNotice =
  | "unspecified"
  | "immediately"
  | "one-week"
  | "two-weeks"
  | "three-weeks"
  | "four-weeks"
  | "specific-date";

export const AVAILABILITY_NOTICE_OPTIONS: { value: AvailabilityNotice; label: string }[] = [
  { value: "unspecified", label: "Not specified" },
  { value: "immediately", label: "Immediately" },
  { value: "one-week", label: "After 1 week's notice" },
  { value: "two-weeks", label: "After 2 weeks' notice" },
  { value: "three-weeks", label: "After 3 weeks' notice" },
  { value: "four-weeks", label: "After 4 weeks' notice" },
  { value: "specific-date", label: "On a specific date" }
];

export function normalizeAvailabilityDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return undefined;
  }
  return value;
}

export type CandidateFacts = {
  citizenshipStatus: CitizenshipStatus;
  legallyAuthorizedToWork: DeclaredAnswer;
  requiresSponsorship: DeclaredAnswer;
  educationLevel: EducationLevel;
  major: string;
  gpa?: number;
  availabilityNotice?: AvailabilityNotice;
  availabilityDate?: string;
};

const CITIZENSHIP_CONTEXT: Record<CitizenshipStatus, string> = {
  unspecified: "",
  "us-citizen": "Citizenship: U.S. citizen.",
  "permanent-resident": "Citizenship: U.S. permanent resident.",
  "foreign-national": "Citizenship: foreign national."
};

const EDUCATION_CONTEXT: Record<EducationLevel, string> = {
  unspecified: "",
  "high-school": "Education: highest completed level is a high school diploma or GED.",
  associate: "Education: highest completed level is an associate degree.",
  bachelor: "Education: highest completed level is a bachelor's degree.",
  master: "Education: highest completed level is a master's degree.",
  doctorate: "Education: highest completed level is a doctorate (PhD).",
  professional: "Education: highest completed level is a professional degree (for example JD or MD)."
};

const AVAILABILITY_CONTEXT: Partial<Record<AvailabilityNotice, string>> = {
  immediately: "Availability: can start immediately.",
  "one-week": "Availability: can start after one week of notice.",
  "two-weeks": "Availability: can start after two weeks of notice.",
  "three-weeks": "Availability: can start after three weeks of notice.",
  "four-weeks": "Availability: can start after four weeks of notice."
};

// Every eligibility answer is independent. Citizenship never infers work
// authorization, sponsorship, or clearance eligibility; each emitted line is
// exactly one fact the user selected.
export function buildCandidateFactsContext(facts: CandidateFacts): string {
  const lines: string[] = [];
  const citizenshipLine = CITIZENSHIP_CONTEXT[facts.citizenshipStatus];
  if (citizenshipLine) lines.push(citizenshipLine);
  if (facts.legallyAuthorizedToWork === "yes") {
    lines.push("Work authorization: legally authorized to work in the United States.");
  } else if (facts.legallyAuthorizedToWork === "no") {
    lines.push("Work authorization: not currently authorized to work in the United States.");
  }
  if (facts.requiresSponsorship === "yes") {
    lines.push("Visa sponsorship: will require employer visa sponsorship now or in the future.");
  } else if (facts.requiresSponsorship === "no") {
    lines.push("Visa sponsorship: does not require employer visa sponsorship now or in the future.");
  }
  // Education is gated POSITIVELY — on a known level producing a line — rather
  // than on `!== "unspecified"`. An absent, undefined, or out-of-union level yields no
  // line and therefore no education block at all, so corrupted storage cannot
  // slip a bare field of study through as an implied credential.
  const educationLine = EDUCATION_CONTEXT[facts.educationLevel];
  if (educationLine) {
    lines.push(educationLine);
    // A field of study without a level would assert a credential by implication,
    // so it rides along with the level rather than standing alone.
    const major = (facts.major ?? "").trim().slice(0, MAJOR_MAX_LENGTH);
    if (major) lines.push(`Field of study: ${major}.`);
    const normalizedGpa = normalizeCandidateGpa(facts.gpa);
    if (normalizedGpa !== null) lines.push(`GPA: ${normalizedGpa} on a 4.0 scale.`);
  }
  const availabilityNotice = facts.availabilityNotice ?? "unspecified";
  if (availabilityNotice === "specific-date") {
    const availabilityDate = normalizeAvailabilityDate(facts.availabilityDate);
    if (availabilityDate) lines.push(`Availability: earliest available start date is ${availabilityDate}.`);
  } else {
    const availabilityLine = AVAILABILITY_CONTEXT[availabilityNotice];
    if (availabilityLine) lines.push(availabilityLine);
  }
  const declared = lines.filter(Boolean);
  if (!declared.length) return "";
  return `Candidate facts:\n${declared.map((line) => `- ${line}`).join("\n")}`;
}

export function mergeHonestContext(honestContext: string, candidateFactsContext: string): string {
  const parts = [candidateFactsContext.trim(), honestContext.trim()].filter(Boolean);
  return parts.join("\n\n");
}
