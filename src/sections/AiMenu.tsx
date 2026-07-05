import { KeyRound, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import {
  cliReasoningEffortOptionsFor,
  modelOptionsByProvider,
  providerOptions
} from "../config/aiOptions";
import { NavMenu } from "./NavMenu";
import { ModelSelectOptions } from "./ModelSelectOptions";
import type { AiProviderValue } from "../config/aiOptions";

type AiMenuProps = {
  aiProvider: AiProviderValue;
  onProviderChange: (provider: AiProviderValue) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  apiBaseUrl: string;
  setApiBaseUrl: (v: string) => void;
  selectedModel: string;
  setSelectedModel: (v: string) => void;
  customModel: string;
  setCustomModel: (v: string) => void;
  cliReasoningEffort: string;
  setCliReasoningEffort: (v: string) => void;
  // Optional reviewer (strict-audit) provider controls, rendered below the
  // primary provider. The primary handles rewrite + cover letter.
  reviewer?: ReactNode;
};

const OPENAI_COMPATIBLE = ["openrouter", "groq", "together", "mistral", "local"];

export function AiMenu({
  aiProvider,
  onProviderChange,
  apiKey,
  setApiKey,
  apiBaseUrl,
  setApiBaseUrl,
  selectedModel,
  setSelectedModel,
  customModel,
  setCustomModel,
  cliReasoningEffort,
  setCliReasoningEffort,
  reviewer
}: AiMenuProps) {
  const selectedProviderOption = providerOptions.find((option) => option.value === aiProvider);
  const currentModelOptions = modelOptionsByProvider[aiProvider] ?? [];
  const currentCliReasoningEffortOptions =
    cliReasoningEffortOptionsFor(aiProvider, selectedModel === "custom" ? customModel : selectedModel) ?? [];
  const customModelPlaceholder = selectedProviderOption?.model || "model-id";
  const isCliProvider =
    aiProvider === "claude-cli" || aiProvider === "codex-cli" || aiProvider === "antigravity-cli";
  const modelLabel = selectedModel === "custom" ? customModel || "custom" : selectedModel || "default";

  return (
    <NavMenu
      icon={<Sparkles size={13} aria-hidden={true} />}
      ariaLabel="AI provider and model"
      label={
        <>
          <span className="nav-menu__label">{selectedProviderOption?.label ?? aiProvider}</span>
          <span className="nav-menu__sub is-meta">{modelLabel}</span>
        </>
      }
    >
      <div className="provider-config">
        <label className="field">
          <span>Provider</span>
          <select value={aiProvider} onChange={(event) => onProviderChange(event.target.value as AiProviderValue)}>
            {providerOptions.map((option) => (
              <option key={option.value || "server-default"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {/* Model + effort share a balanced row only when both exist; otherwise
            Model takes the full width so no orphaned half-width select appears. */}
        <div className={currentCliReasoningEffortOptions.length ? "settings-grid" : "provider-config__single"}>
          <label className="field">
            <span>Model</span>
            <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
              <ModelSelectOptions options={currentModelOptions} />
            </select>
          </label>
          {currentCliReasoningEffortOptions.length ? (
            <label className="field">
              <span>Reasoning effort</span>
              <select value={cliReasoningEffort} onChange={(event) => setCliReasoningEffort(event.target.value)}>
                {currentCliReasoningEffortOptions.map((option) => (
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
              onChange={(event) => setCustomModel(event.target.value)}
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
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                aiProvider === "claude-cli"
                  ? "Not used — auth via `claude auth login`"
                  : aiProvider === "codex-cli"
                  ? "Not used — auth via `codex login`"
                  : aiProvider === "antigravity-cli"
                  ? "Not used — auth via `agy auth login`"
                  : aiProvider === "openai"
                  ? "Uses OPENAI_API_KEY when blank"
                  : "Uses this provider's .env key when blank"
              }
              disabled={isCliProvider}
              type="password"
            />
          </div>
        </label>

        {OPENAI_COMPATIBLE.includes(aiProvider) ? (
          <label className="field">
            <span>Base URL</span>
            <input
              className="text-input"
              value={apiBaseUrl}
              onChange={(event) => setApiBaseUrl(event.target.value)}
              placeholder="https://provider.example/v1"
              type="url"
            />
          </label>
        ) : null}

        <p className="micro-status">
          Claude and Gemini use their native APIs. OpenRouter / Groq / Together / Mistral / local use OpenAI-compatible <code>/chat/completions</code>.
        </p>
      </div>

      {reviewer}
    </NavMenu>
  );
}
