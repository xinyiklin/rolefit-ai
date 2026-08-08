import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildFinalCheckPrompts, finalCheckDocumentKind, sanitizeFinalCheck } from "../finalCheck.ts";
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

const prompts = buildFinalCheckPrompts({ currentDocument: currentResume, evidenceText, jobText, customInstructions: "" });
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
        sourceExcerpt: "improved uptime by 30%",
        detail: "The resume claims a 30% uptime improvement.",
        action: "Add evidence for the metric or remove it."
      },
      {
        kind: "MISSING",
        sourceExcerpt: "AWS",
        detail: "The job requires AWS, but the current resume does not show it.",
        action: "Add supported AWS evidence if available."
      },
      {
        kind: "UNSUPPORTED",
        sourceExcerpt: "JavaScript and SQL tools",
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
assert.ok(
  partial.issues.every((issue) => !("sourceExcerpt" in issue)),
  "private source anchors never enter the public result"
);
assert.match(partial.summary, /1 claim needs evidence/);
assert.ok(sanitizeFinalCheckWireResult(partial), "the server result satisfies the independent client wire contract");

const review = sanitizeFinalCheck(
  {
    issues: [{
      kind: "CLARITY",
      sourceExcerpt: "Built JavaScript and SQL tools for internal teams",
      detail: "The JavaScript and SQL tools bullet is vague about the work delivered.",
      action: "Clarify the supported responsibility or scope."
    }]
  },
  currentResume,
  evidenceText,
  jobText
);
assert.equal(review.status, "REVIEW");

const paraphrased = sanitizeFinalCheck(
  {
    issues: [{
      kind: "CLARITY",
      sourceExcerpt: "Built JavaScript and SQL tools for internal teams",
      detail: "The JavaScript accomplishment does not make the candidate's ownership easy to scan.",
      action: "Clarify the supported scope and ownership."
    }]
  },
  currentResume,
  evidenceText,
  jobText
);
assert.equal(
  paraphrased.issues.length,
  1,
  "a clarity detail may paraphrase only when it remains materially bound to the cited wording"
);

assert.throws(
  () => sanitizeFinalCheck(
    {
      issues: [{
        kind: "UNSUPPORTED",
        sourceExcerpt: "JavaScript and SQL tools for internal teams",
        detail: "The resume claims a 30% uptime improvement.",
        action: "Add evidence for the metric or remove it."
      }]
    },
    currentResume,
    evidenceText,
    jobText
  ),
  /invalid document check/,
  "an unrelated exact document excerpt cannot anchor a different unsupported claim"
);

assert.throws(
  () => sanitizeFinalCheck(
    {
      issues: [{
        kind: "MISSING",
        sourceExcerpt: "JavaScript services",
        detail: "The job requires AWS, but the current resume does not show it.",
        action: "Add supported AWS evidence if available."
      }]
    },
    currentResume,
    evidenceText,
    jobText
  ),
  /invalid document check/,
  "an unrelated exact posting excerpt cannot anchor a different missing requirement"
);

assert.throws(
  () => sanitizeFinalCheck(
    {
      issues: [{
        kind: "CLARITY",
        sourceExcerpt: "Architected a globally distributed platform",
        detail: "The platform claim is hard to scan.",
        action: "Clarify the platform scope."
      }]
    },
    currentResume,
    evidenceText,
    jobText
  ),
  /invalid document check/,
  "fabricated document wording cannot become a clarity issue"
);

assert.throws(
  () => sanitizeFinalCheck(
    {
      issues: [{
        kind: "MISSING",
        sourceExcerpt: "five years of healthcare experience",
        detail: "The posting requires five years of healthcare experience.",
        action: "Add supported healthcare experience if available."
      }]
    },
    currentResume,
    evidenceText,
    jobText
  ),
  /invalid document check/,
  "a fabricated job requirement cannot become a missing issue"
);

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
  /invalid document check/,
  "an all-invalid response fails instead of becoming a false READY result"
);

// --- The same check serves a cover letter ---------------------------------
// A letter that was never produced by Polish has no validated receipt, so it is
// eligible for the same check. Only the nouns change: the issue kinds,
// grounding, and outcomes are one contract for both documents.
assert.equal(finalCheckDocumentKind("cover-letter"), "cover-letter", "the letter kind is explicit");
assert.equal(finalCheckDocumentKind("resume"), "resume", "the resume kind is explicit");
assert.equal(finalCheckDocumentKind(undefined), "resume", "an absent kind defaults to the resume");
assert.equal(finalCheckDocumentKind("../etc/passwd"), "resume", "an unknown kind cannot select a third prompt");

const letter = `Dear Hiring Team,

I built JavaScript and SQL reporting tools at Acme and improved uptime by 30%.

Sincerely,
Jordan`;
const letterPrompts = buildFinalCheckPrompts({
  documentKind: "cover-letter",
  currentDocument: letter,
  evidenceText,
  jobText,
  customInstructions: ""
});
assert.match(letterPrompts.userPrompt, /<current_cover_letter>[\s\S]*30%/, "the letter is fenced under its own tag");
assert.doesNotMatch(letterPrompts.userPrompt, /<current_resume>/, "a letter check never claims to read a resume");
assert.match(
  letterPrompts.systemPrompt,
  /advisory final check of a job application cover letter/,
  "the system prompt names the document it is reading"
);
assert.doesNotMatch(
  letterPrompts.systemPrompt.split("Inspect the actual")[1],
  /resume/,
  "the letter's own instructions do not mix in resume vocabulary"
);
// Both documents' fences must be declared data by the shared firewall, or the
// letter's prose becomes an injection path the moment it is fenced.
for (const tag of ["<current_resume>", "<current_cover_letter>", "<candidate_evidence>", "<user_guidance>"]) {
  assert.ok(
    letterPrompts.systemPrompt.includes(tag),
    `the input firewall declares ${tag} as data, never instructions`
  );
}
assert.match(letterPrompts.userPrompt, /never write replacement cover letter text/, "the letter check stays advisory");

const letterChecked = sanitizeFinalCheck(
  {
    status: "NEEDS_EVIDENCE",
    summary: "advisory",
    issues: [
      {
        kind: "UNSUPPORTED",
        sourceExcerpt: "improved uptime by 30%",
        detail: "The letter claims a 30% uptime improvement.",
        action: "Add evidence for the uptime figure or soften the claim."
      }
    ]
  },
  letter,
  evidenceText,
  jobText
);
assert.equal(letterChecked.status, "NEEDS_EVIDENCE", "a letter reaches the same three outcomes as a resume");
assert.equal(letterChecked.issues.length, 1, "a grounded letter issue survives the same sanitizer");

console.log("optional Final Check probes: passed");
