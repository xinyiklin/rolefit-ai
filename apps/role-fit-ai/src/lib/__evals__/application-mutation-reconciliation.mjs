import assert from "node:assert/strict";
import {
  applicationMutationRecords,
  reconcileApplicationWriteResponse
} from "../applicationMutation.ts";
import {
  duplicateScanIdentity,
  duplicateScanStats
} from "../duplicateScan.ts";

const application = (index, overrides = {}) => ({
  id: `application-${index}`,
  title: `Role ${index}`,
  company: `Company ${index}`,
  role: `Role ${index}`,
  jobUrl: `https://example.com/jobs/${index}`,
  jobDescription: `Description ${index}`,
  status: "interested",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides
});

const current = Array.from({ length: 500 }, (_, index) => application(index));
const changed = {
  ...current[237],
  notes: "Changed",
  updatedAt: "2026-01-02T00:00:00.000Z"
};
const optimistic = current.map((entry, index) => index === 237 ? changed : entry);
const upsertMutation = [{
  id: changed.id,
  operation: "upsert",
  baseUpdatedAt: current[237].updatedAt
}];

assert.deepEqual(
  applicationMutationRecords(optimistic, upsertMutation),
  [changed],
  "a one-record upsert sends one application record"
);
assert.deepEqual(
  applicationMutationRecords(
    optimistic.filter((entry) => entry.id !== changed.id),
    [{ id: changed.id, operation: "delete", baseUpdatedAt: changed.updatedAt }]
  ),
  [],
  "a delete-only mutation sends no application records"
);
assert.deepEqual(
  applicationMutationRecords(
    [application(501), application(500)],
    [
      { id: "application-500", operation: "upsert", baseUpdatedAt: null },
      { id: "application-501", operation: "upsert", baseUpdatedAt: null }
    ]
  ).map((entry) => entry.id),
  ["application-500", "application-501"],
  "multiple upsert records follow deterministic mutation order"
);
assert.throws(
  () => applicationMutationRecords(
    current,
    [{ id: "missing", operation: "upsert", baseUpdatedAt: null }]
  ),
  /Missing application record for upsert missing/,
  "a malformed client upsert fails before sending an incomplete request"
);

duplicateScanStats.hashedRecords = 0;
duplicateScanIdentity(current);
assert.equal(duplicateScanStats.hashedRecords, 500, "the initial identity hashes every record");

const serverResponse = optimistic.map((entry) => ({ ...entry }));
const reconciled = reconcileApplicationWriteResponse(current, serverResponse);
assert.deepEqual(
  reconciled.map((entry, index) => entry === current[index]).filter(Boolean).length,
  499,
  "a successful one-record save preserves the other 499 references"
);
assert.equal(
  reconciled[237],
  serverResponse[237],
  "the changed revision uses the authoritative server object"
);

const hashedBeforeResponse = duplicateScanStats.hashedRecords;
duplicateScanIdentity(reconciled);
assert.equal(
  duplicateScanStats.hashedRecords - hashedBeforeResponse,
  1,
  "only the changed record is rehashed after the response"
);

const reversedResponse = [...serverResponse].reverse();
const reordered = reconcileApplicationWriteResponse(current, reversedResponse);
assert.deepEqual(
  reordered.map((entry) => entry.id),
  reversedResponse.map((entry) => entry.id),
  "response reconciliation follows authoritative server order"
);

console.log("Application mutation reconciliation passed");
