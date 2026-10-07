import { AI_STAGES } from "../../config/aiStages";
import { SettingsStage } from "../SettingsStage";
import type { SettingsDialogProps } from "../SettingsDialog";

type ModelsPageProps = Pick<SettingsDialogProps,
  | "stages" | "onStageChange" | "onStageProviderChange" | "onCopyStage"
  | "providers" | "availabilityStatus" | "availabilityMessage" | "onRefreshProviders"
>;

export function ModelsPage({
  stages,
  onStageChange,
  onStageProviderChange,
  onCopyStage,
  providers,
  availabilityStatus,
  availabilityMessage,
  onRefreshProviders
}: ModelsPageProps) {
  return (
    <>
      <p className="settings-panel__intro">
        Each stage runs on its own provider and model. Add providers in RoleFit Companion; your API
        keys never reach the browser.
      </p>

      <div className="settings-stages">
        {/* Column heads once, for every row's unlabelled selects. */}
        <div className="settings-stages__head" aria-hidden="true">
          <span>Stage</span>
          <span>Provider</span>
          <span>Model</span>
          <span>Effort</span>
        </div>
        {AI_STAGES.map((stage) => (
          <SettingsStage
            key={stage.id}
            stage={stage.id}
            title={stage.title}
            blurb={stage.blurb}
            config={stages[stage.id]}
            providers={providers}
            availabilityStatus={availabilityStatus}
            availabilityMessage={availabilityMessage}
            onRefreshProviders={onRefreshProviders}
            onChange={(patch) => onStageChange(stage.id, patch)}
            onProviderChange={(provider) => onStageProviderChange(stage.id, provider)}
            onCopyFrom={(from) => onCopyStage(from, stage.id)}
          />
        ))}
      </div>
    </>
  );
}
