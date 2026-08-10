import assert from "node:assert/strict";

import {
  newPreparationSession,
  preparationSessionForApplication
} from "../preparationSession.ts";
import {
  effectivePostingGroupId,
  planPostingRecordLink
} from "../applicationRelationships.ts";

const fresh = newPreparationSession();
assert.deepEqual(
  fresh,
  { mode: "new", applicationId: null, pendingRelationship: null },
  "a fresh preparation has no implicit write target"
);

assert.deepEqual(
  preparationSessionForApplication({ id: "draft-1", status: "interested" }),
  { mode: "draft", applicationId: "draft-1", pendingRelationship: null },
  "an interested record reopens as the same draft"
);

assert.deepEqual(
  preparationSessionForApplication({ id: "applied-1", status: "applied" }),
  { mode: "update", applicationId: "applied-1", pendingRelationship: null },
  "an acted-on record reopens in update-only mode"
);

assert.equal(
  effectivePostingGroupId({ id: "solo" }),
  "application:solo",
  "a record without a posting group is its own singleton"
);
assert.equal(
  effectivePostingGroupId({ id: "member", jobPostingGroupId: "posting-group-1" }),
  "posting-group-1",
  "an explicit posting group owns relationship identity"
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

console.log("Preparation session and posting relationships passed");
