import { Eye, EyeOff, UserRoundPlus } from "lucide-react";

import type {
  DocumentHeader,
  ResumeSectionType
} from "@typeset/engine/lib/resumeData.ts";
import type { DocStyle } from "@typeset/engine/lib/documentStyle.ts";
import type { HeaderSpacingKey } from "./styleOptions";
import { AddSectionPopover } from "./AddSectionPopover";
import { HeaderStructurePopover } from "./HeaderStructurePopover";
import { ToolbarButton } from "./ToolbarButton";

export type DocumentStructureControlsProps = {
  header: DocumentHeader | null;
  contactDivider: string;
  disabled?: boolean;
  // Supplied by a host whose document has no document-spacing popover of its
  // own: the header's gaps are then adjustable from the header itself.
  headerSpacing?: {
    values: Pick<DocStyle, HeaderSpacingKey>;
    onChange: (key: HeaderSpacingKey, value: number) => void;
  };
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
  const toggleLabel = header
    ? header.visible
      ? "Hide header"
      : "Show header"
    : "Create header";

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
        headerSpacing={headerSpacing}
        onCreateHeader={onCreateHeader}
        onSetHeaderName={onSetHeaderName}
        onRemoveHeaderName={onRemoveHeaderName}
        onUpdateContact={onUpdateContact}
        onInsertContact={onInsertContact}
        onRemoveContact={onRemoveContact}
        onContactDividerChange={onContactDividerChange}
      />
      <ToolbarButton
        className="structure-control__header-toggle"
        label={toggleLabel}
        tooltip={toggleLabel}
        icon={
          header
            ? header.visible
              ? <Eye size={15} />
              : <EyeOff size={15} />
            : <UserRoundPlus size={15} />
        }
        aria-label={toggleLabel}
        aria-pressed={header ? header.visible : undefined}
        disabled={disabled}
        onClick={() => {
          if (!header) onCreateHeader();
          else onSetHeaderVisible(!header.visible);
        }}
      />
      {showSections && onAddSection ? (
        <AddSectionPopover disabled={disabled} onAddSection={onAddSection} />
      ) : null}
    </div>
  );
}
