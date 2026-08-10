import assert from "node:assert/strict";

import {
  FIT_ASSESSMENT_RULES,
  buildFitAssessmentPrompts,
  sanitizeFitAssessmentResponse
} from "../fitAssessment.ts";
import { buildJobAnalysisPrompts } from "../jobAnalysis.ts";
import {
  FIT_ASSESSMENT_SUMMARY,
  sanitizeFitAssessment
} from "../../../shared/fitAssessmentContract.ts";

const jobText = `Senior Product Engineer
Build accessible React workflows for healthcare teams.
Lead design reviews with product and engineering partners.
Experience shipping TypeScript applications is required.
Must be authorized to work in the United States without sponsorship.`;

const resumeText = `Product Engineer
Built accessible React workflows used by clinical operations teams.
Shipped TypeScript applications and partnered with product designers.`;

const candidateContext = "I require employment sponsorship.";

const validRaw = {
  verdict: "REASONABLE",
  summary: "Provider text must not become public copy.",
  matches: [
    {
      jobExcerpt: "Build accessible React workflows for healthcare teams.",
      candidateSource: "RESUME",
      candidateExcerpt: "Built accessible React workflows used by clinical operations teams."
    },
    {
      jobExcerpt: "Experience shipping TypeScript applications is required.",
      candidateSource: "RESUME",
      candidateExcerpt: "Shipped TypeScript applications"
    }
  ],
  gaps: [
    {
      jobExcerpt: "Lead design reviews with product and engineering partners.",
      status: "NOT_SHOWN",
      note: "Leadership is not shown."
    }
  ],
  eligibility: {
    status: "BLOCKED",
    jobExcerpt: "Must be authorized to work in the United States without sponsorship.",
    candidateExcerpt: "I require employment sponsorship.",
    note: "The posting disallows the sponsorship the candidate says is required."
  }
};

const valid = sanitizeFitAssessmentResponse(validRaw, { jobText, resumeText, candidateContext });
assert.ok(valid, "a fully anchored response is usable");
assert.equal(valid.summary, FIT_ASSESSMENT_SUMMARY.REASONABLE, "the server owns stable public summary copy");
assert.deepEqual(valid.matches, validRaw.matches, "validated candidate evidence remains inspectable");
assert.deepEqual(valid.gaps, ["Lead design reviews with product and engineering partners."]);
assert.deepEqual(valid.eligibility, {
  status: "BLOCKED",
  jobExcerpt: "Must be authorized to work in the United States without sponsorship.",
  candidateExcerpt: "I require employment sponsorship.",
  note: "The posting disallows the sponsorship the candidate says is required."
});

for (const verdict of ["STRONG", "REASONABLE", "STRETCH"]) {
  assert.equal(
    sanitizeFitAssessmentResponse(
      { verdict, matches: [], gaps: validRaw.gaps, eligibility: { status: "CLEAR" } },
      { jobText, resumeText, candidateContext }
    ),
    null,
    `${verdict} cannot contradict its findings by claiming no direct match`
  );
}

const multilineJobExcerpt = "Build accessible React workflows\nfor healthcare teams.";
const multilineCandidateExcerpt = "Built accessible React workflows\nused by clinical operations teams.";
const multiline = sanitizeFitAssessmentResponse(
  {
    verdict: "STRONG",
    matches: [{
      jobExcerpt: multilineJobExcerpt,
      candidateSource: "RESUME",
      candidateExcerpt: multilineCandidateExcerpt
    }],
    gaps: [],
    eligibility: { status: "CLEAR" }
  },
  {
    jobText: `Senior Product Engineer\n${multilineJobExcerpt}`,
    resumeText: `Product Engineer\n${multilineCandidateExcerpt}`,
    candidateContext: ""
  }
);
assert.equal(multiline?.matches[0].jobExcerpt, multilineJobExcerpt, "exact job excerpts retain line breaks");
assert.equal(
  multiline?.matches[0].candidateExcerpt,
  multilineCandidateExcerpt,
  "exact candidate excerpts retain line breaks"
);
const clientGapExcerpt = "• Must ship systems\nin production.";
assert.equal(
  sanitizeFitAssessment({
    verdict: "LIMITED",
    matches: [],
    gaps: [clientGapExcerpt],
    eligibility: { status: "CLEAR" }
  })?.gaps[0],
  clientGapExcerpt,
  "the client boundary preserves bullets and line breaks in exact gap excerpts"
);

assert.deepEqual(
  sanitizeFitAssessmentResponse(
    {
      verdict: "STRONG",
      matches: validRaw.matches,
      gaps: [],
      eligibility: {
        status: "CLEAR",
        jobExcerpt: "",
        candidateExcerpt: "",
        note: ""
      }
    },
    { jobText, resumeText, candidateContext }
  )?.eligibility,
  { status: "CLEAR" },
  "empty schema placeholders remain optional for CLEAR eligibility"
);

assert.equal(
  sanitizeFitAssessmentResponse(
    {
      ...validRaw,
      matches: [{ ...validRaw.matches[0], jobExcerpt: "Invented responsibility" }]
    },
    { jobText, resumeText, candidateContext }
  ),
  null,
  "job excerpts must exist exactly in the normalized posting"
);

assert.equal(
  sanitizeFitAssessmentResponse(
    {
      ...validRaw,
      matches: [{ ...validRaw.matches[0], candidateExcerpt: "Invented candidate evidence" }]
    },
    { jobText, resumeText, candidateContext }
  ),
  null,
  "candidate excerpts must exist exactly in their declared source"
);

assert.equal(
  sanitizeFitAssessmentResponse(
    {
      ...validRaw,
      eligibility: {
        status: "BLOCKED",
        jobExcerpt: validRaw.eligibility.jobExcerpt,
        candidateExcerpt: "No explicit conflicting fact"
      }
    },
    { jobText, resumeText, candidateContext }
  ),
  null,
  "BLOCKED fails closed without an exact conflicting candidate fact"
);

assert.equal(
  sanitizeFitAssessmentResponse(
    {
      ...validRaw,
      matches: [validRaw.matches[0], validRaw.matches[0]]
    },
    { jobText, resumeText, candidateContext }
  ),
  null,
  "duplicate findings are unusable instead of double-counted"
);

const clientResult = sanitizeFitAssessment({
  verdict: "STRONG",
  summary: "Untrusted provider summary",
  matches: [validRaw.matches[0]],
  gaps: [],
  eligibility: {
    status: "CHECK",
    jobExcerpt: validRaw.eligibility.jobExcerpt,
    note: "Confirm work authorization."
  }
});
assert.equal(clientResult?.summary, FIT_ASSESSMENT_SUMMARY.STRONG);
assert.equal(
  sanitizeFitAssessment({ verdict: "STRONG", matches: [validRaw.matches[0], validRaw.matches[0]], gaps: [] }),
  null,
  "the client boundary also rejects duplicate public findings"
);

const prompts = buildFitAssessmentPrompts({ jobText, resumeText, candidateContext });
assert.equal(
  prompts.systemPrompt.includes(FIT_ASSESSMENT_RULES),
  true,
  "standalone Fit Assessment renders the shared rules block"
);
assert.match(FIT_ASSESSMENT_RULES, /Apply this rubric directly:/);
assert.match(FIT_ASSESSMENT_RULES, /STRONG: The candidate explicitly demonstrates most main responsibilities/);
assert.match(FIT_ASSESSMENT_RULES, /judge only the evidence currently supplied/i);
assert.match(FIT_ASSESSMENT_RULES, /Missing evidence is a gap, not proof that the candidate is incapable/i);
assert.match(FIT_ASSESSMENT_RULES, /transferable or adjacent experience may inform the verdict but cannot prove an unshown specific requirement/i);
assert.match(FIT_ASSESSMENT_RULES, /professional, industry, commercial, production, or paid experience is not satisfied by academic, personal, volunteer, or open-source work/i);
assert.match(FIT_ASSESSMENT_RULES, /experience categories may overlap\. Never add their years or counts together/i);
assert.match(FIT_ASSESSMENT_RULES, /role\/project count does not imply duration/i);
assert.match(
  FIT_ASSESSMENT_RULES,
  /classify.*main responsibilities.*core qualifications.*preferred qualifications.*logistics.*administrative/i,
  "the rubric separates decision-critical role evidence from non-fit posting text"
);
assert.match(
  FIT_ASSESSMENT_RULES,
  /lacks substantive role responsibilities or qualifications.*LIMITED/i,
  "the rubric fails conservatively on a content-poor posting"
);
assert.match(
  FIT_ASSESSMENT_RULES,
  /LIMITED versus STRETCH only.*substantive posting.*supporting core work.*role-defining specialization.*STRETCH.*Reserve LIMITED.*direct evidence.*sparse/i,
  "supporting core evidence keeps a missing specialization at stretch rather than limited"
);
assert.match(
  FIT_ASSESSMENT_RULES,
  /most decision-relevant.*posting order.*tie-breaker/i,
  "finding selection explains the verdict instead of favoring easy early excerpts"
);
assert.match(
  FIT_ASSESSMENT_RULES,
  /Before returning JSON.*exact contiguous character-for-character text.*Never rewrite, combine, or normalize punctuation.*omit that finding/i,
  "the provider self-checks exact excerpts before the server grounding boundary"
);
assert.match(FIT_ASSESSMENT_RULES, /never appear in both matches and gaps/i);
assert.match(FIT_ASSESSMENT_RULES, /one gap per underlying missing need/i);
assert.match(FIT_ASSESSMENT_RULES, /falls between adjacent categories, choose the lower category/i);
assert.match(FIT_ASSESSMENT_RULES, /Determine the verdict without considering eligibility/i);
assert.match(FIT_ASSESSMENT_RULES, /education, skills, and experience are fit evidence, not eligibility/i);
assert.match(FIT_ASSESSMENT_RULES, /BLOCKED requires both an explicit posting condition and a conflicting explicit candidate-context fact/);
assert.match(prompts.userPrompt, /"candidateSource": "RESUME \| CANDIDATE_CONTEXT"/);
assert.doesNotMatch(prompts.userPrompt, /requirementId|ADJACENT|coverage categor(?:y|ies)|calibration basis/i);
assert.doesNotMatch(prompts.userPrompt, /selected_resume_label/i);

const combinedPrompts = buildJobAnalysisPrompts({
  jobText: jobText.replaceAll("\n", "\r\n"),
  fitAssessment: { resumeText, candidateContext }
});
const jobOnlyPrompts = buildJobAnalysisPrompts({ jobText });
assert.equal(
  jobOnlyPrompts.systemPrompt.includes(FIT_ASSESSMENT_RULES),
  false,
  "Job analysis without Fit Assessment omits the screening rules"
);
assert.equal(
  combinedPrompts.systemPrompt.includes(FIT_ASSESSMENT_RULES),
  true,
  "combined Prepare renders the exact shared Fit Assessment rules block"
);
assert.equal(
  combinedPrompts.systemPrompt.split(FIT_ASSESSMENT_RULES).length,
  prompts.systemPrompt.split(FIT_ASSESSMENT_RULES).length,
  "combined and standalone prompts include the shared rules block identically"
);
assert.doesNotMatch(
  combinedPrompts.userPrompt,
  /\r/,
  "combined Prepare sends the same normalized posting used by exact-excerpt validation"
);

console.log("fit-assessment probes passed");
