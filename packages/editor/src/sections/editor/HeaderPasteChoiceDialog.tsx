import type { RefObject } from "react";

import type { TypesetSelection } from "./inlineTextEditing.ts";

export type HeaderPastePrompt = {
  selection: TypesetSelection;
  blocks: string[];
  dividerBlocks: string[];
  x: number;
  y: number;
};

type HeaderPasteChoiceDialogProps = {
  dialogRef: RefObject<HTMLDivElement | null>;
  prompt: HeaderPastePrompt;
  contactDivider: string;
  onChoose: (choice: "inline" | "structure" | "divider") => void;
  onCancel: () => void;
};

export function HeaderPasteChoiceDialog({
  dialogRef,
  prompt,
  contactDivider,
  onChoose,
  onCancel
}: HeaderPasteChoiceDialogProps) {
  return (
    <div
      ref={dialogRef}
      className="ts-paste-choice"
      role="dialog"
      aria-modal="false"
      aria-label="Choose header paste structure"
      tabIndex={-1}
      style={{
        left: Math.max(16, Math.min(prompt.x, window.innerWidth - 300)),
        top: Math.max(16, Math.min(prompt.y + 8, window.innerHeight - 240))
      }}
    >
      <strong>
        {prompt.selection.src.kind === "name"
          ? "Paste into name"
          : "Paste into contact"}
      </strong>
      <p>{prompt.blocks.length} blocks found. Choose how they map.</p>
      <button type="button" data-autofocus onClick={() => onChoose("inline")}>
        Paste into this field
      </button>
      <button type="button" onClick={() => onChoose("structure")}>
        {prompt.selection.src.kind === "name"
          ? "Use first as name; rest as contacts"
          : `Create ${prompt.blocks.length} contact items`}
      </button>
      {prompt.dividerBlocks.length > 1 ? (
        <button type="button" onClick={() => onChoose("divider")}>
          Split on “{contactDivider}” into {prompt.dividerBlocks.length} contacts
        </button>
      ) : null}
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
