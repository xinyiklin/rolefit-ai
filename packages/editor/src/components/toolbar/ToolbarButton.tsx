import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ToolbarButtonTone = "default" | "primary";

export type ToolbarButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  showLabel?: boolean;
  pressed?: boolean;
  shortcut?: string;
  tooltip?: string;
  tone?: ToolbarButtonTone;
};

/** Compact editor command with a consistent icon, pressed state, and tooltip. */
export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton(
  {
    label,
    icon,
    trailingIcon,
    showLabel = false,
    pressed,
    shortcut,
    tooltip = label,
    tone = "default",
    className = "",
    type = "button",
    ...buttonProps
  },
  ref
) {
  const tooltipId = `toolbar-tooltip-${useId()}`;
  const describedBy = [buttonProps["aria-describedby"], shortcut ? tooltipId : null].filter(Boolean).join(" ") || undefined;

  return (
    <span className="toolbar-tooltip">
      <button
        {...buttonProps}
        ref={ref}
        type={type}
        className={`toolbar-button toolbar-button--${showLabel ? "text" : "icon"} toolbar-button--${tone}${
          pressed ? " is-pressed" : ""
        }${className ? ` ${className}` : ""}`}
        aria-label={buttonProps["aria-label"] ?? label}
        aria-pressed={pressed}
        aria-describedby={describedBy}
      >
        {icon ? (
          <span className="toolbar-button__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {showLabel ? <span className="toolbar-button__label">{label}</span> : null}
        {trailingIcon ? (
          <span className="toolbar-button__trailing" aria-hidden="true">
            {trailingIcon}
          </span>
        ) : null}
      </button>
      <span id={tooltipId} className="toolbar-tooltip__bubble" role="tooltip">
        <span aria-hidden="true">{tooltip}</span>
        {shortcut ? (
          <>
            <span className="sr-only">Keyboard shortcut {shortcut}</span>
            <kbd className="toolbar-tooltip__shortcut" aria-hidden="true">
              {shortcut}
            </kbd>
          </>
        ) : null}
      </span>
    </span>
  );
});
