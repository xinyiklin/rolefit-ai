// Deterministic provider/CLI request contracts. No network and no live model
// calls: OpenAI dispatch is exercised with an injected fake fetch.
import assert from "node:assert/strict";

import {
  buildClaudeCliArgs,
  buildCodexCliArgs,
  classifyClaudeFailure
} from "../../ai-cli/index.ts";
import {
  buildAnthropicMessagesBody,
  buildOpenAiResponsesBody,
  callConfiguredProvider,
  callOpenAiResponsesWithFetch
} from "../clients.ts";
import { resolveProviderRequest } from "../providers.ts";
import { reconcileCliReasoningEffort } from "../../../shared/cliReasoning.ts";
import {
  applyProviderSnapshot,
  clearProviderSnapshot
} from "../../provider-connections.ts";
import {
  assertUsableApplicationAnswerOutput,
  bindApplicationAnswers,
  bindApplicationRoleDescriptions,
  normalizeApplicationQuestions,
  normalizeApplicationRoleEvidence
} from "../applicationAnswers.ts";
import {
  cliReasoningEffortOptionsFor,
  modelOptionsByProvider,
  providerOptions,
  retiredModelSuccessors
} from "../../../src/config/aiOptions.ts";

const ENV_KEYS = [
  "AI_PROVIDER", "AI_MODEL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
  "OPENAI_MODEL", "ANTHROPIC_MODEL", "CLAUDE_CLI_MODEL", "CODEX_CLI_MODEL"
];
const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
for (const key of ENV_KEYS) delete process.env[key];

try {
  assert.deepEqual(
    providerOptions.map(({ value, label }) => [value, label]),
    [["claude-cli", "Claude · CLI"], ["anthropic", "Claude · API"], ["codex-cli", "OpenAI · CLI"], ["openai", "OpenAI · API"]],
    "only the two verified CLIs and two native APIs are exposed, grouped by vendor"
  );
  assert(
    Object.values(modelOptionsByProvider).flat().every(({ value }) => value !== "custom"),
    "unverified custom model ids stay out of every provider menu"
  );
  const claudeModels = [["claude-fable-5-1", "Fable 5.1"], ["claude-opus-5-5", "Opus 5.5"], ["claude-sonnet-5-5", "Sonnet 5.5"], ["claude-haiku-5-5", "Haiku 5.5"]];
  const openAiModels = [["gpt-6-astra", "GPT-6 Astra"], ["gpt-6.1-sol", "GPT-6.1 Sol"], ["gpt-6-luna", "GPT-6 Luna"]];
  for (const [provider, expected] of [["claude-cli", claudeModels], ["anthropic", claudeModels], ["codex-cli", openAiModels], ["openai", openAiModels]]) {
    assert.deepEqual(
      modelOptionsByProvider[provider].map(({ value, label }) => [value, label]),
      expected,
      `${provider} offers only its vendor's current models, the same on CLI and API`
    );
  }
  for (const [retired, successor] of Object.entries(retiredModelSuccessors)) {
    assert(!Object.values(modelOptionsByProvider).flat().some(({ value }) => value === retired), `${retired} is no longer offered`);
    assert(Object.values(modelOptionsByProvider).flat().some(({ value }) => value === successor), `${retired} repairs to an offered model`);
  }

  const levels = (provider, model) => cliReasoningEffortOptionsFor(provider, model)?.map(({ value }) => value);
  const FULL = ["low", "medium", "high", "xhigh", "max"];
  for (const model of ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
    assert.deepEqual(levels("claude-cli", model), FULL, `${model} CLI effort`);
    assert.deepEqual(levels("anthropic", model), FULL, `${model} API effort matches the CLI`);
    assert.equal(resolveProviderRequest({ provider: "claude-cli", model, reasoningEffort: "max" }).reasoningEffort, "max");
  }
  for (const model of ["gpt-6-astra", "gpt-6.1-sol"]) {
    assert.deepEqual(levels("codex-cli", model), [...FULL, "ultra"], `${model} CLI effort includes Codex's ultra mode`);
    assert.deepEqual(levels("openai", model), FULL, `${model} API effort is the CLI scale without ultra`);
    assert.equal(resolveProviderRequest({ provider: "codex-cli", model, reasoningEffort: "ultra" }).reasoningEffort, "ultra");
  }
  assert.deepEqual(levels("codex-cli", "gpt-6-luna"), FULL);
  assert.deepEqual(levels("openai", "gpt-6-luna"), FULL);
  assert.deepEqual(levels("codex-cli", "gpt-unlisted"), ["low", "medium", "high", "xhigh"], "an unlisted OpenAI model gets the conservative effort range");
  assert.deepEqual(levels("openai", "gpt-unlisted"), ["low", "medium", "high", "xhigh"]);
  assert.equal(resolveProviderRequest({ provider: "codex-cli" }).model, "gpt-6.1-sol");
  for (const [provider, model, effort] of [
    ["codex-cli", "gpt-6-luna", "ultra"],
    ["openai", "gpt-6.1-sol", "ultra"],
    ["anthropic", "claude-sonnet-5-5", "off"]
  ]) {
    assert(!cliReasoningEffortOptionsFor(provider, model).some(({ value }) => value === effort));
    process.env.OPENAI_API_KEY = "openai-effort-test-key";
    process.env.ANTHROPIC_API_KEY = "anthropic-effort-test-key";
    assert.throws(() => resolveProviderRequest({ provider, model, reasoningEffort: effort }), /Unsupported reasoning effort/);
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  }
  assert(buildClaudeCliArgs({ model: "claude-haiku-5-5", reasoningEffort: "high" }).includes("--effort"), "Haiku 5.5 takes an effort");
  for (const model of ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"]) {
    const body = buildOpenAiResponsesBody({ model, reasoningEffort: "high", systemPrompt: "Return JSON", userPrompt: "Synthetic input" });
    assert.equal(body.model, model);
    assert.equal(body.store, false);
    assert.deepEqual(body.text, { format: { type: "json_object" } });
    assert.deepEqual(body.reasoning, { effort: "high" }, "the OpenAI API receives the stage's effort");
    assert.equal(body.max_output_tokens, 32_000, "reasoning shares a budget large enough for the highest effort");
    for (const key of ["temperature", "top_p", "top_logprobs"]) assert(!(key in body));
  }
  assert.equal("reasoning" in buildOpenAiResponsesBody({ model: "gpt-6.1-sol", reasoningEffort: "", systemPrompt: "s", userPrompt: "u" }), false);
  process.env.OPENAI_API_KEY = "openai-default-effort-key";
  process.env.ANTHROPIC_API_KEY = "anthropic-default-effort-key";
  assert.equal(resolveProviderRequest({ provider: "anthropic" }).reasoningEffort, "low", "a Claude API request without an effort takes the Claude default");
  assert.equal(resolveProviderRequest({ provider: "openai" }).reasoningEffort, "medium", "an OpenAI API request without an effort takes the OpenAI default");
  assert.equal(resolveProviderRequest({ provider: "codex-cli" }).reasoningEffort, "", "a CLI keeps its own default");
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const defaults = resolveProviderRequest({});
  assert.equal(defaults.provider, "claude-cli");
  assert.equal(defaults.model, "claude-sonnet-5-5", "headless Claude CLI uses a current concrete installed model id");
  process.env.AI_MODEL = "headless-model-override";
  assert.equal(
    resolveProviderRequest({}).model,
    "headless-model-override",
    "AI_MODEL overrides actual dispatch on the documented headless/default path"
  );
  assert.equal(
    resolveProviderRequest({ provider: "claude-cli" }).model,
    "claude-sonnet-5-5",
    "an explicit provider uses its provider-specific default instead of a global headless override"
  );
  delete process.env.AI_MODEL;

  // The browser catalog and the server fallback must name the same default per provider.
  process.env.OPENAI_API_KEY = "openai-parity-test-key";
  process.env.ANTHROPIC_API_KEY = "anthropic-parity-test-key";
  for (const option of providerOptions) {
    assert.equal(resolveProviderRequest({ provider: option.value }).model, option.model, `${option.value} default matches the browser catalog`);
  }
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(providerOptions.find(({ value }) => value === "anthropic").model, "claude-sonnet-5-5");
  assert.equal(providerOptions.find(({ value }) => value === "openai").model, "gpt-6.1-sol", "the OpenAI API default matches the CLI");
  assert.equal(reconcileCliReasoningEffort("codex-cli", "gpt-6.1-sol", "ultra"), "ultra");
  assert.equal(reconcileCliReasoningEffort("codex-cli", "gpt-6-luna", "ultra"), "medium", "an unsupported effort falls back to the provider default");

  assert.throws(
    () => resolveProviderRequest({ provider: "antigravity-cli" }),
    /Unknown AI provider/,
    "the removed Antigravity provider fails closed instead of selecting another provider"
  );
  process.env.AI_PROVIDER = "antigravity-cli";
  assert.throws(() => resolveProviderRequest({}), /Unknown AI_PROVIDER/, "a stale AI_PROVIDER=antigravity-cli fails closed");
  delete process.env.AI_PROVIDER;
  assert.throws(
    () => resolveProviderRequest({ provider: "claude-cli", model: "Gemini 3.5 Flash (High)" }),
    /Model name can only use/,
    "model names no longer accept the spaces and parentheses of Antigravity display names"
  );

  assert.throws(
    () => resolveProviderRequest({ provider: "opneai", model: "gpt-test" }),
    /Unknown AI provider/,
    "an explicit provider typo must not silently become OpenAI"
  );
  assert.throws(
    () => resolveProviderRequest({ provider: "claude-cli", model: "x".repeat(81) }),
    /Model name is too long/,
    "model ids are rejected rather than silently truncated"
  );

  process.env.OPENAI_API_KEY = "openai-only-test-key";
  assert.equal(
    resolveProviderRequest({
      provider: "openai",
      apiKey: "request-body-key-must-be-ignored",
      model: "gpt-test"
    }).apiKey,
    "openai-only-test-key",
    "standalone API dispatch uses the provider-specific .env key, never a request-body key"
  );
  assert.throws(
    () => resolveProviderRequest({ provider: "anthropic", model: "claude-test" }),
    /Add this provider in RoleFit Companion/,
    "OPENAI_API_KEY must not authenticate Anthropic"
  );
  for (const removed of ["gemini", "openrouter", "groq", "together", "mistral", "local", "openai-compatible"]) {
    assert.throws(
      () => resolveProviderRequest({ provider: removed, model: "model-test" }),
      /Unknown AI provider/,
      `${removed} must stay unavailable until it has a supported, verified adapter`
    );
  }

  delete process.env.OPENAI_API_KEY;
  assert.throws(
    () => resolveProviderRequest({
      provider: "openai",
      apiKey: "request-body-only-key",
      model: "gpt-test"
    }),
    (error) => error?.status === 401 && /RoleFit Companion/.test(error.message),
    "a request-body apiKey cannot authenticate a standalone hosted-provider request"
  );
  applyProviderSnapshot({
    type: "rolefit-provider-snapshot",
    schemaVersion: 1,
    providers: [
      {
        id: "claude-cli",
        kind: "cli",
        configured: true,
        ready: true,
        authState: "signed-in",
        guidance: "Claude Code is connected through its local CLI session."
      },
      {
        id: "codex-cli",
        kind: "cli",
        configured: true,
        ready: false,
        authState: "signed-out",
        guidance: "Codex CLI needs sign-in through the companion."
      },
      {
        id: "openai",
        kind: "api",
        configured: true,
        ready: true,
        authState: "not-applicable",
        guidance: "OpenAI API access is stored securely on this device."
      }
    ],
    credentials: { openai: "synthetic-managed-openai-key" }
  });
  assert.equal(
    resolveProviderRequest({
      provider: "openai",
      apiKey: "request-body-key-must-not-override-vault",
      model: "gpt-test"
    }).apiKey,
    "synthetic-managed-openai-key",
    "native API dispatch resolves the companion-managed in-memory credential"
  );
  assert.equal(
    resolveProviderRequest({ provider: "claude-cli", model: "claude-test" }).provider,
    "claude-cli",
    "a configured ready CLI remains available on a companion-managed server"
  );
  assert.throws(
    () => resolveProviderRequest({ provider: "codex-cli", model: "gpt-test" }),
    (error) => error?.status === 409 && /Reconnect OpenAI · CLI in RoleFit Companion/.test(error.message),
    "a configured but unready companion CLI fails with actionable recovery"
  );
  process.env.ANTHROPIC_API_KEY = "headless-key-must-not-bypass-companion";
  assert.throws(
    () => resolveProviderRequest({ provider: "anthropic", model: "claude-test" }),
    (error) => error?.status === 409 && /Add Claude · API in RoleFit Companion/.test(error.message),
    "an absent companion provider fails even when a headless .env key exists"
  );
  delete process.env.ANTHROPIC_API_KEY;
  clearProviderSnapshot();

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
  const requestController = new AbortController();
  const parsed = await callOpenAiResponsesWithFetch({
    apiKey: "test-key",
    model: "gpt-test",
    systemPrompt: "system",
    userPrompt: "user",
    signal: requestController.signal
  }, fakeFetch);
  assert.deepEqual(parsed, { ok: true });
  assert.equal(captured.input, "https://api.openai.com/v1/responses");
  assert.equal(captured.init.signal, requestController.signal, "request cancellation reaches hosted-provider fetch");
  assert.equal(JSON.parse(captured.init.body).store, false, "Responses requests opt out of storage");

  for (const [upstreamStatus, expectedStatus] of [
    [401, 401], [403, 401], [429, 429], [408, 504], [504, 504],
    [413, 413], [400, 400], [404, 400], [500, 502]
  ]) {
    await assert.rejects(
      () => callOpenAiResponsesWithFetch({
        apiKey: "test-key", model: "gpt-test", systemPrompt: "system", userPrompt: "user"
      }, async () => new Response(JSON.stringify({ error: { code: "synthetic", type: "probe" } }), {
        status: upstreamStatus,
        headers: { "Content-Type": "application/json" }
      })),
      (error) => error?.status === expectedStatus,
      `upstream ${upstreamStatus} maps to safe local ${expectedStatus}`
    );
  }
  await assert.rejects(
    () => callOpenAiResponsesWithFetch({
      apiKey: "test-key", model: "gpt-test", systemPrompt: "system", userPrompt: "user"
    }, async () => new Response("x".repeat(2_000_001), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })),
    /too much data/,
    "hosted-provider response bodies are byte-bounded"
  );

  // Symmetric to the OpenAI injected-fetch block above, for the Anthropic
  // client. callAnthropicMessages is not exported and (unlike the OpenAI helper)
  // has no injected-fetch parameter, so it is driven end-to-end through the real
  // dispatch (callConfiguredProvider -> anthropic) with globalThis.fetch stubbed
  // — fully offline, no product-code seam added. Confirms the shared
  // status-mapping + byte cap apply to the Anthropic path and that an upstream
  // error body never leaks into the thrown, user-safe error.
  const realFetch = globalThis.fetch;
  try {
    const LEAK = "SECRET_UPSTREAM_LEAK_MARKER";
    const callAnthropicWith = (fetchImpl) => {
      globalThis.fetch = fetchImpl;
      return callConfiguredProvider({
        provider: "anthropic",
        model: "claude-test",
        apiKey: "test-key",
        systemPrompt: "system",
        userPrompt: "user"
      });
    };
    for (const [upstreamStatus, expectedStatus] of [
      [401, 401], [403, 401], [429, 429], [408, 504], [504, 504],
      [413, 413], [400, 400], [404, 400], [500, 502]
    ]) {
      await assert.rejects(
        () => callAnthropicWith(async () => new Response(
          JSON.stringify({ type: "error", error: { type: "probe", message: `${LEAK} do not surface this` } }),
          { status: upstreamStatus, headers: { "Content-Type": "application/json" } }
        )),
        (error) => error?.status === expectedStatus && !error.message.includes(LEAK),
        `Anthropic upstream ${upstreamStatus} maps to safe local ${expectedStatus} without leaking the body`
      );
    }
    await assert.rejects(
      () => callAnthropicWith(async () => new Response("x".repeat(2_000_001), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })),
      (error) => error?.status === 502 && /too much data/.test(error.message),
      "Anthropic response bodies are byte-bounded"
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  for (const model of ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
    for (const effort of FULL) {
      const body = buildAnthropicMessagesBody({ model, reasoningEffort: effort, systemPrompt: "system", userPrompt: "user" });
      assert.deepEqual(body.thinking, { type: "adaptive" }, `${model} thinks adaptively, as Claude Code does`);
      assert.deepEqual(body.output_config, { effort }, `${model} receives the stage's effort`);
      assert.equal(body.max_tokens, 32_000);
      for (const key of ["temperature", "top_p", "top_k"]) assert(!(key in body));
    }
    const args = buildClaudeCliArgs({ model, reasoningEffort: "max" });
    assert.equal(args[args.indexOf("--model") + 1], model);
    assert.equal(args[args.indexOf("--effort") + 1], "max");
  }
  assert.equal("output_config" in buildAnthropicMessagesBody({ model: "claude-sonnet-5-5", reasoningEffort: "", systemPrompt: "s", userPrompt: "u" }), false);

  const claude = buildClaudeCliArgs({ model: "claude-test", reasoningEffort: "low" }, "/tmp/rolefit-test/system-prompt.txt");
  assert.equal(
    claude[claude.indexOf("--append-system-prompt-file") + 1],
    "/tmp/rolefit-test/system-prompt.txt",
    "Claude reads its system prompt from a private file, never from argv"
  );
  assert(claude.includes("--no-session-persistence"));
  assert.equal(claude[claude.indexOf("--tools") + 1], "", "Claude tools remain disabled");
  assert.equal(claude[claude.indexOf("--setting-sources") + 1], "", "Claude does not load user/project settings");
  assert(claude.includes("--strict-mcp-config"), "Claude ignores ambient MCP configuration");
  assert.equal(
    claude[claude.indexOf("--mcp-config") + 1],
    '{"mcpServers":{}}',
    "Claude receives the current valid empty MCP configuration schema"
  );

  const claudeStderrAuth = classifyClaudeFailure("", {
    stderr: "Not logged in. Please run /login.",
    message: "claude exited with code 1"
  });
  assert.equal(claudeStderrAuth.status, 401, "Claude stderr participates in private auth classification");
  assert.equal(
    classifyClaudeFailure(JSON.stringify({ api_error_status: 401, result: "Unauthorized" })).status,
    401,
    "Claude authentication failures retain their HTTP category"
  );
  assert.equal(
    classifyClaudeFailure("", { timedOut: true, message: "claude timed out" }).status,
    504,
    "Claude timeouts retain their HTTP category"
  );
  assert.equal(
    classifyClaudeFailure("", { message: "claude exited with code 1" }).status,
    500,
    "unclassified Claude failures are no longer mislabeled as configuration errors"
  );

  const codex = buildCodexCliArgs({ model: "gpt-test", reasoningEffort: "medium" }, "/tmp/rolefit-test", "/tmp/rolefit-test/out");
  for (const flag of ["--ephemeral", "--ignore-user-config", "--ignore-rules", "-C"]) {
    assert(codex.includes(flag), `Codex invocation carries ${flag}`);
  }
  assert.equal(codex[codex.indexOf("-C") + 1], "/tmp/rolefit-test");
  const sol61 = buildCodexCliArgs({ model: "gpt-6.1-sol", reasoningEffort: "ultra" }, "/tmp/rolefit-test", "/tmp/rolefit-test/out");
  assert.equal(sol61[sol61.indexOf("--model") + 1], "gpt-6.1-sol");
  assert.equal(sol61[sol61.indexOf("-c") + 1], 'model_reasoning_effort="ultra"', "GPT-6.1 Sol passes its catalog-listed Ultra effort");
  const sonnet55Args = buildClaudeCliArgs({ model: "claude-sonnet-5-5", reasoningEffort: "low" });
  assert.equal(sonnet55Args[sonnet55Args.indexOf("--model") + 1], "claude-sonnet-5-5");
  assert.equal(sonnet55Args[sonnet55Args.indexOf("--effort") + 1], "low", "Sonnet 5.5 keeps RoleFit's bounded CLI default effort");


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

  const boundAnswers = bindApplicationAnswers(
    [{ questionId: "question-1", question: "Why this role?", answer: "I built Python APIs that match the role's backend focus." }],
    ["Why this role?"],
    "This role needs Python backend APIs.",
    "Built Python APIs for internal services."
  );
  assert.equal(boundAnswers[0].question, "Why this role?");
  assert.match(
    bindApplicationAnswers(
      [{
        questionId: "question-1",
        question: "Why this role?",
        answer: "I built Python APIs that prevented outages and protected revenue."
      }],
      ["Why this role?"],
      "This role needs Python backend APIs.",
      "Built Python APIs for internal services."
    )[0].warnings?.join(" ") ?? "",
    /Not supported by provided evidence/,
    "ordinary-language fabricated outcomes remain visible with warnings"
  );
  assert.match(
    bindApplicationAnswers(
      [{
        questionId: "question-1",
        question: "Why this role?",
        answer: "I would bring Salesforce administration alongside my Python background."
      }],
      ["Why this role?"],
      "This role needs Python backend APIs.",
      "Built Python APIs for internal services."
    )[0].warnings?.join(" ") ?? "",
    /Not supported by provided evidence/,
    "a curated technology absent from both the JD and candidate evidence is warned"
  );
  assert.match(
    bindApplicationAnswers(
      [{
        questionId: "question-1",
        question: "Why this role?",
        answer: "I led a platform redesign at FabricatedCorp and would bring that experience here."
      }],
      ["Why this role?"],
      "Acme needs Python backend API experience.",
      "Built Python APIs for internal services."
    )[0].warnings?.join(" ") ?? "",
    /Not supported by provided evidence/,
    "an invented mid-sentence employer proper name is warned"
  );
  assert.match(
    bindApplicationAnswers(
      [{
        questionId: "question-1",
        question: "Why this role?",
        answer: "Fabricated led a platform redesign."
      }],
      ["Why this role?"],
      "Acme needs Python backend API experience.",
      "Built Python APIs for internal services."
    )[0].warnings?.join(" ") ?? "",
    /Not supported by provided evidence/,
    "an unsupported single TitleCase company used as the sentence subject is warned"
  );
  const targetCompanyAnswer = bindApplicationAnswers(
    [{
      questionId: "question-1",
      question: "Why Acme?",
      answer: "Acme interests me because the role matches my Python API experience."
    }],
    ["Why Acme?"],
    "Acme needs Python backend API experience.",
    "Built Python APIs for internal services."
  );
  assert.equal(
    targetCompanyAnswer[0].answer,
    "Acme interests me because the role matches my Python API experience.",
    "a target company grounded in the JD remains valid, including at sentence start"
  );
  const placeholderAnswer = bindApplicationAnswers(
    [{
      questionId: "question-1",
      question: "Why Acme?",
      answer: "I am interested in this role. [add: Your specific reason for Acme]"
    }],
    ["Why Acme?"],
    "Acme needs Python backend API experience.",
    "Built Python APIs for internal services."
  );
  assert.equal(
    placeholderAnswer[0].answer,
    "I am interested in this role. [add: Your specific reason for Acme]",
    "prompt-required placeholder contents are not treated as factual proper-name claims"
  );
  const grammaticalStarters = bindApplicationAnswers(
    [
      {
        questionId: "question-1",
        question: "Summarize your experience.",
        answer: "Over the past several years, I built Python APIs."
      },
      {
        questionId: "question-2",
        question: "What else should we know?",
        answer: "Additionally, I built Python APIs for internal services."
      }
    ],
    ["Summarize your experience.", "What else should we know?"],
    "Acme needs Python backend API experience.",
    "Built Python APIs for internal services over several years."
  );
  assert.deepEqual(
    grammaticalStarters.map(({ answer }) => answer),
    [
      "Over the past several years, I built Python APIs.",
      "Additionally, I built Python APIs for internal services."
    ],
    "ordinary sentence-leading transitions are not misclassified as proper names"
  );
  assert.throws(
    () => bindApplicationAnswers(
      [
        { questionId: "question-2", question: "Why this company?", answer: "Second answer" },
        { questionId: "question-1", question: "Why this role?", answer: "First answer" }
      ],
      ["Why this role?", "Why this company?"],
      "Backend role at Acme.",
      "Backend experience."
    ),
    /usable application answers/,
    "reordered answer objects fail instead of being assigned by array index"
  );
  assert.throws(
    () => bindApplicationAnswers(
      [
        { questionId: "question-1", question: "Why this role?", answer: "First answer" },
        { questionId: "question-1", question: "Why this company?", answer: "Duplicate id answer" }
      ],
      ["Why this role?", "Why this company?"],
      "Backend role at Acme.",
      "Backend experience."
    ),
    /usable application answers/,
    "duplicate answer ids fail closed"
  );

  const roleResume = `EXPERIENCE
Software Engineer | Acme | 2022 - Present
- Built React interfaces for patient scheduling.
Platform Engineer | Beta | 2020 - 2022
- Deployed Kubernetes services for production.`;
  const roles = normalizeApplicationRoleEvidence([
    { label: "Software Engineer | Acme | 2022 - Present", bullets: ["Built React interfaces for patient scheduling."] },
    { label: "Platform Engineer | Beta | 2020 - 2022", bullets: ["Deployed Kubernetes services for production."] },
    { label: "Invented Role | Fabricated Corp", bullets: ["Made things up."] }
  ], roleResume);
  assert.deepEqual(roles.map(({ id, label }) => ({ id, label })), [
    { id: "role-1", label: "Software Engineer | Acme | 2022 - Present" },
    { id: "role-2", label: "Platform Engineer | Beta | 2020 - 2022" }
  ], "role evidence is resume-grounded and receives server-owned ids");
  const roleDescriptions = bindApplicationRoleDescriptions([
    { roleId: "role-1", description: "Built React interfaces for patient scheduling." },
    { roleId: "role-2", description: "Deployed Kubernetes services for production." }
  ], roles, "React and Kubernetes experience preferred.");
  assert.equal(roleDescriptions[0].role, "Software Engineer | Acme | 2022 - Present");
  assert.match(
    bindApplicationRoleDescriptions([
      { roleId: "role-1", description: "Built Kubernetes services for production." },
      { roleId: "role-2", description: "Deployed Kubernetes services for production." }
    ], roles, "Kubernetes experience preferred.")[0].warnings?.join(" ") ?? "",
    /Not supported by provided evidence/,
    "a technology grounded under another employer cannot move into this role description"
  );

  console.log("provider/CLI contracts: PASS");
} finally {
  clearProviderSnapshot();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
