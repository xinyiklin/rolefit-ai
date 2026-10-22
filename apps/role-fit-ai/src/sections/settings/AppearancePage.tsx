import { APPEARANCE_OPTIONS, type Appearance } from "../../hooks/useAppearance";
import type { SettingsDialogProps } from "../SettingsDialog";

type AppearancePageProps = Pick<SettingsDialogProps, "appearance" | "onAppearanceChange">;

const APPEARANCE_LABELS: Record<Appearance, string> = {
  system: "System",
  light: "Light",
  dark: "Dark"
};

export function AppearancePage({ appearance, onAppearanceChange }: AppearancePageProps) {
  return (
    <>
      <p className="settings-panel__intro">
        Saved in this browser, not the workspace. System follows your computer&rsquo;s setting.
      </p>
      <div className="settings-appearance">
        <span id="settings-appearance-label">Theme</span>
        <div className="settings-segment" role="group" aria-labelledby="settings-appearance-label">
          {APPEARANCE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className="settings-segment__option"
              aria-pressed={appearance === option}
              onClick={() => onAppearanceChange(option)}
            >
              {APPEARANCE_LABELS[option]}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
