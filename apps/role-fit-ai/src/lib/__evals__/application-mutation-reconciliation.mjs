import assert from "node:assert/strict";
import {
  applicationMutationRecords,
  applyApplicationWriteResponse
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
  status: "applied",
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

// A matching-revision save answers sparsely: the id order plus written rows.
const serverResponse = optimistic.map((entry) => ({ ...entry }));
const reconciled = applyApplicationWriteResponse(current, {
  order: serverResponse.map((entry) => entry.id),
  applications: [serverResponse[237]]
});
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

const reversedOrder = serverResponse.map((entry) => entry.id).reverse();
const reordered = applyApplicationWriteResponse(current, { order: reversedOrder, applications: [] });
assert.deepEqual(
  reordered.map((entry) => entry.id),
  reversedOrder,
  "response reconciliation follows authoritative server order"
);

// A sparse response names the order and returns only the written records.
const added = application(900);
const sparse = applyApplicationWriteResponse(current, {
  order: [added.id, ...current.filter((entry) => entry.id !== current[5].id).map((entry) => entry.id)],
  applications: [added, { ...changed }]
});
assert.equal(sparse.length, 500, "a sparse response adds one record and drops one deleted record");
assert.equal(sparse[0], added, "a new record comes from the response");
assert.equal(sparse.find((entry) => entry.id === changed.id).notes, "Changed", "an edited record comes from the response");
assert.equal(sparse[1], current[0], "unchanged records keep their references");
assert.ok(!sparse.some((entry) => entry.id === current[5].id), "an id absent from the order is removed");
assert.throws(
  () => applyApplicationWriteResponse(current, { order: ["unknown"], applications: [] }),
  /unknown application unknown/,
  "a sparse response naming an unknown id is rejected rather than guessed"
);
// A full response (stale or missing base revision) is an authoritative snapshot:
// a held row whose updatedAt matches may still differ after an outside edit.
const outsideEdit = serverResponse.map((entry, index) => (index === 3 ? { ...entry, notes: "edited outside" } : entry));
const full = applyApplicationWriteResponse(current, { applications: outsideEdit });
assert.equal(full[3].notes, "edited outside", "a full response replaces a held row even when updatedAt matches");
assert.ok(full.every((entry, index) => entry === outsideEdit[index]), "a full response is adopted as the server sent it");

console.log("Application mutation reconciliation passed");
