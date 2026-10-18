import type {
  DocumentHeader,
  ResumeSectionType
} from "@typeset/engine/lib/resumeData.ts";
import { AddSectionPopover } from "./AddSectionPopover";
import { HeaderStructurePopover } from "./HeaderStructurePopover";

export type DocumentStructureControlsProps = {
  header: DocumentHeader | null;
  contactDivider: string;
  disabled?: boolean;
  onCreateHeader: () => void;
  onSetHeaderVisible: (visible: boolean) => void;
  onSetHeaderName: (name: string) => void;
  onRemoveHeaderName: () => void;
  onUpdateContact: (index: number, value: string) => void;
  onInsertContact: (index: number) => void;
  onRemoveContact: (index: number) => void;
  onContactDividerChange: (value: string) => void;
  onAddSection?: (type: ResumeSectionType, position: "top" | "bottom") => void;
  showSections?: boolean;
};

// The always-visible toolbar composes focused header and section popovers; each
// child owns only its own transient UI state while this boundary keeps the
// shared host command contract.
export function DocumentStructureControls({
  header,
  contactDivider,
  disabled = false,
  onCreateHeader,
  onSetHeaderVisible,
  onSetHeaderName,
  onRemoveHeaderName,
  onUpdateContact,
  onInsertContact,
  onRemoveContact,
  onContactDividerChange,
  onAddSection,
  showSections = true
}: DocumentStructureControlsProps) {
  return (
    <div
      className="top-toolbar__group top-toolbar__document-structure"
      role="group"
      aria-label="Document structure"
    >
      <HeaderStructurePopover
        header={header}
        contactDivider={contactDivider}
        disabled={disabled}
        onCreateHeader={onCreateHeader}
        onSetHeaderVisible={onSetHeaderVisible}
        onSetHeaderName={onSetHeaderName}
        onRemoveHeaderName={onRemoveHeaderName}
        onUpdateContact={onUpdateContact}
        onInsertContact={onInsertContact}
        onRemoveContact={onRemoveContact}
        onContactDividerChange={onContactDividerChange}
      />
      {showSections && onAddSection ? (
        <AddSectionPopover disabled={disabled} onAddSection={onAddSection} />
      ) : null}
    </div>
  );
}
