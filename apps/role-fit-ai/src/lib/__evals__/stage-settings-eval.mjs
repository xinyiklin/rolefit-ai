// Probes for the pure stage settings boundary. Every stage owns one concrete
// provider/model/effort triple; absent fields use the product default instead
// of reading another stage's settings.

import assert from "node:assert/strict";

import { AI_STAGES, AI_STAGE_IDS } from "../../config/aiStages.ts";
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
      blurb: "Assesses the selected resume and About you evidence against the captured posting."
    },
    "resume-polish": {
      label: "Resume Polish",
      title: "Resume Polish",
      blurb: "Creates one grounded proposal for the resume sections marked Polish."
    },
    cover: {
      label: "Cover letter",
      title: "Cover letter",
      blurb: "Creates a grounded whole-letter proposal for you to accept or discard."
    },
    answers: {
      label: "Application questions",
      title: "Application questions",
      blurb: "Drafts grounded answers to an application's written questions."
    }
  },
  "AI stage copy describes current user-visible requests"
);
assert.deepEqual(Object.keys(fresh).sort(), [...AI_STAGE_IDS].sort(), "every declared stage is seeded");
assert.deepEqual(
  AI_STAGES.filter((stage) => stage.supportsInstructions).map((stage) => stage.id),
  ["resume-polish", "cover", "answers"],
  "only drafting stages expose custom-instruction controls"
);
for (const stage of AI_STAGE_IDS) {
  assert.equal(fresh[stage].provider, "claude-cli", `${stage} defaults to the account-backed CLI`);
  assert.equal(fresh[stage].selectedModel, "claude-sonnet-5", `${stage} defaults to the CLI model`);
}

const partialSettings = {
  aiProvider: "openai",
  selectedModel: "gpt-5.6-terra",
  cliReasoningEffort: "medium",
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
for (const stage of ["cover", "answers"]) {
  assert.equal(seeded[stage].provider, "claude-cli", `${stage} uses its own default when absent`);
  assert.equal(seeded[stage].selectedModel, "claude-sonnet-5", `${stage} uses the default model when absent`);
}
assert.equal(
  seedStage("cover", { aiProvider: "openai" }).provider,
  "claude-cli",
  "Cover never inherits Resume Polish's provider"
);
assert.equal(
  seedStage("fit-assessment", { jobAnalysisProvider: "openai" }).provider,
  "claude-cli",
  "Fit Assessment never inherits Job analysis's provider when its own setting is absent"
);

const explicitCover = seedStages({
  ...partialSettings,
  coverProvider: "anthropic",
  coverSelectedModel: "claude-opus-4-8",
  coverCliReasoningEffort: "low"
});
assert.equal(explicitCover.cover.provider, "anthropic", "an explicit cover provider is preserved");
assert.equal(explicitCover.cover.selectedModel, "claude-opus-4-8", "an explicit cover model is preserved");
assert.equal(explicitCover.answers.provider, "claude-cli", "Answers remains independent from Cover");

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
      cover: "Use a direct tone."
    }
  }).stageCustomInstructions,
  {
    "resume-polish": "Keep the resume to one page.",
    cover: "Use a direct tone."
  },
  "normalization drops hidden analysis-stage guidance and keeps drafting overrides"
);

const flattened = stageFieldsToPersist(seeded);
assert.deepEqual(normalizeSettings(flattened), flattened, "canonical five-stage settings round-trip");
assert.deepEqual(normalizeSettings(partialSettings), partialSettings, "normalization does not seed absent stages");
assert.deepEqual(seedStages(flattened), seeded, "persist/normalize/seed is idempotent");

const adoptedSparseSettings = materializeAiSettings({ honestContext: "Keep this workspace fact." });
assert.equal(adoptedSparseSettings.honestContext, "Keep this workspace fact.");
assert.equal(adoptedSparseSettings.runInitialFit, true);
assert.equal(adoptedSparseSettings.autoPolishResume, false);
assert.equal(adoptedSparseSettings.coverLetterAutoPolishThreshold, "STRONG");
assert.deepEqual(
  materializeAiSettings(adoptedSparseSettings),
  adoptedSparseSettings,
  "workspace adoption materializes one stable normalized live-settings fingerprint"
);

const retiredAntigravityNames = normalizeSettings({
  aiProvider: "antigravity-cli",
  selectedModel: "Gemini 3.5 Flash (Medium)",
  coverProvider: "antigravity-cli",
  coverSelectedModel: "Claude Opus 4.6 (Thinking)"
});
assert.equal(retiredAntigravityNames.selectedModel, "gemini-3.6-flash-high");
assert.equal(retiredAntigravityNames.coverSelectedModel, "gemini-3.6-flash-high");

assert.deepEqual(
  normalizeSettings({
    runInitialFit: false,
    autoCreateResumeProposal: true,
    autoCreateCoverLetterProposal: false
  }),
  {
    runInitialFit: false
  },
  "retired workflow preferences are dropped instead of migrated"
);
assert.deepEqual(
  normalizeSettings({
    runInitialFit: "always",
    autoPolishResume: 1,
    autoPolishCoverLetter: null,
    resumeAutoPolishThreshold: "MOSTLY"
  }),
  {},
  "invalid workflow preferences are dropped"
);
assert.deepEqual(
  normalizeSettings({
    autoPolishResume: true,
    resumeAutoPolishThreshold: "STRETCH",
    autoPolishCoverLetter: true,
    coverLetterAutoPolishThreshold: "STRONG"
  }),
  {
    autoPolishResume: true,
    resumeAutoPolishThreshold: "STRETCH",
    autoPolishCoverLetter: true,
    coverLetterAutoPolishThreshold: "STRONG"
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

console.log("stage-settings probes passed");
