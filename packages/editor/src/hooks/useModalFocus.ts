import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

type ModalStackEntry = {
  id: symbol;
  focusFirst: () => void;
};

// Hosts can layer modal surfaces (for example, a preview over an application
// dialog). Only the topmost surface may trap focus or respond to Escape.
const modalStack: ModalStackEntry[] = [];
let bodyOverflowBeforeFirstModal: string | null = null;

export type UseModalFocusOptions = {
  active: boolean;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  initialFocusSelector?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  selectInitialText?: boolean;
};

function visibleFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true"
  );
}

/**
 * Shared modal keyboard contract: remember/restore focus, place focus inside on
 * open, prevent focus from escaping, wrap Tab/Shift+Tab, close only the topmost
 * surface on Escape, and suppress background document scrolling.
 *
 * The hook deliberately owns behavior rather than dialog markup. Hosts keep
 * their own modal composition and visual language and attach the returned
 * handler to the element carrying `role="dialog"`.
 */
export function useModalFocus({
  active,
  containerRef,
  initialFocusRef,
  initialFocusSelector,
  returnFocusRef,
  onClose,
  selectInitialText = false
}: UseModalFocusOptions) {
  const instanceId = useRef(Symbol("typeset-modal"));
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const isTopmost = useCallback(
    () => modalStack[modalStack.length - 1]?.id === instanceId.current,
    []
  );

  const focusFirst = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const selected = initialFocusSelector
      ? container.querySelector<HTMLElement>(initialFocusSelector)
      : null;
    const target = initialFocusRef?.current ?? selected ?? visibleFocusable(container)[0] ?? container;
    target.focus();
    if (selectInitialText && target instanceof HTMLInputElement) target.select();
  }, [containerRef, initialFocusRef, initialFocusSelector, selectInitialText]);

  useEffect(() => {
    if (!active) return;
    const id = instanceId.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (modalStack.length === 0) bodyOverflowBeforeFirstModal = document.body.style.overflow;
    modalStack.push({ id, focusFirst });
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(focusFirst);
    function keepFocusInside(event: FocusEvent) {
      if (!isTopmost()) return;
      const container = containerRef.current;
      if (container && event.target instanceof Node && !container.contains(event.target)) focusFirst();
    }
    document.addEventListener("focusin", keepFocusInside);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("focusin", keepFocusInside);
      const index = modalStack.findIndex((entry) => entry.id === id);
      const wasTopmost = index === modalStack.length - 1;
      if (index >= 0) modalStack.splice(index, 1);

      if (modalStack.length === 0) {
        document.body.style.overflow = bodyOverflowBeforeFirstModal ?? "";
        bodyOverflowBeforeFirstModal = null;
        (returnFocusRef?.current ?? previouslyFocused)?.focus();
      } else {
        // A lower modal may unmount while another surface remains open. Keep
        // the global scroll lock, and only move focus when the closed surface
        // was the topmost one.
        document.body.style.overflow = "hidden";
        if (wasTopmost) {
          const returnTarget = returnFocusRef?.current ?? previouslyFocused;
          if (returnTarget?.isConnected) returnTarget.focus();
          else modalStack[modalStack.length - 1]?.focusFirst();
        }
      }
    };
  }, [active, containerRef, focusFirst, isTopmost, returnFocusRef]);

  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!active || !isTopmost()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const container = containerRef.current;
      if (!container) return;
      const focusable = visibleFocusable(container);
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
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
    },
    [active, containerRef, isTopmost]
  );
}
