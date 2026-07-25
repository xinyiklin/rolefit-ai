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

  // Panels anchor to their trigger's RIGHT edge (see shell.css), so a narrow
  // window pushes one off the LEFT — the mirror of the old overflow case. The
  // nudge must be `margin-right`: an absolutely positioned box offset by `right`
  // has an auto `left`, which simply absorbs a `margin-left` and moves nothing.
  // Negative margin-right moves the panel right; positive moves it left.
  // (Transform is reserved for the entrance animation.)
  useLayoutEffect(() => {
    if (!open) return;
    const clamp = () => {
      const popover = popoverRef.current;
      if (!popover) return;
      popover.style.marginRight = "";
      const rect = popover.getBoundingClientRect();
      const pastRight = rect.right - (window.innerWidth - 8);
      const pastLeft = 8 - rect.left;
      // Right first: a panel wider than the window would otherwise be pushed
      // right by the left correction and clipped at the edge the user reads to.
      if (pastRight > 0) popover.style.marginRight = `${pastRight}px`;
      else if (pastLeft > 0) popover.style.marginRight = `${-pastLeft}px`;
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
