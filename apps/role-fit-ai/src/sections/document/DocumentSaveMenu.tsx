import { useState, type FormEvent, type ReactNode } from "react";
import { SaveAll } from "lucide-react";

import { DocumentActionMenu } from "./DocumentActionMenu";

/** A download or export row: the same shape as an Open-menu action. */
export type DocumentSaveAction = {
  key: string;
  icon: ReactNode;
  title: string;
  /** Only when the title is not self-explanatory — most rows need none. */
  description?: string;
  disabled?: boolean;
  onSelect: () => void;
};

export type DocumentSaveMenuProps = {
  label?: string;
  tooltip: string;
  icon: ReactNode;
  disabled?: boolean;
  title: string;
  description: string;
  /** Writing over the document currently loaded from the workspace. */
  primary: {
    title: string;
    description: string;
    disabled?: boolean;
    onSelect: () => void | Promise<void>;
  };
  /** Saving under a new name, creating a variant beside the existing ones. */
  variant: {
    fieldId: string;
    fieldLabel: string;
    placeholder: string;
    /** Slug the typed label into the file name this document kind uses. */
    fileNameFor: (label: string) => string;
    existingNames: readonly string[];
    disabled?: boolean;
    onSave: (fileNameOrLabel: string) => void | Promise<void>;
  };
  /** Downloads and exports — a file the workspace does not keep. */
  actions: DocumentSaveAction[];
  status?: string;
};

// The one Save menu for both documents: update the active workspace copy, save a
// named variant beside it, or take a file away. Extracted from the resume's menu
// when cover letters gained the same workspace variants, so the two pages cannot
// drift into different save vocabularies.
export function DocumentSaveMenu({
  label = "Save",
  tooltip,
  icon,
  disabled = false,
  title,
  description,
  primary,
  variant,
  actions,
  status
}: DocumentSaveMenuProps) {
  const [variantLabel, setVariantLabel] = useState("");
  const nextName = variant.fileNameFor(variantLabel);
  const variantExists = Boolean(nextName && variant.existingNames.includes(nextName));

  return (
    <DocumentActionMenu label={label} tooltip={tooltip} icon={icon} disabled={disabled}>
      {({ close }) => (
        <div className="document-action-panel document-save-menu">
          <div className="document-action-panel__head">
            <strong>{title}</strong>
            <span>{description}</span>
          </div>

          <button
            type="button"
            className="document-action-row"
            disabled={primary.disabled}
            onClick={() => {
              void Promise.resolve(primary.onSelect()).then(close);
            }}
          >
            {icon}
            <span>
              <strong>{primary.title}</strong>
              <small>{primary.description}</small>
            </span>
          </button>

          <form
            className="document-action-form"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              if (!nextName || variant.disabled) return;
              void Promise.resolve(variant.onSave(nextName)).then(() => {
                setVariantLabel("");
                close();
              });
            }}
          >
            <label htmlFor={variant.fieldId}>
              <span>{variant.fieldLabel}</span>
              <input
                id={variant.fieldId}
                type="text"
                value={variantLabel}
                maxLength={60}
                placeholder={variant.placeholder}
                spellCheck={false}
                disabled={variant.disabled}
                onChange={(event) => setVariantLabel(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="document-action-form__submit"
              disabled={!nextName || variant.disabled}
            >
              <SaveAll size={14} aria-hidden="true" />
              {variantExists ? "Update variant" : "Save variant"}
            </button>
            {nextName ? (
              <small className="document-action-form__hint">
                {variantExists ? "The existing variant is backed up first." : nextName}
              </small>
            ) : null}
          </form>

          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className="document-action-row"
              disabled={action.disabled}
              onClick={() => {
                action.onSelect();
                close();
              }}
            >
              {action.icon}
              <span>
                <strong>{action.title}</strong>
                {action.description ? <small>{action.description}</small> : null}
              </span>
            </button>
          ))}

          {status ? <p className="document-action-panel__status" role="status">{status}</p> : null}
        </div>
      )}
    </DocumentActionMenu>
  );
}
