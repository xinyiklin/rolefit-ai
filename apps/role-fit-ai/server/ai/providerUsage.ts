// Token counts a provider reports beside its reply. Only numbers are kept: a
// usage block is the one part of a provider response that is safe to record.
// One convention across providers: `inputTokens` is every prompt token billed
// or served (fresh, cache-read, and cache-written), `cachedInputTokens` the
// cache-read part, `cacheCreationInputTokens` the cache-written part.
export type ProviderUsage = {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
};

export type UsageSink = { usage?: ProviderUsage | null };

const USAGE_KEYS = ["inputTokens", "cachedInputTokens", "cacheCreationInputTokens", "outputTokens", "totalTokens", "costUsd"] as const;

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

// Reads the OpenAI Responses shape (input_tokens already includes
// input_tokens_details.cached_tokens) and the Anthropic Messages / Claude Code
// envelope shape (input_tokens excludes cache reads and writes, which arrive as
// cache_read_input_tokens and cache_creation_input_tokens). A block without
// any recognised count is reported as absent.
export function readProviderUsage(raw: unknown, costUsd: unknown = null): ProviderUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const usage = raw as Record<string, unknown>;
  const details = usage.input_tokens_details && typeof usage.input_tokens_details === "object"
    ? usage.input_tokens_details as Record<string, unknown>
    : {};
  const fresh = count(usage.input_tokens);
  const anthropicRead = count(usage.cache_read_input_tokens);
  const anthropicWrite = count(usage.cache_creation_input_tokens);
  const anthropicShape = anthropicRead !== null || anthropicWrite !== null;
  const inputTokens = fresh === null ? null : anthropicShape ? fresh + (anthropicRead ?? 0) + (anthropicWrite ?? 0) : fresh;
  const outputTokens = count(usage.output_tokens);
  const result: ProviderUsage = {
    inputTokens,
    cachedInputTokens: anthropicRead ?? count(details.cached_tokens),
    cacheCreationInputTokens: anthropicWrite,
    outputTokens,
    totalTokens: count(usage.total_tokens) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
    costUsd: count(costUsd)
  };
  return USAGE_KEYS.some((key) => result[key] !== null) ? result : null;
}

export function totalOnlyUsage(totalTokens: unknown): ProviderUsage | null {
  const total = count(totalTokens);
  return total === null ? null : { inputTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, outputTokens: null, totalTokens: total, costUsd: null };
}

// A retried dispatch adds its usage to the first attempt's; a field either side
// could not report stays unknown rather than becoming a partial sum.
export function recordProviderUsage(sink: UsageSink | undefined, usage: ProviderUsage | null): void {
  if (!sink || typeof sink !== "object") return;
  if (sink.usage === undefined) { sink.usage = usage; return; }
  if (sink.usage === null || usage === null) { sink.usage = null; return; }
  const previous = sink.usage;
  sink.usage = Object.fromEntries(USAGE_KEYS.map((key) =>
    [key, previous[key] === null || usage[key] === null ? null : (previous[key] as number) + (usage[key] as number)]
  )) as ProviderUsage;
}
