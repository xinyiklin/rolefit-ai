import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildFinalCheckPrompts, sanitizeFinalCheck } from "../finalCheck.ts";
import { sanitizeFinalCheckWireResult } from "../../../shared/finalCheckContract.ts";

const currentResume = `Software Developer | Acme
Built JavaScript and SQL tools for internal teams and improved uptime by 30%.
Skills: JavaScript, SQL, Kubernetes`;
const evidenceText = `Software Developer | Acme
Built JavaScript and SQL tools for internal teams.
Skills: JavaScript, SQL`;
const jobText = "Software Developer required to build JavaScript services with SQL and AWS for internal teams.";

const source = readFileSync(new URL("../finalCheck.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../../runtime.ts", import.meta.url), "utf8");
assert.equal(
  source.match(/await callConfiguredProvider\(/g)?.length,
  1,
  "Final Check owns exactly one provider dispatch"
);
assert.match(
  runtime,
  /pathname === "\/api\/final-check"[\s\S]{0,180}?handleFinalCheck\(req, res\)/,
  "the local server exposes Final Check through its own route"
);

const prompts = buildFinalCheckPrompts({ currentResume, evidenceText, jobText, customInstructions: "" });
assert.match(prompts.userPrompt, /<current_resume>[\s\S]*30%/);
assert.match(prompts.userPrompt, /<candidate_evidence>[\s\S]*JavaScript, SQL/);
assert.doesNotMatch(prompts.userPrompt, /aiScore|strictReview|requirementId|coverage table/i);

const partial = sanitizeFinalCheck(
  {
    status: "READY",
    summary: "Model status is advisory.",
    issues: [
      {
        kind: "UNSUPPORTED",
        detail: "The resume claims a 30% uptime improvement.",
        action: "Add evidence for the metric or remove it."
      },
      {
        kind: "MISSING",
        detail: "The job requires AWS, but the current resume does not show it.",
        action: "Add supported AWS evidence if available."
      },
      {
        kind: "UNSUPPORTED",
        detail: "The resume claims JavaScript and SQL experience.",
        action: "Remove the supported skills."
      },
      { kind: "UNKNOWN", detail: "Bad optional issue.", action: "Ignore." }
    ]
  },
  currentResume,
  evidenceText,
  jobText
);
assert.equal(partial.status, "NEEDS_EVIDENCE", "the server derives the truthful status from valid issues");
assert.equal(partial.issues.length, 2, "one malformed issue does not discard valid siblings");
assert.match(partial.summary, /1 claim needs evidence/);
assert.ok(sanitizeFinalCheckWireResult(partial), "the server result satisfies the independent client wire contract");

const review = sanitizeFinalCheck(
  {
    issues: [{
      kind: "CLARITY",
      detail: "The JavaScript and SQL tools bullet is vague about the work delivered.",
      action: "Clarify the supported responsibility or scope."
    }]
  },
  currentResume,
  evidenceText,
  jobText
);
assert.equal(review.status, "REVIEW");

const ready = sanitizeFinalCheck({ status: "REVIEW", issues: [] }, currentResume, evidenceText, jobText);
assert.deepEqual(ready, {
  status: "READY",
  summary: "No material unsupported, missing, or clarity issues were identified.",
  issues: []
});

assert.throws(
  () => sanitizeFinalCheck(
    { issues: [{ kind: "UNKNOWN", detail: "Nope", action: "Nope" }] },
    currentResume,
    evidenceText,
    jobText
  ),
  /invalid Final Check/,
  "an all-invalid response fails instead of becoming a false READY result"
);

console.log("optional Final Check probes: passed");
