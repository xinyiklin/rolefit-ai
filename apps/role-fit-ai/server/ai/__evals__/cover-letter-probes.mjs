// Cover-letter route + grounded generator probes (server/ai/coverLetter.ts),
// which previously had ZERO coverage despite sharing the anti-fabrication
// surface of distill/polish. Fully offline and deterministic:
//
//   - handleCoverLetter: method gate (non-POST -> 405), the resume/job length
//     gates (-> 400), and malformed-JSON body handling (fail-closed, safe JSON);
//   - generateGroundedCoverLetter: the prose grounding + numeric backstop that
//     blanks a letter naming a JD skill term or a number absent from the resume
//     + honest context. The provider call is exercised through the real OpenAI
//     dispatch with globalThis.fetch stubbed (no network), mirroring the
//     injected-fetch style the provider-contracts eval uses.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { generateGroundedCoverLetter, handleCoverLetter } from "../coverLetter.ts";

// --- fake IncomingMessage / ServerResponse for the HTTP handler -------------
class FakeReq extends EventEmitter {
  constructor(method) {
    super();
    this.method = method;
    this.aborted = false;
  }
}
class FakeRes extends EventEmitter {
  constructor() {
    super();
    this.statusCode = null;
    this.body = null;
    this.writableEnded = false;
    this.destroyed = false;
  }
  writeHead(status) {
    this.statusCode = status;
    return this;
  }
  end(payload) {
    this.body = payload;
    this.writableEnded = true;
    this.emit("finish");
  }
}

async function runHandler(method, body) {
  const req = new FakeReq(method);
  const res = new FakeRes();
  const done = handleCoverLetter(req, res);
  if (method === "POST") {
    // readBody attaches its listeners synchronously before the first await, so
    // deliver the body on the next microtask.
    queueMicrotask(() => {
      if (body != null) req.emit("data", Buffer.from(body));
      req.emit("end");
    });
  }
  await done;
  return { status: res.statusCode, payload: res.body ? JSON.parse(res.body) : null };
}

// Non-POST is rejected before anything else runs.
const getResult = await runHandler("GET");
assert.equal(getResult.status, 405, "non-POST is rejected with 405");
assert.match(getResult.payload.error, /Use POST/, "405 carries a stable user-safe message");

// A valid but empty body fails the resume-length gate with a 400.
const emptyBody = await runHandler("POST", "{}");
assert.equal(emptyBody.status, 400, "an empty body is a 400, not a crash");
assert.match(emptyBody.payload.error, /Add your resume/, "the resume gate message is surfaced");

// Resume present but job text too short -> the job-length gate fires with a 400.
const noJob = await runHandler("POST", JSON.stringify({ resumeText: "R".repeat(120), jobText: "hi" }));
assert.equal(noJob.status, 400, "a too-short job description is a 400");
assert.match(noJob.payload.error, /Add the job description/, "the job gate message is surfaced");

// Malformed JSON is caught at the request boundary and fails closed with safe
// JSON (no throw, no leak). readAiJsonBody classifies it as a 400 request
// error — matching handleImportJob — instead of the old provider-flavored 500
// (no provider call ever ran, so blaming the provider misdirected the user).
const malformed = await runHandler("POST", "{ not json ");
assert.equal(malformed.status, 400, "malformed JSON fails closed with a 400");
assert.match(malformed.payload.error, /Request body must be valid JSON/, "the fail-closed message is user-safe");
assert.equal(malformed.payload.coverLetterText, undefined, "no partial letter is emitted on a malformed request");

// --- grounded generator backstop (offline OpenAI dispatch) ------------------
const realFetch = globalThis.fetch;
const stubOpenAi = (coverLetterText) => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ output_text: JSON.stringify({ coverLetterText }) }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
};

// JD asks for Terraform + Python; the resume only evidences Python + REST APIs.
const jobText = "We need Terraform and Python for infrastructure automation.";
const resumeText = "Built Python services and REST APIs for the reporting platform over several years.";
const baseArgs = {
  provider: "openai",
  model: "gpt-test",
  apiKey: "offline-test-key",
  jobText,
  resumeText,
  honestContext: "",
  customInstructions: ""
};

try {
  // A letter grounded in the resume (Python, REST APIs) passes through unchanged.
  stubOpenAi("I built Python services and REST APIs and would bring that experience to your team.");
  const grounded = await generateGroundedCoverLetter({ ...baseArgs });
  assert(grounded.length > 0 && /Python/.test(grounded), "a fully grounded letter survives the backstop");

  // A letter claiming a JD skill term absent from the resume is blanked.
  stubOpenAi("I have extensive Terraform experience and can automate your infrastructure end to end.");
  const ungroundedTerm = await generateGroundedCoverLetter({ ...baseArgs });
  assert.equal(ungroundedTerm, "", "an ungrounded JD skill term (Terraform) blanks the letter");

  // A letter with a numeric claim absent from the grounding corpus is blanked.
  stubOpenAi("I built Python services and boosted platform throughput by 47% within one quarter.");
  const ungroundedNumber = await generateGroundedCoverLetter({ ...baseArgs });
  assert.equal(ungroundedNumber, "", "an ungrounded numeric claim blanks the letter");

  // Common words can still fabricate an achievement. The technology and
  // numeric gates cannot see this class, so the outcome-family backstop must.
  stubOpenAi("I built Python services that prevented outages and protected revenue.");
  const ungroundedOutcome = await generateGroundedCoverLetter({ ...baseArgs });
  assert.equal(ungroundedOutcome, "", "an ordinary-language fabricated outcome blanks the letter");

  // Aspirational/conditional impact is not a claim about prior candidate work.
  stubOpenAi("I built Python services and could improve reliability in this role.");
  const conditionalOutcome = await generateGroundedCoverLetter({ ...baseArgs });
  assert.match(conditionalOutcome, /could improve reliability/, "conditional future impact remains usable");
} finally {
  globalThis.fetch = realFetch;
}

console.log("cover-letter route + grounding backstop probes: PASS");
