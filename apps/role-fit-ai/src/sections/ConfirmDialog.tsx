/**
 * ConfirmDialog — presentational modal for the useDialog system.
 *
 * Reuses the `.rename-dialog` shell exactly as ApplyDownloadDialog does:
 * `.rename-dialog` wrapper → backdrop → `.rename-dialog__card`.
 * The card is self-contained with its own focus trap and Escape handler.
 *
 * Accessibility:
 *   - role="dialog" aria-modal="true"
 *   - Focus lands on the confirm/primary button on open (setTimeout so the
 *     portal is already in the DOM)
 *   - Escape key cancels (or confirms for alert kind)
 *   - Tab / Shift-Tab are trapped within the card
 *   - Focus is restored to the previously focused element on close
 */
import { useRef } from "react";
import type { DialogTone } from "../hooks/useDialog";
import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";

type ConfirmDialogProps = {
  kind: "confirm" | "alert";
  title?: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone: DialogTone;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  kind,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const handleKeyDown = useModalFocus({
    active: true,
    containerRef: cardRef,
    initialFocusRef: confirmBtnRef,
    onClose: onCancel
  });

  const isDanger = tone === "danger";

  return (
    <div
      className="rename-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? (kind === "confirm" ? "Confirm action" : "Alert")}
      onKeyDown={handleKeyDown}
    >
      <div className="rename-dialog__backdrop" aria-hidden="true" onMouseDown={onCancel} />
      <div className="rename-dialog__card" ref={cardRef} tabIndex={-1}>
        {title && (
          <p className="rename-dialog__head">{title}</p>
        )}
        <p className="confirm-dialog__message">{message}</p>
        <footer className="rename-dialog__actions">
          {kind === "confirm" && (
            <button
              type="button"
              className="ghost-button is-compact"
              onClick={onCancel}
            >
              {cancelLabel ?? "Cancel"}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            className={
              isDanger
                ? "primary-button is-compact primary-button--danger"
                : "primary-button is-compact"
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
