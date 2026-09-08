import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import {
  handleApplicationReview,
  parseApplicationReviewInput,
  reviewProviderFindings,
} from "../applicationReview.ts";
import {
  localApplicationReview,
  applicationReviewEvidenceLimitError,
  sanitizeApplicationReviewResult,
} from "../../../shared/applicationReviewContract.ts";
import { buildApplicationReviewInput } from "../../../src/lib/applicationReview.ts";
const input = {
  jobText: "Build Python services.",
  company: "Acme",
  role: "Engineer",
  includeResume: true,
  includeCoverLetter: false,
  resumeText: "Built Python services. [Add metric]",
  coverLetterText: "",
  evidence: [
    {
      id: "original",
      kind: "resume",
      label: "Loaded resume evidence",
      text: "Built Python services.",
    },
  ],
};
const local = localApplicationReview(input);
assert.equal(local.findings[0].code, "placeholder");
assert.equal(
  localApplicationReview({ ...input, includeResume: false, resumeText: "" })
    .reviewedDocuments.length,
  0,
);
assert.throws(
  () => parseApplicationReviewInput({ ...input, includeResume: false }),
  /Excluded/,
);
assert.throws(
  () =>
    parseApplicationReviewInput({
      ...input,
      evidence: [input.evidence[0], input.evidence[0]],
    }),
  /invalid evidence/,
);
const bad = reviewProviderFindings(
  {
    coverageComplete: true,
    overflow: false,
    findings: [
      {
        code: "unsupported_claim",
        document: "resume",
        anchor: "Invented anchor",
        message: "Wrong",
        recovery: "Check",
        evidenceId: "original",
        sourceExcerpt: "Built Python services.",
      },
    ],
  },
  input,
  local,
);
assert.equal(bad.complete, false);
assert.equal(bad.findings.length, local.findings.length);
assert.equal(
  reviewProviderFindings(
    { coverageComplete: true, overflow: true, findings: [] },
    input,
    local,
  ).complete,
  false,
);
class Req extends EventEmitter {
  method = "POST";
  aborted = false;
}
class Res extends EventEmitter {
  writableEnded = false;
  destroyed = false;
  writeHead(status) {
    this.status = status;
  }
  end(body) {
    this.body = JSON.parse(body);
    this.writableEnded = true;
    this.emit("finish");
  }
}
async function invoke(body, method = "POST") {
  const req = new Req();
  req.method = method;
  const res = new Res();
  const promise = handleApplicationReview(req, res);
  queueMicrotask(() => {
    req.emit("data", Buffer.from(JSON.stringify(body)));
    req.emit("end");
  });
  await promise;
  return res;
}
const oldFetch = globalThis.fetch;
const oldKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = "synthetic-test-key";
let calls = 0;
let output = "not JSON";
globalThis.fetch = async (url, options) => {
  calls++;
  assert.equal(JSON.parse(options.body).store, false);
  return new Response(JSON.stringify({ output_text: output }), { status: 200 });
};
try {
  assert.equal((await invoke(input, "GET")).status, 405);
  const empty = await invoke({
    ...input,
    includeResume: false,
    resumeText: "",
  });
  assert.equal(empty.status, 200);
  assert.equal(calls, 0);
  const failed = await invoke({
    ...input,
    provider: "openai",
    model: "synthetic-model",
  });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.complete, false);
  assert.ok(failed.body.error);
  assert.equal(calls, 1, "final review never repairs unreadable output");
  assert.equal(failed.body.findings[0].code, "placeholder");
  output = JSON.stringify({
    coverageComplete: true,
    overflow: false,
    findings: [],
  });
  const good = await invoke({
    ...input,
    resumeText: "Built Python services.",
    provider: "openai",
    model: "synthetic-model",
  });
  assert.equal(good.body.complete, true);
  assert.equal(calls, 2);
  assert.equal(input.resumeText, "Built Python services. [Add metric]");
} finally {
  globalThis.fetch = oldFetch;
  if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = oldKey;
}
const route = readFileSync(
  new URL("../applicationReview.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  route,
  /writeFile|saveApplication|handlePolish|generateResumeProposal/,
);
console.log(
  "Final review route, local findings, limits, malformed output and single dispatch probes passed",
);

const conflicting = {
  ...input,
  includeCoverLetter: true,
  coverLetterText: "I led the Atlas migration in 2023.",
  resumeText: "Supported the Atlas migration in 2022.",
};
const conflict = localApplicationReview(conflicting).findings.find(
  (finding) => finding.code === "attribution",
);
assert.ok(conflict);
assert.deepEqual(conflict.dependencies, ["resume", "coverLetter"]);
const target = localApplicationReview({
  ...input,
  includeCoverLetter: true,
  coverLetterText: "I am applying for the Engineer role at Other.",
}).findings.find((finding) => finding.code === "target");
assert.ok(target.dependencies.includes("job"));
const fabricated = reviewProviderFindings(
  {
    coverageComplete: true,
    overflow: false,
    findings: [
      {
        code: "revision",
        document: "coverLetter",
        anchor: conflicting.coverLetterText,
        message: "Add technology evidence.",
        recovery: "I built Python services.",
        evidenceId: "job_posting",
        sourceExcerpt: "Build Python services.",
      },
    ],
  },
  conflicting,
  localApplicationReview(conflicting),
);
assert.equal(fabricated.complete, false);
assert.ok(!fabricated.findings.some((finding) => finding.code === "revision"));

const employerInput = {
  ...input,
  includeResume: false,
  resumeText: "",
  includeCoverLetter: true,
  coverLetterText: "Acme built Python services.",
  jobText: "Acme built Python services.",
};
const employerFinding = {
  code: "revision",
  document: "coverLetter",
  anchor: employerInput.coverLetterText,
  message: "Check wording.",
  recovery: "Acme built Python services.",
  evidenceId: "job_posting",
  sourceExcerpt: employerInput.jobText,
};
assert.ok(
  reviewProviderFindings(
    { coverageComplete: true, overflow: false, findings: [employerFinding] },
    employerInput,
    localApplicationReview(employerInput),
  ).findings.some((finding) => finding.code === "revision"),
);
assert.ok(
  !reviewProviderFindings(
    {
      coverageComplete: true,
      overflow: false,
      findings: [
        {
          ...employerFinding,
          recovery:
            "I led the Kubernetes migration and increased revenue by 99%.",
        },
      ],
    },
    employerInput,
    localApplicationReview(employerInput),
  ).findings.some((finding) => finding.code === "revision"),
);

const placeholderInput = {
  ...input,
  resumeText: Array.from({ length: 7 }, (_, i) => `[TODO ${i}]`).join(" "),
};
const placeholders = localApplicationReview(placeholderInput);
assert.equal(
  placeholders.findings.length,
  7,
  "each bracketed placeholder is one location",
);
assert.equal(placeholders.overflow, false);
assert.equal(
  localApplicationReview({ ...input, resumeText: "[TODO] TODO [TBD] TBD" })
    .findings.length,
  4,
  "bare tokens remain separate findings",
);
const duplicates = reviewProviderFindings(
  {
    coverageComplete: true,
    overflow: false,
    findings: placeholders.findings
      .flatMap((finding) => [finding, finding])
      .map((finding) => ({
        ...finding,
        evidenceId: "original",
        sourceExcerpt: "Built Python services.",
      })),
  },
  placeholderInput,
  placeholders,
);
assert.equal(
  duplicates.findings.length,
  7,
  "local and provider duplicates merge before the display cap",
);
assert.equal(duplicates.overflow, false);
assert.equal(duplicates.complete, true);
const nestedDuplicate = reviewProviderFindings(
  {
    coverageComplete: true,
    overflow: false,
    findings: [
      {
        code: "placeholder",
        document: "resume",
        anchor: "TODO",
        message: "Unfinished placeholder.",
        recovery: "Complete this placeholder.",
        evidenceId: "original",
        sourceExcerpt: "Built Python services.",
      },
    ],
  },
  { ...input, resumeText: "[TODO]" },
  localApplicationReview({ ...input, resumeText: "[TODO]" }),
);
assert.equal(
  nestedDuplicate.findings.length,
  1,
  "a bracketed and bare citation to the same placeholder merge",
);
const trulyOverflowing = localApplicationReview({
  ...input,
  resumeText: Array.from({ length: 13 }, (_, i) => `[TODO ${i}]`).join(" "),
});
assert.equal(trulyOverflowing.findings.length, 12);
assert.equal(trulyOverflowing.overflow, true);

let excludedDocumentReads = 0;
const scanInput = {
  ...input,
  resumeText: "Built Python services.",
  get coverLetterText() {
    excludedDocumentReads++;
    return "";
  },
};
const scanLocal = localApplicationReview(scanInput);
excludedDocumentReads = 0;
const repeatedFindings = Array.from({ length: 12 }, () => ({
  code: "coverage",
  document: "resume",
  anchor: scanInput.resumeText,
  message: "Check service emphasis.",
  recovery: "Highlight the supported service work.",
  evidenceId: "original",
  sourceExcerpt: "Built Python services.",
}));
const scanResult = reviewProviderFindings(
  { coverageComplete: true, overflow: false, findings: repeatedFindings },
  scanInput,
  scanLocal,
);
assert.equal(
  excludedDocumentReads,
  0,
  "individual validation does not rerun the whole local review",
);
assert.equal(scanResult.findings.length, 1, "provider duplicates also merge");
assert.ok(
  sanitizeApplicationReviewResult(scanResult, scanInput),
  "client boundary still validates the complete result",
);
assert.equal(
  excludedDocumentReads,
  0,
  "client result validation checks inclusion without rerunning local analysis",
);
assert.equal(
  sanitizeApplicationReviewResult(
    {
      ...scanResult,
      findings: [{ ...scanResult.findings[0], anchor: "Not in resume" }],
    },
    scanInput,
  ),
  null,
);

const manyEvidence = Array.from({ length: 65 }, (_, i) => ({
  ...input.evidence[0],
  id: `source-${i}`,
}));
assert.equal(
  parseApplicationReviewInput({ ...input, evidence: manyEvidence }).evidence
    .length,
  65,
);
const maxEvidence = Array.from({ length: 400 }, (_, i) => ({
  ...input.evidence[0],
  id: `source-${i}`,
}));
assert.equal(
  parseApplicationReviewInput({ ...input, evidence: maxEvidence }).evidence
    .length,
  400,
);
assert.throws(
  () =>
    parseApplicationReviewInput({
      ...input,
      evidence: [...maxEvidence, { ...input.evidence[0], id: "extra" }],
    }),
  /400 evidence items/,
);
const exactBudget = [0, 1].map((i) => ({
  ...input.evidence[0],
  id: `budget-${i}`,
  text: "a".repeat(60_000),
}));
assert.equal(applicationReviewEvidenceLimitError(exactBudget), null);
assert.equal(
  parseApplicationReviewInput({ ...input, evidence: exactBudget }).evidence[0]
    .text.length,
  60_000,
);
const tooLarge = [...exactBudget, { ...input.evidence[0], id: "over-budget" }];
assert.match(applicationReviewEvidenceLimitError(tooLarge), /too large/);
assert.throws(
  () => parseApplicationReviewInput({ ...input, evidence: tooLarge }),
  /too large/,
);
console.log(
  "Review deduplication, single-finding validation, and shared bounded evidence probes passed",
);

const produced = buildApplicationReviewInput({
  ...input,
  originalResumeText: 'PROJECTS\n' + 'Long project title '.repeat(40) + '\n- Built Python services.',
  candidateContext: Array.from({ length: 65 }, (_, i) => `Built Python service number ${i}.`).join('\n')
});
assert.equal(produced.evidence.filter((item) => item.kind === 'context').length, 65);
assert.ok(produced.evidence.some((item) => item.kind === 'resume'));
assert.ok(produced.evidence.every((item) => item.id.length <= 120 && item.label.length <= 200), 'the first-party builder uses compact hashed IDs and fixed labels, not entry titles');
assert.deepEqual(parseApplicationReviewInput(produced).evidence, produced.evidence, 'the real builder and server preserve the same complete evidence records');

const wrongTargetInput = {...input, jobText:"Acme is hiring an Engineer to build Python services.", includeResume:false, resumeText:"", includeCoverLetter:true, coverLetterText:"I am excited to apply for the Engineer position at Other."};
const wrongTarget = {code:"target", document:"coverLetter", anchor:wrongTargetInput.coverLetterText, message:"Check the company named in this letter.", recovery:"Confirm the company against the posting.", evidenceId:"job_posting", sourceExcerpt:wrongTargetInput.jobText};
const targetResult = reviewProviderFindings({coverageComplete:true,overflow:false,findings:[wrongTarget]}, wrongTargetInput, localApplicationReview(wrongTargetInput));
assert.ok(targetResult.findings.some(f=>f.code === "target"), "first-person target findings may cite the posting");
for (const code of ["revision", "coverage", "unsupported_claim"]) {
 const result = reviewProviderFindings({coverageComplete:true,overflow:false,findings:[{...wrongTarget,code}]},wrongTargetInput,localApplicationReview(wrongTargetInput));
 assert.equal(result.findings.length,0,"posting cannot support candidate claims");
}
