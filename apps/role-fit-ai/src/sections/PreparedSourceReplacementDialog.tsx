import { useRef } from "react";
import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";

export type PreparedSourceReplacementChoice = "keep-current" | "start-new" | "cancel";

type PreparedSourceReplacementDialogProps = {
  onChoose: (choice: PreparedSourceReplacementChoice) => void;
};

export function PreparedSourceReplacementDialog({
  onChoose
}: PreparedSourceReplacementDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const handleKeyDown = useModalFocus({
    active: true,
    containerRef: cardRef,
    initialFocusRef: keepRef,
    onClose: () => onChoose("cancel")
  });

  return (
    <div
      className="rename-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prepared-source-replacement-title"
      onKeyDown={handleKeyDown}
    >
      <div
        className="rename-dialog__backdrop"
        aria-hidden="true"
        onMouseDown={() => onChoose("cancel")}
      />
      <div className="rename-dialog__card preparation-duplicate-dialog" ref={cardRef} tabIndex={-1}>
        <p className="rename-dialog__head" id="prepared-source-replacement-title">
          This appears to be a different job.
        </p>
        <p className="confirm-dialog__message">
          Updating would replace the posting attached to this saved record.
        </p>
        <footer className="rename-dialog__actions preparation-duplicate-dialog__actions">
          <button type="button" className="ghost-button is-compact" onClick={() => onChoose("cancel")}>
            Cancel
          </button>
          <button type="button" className="secondary-button is-compact" onClick={() => onChoose("start-new")}>
            Start a new preparation
          </button>
          <button ref={keepRef} type="button" className="primary-button is-compact" onClick={() => onChoose("keep-current")}>
            Keep the current posting
          </button>
        </footer>
      </div>
    </div>
  );
}
