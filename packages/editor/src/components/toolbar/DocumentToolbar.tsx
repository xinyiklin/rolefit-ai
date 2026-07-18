import type { ReactNode } from "react";
import {
  CheckCircle2,
  CircleDot,
  LoaderCircle,
  TriangleAlert
} from "lucide-react";

import type { DocStyleControls } from "../../hooks/useDocStyle";
import type { ResumeSectionType } from "@typeset/engine/lib/resumeData.ts";
import { DocumentStructureControls } from "./DocumentStructureControls";

export type ToolbarSaveState = "saved" | "saving" | "unsaved" | "error";

export type ToolbarSaveStatus =
  | ToolbarSaveState
  | {
      state: ToolbarSaveState;
      label?: string;
    };

export type DocumentStructureToolbarControls = {
  name: string;
  contact: string[];
  disabled?: boolean;
  onSetName: (name: string) => void;
  onUpdateContact: (index: number, value: string) => void;
  onAddContact: () => void;
  onRemoveContact: (index: number) => void;
  onAddSection: (type: ResumeSectionType, position: "top" | "bottom") => void;
};

export type DocumentToolbarProps = {
  productName?: string;
  documentTitle: string;
  documentContext?: string;
  onDocumentTitleChange?: (title: string) => void;
  saveStatus?: ToolbarSaveStatus;
  documentStructure?: DocumentStructureToolbarControls;
  docStyle: DocStyleControls;
  actions?: ReactNode;
};

const SAVE_STATUS_LABELS: Record<ToolbarSaveState, string> = {
  saved: "Saved locally",
  saving: "Saving locally",
  unsaved: "Unsaved changes",
  error: "Save failed"
};

const UNTITLED_DOCUMENT_TITLE = "Untitled resume";

function SaveStatus({ status }: { status: ToolbarSaveStatus }) {
  const state = typeof status === "string" ? status : status.state;
  const label = typeof status === "string" ? SAVE_STATUS_LABELS[status] : status.label ?? SAVE_STATUS_LABELS[state];
  const icon = {
    saved: <CheckCircle2 size={13} />,
    saving: <LoaderCircle size={13} />,
    unsaved: <CircleDot size={13} />,
    error: <TriangleAlert size={13} />
  }[state];

  return (
    <span className={`top-toolbar__save-status top-toolbar__save-status--${state}`} role="status" aria-live="polite">
      <span className="top-toolbar__save-status-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </span>
  );
}

// The shared document row: document identity, header/section structure, and a
// host-owned action cluster. The standalone app supplies the Typeset wordmark
// and file buttons; embedded hosts can omit the product name and keep their own
// file lifecycle without duplicating this chrome.
export function DocumentToolbar({
  productName,
  documentTitle,
  documentContext,
  onDocumentTitleChange,
  saveStatus,
  documentStructure,
  docStyle,
  actions
}: DocumentToolbarProps) {
  return (
    <div className="top-toolbar__primary-row">
      <div className="top-toolbar__identity">
        {productName ? (
          <>
            <span className="top-toolbar__product-name">{productName}</span>
            <span className="top-toolbar__identity-divider" aria-hidden="true" />
          </>
        ) : null}
        <div className="top-toolbar__document-meta">
          {onDocumentTitleChange ? (
            <label className="top-toolbar__title-field">
              <span className="sr-only">Document title</span>
              <input
                type="text"
                value={documentTitle}
                size={Math.max(1, Math.min(36, documentTitle.length || 1))}
                maxLength={120}
                spellCheck="false"
                onChange={(event) => onDocumentTitleChange(event.target.value)}
                onBlur={(event) => {
                  if (!event.currentTarget.value.trim()) onDocumentTitleChange(UNTITLED_DOCUMENT_TITLE);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                aria-label="Document title"
              />
            </label>
          ) : (
            <span className="top-toolbar__document-title">{documentTitle}</span>
          )}
          {documentContext ? <span className="top-toolbar__document-context">{documentContext}</span> : null}
          {saveStatus ? <SaveStatus status={saveStatus} /> : null}
        </div>
      </div>

      {documentStructure ? (
        <DocumentStructureControls
          name={documentStructure.name}
          contact={documentStructure.contact}
          contactDivider={docStyle.style.contactDivider}
          disabled={documentStructure.disabled}
          onSetName={documentStructure.onSetName}
          onUpdateContact={documentStructure.onUpdateContact}
          onAddContact={documentStructure.onAddContact}
          onRemoveContact={documentStructure.onRemoveContact}
          onContactDividerChange={(value) => docStyle.set("contactDivider", value)}
          onAddSection={documentStructure.onAddSection}
        />
      ) : null}

      {actions}
    </div>
  );
}
