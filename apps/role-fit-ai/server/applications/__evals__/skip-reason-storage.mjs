import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplicationsStorageError, sanitizeApplications } from "../schema.ts";
import { applicationsFilePath, readApplications, writeApplications } from "../storage.ts";

// Skip reasons are a list. Records written before the list carry one scalar
// `notApplyingReason`; they must keep loading under the strict tracker read,
// while any other shape the build cannot represent exactly still fails closed.

const createdAt = "2026-07-01T00:00:00.000Z";
const updatedAt = "2026-07-29T10:00:00.000Z";
const decidedAt = "2026-07-29T09:00:00.000Z";
const fitAssessment = {
  resumeLabel: "Synthetic resume",
  assessedAt: "2026-07-29T08:00:00.000Z",
  result: {
    status: "ASSESSED",
    verdict: "LIMITED",
    summary: "Synthetic summary.",
    matches: [],
    gaps: []
  }
};

function skipped(id, extra = {}) {
  return {
    id,
    title: `Synthetic ${id}`,
    createdAt,
    updatedAt,
    status: "not_applying",
    notApplyingAt: decidedAt,
    ...extra
  };
}

const workspace = await mkdtemp(join(tmpdir(), "rolefit-skip-reasons-"));
const filePath = applicationsFilePath(workspace);

async function canonicalRecords(records) {
  await writeApplications(workspace, records);
  return JSON.parse(await readFile(filePath, "utf8")).applications;
}

async function writeRaw(records) {
  await writeFile(filePath, JSON.stringify({ savedAt: updatedAt, applications: records }, null, 2), "utf8");
}

async function assertReadFailsClosed(records, message) {
  await writeRaw(records);
  await assert.rejects(readApplications(workspace), ApplicationsStorageError, message);
}

try {
  // Incoming writes keep known reasons in canonical order, drop invalid values,
  // and accept the pre-list scalar from a tab that loaded before the upgrade.
  const [ordered, scalar, legacyScalar, empty, notSkipped] = sanitizeApplications([
    skipped("ordered", { notApplyingReasons: ["other", "bogus", "location", "location", 7] }),
    skipped("scalar", { notApplyingReason: "clearance" }),
    skipped("legacy-scalar", { notApplyingReason: "constraints" }),
    skipped("empty", { notApplyingReasons: [] }),
    { id: "applied", title: "Applied", createdAt, updatedAt, status: "applied", appliedAt: decidedAt, notApplyingReasons: ["fit"] }
  ]);
  assert.deepEqual(ordered.notApplyingReasons, ["location", "other"], "writes canonicalize and drop invalid reasons");
  assert.deepEqual(scalar.notApplyingReasons, ["clearance"], "a pre-list scalar save becomes a one-item list");
  assert.deepEqual(legacyScalar.notApplyingReasons, ["constraints"], "the retired catch-all stays valid on saved records");
  assert.equal(empty.notApplyingReasons, undefined, "an empty list is omitted");
  assert.equal(notSkipped.notApplyingReasons, undefined, "only Skipped records keep reasons");
  for (const record of [ordered, scalar, legacyScalar]) {
    assert.equal(Object.hasOwn(record, "notApplyingReason"), false, "the scalar field is never written back");
  }

  // A record carrying both shapes is an outdated tab's mixed save: rejected
  // visibly instead of silently preferring either shape.
  const mixed = skipped("mixed", { notApplyingReason: "fit", notApplyingReasons: ["clearance"] });
  assert.equal(sanitizeApplications([mixed]).length, 0, "both reason shapes are rejected");
  await assert.rejects(
    writeApplications(workspace, [mixed]),
    (error) => error instanceof ApplicationsStorageError && error.status === 400,
    "a mixed-shape save is refused with the invalid-application error"
  );

  // Multi-reason round trip through the strict read.
  const multi = skipped("multi", {
    notApplyingReasons: ["compensation", "work_authorization", "already_applied"],
    notApplyingNote: "Synthetic note"
  });
  await writeApplications(workspace, [multi]);
  const [readMulti] = await readApplications(workspace);
  assert.deepEqual(readMulti.notApplyingReasons, ["work_authorization", "compensation", "already_applied"]);
  assert.equal(readMulti.notApplyingNote, "Synthetic note");

  // Legacy single-reason records load without a rewrite: every retired value,
  // with and without a note, with and without a Fit snapshot (whose own
  // normalization returns early), an empty appliedAt, and a later-skipped
  // application that keeps its application date.
  const legacyValues = ["fit", "interest", "constraints", "other"];
  const legacyInputs = [];
  for (const value of legacyValues) {
    for (const withNote of [false, true]) {
      for (const withFit of [false, true]) {
        legacyInputs.push(skipped(`legacy-${value}-${withNote ? "note" : "plain"}-${withFit ? "fit" : "nofit"}`, {
          notApplyingReasons: [value],
          ...(withNote ? { notApplyingNote: "Synthetic legacy note" } : {}),
          ...(withFit ? { fitAssessment } : {})
        }));
      }
    }
  }
  legacyInputs.push(skipped("legacy-later-skipped", {
    appliedAt: "2026-07-20T10:00:00.000Z",
    notApplyingReasons: ["fit"]
  }));
  const [emptyAppliedCanonical] = await canonicalRecords([skipped("legacy-empty-applied")]);
  const canonical = await canonicalRecords(legacyInputs);
  assert.ok(canonical.some((record) => record.fitAssessment), "fixtures include a stored Fit snapshot");
  const legacyOnDisk = canonical.map((record) => {
    const { notApplyingReasons, ...rest } = record;
    return { ...rest, notApplyingReason: notApplyingReasons[0] };
  });
  legacyOnDisk.push({ ...emptyAppliedCanonical, appliedAt: "", notApplyingReason: "interest" });
  await writeRaw(legacyOnDisk);
  const before = await readFile(filePath, "utf8");
  const loaded = await readApplications(workspace);
  assert.equal(loaded.length, legacyOnDisk.length, "every legacy record loads");
  for (const [index, record] of loaded.entries()) {
    assert.deepEqual(record.notApplyingReasons, [legacyOnDisk[index].notApplyingReason], `${record.id} keeps its reason`);
    assert.equal(Object.hasOwn(record, "notApplyingReason"), false);
  }
  assert.equal(
    loaded.find((record) => record.id === "legacy-later-skipped").appliedAt,
    "2026-07-20T10:00:00.000Z",
    "a later-skipped application keeps its application date"
  );
  assert.equal(await readFile(filePath, "utf8"), before, "a compatibility read does not rewrite the file");

  // Anything else the build cannot represent exactly still fails closed.
  const [base] = await canonicalRecords([skipped("strict", { notApplyingReasons: ["fit"] })]);
  const { notApplyingReasons: _reasons, ...withoutReasons } = base;
  await assertReadFailsClosed([{ ...base, notApplyingReasons: ["fit", "bogus"] }], "an unknown stored reason fails closed");
  await assertReadFailsClosed([{ ...base, notApplyingReasons: "fit" }], "a non-list stored value fails closed");
  await assertReadFailsClosed([{ ...base, notApplyingReasons: ["other", "fit"] }], "a non-canonical stored order fails closed");
  await assertReadFailsClosed([{ ...base, notApplyingReason: "fit" }], "both stored shapes fail closed");
  await assertReadFailsClosed([{ ...withoutReasons, notApplyingReason: "bogus" }], "an unknown legacy scalar fails closed");
  await assertReadFailsClosed([{ ...base, notApplyingReasons: [] }], "a stored empty list fails closed");
} finally {
  await rm(workspace, { recursive: true, force: true });
}

console.log("Skip reason storage passed");
