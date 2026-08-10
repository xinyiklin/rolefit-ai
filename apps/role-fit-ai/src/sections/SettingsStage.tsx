import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

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
  instructions: string;
  onInstructionsChange: (value: string) => void;
  supportsInstructions: boolean;
};

// One stage's row in Settings > AI stages: what it does, which provider runs it,
// and an optional instruction override.
//
// Deliberately frameless. This started as a bordered card inside another bordered
// card — the Drafting Desk rejects nested card-in-card containers, and five of
// them stacked to 317px each in a 625px panel. Stages are separated by a hairline
// instead, and the override is disclosed rather than five always-open textareas.
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
  onCopyFrom,
  instructions,
  onInstructionsChange,
  supportsInstructions
}: SettingsStageProps) {
  const headingId = useId();
  const { provider, selectedModel, cliReasoningEffort } = config;
  const hasInstructions = Boolean(instructions.trim());
  const [instructionsOpen, setInstructionsOpen] = useState(hasInstructions);

  const providerById = new Map(providers.map((connection) => [connection.id, connection]));
  const availableOptions = providerOptions.filter((option) => providerById.has(option.value));
  const selectedConnection = providerById.get(provider);
  const modelOptions = selectedConnection ? modelOptionsByProvider[provider] ?? [] : [];
  const effortOptions = selectedConnection
    ? cliReasoningEffortOptionsFor(provider, selectedModel) ?? []
    : [];

  return (
    <section className="settings-stage" aria-labelledby={headingId}>
      <div className="settings-stage__head">
        <div className="settings-stage__naming">
          <h3 id={headingId}>{title}</h3>
          <p>{blurb}</p>
        </div>
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
      </div>

      <div className={`settings-stage__controls${effortOptions.length ? " settings-stage__controls--3" : ""}`}>
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

      {/* Recovery guidance is shown only for a provider that cannot run: a ready
          stage says nothing, which is the quiet-status contract. */}
      {!selectedConnection?.ready ? (
        <div className="settings-stage__blocked">
          <p>{selectedConnection ? selectedConnection.guidance : availabilityMessage}</p>
          {/* One of these appears per blocked stage, so name which stage it is
              rather than leaving five identical "Check providers" buttons. */}
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

      {supportsInstructions ? (
        <div className="settings-stage__extra">
          <button
            type="button"
            className={`settings-stage__disclose${instructionsOpen ? " is-open" : ""}`}
            aria-expanded={instructionsOpen}
            onClick={() => setInstructionsOpen((open) => !open)}
          >
            <ChevronDown size={12} aria-hidden="true" />
            {hasInstructions ? "Edit instructions" : "Add instructions"}
          </button>
          {/* A set override stays legible when collapsed — otherwise guidance that
              is actually being sent would be invisible. */}
          {!instructionsOpen && hasInstructions ? (
            <p className="settings-stage__preview">{instructions.trim()}</p>
          ) : null}
          {instructionsOpen ? (
            <label className="field">
              <span className="sr-only">Instructions for {title}</span>
              <textarea
                className="textarea"
                rows={3}
                value={instructions}
                placeholder="Replaces the shared custom instructions. Leave empty to use them."
                onChange={(event) => onInstructionsChange(event.target.value)}
              />
            </label>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
