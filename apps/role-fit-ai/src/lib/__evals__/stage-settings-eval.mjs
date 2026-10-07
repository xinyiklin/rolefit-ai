// Probes for the pure stage settings boundary. Every stage owns one concrete
// provider/model/effort triple; absent fields use the product default instead
// of reading another stage's settings.

import assert from "node:assert/strict";

import { AI_STAGES, AI_STAGE_IDS, stageSettingsKeys } from "../../config/aiStages.ts";
import { seedStage, seedStages, stageFieldsToPersist } from "../stageSettings.ts";
import { normalizeSettings } from "../settings.ts";
import { materializeAiSettings } from "../aiSettingsPersistence.ts";

const fresh = seedStages({});
assert.deepEqual(
  Object.fromEntries(AI_STAGES.map(({ id, label, title, blurb }) => [id, { label, title, blurb }])),
  {
    "job-analysis": {
      label: "Job analysis",
      title: "Job analysis",
      blurb: "Structures the captured posting into the editable job brief."
    },
    "fit-assessment": {
      label: "Fit Assessment",
      title: "Fit Assessment",
      blurb: "Assesses the selected resume and your Profile against the captured posting."
    },
    "resume-polish": {
      label: "Resume Polish",
      title: "Resume Polish",
      blurb: "Creates one grounded proposal for the resume sections marked Polish."
    },
    "cover-polish": {
      label: "Cover letter Polish",
      title: "Cover letter Polish",
      blurb: "Creates a grounded whole-letter proposal for you to accept or discard."
    },
    "application-answers": {
      label: "Application questions",
      title: "Application questions",
      blurb: "Drafts grounded answers to an application's written questions."
    },
    "application-review": {
      label: "Final application review",
      title: "Final application review",
      blurb: "Reviews the current included materials when you request it; never changes or submits them."
    }
  },
  "AI stage copy describes current user-visible requests"
);
assert.deepEqual(Object.keys(fresh).sort(), [...AI_STAGE_IDS].sort(), "every declared stage is seeded");
for (const stage of AI_STAGES) {
  assert.deepEqual(
    stageSettingsKeys(stage),
    {
      provider: `${stage.settingsPrefix}Provider`,
      model: `${stage.settingsPrefix}SelectedModel`,
      effort: `${stage.settingsPrefix}CliReasoningEffort`
    },
    `${stage.id} persists under its own prefix`
  );
  assert.equal(
    stage.settingsPrefix,
    stage.id.replace(/-(\w)/g, (_, letter) => letter.toUpperCase()),
    `${stage.id} uses the same name for its stage id and settings prefix`
  );
}
assert.deepEqual(
  AI_STAGES.filter((stage) => stage.supportsInstructions).map((stage) => stage.id),
  ["resume-polish", "cover-polish", "application-answers"],
  "only drafting stages expose custom-instruction controls"
);
assert.deepEqual(fresh, {
  "job-analysis": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" },
  "fit-assessment": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" },
  "resume-polish": { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "medium" },
  "cover-polish": { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "medium" },
  "application-answers": { provider: "claude-cli", selectedModel: "claude-opus-5-5", cliReasoningEffort: "high" },
  "application-review": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" }
}, "fresh stages use their task-specific recommendations");
for (const stage of AI_STAGES) {
  const keys = stageSettingsKeys(stage);
  assert.deepEqual(seedStage(stage.id, { [keys.provider]: fresh[stage.id].provider }), fresh[stage.id], "explicitly choosing the recommended provider uses the stage recommendation");
}

const partialSettings = {
  resumePolishProvider: "openai",
  resumePolishSelectedModel: "gpt-5.6-terra",
  resumePolishCliReasoningEffort: "medium",
  jobAnalysisProvider: "anthropic",
  jobAnalysisSelectedModel: "claude-opus-4-8",
  fitAssessmentProvider: "codex-cli",
  fitAssessmentSelectedModel: "gpt-5.6-terra",
  fitAssessmentCliReasoningEffort: "high",
};
const seeded = seedStages(partialSettings);
assert.equal(seeded["resume-polish"].provider, "openai", "Resume Polish keeps its persisted provider");
assert.equal(seeded["job-analysis"].provider, "anthropic", "Job analysis keeps its own persisted provider");
assert.equal(seeded["fit-assessment"].provider, "codex-cli", "Fit Assessment keeps its own persisted provider");
assert.equal(seeded["fit-assessment"].selectedModel, "gpt-5.6-terra", "Fit Assessment keeps its own model");
for (const stage of ["cover-polish", "application-answers"]) {
  assert.deepEqual(seeded[stage], fresh[stage], `${stage} uses its own default when absent`);
}
assert.equal(
  seedStage("cover-polish", { resumePolishProvider: "openai" }).provider,
  "codex-cli",
  "Cover never inherits Resume Polish's provider"
);
assert.equal(
  seedStage("fit-assessment", { jobAnalysisProvider: "openai" }).provider,
  "claude-cli",
  "Fit Assessment never inherits Job analysis's provider when its own setting is absent"
);

const explicitCover = seedStages({
  ...partialSettings,
  coverPolishProvider: "anthropic",
  coverPolishSelectedModel: "claude-opus-4-8",
  coverPolishCliReasoningEffort: "low"
});
assert.equal(explicitCover["cover-polish"].provider, "anthropic", "an explicit cover provider is preserved");
assert.equal(explicitCover["cover-polish"].selectedModel, "claude-opus-4-8", "an explicit cover model is preserved");
assert.deepEqual(explicitCover["application-answers"], fresh["application-answers"], "Answers remains independent from Cover");
const sparseCover = { coverPolishSelectedModel: "claude-sonnet-5-5", coverPolishCliReasoningEffort: "low" };
assert.deepEqual(seedStage("cover-polish", sparseCover), { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" }, "a prior model-only setting retains its implied provider");
assert.deepEqual(seedStage("cover-polish", materializeAiSettings(sparseCover)), seedStage("cover-polish", sparseCover), "sparse saved choices seed identically before and after persistence");

assert.deepEqual(
  normalizeSettings({
    distillProvider: "anthropic",
    distillSelectedModel: "claude-opus-4-8",
    distillCliReasoningEffort: "high",
    auditProvider: "codex-cli",
    auditSelectedModel: "gpt-5.6-terra",
    auditCliReasoningEffort: "high",
    stageCustomInstructions: {
      distill: "Legacy analyzer instructions.",
      review: "Legacy check instructions.",
      tailor: "Legacy polish instructions.",
      "fit-assessment": "Bias the verdict upward."
    },
    workAuthorization: "authorized-us",
    sponsorship: "not-required"
  }),
  {},
  "retired preview settings are dropped instead of remaining permanent readers"
);
assert.deepEqual(
  normalizeSettings({
    stageCustomInstructions: {
      "job-analysis": "Prefer a shorter brief.",
      "resume-polish": "Keep the resume to one page.",
      "cover-polish": "Use a direct tone."
    }
  }).stageCustomInstructions,
  {
    "resume-polish": "Keep the resume to one page.",
    "cover-polish": "Use a direct tone."
  },
  "normalization drops hidden analysis-stage guidance and keeps drafting overrides"
);

const flattened = stageFieldsToPersist(seeded);
assert.deepEqual(normalizeSettings(flattened), flattened, "canonical five-stage settings round-trip");
assert.deepEqual(normalizeSettings(partialSettings), partialSettings, "normalization does not seed absent stages");
assert.deepEqual(seedStages(flattened), seeded, "persist/normalize/seed is idempotent");

const adoptedSparseSettings = materializeAiSettings({ profileBackground: "Keep this workspace fact." });
assert.equal(adoptedSparseSettings.profileBackground, "Keep this workspace fact.");
assert.equal(adoptedSparseSettings.fitAssessmentAuto, true);
assert.equal(adoptedSparseSettings.resumePolishAuto, false);
assert.equal(adoptedSparseSettings.coverPolishAutoThreshold, "STRONG");
assert.equal(adoptedSparseSettings.legallyAuthorizedToWork, "unspecified");
assert.equal(adoptedSparseSettings.requiresSponsorship, "unspecified");
assert.deepEqual(
  materializeAiSettings(adoptedSparseSettings),
  adoptedSparseSettings,
  "workspace adoption materializes one stable normalized live-settings fingerprint"
);

const retiredAntigravityNames = normalizeSettings({
  resumePolishProvider: "antigravity-cli",
  resumePolishSelectedModel: "Gemini 3.5 Flash (Medium)",
  coverPolishProvider: "antigravity-cli",
  coverPolishSelectedModel: "Claude Opus 4.6 (Thinking)"
});
assert.equal(retiredAntigravityNames.resumePolishSelectedModel, "gemini-3.6-flash-high");
assert.equal(retiredAntigravityNames.coverPolishSelectedModel, "gemini-3.6-flash-high");

assert.deepEqual(
  normalizeSettings({
    fitAssessmentAuto: false,
    autoCreateResumeProposal: true,
    autoCreateCoverLetterProposal: false
  }),
  {
    fitAssessmentAuto: false
  },
  "retired workflow preferences are dropped instead of migrated"
);
assert.deepEqual(
  normalizeSettings({
    fitAssessmentAuto: "always",
    resumePolishAuto: 1,
    coverPolishAuto: null,
    resumePolishAutoThreshold: "MOSTLY"
  }),
  {},
  "invalid workflow preferences are dropped"
);
assert.deepEqual(
  normalizeSettings({
    legallyAuthorizedToWork: "yes",
    requiresSponsorship: "no"
  }),
  {
    legallyAuthorizedToWork: "yes",
    requiresSponsorship: "no"
  },
  "explicit tri-state employment eligibility answers round-trip"
);
assert.deepEqual(
  normalizeSettings({
    legallyAuthorizedToWork: true,
    requiresSponsorship: false
  }),
  {},
  "old boolean defaults are not accepted as current declarations"
);
assert.deepEqual(
  normalizeSettings({ [["run", "Initial", "Fit"].join("")]: false }),
  {},
  "the retired Fit preference name is not a runtime alias"
);
assert.deepEqual(
  normalizeSettings({
    resumePolishAuto: true,
    resumePolishAutoThreshold: "STRETCH",
    coverPolishAuto: true,
    coverPolishAutoThreshold: "STRONG"
  }),
  {
    resumePolishAuto: true,
    resumePolishAutoThreshold: "STRETCH",
    coverPolishAuto: true,
    coverPolishAutoThreshold: "STRONG"
  },
  "the two categorical thresholds persist independently"
);
assert.deepEqual(
  normalizeSettings({
    gpa: 3.86,
    availabilityNotice: "specific-date",
    availabilityDate: "2026-09-14"
  }),
  {
    gpa: 3.86,
    availabilityNotice: "specific-date",
    availabilityDate: "2026-09-14"
  },
  "GPA and a valid exact availability date round-trip through settings normalization"
);
assert.deepEqual(
  normalizeSettings({
    gpa: 4.5,
    availabilityNotice: "specific-date",
    availabilityDate: "2026-02-31"
  }),
  {},
  "invalid GPA and calendar-date pairs fail closed"
);
assert.deepEqual(
  normalizeSettings({ availabilityNotice: "two-weeks", availabilityDate: "2026-09-14" }),
  { availabilityNotice: "two-weeks" },
  "a relative notice period drops an unrelated stale exact date"
);
assert.deepEqual(
  normalizeSettings({ citizenshipStatus: "", educationLevel: "" }),
  {},
  "empty enum values fail closed instead of surviving as undeclared candidate facts"
);

// Bold-in-bullets is default-on and must stay allowlisted: dropping it from
// PERSISTED_SETTING_KEYS or from the boolean scrub is invisible to the server
// probes, and the user's checkbox would simply stop surviving a reload.
assert.equal(
  materializeAiSettings({}).boldBulletKeywords,
  true,
  "an unset bold preference defaults to on"
);
assert.equal(
  materializeAiSettings({ boldBulletKeywords: false }).boldBulletKeywords,
  false,
  "an explicit off preference is preserved through materialization"
);
assert.deepEqual(
  normalizeSettings({ boldBulletKeywords: true }),
  { boldBulletKeywords: true },
  "the bold preference is allowlisted for persistence"
);
assert.deepEqual(
  normalizeSettings({ boldBulletKeywords: "no" }),
  {},
  "a non-boolean bold preference fails closed rather than persisting"
);



assert.deepEqual(seeded["application-review"], seeded["fit-assessment"], "new review stage copies Fit once");
const persistedReview = stageFieldsToPersist(seeded);
assert.deepEqual(seedStages({...persistedReview,fitAssessmentProvider:"anthropic"})["application-review"],seeded["application-review"],"persisted review does not follow later Fit changes");

// Model retirement and effort repair must stay isolated to each stage.
for (const stage of AI_STAGES) {
  const keys = stageSettingsKeys(stage);
  for (const retired of ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"]) {
    const saved = { [keys.provider]: "codex-cli", [keys.model]: retired, [keys.effort]: "high" };
    const repaired = normalizeSettings(saved);
    assert.equal(repaired[keys.model], "gpt-6.1-sol");
    assert.equal(repaired[keys.provider], "codex-cli");
    assert.equal(repaired[keys.effort], "high");
    assert.equal(saved[keys.model], retired, "normalization must not mutate its input");
    assert.deepEqual(Object.keys(repaired).sort(), Object.keys(saved).sort(), "absent stages stay absent");
  }
  for (const model of ["gpt-5.5", "gpt-5.6-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6.1-sol"]) {
    const saved = { [keys.provider]: "codex-cli", [keys.model]: model, [keys.effort]: "high" };
    assert.deepEqual(normalizeSettings(saved), saved, "supported explicit selections survive the refresh");
  }
  const luna = normalizeSettings({ [keys.provider]: "codex-cli", [keys.model]: "gpt-6-luna", [keys.effort]: "ultra" });
  assert.equal(luna[keys.effort], "medium");
  const haiku = normalizeSettings({ [keys.provider]: "claude-cli", [keys.model]: "claude-haiku-4-5", [keys.effort]: "high" });
  assert.equal(haiku[keys.effort], "");
  assert.equal(seedStage(stage.id, haiku).cliReasoningEffort, "");
  assert.equal(seedStage(stage.id, { [keys.provider]: "claude-cli", [keys.model]: "claude-haiku-4-5" }).cliReasoningEffort, "");
  assert.equal(seedStage(stage.id, { [keys.provider]: "codex-cli" }).selectedModel, "gpt-6.1-sol");
  const solUltra = { [keys.provider]: "codex-cli", [keys.model]: "gpt-6-sol", [keys.effort]: "ultra" };
  assert.deepEqual(normalizeSettings(solUltra), solUltra, "a saved GPT-6 Sol Ultra stage stays valid");
  const sonnet5 = { [keys.provider]: "claude-cli", [keys.model]: "claude-sonnet-5", [keys.effort]: "low" };
  assert.deepEqual(normalizeSettings(sonnet5), sonnet5, "a saved Sonnet 5 selection is not moved to the new default");
}
const mixedStages = normalizeSettings({
  resumePolishProvider: "codex-cli", resumePolishSelectedModel: "gpt-5.4", resumePolishCliReasoningEffort: "high",
  coverPolishProvider: "claude-cli", coverPolishSelectedModel: "claude-opus-5", coverPolishCliReasoningEffort: "max"
});
assert.equal(mixedStages.resumePolishSelectedModel, "gpt-6.1-sol");
assert.equal(mixedStages.coverPolishSelectedModel, "claude-opus-5");
assert.equal(mixedStages.coverPolishCliReasoningEffort, "max");

console.log("stage-settings probes passed");
