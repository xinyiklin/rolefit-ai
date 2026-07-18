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
};

// A dropdown: a pill trigger plus a popover, closing on outside click or
// Escape. Shared by the masthead menus.
export function NavMenu({ icon, label, ariaLabel, className, children, open: controlledOpen, onOpenChange }: NavMenuProps) {
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

  // Masthead menu popovers anchor from their group's LEFT edge (see shell.css),
  // and those groups sit toward the right of the bar, so a wide panel could run
  // past the window's right edge. Nudge any overflowing panel back on screen with
  // a negative margin (transform is reserved for the entrance animation; a
  // left-anchored panel makes the margin math intuitive: -x moves it x px left).
  useLayoutEffect(() => {
    if (!open) return;
    const clamp = () => {
      const popover = popoverRef.current;
      if (!popover) return;
      popover.style.marginLeft = "";
      const rect = popover.getBoundingClientRect();
      const overflow = rect.left + popover.offsetWidth - (window.innerWidth - 8);
      if (overflow > 0) popover.style.marginLeft = `${-overflow}px`;
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [open]);

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
        <div className="nav-menu__popover" role="dialog" aria-label={ariaLabel} ref={popoverRef} tabIndex={-1}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
