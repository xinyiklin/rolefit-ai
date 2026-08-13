import type { ReactNode } from "react";

import {
  Popover,
  type PopoverAlign,
  type PopoverRenderProps
} from "../Popover";
import {
  ToolbarButton,
  type ToolbarButtonTone
} from "./ToolbarButton";

export type DocumentActionMenuProps = {
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
