import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

type MastheadProps = {
  railCollapsed: boolean;
  // False at narrow widths, where the rail is always the icon strip.
  canToggleRail: boolean;
  onToggleRail: () => void;
};

// The head of the studio rail. The brand itself is the rail's collapse toggle:
// on hover or keyboard focus its tile turns into the sidebar icon. The global
// Apply action floats over the workspace (ApplyAction).
export function Masthead({ railCollapsed, canToggleRail, onToggleRail }: MastheadProps) {
  const toggleLabel = railCollapsed ? "Expand sidebar" : "Collapse sidebar";
  const brand = (
    <>
      <span className="masthead__mark" aria-hidden="true">
        <span className="masthead__mark-letter">R</span>
        {canToggleRail ? (
          <span className="masthead__mark-icon">
            {railCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </span>
        ) : null}
      </span>
      <span className="masthead__wordmark" aria-hidden="true">RoleFit AI</span>
    </>
  );

  return (
    <div className="masthead">
      <h1 className="sr-only">RoleFit AI</h1>
      {canToggleRail ? (
        <button
          type="button"
          className="masthead__brand masthead__brand--toggle"
          onClick={onToggleRail}
          aria-label={toggleLabel}
          aria-expanded={!railCollapsed}
          title={toggleLabel}
        >
          {brand}
        </button>
      ) : (
        <div className="masthead__brand">{brand}</div>
      )}
    </div>
  );
}
