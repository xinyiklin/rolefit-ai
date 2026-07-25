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
import { normalizeSettings } from "../settings.ts";

// ── A fresh install: every stage gets the account-backed CLI default ─────────
const fresh = seedStages({});
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
  distillProvider: "anthropic",
  distillSelectedModel: "claude-opus-4-8",
  auditProvider: "codex-cli",
  auditSelectedModel: "gpt-5.6-terra"
};
const seeded = seedStages(preSplit);
assert.equal(seeded.tailor.provider, "openai", "Tailor keeps its own persisted provider");
assert.equal(seeded.distill.provider, "anthropic", "Distill keeps its own persisted provider");
assert.equal(seeded.review.provider, "codex-cli", "Review keeps its own persisted provider");
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
// normalizeSettings must never ADD a stage key: workspaceBackupContract accepts a
// restored settings bag only if it round-trips through normalizeSettings
// unchanged, so an additive migration there rejects every older backup. Seeding
// is where inheritance belongs, and it is proven above.
const flattened = stageFieldsToPersist(seeded);
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

console.log("stage-settings probes passed");
