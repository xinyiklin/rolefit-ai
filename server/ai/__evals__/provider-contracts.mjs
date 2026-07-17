// Deterministic provider/CLI request contracts. No network and no live model
// calls: OpenAI dispatch is exercised with an injected fake fetch.
import assert from "node:assert/strict";

import {
  buildAntigravityCliArgs,
  buildClaudeCliArgs,
  buildCodexCliArgs
} from "../../ai-cli/index.ts";
import {
  buildOpenAiCompatibleHeaders,
  callOpenAiResponsesWithFetch
} from "../clients.ts";
import {
  resolveProviderRequest,
  resolveReviewOnlyProviderRequest
} from "../providers.ts";
import {
  assertUsableApplicationAnswerOutput,
  normalizeApplicationQuestions
} from "../applicationAnswers.ts";

const ENV_KEYS = [
  "AI_API_KEY", "AI_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY",
  "OPENROUTER_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY", "MISTRAL_API_KEY",
  "OPENAI_COMPATIBLE_API_KEY", "LOCAL_AI_API_KEY"
];
const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
for (const key of ENV_KEYS) delete process.env[key];

try {
  assert.throws(
    () => resolveProviderRequest({ provider: "opneai", model: "gpt-test" }),
    /Unknown AI provider/,
    "an explicit provider typo must not silently become OpenAI"
  );

  process.env.OPENAI_API_KEY = "openai-only-test-key";
  assert.throws(
    () => resolveProviderRequest({ provider: "anthropic", model: "claude-test" }),
    /Add an API key/,
    "OPENAI_API_KEY must not authenticate Anthropic"
  );
  assert.throws(
    () => resolveProviderRequest({ provider: "openrouter", model: "model-test" }),
    /Add an API key/,
    "OPENAI_API_KEY must not authenticate OpenRouter"
  );

  const review = resolveReviewOnlyProviderRequest({
    provider: "openai",
    apiKey: "",
    model: "gpt-test",
    auditProvider: "claude-cli",
    auditModel: "claude-test",
    auditReasoningEffort: "low"
  });
  assert.equal(review.provider, "claude-cli", "review-only resolves the audit namespace directly");
  assert.equal(review.model, "claude-test");

  const local = resolveProviderRequest({
    provider: "local",
    apiKey: "",
    apiBaseUrl: "http://127.0.0.1:11434/v1",
    model: "llama-test"
  });
  assert.equal(local.apiKey, "", "loopback local inference may omit a key and never inherits OPENAI_API_KEY");
  assert.throws(
    () => resolveProviderRequest({
      provider: "local",
      apiKey: "",
      apiBaseUrl: "https://models.example/v1",
      model: "llama-test"
    }),
    /Add an API key/,
    "a remote compatible endpoint still requires a key"
  );
  assert.deepEqual(buildOpenAiCompatibleHeaders(""), { "Content-Type": "application/json" });
  delete process.env.OPENAI_API_KEY;

  process.env.AI_PROVIDER = "opneai";
  assert.throws(
    () => resolveProviderRequest({}),
    /Unknown AI_PROVIDER/,
    "an invalid configured default fails closed"
  );
  delete process.env.AI_PROVIDER;

  let captured = null;
  const fakeFetch = async (input, init) => {
    captured = { input: String(input), init };
    return new Response(JSON.stringify({ output_text: '{"ok":true}' }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const parsed = await callOpenAiResponsesWithFetch({
    apiKey: "test-key",
    model: "gpt-test",
    systemPrompt: "system",
    userPrompt: "user"
  }, fakeFetch);
  assert.deepEqual(parsed, { ok: true });
  assert.equal(captured.input, "https://api.openai.com/v1/responses");
  assert.equal(JSON.parse(captured.init.body).store, false, "Responses requests opt out of storage");

  const claude = buildClaudeCliArgs({ model: "claude-test", reasoningEffort: "low", systemPrompt: "system" });
  assert(claude.includes("--no-session-persistence"));
  assert.equal(claude[claude.indexOf("--tools") + 1], "", "Claude tools remain disabled");
  assert.equal(claude[claude.indexOf("--setting-sources") + 1], "", "Claude does not load user/project settings");
  assert(claude.includes("--strict-mcp-config"), "Claude ignores ambient MCP configuration");

  const codex = buildCodexCliArgs({ model: "gpt-test", reasoningEffort: "medium" }, "/tmp/rolefit-test", "/tmp/rolefit-test/out");
  for (const flag of ["--ephemeral", "--ignore-user-config", "--ignore-rules", "-C"]) {
    assert(codex.includes(flag), `Codex invocation carries ${flag}`);
  }
  assert.equal(codex[codex.indexOf("-C") + 1], "/tmp/rolefit-test");

  const agy = buildAntigravityCliArgs({ model: "Gemini Test" });
  assert(agy.includes("--sandbox"), "Antigravity runs with terminal restrictions");

  const normalizedQuestions = normalizeApplicationQuestions([
    "x".repeat(1_000),
    ...Array.from({ length: 20 }, (_, index) => `Question ${index}?`)
  ]);
  assert.equal(normalizedQuestions.length, 12);
  assert(normalizedQuestions.every((question) => question.length <= 400));
  assert(normalizedQuestions.reduce((sum, question) => sum + question.length, 0) <= 4_800);
  assert.throws(
    () => assertUsableApplicationAnswerOutput(["Why this role?"], false, [], []),
    /usable application answers/
  );
  assert.throws(
    () => assertUsableApplicationAnswerOutput(["Why this role?", "Why this company?"], false, [{ answer: "One" }], []),
    /usable application answers/,
    "a partial answer list cannot satisfy the server-owned question list"
  );
  assert.throws(
    () => assertUsableApplicationAnswerOutput([], true, [], []),
    /usable role descriptions/
  );

  console.log("provider/CLI contracts: PASS");
} finally {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
