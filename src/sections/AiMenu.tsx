import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { providerOptions } from "../config/aiOptions";
import { NavMenu } from "./NavMenu";
import type { AiProviderValue } from "../config/aiOptions";

// The AI provider menu. A thin shell: the collapsed pill shows the Tailor
// (primary) provider + model, and the popover body is the three per-stage
// ProviderSection blocks (Distill / Tailor / Review) passed as children.
type AiMenuProps = {
  aiProvider: AiProviderValue;
  selectedModel: string;
  customModel: string;
  children: ReactNode;
};

export function AiMenu({ aiProvider, selectedModel, customModel, children }: AiMenuProps) {
  const selectedProviderOption = providerOptions.find((option) => option.value === aiProvider);
  const modelLabel = selectedModel === "custom" ? customModel || "custom" : selectedModel || "default";

  return (
    <NavMenu
      className="ai-menu"
      icon={<Sparkles size={13} aria-hidden={true} />}
      ariaLabel="AI provider and model"
      label={
        <>
          <span className="nav-menu__label">{selectedProviderOption?.label ?? aiProvider}</span>
          <span className="nav-menu__sub is-meta">{modelLabel}</span>
        </>
      }
    >
      {children}
    </NavMenu>
  );
}
