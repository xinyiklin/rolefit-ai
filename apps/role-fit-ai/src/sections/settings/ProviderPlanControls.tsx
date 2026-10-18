import { useId, useState } from "react";
import { providerFor, providerLabel, providerOption, vendorLabels, type AiTransport, type AiVendor } from "../../config/aiOptions";
import { AI_STAGE_IDS } from "../../config/aiStages";
import { currentPlan, vendorTransport, type StagesChange } from "../../lib/providerPlans";
import { PROVIDER_PLANS, type ProviderPlanId } from "../../lib/stageSettings";
import type { SettingsDialogProps } from "../SettingsDialog";

type ProviderPlanControlsProps = Pick<SettingsDialogProps, "stages" | "providers" | "availabilityStatus" | "onApplyPlan" | "onSwitchTransport">;

const PLAN_CHOICES: readonly { id: ProviderPlanId; label: string }[] = [
  { id: "hybrid", label: "Hybrid (recommended)" },
  { id: "claude", label: "Claude only" },
  { id: "openai", label: "OpenAI only" }
];
const VENDORS: readonly AiVendor[] = ["claude", "openai"];
const TRANSPORTS: readonly AiTransport[] = ["cli", "api"];

function planVendors(plan: ProviderPlanId): AiVendor[] {
  return [...new Set(AI_STAGE_IDS.map((stage) => providerOption(PROVIDER_PLANS[plan][stage].provider)!.vendor))];
}

// Both controls rewrite the stage rows once; their pressed state is read back
// from the rows, so editing a row afterward shows Custom or Mixed. Unavailable
// choices stay focusable (aria-disabled) so their reason is announced.
export function ProviderPlanControls({ stages, providers, availabilityStatus, onApplyPlan, onSwitchTransport }: ProviderPlanControlsProps) {
  const id = useId();
  const [note, setNote] = useState({ text: "", count: 0, stages: "" });
  const added = new Set<string>(providers.map((connection) => connection.id));
  const loading = availabilityStatus === "loading";
  const plan = currentPlan(stages);
  // The note describes the rows one action produced; editing a row hides it.
  const report = ({ stages: next, adjusted }: StagesChange) => setNote((prev) => ({
    text: adjusted ? `${adjusted} ${adjusted === 1 ? "stage uses" : "stages use"} the nearest supported model or effort.` : "",
    count: prev.count + 1,
    stages: JSON.stringify(next)
  }));
  const noteText = note.stages === JSON.stringify(stages) ? note.text : "";
  const vendorAdded = (vendor: AiVendor) => TRANSPORTS.some((transport) => added.has(providerFor(vendor, transport)));

  const planBlocker = (choice: ProviderPlanId): string => {
    if (loading) return "Checking providers…";
    const missing = planVendors(choice).filter((vendor) => !vendorAdded(vendor));
    return missing.length ? `Add ${missing.map((vendor) => vendorLabels[vendor]).join(" and ")} in RoleFit Companion.` : "";
  };
  const transportBlocker = (vendor: AiVendor, transport: AiTransport): string => {
    const provider = providerFor(vendor, transport);
    if (!added.has(provider)) return `Add ${providerLabel(provider)} in RoleFit Companion.`;
    return vendorTransport(stages, vendor) === "unused" ? `No stage uses ${vendorLabels[vendor]}.` : "";
  };

  return (
    <div className="settings-plan">
      <div className="settings-plan__row">
        <span className="settings-plan__label" id={`${id}-plan`}>Plan</span>
        <div className="settings-segment" role="group" aria-labelledby={`${id}-plan`} aria-describedby={plan === "custom" ? `${id}-plan-state` : undefined}>
          {PLAN_CHOICES.map((choice) => {
            const blocker = planBlocker(choice.id);
            return (
              <button
                key={choice.id}
                type="button"
                className="settings-segment__option"
                aria-pressed={plan === choice.id}
                aria-disabled={blocker ? true : undefined}
                aria-describedby={blocker ? `${id}-plan-${choice.id}` : undefined}
                title={blocker || undefined}
                onClick={() => { if (!blocker) report(onApplyPlan(choice.id, added)); }}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
        {plan === "custom" ? <span className="settings-plan__state" id={`${id}-plan-state`}>Custom</span> : null}
        {PLAN_CHOICES.map((choice) => {
          const blocker = planBlocker(choice.id);
          return blocker ? <span key={choice.id} className="sr-only" id={`${id}-plan-${choice.id}`}>{blocker}</span> : null;
        })}
      </div>
      {VENDORS.map((vendor) => {
        const state = vendorTransport(stages, vendor);
        return (
          <div className="settings-plan__row" key={vendor}>
            <span className="settings-plan__label" id={`${id}-${vendor}`}>{vendorLabels[vendor]}</span>
            <div className="settings-segment" role="group" aria-labelledby={`${id}-${vendor}`} aria-describedby={state === "mixed" ? `${id}-${vendor}-state` : undefined}>
              {TRANSPORTS.map((transport) => {
                const blocker = transportBlocker(vendor, transport);
                return (
                  <button
                    key={transport}
                    type="button"
                    className="settings-segment__option"
                    aria-pressed={state === transport}
                    aria-disabled={blocker ? true : undefined}
                    aria-describedby={blocker ? `${id}-${vendor}-${transport}` : undefined}
                    title={blocker || undefined}
                    onClick={() => { if (!blocker) report(onSwitchTransport(vendor, transport)); }}
                  >
                    {transport.toUpperCase()}
                  </button>
                );
              })}
            </div>
            {state === "mixed" ? <span className="settings-plan__state" id={`${id}-${vendor}-state`}>Mixed</span> : null}
            {TRANSPORTS.map((transport) => {
              const blocker = transportBlocker(vendor, transport);
              return blocker ? <span key={transport} className="sr-only" id={`${id}-${vendor}-${transport}`}>{blocker}</span> : null;
            })}
          </div>
        );
      })}
      {/* Always rendered so the live region exists before it changes; the key
          re-announces an identical note from a later action. */}
      <p className="settings-plan__note" role="status">
        <span key={note.count}>{noteText}</span>
      </p>
    </div>
  );
}
