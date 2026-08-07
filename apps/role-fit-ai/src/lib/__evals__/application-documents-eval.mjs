// Per-document application saves: Apply creates the record with both document
// snapshots, and afterwards the resume and the cover letter are each saved on
// their own. The rules that must hold are that one document's update never
// rewrites the other, never disturbs application metadata, and never targets an
// application belonging to a different job.

import assert from "node:assert/strict";

import {
  applicationDocumentSyncState,
  applicationMatchesJobTarget,
  normalizeDocumentSnapshot
} from "../applicationDocuments.ts";
import { applicationDocumentAvailability } from "../../../shared/applicationDocumentContract.ts";
import { documentSourceFingerprint } from "../documentSourceFingerprint.ts";

const resumeSource = "{\"kind\":\"resume\",\"style\":\"original\"}";
const editedResumeSource = "{\"kind\":\"resume\",\"style\":\"edited\"}";
const coverSource = "{\"kind\":\"cover\",\"style\":\"original\"}";
const editedCoverSource = "{\"kind\":\"cover\",\"style\":\"edited\"}";

assert.equal(
  applicationDocumentAvailability(undefined),
  "none",
  "missing artifact metadata is never presented as a saved document"
);
assert.equal(
  applicationDocumentAvailability({ hasSource: true, hasPdf: false }),
  "source-only",
  "strict source alone is a saved editable document"
);
assert.equal(
  applicationDocumentAvailability({ hasSource: false, hasPdf: true }),
  "pdf-only",
  "an uploaded PDF alone is a saved final document"
);

// The state Apply leaves behind: both strict sources stored, plus the metadata the
// tracker owns (status, notes, dates, and job details) that no document save
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
  }
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
  "content without a committed strict source stays retryable"
);
assert.equal(
  applicationDocumentSyncState(applied, "resume", "APPLIED RESUME TEXT", editedResumeSource),
  "unsaved",
  "a formatting-only source change reports as unsaved"
);
assert.equal(
  applicationDocumentSyncState(applied, "resume", "  APPLIED\n RESUME  TEXT ", resumeSource),
  "saved",
  "the strict source fingerprint, not flattened display text, owns saved state"
);
assert.equal(
  applicationDocumentSyncState(
    applied,
    "resume",
    "THE COMPLETE CURRENT RESUME TEXT",
    resumeSource
  ),
  "saved",
  "an exact strict source remains saved without a duplicate tracker document model"
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
  applicationDocumentSyncState(
    { ...applied, coverLetterArtifacts: undefined },
    "coverLetter",
    "",
    ""
  ),
  "saved",
  "an application with no stored letter matches an empty editor"
);
assert.equal(
  applicationDocumentSyncState(
    { ...applied, coverLetterArtifacts: undefined },
    "coverLetter",
    "Written later.",
    editedCoverSource
  ),
  "unsaved",
  "a letter written after applying without one reports as unsaved"
);
assert.equal(normalizeDocumentSnapshot("  a \n\n b  "), "a b", "snapshots normalize whitespace runs");

// ----- Independent updates -----

const afterResumeUpdate = {
  ...applied,
  resumeArtifacts: {
    hasPdf: false,
    hasSource: true,
    sourceFingerprint: documentSourceFingerprint(editedResumeSource)
  }
};
assert.equal(
  afterResumeUpdate.coverLetterArtifacts,
  applied.coverLetterArtifacts,
  "updating the resume leaves the saved cover-letter source metadata untouched"
);
assert.equal(
  applicationDocumentSyncState(afterResumeUpdate, "resume", "EDITED RESUME TEXT", editedResumeSource),
  "saved",
  "after the resume update the resume settles back to saved"
);

const afterCoverUpdate = {
  ...afterResumeUpdate,
  coverLetterArtifacts: {
    hasPdf: false,
    hasSource: true,
    sourceFingerprint: documentSourceFingerprint(editedCoverSource)
  }
};
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
