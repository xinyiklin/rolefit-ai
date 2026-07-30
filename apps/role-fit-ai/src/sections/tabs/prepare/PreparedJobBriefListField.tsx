import { useEffect, useState } from "react";

import {
  preparedJobBriefFieldFromText,
  preparedJobBriefFieldToText,
  type PreparedJobBriefField
} from "../../../lib/preparedJobBrief";

type PreparedJobBriefListFieldProps = {
  label: string;
  field: PreparedJobBriefField;
  value: string | string[];
  placeholder: string;
  onChange: (field: PreparedJobBriefField, value: string) => void;
  className?: string;
  instruction?: string | null;
};

export function PreparedJobBriefListField({
  label,
  field,
  value,
  placeholder,
  onChange,
  className = "",
  instruction = "one item per line"
}: PreparedJobBriefListFieldProps) {
  const persistedText = preparedJobBriefFieldToText(value);
  const [draft, setDraft] = useState(persistedText);

  useEffect(() => {
    setDraft(persistedText);
  }, [field, persistedText]);

  function commitDraft() {
    const normalizedText = preparedJobBriefFieldToText(preparedJobBriefFieldFromText(field, draft));
    setDraft(normalizedText);
    if (normalizedText !== persistedText) onChange(field, draft);
  }

  return (
    <label className={`field prepare-brief-list-field ${className}`.trim()}>
      <span>
        {label}
        {instruction ? (
          <>
            {" "}
            <small>{instruction}</small>
          </>
        ) : null}
      </span>
      <textarea
        className="textarea"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        placeholder={placeholder}
      />
    </label>
  );
}
