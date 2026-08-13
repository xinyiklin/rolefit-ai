import type { ReactNode, RefObject } from "react";
import { FileDown, FilePlus2, FolderOpen, Save, Upload } from "lucide-react";

import { DocumentActionMenu } from "@typeset/editor/components/toolbar/DocumentActionMenu.tsx";

type ActionRowProps = {
  icon: ReactNode;
  title: string;
  description?: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
};

function ActionRow({ icon, title, description, disabled = false, busy = false, onClick }: ActionRowProps) {
  return (
    <button
      type="button"
      className="document-action-row"
      disabled={disabled}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {icon}
      <span>
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </button>
  );
}

type DocumentFileMenusProps = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onNew: () => void;
  onSave: () => void;
  onExport: () => void;
  saveDisabled: boolean;
  exportDisabled: boolean;
  isSaving: boolean;
  isExporting: boolean;
};

export function DocumentFileMenus({
  fileInputRef,
  onNew,
  onSave,
  onExport,
  saveDisabled,
  exportDisabled,
  isSaving,
  isExporting
}: DocumentFileMenusProps) {
  return (
    <>
      <DocumentActionMenu
        label="Open"
        tooltip="Open a resume"
        icon={<FolderOpen size={16} />}
      >
        {({ close }) => (
          <div className="document-action-panel document-open-menu">
            <div className="document-action-panel__head">
              <strong>Open resume</strong>
              <span>Start fresh or choose an existing .resume file.</span>
            </div>
            <ActionRow
              icon={<FilePlus2 size={15} aria-hidden="true" />}
              title="New resume"
              description="Start with the built-in resume template."
              onClick={() => {
                onNew();
                close();
              }}
            />
            <ActionRow
              icon={<Upload size={15} aria-hidden="true" />}
              title="Choose a file"
              description="Open a .resume file from your device."
              onClick={() => {
                fileInputRef.current?.click();
                close();
              }}
            />
          </div>
        )}
      </DocumentActionMenu>

      <DocumentActionMenu
        label="Save"
        tooltip="Save the resume"
        icon={<Save size={16} />}
        disabled={saveDisabled && exportDisabled}
      >
        {({ close }) => (
          <div className="document-action-panel document-save-menu">
            <div className="document-action-panel__head">
              <strong>Save resume</strong>
              <span>Keep an editable file or export a PDF.</span>
            </div>
            <ActionRow
              icon={<Save size={15} aria-hidden="true" />}
              title={isSaving ? "Saving…" : "Save .resume"}
              description="Download the editable source file."
              disabled={saveDisabled || isSaving}
              busy={isSaving}
              onClick={() => {
                onSave();
                close();
              }}
            />
            <ActionRow
              icon={<FileDown size={15} aria-hidden="true" />}
              title={isExporting ? "Exporting PDF…" : "Export PDF"}
              description="Download the resume as a finished PDF."
              disabled={exportDisabled || isExporting}
              busy={isExporting}
              onClick={() => {
                onExport();
                close();
              }}
            />
          </div>
        )}
      </DocumentActionMenu>
    </>
  );
}
