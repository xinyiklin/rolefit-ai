import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import {
  preparedJobBriefFieldFromText,
  preparedJobBriefFieldToText,
  type PreparedJobBriefField
} from "../../../lib/preparedJobBrief";

type PreparedJobBriefRowsProps = {
  label: string;
  field: PreparedJobBriefField;
  value: string | string[];
  placeholder: string;
  onChange: (field: PreparedJobBriefField, value: string) => void;
};

// One extracted item per row. Rows are transient text until the user commits,
// so a blank row appended by Add item survives normalization (which drops empty
// items) and stays editable instead of vanishing on the next render.
export function PreparedJobBriefRows({ label, field, value, placeholder, onChange }: PreparedJobBriefRowsProps) {
  const persistedText = preparedJobBriefFieldToText(value);
  const [rows, setRows] = useState<string[]>(() => splitRows(persistedText));
  const focusRowRef = useRef<number | null>(null);
  const rowRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setRows(splitRows(persistedText));
  }, [field, persistedText]);

  useEffect(() => {
    if (focusRowRef.current === null) return;
    rowRefs.current[focusRowRef.current]?.focus();
    focusRowRef.current = null;
  });

  function commitRows(nextRows: string[]) {
    const nextText = nextRows.join("\n");
    const normalizedText = preparedJobBriefFieldToText(preparedJobBriefFieldFromText(field, nextText));
    if (normalizedText !== persistedText) onChange(field, nextText);
  }

  function updateRow(index: number, text: string) {
    setRows((current) => current.map((row, position) => (position === index ? text : row)));
  }

  function removeRow(index: number) {
    const nextRows = rows.filter((_row, position) => position !== index);
    setRows(nextRows);
    commitRows(nextRows);
  }

  function addRow() {
    focusRowRef.current = rows.length;
    setRows((current) => [...current, ""]);
  }

  return (
    <div className="prepare-brief-rows">
      {rows.length ? (
        <ul className="prepare-brief-rows__list">
          {rows.map((row, index) => (
            // Rows are positional: an index key is the identity here, because the
            // same text may legitimately appear twice while the user is editing.
            <li className="prepare-brief-row" key={index}>
              <span className="prepare-brief-row__marker" aria-hidden="true" />
              <input
                className="text-input"
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                value={row}
                aria-label={`${label} item ${index + 1}`}
                placeholder={placeholder}
                onChange={(event) => updateRow(index, event.target.value)}
                onBlur={() => commitRows(rows)}
              />
              <button
                className="ghost-button is-icon prepare-brief-row__remove"
                type="button"
                aria-label={`Remove ${label} item ${index + 1}`}
                onClick={() => removeRow(index)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="prepare-brief-rows__empty">No {label.toLowerCase()} captured. Add the ones that matter.</p>
      )}
      <button className="ghost-button is-compact prepare-brief-rows__add" type="button" onClick={addRow}>
        <Plus size={13} aria-hidden="true" />
        Add item
      </button>
    </div>
  );
}

function splitRows(text: string): string[] {
  return text ? text.split("\n") : [];
}
