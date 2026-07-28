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

const placeholders = findCoverLetterPlaceholders(starter);
assert.equal(
  placeholders.length,
  6,
  "every bracketed starter instruction is detected",
);
assert.equal(
  analyzeCoverLetterTemplate({ text: starter }).authoredWordCount,
  0,
  "template instructions do not count as authored prose",
);
assert.equal(
  analyzeCoverLetterTemplate({ text: starter }).recommendedSourceMode,
  "guided_draft",
  "a template-only starter recommends guided mode",
);

const guided = buildCoverLetterPreflight({
  text: starter,
  sourceMode: "guided_draft",
  candidateName: "Jordan Lee",
  role: "Software Engineer",
  company: "Acme",
  date: "July 28, 2026",
});
assert.equal(
  guided.canPrepare,
  false,
  "a starter still needs a candidate-authored voice anchor",
);
assert.equal(guided.requiresUserVoiceAnchor, true);
assert.deepEqual(
  guided.missingFields.filter((item) => item.required).map((item) => item.key),
  ["why_role", "lead_experience"],
);

const readyGuided = buildCoverLetterPreflight({
  text: starter,
  sourceMode: "guided_draft",
  candidateName: "Jordan Lee",
  role: "Software Engineer",
  company: "Acme",
  date: "July 28, 2026",
  values: {
    why_role: "I want to build practical tools with a thoughtful product team.",
    lead_experience: "Lead with my verified end-to-end delivery work.",
  },
});
assert.equal(
  readyGuided.canPrepare,
  true,
  "candidate answers unlock a template-only starter",
);
assert.equal(readyGuided.sourceReadyToSend, false);

const authoredParagraph =
  "I build dependable product software by listening closely to users, reducing ambiguity with teammates, and carrying implementation details through release. My strongest work connects careful backend decisions with accessible interfaces, pragmatic testing, and clear follow-through after launch. I value direct communication, small reviewable changes, and evidence that a system actually helps the people relying on it.";
const closingParagraph =
  "That approach has taught me to explain tradeoffs plainly, learn unfamiliar domains without overstating what I know, and keep quality visible throughout delivery. I would bring the same grounded habits to this opportunity while learning the team's specific systems and priorities.";
const variants = [
  {
    name: "general full-stack",
    slots:
      "[Exact Position Title] at [Company] and [specific responsibility from the posting]",
  },
  {
    name: "frontend",
    slots:
      "[Company's product or mission] and [relevant frontend project or job]",
  },
  {
    name: "backend/platform",
    slots: "[specific backend system or platform] and [project or job]",
  },
  {
    name: "healthcare/FDE",
    slots:
      "[specific product, mission, team, or problem] and [relevant connection]",
  },
  {
    name: "applied AI",
    slots:
      "[company work and candidate experience connection] and [Job Description]",
  },
];

for (const fixture of variants) {
  const text = `July 28, 2026

Dear [Hiring Manager's Name or Hiring Team],

I am applying for ${fixture.slots}. ${authoredParagraph}

${authoredParagraph}

${authoredParagraph}

${closingParagraph}

Sincerely,
[Your name]`;
  const preflight = buildCoverLetterPreflight({
    text,
    sourceMode: "authored_letter",
    candidateName: "Jordan Lee",
    role: "Software Engineer",
    company: "Acme",
    date: "July 28, 2026",
  });
  assert(
    preflight.authoredWordCount >= 200,
    `${fixture.name} has substantial authored prose`,
  );
  assert.equal(
    preflight.canPrepare,
    true,
    `${fixture.name} may start Polish with slots`,
  );
  assert.equal(
    preflight.sourceReadyToSend,
    false,
    `${fixture.name} is not send-ready with slots`,
  );
  assert.equal(
    preflight.template.recommendedSourceMode,
    "authored_letter",
    `${fixture.name} recommends authored mode`,
  );
  assert(
    preflight.template.slots.some(
      (slot) => slot.resolution.kind === "generate",
    ),
    `${fixture.name} has generative slots`,
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
assert.equal(
  classified.slots.filter((slot) => slot.normalizedPrompt === "Company").length,
  2,
);
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
  classified.slots.find((slot) =>
    slot.normalizedPrompt.includes("responsibility"),
  )?.resolution.source,
  "job_context",
);
assert.equal(
  classified.slots.find(
    (slot) => slot.normalizedPrompt === "relevant connection",
  )?.resolution.source,
  "candidate_evidence",
);
assert.equal(
  analyzeCoverLetterTemplate({ text: "[Job Description]" }).slots[0]?.resolution
    .source,
  "job_context",
  "a Job Description slot uses posting context without requiring candidate evidence",
);
assert.equal(
  analyzeCoverLetterTemplate({ text: "[Job posting]" }).slots[0]?.resolution
    .source,
  "job_context",
  "a Job posting slot uses posting context without requiring candidate evidence",
);
assert.equal(
  analyzeCoverLetterTemplate({ text: "[office location]" }).slots[0]?.resolution
    .source,
  "unclassified",
  "an unknown natural-language slot remains open for preparation classification",
);

const literalAnalysis = analyzeCoverLetterTemplate({
  text: String.raw`Read [CareFlow](https://careflow.example), items[0], citation [1], and \[literal bracketed text\].`,
});
assert.equal(
  literalAnalysis.slots.length,
  0,
  "links, citations, array indexes, and escaped brackets stay literal",
);

const referralText = `${authoredParagraph} ${authoredParagraph}

Mention [Referral name].`;
const referral = buildCoverLetterPreflight({
  text: referralText,
  sourceMode: "authored_letter",
  candidateName: "Jordan Lee",
  role: "Software Engineer",
  company: "Acme",
});
assert.equal(referral.canPrepare, false);
assert.equal(
  referral.template.requiredInputs.length,
  1,
  "a referral requires private input",
);
const referralSlot = referral.template.requiredInputs[0];
const answeredReferral = buildCoverLetterPreflight({
  text: referralText,
  sourceMode: "authored_letter",
  candidateName: "Jordan Lee",
  role: "Software Engineer",
  company: "Acme",
  slotAnswers: { [referralSlot.id]: "Morgan Rivera referred me." },
});
assert.equal(
  answeredReferral.canPrepare,
  true,
  "a supplied private fact unlocks preparation",
);
assert.equal(
  answeredReferral.template.userInputSlots.some(
    (slot) => slot.id === referralSlot.id,
  ),
  true,
  "an answered private slot remains visible and editable",
);
assert.equal(
  answeredReferral.template.requiredInputs.length,
  0,
  "an answered private slot no longer blocks preparation",
);
assert.equal(
  answeredReferral.template.slots.find((slot) => slot.id === referralSlot.id)
    ?.resolution.source,
  "candidate_evidence",
);

const authoredText = `July 28, 2026

Dear Acme Hiring Team,

${authoredParagraph} ${authoredParagraph}

Sincerely,
Jordan Lee`;
const authored = buildCoverLetterPreflight({
  text: authoredText,
  sourceMode: "authored_letter",
  candidateName: "Jordan Lee",
  role: "Software Engineer",
  company: "Acme",
  date: "July 28, 2026",
});
assert.equal(authored.canPrepare, true);
assert.equal(authored.sourceReadyToSend, true);
assert.equal(hasUnresolvedCoverLetterTokens("Dear {{recipient}},"), true);
assert.equal(
  hasUnresolvedCoverLetterTokens("Read [CareFlow](https://careflow.example)."),
  false,
);
assert.equal(
  coverLetterUsesResolvedCorrespondence(authoredText, authored.resolved),
  true,
);

console.log("cover-letter deterministic preflight probes: PASS");
