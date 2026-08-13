import type {
  DocumentHeader,
  ResumeSectionType
} from "@typeset/engine/lib/resumeData.ts";
import type { DocStyle } from "@typeset/engine/lib/documentStyle.ts";
import type { HeaderSpacingKey } from "./styleOptions";
import { AddSectionPopover } from "./AddSectionPopover";
import { HeaderStructurePopover } from "./HeaderStructurePopover";

export type DocumentStructureControlsProps = {
  header: DocumentHeader | null;
  contactDivider: string;
  disabled?: boolean;
  allowNameRemoval?: boolean;
  // Supplied by a host whose document has no document-spacing popover of its
  // own: the header's gaps are then adjustable from the header itself.
  headerSpacing?: {
    values: Pick<DocStyle, HeaderSpacingKey>;
    onChange: (key: HeaderSpacingKey, value: number) => void;
  };
  onCreateHeader: () => void;
  onSetHeaderVisible: (visible: boolean) => void;
  onSetHeaderName: (name: string) => void;
  onRemoveHeaderName?: () => void;
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
  allowNameRemoval = false,
  headerSpacing,
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
        allowNameRemoval={allowNameRemoval}
        headerSpacing={headerSpacing}
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
