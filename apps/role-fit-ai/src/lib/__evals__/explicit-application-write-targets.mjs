import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const applicationStoreSource = readFileSync(new URL("../../hooks/useApplications.ts", import.meta.url), "utf8");
const answersSource = readFileSync(new URL("../../hooks/useApplicationAnswers.ts", import.meta.url), "utf8");
const documentSyncSource = readFileSync(
  new URL("../../hooks/useApplicationDocumentSync.ts", import.meta.url),
  "utf8"
);
const applySource = readFileSync(new URL("../../hooks/useApplyFlow.ts", import.meta.url), "utf8");
const skipSource = readFileSync(new URL("../../hooks/useSkipFlow.ts", import.meta.url), "utf8");

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
for (const persistenceTerm of [
  "createApplication",
  "updateApplicationById",
  "resolvePreparationDuplicate",
  "linkPostingRecords",
  "onDraftCreated"
]) {
  assert.ok(
    !answersSource.includes(persistenceTerm),
    `answer drafting remains session-local and excludes ${persistenceTerm}`
  );
}
assert.match(answersSource, /Drafts remain session-local for editing and copying/);
assert.match(applySource, /preparationSession[\s\S]{0,1200}?session\.applicationId/);
assert.match(skipSource, /preparationSession[\s\S]{0,1800}?session\.applicationId/);

console.log("Explicit application write targets passed");
