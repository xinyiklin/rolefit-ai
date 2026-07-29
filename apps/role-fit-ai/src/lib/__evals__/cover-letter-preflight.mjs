import assert from "node:assert/strict";

import {
  buildCoverLetterPreflight,
  coverLetterUsesResolvedCorrespondence,
  findCoverLetterPlaceholders,
  hasUnresolvedCoverLetterTokens,
} from "../coverLetterPreflight.ts";
import { analyzeCoverLetterTemplate } from "../coverLetterTemplate.ts";

const starter = `[Date]

Dear [Hiring manager],

[Name the role and explain, in your own words, why it interests you.]

[Connect one or two verified experiences from your resume to the role.]

[Explain why this company or team is a fit, using details from the job posting.]

Sincerely,
[Your name]`;

const target = {
  candidateName: "Jordan Lee",
  role: "Software Engineer",
  company: "Acme",
  date: "July 28, 2026",
};

assert.equal(
  findCoverLetterPlaceholders(starter).length,
  6,
  "every bracketed starter instruction is detected",
);
assert.equal(
  analyzeCoverLetterTemplate({ text: starter }).authoredWordCount,
  0,
  "template instructions do not count as authored prose",
);

// A template-only starter is the ordinary case, not a blocked one: nothing here
// is a fact only the candidate knows.
const fromStarter = buildCoverLetterPreflight({ text: starter, ...target });
assert.equal(fromStarter.canTailor, true, "a template-only starter tailors in one click");
assert.deepEqual(fromStarter.missingFields, []);
assert.deepEqual(fromStarter.blockers, []);
assert.equal(
  fromStarter.template.slots.filter((slot) => slot.resolution.kind === "generate")
    .length,
  3,
  "the three prose prompts are generative, not questions for the candidate",
);

const blank = buildCoverLetterPreflight({ text: "", ...target });
assert.equal(blank.canTailor, true, "a blank document tailors from the base structure");

// Only genuinely unresolvable facts block, and each names itself.
const noCompany = buildCoverLetterPreflight({
  text: starter,
  ...target,
  company: "",
});
assert.equal(noCompany.canTailor, false);
assert.deepEqual(
  noCompany.missingFields.map((item) => item.key),
  ["company"],
);
assert.equal(noCompany.blockers.length, 1);
assert.equal(
  buildCoverLetterPreflight({ text: starter, ...target, role: "", candidateName: "" })
    .missingFields.map((item) => item.key)
    .join(","),
  "candidate_name,role",
);
assert.equal(
  buildCoverLetterPreflight({
    text: starter,
    ...target,
    company: "",
    values: { company: "Acme" },
  }).canTailor,
  true,
  "a typed value resolves the only blocking field",
);

const authoredParagraph =
  "I build dependable product software by listening closely to users, reducing ambiguity with teammates, and carrying implementation details through release. My strongest work connects careful backend decisions with accessible interfaces, pragmatic testing, and clear follow-through after launch. I value direct communication, small reviewable changes, and evidence that a system actually helps the people relying on it.";
const closingParagraph =
  "That approach has taught me to explain tradeoffs plainly, learn unfamiliar domains without overstating what I know, and keep quality visible throughout delivery. I would bring the same grounded habits to this opportunity while learning the team's specific systems and priorities.";

// The base variant across the job families it has to serve. None of them may
// stop at a question.
const variants = [
  {
    name: "general full-stack",
    slots:
      "[Exact Position Title] at [Company] and [specific responsibility from the posting]",
  },
  {
    name: "frontend",
    slots: "[Company's product or mission] and [relevant frontend project or job]",
  },
  {
    name: "backend/platform",
    slots: "[specific backend system or platform] and [project or job]",
  },
  {
    name: "healthcare/FDE",
    slots: "[specific product, mission, team, or problem] and [relevant connection]",
  },
  {
    name: "applied AI",
    slots: "[company work and candidate experience connection] and [Job Description]",
  },
];

for (const fixture of variants) {
  const text = `July 28, 2026

Dear [Hiring Manager's Name or Hiring Team],

I am applying for ${fixture.slots}. ${authoredParagraph}

${authoredParagraph}

${closingParagraph}

Sincerely,
[Your name]`;
  const preflight = buildCoverLetterPreflight({ text, ...target });
  assert(
    preflight.authoredWordCount >= 150,
    `${fixture.name} has substantial authored prose`,
  );
  assert.equal(preflight.canTailor, true, `${fixture.name} tailors in one click`);
  assert.deepEqual(preflight.blockers, [], `${fixture.name} asks nothing`);
  assert.equal(
    preflight.template.hasAuthoredVoice,
    true,
    `${fixture.name} is classified as having an authored voice`,
  );
  assert(
    preflight.template.slots.some((slot) => slot.resolution.kind === "generate"),
    `${fixture.name} has generative slots`,
  );
  assert.equal(
    preflight.resolved.greeting,
    "Dear Acme Hiring Team,",
    `${fixture.name} falls back to the company hiring team`,
  );
}

const classified = analyzeCoverLetterTemplate({
  text: `[Date] [Company] [Company] [Exact Position Title] [Your name]
[Hiring Manager's Name or Hiring Team]
[specific responsibility from the posting]
[relevant connection]`,
  date: "July 28, 2026",
  company: "Acme",
  role: "Software Engineer",
  candidateName: "Jordan Lee",
});
assert.deepEqual(
  classified.slots
    .filter((slot) => slot.normalizedPrompt === "Company")
    .map((slot) => slot.occurrence),
  [1, 2],
  "repeated deterministic slots retain every occurrence",
);
assert(
  classified.slots
    .filter((slot) =>
      ["Date", "Company", "Exact Position Title", "Your name"].includes(
        slot.normalizedPrompt,
      ),
    )
    .every((slot) => slot.resolution.kind === "deterministic"),
  "date, company, role, and candidate resolve deterministically",
);
assert.equal(
  classified.slots.find((slot) => slot.normalizedPrompt.includes("responsibility"))
    ?.resolution.source,
  "job_context",
);
assert.equal(
  classified.slots.find((slot) => slot.normalizedPrompt === "relevant connection")
    ?.resolution.source,
  "candidate_evidence",
);
assert.equal(
  analyzeCoverLetterTemplate({ text: "[Job Description]" }).slots[0]?.resolution.source,
  "job_context",
);
assert.equal(
  analyzeCoverLetterTemplate({ text: "[office location]" }).slots[0]?.resolution.source,
  "unclassified",
  "an unknown natural-language slot stays generative rather than becoming a blocker",
);
assert.equal(
  analyzeCoverLetterTemplate({ text: "[office location]" }).userInputSlots.length,
  0,
  "an unknown natural-language slot never asks the candidate",
);

const literalAnalysis = analyzeCoverLetterTemplate({
  text: String.raw`Read [Ledger](https://ledger.example), items[0], citation [1], and \[literal bracketed text\].`,
});
assert.equal(
  literalAnalysis.slots.length,
  0,
  "links, citations, array indexes, and escaped brackets stay literal",
);

// The one exception path: a fact only the candidate can supply.
const referralText = `${authoredParagraph}

Mention [Referral name].`;
const referral = buildCoverLetterPreflight({ text: referralText, ...target });
assert.equal(referral.canTailor, false);
assert.equal(referral.privateSlots.length, 1, "a referral is a private fact");
assert.equal(referral.blockers.length, 1, "it asks exactly one focused question");
const referralSlot = referral.privateSlots[0];
const answeredReferral = buildCoverLetterPreflight({
  text: referralText,
  ...target,
  slotAnswers: { [referralSlot.id]: "Morgan Rivera referred me." },
});
assert.equal(answeredReferral.canTailor, true, "a supplied private fact unlocks Tailor");
assert.equal(
  answeredReferral.privateSlots.some((slot) => slot.id === referralSlot.id),
  true,
  "an answered private slot stays visible and editable",
);
assert.equal(
  answeredReferral.template.slots.find((slot) => slot.id === referralSlot.id)
    ?.resolution.source,
  "candidate_evidence",
);

// A recipient the writer named survives; an impersonal one falls back.
const namedRecipient = buildCoverLetterPreflight({
  text: `Dear Dr. Amara Chen,\n\n${authoredParagraph}`,
  ...target,
});
assert.equal(namedRecipient.resolved.recipientName, "Dr. Amara Chen");
assert.equal(namedRecipient.resolved.greeting, "Dear Dr. Amara Chen,");
assert.equal(namedRecipient.canTailor, true, "a named recipient is never a question");
assert.equal(
  buildCoverLetterPreflight({
    text: `Dear Hiring Team,\n\n${authoredParagraph}`,
    ...target,
  }).resolved.greeting,
  "Dear Acme Hiring Team,",
);
assert.equal(
  buildCoverLetterPreflight({ text: starter, ...target, company: "", values: {} })
    .resolved.greeting,
  "Dear Hiring Team,",
);

const authoredText = `July 28, 2026

Dear Acme Hiring Team,

${authoredParagraph}

Sincerely,
Jordan Lee`;
const authored = buildCoverLetterPreflight({ text: authoredText, ...target });
assert.equal(authored.canTailor, true);
assert.equal(hasUnresolvedCoverLetterTokens("Dear {{recipient}},"), true);
assert.equal(
  hasUnresolvedCoverLetterTokens("Read [Ledger](https://ledger.example)."),
  false,
);
assert.equal(coverLetterUsesResolvedCorrespondence(authoredText, authored.resolved), true);

console.log("cover-letter deterministic preflight probes: PASS");
