import { useId } from "react";

import {
  cliReasoningEffortOptionsFor,
  modelOptionsByProvider,
  providerOptions
} from "../config/aiOptions";
import { AI_STAGES } from "../config/aiStages";
import type { AiProviderValue } from "../config/aiOptions";
import type {
  AvailableProviderConnection,
  ProviderAvailabilityStatus
} from "../hooks/useAvailableProviders";
import type { StageConfig, StageId } from "../lib/aiRequest";
import { ModelSelectOptions } from "./ModelSelectOptions";

export type StageKey = StageId;

type SettingsStageProps = {
  stage: StageKey;
  title: string;
  blurb: string;
  config: StageConfig;
  providers: readonly AvailableProviderConnection[];
  availabilityStatus: ProviderAvailabilityStatus;
  availabilityMessage: string;
  onRefreshProviders: () => void | Promise<void>;
  onChange: (patch: Partial<StageConfig>) => void;
  onProviderChange: (provider: AiProviderValue) => void;
  onCopyFrom: (from: StageKey) => void;
};

// One stage's row in Settings > Models: the stage, then provider, model, and
// effort in the columns ModelsPage heads once. Frameless and hairline-separated;
// instruction overrides live in Guidance.
export function SettingsStage({
  stage,
  title,
  blurb,
  config,
  providers,
  availabilityStatus,
  availabilityMessage,
  onRefreshProviders,
  onChange,
  onProviderChange,
  onCopyFrom
}: SettingsStageProps) {
  const headingId = useId();
  const { provider, selectedModel, cliReasoningEffort } = config;

  const providerById = new Map(providers.map((connection) => [connection.id, connection]));
  const availableOptions = providerOptions.filter((option) => providerById.has(option.value));
  const selectedConnection = providerById.get(provider);
  const modelOptions = selectedConnection ? modelOptionsByProvider[provider] ?? [] : [];
  const effortOptions = selectedConnection
    ? cliReasoningEffortOptionsFor(provider, selectedModel) ?? []
    : [];

  return (
    <section className="settings-stage" aria-labelledby={headingId}>
      <div className="settings-stage__naming">
        <h3 id={headingId}>{title}</h3>
        <p>{blurb}</p>
      </div>

      <select
        className="settings-stage__provider"
        aria-label={`${title} provider`}
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

      {selectedConnection ? (
        <select
          className="settings-stage__model"
          aria-label={`${title} model`}
          value={selectedModel}
          onChange={(event) => onChange({ selectedModel: event.target.value })}
        >
          <ModelSelectOptions options={modelOptions} />
        </select>
      ) : <span className="settings-stage__empty" aria-hidden="true">—</span>}

      {selectedConnection && effortOptions.length ? (
        <select
          className="settings-stage__effort"
          aria-label={`${title} effort`}
          value={cliReasoningEffort}
          onChange={(event) => onChange({ cliReasoningEffort: event.target.value })}
        >
          {effortOptions.map((option) => (
            <option key={option.value || "cli-default-effort"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : <span className="settings-stage__empty" aria-hidden="true">—</span>}

      {/* Quiet until used: a rarely-touched convenience. */}
      <select
        className="settings-stage__copy"
        aria-label={`Copy ${title} settings from another stage`}
        value=""
        onChange={(event) => {
          const from = event.target.value as StageKey;
          if (from) onCopyFrom(from);
        }}
      >
        <option value="">Copy from…</option>
        {AI_STAGES.filter((item) => item.id !== stage).map((item) => (
          <option key={item.id} value={item.id}>{item.label}</option>
        ))}
      </select>

      {/* Recovery guidance only for a provider that cannot run: a ready stage
          says nothing, which is the quiet-status contract. */}
      {!selectedConnection?.ready ? (
        <div className="settings-stage__blocked">
          <p>{selectedConnection ? selectedConnection.guidance : availabilityMessage}</p>
          <button
            className="ghost-button is-compact"
            type="button"
            aria-label={`Check providers for ${title}`}
            onClick={() => void onRefreshProviders()}
          >
            Check providers
          </button>
        </div>
      ) : null}
    </section>
  );
}
