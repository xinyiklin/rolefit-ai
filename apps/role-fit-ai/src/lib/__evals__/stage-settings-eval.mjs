// Probes for the pure stage settings boundary. Every stage owns one concrete
// provider/model/effort triple; absent fields use the product default instead
// of reading another stage's settings.

import assert from "node:assert/strict";

import { AI_STAGES, AI_STAGE_IDS } from "../../config/aiStages.ts";
import { seedStage, seedStages, stageFieldsToPersist } from "../stageSettings.ts";
import { normalizeSettings } from "../settings.ts";

const fresh = seedStages({});
assert.deepEqual(
  Object.fromEntries(AI_STAGES.map(({ id, label, title, blurb }) => [id, { label, title, blurb }])),
  {
    "job-analysis": {
      label: "Job analysis",
      title: "Job analysis",
      blurb: "Structures the posting and, when enabled, checks Initial Fit."
    },
    "resume-polish": {
      label: "Resume Polish",
      title: "Resume Polish",
      blurb: "Creates one grounded proposal for the resume sections marked Polish."
    },
    "final-check": {
      label: "Document check",
      title: "Check current document",
      blurb: "Checks the current resume or cover letter after proposal decisions or later edits."
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
  finalCheckProvider: "codex-cli",
  finalCheckSelectedModel: "gpt-5.6-terra"
};
const seeded = seedStages(partialSettings);
assert.equal(seeded["resume-polish"].provider, "openai", "Resume Polish keeps its persisted provider");
assert.equal(seeded["job-analysis"].provider, "anthropic", "Job analysis keeps its own persisted provider");
assert.equal(seeded["final-check"].provider, "codex-cli", "Document check keeps its own persisted provider");
for (const stage of ["cover", "answers"]) {
  assert.equal(seeded[stage].provider, "claude-cli", `${stage} uses its own default when absent`);
  assert.equal(seeded[stage].selectedModel, "claude-sonnet-5", `${stage} uses the default model when absent`);
}
assert.equal(
  seedStage("cover", { aiProvider: "openai" }).provider,
  "claude-cli",
  "Cover never inherits Resume Polish's provider"
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
      tailor: "Legacy polish instructions."
    },
    workAuthorization: "authorized-us",
    sponsorship: "not-required"
  }),
  {},
  "retired preview settings are dropped instead of remaining permanent readers"
);

const flattened = stageFieldsToPersist(seeded);
assert.deepEqual(normalizeSettings(flattened), flattened, "canonical five-stage settings round-trip");
assert.deepEqual(normalizeSettings(partialSettings), partialSettings, "normalization does not seed absent stages");
assert.deepEqual(seedStages(flattened), seeded, "persist/normalize/seed is idempotent");

const migratedAntigravity = normalizeSettings({
  aiProvider: "antigravity-cli",
  selectedModel: "Gemini 3.5 Flash (Medium)",
  coverProvider: "antigravity-cli",
  coverSelectedModel: "Claude Opus 4.6 (Thinking)"
});
assert.equal(migratedAntigravity.selectedModel, "gemini-3.5-flash-medium");
assert.equal(migratedAntigravity.coverSelectedModel, "claude-opus-4-6-thinking");

assert.deepEqual(
  normalizeSettings({
    runInitialFit: false,
    autoCreateResumeProposal: true,
    autoCreateCoverLetterProposal: false
  }),
  {
    runInitialFit: false,
    autoCreateResumeProposal: true,
    autoCreateCoverLetterProposal: false
  },
  "current workflow preferences persist independently"
);
assert.deepEqual(
  normalizeSettings({
    runInitialFit: "always",
    autoCreateResumeProposal: 1,
    autoCreateCoverLetterProposal: null
  }),
  {},
  "invalid workflow preferences are dropped"
);

console.log("stage-settings probes passed");
