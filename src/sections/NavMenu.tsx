import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type NavMenuProps = {
  icon: ReactNode;
  label: ReactNode;
  ariaLabel: string;
  children: ReactNode;
};

// A navbar dropdown: a pill trigger plus a popover, closing on outside click or
// Escape. Shared by the AI and Polish menus.
export function NavMenu({ icon, label, ariaLabel, children }: NavMenuProps) {
  const [open, setOpen] = useState(false);
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
    <div className="nav-menu" ref={ref}>
      <button
        type="button"
        className="nav-menu__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
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
