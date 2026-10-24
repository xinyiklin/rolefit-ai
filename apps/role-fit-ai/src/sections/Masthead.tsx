import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

type MastheadProps = {
  railCollapsed: boolean;
  // False at narrow widths, where the rail is always the icon strip.
  canToggleRail: boolean;
  onToggleRail: () => void;
};

// The ribbon R from the RoleFit brand kit (desktop/assets/generate_icons.py
// holds the same paths). The rail renders one masthead, so the ids are unique.
function BrandMark() {
  return (
    <svg viewBox="0 0 128 128" width="22" height="22" focusable="false">
      <defs>
        <linearGradient id="masthead-rf-top" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#60AAFF" />
          <stop offset="0.42" stopColor="#367EF7" />
          <stop offset="1" stopColor="#2853E9" />
        </linearGradient>
        <linearGradient id="masthead-rf-stem" x1="0" y1="0" x2="0.9" y2="1">
          <stop stopColor="#3D9BFF" />
          <stop offset="1" stopColor="#325BEA" />
        </linearGradient>
        <linearGradient id="masthead-rf-leg" x1="0" y1="0" x2="0.9" y2="1">
          <stop stopColor="#7475F9" />
          <stop offset="1" stopColor="#3857DE" />
        </linearGradient>
      </defs>
      <path fill="url(#masthead-rf-top)" d="M24 23C24 14 31 10 39 10H78C100 10 113 24 113 45C113 62 104 73 86 78L70 60C83 55 90 51 90 44C90 37 85 33 77 33H48C35 33 27 36 24 39Z" />
      <path fill="url(#masthead-rf-stem)" d="M45 38C26 46 16 57 16 74V104Q16 111 23 111H39Q49 111 49 101V42Q49 37 45 38Z" />
      <path fill="url(#masthead-rf-leg)" d="M69 62C66 65 63 67 62 72C61 76 64 80 67 84L85 107Q88 111 95 111H113Q119 111 115 105L88 64C82 68 77 68 69 62Z" />
    </svg>
  );
}

// The head of the studio rail. The brand itself is the rail's collapse toggle:
// on hover or keyboard focus its mark turns into the sidebar icon. The global
// Apply action floats over the workspace (ApplyAction).
export function Masthead({ railCollapsed, canToggleRail, onToggleRail }: MastheadProps) {
  const toggleLabel = railCollapsed ? "Expand sidebar" : "Collapse sidebar";
  const brand = (
    <>
      <span className="masthead__mark" aria-hidden="true">
        <span className="masthead__mark-letter"><BrandMark /></span>
        {canToggleRail ? (
          <span className="masthead__mark-icon">
            {railCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </span>
        ) : null}
      </span>
      <span className="masthead__wordmark" aria-hidden="true">RoleFit</span>
    </>
  );

  return (
    <div className="masthead">
      <h1 className="sr-only">RoleFit</h1>
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
