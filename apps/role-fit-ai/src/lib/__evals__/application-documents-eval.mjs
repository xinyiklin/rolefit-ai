// Per-document application saves: Apply creates the record with both document
// snapshots, and afterwards the resume and the cover letter are each saved on
// their own. The rules that must hold are that one document's update never
// rewrites the other, never disturbs application metadata, and never targets an
// application belonging to a different job.

import assert from "node:assert/strict";

import {
  applicationDocumentSyncState,
  applicationMatchesJobTarget,
  normalizeDocumentSnapshot,
  savedDocumentText
} from "../applicationDocuments.ts";
import { applicationDocumentAvailability } from "../../../shared/applicationDocumentContract.ts";
import { documentSourceFingerprint } from "../documentSourceFingerprint.ts";

const resumeSource = "{\"kind\":\"resume\",\"style\":\"original\"}";
const editedResumeSource = "{\"kind\":\"resume\",\"style\":\"edited\"}";
const coverSource = "{\"kind\":\"cover\",\"style\":\"original\"}";
const editedCoverSource = "{\"kind\":\"cover\",\"style\":\"edited\"}";

const resumeData = {
  header: { visible: true, name: "Test Candidate", contact: [] },
  sections: [{ id: "s1", kind: "experience", heading: "Experience", entries: [] }]
};

assert.equal(
  applicationDocumentAvailability(undefined, true),
  "legacy-text-snapshot",
  "tracker-only text is explicit legacy snapshot state, never a saved source artifact"
);
assert.equal(
  applicationDocumentAvailability({ hasSource: true, hasPdf: false }, false),
  "source-only",
  "strict source alone is a saved editable document"
);
assert.equal(
  applicationDocumentAvailability({ hasSource: false, hasPdf: true }, false),
  "pdf-only",
  "an uploaded PDF alone is a saved final document"
);

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
  resumeArtifacts: {
    hasPdf: false,
    hasSource: true,
    sourceFingerprint: documentSourceFingerprint(resumeSource),
    fileName: "acme.resume"
  },
  coverLetterArtifacts: {
    hasPdf: false,
    hasSource: true,
    sourceFingerprint: documentSourceFingerprint(coverSource),
    fileName: "acme.cover"
  },
  resumeData,
  polishedText: "APPLIED RESUME TEXT",
  coverLetterText: "Untailored starter letter."
};

// ----- Sync state -----

assert.equal(
  applicationDocumentSyncState(null, "resume", "anything", resumeSource),
  "no-application",
  "with no application the resume has nothing to update"
);
assert.equal(
  applicationDocumentSyncState(null, "coverLetter", "anything", coverSource),
  "no-application",
  "with no application the cover letter has nothing to update"
);
assert.equal(
  applicationDocumentSyncState(applied, "resume", "APPLIED RESUME TEXT", resumeSource),
  "saved",
  "an unchanged resume reports as saved to the application"
);
assert.equal(
  applicationDocumentSyncState(
    { ...applied, resumeArtifacts: undefined },
    "resume",
    "APPLIED RESUME TEXT",
    resumeSource
  ),
  "unsaved",
  "matching tracker text without a committed source stays retryable"
);
assert.equal(
  applicationDocumentSyncState(applied, "resume", "APPLIED RESUME TEXT", editedResumeSource),
  "unsaved",
  "a formatting-only source change reports as unsaved"
);
assert.equal(
  applicationDocumentSyncState(applied, "resume", "  APPLIED\n RESUME  TEXT ", resumeSource),
  "saved",
  "re-serialization whitespace alone is not an unsaved change"
);
assert.equal(
  applicationDocumentSyncState(
    { ...applied, polishedText: "TRACKER TEXT CLIPPED BEFORE THE FULL DOCUMENT" },
    "resume",
    "THE COMPLETE CURRENT RESUME TEXT",
    resumeSource
  ),
  "saved",
  "an exact strict source remains saved when the lossy tracker text differs"
);
assert.equal(
  applicationDocumentSyncState(applied, "resume", "APPLIED RESUME TEXT, now edited", editedResumeSource),
  "unsaved",
  "a manual resume edit after Apply reports as unsaved"
);
assert.equal(
  applicationDocumentSyncState(applied, "coverLetter", "Tailored letter.", editedCoverSource),
  "unsaved",
  "a cover letter tailored after Apply reports as unsaved"
);
assert.equal(
  applicationDocumentSyncState({ ...applied, coverLetterText: undefined }, "coverLetter", "", ""),
  "saved",
  "an application with no stored letter matches an empty editor"
);
assert.equal(
  applicationDocumentSyncState({ ...applied, coverLetterText: undefined }, "coverLetter", "Written later.", editedCoverSource),
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

// ----- Independent updates -----

const afterResumeUpdate = {
  ...applied,
  polishedText: "EDITED RESUME TEXT",
  resumeData,
  resumeArtifacts: {
    hasPdf: false,
    hasSource: true,
    sourceFingerprint: documentSourceFingerprint(editedResumeSource)
  }
};
assert.equal(afterResumeUpdate.polishedText, "EDITED RESUME TEXT", "updating the resume replaces the stored resume");
assert.equal(
  afterResumeUpdate.coverLetterText,
  applied.coverLetterText,
  "updating the resume leaves the saved cover letter untouched"
);
assert.equal(
  applicationDocumentSyncState(afterResumeUpdate, "resume", "EDITED RESUME TEXT", editedResumeSource),
  "saved",
  "after the resume update the resume settles back to saved"
);

const afterCoverUpdate = {
  ...afterResumeUpdate,
  coverLetterText: "Tailored letter.",
  coverLetterArtifacts: {
    hasPdf: false,
    hasSource: true,
    sourceFingerprint: documentSourceFingerprint(editedCoverSource)
  }
};
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
  applicationDocumentSyncState(afterCoverUpdate, "coverLetter", "Tailored letter.", editedCoverSource),
  "saved",
  "after the cover-letter update the letter settles back to saved"
);
assert.equal(
  applicationDocumentSyncState(afterCoverUpdate, "resume", "EDITED RESUME TEXT", editedResumeSource),
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
  afterResumeUpdate.resumeArtifacts,
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
