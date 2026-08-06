import type { ReactNode } from "react";

import {
  Popover,
  type PopoverAlign,
  type PopoverRenderProps
} from "@typeset/editor/components/Popover.tsx";
import {
  ToolbarButton,
  type ToolbarButtonTone
} from "@typeset/editor/components/toolbar/ToolbarButton.tsx";

type DocumentActionMenuProps = {
  label: string;
  tooltip: string;
  ariaLabel?: string;
  icon: ReactNode;
  children: ReactNode | ((props: PopoverRenderProps) => ReactNode);
  disabled?: boolean;
  tone?: ToolbarButtonTone;
  align?: PopoverAlign;
  showLabel?: boolean;
};

// Shared action-bar disclosure for RoleFit-owned file workflows. Resume and
// cover-letter menus supply different content, but keep one trigger, focus,
// dismissal, and anchored-surface contract.
export function DocumentActionMenu({
  label,
  tooltip,
  ariaLabel = `${label} options`,
  icon,
  children,
  disabled = false,
  tone = "default",
  align = "end",
  showLabel = true
}: DocumentActionMenuProps) {
  return (
    <Popover
      ariaLabel={ariaLabel}
      align={align}
      className="document-action-menu"
      initialFocus="first"
      trigger={(triggerProps, open) => (
        <ToolbarButton
          {...triggerProps}
          label={label}
          tooltip={tooltip}
          icon={icon}
          showLabel={showLabel}
          tone={tone}
          className={open ? "is-active" : ""}
          disabled={disabled}
        />
      )}
    >
      {children}
    </Popover>
  );
}
