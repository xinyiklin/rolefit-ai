type EffortOption = { value: string; label: string };

const EFFORT_LEVELS: readonly EffortOption[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" }
];

// One effort scale per vendor, shared by its CLI and API. Codex's `ultra` is a
// CLI orchestration mode with no API equivalent, so only the CLI lists it.
export const cliReasoningEffortOptionsByProvider: Partial<Record<string, readonly EffortOption[]>> = {
  "claude-cli": EFFORT_LEVELS,
  anthropic: EFFORT_LEVELS,
  "codex-cli": [...EFFORT_LEVELS, { value: "ultra", label: "Ultra" }],
  openai: EFFORT_LEVELS
};

const OPENAI_FULL_RANGE_MODELS: ReadonlySet<string> = new Set(["gpt-6-astra", "gpt-6.1-sol"]);

// Provider-reported capabilities, verified 2026-10-18 (Claude Code 2.1.285,
// Codex catalog 0.159.2, Claude and OpenAI API docs); sources live in ai-server.md.
export function cliReasoningEffortOptionsFor(
  provider: string,
  model: string
): readonly EffortOption[] | undefined {
  const all = cliReasoningEffortOptionsByProvider[provider];
  if (!all) return undefined;
  if (provider === "codex-cli" || provider === "openai") {
    // An unlisted OpenAI model gets the conservative range; GPT-6 Luna stops at max.
    if (!OPENAI_FULL_RANGE_MODELS.has(model) && model !== "gpt-6-luna") {
      return EFFORT_LEVELS.filter((option) => option.value !== "max");
    }
    if (model === "gpt-6-luna") return EFFORT_LEVELS;
  }
  return all;
}

// Preserve RoleFit's bounded-work defaults when a supported effort is missing.
export function defaultCliReasoningEffort(provider: string): string {
  if (provider === "claude-cli" || provider === "anthropic") return "low";
  if (provider === "codex-cli" || provider === "openai") return "medium";
  return "";
}

export function reconcileCliReasoningEffort(provider: string, model: string, effort: string): string {
  const options = cliReasoningEffortOptionsFor(provider, model);
  if (!options || options.some((option) => option.value === effort)) return effort;
  return options.length ? defaultCliReasoningEffort(provider) : "";
}
