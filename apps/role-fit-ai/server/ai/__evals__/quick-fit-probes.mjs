import assert from "node:assert/strict";

import {
  QUICK_FIT_RULES,
  buildQuickFitPrompts,
  sanitizeQuickFitResponse
} from "../quickFit.ts";
import { buildJobAnalysisPrompts } from "../jobAnalysis.ts";
import {
  QUICK_FIT_SUMMARY,
  quickFitMeetsThreshold,
  sanitizeQuickFit
} from "../../../shared/quickFitContract.ts";

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

const valid = sanitizeQuickFitResponse(validRaw, { jobText, resumeText, candidateContext });
assert.ok(valid, "a fully anchored response is usable");
assert.equal(valid.summary, QUICK_FIT_SUMMARY.REASONABLE, "the server owns stable public summary copy");
assert.deepEqual(valid.matches, [
  "Build accessible React workflows for healthcare teams.",
  "Experience shipping TypeScript applications is required."
]);
assert.deepEqual(valid.gaps, ["Lead design reviews with product and engineering partners."]);
assert.deepEqual(valid.eligibility, {
  status: "BLOCKED",
  note: "The posting disallows the sponsorship the candidate says is required."
});

assert.deepEqual(
  sanitizeQuickFitResponse(
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
  sanitizeQuickFitResponse(
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
  sanitizeQuickFitResponse(
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
  sanitizeQuickFitResponse(
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
  sanitizeQuickFitResponse(
    {
      ...validRaw,
      matches: [validRaw.matches[0], validRaw.matches[0]]
    },
    { jobText, resumeText, candidateContext }
  ),
  null,
  "duplicate findings are unusable instead of double-counted"
);

assert.equal(quickFitMeetsThreshold("STRONG", "STRONG"), true);
assert.equal(quickFitMeetsThreshold("REASONABLE", "STRONG"), false);
assert.equal(quickFitMeetsThreshold("STRETCH", "REASONABLE"), false);
assert.equal(quickFitMeetsThreshold("STRETCH", "STRETCH"), true);
assert.equal(quickFitMeetsThreshold("LIMITED", "LIMITED"), true);

const clientResult = sanitizeQuickFit({
  verdict: "STRONG",
  summary: "Untrusted provider summary",
  matches: ["Build accessible React workflows for healthcare teams."],
  gaps: [],
  eligibility: { status: "CHECK", note: "Confirm work authorization." }
});
assert.equal(clientResult?.summary, QUICK_FIT_SUMMARY.STRONG);
assert.equal(
  sanitizeQuickFit({ verdict: "STRONG", matches: ["duplicate", "duplicate"], gaps: [] }),
  null,
  "the client boundary also rejects duplicate public findings"
);

const prompts = buildQuickFitPrompts({ jobText, resumeText, candidateContext });
assert.equal(
  prompts.systemPrompt.includes(QUICK_FIT_RULES),
  true,
  "standalone Initial Fit renders the shared rules block"
);
assert.match(QUICK_FIT_RULES, /Apply this rubric directly:/);
assert.match(QUICK_FIT_RULES, /STRONG: The candidate explicitly demonstrates most main responsibilities/);
assert.match(QUICK_FIT_RULES, /judge only the evidence currently supplied/i);
assert.match(QUICK_FIT_RULES, /Missing evidence is a gap, not proof that the candidate is incapable/i);
assert.match(QUICK_FIT_RULES, /Preserve posting order; when evidence is tied, choose the earliest material item/);
assert.match(QUICK_FIT_RULES, /transferable or adjacent experience may inform the verdict but cannot prove an unshown specific requirement/i);
assert.match(QUICK_FIT_RULES, /never appear in both matches and gaps/i);
assert.match(QUICK_FIT_RULES, /one gap per underlying missing need/i);
assert.match(QUICK_FIT_RULES, /falls between adjacent categories, choose the lower category/i);
assert.match(QUICK_FIT_RULES, /Determine the verdict without considering eligibility/i);
assert.match(QUICK_FIT_RULES, /education, skills, and experience are fit evidence, not eligibility/i);
assert.match(QUICK_FIT_RULES, /BLOCKED requires both an explicit posting condition and a conflicting explicit candidate-context fact/);
assert.match(prompts.userPrompt, /"candidateSource": "RESUME \| CANDIDATE_CONTEXT"/);
assert.doesNotMatch(prompts.userPrompt, /requirementId|ADJACENT|coverage categor(?:y|ies)|calibration basis/i);
assert.doesNotMatch(prompts.userPrompt, /selected_resume_label/i);

const combinedPrompts = buildJobAnalysisPrompts({
  jobText: jobText.replaceAll("\n", "\r\n"),
  initialFit: { resumeText, candidateContext }
});
const jobOnlyPrompts = buildJobAnalysisPrompts({ jobText });
assert.equal(
  jobOnlyPrompts.systemPrompt.includes(QUICK_FIT_RULES),
  false,
  "Job analysis without Initial Fit omits the screening rules"
);
assert.equal(
  combinedPrompts.systemPrompt.includes(QUICK_FIT_RULES),
  true,
  "combined Prepare renders the exact shared Initial Fit rules block"
);
assert.equal(
  combinedPrompts.systemPrompt.split(QUICK_FIT_RULES).length,
  prompts.systemPrompt.split(QUICK_FIT_RULES).length,
  "combined and standalone prompts include the shared rules block identically"
);
assert.doesNotMatch(
  combinedPrompts.userPrompt,
  /\r/,
  "combined Prepare sends the same normalized posting used by exact-excerpt validation"
);

console.log("quick-fit probes passed");
