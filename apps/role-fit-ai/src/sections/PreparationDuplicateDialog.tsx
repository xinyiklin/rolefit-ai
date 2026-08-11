import { useRef } from "react";
import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";
import type {
  DuplicatePreparationChoice,
  DuplicatePreparationPrompt
} from "../hooks/useDuplicateGuard";

type PreparationDuplicateDialogProps = {
  prompt: DuplicatePreparationPrompt;
  onChoose: (choice: DuplicatePreparationChoice) => void;
};

export function PreparationDuplicateDialog({
  prompt,
  onChoose
}: PreparationDuplicateDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const handleKeyDown = useModalFocus({
    active: true,
    containerRef: cardRef,
    initialFocusRef: primaryRef,
    onClose: () => onChoose("cancel")
  });

  const choices: Array<{
    choice: DuplicatePreparationChoice;
    label: string;
    primary?: boolean;
  }> = prompt.kind === "existing-application"
    ? [
        { choice: "cancel", label: "Cancel" },
        { choice: "open-existing", label: "Open existing application" },
        { choice: "continue-new", label: "Continue with new preparation", primary: true }
      ]
    : prompt.kind === "existing-draft"
      ? [
          { choice: "cancel", label: "Cancel" },
          { choice: "continue-existing", label: "Continue existing preparation", primary: true }
        ]
      : prompt.kind === "existing-not-applying"
        ? [
            { choice: "cancel", label: "Cancel" },
            { choice: "open-existing", label: "Open saved record" },
            { choice: "review-again", label: "Review again", primary: true }
          ]
        : [
            { choice: "cancel", label: "Cancel" },
            { choice: "separate", label: "No, keep separate" },
            { choice: "link", label: "Yes, link records", primary: true }
          ];

  return (
    <div
      className="rename-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preparation-duplicate-title"
      onKeyDown={handleKeyDown}
    >
      <div
        className="rename-dialog__backdrop"
        aria-hidden="true"
        onMouseDown={() => onChoose("cancel")}
      />
      <div
        className="rename-dialog__card preparation-duplicate-dialog"
        ref={cardRef}
        tabIndex={-1}
      >
        <p className="rename-dialog__head" id="preparation-duplicate-title">
          {prompt.title}
        </p>
        <p className="confirm-dialog__message">{prompt.message}</p>
        <footer className="rename-dialog__actions preparation-duplicate-dialog__actions">
          {choices.map((choice) => (
            <button
              key={choice.choice}
              ref={choice.primary ? primaryRef : undefined}
              type="button"
              className={choice.primary ? "primary-button is-compact" : "ghost-button is-compact"}
              onClick={() => onChoose(choice.choice)}
            >
              {choice.label}
            </button>
          ))}
        </footer>
      </div>
    </div>
  );
}
