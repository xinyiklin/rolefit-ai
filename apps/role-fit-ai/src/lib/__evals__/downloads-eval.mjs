import assert from "node:assert/strict";

import {
  buildCoverLetterDocumentTitle,
  buildResumeDocumentTitle,
  buildResumeFileName,
  completeAutoDocumentTitle,
  COVER_LETTER_TITLE_PLACEHOLDERS,
  resolveResumeApplicantName,
  swapDocumentTitleKind
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
  completeAutoDocumentTitle("resume", "Intuit_Resume", "Xinyi Lin", "Intuit", ["Resume"]),
  "Xinyi_Lin_Intuit_Resume",
  "a company-only automatic title completes when the applicant arrives"
);
assert.equal(
  completeAutoDocumentTitle("resume", "Resume", "Xinyi Lin", "Intuit", ["Resume"]),
  "Xinyi_Lin_Intuit_Resume",
  "the initial placeholder completes when both identities arrive"
);
assert.equal(
  completeAutoDocumentTitle("resume", "Frontend application", "Xinyi Lin", "Intuit", ["Resume"]),
  "Frontend application",
  "a user-edited title is preserved"
);

// The cover letter names documents the same way, so a resume and its letter for
// one role read as one application.
const COVER_PLACEHOLDERS = COVER_LETTER_TITLE_PLACEHOLDERS;
// Blank and Starter take the resume's title retargeted; the untouched default
// still upgrades once the identity is known.
assert.equal(
  completeAutoDocumentTitle(
    "coverLetter",
    swapDocumentTitleKind("Resume", "coverLetter"),
    "Xinyi Lin",
    "Intuit",
    COVER_PLACEHOLDERS
  ),
  "Xinyi_Lin_Intuit_Cover_Letter",
  "a letter titled from the default resume title upgrades like the resume"
);
assert.equal(
  swapDocumentTitleKind("Xinyi_Lin_Intuit_Resume", "coverLetter"),
  "Xinyi_Lin_Intuit_Cover_Letter",
  "a letter titled from an automatic resume title names the same application"
);
assert.equal(
  buildCoverLetterDocumentTitle("Xinyi Lin", "Hadrian"),
  "Xinyi_Lin_Hadrian_Cover_Letter",
  "the letter title names the applicant and target company like the resume"
);
assert.equal(buildCoverLetterDocumentTitle("Xinyi Lin", ""), "Xinyi_Lin_Cover_Letter", "a missing company keeps the applicant");
assert.equal(buildCoverLetterDocumentTitle("", "Hadrian"), "Hadrian_Cover_Letter", "a missing applicant keeps the company");
assert.equal(buildCoverLetterDocumentTitle("", ""), "Cover_Letter", "missing metadata degrades to the bare kind");
assert.equal(
  completeAutoDocumentTitle("coverLetter", "Cover letter", "Xinyi Lin", "Intuit", COVER_PLACEHOLDERS),
  "Xinyi_Lin_Intuit_Cover_Letter",
  "the editor's own default title is upgraded once the identity is known"
);
assert.equal(
  completeAutoDocumentTitle("coverLetter", "Intuit_Cover_Letter", "Xinyi Lin", "Intuit", COVER_PLACEHOLDERS),
  "Xinyi_Lin_Intuit_Cover_Letter",
  "a company-only letter title completes when the applicant arrives"
);
assert.equal(
  completeAutoDocumentTitle("coverLetter", "Xinyi_Lin_Intuit_Cover_Letter", "Xinyi Lin", "Intuit", COVER_PLACEHOLDERS),
  "Xinyi_Lin_Intuit_Cover_Letter",
  "a completed letter title is stable across re-renders"
);
assert.equal(
  completeAutoDocumentTitle("coverLetter", "Referral note", "Xinyi Lin", "Intuit", COVER_PLACEHOLDERS),
  "Referral note",
  "a letter title the user typed is preserved"
);
assert.equal(
  completeAutoDocumentTitle("coverLetter", "Xinyi_Lin_Intuit_Resume", "Xinyi Lin", "Intuit", COVER_PLACEHOLDERS),
  "Xinyi_Lin_Intuit_Resume",
  "one document kind never rewrites a title belonging to the other"
);

console.log("PASS resume and cover-letter document and export naming");
