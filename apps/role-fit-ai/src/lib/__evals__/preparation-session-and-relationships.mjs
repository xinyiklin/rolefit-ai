import assert from "node:assert/strict";

import {
  newPreparationSession,
  preparationCommitIdentity,
  preparationSessionForApplication
} from "../preparationSession.ts";
import {
  planPostingRecordLink,
  planPostingRecordUnlink,
  postingGroupSizeByApplicationId
} from "../applicationRelationships.ts";

const fresh = newPreparationSession();
assert.deepEqual(
  fresh,
  { mode: "new", applicationId: null, pendingRelationship: null },
  "a fresh preparation has no implicit write target"
);

assert.deepEqual(
  preparationSessionForApplication({ id: "applied-1" }),
  { mode: "update", applicationId: "applied-1", pendingRelationship: null },
  "a tracked outcome reopens in update-only mode"
);

const commitIdentity = preparationCommitIdentity({
  session: fresh,
  jobUrl: " https://jobs.example.com/123 ",
  preparedJobDescription: " Prepared role ",
  jobRawText: " Original posting "
});
assert.equal(
  commitIdentity,
  preparationCommitIdentity({
    session: fresh,
    jobUrl: "https://jobs.example.com/123",
    preparedJobDescription: "Prepared role",
    jobRawText: "Original posting"
  }),
  "a delayed confirmation still recognizes the exact prepared target"
);
assert.notEqual(
  commitIdentity,
  preparationCommitIdentity({
    session: fresh,
    jobUrl: "https://jobs.example.com/456",
    preparedJobDescription: "Prepared role",
    jobRawText: "Original posting"
  }),
  "a changed posting cannot reuse an earlier Apply or Skip confirmation"
);
assert.notEqual(
  commitIdentity,
  preparationCommitIdentity({
    session: preparationSessionForApplication({ id: "applied-1" }),
    jobUrl: "https://jobs.example.com/123",
    preparedJobDescription: "Prepared role",
    jobRawText: "Original posting"
  }),
  "a changed preparation session cannot reuse an earlier confirmation"
);

const records = [
  { id: "a", jobPostingGroupId: "group-a", updatedAt: "2026-08-10T00:00:00.000Z" },
  { id: "a-peer", jobPostingGroupId: "group-a", updatedAt: "2026-08-10T00:00:01.000Z" },
  { id: "b", jobPostingGroupId: "group-b", updatedAt: "2026-08-10T00:00:02.000Z" },
  { id: "b-peer", jobPostingGroupId: "group-b", updatedAt: "2026-08-10T00:00:03.000Z" },
  { id: "unrelated", updatedAt: "2026-08-10T00:00:04.000Z" }
];

assert.deepEqual(
  planPostingRecordLink(records, ["a", "b"], "combined-group"),
  {
    groupId: "combined-group",
    applicationIds: ["a", "a-peer", "b", "b-peer"]
  },
  "linking members of existing groups expands the atomic mutation to every member"
);

assert.equal(
  planPostingRecordLink(records, ["a", "missing"], "combined-group"),
  null,
  "an unknown requested record fails closed"
);

assert.deepEqual(
  [...postingGroupSizeByApplicationId(records)],
  [["a", 2], ["a-peer", 2], ["b", 2], ["b-peer", 2]],
  "group badges count independent records without collapsing them"
);
assert.deepEqual(
  planPostingRecordUnlink(records, "a"),
  {
    detachedApplicationId: "a",
    remainingApplicationIds: ["a-peer"],
    applicationIds: ["a", "a-peer"],
    clearGroupApplicationIds: ["a", "a-peer"]
  },
  "unlinking a two-record relationship clears both group ids without deleting either record"
);
assert.equal(
  planPostingRecordUnlink(records, "unrelated"),
  null,
  "unlinking a singleton fails closed"
);

const threeRecordHistory = [
  { id: "skipped", status: "not_applying", jobPostingGroupId: "group-history" },
  { id: "rejected", status: "rejected", jobPostingGroupId: "group-history" },
  { id: "applied-again", status: "applied", jobPostingGroupId: "group-history" }
];
assert.deepEqual(
  planPostingRecordUnlink(threeRecordHistory, "skipped"),
  {
    detachedApplicationId: "skipped",
    remainingApplicationIds: ["rejected", "applied-again"],
    applicationIds: ["skipped", "rejected", "applied-again"],
    clearGroupApplicationIds: ["skipped"]
  },
  "detaching a skip decision keeps the remaining attempts linked"
);

console.log("Preparation session and posting relationships passed");
