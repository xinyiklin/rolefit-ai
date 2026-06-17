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
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { DialogTone } from "../hooks/useDialog";

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

// Elements that can receive focus for the trap check.
const FOCUSABLE_SELECTORS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  // Remember what was focused before the dialog opened so we can restore it.
  const previousFocusRef = useRef<Element | null>(null);

  // Capture the currently-focused element and focus the confirm button.
  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    // A small delay lets the portal finish mounting before focusing.
    const id = setTimeout(() => {
      confirmBtnRef.current?.focus();
    }, 16);
    return () => clearTimeout(id);
  }, []);

  // Restore focus when the dialog unmounts.
  useEffect(() => {
    return () => {
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, []);

  // Focus trap + Escape handler on keydown.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key !== "Tab") return;

    const card = cardRef.current;
    if (!card) return;

    const focusable = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey) {
      // Shift+Tab: if at the first element, wrap to last.
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      // Tab: if at the last element, wrap to first.
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  const isDanger = tone === "danger";

  return (
    <div
      className="rename-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? (kind === "confirm" ? "Confirm action" : "Alert")}
      onKeyDown={handleKeyDown}
    >
      <div className="rename-dialog__backdrop" onClick={onCancel} />
      <div className="rename-dialog__card" ref={cardRef}>
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
