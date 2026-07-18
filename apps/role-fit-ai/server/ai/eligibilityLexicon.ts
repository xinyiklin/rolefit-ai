// Work-authorization lexicon used only to ground the AI distiller's workAuth
// field against source job text. Fit scoring and eligibility verdicts belong to
// AI Review; there is no local blocker or seniority-bucket judge here.

// Work-auth stems the distiller may keep in a grounded workAuth field. Consumed
// by groundedWorkAuth (distill.ts): the model's value must name one of these AND
// the same stem must appear in the source posting, else the field is dropped as
// invented.
export const AUTH_STEMS = [
  "clearance", "citizen", "visa", "sponsor", "authoriz", "authoris",
  "green card", "permanent resident", "eligible to work", "work auth",
  "polygraph", "ts/sci", "naturaliz", "ead"
];

// Whole-word-START match for an auth stem: the stem must begin at a non-
// alphanumeric boundary, but any SUFFIX is allowed. The boundary stops a short
// stem from matching mid-word ("ead" must NOT match inside lead/read/ahead/
// deadline — a substring check kept an invented "EAD required" on nearly every
// posting and misclassified "Lead engineer, ready to start" as an auth
// statement), while the open suffix keeps same-concept inflections grounding
// (sponsor→sponsorship, authoriz→authorization, citizen→citizenship). Mirrors
// groundedTech's boundary discipline.
export function mentionsAuthStem(text: string, stem: string): boolean {
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`(?:^|[^a-z0-9])${esc}`, "i").test(text);
}
