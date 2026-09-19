import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeApplications } from "../schema.ts";
import { readApplications, writeApplications } from "../storage.ts";
import { preparedApplicationRecord } from "../../../src/lib/preparedApplicationRecord.ts";
import { preparationCommitIdentity, newPreparationSession } from "../../../src/lib/preparationSession.ts";
import { jobAnalysisWarningContext } from "../../../shared/jobAnalysisWarnings.ts";

const jobWarnings = [{ field: "roleDescription", message: "Not supported by provided evidence. Check this generated field against the original posting." }];
const base = { id: "synthetic-warning", title: "Engineer", jobUrl: "", jobDescription: "Prepared description", status: "applied", createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
const args = { base, existing: null, jobUrl: "", preparedJobDescription: "Generated description", jobRawText: "Original source", jobWarnings, tracking: {}, pipelineAiUsage: {}, fitAssessmentPersistence: { action: "clear" }, now: base.updatedAt, usage: { mode: "job-only" } };
const prepared = preparedApplicationRecord(args);
assert.deepEqual(prepared.application.jobWarnings, jobWarnings);
assert.equal(prepared.application.rawJobDescription, "Original source");
assert.equal(prepared.application.jobDescription, "Generated description");
const stored = sanitizeApplications([prepared.application])[0];
assert.deepEqual(stored.jobWarnings, jobWarnings);
const legacy = sanitizeApplications([base])[0];
assert.equal(legacy.jobWarnings, undefined, "legacy absence does not invent verification or warnings");
const cleared = preparedApplicationRecord({ ...args, jobWarnings: undefined, existing: stored });
assert.ok(cleared.clearFields.includes("jobWarnings"), "new analysis can clear prior output checks explicitly");
const identityArgs = { session: newPreparationSession(), preparationId: "synthetic", jobUrl: "", preparedJobDescription: "Generated description", jobRawText: "Original source" };
assert.notEqual(preparationCommitIdentity(identityArgs), preparationCommitIdentity({ ...identityArgs, jobWarnings }), "a warning-only replacement invalidates a captured save");
assert.match(jobAnalysisWarningContext(jobWarnings), /original posting/);
assert.match(jobAnalysisWarningContext(jobWarnings), /never treat job fields as candidate evidence/);
const dir = await mkdtemp(join(tmpdir(), "rolefit-job-warnings-"));
try {
  await writeApplications(dir, [stored, { ...legacy, id: "legacy" }]);
  const reopened = await readApplications(dir);
  assert.deepEqual(reopened[0].jobWarnings, jobWarnings);
  assert.equal(reopened[1].jobWarnings, undefined);
  await writeFile(join(dir, "applications.json"), JSON.stringify({ applications: [{ ...stored, jobWarnings: [{ field: "wrong-field", message: "Unknown field" }] }] }));
  await assert.rejects(readApplications(dir), /safely|repair|restore/i, "invalid warning association does not silently rewrite stored data");
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log("Job warning persistence passed: current and legacy reads, exact round-trip, original source distinction, stale-save identity, corrupt metadata rejection");
