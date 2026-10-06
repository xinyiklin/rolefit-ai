// Fit rejects a result whose posting exceeds 24,000 or whose resume exceeds
// 28,000 normalized characters. Before, that check ran only on the response,
// after a provider call the prompt's clipping had let through, so an oversized
// input paid for a dispatch that was certain to be discarded. The limit is now
// measured once before any dispatch, on both the standalone route and the
// combined Prepare path, where Job analysis still runs.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  CANDIDATE_CONTEXT_CHAR_LIMIT,
  PROFILE_BACKGROUND_LIMIT_MESSAGE
} from "../../../shared/candidateProfileContract.ts";
import { analyzeFitAssessment, fitAssessmentInputLimitError } from "../fitAssessment.ts";
import { analyzeJobToFields, handleJobAnalysis } from "../jobAnalysis.ts";

const JOB_LIMIT = 24_000;
const RESUME_LIMIT = 28_000;
const LIMIT_MESSAGE = /exceeds the assessment limit/;

const pad = (seed, length) => (seed + " x".repeat(length)).slice(0, length);
const jobAtLimit = pad("Software Developer required to build Python and SQL services for internal teams.", JOB_LIMIT);
const resumeAtLimit = pad("Software Developer | Acme\nBuilt Python and SQL services for internal teams.", RESUME_LIMIT);
const fitResponse = {
  status: "ASSESSED",
  verdict: "REASONABLE",
  matches: [{ jobExcerpt: "build Python and SQL services", candidateSource: "RESUME", candidateExcerpt: "Built Python and SQL services" }],
  gaps: []
};

// Shared measure.
assert.equal(fitAssessmentInputLimitError({ jobText: jobAtLimit, resumeText: resumeAtLimit }), null, "exactly at both limits passes");
assert.match(fitAssessmentInputLimitError({ jobText: jobAtLimit + "y", resumeText: resumeAtLimit }), LIMIT_MESSAGE, "24,001 posting characters decline");
assert.match(fitAssessmentInputLimitError({ jobText: jobAtLimit, resumeText: resumeAtLimit + "y" }), LIMIT_MESSAGE, "28,001 resume characters decline");
assert.equal(fitAssessmentInputLimitError({ jobText: "…".repeat(JOB_LIMIT / 3), resumeText: "r" }), null, "NFKC-expanding text exactly at the limit passes");
assert.match(fitAssessmentInputLimitError({ jobText: "…".repeat(JOB_LIMIT / 3 + 1), resumeText: "r" }), LIMIT_MESSAGE, "NFKC expansion past the limit declines");
assert.match(fitAssessmentInputLimitError({ jobText: "j", resumeText: "r", candidateContext: "c".repeat(CANDIDATE_CONTEXT_CHAR_LIMIT + 1) }), LIMIT_MESSAGE, "an oversized context declines by the same measure");
assert.equal(fitAssessmentInputLimitError({ jobText: `${jobAtLimit}\r\n`, resumeText: resumeAtLimit }), null, "a trailing newline is trimmed before measuring");

// Counting provider stub: the OpenAI adapter is the one offline-stubbable path.
process.env.OPENAI_API_KEY = "synthetic-test-key";
const loopbackFetch = globalThis.fetch;
const providerBodies = [];
const jobFields = { title: "Software Developer", responsibilities: ["Build Python and SQL services"] };
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith("http://127.0.0.1")) return loopbackFetch(url, options);
  const sent = String(options?.body ?? "");
  providerBodies.push(sent);
  // A combined Prepare prompt expects the two-part shape; standalone Fit expects the bare result.
  const combined = /job-posting parser/.test(sent);
  const reply = combined && /Fit Assessment rules/.test(sent) ? { job: jobFields, fitAssessment: fitResponse } : combined ? jobFields : fitResponse;
  return new Response(JSON.stringify({ output_text: JSON.stringify(reply) }), { status: 200 });
};
const body = { provider: "openai", model: "synthetic-model" };
async function dispatches(run) {
  providerBodies.length = 0;
  const result = await run();
  return { result, calls: providerBodies.length, sent: providerBodies.join("\n") };
}
async function postTo(handler, payload) {
  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

try {
  // Standalone Fit.
  const atLimit = await dispatches(() => analyzeFitAssessment({ jobText: jobAtLimit, resumeText: resumeAtLimit, body }));
  assert.equal(atLimit.calls, 1, "a boundary-sized input dispatches once");
  assert.equal(atLimit.result.fitAssessment?.verdict, "REASONABLE", "a boundary-sized input is assessed");
  assert.equal(atLimit.result.attempts, 1);

  for (const [label, input] of [
    ["24,001-character posting", { jobText: jobAtLimit + "y", resumeText: resumeAtLimit }],
    ["28,001-character resume", { jobText: jobAtLimit, resumeText: resumeAtLimit + "y" }],
    ["NFKC-expanding posting", { jobText: "…".repeat(JOB_LIMIT / 3 + 1), resumeText: resumeAtLimit }]
  ]) {
    const over = await dispatches(() => analyzeFitAssessment({ ...input, body }));
    assert.equal(over.calls, 0, `${label}: no provider call is made`);
    assert.equal(over.result.fitAssessment, null, `${label}: no assessment`);
    assert.match(over.result.fitAssessmentError, LIMIT_MESSAGE, `${label}: the existing explanation is returned`);
    assert.equal(over.result.attempts, 0, `${label}: zero attempts are reported`);
    assert.equal(over.result.provider, "openai", `${label}: the resolved configuration is still echoed`);
  }

  // Standalone route keeps its 200 / unavailable contract and makes no call.
  const route = await dispatches(() => postTo(handleJobAnalysis, { ...body, mode: "fit-assessment", text: jobAtLimit + "y", resumeText: resumeAtLimit }));
  assert.equal(route.calls, 0, "the route makes no provider call for an oversized posting");
  assert.equal(route.result.status, 200);
  assert.equal(route.result.body.fitAssessmentStatus, "unavailable");
  assert.match(route.result.body.fitAssessmentError, LIMIT_MESSAGE);
  assert.equal(route.result.body.fitAssessment, null);
  const routeResume = await dispatches(() => postTo(handleJobAnalysis, { ...body, mode: "fit-assessment", text: jobAtLimit, resumeText: "…".repeat(RESUME_LIMIT / 3 + 1) }));
  assert.equal(routeResume.calls, 0, "the route makes no provider call for an NFKC-expanding oversized resume");
  assert.equal(routeResume.result.body.fitAssessmentStatus, "unavailable");

  // Combined Prepare: Job analysis runs once, Fit is omitted, the resume never leaves.
  const marker = "RESUME_MARKER_7f3a";
  for (const [label, jobText, resumeText] of [
    ["oversized posting", jobAtLimit + "y", `${marker} ${resumeAtLimit}`.slice(0, RESUME_LIMIT)],
    ["oversized resume", jobAtLimit, `${marker} ${resumeAtLimit}y`]
  ]) {
    const combined = await dispatches(() => analyzeJobToFields({ jobText, body: { ...body, fitAssessment: { enabled: true, resumeText } } }));
    assert.equal(combined.calls, 1, `${label}: Job analysis still dispatches exactly once`);
    assert.doesNotMatch(combined.sent, new RegExp(marker), `${label}: the resume never reaches the provider`);
    assert.doesNotMatch(combined.sent, /Fit Assessment rules/, `${label}: the prompt carries no Fit section`);
    assert.equal(combined.result.fitAssessmentRequested, true, `${label}: the request is still reported`);
    assert.equal(combined.result.fitAssessment, null, `${label}: no Fit result`);
    assert.match(combined.result.fitAssessmentError, LIMIT_MESSAGE, `${label}: the Fit limit is reported`);
  }
  const combinedAt = await dispatches(() => analyzeJobToFields({ jobText: jobAtLimit, body: { ...body, fitAssessment: { enabled: true, resumeText: resumeAtLimit } } }));
  assert.equal(combinedAt.calls, 1, "a boundary-sized combined request dispatches once");
  assert.match(combinedAt.sent, /Fit Assessment rules/, "the combined prompt carries the Fit section at the boundary");
  assert.equal(combinedAt.result.fitAssessment?.verdict, "REASONABLE", "the combined Fit half is accepted at the boundary");

  // The Profile message still wins when both the Profile and the posting are oversized.
  const both = await dispatches(() => analyzeJobToFields({ jobText: jobAtLimit + "y", body: { ...body, fitAssessment: { enabled: true, resumeText: "r".repeat(100), candidateContext: "c".repeat(CANDIDATE_CONTEXT_CHAR_LIMIT + 1) } } }));
  assert.equal(both.calls, 1);
  assert.equal(both.result.fitAssessmentError, PROFILE_BACKGROUND_LIMIT_MESSAGE, "the Profile limit is named first because it tells the user where to fix it");
} finally {
  globalThis.fetch = loopbackFetch;
  delete process.env.OPENAI_API_KEY;
}

console.log("Fit input-limit probes passed: shared normalized measure, zero dispatches over the limit, Job analysis preserved in combined Prepare");
