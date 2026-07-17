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
  const popoverRef = useRef<HTMLDivElement>(null);

  // The Format/Style triggers sit low in the studio toolbar, so on a short
  // viewport a tall popover would extend past the bottom edge — and because its
  // CSS max-height (viewport-relative) can exceed the space actually below the
  // trigger, it wouldn't even scroll. Cap max-height to the real space below the
  // trigger so the panel always fits the viewport and scrolls when it must.
  // Scoped to the studio menus only: the masthead menus sit at the top of the
  // viewport, where their CSS cap (min(78vh, 640px)) already fits — capping them
  // here would override that and let the long Job/AI menus grow full-height.
  const isStudioMenu = className === "format-menu" || className === "style-menu";
  useLayoutEffect(() => {
    if (!open || !isStudioMenu) return;
    const fit = () => {
      const popover = popoverRef.current;
      const wrapper = ref.current;
      if (!popover || !wrapper) return;
      const margin = 12;
      const below = window.innerHeight - wrapper.getBoundingClientRect().bottom - margin;
      // Mirror the studio popover's CSS cap (min(88vh, 720px)) so the inline
      // value only ever SHRINKS the panel to fit — never grows it past the
      // design cap on a tall window. Floor keeps it usable on very short windows
      // (it may then run a little past the edge, but its own scroll keeps every
      // control reachable).
      const cap = Math.min(window.innerHeight * 0.88, 720);
      popover.style.maxHeight = `${Math.max(160, Math.min(below, cap))}px`;
    };
    fit();
    // Recompute on resize AND scroll (capture-phase, to catch the studio's inner
    // scroll container) so the cap can't go stale while the popover stays open.
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, true);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit, true);
    };
  }, [open, isStudioMenu]);

  // Masthead menu popovers anchor from their group's LEFT edge (see shell.css),
  // and those groups sit toward the right of the bar, so a wide panel could run
  // past the window's right edge. Nudge any overflowing panel back on screen with
  // a negative margin (transform is reserved for the entrance animation; a
  // left-anchored panel makes the margin math intuitive: -x moves it x px left).
  // No-op for the right-anchored studio menus — they open leftward and can't
  // overflow the right edge, so the correction never fires.
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
        <div className="nav-menu__popover" role="dialog" aria-label={ariaLabel} ref={popoverRef}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
