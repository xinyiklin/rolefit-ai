import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

// One modal shell for every dialog / system message: a dimmed backdrop, a
// centered panel with a titled header + close button, Escape-to-close, and
// click-outside-to-close. Callers fill the body (and any footer) via children,
// using the `.modal__body` / `.modal__foot` classes for consistent spacing.
export function Modal({
  title,
  onClose,
  children
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panelRef.current)?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"
        )
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return (
    // Backdrop closes on click; the panel stops propagation so inner clicks don't.
    <div className="overlay" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="modal modal--sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal__head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
