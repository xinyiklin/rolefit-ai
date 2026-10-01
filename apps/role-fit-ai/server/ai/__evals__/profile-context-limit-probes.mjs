import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  CANDIDATE_CONTEXT_CHAR_LIMIT,
  CANDIDATE_FACTS_CONTEXT_MAX_LENGTH,
  PROFILE_BACKGROUND_CHAR_LIMIT,
  PROFILE_BACKGROUND_LIMIT_MESSAGE,
  candidateContextLimitError,
  profileBackgroundLimitError,
  profileTextLength
} from "../../../shared/candidateProfileContract.ts";
import { flattenResumeTargets } from "../../../shared/resumePolishContract.ts";
import {
  AVAILABILITY_NOTICE_OPTIONS,
  CITIZENSHIP_OPTIONS,
  DECLARED_ANSWER_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  MAJOR_MAX_LENGTH,
  buildCandidateFactsContext,
  buildCandidateContext
} from "../../../src/lib/candidateFacts.ts";
import { handleApplicationAnswers } from "../applicationAnswers.ts";
import { buildFitAssessmentPrompts, evaluateFitAssessmentResponse } from "../fitAssessment.ts";
import { parseCoverLetterEvidenceItems } from "../coverLetterContracts.ts";
import { analyzeJobToFields, handleJobAnalysis } from "../jobAnalysis.ts";
import { handleResumePolish } from "../resumePolish.ts";
import { buildResumeProposalPrompts } from "../resumeProposal.ts";

const CLIP_MARKER = /clipped: middle omitted/;

// The largest facts block: every independent field at its longest declared value.
const neutral = {
  citizenshipStatus: "unspecified",
  legallyAuthorizedToWork: "unspecified",
  requiresSponsorship: "unspecified",
  educationLevel: "unspecified",
  major: ""
};
function longestValue(field, options) {
  return options
    .map((option) => option.value)
    .sort((a, b) =>
      buildCandidateFactsContext({ ...neutral, [field]: b }).length
      - buildCandidateFactsContext({ ...neutral, [field]: a }).length
    )[0];
}
const maxFacts = buildCandidateFactsContext({
  citizenshipStatus: longestValue("citizenshipStatus", CITIZENSHIP_OPTIONS),
  legallyAuthorizedToWork: longestValue("legallyAuthorizedToWork", DECLARED_ANSWER_OPTIONS),
  requiresSponsorship: longestValue("requiresSponsorship", DECLARED_ANSWER_OPTIONS),
  educationLevel: longestValue("educationLevel", EDUCATION_LEVEL_OPTIONS),
  major: "M".repeat(MAJOR_MAX_LENGTH),
  gpa: 3.99,
  availabilityNotice: AVAILABILITY_NOTICE_OPTIONS.some((option) => option.value === "specific-date") ? "specific-date" : "unspecified",
  availabilityDate: "2026-09-28"
});
assert.ok(maxFacts.length > 300, "the maximal facts fixture declares every field");
assert.ok(
  maxFacts.length + 2 <= CANDIDATE_FACTS_CONTEXT_MAX_LENGTH,
  `the facts headroom covers the largest facts block (${maxFacts.length} chars)`
);

function padTo(text, length) {
  assert.ok(text.length <= length);
  return text + "x".repeat(length - text.length);
}
const headed = Array.from({ length: 60 }, (_, index) => [
  `## Project ${index} (personal project, 2024–present)`,
  `Built service ${index} with Python, SQL, and automated tests.`,
  ""
].join("\n")).join("\n");
const BACKGROUND_SHAPES = {
  "NFKC-expanding": "…".repeat(PROFILE_BACKGROUND_CHAR_LIMIT / 3),
  "one line": "Built Python services end to end. ".repeat(400).slice(0, PROFILE_BACKGROUND_CHAR_LIMIT),
  "short lines": padTo(Array.from({ length: 6_000 }, (_, index) => String.fromCharCode(97 + (index % 26))).join("\n"), PROFILE_BACKGROUND_CHAR_LIMIT),
  headed: padTo(headed, PROFILE_BACKGROUND_CHAR_LIMIT)
};

// Shared boundary helpers.
assert.equal(profileBackgroundLimitError("b".repeat(PROFILE_BACKGROUND_CHAR_LIMIT)), null, "exactly 12,000 runs");
assert.equal(profileBackgroundLimitError("b".repeat(PROFILE_BACKGROUND_CHAR_LIMIT + 1)), PROFILE_BACKGROUND_LIMIT_MESSAGE, "12,001 declines");
assert.equal(candidateContextLimitError("c".repeat(CANDIDATE_CONTEXT_CHAR_LIMIT)), null);
assert.equal(candidateContextLimitError("c".repeat(CANDIDATE_CONTEXT_CHAR_LIMIT + 1)), PROFILE_BACKGROUND_LIMIT_MESSAGE);
assert.match(PROFILE_BACKGROUND_LIMIT_MESSAGE, /Settings > Profile/);
// Fit measures NFKC text ("…" becomes "..."), so the shared measure is the longer form.
assert.equal(profileTextLength("…".repeat(4_000)), 12_000);
assert.equal(profileBackgroundLimitError("…".repeat(4_000)), null, "an expanding Background exactly at the limit runs");
assert.equal(profileBackgroundLimitError("…".repeat(4_001)), PROFILE_BACKGROUND_LIMIT_MESSAGE, "NFKC expansion past the limit declines");

const jobText = "Software Developer required to build Python and SQL services for internal teams.";
const resumeText = "Software Developer | Acme\nBuilt Python and SQL services for internal teams.";
const scope = {
  version: 1,
  locked: { omittedIdentity: true, omittedContact: true, omittedSections: [] },
  sections: [{
    id: "experience-section",
    heading: "Experience",
    type: "standard",
    entries: [{
      id: "role-1",
      titleLeft: "Software Developer",
      titleRight: "Acme",
      subtitleLeft: "",
      subtitleRight: "2024-present",
      bullets: [{ id: "bullet-1", text: "Built Python and SQL services for internal teams." }]
    }]
  }],
  contextSections: []
};
const fitResponse = {
  status: "ASSESSED",
  verdict: "REASONABLE",
  matches: [{ jobExcerpt: "build Python and SQL services", candidateSource: "RESUME", candidateExcerpt: "Built Python and SQL services" }],
  gaps: []
};

for (const [shape, background] of Object.entries(BACKGROUND_SHAPES)) {
  assert.equal(profileTextLength(background), PROFILE_BACKGROUND_CHAR_LIMIT, `${shape}: fixture sits on the boundary`);
  const merged = buildCandidateContext(background, maxFacts);
  assert.equal(candidateContextLimitError(merged), null, `${shape}: merged context stays within the server bound`);

  const fit = buildFitAssessmentPrompts({ jobText, resumeText, candidateContext: merged });
  assert.ok(fit.userPrompt.includes(merged.normalize("NFKC").trim()), `${shape}: Fit receives the whole Background verbatim`);
  assert.doesNotMatch(fit.userPrompt, CLIP_MARKER, `${shape}: Fit never clips candidate context`);
  assert.equal(
    evaluateFitAssessmentResponse(fitResponse, { jobText, resumeText, candidateContext: merged }).fitAssessmentError,
    undefined,
    `${shape}: Fit accepts a boundary-sized Profile`
  );

  const proposal = buildResumeProposalPrompts({
    jobText,
    targets: flattenResumeTargets(scope),
    scopeText: resumeText,
    candidateContext: merged,
    customInstructions: ""
  });
  assert.ok(proposal.userPrompt.includes(merged), `${shape}: Resume Polish receives the whole Background verbatim`);
  assert.doesNotMatch(proposal.userPrompt, /candidate context clipped/, `${shape}: Resume Polish never clips candidate context`);
}

const oversized = "o".repeat(CANDIDATE_CONTEXT_CHAR_LIMIT + 1);
assert.match(
  evaluateFitAssessmentResponse(fitResponse, { jobText, resumeText, candidateContext: oversized }).fitAssessmentError ?? "",
  /Profile Background/,
  "Fit names the Profile when candidate context exceeds its bound"
);

// Routes reject oversized context before any provider work and never slice it.
async function postTo(handler, body) {
  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return { status: response.status, error: (await response.json()).error };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
const atLimit = buildCandidateContext(BACKGROUND_SHAPES.headed, maxFacts);

const polishOver = await postTo(handleResumePolish, { mode: "resume-proposal", jobText: "x", resumeScope: {}, candidateContext: oversized });
assert.equal(polishOver.status, 400);
assert.equal(polishOver.error, PROFILE_BACKGROUND_LIMIT_MESSAGE, "Resume Polish declines oversized context by name");
const polishAt = await postTo(handleResumePolish, { mode: "resume-proposal", jobText: "x", resumeScope: {}, candidateContext: atLimit });
assert.match(polishAt.error, /Select at least one editable resume section/, "a boundary-sized Profile passes the context guard");

const answersOver = await postTo(handleApplicationAnswers, { resumeText: "", jobText: "", candidateContext: oversized });
assert.equal(answersOver.status, 400);
assert.equal(answersOver.error, PROFILE_BACKGROUND_LIMIT_MESSAGE, "application answers decline oversized context by name");
const answersAt = await postTo(handleApplicationAnswers, { resumeText: "", jobText: "", candidateContext: atLimit });
assert.match(answersAt.error, /Add your resume/, "a boundary-sized Profile passes the answers context guard");

const fitOver = await postTo(handleJobAnalysis, {
  mode: "fit-assessment",
  text: jobText,
  resumeText,
  candidateContext: oversized
});
assert.equal(fitOver.status, 400);
assert.equal(fitOver.error, PROFILE_BACKGROUND_LIMIT_MESSAGE, "Fit declines oversized context before any provider call");

// Cover evidence items are accepted whole or rejected, never cut.
const wholeItem = parseCoverLetterEvidenceItems([
  { id: "resume-1", source: "resume", text: "Built Python services." },
  { id: "profile-1", source: "profile", text: "p".repeat(PROFILE_BACKGROUND_CHAR_LIMIT) }
]);
assert.equal(wholeItem[1].text.length, PROFILE_BACKGROUND_CHAR_LIMIT, "a 12,000-character item is accepted whole");
assert.throws(
  () => parseCoverLetterEvidenceItems([
    { id: "resume-1", source: "resume", text: "Built Python services." },
    { id: "profile-1", source: "profile", text: "p".repeat(PROFILE_BACKGROUND_CHAR_LIMIT + 1) }
  ]),
  /evidence item is too long/,
  "an over-long item is rejected rather than sliced"
);

// The routes hand the whole Profile to the provider: a stubbed, offline provider
// call must carry it unclipped, so no later slice can hide behind the guard.
process.env.OPENAI_API_KEY = "synthetic-test-key";
const loopbackFetch = globalThis.fetch;
const providerBodies = [];
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith("http://127.0.0.1")) return loopbackFetch(url, options);
  providerBodies.push(String(options?.body ?? ""));
  return new Response(JSON.stringify({
    output_text: JSON.stringify({ status: "NO_CHANGES", changes: [], answers: [], roleDescriptions: [] })
  }), { status: 200 });
};
try {
  for (const [route, handler, body] of [
    ["Resume Polish", handleResumePolish, { mode: "resume-proposal", resumeScope: scope, jobText }],
    ["application answers", handleApplicationAnswers, { resumeText, jobText, questions: ["Why do you want this role?"] }]
  ]) {
    providerBodies.length = 0;
    await postTo(handler, { ...body, provider: "openai", model: "synthetic-model", candidateContext: atLimit });
    assert.ok(providerBodies.length >= 1, `${route}: the stubbed provider is called`);
    const sent = providerBodies.join("\n");
    assert.ok(sent.includes(JSON.stringify(atLimit).slice(1, -1)), `${route}: the provider request carries the whole Profile`);
    assert.doesNotMatch(sent, CLIP_MARKER, `${route}: nothing is clipped`);
  }
  // Combined Prepare with an oversized Profile still analyzes the job but never
  // sends the Profile, and reports why Fit did not run.
  providerBodies.length = 0;
  const oversizedMarker = `PROFILE_MARKER ${oversized}`;
  const combined = await analyzeJobToFields({
    jobText,
    body: {
      provider: "openai",
      model: "synthetic-model",
      fitAssessment: { enabled: true, resumeText, candidateContext: oversizedMarker }
    }
  });
  assert.ok(providerBodies.length >= 1, "combined Prepare still runs Job analysis");
  assert.doesNotMatch(providerBodies.join("\n"), /PROFILE_MARKER/, "an oversized Profile never reaches the provider");
  assert.equal(combined.fitAssessmentRequested, true);
  assert.equal(combined.fitAssessment, null);
  assert.equal(combined.fitAssessmentError, PROFILE_BACKGROUND_LIMIT_MESSAGE, "Fit reports the Profile limit");
} finally {
  globalThis.fetch = loopbackFetch;
  delete process.env.OPENAI_API_KEY;
}

console.log(`Profile context limit probes passed (largest facts block ${maxFacts.length} chars)`);
