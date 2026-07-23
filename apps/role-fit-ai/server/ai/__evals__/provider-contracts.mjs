// Deterministic provider/CLI request contracts. No network and no live model
// calls: OpenAI dispatch is exercised with an injected fake fetch.
import assert from "node:assert/strict";

import {
  buildAntigravityCliArgs,
  buildClaudeCliArgs,
  buildCodexCliArgs,
  classifyClaudeFailure
} from "../../ai-cli/index.ts";
import {
  buildAnthropicMessagesBody,
  callConfiguredProvider,
  callOpenAiResponsesWithFetch
} from "../clients.ts";
import {
  resolveAuditProviderRequest,
  resolveProviderRequest,
  resolveReviewOnlyProviderRequest
} from "../providers.ts";
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
  providerOptions
} from "../../../src/config/aiOptions.ts";

const ENV_KEYS = [
  "AI_PROVIDER", "AI_MODEL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
  "OPENAI_MODEL", "ANTHROPIC_MODEL", "CLAUDE_CLI_MODEL", "CODEX_CLI_MODEL", "ANTIGRAVITY_CLI_MODEL"
];
const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
for (const key of ENV_KEYS) delete process.env[key];

try {
  assert.deepEqual(
    providerOptions.map(({ value }) => value),
    ["claude-cli", "codex-cli", "antigravity-cli", "openai", "anthropic"],
    "only the three verified CLIs and two native APIs are exposed"
  );
  assert(
    Object.values(modelOptionsByProvider).flat().every(({ value }) => value !== "custom"),
    "unverified custom model ids stay out of every provider menu"
  );
  assert.deepEqual(
    modelOptionsByProvider["claude-cli"].map(({ value, label }) => [value, label]),
    [
      ["claude-fable-5", "Fable 5"],
      ["claude-sonnet-5", "Sonnet 5"],
      ["claude-sonnet-4-6", "Sonnet 4.6"],
      ["claude-opus-4-8", "Opus 4.8"],
      ["claude-opus-4-7", "Opus 4.7"],
      ["claude-opus-4-6", "Opus 4.6"],
      ["claude-haiku-4-5", "Haiku 4.5"]
    ],
    "Claude CLI exposes every current or still-available concrete model with concise labels"
  );
  assert.deepEqual(
    cliReasoningEffortOptionsFor("codex-cli", "gpt-5.6-sol")?.map(({ value }) => value),
    ["low", "medium", "high", "xhigh", "max", "ultra"]
  );
  assert.deepEqual(
    cliReasoningEffortOptionsFor("codex-cli", "gpt-5.6-luna")?.map(({ value }) => value),
    ["low", "medium", "high", "xhigh", "max"]
  );

  const defaults = resolveProviderRequest({});
  assert.equal(defaults.provider, "claude-cli");
  assert.equal(defaults.model, "claude-sonnet-5", "headless Claude CLI uses a current concrete installed model id");
  process.env.AI_MODEL = "headless-model-override";
  assert.equal(
    resolveProviderRequest({}).model,
    "headless-model-override",
    "AI_MODEL overrides actual dispatch on the documented headless/default path"
  );
  assert.equal(
    resolveProviderRequest({ provider: "claude-cli" }).model,
    "claude-sonnet-5",
    "an explicit provider uses its provider-specific default instead of a global headless override"
  );
  delete process.env.AI_MODEL;

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
  assert.throws(
    () => resolveReviewOnlyProviderRequest({
      auditProvider: "openai",
      auditApiKey: "request-body-only-audit-key",
      auditModel: "gpt-test"
    }),
    (error) => error?.status === 401 && /RoleFit Companion/.test(error.message),
    "a request-body auditApiKey cannot authenticate a standalone review request"
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
    (error) => error?.status === 409 && /Reconnect Codex CLI in RoleFit Companion/.test(error.message),
    "a configured but unready companion CLI fails with actionable recovery"
  );
  process.env.ANTHROPIC_API_KEY = "headless-key-must-not-bypass-companion";
  assert.throws(
    () => resolveProviderRequest({ provider: "anthropic", model: "claude-test" }),
    (error) => error?.status === 409 && /Add Claude in RoleFit Companion/.test(error.message),
    "an absent companion provider fails even when a headless .env key exists"
  );
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(
    resolveReviewOnlyProviderRequest({
      auditProvider: "openai",
      auditApiKey: "request-body-audit-key-must-not-override-vault",
      auditModel: "gpt-test"
    }).apiKey,
    "synthetic-managed-openai-key",
    "review-only resolution ignores auditApiKey and uses the companion vault"
  );
  const managedPrimary = resolveProviderRequest({
    provider: "claude-cli",
    model: "claude-test"
  });
  assert.equal(
    resolveAuditProviderRequest({
      auditProvider: "openai",
      auditApiKey: "request-body-audit-key-must-not-override-vault",
      auditModel: "gpt-test"
    }, managedPrimary).apiKey,
    "synthetic-managed-openai-key",
    "independent-review resolution also ignores request-body auditApiKey"
  );
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

  const sonnetBody = buildAnthropicMessagesBody({
    model: "claude-sonnet-5",
    systemPrompt: "system",
    userPrompt: "user"
  });
  assert.deepEqual(sonnetBody.thinking, { type: "disabled" }, "Sonnet 5 preserves bounded no-thinking behavior explicitly");
  assert.equal("temperature" in sonnetBody, false, "Claude requests omit unsupported sampling parameters");
  const fableBody = buildAnthropicMessagesBody({ model: "claude-fable-5", systemPrompt: "system", userPrompt: "user" });
  assert.equal("thinking" in fableBody, false, "models with always-on adaptive thinking are not sent an invalid disable flag");

  const claude = buildClaudeCliArgs({ model: "claude-test", reasoningEffort: "low", systemPrompt: "system" });
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

  const agy = buildAntigravityCliArgs({ model: "Gemini Test", userPrompt: "Return JSON" });
  assert(agy.includes("--sandbox"), "Antigravity runs with terminal restrictions");
  assert.equal(agy[agy.indexOf("-p") + 1], "Return JSON", "Antigravity receives the print prompt as -p's required value");
  assert.equal(agy[agy.indexOf("--print-timeout") + 1], "230s", "Antigravity has an internal timeout below the server timeout");

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
  assert.throws(
    () => bindApplicationAnswers(
      [{
        questionId: "question-1",
        question: "Why this role?",
        answer: "I built Python APIs that prevented outages and protected revenue."
      }],
      ["Why this role?"],
      "This role needs Python backend APIs.",
      "Built Python APIs for internal services."
    ),
    /unsupported claim/,
    "ordinary-language fabricated outcomes are withheld from application answers"
  );
  assert.throws(
    () => bindApplicationAnswers(
      [{
        questionId: "question-1",
        question: "Why this role?",
        answer: "I would bring Salesforce administration alongside my Python background."
      }],
      ["Why this role?"],
      "This role needs Python backend APIs.",
      "Built Python APIs for internal services."
    ),
    /unsupported claim/,
    "a curated technology absent from both the JD and candidate evidence is withheld"
  );
  assert.throws(
    () => bindApplicationAnswers(
      [{
        questionId: "question-1",
        question: "Why this role?",
        answer: "I led a platform redesign at FabricatedCorp and would bring that experience here."
      }],
      ["Why this role?"],
      "Acme needs Python backend API experience.",
      "Built Python APIs for internal services."
    ),
    /unsupported claim/,
    "an invented mid-sentence employer proper name is withheld"
  );
  assert.throws(
    () => bindApplicationAnswers(
      [{
        questionId: "question-1",
        question: "Why this role?",
        answer: "Fabricated led a platform redesign."
      }],
      ["Why this role?"],
      "Acme needs Python backend API experience.",
      "Built Python APIs for internal services."
    ),
    /unsupported claim/,
    "an unsupported single TitleCase company used as the sentence subject is withheld"
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
  assert.throws(
    () => bindApplicationRoleDescriptions([
      { roleId: "role-1", description: "Built Kubernetes services for production." },
      { roleId: "role-2", description: "Deployed Kubernetes services for production." }
    ], roles, "Kubernetes experience preferred."),
    /unsupported claim/,
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
