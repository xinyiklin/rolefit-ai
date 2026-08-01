import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type NavMenuProps = {
  icon: ReactNode;
  label: ReactNode;
  ariaLabel: string;
  // Extra class on the wrapper, for context-specific trigger/popover styling.
  className?: string;
  children: ReactNode;
  // Controlled mode: when provided, the caller owns open state.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  popoverPlacement?: "below" | "right";
};

const VIEWPORT_INSET = 8;
const POPOVER_GAP = 8;

// A dropdown: a trigger plus a popover, closing on outside click or Escape.
// Placement stays here because the trigger owns both the below and rail utility
// geometry, including the fixed-position escape from clipped workspace shells.
export function NavMenu({
  icon,
  label,
  ariaLabel,
  className,
  children,
  open: controlledOpen,
  onOpenChange,
  popoverPlacement = "below"
}: NavMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  function setOpen(value: boolean) {
    if (isControlled) {
      onOpenChange?.(value);
    } else {
      setUncontrolledOpen(value);
    }
  }
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const popover = popoverRef.current;
      const firstControl = popover?.querySelector<HTMLElement>(
        "[data-autofocus], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]"
      );
      (firstControl ?? popover)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  // Below menus keep their existing right-edge anchoring and margin clamp. Rail
  // menus become fixed so overflow-hidden studio ancestors cannot clip them;
  // their lower edge tracks the trigger when the viewport has room.
  useLayoutEffect(() => {
    if (!open) return;
    const clamp = () => {
      const popover = popoverRef.current;
      const trigger = triggerRef.current;
      if (!popover || !trigger) return;

      if (popoverPlacement === "right") {
        const triggerRect = trigger.getBoundingClientRect();
        popover.style.position = "fixed";
        popover.style.left = "0px";
        popover.style.top = "0px";
        popover.style.right = "auto";
        popover.style.bottom = "auto";
        popover.style.marginRight = "0px";
        popover.style.transformOrigin = "bottom left";

        const popoverWidth = popover.offsetWidth;
        const popoverHeight = popover.offsetHeight;
        const maxLeft = Math.max(VIEWPORT_INSET, window.innerWidth - popoverWidth - VIEWPORT_INSET);
        const maxTop = Math.max(VIEWPORT_INSET, window.innerHeight - popoverHeight - VIEWPORT_INSET);
        const left = Math.min(
          Math.max(triggerRect.right + POPOVER_GAP, VIEWPORT_INSET),
          maxLeft
        );
        const top = Math.min(
          Math.max(triggerRect.bottom - popoverHeight, VIEWPORT_INSET),
          maxTop
        );
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
        return;
      }

      popover.style.position = "";
      popover.style.left = "";
      popover.style.top = "";
      popover.style.right = "";
      popover.style.bottom = "";
      popover.style.transformOrigin = "";
      popover.style.marginRight = "";
      const rect = popover.getBoundingClientRect();
      const pastRight = rect.right - (window.innerWidth - VIEWPORT_INSET);
      const pastLeft = VIEWPORT_INSET - rect.left;
      // Right first: a panel wider than the window would otherwise be pushed
      // right by the left correction and clipped at the edge the user reads to.
      if (pastRight > 0) popover.style.marginRight = `${pastRight}px`;
      else if (pastLeft > 0) popover.style.marginRight = `${-pastLeft}px`;
    };
    clamp();
    window.addEventListener("resize", clamp);
    let resizeObserver: ResizeObserver | null = null;
    if (popoverPlacement === "right" && typeof ResizeObserver !== "undefined" && popoverRef.current) {
      resizeObserver = new ResizeObserver(() => clamp());
      resizeObserver.observe(popoverRef.current);
    }
    return () => {
      window.removeEventListener("resize", clamp);
      resizeObserver?.disconnect();
    };
  }, [open, popoverPlacement]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      className={`nav-menu${className ? ` ${className}` : ""}`}
      data-popover-placement={popoverPlacement}
      ref={ref}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="nav-menu__trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={ariaLabel}
        onClick={() => setOpen(!open)}
      >
        {icon}
        {label}
        <ChevronDown size={13} aria-hidden={true} className="nav-menu__caret" />
      </button>
      <span className="nav-menu__tooltip" aria-hidden="true">{ariaLabel}</span>
      {open ? (
        <div
          className="nav-menu__popover"
          role="dialog"
          aria-label={ariaLabel}
          ref={popoverRef}
          tabIndex={-1}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
