import assert from "node:assert/strict";

import {
  buildCoverLetterDocumentTitle,
  buildResumeDocumentTitle,
  buildResumeFileName,
  COVER_LETTER_TITLE_PLACEHOLDERS,
  followDocumentIdentityTitle,
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
const none = { name: "", company: "" };
const follow = (kind, title, identity, earlier = [none], placeholders = ["Resume"]) =>
  followDocumentIdentityTitle(kind, title, identity, earlier, placeholders);
assert.equal(
  follow("resume", "Intuit_Resume", { name: "Xinyi Lin", company: "Intuit" }, [{ name: "", company: "Intuit" }]),
  "Xinyi_Lin_Intuit_Resume",
  "a company-only automatic title completes when the applicant arrives"
);
assert.equal(
  follow("resume", "Resume", { name: "Xinyi Lin", company: "Intuit" }),
  "Xinyi_Lin_Intuit_Resume",
  "the initial placeholder completes when both identities arrive"
);
assert.equal(
  follow("resume", "Frontend application", { name: "Xinyi Lin", company: "Intuit" }),
  "Frontend application",
  "a user-edited title is preserved"
);
// Typing a name into a Blank resume retitles it on every keystroke, not only the first.
let typed = "Resume";
let previous = none;
for (const name of ["X", "Xi", "Xinyi", "Xinyi L", "Xinyi Lin"]) {
  const identity = { name, company: "" };
  typed = follow("resume", typed, identity, [previous]);
  previous = identity;
}
assert.equal(typed, "Xinyi_Lin_Resume", "a name typed one character at a time keeps the title in step");
assert.equal(
  follow("resume", "Your_Name_Resume", { name: "Xinyi Lin", company: "" }, [{ name: "Your Name", company: "" }]),
  "Xinyi_Lin_Resume",
  "replacing the Starter's sample name retitles its automatic title"
);
assert.equal(
  follow("resume", "Xinyi_Lin_Resume", none, [{ name: "Xinyi Lin", company: "" }]),
  "Resume",
  "clearing the name returns the title to the bare kind"
);
assert.equal(
  follow("resume", "Frontend application", { name: "Xinyi", company: "" }, [{ name: "Xinyi Lin", company: "" }]),
  "Frontend application",
  "editing the name never rewrites a title the user typed"
);
assert.equal(
  follow("resume", "Your_Name_Acme_Resume", { name: "Xinyi Lin", company: "Acme" }, [{ name: "Your Name", company: "" }]),
  "Xinyi_Lin_Acme_Resume",
  "a title of the old name and the new company follows when both change in one render"
);
assert.equal(
  follow("resume", "Jane_Doe_Acme_Resume", none, [none]),
  "Jane_Doe_Acme_Resume",
  "a stored title survives startup before its identity has loaded"
);

// The cover letter names documents the same way, so a resume and its letter for
// one role read as one application.
const COVER_PLACEHOLDERS = COVER_LETTER_TITLE_PLACEHOLDERS;
const followCover = (title, identity, earlier = [none]) =>
  follow("coverLetter", title, identity, earlier, COVER_PLACEHOLDERS);
assert.equal(
  buildCoverLetterDocumentTitle("Xinyi Lin", "Hadrian"),
  "Xinyi_Lin_Hadrian_Cover_Letter",
  "the letter title names the applicant and target company like the resume"
);
assert.equal(buildCoverLetterDocumentTitle("Xinyi Lin", ""), "Xinyi_Lin_Cover_Letter", "a missing company keeps the applicant");
assert.equal(buildCoverLetterDocumentTitle("", "Hadrian"), "Hadrian_Cover_Letter", "a missing applicant keeps the company");
assert.equal(buildCoverLetterDocumentTitle("", ""), "Cover_Letter", "missing metadata degrades to the bare kind");
assert.equal(
  followCover("Xinyi_Lin_Intuit_Cover_Letter", { name: "", company: "Intuit" }, [
    { name: "", company: "Intuit" },
    { name: "Xinyi Lin", company: "Intuit" }
  ]),
  "Intuit_Cover_Letter",
  "a nameless letter never keeps the resume's name an earlier build gave its title"
);
assert.equal(
  followCover("Cover letter", { name: "Xinyi Lin", company: "Intuit" }),
  "Xinyi_Lin_Intuit_Cover_Letter",
  "the editor's own default title is upgraded once the identity is known"
);
assert.equal(
  followCover("Intuit_Cover_Letter", { name: "Xinyi Lin", company: "Intuit" }),
  "Xinyi_Lin_Intuit_Cover_Letter",
  "a company-only letter title completes when the applicant arrives"
);
assert.equal(
  followCover("Xinyi_Lin_Intuit_Cover_Letter", { name: "Xinyi Lin", company: "Intuit" }),
  "Xinyi_Lin_Intuit_Cover_Letter",
  "a completed letter title is stable across re-renders"
);
assert.equal(
  followCover("Xinyi_Lin_Cover_Letter", { name: "Your Name", company: "" }, [
    { name: "Your Name", company: "" },
    { name: "Xinyi Lin", company: "" }
  ]),
  "Your_Name_Cover_Letter",
  "a letter titled from the resume's name follows the name on its own letterhead"
);
assert.equal(
  followCover("Your_Name_Cover_Letter", { name: "Xinyi", company: "" }, [{ name: "Your Name", company: "" }]),
  "Xinyi_Cover_Letter",
  "typing a name into the letter's letterhead retitles it"
);
assert.equal(
  followCover("Referral note", { name: "Xinyi Lin", company: "Intuit" }),
  "Referral note",
  "a letter title the user typed is preserved"
);
assert.equal(
  followCover("Xinyi_Lin_Intuit_Resume", { name: "Xinyi Lin", company: "Intuit" }),
  "Xinyi_Lin_Intuit_Resume",
  "one document kind never rewrites a title belonging to the other"
);
assert.equal(
  swapDocumentTitleKind("Xinyi_Lin_Intuit_Resume", "coverLetter"),
  "Xinyi_Lin_Intuit_Cover_Letter",
  "a letter titled from an automatic resume title names the same application"
);

console.log("PASS resume and cover-letter document and export naming");
