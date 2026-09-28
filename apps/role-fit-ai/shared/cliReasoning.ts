type EffortOption = { value: string; label: string };

export const cliReasoningEffortOptionsByProvider: Partial<Record<string, readonly EffortOption[]>> = {
  // CLI effort is distinct from API effort and includes Codex orchestration modes.
  "claude-cli": [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra high" },
    { value: "max", label: "Max" }
  ],
  "codex-cli": [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra high" },
    { value: "max", label: "Max" },
    { value: "ultra", label: "Ultra" }
  ]
};

// Provider-reported capabilities, verified 2026-09-27; sources live in ai-server.md.
export function cliReasoningEffortOptionsFor(
  provider: string,
  model: string
): readonly EffortOption[] | undefined {
  if (provider === "codex-cli") {
    const all = cliReasoningEffortOptionsByProvider["codex-cli"] ?? [];
    if (["gpt-6-astra", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra"].includes(model)) return all;
    if (model === "gpt-6-luna" || model === "gpt-5.6-luna") {
      return all.filter((option) => option.value !== "ultra");
    }
    return all.filter((option) => option.value !== "max" && option.value !== "ultra");
  }
  if (provider === "claude-cli") {
    if (model === "claude-haiku-4-5" || model === "claude-haiku-4-5-20251001") return [];
    const all = cliReasoningEffortOptionsByProvider["claude-cli"] ?? [];
    if (model === "claude-opus-4-6" || model === "claude-sonnet-4-6") {
      return all.filter((option) => option.value !== "xhigh");
    }
    return all;
  }
  return undefined;
}

// Preserve RoleFit's bounded-work defaults when a supported effort is missing.
export function defaultCliReasoningEffort(provider: string): string {
  if (provider === "claude-cli") return "low";
  if (provider === "codex-cli") return "medium";
  return "";
}

export function reconcileCliReasoningEffort(provider: string, model: string, effort: string): string {
  const options = cliReasoningEffortOptionsFor(provider, model);
  if (!options || options.some((option) => option.value === effort)) return effort;
  return options.length ? defaultCliReasoningEffort(provider) : "";
}
