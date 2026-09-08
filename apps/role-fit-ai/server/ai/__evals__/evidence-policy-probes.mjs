import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findUngroundedNumericClaim } from "../sanitize.ts";
import { affirmativeEvidenceForTerm } from "../claimEvidence.ts";
import { hasFitEvidenceConflict } from "../fitEvidence.ts";
for (const partition of ["regression", "holdout"]) {
  const fixture = JSON.parse(
    readFileSync(new URL(`./fixtures/evidence-policy-${partition}.json`, import.meta.url), "utf8")
  );
  const checks = {
    number: (row) => !findUngroundedNumericClaim(row.claim, row.evidence),
    skill: (row) => affirmativeEvidenceForTerm(row.claim, row.evidence),
    fit: (row) => !hasFitEvidenceConflict(row.claim, row.evidence)
  };
  const rows = fixture.cases.map((row) => ({
    ...row,
    actual: checks[row.check](row) ? "accept" : "reject"
  }));
  const report = {
    partition,
    labelProvenance: fixture.labelProvenance,
    humanReviewed: false,
    sampleCount: rows.length,
    validExamples: rows.filter((row) => row.expected === "accept").length,
    adversarialExamples: rows.filter((row) => row.expected === "reject").length,
    unsupportedAcceptance: rows.filter(
      (row) => row.expected === "reject" && row.actual === "accept"
    ).length,
    unnecessaryRejection: rows.filter((row) => row.expected === "accept" && row.actual === "reject")
      .length,
    errorsByDimension: Object.fromEntries(
      [...new Set(rows.map((row) => row.dimension))].map((dimension) => [
        dimension,
        rows.filter((row) => row.dimension === dimension && row.expected !== row.actual).length
      ])
    ),
    scope: `${fixture.scope}; Fit cases check explicit conflicts only, not proof of semantic support`
  };
  console.log(JSON.stringify(report));
  for (const row of rows) assert.equal(row.actual, row.expected, row.id);
}
