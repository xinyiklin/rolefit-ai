// Provider API clients + the dispatch that routes a built {systemPrompt,
// userPrompt} pair to the configured provider (hosted API or subscription CLI)
// and returns parsed JSON. Single source of truth for outbound AI calls,
// shared by /api/polish and /api/application-answers.

import { callAntigravityCli, callClaudeCli, callCodexCli } from "../ai-cli/index.ts";
import { fetchWithTimeout } from "../http.ts";
import { UserSafeAiError } from "./errors.ts";
import { parseAiJson } from "./json.ts";
import { providerLabel } from "./providers.ts";

const OUTPUT_TOKEN_LIMIT = 8192;
const MAX_PROVIDER_RESPONSE_BYTES = 2_000_000;

// The built prompt pair + resolved provider config dispatched to one provider.
// `provider` is optional: dispatchProvider routes on it, but the per-provider
// clients it fans out to don't read it (their identity IS the provider).
type ProviderCallArgs = {
  provider?: string;
  model: string;
  reasoningEffort?: string | null;
  apiKey?: string;
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
};

// Optional dispatch-attempt collector (same additive pattern as the sanitizer's
// drop-stats): its `attempts` counter is bumped once per dispatch attempt.
type AttemptStats = { attempts?: number };

// Provider response JSON is boundary data walked defensively with optional
// chaining and runtime type checks; these extractors take the raw parsed body.
function extractOutputText(response: any): string {
  if (typeof response.output_text === "string") return response.output_text;

  return (
    response.output
      ?.flatMap((item: any) => item.content ?? [])
      .filter((part: any) => part.type === "output_text" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("\n") ?? ""
  );
}

function extractAnthropicText(response: any): string {
  return (
    response.content
      ?.map((part: any) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

function providerErrorDebug(data: any) {
  const error = data?.error ?? data;
  const safeIdentifier = (value: unknown): string | undefined => {
    const candidate = typeof value === "string" ? value : "";
    return /^[A-Za-z0-9_.:-]{1,80}$/.test(candidate) ? candidate : undefined;
  };
  return {
    code: safeIdentifier(error?.code),
    type: safeIdentifier(error?.type)
  };
}

async function readProviderJson(response: Response): Promise<any> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new UserSafeAiError("AI provider returned too much data. Try again or switch providers.", 502);
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new UserSafeAiError("AI provider returned too much data. Try again or switch providers.", 502);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
  } catch {
    return {};
  }
}

function providerRequestFailed(provider: string, response: Response, data: any): never {
  console.warn("[ai] provider request failed", {
    provider,
    status: response.status,
    ...providerErrorDebug(data)
  });
  if (response.status === 401 || response.status === 403) {
    throw new UserSafeAiError(
      `${providerLabel(provider)} rejected the credentials or account access. Check the API key and account, then try again.`,
      401
    );
  }
  if (response.status === 429) {
    throw new UserSafeAiError(
      `${providerLabel(provider)} rate limit or quota was reached. Wait, check the account quota, or switch providers.`,
      429
    );
  }
  if (response.status === 408 || response.status === 504) {
    throw new UserSafeAiError(
      `${providerLabel(provider)} timed out before finishing. Try again or switch providers.`,
      504
    );
  }
  if (response.status === 413) {
    throw new UserSafeAiError(
      `${providerLabel(provider)} rejected the request as too large. Shorten the resume or job text and try again.`,
      413
    );
  }
  if (response.status === 400 || response.status === 404) {
    throw new UserSafeAiError(
      `${providerLabel(provider)} rejected the selected model or request configuration. Check AI settings and try again.`,
      400
    );
  }
  throw new UserSafeAiError(`${providerLabel(provider)} request failed. Try again or switch providers.`, 502);
}

function isMaxTokenFinishReason(reason: unknown): boolean {
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
function assertNotTruncated(provider: string, truncated: unknown): void {
  if (truncated) {
    throw new UserSafeAiError(
      `${providerLabel(provider)} cut its response off at the output-token limit before the JSON finished. Try again, shorten the resume or job text, or pick a model with a larger output limit.`,
      502
    );
  }
}

// Pure request-body seam for deterministic privacy/shape probes. OpenAI's
// Responses API stores responses by default unless `store:false` is explicit;
// resume and job text are sensitive, so every call opts out.
export function buildOpenAiResponsesBody({ model, systemPrompt, userPrompt }: ProviderCallArgs) {
  return {
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
    max_output_tokens: OUTPUT_TOKEN_LIMIT,
    store: false
  };
}

export async function callOpenAiResponsesWithFetch(
  { apiKey, model, systemPrompt, userPrompt, signal }: ProviderCallArgs,
  request: typeof fetchWithTimeout = fetchWithTimeout
): Promise<unknown> {
  const response = await request("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(buildOpenAiResponsesBody({ model, systemPrompt, userPrompt })),
    signal
  });

  const data: any = await readProviderJson(response);
  if (!response.ok) {
    providerRequestFailed("openai", response, data);
  }
  assertNotTruncated("openai", isMaxTokenFinishReason(data.incomplete_details?.reason));

  return parseAiJson(extractOutputText(data));
}

export function buildAnthropicMessagesBody({ model, systemPrompt, userPrompt }: ProviderCallArgs) {
  return {
    model,
    max_tokens: OUTPUT_TOKEN_LIMIT,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    // Sonnet 5 changed omitted-thinking behavior from off to adaptive. This
    // bounded JSON workflow does not benefit from hidden reasoning consuming
    // the output budget, so preserve the prior low-latency contract explicitly.
    ...(model === "claude-sonnet-5" ? { thinking: { type: "disabled" } } : {})
  };
}

async function callAnthropicMessages({ apiKey, model, systemPrompt, userPrompt, signal }: ProviderCallArgs): Promise<unknown> {
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
    body: JSON.stringify(buildAnthropicMessagesBody({ model, systemPrompt, userPrompt })),
    signal
  });

  const data: any = await readProviderJson(response);
  if (!response.ok) {
    providerRequestFailed("anthropic", response, data);
  }
  assertNotTruncated("anthropic", isMaxTokenFinishReason(data.stop_reason));

  return parseAiJson(extractAnthropicText(data));
}

async function dispatchProvider({ provider, model, reasoningEffort, apiKey, systemPrompt, userPrompt, signal }: ProviderCallArgs): Promise<unknown> {
  if (provider === "claude-cli") return parseAiJson(await callClaudeCli({ model, reasoningEffort, systemPrompt, userPrompt, signal }));
  if (provider === "codex-cli") return parseAiJson(await callCodexCli({ model, reasoningEffort, systemPrompt, userPrompt, signal }));
  if (provider === "antigravity-cli") return parseAiJson(await callAntigravityCli({ model, systemPrompt, userPrompt, signal }));
  if (provider === "anthropic") return callAnthropicMessages({ apiKey, model, systemPrompt, userPrompt, signal });
  if (provider === "openai") return callOpenAiResponsesWithFetch({ apiKey, model, systemPrompt, userPrompt, signal });
  throw new UserSafeAiError("Unsupported AI provider. Pick one of the configured CLI or API providers.", 400);
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
//
// Optional `stats` collector (same additive pattern as
// sanitizeTailorSuggestions' drop-stats object): when provided, its `attempts`
// counter is incremented once per dispatch attempt so a route can report how
// many provider calls a pass took (1 = no retry, 2 = the JSON-only retry
// fired). Purely observational — it never changes retry or error behavior.
export async function callConfiguredProvider(args: ProviderCallArgs, stats?: AttemptStats): Promise<unknown> {
  const bump = (): void => {
    if (stats && typeof stats === "object") stats.attempts = (stats.attempts ?? 0) + 1;
  };
  try {
    bump();
    return await dispatchProvider(args);
  } catch (error) {
    const unreadableOutput =
      error instanceof UserSafeAiError && error.status === 502 && /^AI returned/.test(error.message);
    if (!unreadableOutput) throw error;
    bump();
    return dispatchProvider({
      ...args,
      userPrompt: `${args.userPrompt}\n\nREMINDER: Respond with exactly one JSON object and nothing else — no commentary, no markdown fences, no notes about the input.`
    });
  }
}
