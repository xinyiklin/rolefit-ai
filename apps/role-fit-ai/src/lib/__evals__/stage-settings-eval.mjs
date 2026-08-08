// Probes for src/lib/stageSettings.ts — how each AI stage's provider config is
// seeded from persisted settings.
//
// The load-bearing case is the cover/answers inheritance. Both flows ran on the
// Tailor config before they were separately configurable, so an install that
// predates the split MUST keep the provider it was already using. Getting this
// wrong silently switches a user's cover-letter or Q&A stage to the default
// provider — possibly a paid one — with nothing on screen to indicate it.
//
//   node src/lib/__evals__/stage-settings-eval.mjs

import assert from "node:assert/strict";

import { AI_STAGE_IDS } from "../../config/aiStages.ts";
import { seedStage, seedStages, stageFieldsToPersist, STAGES_INHERITING_TAILOR } from "../stageSettings.ts";
import { migrateSettings, normalizeSettings } from "../settings.ts";

// ── A fresh install: every stage gets the account-backed CLI default ─────────
const fresh = seedStages({});
assert.equal(AI_STAGE_IDS.includes("job-analysis"), true, "Job analysis is the canonical configurable stage id");
assert.equal(AI_STAGE_IDS.includes("distill"), false, "the retired Distill stage id is not configured");
assert.deepEqual(
  Object.keys(fresh).sort(),
  [...AI_STAGE_IDS].sort(),
  "every declared stage is seeded"
);
for (const stage of AI_STAGE_IDS) {
  assert.equal(fresh[stage].provider, "claude-cli", `${stage} defaults to the account-backed CLI`);
  assert.equal(fresh[stage].selectedModel, "claude-sonnet-5", `${stage} defaults to the CLI's default model`);
}

// ── A pre-split install: cover + answers inherit Tailor, others do not ──────
const preSplit = {
  aiProvider: "openai",
  selectedModel: "gpt-5.6-terra",
  cliReasoningEffort: "medium",
  jobAnalysisProvider: "anthropic",
  jobAnalysisSelectedModel: "claude-opus-4-8",
  finalCheckProvider: "codex-cli",
  finalCheckSelectedModel: "gpt-5.6-terra"
};
const seeded = seedStages(preSplit);
assert.equal(seeded.tailor.provider, "openai", "Tailor keeps its own persisted provider");
assert.equal(seeded["job-analysis"].provider, "anthropic", "Job analysis keeps its own persisted provider");
assert.equal(seeded["final-check"].provider, "codex-cli", "Final Check keeps its own persisted provider");
for (const stage of ["cover", "answers"]) {
  assert.equal(
    seeded[stage].provider,
    "openai",
    `${stage} inherits Tailor's provider so a pre-split install does not silently switch`
  );
  assert.equal(
    seeded[stage].selectedModel,
    "gpt-5.6-terra",
    `${stage} inherits Tailor's MODEL from the same source, never a mismatched pair`
  );
  assert.equal(
    seeded[stage].cliReasoningEffort,
    "medium",
    `${stage} inherits Tailor's effort from the same source`
  );
}
assert.deepEqual(
  [...STAGES_INHERITING_TAILOR].sort(),
  ["answers", "cover"],
  "only the two stages that previously shared Tailor's config inherit it"
);

// The Distill -> Job analysis rename is a real pre-normalization migration.
// Existing localStorage and restored backups must retain the whole stage config
// and its stage-specific instructions, then write only canonical keys.
const legacyDistill = {
  distillProvider: "anthropic",
  distillSelectedModel: "claude-opus-4-8",
  distillCliReasoningEffort: "high",
  stageCustomInstructions: {
    distill: "Keep the posting language precise.",
    tailor: "Keep edits concise."
  }
};
assert.deepEqual(
  migrateSettings(legacyDistill),
  {
    jobAnalysisProvider: "anthropic",
    jobAnalysisSelectedModel: "claude-opus-4-8",
    jobAnalysisCliReasoningEffort: "high",
    stageCustomInstructions: {
      "job-analysis": "Keep the posting language precise.",
      tailor: "Keep edits concise."
    }
  },
  "legacy Distill settings migrate before strict normalization"
);
assert.deepEqual(
  migrateSettings({
    ...legacyDistill,
    jobAnalysisProvider: "openai",
    stageCustomInstructions: {
      distill: "legacy",
      "job-analysis": "canonical"
    }
  }),
  {
    jobAnalysisProvider: "openai",
    jobAnalysisSelectedModel: "claude-opus-4-8",
    jobAnalysisCliReasoningEffort: "high",
    stageCustomInstructions: { "job-analysis": "canonical" }
  },
  "canonical Job analysis values win when both generations are present"
);
const normalizedLegacyDistill = normalizeSettings(legacyDistill);
assert.equal(normalizedLegacyDistill.jobAnalysisProvider, "anthropic", "legacy provider survives normalization");
assert.equal(normalizedLegacyDistill.jobAnalysisSelectedModel, "claude-opus-4-8", "legacy model survives normalization");
assert.equal(normalizedLegacyDistill.jobAnalysisCliReasoningEffort, "high", "legacy effort survives normalization");
assert.equal(
  normalizedLegacyDistill.stageCustomInstructions?.["job-analysis"],
  "Keep the posting language precise.",
  "legacy stage instructions survive normalization"
);

assert.deepEqual(
  migrateSettings({
    auditProvider: "codex-cli",
    auditSelectedModel: "gpt-5.6-terra",
    auditCliReasoningEffort: "high",
    stageCustomInstructions: { review: "Check only the actual current resume." }
  }),
  {
    finalCheckProvider: "codex-cli",
    finalCheckSelectedModel: "gpt-5.6-terra",
    finalCheckCliReasoningEffort: "high",
    stageCustomInstructions: { "final-check": "Check only the actual current resume." }
  },
  "legacy audit settings migrate to the explicit Final Check stage"
);
assert.equal("distillProvider" in normalizedLegacyDistill, false, "normalization writes no legacy provider key");
assert.equal(
  "distill" in (normalizedLegacyDistill.stageCustomInstructions ?? {}),
  false,
  "normalization writes no legacy instruction key"
);

// ── Once a stage has its own config, it stops inheriting ────────────────────
const diverged = seedStages({
  ...preSplit,
  coverProvider: "claude-cli",
  coverSelectedModel: "claude-sonnet-5",
  coverCliReasoningEffort: "low"
});
assert.equal(diverged.cover.provider, "claude-cli", "an explicitly configured cover stage does not inherit");
assert.equal(diverged.answers.provider, "openai", "the other inheriting stage is unaffected by cover diverging");

// A stage that inherits must take the WHOLE triple from one source. A persisted
// model without a provider is not a partial inheritance source.
const providerOnly = seedStage("cover", { aiProvider: "openai" });
assert.equal(providerOnly.provider, "openai", "inheritance works from Tailor's provider alone");
assert.equal(
  providerOnly.selectedModel,
  "gpt-5.6-terra",
  "a missing inherited model falls back to that provider's own default, not another provider's"
);

// ── The round trip is lossless and non-additive ─────────────────────────────
// normalizeSettings never SEEDS an absent stage. Key migrations preserve an
// existing value under its canonical name; cover/answers inheritance remains a
// separate seeding concern, as proven above.
const flattened = stageFieldsToPersist(seeded);
assert.equal(flattened.jobAnalysisProvider, "anthropic", "new settings writes use the Job analysis provider key");
assert.equal("distillProvider" in flattened, false, "new settings writes omit the legacy Distill provider key");
assert.deepEqual(
  normalizeSettings(flattened),
  flattened,
  "a flattened five-stage bag round-trips through normalizeSettings unchanged"
);
assert.deepEqual(
  normalizeSettings(preSplit),
  preSplit,
  "a PRE-SPLIT bag also round-trips unchanged — normalizeSettings adds no cover/answers keys"
);
assert.deepEqual(
  seedStages(flattened),
  seeded,
  "seeding is idempotent through a persist/normalize/seed cycle"
);

const workflowSettings = normalizeSettings({
  runInitialFit: false,
  autoCreateResumeProposal: true,
  autoCreateCoverLetterProposal: false
});
assert.equal(workflowSettings.runInitialFit, false, "Initial Fit can be disabled explicitly");
assert.equal(workflowSettings.autoCreateResumeProposal, true, "resume automation persists independently");
assert.equal(workflowSettings.autoCreateCoverLetterProposal, false, "cover automation persists independently");
assert.deepEqual(
  normalizeSettings({
    runInitialFit: "always",
    autoCreateResumeProposal: 1,
    autoCreateCoverLetterProposal: null
  }),
  {},
  "invalid automation preferences are dropped instead of becoming truthy"
);

console.log("stage-settings probes passed");
