import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { NavMenu } from "./NavMenu";

// The AI provider menu. A thin shell: the collapsed pill shows a fixed
// "AI Provider" label — no provider or model brand, since those are configured
// per stage inside the popover, whose body is the three ProviderSection blocks
// (Distill / Tailor / Review) passed as children.
type AiMenuProps = {
  children: ReactNode;
};

export function AiMenu({ children }: AiMenuProps) {
  return (
    <NavMenu
      className="ai-menu"
      icon={<Sparkles size={13} aria-hidden={true} />}
      ariaLabel="AI provider and model"
      label={<span className="nav-menu__label">AI Provider</span>}
    >
      {children}
    </NavMenu>
  );
}
