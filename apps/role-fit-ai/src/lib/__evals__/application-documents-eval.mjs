// Per-document application saves: Apply creates the record with both document
// snapshots, and afterwards the resume and the cover letter are each saved on
// their own. The rules that must hold are that one document's update never
// rewrites the other, never disturbs application metadata, and never targets an
// application belonging to a different job.

import assert from "node:assert/strict";

import {
  COVER_LETTER_DOCUMENT_FIELDS,
  RESUME_DOCUMENT_FIELDS,
  applicationDocumentSyncState,
  applicationMatchesJobTarget,
  coverLetterApplicationPatch,
  normalizeDocumentSnapshot,
  resumeApplicationPatch,
  savedDocumentText
} from "../applicationDocuments.ts";

const resumeData = {
  name: "Test Candidate",
  contact: [],
  sections: [{ id: "s1", kind: "experience", heading: "Experience", entries: [] }]
};

// The state Apply leaves behind: both snapshots stored, plus the metadata the
// tracker owns (status, notes, dates, job details, fit) that no document save
// may touch.
const applied = {
  id: "app-1",
  title: "Backend Engineer at Acme",
  company: "Acme",
  role: "Backend Engineer",
  jobUrl: "https://boards.acme.com/jobs/42",
  jobDescription: "Build services.",
  status: "applied",
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:00:00.000Z",
  appliedAt: "2026-07-20T10:00:00.000Z",
  notes: "Referred by a friend.",
  fitScore: 82,
  resumeUsed: "tailored",
  resumeArtifacts: { hasPdf: true, fileName: "acme.pdf" },
  resumeData,
  polishedText: "APPLIED RESUME TEXT",
  coverLetterText: "Untailored starter letter."
};

// The client applies a patch by spread merge, exactly as useApplications does.
const applyPatch = (application, patch) => ({ ...application, ...patch });

// ----- Sync state -----

assert.equal(
  applicationDocumentSyncState(null, "resume", "anything"),
  "no-application",
  "with no application the resume has nothing to update"
);
assert.equal(
  applicationDocumentSyncState(null, "coverLetter", "anything"),
  "no-application",
  "with no application the cover letter has nothing to update"
);
assert.equal(
  applicationDocumentSyncState(applied, "resume", "APPLIED RESUME TEXT"),
  "saved",
  "an unchanged resume reports as saved to the application"
);
assert.equal(
  applicationDocumentSyncState(applied, "resume", "  APPLIED\n RESUME  TEXT "),
  "saved",
  "re-serialization whitespace alone is not an unsaved change"
);
assert.equal(
  applicationDocumentSyncState(applied, "resume", "APPLIED RESUME TEXT, now edited"),
  "unsaved",
  "a manual resume edit after Apply reports as unsaved"
);
assert.equal(
  applicationDocumentSyncState(applied, "coverLetter", "Tailored letter."),
  "unsaved",
  "a cover letter tailored after Apply reports as unsaved"
);
assert.equal(
  applicationDocumentSyncState({ ...applied, coverLetterText: undefined }, "coverLetter", ""),
  "saved",
  "an application with no stored letter matches an empty editor"
);
assert.equal(
  applicationDocumentSyncState({ ...applied, coverLetterText: undefined }, "coverLetter", "Written later."),
  "unsaved",
  "a letter written after applying without one reports as unsaved"
);
assert.equal(normalizeDocumentSnapshot("  a \n\n b  "), "a b", "snapshots normalize whitespace runs");
assert.equal(savedDocumentText(applied, "resume"), "APPLIED RESUME TEXT", "the resume snapshot is read from polishedText");
assert.equal(
  savedDocumentText(applied, "coverLetter"),
  "Untailored starter letter.",
  "the cover-letter snapshot is read from coverLetterText"
);
assert.equal(savedDocumentText(null, "resume"), "", "no application has no stored resume");

// ----- Patch field ownership -----

const resumePatch = resumeApplicationPatch("EDITED RESUME TEXT", resumeData);
const coverPatch = coverLetterApplicationPatch("Tailored letter.");

for (const key of Object.keys(resumePatch)) {
  assert.ok(RESUME_DOCUMENT_FIELDS.includes(key), `the resume patch writes only resume fields (saw ${key})`);
}
for (const key of Object.keys(coverPatch)) {
  assert.ok(
    COVER_LETTER_DOCUMENT_FIELDS.includes(key),
    `the cover-letter patch writes only cover-letter fields (saw ${key})`
  );
}
assert.equal(
  RESUME_DOCUMENT_FIELDS.some((field) => COVER_LETTER_DOCUMENT_FIELDS.includes(field)),
  false,
  "the two documents own disjoint fields"
);
assert.deepEqual(
  Object.keys(resumeApplicationPatch("TEXT", null)),
  ["polishedText"],
  "without an editor model the resume patch omits resumeData rather than erasing it"
);
assert.equal(
  "resumeData" in resumeApplicationPatch("TEXT", null),
  false,
  "the omitted key is truly absent, so a spread merge cannot clobber the stored snapshot"
);

// ----- Independent updates -----

const afterResumeUpdate = applyPatch(applied, resumePatch);
assert.equal(afterResumeUpdate.polishedText, "EDITED RESUME TEXT", "updating the resume replaces the stored resume");
assert.equal(
  afterResumeUpdate.coverLetterText,
  applied.coverLetterText,
  "updating the resume leaves the saved cover letter untouched"
);
assert.equal(
  applicationDocumentSyncState(afterResumeUpdate, "resume", "EDITED RESUME TEXT"),
  "saved",
  "after the resume update the resume settles back to saved"
);

const afterCoverUpdate = applyPatch(afterResumeUpdate, coverPatch);
assert.equal(afterCoverUpdate.coverLetterText, "Tailored letter.", "updating the letter replaces the stored letter");
assert.equal(
  afterCoverUpdate.polishedText,
  "EDITED RESUME TEXT",
  "updating the cover letter leaves the saved resume untouched"
);
assert.deepEqual(
  afterCoverUpdate.resumeData,
  resumeData,
  "updating the cover letter leaves the stored editor snapshot untouched"
);
assert.equal(
  applicationDocumentSyncState(afterCoverUpdate, "coverLetter", "Tailored letter."),
  "saved",
  "after the cover-letter update the letter settles back to saved"
);
assert.equal(
  applicationDocumentSyncState(afterCoverUpdate, "resume", "EDITED RESUME TEXT"),
  "saved",
  "the resume stays saved across a cover-letter update"
);

for (const field of [
  "id",
  "title",
  "company",
  "role",
  "jobUrl",
  "jobDescription",
  "status",
  "createdAt",
  "appliedAt",
  "notes",
  "fitScore",
  "resumeUsed"
]) {
  assert.deepEqual(
    afterCoverUpdate[field],
    applied[field],
    `document updates preserve application metadata (${field})`
  );
}
assert.deepEqual(
  afterCoverUpdate.resumeArtifacts,
  applied.resumeArtifacts,
  "a cover-letter update never disturbs the saved resume artifact metadata"
);
assert.equal(afterCoverUpdate.id, applied.id, "updates target the existing application, never a new id");

// ----- Job-target ownership of the remembered application -----

assert.equal(
  applicationMatchesJobTarget(applied, "https://boards.acme.com/jobs/42", "Build services."),
  true,
  "the applied record matches its own job link"
);
assert.equal(
  applicationMatchesJobTarget(applied, "https://boards.acme.com/jobs/42?utm_source=news", ""),
  true,
  "tracking parameters do not break the match"
);
assert.equal(
  applicationMatchesJobTarget(applied, "https://jobs.other.com/roles/9", ""),
  false,
  "a different posting does not match, so its documents cannot be saved onto this record"
);
assert.equal(
  applicationMatchesJobTarget(
    { ...applied, sourceUrls: [{ url: "https://linkedin.com/jobs/view/7", addedAt: "2026-07-20T10:00:00.000Z" }] },
    "https://linkedin.com/jobs/view/7",
    ""
  ),
  true,
  "a repost absorbed as an alternate posting location still matches"
);
assert.equal(
  applicationMatchesJobTarget({ ...applied, jobUrl: "" }, "", "Build services."),
  true,
  "a link-less application matches by its exact job description"
);
assert.equal(
  applicationMatchesJobTarget({ ...applied, jobUrl: "" }, "", "A different posting entirely."),
  false,
  "a link-less application does not match another posting's description"
);
assert.equal(
  applicationMatchesJobTarget({ ...applied, jobUrl: "" }, "", ""),
  false,
  "an empty job target matches nothing"
);

console.log("application-documents-eval: all checks passed");
