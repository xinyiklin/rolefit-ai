import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type MenuSectionProps = {
  title: string;
  // Compact right-aligned summary of the current setting (e.g. the effective
  // provider), shown on the header line while the section is collapsed so it
  // still reads at a glance without expanding.
  summary?: ReactNode;
  // Control rendered on the title line while the section is open (e.g. the copy
  // buttons). Rendered as a sibling of the toggle button — never nested — so its
  // own clicks don't collapse the section.
  headerControl?: ReactNode;
  // Collapse state is owned by the caller so it can be persisted.
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

// A collapsible section inside a menu popover. The title toggles the body; when
// collapsed the header shows the effective setting, when open it shows the
// header control. Used for the AI menu's per-stage provider blocks (Distill /
// Tailor / Review), each independently expandable.
export function MenuSection({ title, summary, headerControl, open, onToggle, children }: MenuSectionProps) {
  return (
    <div className={`menu-section${open ? " is-open" : ""}`}>
      <div className="menu-section__header">
        <button type="button" className="menu-section__toggle" aria-expanded={open} onClick={onToggle}>
          <span className="menu-subhead__title">{title}</span>
          <ChevronDown size={14} aria-hidden={true} className="menu-section__chev" />
        </button>
        {open
          ? headerControl ?? null
          : summary
            ? <span className="menu-section__value">{summary}</span>
            : null}
      </div>
      {open ? <div className="menu-section__body">{children}</div> : null}
    </div>
  );
}
