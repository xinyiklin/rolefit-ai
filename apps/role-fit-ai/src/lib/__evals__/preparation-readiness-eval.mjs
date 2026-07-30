import assert from "node:assert/strict";

import { getPreparationReadiness } from "../preparationReadiness.ts";

const ready = getPreparationReadiness({
  jobPrepared: true,
  includeResume: true,
  resumeReady: true,
  includeCoverLetter: false,
  coverLetterReady: false,
  isPreparing: false
});

assert.equal(ready.canApply, true, "the default resume package can be applied");
assert.equal(ready.primaryBlocker, "", "a ready package has no blocker");
assert.equal(ready.checks.resume.status, "ready", "the included resume is ready");
assert.equal(ready.checks.cover.status, "excluded", "the cover starts excluded");
assert.equal(ready.checks.cover.ready, true, "an excluded material satisfies readiness");

const neither = getPreparationReadiness({
  jobPrepared: true,
  includeResume: false,
  resumeReady: false,
  includeCoverLetter: false,
  coverLetterReady: false,
  isPreparing: false
});
assert.equal(neither.canApply, true, "a prepared job may be applied without documents");
assert.equal(neither.checks.resume.status, "excluded");
assert.equal(neither.checks.cover.status, "excluded");

const coverOnly = getPreparationReadiness({
  jobPrepared: true,
  includeResume: false,
  resumeReady: false,
  includeCoverLetter: true,
  coverLetterReady: true,
  isPreparing: false
});
assert.equal(coverOnly.canApply, true, "a ready cover-only package can be applied");
assert.equal(coverOnly.checks.cover.status, "ready");

const missingResume = getPreparationReadiness({
  jobPrepared: true,
  includeResume: true,
  resumeReady: false,
  includeCoverLetter: false,
  coverLetterReady: false,
  isPreparing: false
});
assert.equal(missingResume.canApply, false);
assert.equal(
  missingResume.primaryBlocker,
  "Choose a ready resume or turn off Include.",
  "only an included missing resume blocks Apply"
);

const missingCover = getPreparationReadiness({
  jobPrepared: true,
  includeResume: false,
  resumeReady: false,
  includeCoverLetter: true,
  coverLetterReady: false,
  isPreparing: false
});
assert.equal(missingCover.canApply, false);
assert.equal(
  missingCover.primaryBlocker,
  "Choose a ready cover letter or turn off Include.",
  "only an included incomplete cover letter blocks Apply"
);

const preparing = getPreparationReadiness({
  jobPrepared: true,
  includeResume: false,
  resumeReady: false,
  includeCoverLetter: false,
  coverLetterReady: false,
  isPreparing: true
});
assert.equal(preparing.canApply, false, "active preparation blocks Apply");
assert.equal(preparing.primaryBlocker, "Wait for preparation to finish.");
assert.deepEqual(
  {
    ready: preparing.checks.preparation.ready,
    status: preparing.checks.preparation.status,
    detail: preparing.checks.preparation.detail
  },
  {
    ready: false,
    status: "working",
    detail: "Finishing the selected job or materials."
  }
);

const missingJob = getPreparationReadiness({
  jobPrepared: false,
  includeResume: false,
  resumeReady: false,
  includeCoverLetter: false,
  coverLetterReady: false,
  isPreparing: false
});
assert.equal(missingJob.canApply, false);
assert.equal(missingJob.primaryBlocker, "Prepare a job before applying.");

for (const jobPrepared of [false, true]) {
  for (const includeResume of [false, true]) {
    for (const resumeReady of [false, true]) {
      for (const includeCoverLetter of [false, true]) {
        for (const coverLetterReady of [false, true]) {
          for (const isPreparing of [false, true]) {
            const result = getPreparationReadiness({
              jobPrepared,
              includeResume,
              resumeReady,
              includeCoverLetter,
              coverLetterReady,
              isPreparing
            });
            assert.equal(
              result.canApply,
              jobPrepared &&
                (!includeResume || resumeReady) &&
                (!includeCoverLetter || coverLetterReady) &&
                !isPreparing
            );
          }
        }
      }
    }
  }
}

console.log("Preparation readiness eval passed");
