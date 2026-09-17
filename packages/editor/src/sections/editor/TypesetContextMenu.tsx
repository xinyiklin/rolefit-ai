import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

// A self-owned right-click menu for the typeset editor: the browser's native
// context menu is suppressed and this renders in its place, so clipboard,
// emphasis, and history actions share the app's look and act on the editor's
// own selection model. Items act on a selection captured at open time; the
// buttons preventDefault their mousedown so opening/using the menu never blurs
// the contenteditable or collapses the highlight the actions operate on.
export type ContextMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  // A submenu turns the row into a hover/focus flyout (e.g. "Add section ▸" to
  // pick a type). onSelect is ignored when submenu is present.
  submenu?: ContextMenuItem[];
  onSelect: () => void;
};

type TypesetContextMenuProps = {
  keyboard?: boolean;
  x: number;
  y: number;
  items: Array<ContextMenuItem | "divider">;
  onClose: () => void;
};

export function TypesetContextMenu({ keyboard = false, x, y, items, onClose }: TypesetContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSubId, setOpenSubId] = useState<string | null>(null);

  // Clamp into the viewport once measured (flip off the right/bottom edges).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const left = Math.max(pad, Math.min(x, window.innerWidth - pad - rect.width));
    const top = Math.max(pad, Math.min(y, window.innerHeight - pad - rect.height));
    setPos({ left, top });
  }, [x, y]);

  useLayoutEffect(() => {
    const menu = ref.current;
    const submenu = submenuRef.current;
    if (!menu || !submenu) return;
    const placeSubmenu = () => {
      const anchor = submenu.parentElement!.getBoundingClientRect();
      const rect = submenu.getBoundingClientRect();
      const preferredLeft = anchor.right + 4 + rect.width <= window.innerWidth - 8
        ? anchor.right + 4 : anchor.left - rect.width - 4;
      submenu.style.left = `${Math.max(8, Math.min(preferredLeft, window.innerWidth - rect.width - 8))}px`;
      submenu.style.top = `${Math.max(8, Math.min(anchor.top, window.innerHeight - rect.height - 8))}px`;
    };
    placeSubmenu();
    menu.addEventListener("scroll", placeSubmenu);
    return () => menu.removeEventListener("scroll", placeSubmenu);
  }, [openSubId, pos]);

  useEffect(() => {
    if (keyboard) ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [keyboard]);

  useEffect(() => {
    // A pointerdown anywhere outside dismisses (a right-click elsewhere fires
    // pointerdown too, so it closes here before its own menu opens). Escape,
    // scroll, and resize also dismiss so the menu never floats detached.
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    const onScroll = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ts-context-menu"
      role="menu"
      aria-label="Editor actions"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item === "divider" ? (
          <div key={`divider-${index}`} className="ts-context-menu__divider" role="separator" />
        ) : item.submenu ? (
          <div
            key={item.id}
            className="ts-context-menu__row"
            onMouseEnter={() => setOpenSubId(item.id)}
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openSubId === item.id}
              className="ts-context-menu__item"
              disabled={item.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onFocus={() => setOpenSubId(item.id)}
            >
              <span className="ts-context-menu__icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="ts-context-menu__label">{item.label}</span>
              <ChevronRight size={14} className="ts-context-menu__chevron" aria-hidden="true" />
            </button>
            {openSubId === item.id ? (
              <div ref={submenuRef} className="ts-context-menu ts-context-menu__submenu" role="menu">
                {item.submenu.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    role="menuitem"
                    className="ts-context-menu__item"
                    disabled={sub.disabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      sub.onSelect();
                      onClose();
                    }}
                  >
                    <span className="ts-context-menu__icon" aria-hidden="true">
                      {sub.icon}
                    </span>
                    <span className="ts-context-menu__label">{sub.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="ts-context-menu__item"
            disabled={item.disabled}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setOpenSubId(null)}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            <span className="ts-context-menu__icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="ts-context-menu__label">{item.label}</span>
            {item.shortcut ? <span className="ts-context-menu__shortcut">{item.shortcut}</span> : null}
          </button>
        )
      )}
    </div>
  );
}
