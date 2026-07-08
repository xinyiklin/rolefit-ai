import { KeyRound } from "lucide-react";
import {
  cliReasoningEffortOptionsFor,
  describeProviderModel,
  modelOptionsByProvider,
  providerOptions
} from "../config/aiOptions";
import type { AiProviderValue } from "../config/aiOptions";
import type { StageConfig, StageId } from "../lib/aiRequest";
import { MenuSection } from "./MenuSection";
import { ModelSelectOptions } from "./ModelSelectOptions";

export type StageKey = StageId;

// The three pipeline stages, in pipeline order. The copy control in each section
// lists the OTHER two (a stage never copies from itself).
const STAGES: { key: StageKey; label: string }[] = [
  { key: "distill", label: "Distill" },
  { key: "tailor", label: "Tailor" },
  { key: "review", label: "Review" }
];

// One pipeline stage's provider config (Distill / Tailor / Review), rendered as a
// collapsible section. The header line carries a "Copy from" control that copies
// one of the OTHER two stages' settings into this one (one-shot copy, not a live
// link). The body is the full provider menu (provider / model / reasoning effort /
// key / base URL). Each stage holds its own concrete config, passed as one
// `StageConfig` object with a single `onChange` patcher instead of 12 flat props.
type ProviderSectionProps = {
  stage: StageKey;
  title: string;
  config: StageConfig;
  onChange: (patch: Partial<StageConfig>) => void;
  // Switching provider resets key/base-URL/model/effort/custom-model, so it stays
  // its own callback rather than a plain onChange({ provider }) patch.
  onProviderChange: (provider: AiProviderValue) => void;
  open: boolean;
  onToggle: () => void;
  onCopyFrom: (from: StageKey) => void;
};

const OPENAI_COMPATIBLE = ["openrouter", "groq", "together", "mistral", "local"];

function keyPlaceholder(provider: AiProviderValue): string {
  if (provider === "claude-cli") return "Not used — auth via `claude auth login`";
  if (provider === "codex-cli") return "Not used — auth via `codex login`";
  if (provider === "antigravity-cli") return "Not used — auth via `agy auth login`";
  if (provider === "openai") return "Uses OPENAI_API_KEY when blank";
  return "Uses this provider's .env key when blank";
}

export function ProviderSection({
  stage,
  title,
  config,
  onChange,
  onProviderChange,
  open,
  onToggle,
  onCopyFrom
}: ProviderSectionProps) {
  const { provider, apiKey, apiBaseUrl, selectedModel, customModel, cliReasoningEffort } = config;
  const isCliProvider = provider === "claude-cli" || provider === "codex-cli" || provider === "antigravity-cli";
  const modelOptions = modelOptionsByProvider[provider] ?? [];
  const effortOptions =
    cliReasoningEffortOptionsFor(provider, selectedModel === "custom" ? customModel : selectedModel) ?? [];
  const selectedProviderOption = providerOptions.find((option) => option.value === provider);
  const customModelPlaceholder = selectedProviderOption?.model || "model-id";
  const effectiveModel = selectedModel === "custom" ? customModel : selectedModel;
  const summary = describeProviderModel(provider, effectiveModel);

  const copyControl = (
    <div className="stage-copy">
      <span className="stage-copy__label">Copy from</span>
      <div className="segmented" role="group" aria-label={`Copy ${title} settings from another stage`}>
        {STAGES.filter((s) => s.key !== stage).map((s) => (
          <button
            key={s.key}
            type="button"
            className="segmented__btn"
            title={`Copy settings from ${s.label}`}
            onClick={() => onCopyFrom(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <MenuSection title={title} summary={summary} headerControl={copyControl} open={open} onToggle={onToggle}>
      <div className="provider-card">
        {/* Provider + Model + (Reasoning effort) share one row; the row is 2-wide
            when the provider has no effort control (hosted) and 3-wide when it does. */}
        <div className={`provider-card__row${effortOptions.length ? " provider-card__row--3" : ""}`}>
          <label className="field">
            <span>Provider</span>
            <select value={provider} onChange={(event) => onProviderChange(event.target.value as AiProviderValue)}>
              {providerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Model</span>
            <select value={selectedModel} onChange={(event) => onChange({ selectedModel: event.target.value })}>
              <ModelSelectOptions options={modelOptions} />
            </select>
          </label>
          {effortOptions.length ? (
            <label className="field">
              <span>Effort</span>
              <select value={cliReasoningEffort} onChange={(event) => onChange({ cliReasoningEffort: event.target.value })}>
                {effortOptions.map((option) => (
                  <option key={option.value || "cli-default-effort"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {selectedModel === "custom" ? (
          <label className="field">
            <span>Custom model</span>
            <input
              className="text-input"
              value={customModel}
              onChange={(event) => onChange({ customModel: event.target.value })}
              placeholder={customModelPlaceholder}
              type="text"
            />
          </label>
        ) : null}

        <label className="field">
          <span>API key</span>
          <div className="input-with-icon">
            <KeyRound size={15} aria-hidden="true" />
            <input
              autoComplete="off"
              value={apiKey}
              onChange={(event) => onChange({ apiKey: event.target.value })}
              placeholder={keyPlaceholder(provider)}
              disabled={isCliProvider}
              type="password"
            />
          </div>
        </label>

        {OPENAI_COMPATIBLE.includes(provider) ? (
          <label className="field">
            <span>Base URL</span>
            <input
              className="text-input"
              value={apiBaseUrl}
              onChange={(event) => onChange({ apiBaseUrl: event.target.value })}
              placeholder="https://provider.example/v1"
              type="url"
            />
          </label>
        ) : null}
      </div>
    </MenuSection>
  );
}
