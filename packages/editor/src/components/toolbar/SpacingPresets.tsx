import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { DocStyleControls } from "../../hooks/useDocStyle";
import {
  MAX_SAVED_SPACING_PRESETS,
  MAX_SPACING_PRESET_NAME_LENGTH,
  normalizeSpacingPresetName
} from "../../hooks/spacingPresets.ts";
import { DOC_SPACING_PRESETS } from "@typeset/engine/lib/documentStyle.ts";
import { BUILT_IN_SPACING_PRESET_OPTIONS, spacingMatches } from "./styleOptions";

type RowMode = { id: string; kind: "rename" | "delete" } | null;

// Commits on unmount so Enter, blur, and the popover closing on Escape all keep
// the draft; an empty or unchanged draft commits nothing.
function PresetNameInput({
  name,
  onCommit,
  onDone
}: {
  name: string;
  onCommit: (name: string) => void;
  onDone: (returnFocus: boolean) => void;
}) {
  const [draft, setDraft] = useState(name);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const nameRef = useRef(name);
  nameRef.current = name;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => () => {
    const next = normalizeSpacingPresetName(draftRef.current);
    if (next && next !== nameRef.current) onCommitRef.current(next);
  }, []);

  return (
    <input
      className="style-popover__preset-name-input"
      aria-label="Preset name"
      autoFocus
      value={draft}
      placeholder={name}
      maxLength={MAX_SPACING_PRESET_NAME_LENGTH}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        onDone(true);
      }}
      onBlur={() => onDone(false)}
    />
  );
}

export function SpacingPresets({
  docStyle,
  idPrefix,
  disabled
}: {
  docStyle: DocStyleControls;
  idPrefix: string;
  disabled: boolean;
}) {
  const { spacingPresets, style } = docStyle;
  const [mode, setMode] = useState<RowMode>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // Focus moves after the row it targets has re-rendered; a disabled target
  // falls back to the section's first enabled button so focus never drops.
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (!focusId) return;
    const target = document.getElementById(focusId);
    const enabled = target instanceof HTMLButtonElement ? !target.disabled : Boolean(target);
    (enabled ? target : sectionRef.current?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus();
    setFocusId(null);
  }, [focusId]);

  const rowId = (id: string, part: string) => `${idPrefix}-preset-${id}-${part}`;
  const saveId = `${idPrefix}-preset-save`;
  const atCap = spacingPresets.length >= MAX_SAVED_SPACING_PRESETS;
  const alreadyPreset =
    BUILT_IN_SPACING_PRESET_OPTIONS.some(({ value }) => spacingMatches(style, DOC_SPACING_PRESETS[value].values)) ||
    spacingPresets.some((preset) => spacingMatches(style, preset.values));

  const saveCurrent = () => {
    const saved = docStyle.saveSpacingPreset();
    if (saved) setMode({ id: saved.id, kind: "rename" });
  };

  return (
    <section ref={sectionRef} className="style-popover__section" aria-labelledby={`${idPrefix}-preset`}>
      <div className="style-popover__section-head">
        <h3 id={`${idPrefix}-preset`} className="style-popover__section-title">Spacing preset</h3>
        <button
          id={saveId}
          type="button"
          className="style-popover__secondary"
          disabled={disabled || atCap || alreadyPreset}
          title={
            atCap
              ? `Up to ${MAX_SAVED_SPACING_PRESETS} saved presets`
              : alreadyPreset
                ? "Current spacing is already a preset"
                : undefined
          }
          onClick={saveCurrent}
        >
          <Plus size={13} aria-hidden="true" />
          Save current
        </button>
      </div>
      <div className="style-popover__segmented" role="group" aria-label="Built-in presets">
        {BUILT_IN_SPACING_PRESET_OPTIONS.map((option) => {
          const values = DOC_SPACING_PRESETS[option.value].values;
          const selected = spacingMatches(style, values);
          return (
            <button
              key={option.value}
              type="button"
              className={selected ? "is-selected" : ""}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => docStyle.applyStyle(values)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {spacingPresets.length > 0 && (
        <ul className="style-popover__preset-list" aria-label="Saved presets">
          {spacingPresets.map((preset) => {
            const selected = spacingMatches(style, preset.values);
            if (mode?.id === preset.id && mode.kind === "rename") {
              return (
                <li key={preset.id} className="style-popover__preset-row">
                  <PresetNameInput
                    name={preset.name}
                    onCommit={(name) => docStyle.renameSpacingPreset(preset.id, name)}
                    onDone={(returnFocus) => {
                      setMode(null);
                      if (returnFocus) setFocusId(rowId(preset.id, "apply"));
                    }}
                  />
                </li>
              );
            }
            if (mode?.id === preset.id && mode.kind === "delete") {
              const promptId = rowId(preset.id, "prompt");
              return (
                <li key={preset.id} className="style-popover__preset-row">
                  <span id={promptId} className="style-popover__preset-confirm">
                    Delete “{preset.name}”?
                  </span>
                  <button
                    type="button"
                    className="style-popover__preset-danger"
                    aria-describedby={promptId}
                    onClick={() => {
                      docStyle.deleteSpacingPreset(preset.id);
                      setMode(null);
                      setFocusId(saveId);
                    }}
                  >
                    Delete
                  </button>
                  <button
                    id={rowId(preset.id, "cancel")}
                    type="button"
                    className="style-popover__preset-cancel"
                    aria-describedby={promptId}
                    onClick={() => {
                      setMode(null);
                      setFocusId(rowId(preset.id, "delete"));
                    }}
                  >
                    Cancel
                  </button>
                </li>
              );
            }
            return (
              <li key={preset.id} className="style-popover__preset-row">
                <button
                  id={rowId(preset.id, "apply")}
                  type="button"
                  className={`style-popover__preset-apply${selected ? " is-selected" : ""}`}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => docStyle.applyStyle(preset.values)}
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  className="style-popover__preset-icon"
                  aria-label={`Update ${preset.name} with current spacing`}
                  title="Update with current spacing"
                  disabled={disabled || selected}
                  onClick={() => {
                    docStyle.updateSpacingPreset(preset.id);
                    // The button disables itself once the values match.
                    setFocusId(rowId(preset.id, "apply"));
                  }}
                >
                  <Save size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="style-popover__preset-icon"
                  aria-label={`Rename ${preset.name}`}
                  title="Rename"
                  onClick={() => setMode({ id: preset.id, kind: "rename" })}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  id={rowId(preset.id, "delete")}
                  type="button"
                  className="style-popover__preset-icon"
                  aria-label={`Delete ${preset.name}`}
                  title="Delete"
                  onClick={() => {
                    setMode({ id: preset.id, kind: "delete" });
                    setFocusId(rowId(preset.id, "cancel"));
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
