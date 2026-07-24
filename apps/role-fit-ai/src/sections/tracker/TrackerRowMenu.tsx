import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, type LucideIcon } from "lucide-react";

// A single menu entry: an actionable item, a section header, or a divider.
// An action may lead with a lucide icon OR a CSS dot (e.g. a stage dot), and may
// render a trailing check when it represents the current selection.
export type RowMenuItem =
  | {
      kind: "action";
      label: string;
      icon?: LucideIcon;
      dotClass?: string;
      active?: boolean;
      onSelect: () => void;
      danger?: boolean;
    }
  | { kind: "header"; label: string }
  | { kind: "separator" };

type TrackerRowMenuProps = {
  // Anchor (the cursor position from the contextmenu event), in viewport coords.
  x: number;
  y: number;
  items: RowMenuItem[];
  onClose: () => void;
};

// Lightweight right-click menu. Fixed-positioned at the cursor, clamped into the
// viewport, and dismissed on outside click / Escape / scroll / resize.
export function TrackerRowMenu({ x, y, items, onClose }: TrackerRowMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp into the viewport once the menu has measurable dimensions.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const nx = x + width + margin > window.innerWidth ? Math.max(margin, window.innerWidth - width - margin) : x;
    const ny = y + height + margin > window.innerHeight ? Math.max(margin, window.innerHeight - height - margin) : y;
    setPos({ x: nx, y: ny });
  }, [x, y]);

  // Focus the first item so the menu is keyboard-operable immediately, and
  // restore focus to the pre-menu element on close (the originating row for
  // Shift+F10 keyboard users) — otherwise focus drops to <body> and the user
  // must Tab back from the top of the page. Skip the restore when the close
  // came from clicking another control (focus already moved somewhere real).
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      const active = document.activeElement;
      if (opener && opener.isConnected && (active === null || active === document.body)) {
        opener.focus();
      }
    };
  }, []);

  // Dismiss/keyboard handling. Scroll (capture) covers the studio body scroller.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      if (!buttons.length) return;
      event.preventDefault();
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? current + 1 : current - 1;
      buttons[(next + buttons.length) % buttons.length]?.focus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="row-menu"
      role="menu"
      style={{ top: pos.y, left: pos.x }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.kind === "separator") {
          return <div className="row-menu__sep" role="separator" key={index} />;
        }
        if (item.kind === "header") {
          return (
            <p className="row-menu__header" key={index}>
              {item.label}
            </p>
          );
        }
        const Icon = item.icon;
        return (
          <button
            type="button"
            role="menuitem"
            key={index}
            className={`row-menu__item ${item.danger ? "row-menu__item--danger" : ""} ${item.active ? "is-active" : ""}`}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {Icon ? (
              <Icon size={14} aria-hidden="true" />
            ) : item.dotClass ? (
              <span className={item.dotClass} aria-hidden="true" />
            ) : null}
            <span className="row-menu__label">{item.label}</span>
            {item.active ? <Check size={13} className="row-menu__check" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}
