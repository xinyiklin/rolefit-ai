import type { TypesetEditorOverlayContext } from "@typeset/editor/sections/editor/TypesetEditor.tsx";
import { PAGE_WIDTH_BP } from "@typeset/engine/typeset/blocks.ts";
import type { ResumePolishScopeMode } from "../../lib/resumePolishScope.ts";
import { resumePolishSectionIsLocked } from "../../../shared/resumePolishContract.ts";

const POLISH_SCOPE_MODES: Array<{ mode: ResumePolishScopeMode; label: string }> = [
  { mode: "polish", label: "Polish" },
  { mode: "include", label: "Include" },
  { mode: "off", label: "Off" }
];

type RoleFitEditorOverlayProps = TypesetEditorOverlayContext & {
  polishScopeModes: Record<string, ResumePolishScopeMode>;
  onSetPolishScopeMode: (sectionId: string, mode: ResumePolishScopeMode) => void;
};

// The shared editor owns every editing and structure control. This overlay is
// deliberately limited to RoleFit's per-section AI scope chrome.
export function RoleFitEditorOverlay({
  data,
  anchors,
  anchor,
  pageOrigins,
  zoom,
  geometry,
  polishScopeModes,
  onSetPolishScopeMode
}: RoleFitEditorOverlayProps) {
  const heading = anchor && anchors ? anchors.headings.get(anchor.sectionId) ?? null : null;
  const headingOrigin = heading ? pageOrigins[heading.page] ?? null : null;
  const sectionMode = anchor ? polishScopeModes[anchor.sectionId] ?? "off" : "off";
  const sectionHeading = anchor
    ? data.sections.find((section) => section.id === anchor.sectionId)?.heading ?? ""
    : "";
  const polishLocked = resumePolishSectionIsLocked(sectionHeading);
  const scopeModes = polishLocked
    ? POLISH_SCOPE_MODES.filter(({ mode }) => mode !== "polish")
    : POLISH_SCOPE_MODES;
  const visibleSectionMode = polishLocked && sectionMode === "polish" ? "include" : sectionMode;

  return (
    <>
      {anchor && heading && headingOrigin ? (
        <div
          className="ts-chrome ts-chrome--chips ts-structure-overlay"
          role="radiogroup"
          aria-label="Section Polish scope"
          style={{
            left: headingOrigin.left,
            top: headingOrigin.top + heading.top * zoom - 2,
            width: PAGE_WIDTH_BP * zoom,
            paddingRight: Math.max(geometry.marginRight * zoom - 4, 0)
          }}
        >
          {scopeModes.map(({ mode, label }, index) => (
            <button
              key={mode}
              type="button"
              role="radio"
              className={`ts-chip${visibleSectionMode === mode ? " is-on" : ""}`}
              aria-checked={visibleSectionMode === mode}
              tabIndex={visibleSectionMode === mode ? 0 : -1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSetPolishScopeMode(anchor.sectionId, mode)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault();
                const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : POLISH_SCOPE_MODES.length - 1;
                const next = (index + delta) % scopeModes.length;
                onSetPolishScopeMode(anchor.sectionId, scopeModes[next].mode);
                (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
