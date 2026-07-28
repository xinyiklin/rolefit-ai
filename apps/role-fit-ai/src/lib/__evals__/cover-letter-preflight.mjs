import assert from "node:assert/strict";

import {
  buildCoverLetterPreflight,
  coverLetterUsesResolvedCorrespondence,
  findCoverLetterPlaceholders,
  hasUnresolvedCoverLetterTokens
} from "../coverLetterPreflight.ts";

const starter = `[Date]

Dear [Hiring manager],

[Name the role and explain, in your own words, why it interests you.]

[Connect one or two verified experiences from your resume to the role.]

[Explain why this company or team is a fit.]

Sincerely,
[Your name]`;

const placeholders = findCoverLetterPlaceholders(starter);
assert.equal(placeholders.length, 6, "every bracketed starter instruction is detected");
assert(placeholders.includes("[Hiring manager]"), "the hiring-manager field is detected");
assert(
  placeholders.some((item) => item.startsWith("[Connect one or two")),
  "natural-language starter instructions are detected"
);

const guided = buildCoverLetterPreflight({
  text: starter,
  sourceMode: "guided_draft",
  candidateName: "Xinyi Lin",
  role: "Software Engineer",
  company: "Acme",
  date: "July 28, 2026"
});
assert.equal(guided.authoredWordCount, 0, "starter instructions and sign-off boilerplate do not count as authored prose");
assert.equal(guided.hasCompletedGreeting, false, "Dear [Hiring manager] is not a completed greeting");
assert.equal(guided.readyForPreparation, false, "starter-only content cannot enter drafting");
assert.deepEqual(
  guided.missingFields.filter((item) => item.required).map((item) => item.key),
  ["why_role", "lead_experience"],
  "guided drafting asks for the two required candidate inputs"
);
assert.deepEqual(
  guided.missingFields.find((item) => item.key === "recipient_name"),
  {
    key: "recipient_name",
    label: "Hiring contact",
    required: false,
    reason: "The posting does not name a hiring contact.",
    fallback: "Dear Acme Hiring Team,"
  },
  "the optional recipient has an explicit safe fallback"
);
assert.equal(guided.resolved.greeting, "Dear Acme Hiring Team,", "missing recipient uses a safe company fallback");
assert.equal(guided.resolved.date, "July 28, 2026", "the supplied deterministic date is preserved");

const readyGuided = buildCoverLetterPreflight({
  text: starter,
  sourceMode: "guided_draft",
  candidateName: "Xinyi Lin",
  role: "Software Engineer",
  company: "Acme",
  date: "July 28, 2026",
  values: {
    why_role: "I want to build practical tools with a small product team.",
    lead_experience: "Lead with my verified end-to-end Careflow delivery work."
  }
});
assert.equal(readyGuided.readyForPreparation, true, "candidate answers unlock guided drafting");
assert.equal(readyGuided.readyToSend, false, "a guided starter is never itself send-ready");

const authoredText = `July 28, 2026

Dear Acme Hiring Team,

${"I build dependable product software with careful attention to users and delivery. ".repeat(9)}

Sincerely,
Xinyi Lin`;
const authored = buildCoverLetterPreflight({
  text: authoredText,
  sourceMode: "authored_letter",
  candidateName: "Xinyi Lin",
  role: "Software Engineer",
  company: "Acme",
  date: "July 28, 2026"
});
assert(authored.authoredWordCount >= 80, "authored readiness counts genuine words");
assert.equal(authored.readyForPreparation, true, "a complete authored letter can be polished");
assert.equal(authored.readyToSend, true, "complete authored prose with a greeting can be send-ready");
assert.equal(
  buildCoverLetterPreflight({
    text: authoredText.replace("Xinyi Lin", "Another Person"),
    sourceMode: "authored_letter",
    candidateName: "Xinyi Lin",
    role: "Software Engineer",
    company: "Acme",
    date: "July 28, 2026"
  }).resolved.signoff,
  "Sincerely,\nXinyi Lin",
  "the resolved candidate identity replaces a stale imported sign-off name"
);
assert.equal(hasUnresolvedCoverLetterTokens("Dear {{recipient}},"), true, "mustache tokens fail the invariant");
assert.equal(hasUnresolvedCoverLetterTokens("Dear Hiring Team,"), false, "resolved correspondence passes");
assert.equal(
  coverLetterUsesResolvedCorrespondence(authoredText, authored.resolved),
  true,
  "a ready result contains the exact resolved date, greeting, and sign-off"
);
assert.equal(
  coverLetterUsesResolvedCorrespondence(
    authoredText.replace("Dear Acme Hiring Team,", "Dear [Hiring manager],"),
    authored.resolved
  ),
  false,
  "a placeholder greeting can never satisfy ready correspondence"
);

console.log("cover-letter deterministic preflight probes: PASS");
