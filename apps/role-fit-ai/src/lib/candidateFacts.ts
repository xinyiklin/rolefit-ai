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

export type CandidateFacts = {
  citizenshipStatus: CitizenshipStatus;
  legallyAuthorizedToWork: boolean;
  requiresSponsorship: boolean;
  educationLevel: EducationLevel;
  major: string;
};

const CITIZENSHIP_CONTEXT: Record<CitizenshipStatus, string> = {
  unspecified: "",
  "us-citizen": "Citizenship: U.S. citizen; eligible for security clearances and positions requiring U.S. citizenship.",
  "permanent-resident": "Citizenship: U.S. permanent resident (green card holder); authorized to work, but not eligible for positions requiring U.S. citizenship or security clearances.",
  "foreign-national": "Citizenship: foreign national; not a U.S. citizen or permanent resident."
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

// Two independent opt-in blocks. Citizenship gates the work-authorization lines
// (authorization and sponsorship are meaningless without it), and education
// gates its own two lines. Declaring one must not force or suppress the other,
// so neither block short-circuits the whole function.
export function buildCandidateFactsContext(facts: CandidateFacts): string {
  const lines: string[] = [];
  if (facts.citizenshipStatus !== "unspecified") {
    lines.push(
      CITIZENSHIP_CONTEXT[facts.citizenshipStatus],
      facts.legallyAuthorizedToWork
        ? "Work authorization: legally authorized to work in the United States."
        : "Work authorization: not currently authorized to work in the United States.",
      facts.requiresSponsorship
        ? "Visa sponsorship: will require employer visa sponsorship now or in the future."
        : "Visa sponsorship: does not require employer visa sponsorship now or in the future."
    );
  }
  // Education is gated POSITIVELY — on a known level producing a line — rather
  // than on `!== "unspecified"`. That is deliberately stricter than the
  // citizenship gate above: an absent, undefined, or out-of-union level yields no
  // line and therefore no education block at all, so corrupted storage cannot
  // slip a bare field of study through as an implied credential.
  const educationLine = EDUCATION_CONTEXT[facts.educationLevel];
  if (educationLine) {
    lines.push(educationLine);
    // A field of study without a level would assert a credential by implication,
    // so it rides along with the level rather than standing alone.
    const major = (facts.major ?? "").trim().slice(0, MAJOR_MAX_LENGTH);
    if (major) lines.push(`Field of study: ${major}.`);
  }
  const declared = lines.filter(Boolean);
  if (!declared.length) return "";
  return `Candidate facts:\n${declared.map((line) => `- ${line}`).join("\n")}`;
}

export function mergeHonestContext(honestContext: string, candidateFactsContext: string): string {
  const parts = [candidateFactsContext.trim(), honestContext.trim()].filter(Boolean);
  return parts.join("\n\n");
}
