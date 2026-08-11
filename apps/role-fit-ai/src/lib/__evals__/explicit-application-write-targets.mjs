import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applicationAnswerCommit } from "../applicationAnswerCommit.ts";
import { newPreparationSession, preparationSessionForApplication } from "../preparationSession.ts";

const createdAt = "2026-08-10T12:00:00.000Z";
const application = (overrides = {}) => ({
  id: "draft-1",
  title: "Engineer at Acme",
  company: "Acme",
  role: "Engineer",
  jobUrl: "https://example.com/jobs/1",
  jobDescription: "Prepared posting",
  status: "interested",
  createdAt,
  updatedAt: createdAt,
  ...overrides
});
const firstAnswers = [{ question: "Why Acme?", answer: "Product fit", savedAt: createdAt }];

const created = applicationAnswerCommit({
  session: newPreparationSession(),
  existing: null,
  draft: application(),
  answers: firstAnswers
});
assert.equal(created?.operation, "create");
assert.equal(created?.application.id, "draft-1");
assert.equal(created?.application.status, "interested");
assert.deepEqual(created?.application.applicationAnswers, firstAnswers);

const existingDraft = application({
  applicationAnswers: [
    { question: "Why Acme?", answer: "Earlier answer", savedAt: "2026-08-09T12:00:00.000Z" },
    { question: "Availability?", answer: "Two weeks", savedAt: "2026-08-09T12:00:00.000Z" }
  ]
});
const updated = applicationAnswerCommit({
  session: preparationSessionForApplication(existingDraft),
  existing: existingDraft,
  draft: null,
  answers: firstAnswers
});
assert.equal(updated?.operation, "update");
assert.equal(updated?.application.id, existingDraft.id);
assert.deepEqual(updated?.application.applicationAnswers, [
  firstAnswers[0],
  existingDraft.applicationAnswers[1]
]);

assert.equal(
  applicationAnswerCommit({
    session: { mode: "draft", applicationId: "missing", pendingRelationship: null },
    existing: existingDraft,
    draft: null,
    answers: firstAnswers
  }),
  null,
  "a missing or mismatched explicit answer target fails closed"
);

const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const applicationStoreSource = readFileSync(new URL("../../hooks/useApplications.ts", import.meta.url), "utf8");
const answersSource = readFileSync(new URL("../../hooks/useApplicationAnswers.ts", import.meta.url), "utf8");
const documentSyncSource = readFileSync(
  new URL("../../hooks/useApplicationDocumentSync.ts", import.meta.url),
  "utf8"
);
const applySource = readFileSync(new URL("../../hooks/useApplyFlow.ts", import.meta.url), "utf8");
const passSource = readFileSync(new URL("../../hooks/usePassFlow.ts", import.meta.url), "utf8");

for (const [owner, source] of [
  ["App", appSource],
  ["application store", applicationStoreSource],
  ["answer saving", answersSource],
  ["document synchronization", documentSyncSource]
]) {
  assert.doesNotMatch(source, /findForTarget/, `${owner} retains a job-match write lookup`);
}
assert.doesNotMatch(applicationStoreSource, /const upsert = useCallback/, "the overloaded ordinary upsert path is removed");
assert.match(
  documentSyncSource,
  /const application = applicationId[\s\S]{0,160}?candidate\.id === applicationId/,
  "document synchronization resolves only the explicit preparation id"
);
assert.doesNotMatch(
  documentSyncSource,
  /applicationMatchesJobTarget|jobUrl|jobDescription/,
  "document synchronization has no job-identity fallback"
);
assert.match(
  answersSource,
  /session\.mode !== "new"[\s\S]{0,700}?updateApplicationById\(commit\.application\)/,
  "later answer saves update the explicit draft or application id"
);
assert.match(
  answersSource,
  /createApplication\(app\)[\s\S]{0,1200}?onDraftCreated\(app\.id\)/,
  "a new answer save creates one interested draft and publishes its id"
);
assert.match(answersSource, /resolvePreparationDuplicate\(\)/);
assert.match(answersSource, /linkPostingRecords\(/);
assert.match(applySource, /preparationSession[\s\S]{0,1200}?session\.applicationId/);
assert.match(passSource, /preparationSession[\s\S]{0,1800}?session\.applicationId/);

console.log("Explicit application write targets passed");
