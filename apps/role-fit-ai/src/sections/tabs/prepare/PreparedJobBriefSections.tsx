import { useRef, useState, type KeyboardEvent } from "react";

import type { PreparedJobBrief, PreparedJobBriefField } from "../../../lib/preparedJobBrief";
import { PreparedJobBriefRows } from "./PreparedJobBriefRows";

export type PreparedJobBriefSection = {
  field: Exclude<PreparedJobBriefField, "companyContext">;
  label: string;
  placeholder: string;
};

type PreparedJobBriefSectionsProps = {
  sections: readonly PreparedJobBriefSection[];
  brief: PreparedJobBrief;
  onChange: (field: PreparedJobBriefField, value: string) => void;
};

// Each multi-item brief section is its own small tab so the page shows one
// editable list at a time instead of eight stacked textareas. Counts stay on the
// tabs so an empty section is still visible without selecting it.
export function PreparedJobBriefSections({ sections, brief, onChange }: PreparedJobBriefSectionsProps) {
  const [activeField, setActiveField] = useState(sections[0].field);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    sections.findIndex((section) => section.field === activeField)
  );
  const active = sections[activeIndex];

  // APG tabs keyboard model, matching the studio rail: roving tabindex with
  // arrow/Home/End moving selection and focus together.
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = sections.length - 1;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    setActiveField(sections[next].field);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="prepare-brief-sections">
      <div className="prepare-brief-tabs" role="tablist" aria-label="Job description sections">
        {sections.map((section, index) => {
          const selected = section.field === active.field;
          return (
            <button
              aria-controls="prepare-brief-section-panel"
              aria-selected={selected}
              className="prepare-brief-tab"
              id={`prepare-brief-tab-${section.field}`}
              key={section.field}
              onClick={() => setActiveField(section.field)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {section.label}
              <em>{brief[section.field].length}</em>
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby={`prepare-brief-tab-${active.field}`}
        className="prepare-brief-panel"
        id="prepare-brief-section-panel"
        role="tabpanel"
        tabIndex={-1}
      >
        <PreparedJobBriefRows
          field={active.field}
          label={active.label}
          value={brief[active.field]}
          placeholder={active.placeholder}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
