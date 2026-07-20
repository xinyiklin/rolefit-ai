import {
  cliReasoningEffortOptionsFor,
  modelOptionsByProvider,
  providerOptions
} from "../config/aiOptions";
import type { AiProviderValue } from "../config/aiOptions";
import type {
  AvailableProviderConnection,
  ProviderAvailabilityStatus
} from "../hooks/useAvailableProviders";
import type { StageConfig, StageId } from "../lib/aiRequest";
import { MenuSection } from "./MenuSection";
import { ModelSelectOptions } from "./ModelSelectOptions";

export type StageKey = StageId;

const STAGES: { key: StageKey; label: string }[] = [
  { key: "distill", label: "Distill" },
  { key: "tailor", label: "Tailor" },
  { key: "review", label: "Review" }
];

type ProviderSectionProps = {
  stage: StageKey;
  title: string;
  config: StageConfig;
  providers: readonly AvailableProviderConnection[];
  availabilityStatus: ProviderAvailabilityStatus;
  availabilityMessage: string;
  onRefreshProviders: () => void | Promise<void>;
  onChange: (patch: Partial<StageConfig>) => void;
  onProviderChange: (provider: AiProviderValue) => void;
  onCopyFrom: (from: StageKey) => void;
};

export function ProviderSection({
  stage,
  title,
  config,
  providers,
  availabilityStatus,
  availabilityMessage,
  onRefreshProviders,
  onChange,
  onProviderChange,
  onCopyFrom
}: ProviderSectionProps) {
  const { provider, selectedModel, cliReasoningEffort } = config;
  const providerById = new Map(providers.map((connection) => [connection.id, connection]));
  const availableOptions = providerOptions.filter((option) => providerById.has(option.value));
  const selectedConnection = providerById.get(provider);
  const modelOptions = selectedConnection ? modelOptionsByProvider[provider] ?? [] : [];
  const effortOptions = selectedConnection
    ? cliReasoningEffortOptionsFor(provider, selectedModel) ?? []
    : [];
  const copyControl = (
    <label className="stage-copy">
      <span className="stage-copy__label">Copy settings</span>
      <select
        className="stage-copy__select"
        aria-label={`Copy ${title} settings from another stage`}
        value=""
        onChange={(event) => {
          const from = event.target.value as StageKey;
          if (from) onCopyFrom(from);
        }}
      >
        <option value="">From…</option>
        {STAGES.filter((item) => item.key !== stage).map((item) => (
          <option key={item.key} value={item.key}>{item.label}</option>
        ))}
      </select>
    </label>
  );

  return (
    <MenuSection title={title} headerControl={copyControl}>
      <div className="provider-card">
        <div className={`provider-card__row${effortOptions.length ? " provider-card__row--3" : ""}`}>
          <label className="field">
            <span>Provider</span>
            <select
              value={selectedConnection ? provider : ""}
              disabled={availabilityStatus === "loading" || availableOptions.length === 0}
              onChange={(event) => {
                if (event.target.value) onProviderChange(event.target.value as AiProviderValue);
              }}
            >
              {!selectedConnection ? (
                <option value="" disabled>
                  {availableOptions.length ? "Choose an added provider…" : "No providers added"}
                </option>
              ) : null}
              {availableOptions.map((option) => {
                const connection = providerById.get(option.value);
                return (
                  <option key={option.value} value={option.value}>
                    {option.label}{connection?.ready ? "" : " — reconnect"}
                  </option>
                );
              })}
            </select>
          </label>

          {selectedConnection ? (
            <label className="field">
              <span>Model</span>
              <select value={selectedModel} onChange={(event) => onChange({ selectedModel: event.target.value })}>
                <ModelSelectOptions options={modelOptions} />
              </select>
            </label>
          ) : null}

          {selectedConnection && effortOptions.length ? (
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

        {!selectedConnection?.ready ? (
          <div className="provider-card__availability is-blocked">
            <p className="provider-card__auth-note">
              {selectedConnection ? selectedConnection.guidance : availabilityMessage}
            </p>
            <button className="ghost-button is-compact" type="button" onClick={() => void onRefreshProviders()}>
              Check providers
            </button>
          </div>
        ) : null}
      </div>
    </MenuSection>
  );
}
