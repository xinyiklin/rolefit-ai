import assert from "node:assert/strict";
import {
  buildApplicationReviewInput,
  applicationReviewDependencies,
  reviewRequestIsCurrent,
} from "../applicationReview.ts";
import { applicationReviewEvidenceLimitError } from "../../../shared/applicationReviewContract.ts";
const base = {
  jobText: "Build Python services.",
  company: "Acme",
  role: "Engineer",
  includeResume: true,
  includeCoverLetter: false,
  resumeText: "Built <b>Python</b> services.",
  coverLetterText: "Excluded private letter",
  originalResumeText: "PROJECTS\nAtlas\n- Built Python services.",
  candidateContext: "",
};
const a = buildApplicationReviewInput(base),
  b = buildApplicationReviewInput({
    ...base,
    resumeText: "Built Python services.",
  });
assert.deepEqual(a, b, "inline formatting does not stale review");
assert.equal(a.coverLetterText, "", "excluded letter never dispatched");
assert.ok(a.evidence.every((item) => item.kind === "resume"));
const c = buildApplicationReviewInput({
  ...base,
  includeResume: false,
  includeCoverLetter: true,
  coverLetterText: "I built Python services.",
});
assert.equal(c.resumeText, "");
assert.ok(c.evidence[0].label.includes("excluded from submission"));
const abort = new AbortController();
const identity = JSON.stringify(a);
assert.equal(
  reviewRequestIsCurrent(1, 1, identity, identity, abort.signal),
  true,
);
assert.equal(
  reviewRequestIsCurrent(1, 2, identity, identity, abort.signal),
  false,
);
assert.equal(
  reviewRequestIsCurrent(1, 1, identity, JSON.stringify(c), abort.signal),
  false,
);
abort.abort();
assert.equal(
  reviewRequestIsCurrent(1, 1, identity, identity, abort.signal),
  false,
);
const deps = applicationReviewDependencies(a, {});
const changed = applicationReviewDependencies(
  { ...a, coverLetterText: "New letter", includeCoverLetter: true },
  {},
);
assert.equal(deps.resume, changed.resume);
assert.notEqual(deps.coverLetter, changed.coverLetter);
console.log(
  "Exact review identity, Include privacy, source labels, formatting and late completion probes passed",
);

const many = buildApplicationReviewInput({
  ...base,
  originalResumeText: "",
  candidateContext: Array.from(
    { length: 65 },
    (_, i) => `Built Python service number ${i}.`,
  ).join("\n"),
});
assert.equal(
  many.evidence.length,
  65,
  "the builder preserves every evidence record",
);
assert.equal(
  applicationReviewEvidenceLimitError(many.evidence),
  null,
  "65 records fit the server evidence contract",
);
const tooMany = buildApplicationReviewInput({
  ...base,
  originalResumeText: "",
  candidateContext: Array.from(
    { length: 401 },
    (_, i) => `Built Python service number ${i}.`,
  ).join("\n"),
});
assert.equal(
  tooMany.evidence.length,
  401,
  "oversized input is never silently truncated",
);
assert.match(
  applicationReviewEvidenceLimitError(tooMany.evidence),
  /400 evidence items/,
);
