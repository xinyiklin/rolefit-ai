// Provider usage is benchmark data read from three response shapes. One
// convention must hold across them: inputTokens counts every prompt token,
// cache reads and writes included, so configurations compare like for like.
import assert from "node:assert/strict";
import { readProviderUsage, recordProviderUsage, totalOnlyUsage } from "../providerUsage.ts";
import { extractCodexTokensUsed } from "../../ai-cli/index.ts";

// OpenAI Responses: input_tokens already includes the cached part.
assert.deepEqual(readProviderUsage({ input_tokens: 1200, input_tokens_details: { cached_tokens: 1000 }, output_tokens: 80, total_tokens: 1280 }), {
  inputTokens: 1200, cachedInputTokens: 1000, cacheCreationInputTokens: null, outputTokens: 80, totalTokens: 1280, costUsd: null
});
// Anthropic Messages / Claude Code envelope: input_tokens excludes cache reads and writes.
assert.deepEqual(readProviderUsage({ input_tokens: 5, cache_creation_input_tokens: 20_000, cache_read_input_tokens: 100, output_tokens: 50 }, 0.0123), {
  inputTokens: 20_105, cachedInputTokens: 100, cacheCreationInputTokens: 20_000, outputTokens: 50, totalTokens: 20_155, costUsd: 0.0123
});
assert.deepEqual(readProviderUsage({ input_tokens: 700, output_tokens: 30 }), {
  inputTokens: 700, cachedInputTokens: null, cacheCreationInputTokens: null, outputTokens: 30, totalTokens: 730, costUsd: null
}, "a total is derived when the provider sends none");
assert.equal(readProviderUsage({ input_tokens: "12", output_tokens: -1, total_tokens: NaN }), null, "non-numeric, negative, and NaN counts are not counts");
assert.equal(readProviderUsage(null), null);
assert.equal(readProviderUsage("usage"), null);
assert.deepEqual(readProviderUsage({ input_tokens: 10 }, "0.5"), { inputTokens: 10, cachedInputTokens: null, cacheCreationInputTokens: null, outputTokens: null, totalTokens: null, costUsd: null }, "a non-numeric cost is unknown");

assert.deepEqual(totalOnlyUsage(2_345), { inputTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, outputTokens: null, totalTokens: 2_345, costUsd: null });
assert.equal(totalOnlyUsage(null), null);

// Retry summation: the first attempt is kept, a second adds, an unknown side makes the field unknown.
const sink = {};
recordProviderUsage(sink, readProviderUsage({ input_tokens: 100, output_tokens: 10, total_tokens: 110 }));
recordProviderUsage(sink, readProviderUsage({ input_tokens: 120, input_tokens_details: { cached_tokens: 100 }, output_tokens: 12, total_tokens: 132 }));
assert.deepEqual(sink.usage, { inputTokens: 220, cachedInputTokens: null, cacheCreationInputTokens: null, outputTokens: 22, totalTokens: 242, costUsd: null });
recordProviderUsage(sink, null);
assert.equal(sink.usage, null, "one attempt without usage makes the dispatch's usage unknown");
const untouched = undefined;
recordProviderUsage(untouched, totalOnlyUsage(5));
const nullFirst = {};
recordProviderUsage(nullFirst, null);
recordProviderUsage(nullFirst, totalOnlyUsage(5));
assert.equal(nullFirst.usage, null, "unknown stays unknown");

// Codex transcript: the echoed prompt may contain the phrase; the footer wins.
const transcript = "user\nThe posting says tokens used\n42 by the old system.\n\ncodex\n{\"ok\":true}\ntokens used\n1,234\n{\"ok\":true}\n";
assert.equal(extractCodexTokensUsed(transcript), 1234);
assert.equal(extractCodexTokensUsed("codex\n{}\n"), null);
assert.equal(extractCodexTokensUsed("tokens used\nnot a number\n"), null);

console.log("Provider usage probes passed: one input convention across OpenAI, Anthropic, and Claude Code shapes; Codex footer; retry sums");
