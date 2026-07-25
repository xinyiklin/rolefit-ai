import { useState, type FormEvent } from "react";
import { Download, Save, SaveAll } from "lucide-react";

type ResumeSaveMenuProps = {
  activeBaseLabel: string;
  activeBaseName: string;
  baseResumeNames: string[];
  canSave: boolean;
  isSaving: boolean;
  status: string;
  onSaveCurrent: () => void | Promise<void>;
  onSaveAsVariant: (fileName: string) => void | Promise<void>;
  onDownloadResume: () => void;
};

function variantFileName(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug ? `base-resume-${slug}.resume` : "";
}

export function ResumeSaveMenu({
  activeBaseLabel,
  activeBaseName,
  baseResumeNames,
  canSave,
  isSaving,
  status,
  onSaveCurrent,
  onSaveAsVariant,
  onDownloadResume
}: ResumeSaveMenuProps) {
  const [variantLabel, setVariantLabel] = useState("");
  const nextVariantName = variantFileName(variantLabel);
  const variantExists = Boolean(nextVariantName && baseResumeNames.includes(nextVariantName));

  function saveVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nextVariantName || !canSave || isSaving) return;
    void onSaveAsVariant(nextVariantName);
    setVariantLabel("");
  }

  return (
    <div className="document-action-panel resume-save-menu">
      <div className="document-action-panel__head">
        <strong>Save resume</strong>
        <span>Keep a workspace base or download an editable copy.</span>
      </div>

      <button
        type="button"
        className="document-action-row"
        disabled={!canSave || isSaving}
        onClick={() => void onSaveCurrent()}
      >
        <Save size={15} aria-hidden="true" />
        <span>
          <strong>{activeBaseName ? `Update ${activeBaseLabel}` : "Save as default base"}</strong>
          <small>
            {activeBaseName
              ? "Replaces the active workspace base and keeps the previous version in Recent."
              : "Uses this resume automatically when RoleFit opens."}
          </small>
        </span>
      </button>

      <form className="document-action-form" onSubmit={saveVariant}>
        <label htmlFor="resume-variant-name">
          <span>New base variant</span>
          <input
            id="resume-variant-name"
            type="text"
            value={variantLabel}
            maxLength={60}
            placeholder="e.g. Full stack"
            spellCheck={false}
            disabled={!canSave || isSaving}
            onChange={(event) => setVariantLabel(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="document-action-form__submit"
          disabled={!nextVariantName || !canSave || isSaving}
        >
          <SaveAll size={14} aria-hidden="true" />
          {variantExists ? "Update variant" : "Save variant"}
        </button>
        {nextVariantName ? (
          <small className="document-action-form__hint">
            {variantExists ? "The existing variant is backed up first." : nextVariantName}
          </small>
        ) : null}
      </form>

      <button
        type="button"
        className="document-action-row"
        disabled={!canSave}
        onClick={onDownloadResume}
      >
        <Download size={15} aria-hidden="true" />
        <span>
          <strong>Download .resume</strong>
          <small>Portable editable file with content and formatting.</small>
        </span>
      </button>

      {status ? <p className="document-action-panel__status" role="status">{status}</p> : null}
    </div>
  );
}
