// "unspecified" is the neutral default: the app asserts NOTHING about
// citizenship or work authorization until the user explicitly opts in via the
// Options menu. This matters because buildCandidateFactsContext() output is fed
// into the AI request's honestContext, which the server folds into the
// keyword-grounding allowlist (server/ai/sanitize.ts) — so a concrete default
// like "U.S. citizen, clearance-eligible" would let an unverified
// citizenship/clearance/work-auth claim survive into resume output for a user
// who never set it. Anti-fabrication requires the default to claim nothing.
export type CitizenshipStatus = "unspecified" | "us-citizen" | "permanent-resident" | "foreign-national";

// "unspecified" is intentionally NOT a selectable option here: it stays the
// neutral DEFAULT (asserts nothing — see the file header) and is rendered as a
// disabled "Not specified" placeholder in the select (PolishMenu). Keeping it out
// of this list removes "Prefer not to say" from the dropdown without letting the
// default assert a citizenship. settings.ts still treats "unspecified" as valid.
export const CITIZENSHIP_OPTIONS: { value: CitizenshipStatus; label: string }[] = [
  { value: "us-citizen", label: "U.S. citizen" },
  { value: "permanent-resident", label: "Permanent resident" },
  { value: "foreign-national", label: "Foreign national" }
];

export type CandidateFacts = {
  citizenshipStatus: CitizenshipStatus;
  legallyAuthorizedToWork: boolean;
  requiresSponsorship: boolean;
};

const CITIZENSHIP_CONTEXT: Record<CitizenshipStatus, string> = {
  unspecified: "",
  "us-citizen": "Citizenship: U.S. citizen; eligible for security clearances and positions requiring U.S. citizenship.",
  "permanent-resident": "Citizenship: U.S. permanent resident (green card holder); authorized to work, but not eligible for positions requiring U.S. citizenship or security clearances.",
  "foreign-national": "Citizenship: foreign national; not a U.S. citizen or permanent resident."
};

// Returns "" until the user picks a citizenship status — citizenship is the
// opt-in gate for the whole work-authorization block, so nothing is asserted to
// the model (or added to the grounding allowlist) by default.
export function buildCandidateFactsContext(facts: CandidateFacts): string {
  if (facts.citizenshipStatus === "unspecified") return "";
  const lines = [
    CITIZENSHIP_CONTEXT[facts.citizenshipStatus],
    facts.legallyAuthorizedToWork
      ? "Work authorization: legally authorized to work in the United States."
      : "Work authorization: not currently authorized to work in the United States.",
    facts.requiresSponsorship
      ? "Visa sponsorship: will require employer visa sponsorship now or in the future."
      : "Visa sponsorship: does not require employer visa sponsorship now or in the future."
  ].filter(Boolean);
  return `Candidate facts:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

export function mergeHonestContext(honestContext: string, candidateFactsContext: string): string {
  const parts = [candidateFactsContext.trim(), honestContext.trim()].filter(Boolean);
  return parts.join("\n\n");
}
