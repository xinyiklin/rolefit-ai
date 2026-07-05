import { groupModelOptions } from "../config/aiOptions";
import type { ModelOption } from "../config/aiOptions";

// Renders a model list as <option>s, wrapping any contiguous run that shares a
// `group` in a labeled <optgroup> (e.g. the Claude CLI "More models" set).
// Returns a fragment meant to sit directly inside a <select>; shared by AiMenu
// and ReviewerSettings so grouped model lists render identically in both.
export function ModelSelectOptions({ options }: { options: readonly ModelOption[] }) {
  return (
    <>
      {groupModelOptions(options).map((segment, index) =>
        segment.type === "option" ? (
          <option key={segment.option.value || `option-${index}`} value={segment.option.value}>
            {segment.option.label}
          </option>
        ) : (
          // Key by index too: a provider list that ever splits one group label
          // into non-contiguous runs would otherwise collide on `group-<label>`.
          <optgroup key={`group-${segment.label}-${index}`} label={segment.label}>
            {segment.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        )
      )}
    </>
  );
}
