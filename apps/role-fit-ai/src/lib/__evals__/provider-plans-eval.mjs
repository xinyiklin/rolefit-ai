// Plan and transport rewrite stage settings once; their shown state is derived.
import assert from "node:assert/strict";

import { AI_STAGE_IDS } from "../../config/aiStages.ts";
import { providerOption } from "../../config/aiOptions.ts";
import {
  applyProviderPlan,
  currentPlan,
  preferredTransport,
  switchVendorTransport,
  vendorTransport
} from "../providerPlans.ts";
import { PROVIDER_PLANS, seedStage, seedStages } from "../stageSettings.ts";

const CLI = { claude: "cli", openai: "cli" };
const fresh = seedStages({});
assert.equal(currentPlan(fresh), "hybrid", "fresh settings are the Hybrid plan");
assert.equal(vendorTransport(fresh, "claude"), "cli");
assert.equal(vendorTransport(fresh, "openai"), "cli");

for (const plan of Object.keys(PROVIDER_PLANS)) {
  const { stages, adjusted } = applyProviderPlan(plan, CLI);
  assert.deepEqual(stages, PROVIDER_PLANS[plan], `${plan} on CLI writes the plan exactly`);
  assert.equal(adjusted, 0);
  assert.equal(currentPlan(stages), plan, `${plan} reads back as itself`);
  const api = applyProviderPlan(plan, { claude: "api", openai: "api" });
  assert.equal(currentPlan(api.stages), plan, `${plan} on the APIs is still the same plan`);
  for (const stage of AI_STAGE_IDS) assert.equal(providerOption(api.stages[stage].provider).transport, "api");
}
assert.equal(vendorTransport(applyProviderPlan("claude", CLI).stages, "openai"), "unused", "Claude only leaves OpenAI unused");

// Switching transport keeps each stage's model and effort; Codex Ultra steps down to Max.
const ultra = { ...fresh, "resume-polish": { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "ultra" } };
const onApi = switchVendorTransport(ultra, "openai", "api");
assert.deepEqual(onApi.stages["resume-polish"], { provider: "openai", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "max" });
assert.equal(onApi.adjusted, 1, "the stepped-down effort is reported");
assert.deepEqual(onApi.stages["cover-polish"], { ...fresh["cover-polish"], provider: "openai" });
for (const stage of AI_STAGE_IDS) {
  if (providerOption(fresh[stage].provider).vendor === "claude") assert.deepEqual(onApi.stages[stage], ultra[stage], "the other vendor is untouched");
}
assert.equal(vendorTransport(onApi.stages, "openai"), "api");
const back = switchVendorTransport(onApi.stages, "openai", "cli");
assert.equal(back.adjusted, 0);
assert.equal(back.stages["resume-polish"].cliReasoningEffort, "max", "a stepped-down effort is not silently raised again");
const roundTrip = switchVendorTransport(switchVendorTransport(fresh, "openai", "api").stages, "openai", "cli").stages;
assert.deepEqual(roundTrip, fresh, "a round trip through the API restores the exact settings");

const mixed = { ...fresh, "job-analysis": { ...fresh["job-analysis"], provider: "anthropic" } };
assert.equal(vendorTransport(mixed, "claude"), "mixed");
assert.equal(currentPlan(mixed), "hybrid", "the plan names vendor, model, and effort, not transport");
assert.equal(currentPlan({ ...fresh, "job-analysis": { ...fresh["job-analysis"], cliReasoningEffort: "high" } }), "custom");

// A plan keeps a vendor's current transport while that provider is added.
assert.equal(preferredTransport(onApi.stages, "openai", new Set(["openai", "codex-cli"])), "api");
assert.equal(preferredTransport(onApi.stages, "openai", new Set(["codex-cli"])), "cli", "an unadded transport yields to an added one");
assert.equal(preferredTransport(fresh, "claude", new Set(["anthropic"])), "api");
assert.equal(preferredTransport(fresh, "claude", new Set()), "cli", "nothing added defaults to CLI");

// A row moved to a vendor seeds that vendor's recommendation on either transport.
assert.deepEqual(
  seedStage("resume-polish", { resumePolishProvider: "anthropic" }),
  { provider: "anthropic", selectedModel: PROVIDER_PLANS.claude["resume-polish"].selectedModel, cliReasoningEffort: PROVIDER_PLANS.claude["resume-polish"].cliReasoningEffort }
);
assert.deepEqual(
  seedStage("job-analysis", { jobAnalysisProvider: "openai" }),
  { ...PROVIDER_PLANS.openai["job-analysis"], provider: "openai" }
);

console.log("provider-plans probes passed");
