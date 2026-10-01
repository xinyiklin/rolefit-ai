// Legacy Settings experience rows become Profile Background text exactly once,
// keep every declared value, and never push the Background past storage.
//
//   node src/lib/__evals__/experience-evidence-migration-eval.mjs

import assert from "node:assert/strict";

import {
  EXPERIENCE_MIGRATION_HEADING,
  experienceEvidenceText,
  migrateExperienceEvidence
} from "../experienceEvidenceMigration.ts";
import { PROFILE_BACKGROUND_STORAGE_LIMIT, migrateStoredSettings, normalizeSettings } from "../settings.ts";
import { parsePortableWorkspacePreferences } from "../workspaceBackupContract.ts";

const allRows = [
  { category: "military", years: 4, count: 1, mostRecentYear: 2019, details: "Signal corps network operations" },
  { category: "professional", years: 2.5, count: 2, mostRecentYear: 2024, details: "production TypeScript services" },
  { category: "internship", years: 0.25, count: 1, mostRecentYear: 2022 },
  { category: "freelance", count: 3 },
  { category: "research", years: 1, mostRecentYear: 2021, details: "NLP lab" },
  { category: "academic", years: 1, count: 1 },
  { category: "personal", count: 4, mostRecentYear: 2026, details: "browser extensions and local-first tools" },
  { category: "open-source", count: 2, details: "PRs to django-rest-framework" },
  { category: "volunteer" }
];
assert.equal(
  experienceEvidenceText(allRows),
  [
    EXPERIENCE_MIGRATION_HEADING,
    "- Professional employment: 2.5 years; 2 roles or projects; most recent in 2024; scope: production TypeScript services",
    "- Internship / co-op / apprenticeship: 0.25 years; 1 role or project; most recent in 2022",
    "- Freelance / contract / consulting: 3 roles or projects",
    "- Research / lab: 1 year; most recent in 2021; scope: NLP lab",
    "- Academic / coursework projects: 1 year; 1 role or project",
    "- Personal / independent projects: 4 roles or projects; most recent in 2026; scope: browser extensions and local-first tools",
    "- Open-source contributions: 2 roles or projects; scope: PRs to django-rest-framework",
    "- Volunteer / community work: experience declared",
    "- Military / public service: 4 years; 1 role or project; most recent in 2019; scope: Signal corps network operations"
  ].join("\n"),
  "every category and every declared value survives in the canonical order"
);
assert.equal(
  experienceEvidenceText([
    { category: "professional", years: 200, count: 0, mostRecentYear: 2200, details: `  ${"x".repeat(300)}  `, extra: true },
    { category: "professional", years: 3 },
    { category: "bogus", years: 4 },
    null
  ]),
  `${EXPERIENCE_MIGRATION_HEADING}\n- Professional employment: scope: ${"x".repeat(240)}`,
  "values the old Settings rejected stay rejected, and the first row per category wins"
);
for (const empty of [[], [null], [{ category: "bogus" }], "rows", null]) {
  assert.equal(experienceEvidenceText(empty), "", `no usable rows render nothing (${JSON.stringify(empty)})`);
}

// Background text is never rewritten, only appended to.
const background = "## Slotwise (personal project, 2025–present)\nBuilt scheduling services.  ";
const withoutRows = { profileBackground: background, gpa: 3.5 };
assert.equal(migrateExperienceEvidence(withoutRows), withoutRows, "settings without rows pass through untouched");
assert.deepEqual(
  migrateExperienceEvidence({ profileBackground: background, experienceProfile: [] }),
  { profileBackground: background },
  "empty rows are dropped without touching the Background"
);
const block = experienceEvidenceText(allRows);
for (const [before, after] of [
  ["", block],
  [background, `${background}\n\n${block}`],
  [`${background}\n`, `${background}\n\n${block}`],
  [`${background}\n\n`, `${background}\n\n${block}`]
]) {
  const migrated = migrateExperienceEvidence({ profileBackground: before, experienceProfile: allRows });
  assert.deepEqual(migrated, { profileBackground: after }, `rows append after ${JSON.stringify(before.slice(-4))}`);
  assert.deepEqual(migrateExperienceEvidence(migrated), migrated, "migrating twice changes nothing");
  assert.deepEqual(
    migrateExperienceEvidence({ ...migrated, experienceProfile: allRows }),
    migrated,
    "an unsaved file re-read after migration does not duplicate the block"
  );
}
assert.deepEqual(
  migrateExperienceEvidence({ experienceProfile: allRows }),
  { profileBackground: block },
  "rows without Background text become the Background"
);

// The largest possible legacy state fits the storage bound, so nothing is sliced.
const maxRows = allRows.map((row) => ({
  category: row.category,
  years: 79.99,
  count: 99,
  mostRecentYear: 2100,
  details: "d".repeat(240)
}));
const maxBackground = "b".repeat(50_000);
const maxMigrated = migrateStoredSettings({ honestContext: maxBackground, experienceProfile: maxRows });
assert.ok(
  maxMigrated.profileBackground.length <= PROFILE_BACKGROUND_STORAGE_LIMIT,
  `largest migrated Background (${maxMigrated.profileBackground.length}) fits storage`
);
assert.equal(normalizeSettings(maxMigrated).profileBackground, maxMigrated.profileBackground, "normalization keeps the whole migrated Background");
assert.equal(
  parsePortableWorkspacePreferences({ settings: { honestContext: maxBackground, experienceProfile: maxRows }, lastBaseResume: "" }).settings.profileBackground,
  maxMigrated.profileBackground,
  "a maximal legacy backup restores without loss"
);

console.log(`experience-evidence migration probes passed (max migrated Background ${maxMigrated.profileBackground.length} chars)`);
