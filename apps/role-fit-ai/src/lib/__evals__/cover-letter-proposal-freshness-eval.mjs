import { strict as assert } from "node:assert";

import { resolveCoverLetterProposalFreshness } from "../coverLetterProposalFreshness.ts";

const captured = {
  contentFingerprint: "letter-job-guidance-v1",
  resumeFingerprint: "resume-v1"
};

assert.deepEqual(
  resolveCoverLetterProposalFreshness(captured, captured),
  { stale: false, resumeChanged: false },
  "an unchanged cover-letter proposal stays current"
);

assert.deepEqual(
  resolveCoverLetterProposalFreshness(captured, {
    ...captured,
    resumeFingerprint: "resume-v2"
  }),
  { stale: false, resumeChanged: true },
  "a resume-only change warns without blocking the validated cover-letter proposal"
);

assert.deepEqual(
  resolveCoverLetterProposalFreshness(captured, {
    ...captured,
    contentFingerprint: "letter-job-guidance-v2"
  }),
  { stale: true, resumeChanged: false },
  "a changed letter, job, guidance, or instruction still blocks acceptance"
);

assert.deepEqual(
  resolveCoverLetterProposalFreshness(captured, {
    contentFingerprint: "letter-job-guidance-v2",
    resumeFingerprint: "resume-v2"
  }),
  { stale: true, resumeChanged: true },
  "the hard-stale state wins when both input groups changed"
);

console.log("Cover-letter proposal freshness eval passed.");
