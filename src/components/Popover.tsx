import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEventHandler,
  type ReactNode,
  type RefCallback
} from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export type PopoverAlign = "start" | "center" | "end";

export type PopoverTriggerProps = {
  ref: RefCallback<HTMLButtonElement>;
  id: string;
  type: "button";
  "aria-controls": string;
  "aria-expanded": boolean;
  "aria-haspopup": "dialog";
  onClick: MouseEventHandler<HTMLButtonElement>;
};

export type PopoverRenderProps = {
  close: () => void;
};

export type PopoverProps = {
  ariaLabel: string;
  trigger: (props: PopoverTriggerProps, open: boolean) => ReactNode;
  children: ReactNode | ((props: PopoverRenderProps) => ReactNode);
  align?: PopoverAlign;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialFocus?: "panel" | "first" | false;
};

/**
 * An anchored, non-modal disclosure for compact editor controls.
 *
 * The trigger stays in the document flow while the surface is positioned by
 * CSS. Escape and explicit close restore focus; moving focus or clicking to
 * another control closes without stealing that new focus.
 */
export function Popover({
  ariaLabel,
  trigger,
  children,
  align = "start",
  className = "",
  open,
  onOpenChange,
  initialFocus = "panel"
}: PopoverProps) {
  const generatedId = useId();
  const triggerId = `popover-trigger-${generatedId}`;
  const surfaceId = `popover-surface-${generatedId}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(false);
  const wasOpenRef = useRef(open ?? false);
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;

  const updateOpen = useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open]
  );

  const close = useCallback(
    (restoreFocus = true) => {
      restoreFocusRef.current = restoreFocus;
      updateOpen(false);
    },
    [updateOpen]
  );

  useEffect(() => {
    if (isOpen) {
      const frame = window.requestAnimationFrame(() => {
        if (initialFocus === false) return;
        if (initialFocus === "first") {
          const first = surfaceRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
          if (first) {
            first.focus();
            return;
          }
        }
        surfaceRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }

    if (wasOpenRef.current && restoreFocusRef.current) {
      const frame = window.requestAnimationFrame(() => triggerRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
  }, [initialFocus, isOpen]);

  useEffect(() => {
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }

    function onPointerDown(event: PointerEvent) {
      const root = rootRef.current;
      if (!root || event.composedPath().includes(root)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const willReceiveFocus = Boolean(target?.closest(FOCUSABLE_SELECTOR));
      close(!willReceiveFocus);
    }

    function onFocusIn(event: FocusEvent) {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        close(false);
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [close, isOpen]);

  const setTriggerRef: RefCallback<HTMLButtonElement> = (node) => {
    triggerRef.current = node;
  };

  const triggerProps: PopoverTriggerProps = {
    ref: setTriggerRef,
    id: triggerId,
    type: "button",
    "aria-controls": surfaceId,
    "aria-expanded": isOpen,
    "aria-haspopup": "dialog",
    onClick: () => {
      if (isOpen) close(false);
      else {
        restoreFocusRef.current = false;
        updateOpen(true);
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className={`popover popover--${align}${className ? ` ${className}` : ""}${isOpen ? " is-open" : ""}`}
    >
      {trigger(triggerProps, isOpen)}
      {isOpen ? (
        <div
          ref={surfaceRef}
          id={surfaceId}
          className="popover__surface"
          role="dialog"
          aria-modal="false"
          aria-label={ariaLabel}
          tabIndex={-1}
        >
          {typeof children === "function" ? children({ close: () => close(true) }) : children}
        </div>
      ) : null}
    </div>
  );
}
