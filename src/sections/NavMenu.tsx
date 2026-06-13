import { useEffect, useRef, useState, type ReactNode } from "react";
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
// Escape. Shared by the masthead menus, the Format menu, and the Fit popover.
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

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={`nav-menu${className ? ` ${className}` : ""}`} ref={ref}>
      <button
        type="button"
        className="nav-menu__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        {icon}
        {label}
        <ChevronDown size={13} aria-hidden={true} className="nav-menu__caret" />
      </button>
      {open ? (
        <div className="nav-menu__popover" role="dialog" aria-label={ariaLabel}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
