import assert from "node:assert/strict";

import {
  buildResumeDocumentTitle,
  buildResumeFileName,
  completeAutoResumeDocumentTitle,
  resolveResumeApplicantName
} from "../downloads.ts";

assert.equal(
  buildResumeDocumentTitle("Xinyi Lin", "Hadrian"),
  "Xinyi_Lin_Hadrian_Resume",
  "the editable title names the applicant and target company"
);
assert.equal(
  buildResumeFileName("Xinyi Lin", "Hadrian", "pdf"),
  "Xinyi_Lin_Hadrian_Resume.pdf",
  "the PDF filename uses the same base as the editable title"
);
assert.equal(buildResumeDocumentTitle("Xinyi Lin", ""), "Xinyi_Lin_Resume", "a missing company keeps the applicant");
assert.equal(buildResumeDocumentTitle("", "Hadrian"), "Hadrian_Resume", "a missing applicant keeps the company");
assert.equal(buildResumeDocumentTitle("", ""), "Resume", "missing metadata degrades to Resume");
assert.equal(resolveResumeApplicantName("<b>Xinyi Lin</b>", ""), "Xinyi Lin", "structured names lose inline markup");
assert.equal(
  completeAutoResumeDocumentTitle("Intuit_Resume", "Xinyi Lin", "Intuit", "Resume"),
  "Xinyi_Lin_Intuit_Resume",
  "a company-only automatic title completes when the applicant arrives"
);
assert.equal(
  completeAutoResumeDocumentTitle("Resume", "Xinyi Lin", "Intuit", "Resume"),
  "Xinyi_Lin_Intuit_Resume",
  "the initial placeholder completes when both identities arrive"
);
assert.equal(
  completeAutoResumeDocumentTitle("Frontend application", "Xinyi Lin", "Intuit", "Resume"),
  "Frontend application",
  "a user-edited title is preserved"
);

console.log("PASS resume document and export naming");
