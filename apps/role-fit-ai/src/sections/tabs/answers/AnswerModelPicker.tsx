import { useId } from "react";
import {
  cliReasoningEffortOptionsFor,
  modelOptionsByProvider,
  providerOptions,
  type AiProviderValue
} from "../../../config/aiOptions";
import type {
  AvailableProviderConnection,
  ProviderAvailabilityStatus
} from "../../../hooks/useAvailableProviders";
import type { StageConfig } from "../../../lib/aiRequest";
import { ModelSelectOptions } from "../../ModelSelectOptions";
import { NavMenu } from "../../NavMenu";

type AnswerModelPickerProps = {
  config: StageConfig;
  providers: readonly AvailableProviderConnection[];
  availabilityStatus: ProviderAvailabilityStatus;
  availabilityMessage: string;
  onRefreshProviders: () => void | Promise<void>;
  onChange: (patch: Partial<StageConfig>) => void;
  onProviderChange: (provider: AiProviderValue) => void;
};

export function AnswerModelPicker({
  config, providers, availabilityStatus, availabilityMessage,
  onRefreshProviders, onChange, onProviderChange
}: AnswerModelPickerProps) {
  const id = useId();
  const selectedConnection = providers.find((connection) => connection.id === config.provider);
  const availableOptions = providerOptions.filter((option) => providers.some((connection) => connection.id === option.value));
  const models = selectedConnection ? modelOptionsByProvider[config.provider] : [];
  const efforts = selectedConnection ? cliReasoningEffortOptionsFor(config.provider, config.selectedModel) ?? [] : [];
  const modelLabel = models.find((option) => option.value === config.selectedModel)?.label ?? "Choose model";
  const effortLabel = efforts.find((option) => option.value === config.cliReasoningEffort)?.label;
  const unavailable = !selectedConnection?.ready;
  const needsProvider = unavailable && availabilityStatus !== "loading";

  return (
    <NavMenu
      icon={null}
      label={<><span className="answers-model-menu__name">{modelLabel}</span>{effortLabel ? <span className="answers-model-menu__effort">{effortLabel}</span> : null}</>}
      ariaLabel={`${[modelLabel, effortLabel].filter(Boolean).join(" · ")}, answer model and effort${needsProvider ? ", provider needs attention" : ""}`}
      className={`answers-model-menu${needsProvider ? " needs-provider" : ""}`}
      popoverPlacement="above"
    >
      <div className="answers-model-picker">
        <p className="answers-model-picker__title">Answer model</p>
        <div className="answers-model-picker__fields">
          <label htmlFor={`${id}-provider`}>Provider</label>
          <select
            id={`${id}-provider`}
            aria-label="Application Answers provider"
            value={selectedConnection ? config.provider : ""}
            disabled={availabilityStatus === "loading" || availableOptions.length === 0}
            onChange={(event) => { if (event.target.value) onProviderChange(event.target.value as AiProviderValue); }}
          >
            {!selectedConnection ? <option value="" disabled>{availableOptions.length ? "Choose an added provider…" : "No providers added"}</option> : null}
            {availableOptions.map((option) => {
              const ready = providers.find((connection) => connection.id === option.value)?.ready;
              return <option key={option.value} value={option.value} disabled={!ready}>{option.label}{ready ? "" : " — reconnect"}</option>;
            })}
          </select>
          <label htmlFor={`${id}-model`}>Model</label>
          <select id={`${id}-model`} aria-label="Application Answers model" value={selectedConnection ? config.selectedModel : ""}
            disabled={unavailable} onChange={(event) => onChange({ selectedModel: event.target.value })}>
            {!selectedConnection ? <option value="">Add a provider first</option> : <ModelSelectOptions options={models} />}
          </select>
          {efforts.length ? <>
            <label htmlFor={`${id}-effort`}>Effort</label>
            <select id={`${id}-effort`} aria-label="Application Answers effort" value={config.cliReasoningEffort}
              disabled={unavailable} onChange={(event) => onChange({ cliReasoningEffort: event.target.value })}>
              {efforts.map((option) => <option key={option.value || "default"} value={option.value}>{option.label}</option>)}
            </select>
          </> : null}
        </div>
        {unavailable ? <div className="answers-model-picker__recovery">
          <p>{selectedConnection?.guidance || availabilityMessage || "Add or reconnect a provider in the RoleFit companion."}</p>
          <button type="button" className="ghost-button is-compact" onClick={() => void onRefreshProviders()}>Check providers</button>
        </div> : null}
        <p className="answers-model-picker__hint">Applies to your next draft and Settings › Models.</p>
      </div>
    </NavMenu>
  );
}
