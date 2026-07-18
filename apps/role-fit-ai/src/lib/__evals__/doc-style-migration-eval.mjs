import assert from "node:assert/strict";

import { mapLegacyToSharedRaw } from "../docStyleMigration.ts";

const migrated = mapLegacyToSharedRaw({
  zoom: 1.25,
  lineHeight: 1.1,
  nameContactGap: 0.04,
  contactGap: 0.12,
  headerSectionGap: 1.19,
  sectionGap: 0.85,
  sectionEntryGap: 0.2,
  entryGap: 0.1,
  titleSubGap: 0.05,
  headBulletGap: 0.08,
  skillsRowGap: 0.04,
  bulletGap: 0.03,
  headingCase: "upper",
  sectionRule: true,
  contactDivider: "pipe",
  headerAlign: "center",
  bodyAlign: "left",
  headingAlign: "left",
  nameSize: "large",
  pageMargins: "compact"
});

assert.equal(migrated.zoom, 1.25);
assert.equal(migrated.lineHeight, 1.1);
assert.ok(Math.abs(migrated.nameContactGapPt - 72 / 72.27) < 1e-9);
assert.ok(Math.abs(migrated.sectionGapPt - 0.85 * 11 * (72 / 72.27)) < 1e-9);
assert.ok(Math.abs(migrated.skillsRowGapPt - 0.04 * 10 * (72 / 72.27)) < 1e-9);
assert.equal(migrated.headingCase, "upper");
assert.equal(migrated.sectionRule, true);
assert.equal(migrated.contactDivider, "pipe");
assert.equal(migrated.pageMargins, "compact");

assert.deepEqual(
  mapLegacyToSharedRaw({ zoom: "wide", sectionGap: Number.NaN, sectionRule: "yes" }),
  {},
  "invalid legacy fields do not cross the migration boundary"
);

console.log("PASS legacy document-style migration boundary");
