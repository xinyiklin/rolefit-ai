// Provider API clients + the dispatch that routes a built {systemPrompt,
// userPrompt} pair to the configured provider (hosted API or subscription CLI)
// and returns parsed JSON. Single source of truth for outbound AI calls,
// shared by /api/polish and /api/application-answers.

import { callAntigravityCli, callClaudeCli, callCodexCli } from "../ai-cli/index.mjs";
import { fetchWithTimeout } from "../http.mjs";
import { chatCompletionsEndpoint } from "../network.mjs";
import { UserSafeAiError } from "./errors.mjs";
import { parseAiJson } from "./json.mjs";
import { providerLabel } from "./providers.mjs";

const OUTPUT_TOKEN_LIMIT = 8192;

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;

  return (
    response.output
      ?.flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

function extractChatText(response) {
  const message = response.choices?.[0]?.message?.content;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    return message
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof response.choices?.[0]?.text === "string") return response.choices[0].text;
  return "";
}

function extractAnthropicText(response) {
  return (
    response.content
      ?.map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

function extractGeminiText(response) {
  return (
    response.candidates?.[0]?.content?.parts
      ?.map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

function providerErrorDebug(data) {
  const error = data?.error ?? data;
  return {
    code: typeof error?.code === "string" ? error.code : undefined,
    type: typeof error?.type === "string" ? error.type : undefined
  };
}

function providerRequestFailed(provider, response, data) {
  console.warn("[ai] provider request failed", {
    provider,
    status: response.status,
    ...providerErrorDebug(data)
  });
  throw new UserSafeAiError(
    `${providerLabel(provider)} request failed. Check the selected model, API key, and account access, then try again.`,
    502
  );
}

function isMaxTokenFinishReason(reason) {
  // "max_output_tokens" is the OpenAI Responses API's incomplete_details.reason
  // for output truncation; without it the actionable "shorten / larger model"
  // error never fires for that provider. The other providers use distinct
  // reasons (length / max_tokens / MAX_TOKENS / stop_reason), so this is inert
  // for them.
  return ["length", "max_tokens", "MAX_TOKENS", "max_output_tokens"].includes(String(reason ?? ""));
}

// Turn a truncated reply (the model hit its output-token limit) into a clear,
// actionable error. Without this, a half-written JSON body fails downstream with
// a generic "could not read" message that hides the real cause.
function assertNotTruncated(provider, truncated) {
  if (truncated) {
    throw new UserSafeAiError(
      `${providerLabel(provider)} cut its response off at the output-token limit before the JSON finished. Try again, shorten the resume or job text, or pick a model with a larger output limit.`,
      502
    );
  }
}

function chatProviderSupportsJsonMode(provider) {
  return provider !== "local";
}

function jsonModeUnsupported(response, data) {
  if (![400, 422].includes(response.status)) return false;
  const error = data?.error ?? data;
  const message = String(error?.message ?? error?.code ?? error?.type ?? "");
  return /response[_\s-]?format|responsemime|json/i.test(message);
}

async function callOpenAiResponses({ apiKey, model, systemPrompt, userPrompt }) {
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      instructions: systemPrompt,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: userPrompt }
          ]
        }
      ],
      text: { format: { type: "json_object" } },
      max_output_tokens: OUTPUT_TOKEN_LIMIT
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    providerRequestFailed("openai", response, data);
  }
  assertNotTruncated("openai", isMaxTokenFinishReason(data.incomplete_details?.reason));

  return parseAiJson(extractOutputText(data));
}

async function callOpenAiCompatibleChat({ provider, apiKey, apiBaseUrl, model, systemPrompt, userPrompt }) {
  const endpoint = chatCompletionsEndpoint(apiBaseUrl);
  const requestBody = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.2,
    max_tokens: OUTPUT_TOKEN_LIMIT
  };
  if (chatProviderSupportsJsonMode(provider)) {
    requestBody.response_format = { type: "json_object" };
  }

  let response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  let data = await response.json().catch(() => ({}));
  if (!response.ok && requestBody.response_format && jsonModeUnsupported(response, data)) {
    console.warn("[ai] chat provider rejected native JSON mode; retrying without response_format", {
      provider,
      status: response.status,
      ...providerErrorDebug(data)
    });
    delete requestBody.response_format;
    response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    data = await response.json().catch(() => ({}));
  }
  if (!response.ok) {
    providerRequestFailed(provider, response, data);
  }
  assertNotTruncated(provider, isMaxTokenFinishReason(data.choices?.[0]?.finish_reason));

  return parseAiJson(extractChatText(data));
}

async function callAnthropicMessages({ apiKey, model, systemPrompt, userPrompt }) {
  // No `temperature` and no trailing assistant prefill: both return a 400 on the
  // current Anthropic models this app offers — `temperature` is removed on Opus
  // 4.7/4.8, and a last-assistant-turn prefill is rejected on Sonnet 4.6 and
  // Opus 4.6+. The system + user prompts already require strict JSON, and
  // parseAiJson extracts the object from the reply (fenced/prose-wrapped/raw).
  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: OUTPUT_TOKEN_LIMIT,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    providerRequestFailed("anthropic", response, data);
  }
  assertNotTruncated("anthropic", isMaxTokenFinishReason(data.stop_reason));

  return parseAiJson(extractAnthropicText(data));
}

async function callGeminiGenerateContent({ apiKey, model, systemPrompt, userPrompt }) {
  const safeModel = encodeURIComponent(model.replace(/^models\//, ""));
  const requestBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      { role: "user", parts: [{ text: userPrompt }] }
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      maxOutputTokens: OUTPUT_TOKEN_LIMIT
    }
  };
  let response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(requestBody)
  });

  let data = await response.json().catch(() => ({}));
  if (!response.ok && jsonModeUnsupported(response, data)) {
    console.warn("[ai] Gemini rejected native JSON mode; retrying without responseMimeType", {
      provider: "gemini",
      status: response.status,
      ...providerErrorDebug(data)
    });
    delete requestBody.generationConfig.responseMimeType;
    response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(requestBody)
    });
    data = await response.json().catch(() => ({}));
  }
  if (!response.ok) {
    providerRequestFailed("gemini", response, data);
  }
  assertNotTruncated("gemini", isMaxTokenFinishReason(data.candidates?.[0]?.finishReason));

  return parseAiJson(extractGeminiText(data));
}

async function dispatchProvider({ provider, model, reasoningEffort, apiKey, apiBaseUrl, systemPrompt, userPrompt }) {
  if (provider === "claude-cli") return parseAiJson(await callClaudeCli({ model, reasoningEffort, systemPrompt, userPrompt }));
  if (provider === "codex-cli") return parseAiJson(await callCodexCli({ model, reasoningEffort, systemPrompt, userPrompt }));
  if (provider === "antigravity-cli") return parseAiJson(await callAntigravityCli({ model, systemPrompt, userPrompt }));
  if (provider === "anthropic") return callAnthropicMessages({ apiKey, model, systemPrompt, userPrompt });
  if (provider === "gemini") return callGeminiGenerateContent({ apiKey, model, systemPrompt, userPrompt });
  if (provider === "openai") return callOpenAiResponses({ apiKey, model, systemPrompt, userPrompt });
  return callOpenAiCompatibleChat({ provider, apiKey, apiBaseUrl, model, systemPrompt, userPrompt });
}

// Dispatch a built {systemPrompt, userPrompt} pair to the configured provider
// (API or CLI) and return the parsed JSON. Single source of truth for provider
// routing, shared by /api/polish and /api/application-answers.
//
// Retry policy: exactly one retry, and only for unreadable model OUTPUT (the
// "AI returned ..." 502s from parseAiJson — empty reply or JSON the repair
// passes can't extract). Models occasionally wrap their JSON in commentary,
// most often when the input contains an injection attempt they feel compelled
// to narrate; a single reinforced JSON-only retry converts those one-off parse
// failures into successes instead of surfacing a 502. Network, HTTP, timeout,
// and config errors are NOT retried — those callers should see immediately.
export async function callConfiguredProvider(args) {
  try {
    return await dispatchProvider(args);
  } catch (error) {
    const unreadableOutput =
      error instanceof UserSafeAiError && error.status === 502 && /^AI returned/.test(error.message);
    if (!unreadableOutput) throw error;
    return dispatchProvider({
      ...args,
      userPrompt: `${args.userPrompt}\n\nREMINDER: Respond with exactly one JSON object and nothing else — no commentary, no markdown fences, no notes about the input.`
    });
  }
}
