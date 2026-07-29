import type {
  Dispatch,
  KeyboardEventHandler,
  RefObject,
  SetStateAction
} from "react";

import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";

export type DocumentPastePrompt = {
  blocks: string[];
  nameIndex: number | null;
  bodyStart: number;
};

type DocumentPasteDialogProps = {
  dialogRef: RefObject<HTMLElement | null>;
  prompt: DocumentPastePrompt;
  contactDivider: string;
  setPrompt: Dispatch<SetStateAction<DocumentPastePrompt | null>>;
  onKeyDown: KeyboardEventHandler<HTMLElement>;
  onCancel: () => void;
  onApply: () => void;
};

export function DocumentPasteDialog({
  dialogRef,
  prompt,
  contactDivider,
  setPrompt,
  onKeyDown,
  onCancel,
  onApply
}: DocumentPasteDialogProps) {
  return (
    <div
      className="ts-document-paste-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="ts-document-paste-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ts-document-paste-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header>
          <strong id="ts-document-paste-title">Paste as document</strong>
          <p>Map the copied blocks explicitly. Nothing is guessed.</p>
        </header>
        <label>
          Name
          <select
            data-autofocus
            value={prompt.nameIndex ?? -1}
            onChange={(event) =>
              setPrompt((current) =>
                current
                  ? {
                      ...current,
                      nameIndex:
                        Number(event.target.value) < 0
                          ? null
                          : Number(event.target.value)
                    }
                  : null
              )
            }
          >
            <option value={-1}>No name</option>
            {prompt.blocks.slice(0, prompt.bodyStart).map((block, index) => (
              <option key={index} value={index}>
                {stripInlineMarks(block).slice(0, 80) || "(blank block)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Body begins at
          <select
            value={prompt.bodyStart}
            onChange={(event) => {
              const bodyStart = Number(event.target.value);
              setPrompt((current) =>
                current
                  ? {
                      ...current,
                      bodyStart,
                      nameIndex:
                        current.nameIndex !== null &&
                        current.nameIndex >= bodyStart
                          ? null
                          : current.nameIndex
                    }
                  : null
              );
            }}
          >
            {prompt.blocks.map((block, index) => (
              <option key={index} value={index}>
                Block {index + 1}: {stripInlineMarks(block).slice(0, 72) || "(blank block)"}
              </option>
            ))}
          </select>
        </label>
        <div className="ts-document-paste-preview">
          <span>Contacts</span>
          <p>
            {prompt.blocks
              .filter(
                (_, index) =>
                  index < prompt.bodyStart &&
                  index !== prompt.nameIndex
              )
              .map((block) => stripInlineMarks(block))
              .join(` ${contactDivider} `) || "None"}
          </p>
          <span>Body</span>
          <p>{prompt.blocks.length - prompt.bodyStart} paragraph(s)</p>
        </div>
        <footer>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onApply}>
            Replace document
          </button>
        </footer>
      </section>
    </div>
  );
}
