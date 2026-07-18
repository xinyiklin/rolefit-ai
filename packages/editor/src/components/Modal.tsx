import { useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { useModalFocus } from "../hooks/useModalFocus.ts";

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
  const titleId = useId();
  const handleKeyDown = useModalFocus({
    active: true,
    containerRef: panelRef,
    initialFocusSelector: "[data-autofocus]",
    onClose
  });

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
        onKeyDown={handleKeyDown}
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
