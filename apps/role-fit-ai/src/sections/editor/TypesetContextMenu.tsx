import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

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
  onSelect: () => void;
};

type TypesetContextMenuProps = {
  x: number;
  y: number;
  items: Array<ContextMenuItem | "divider">;
  onClose: () => void;
};

export function TypesetContextMenu({ x, y, items, onClose }: TypesetContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

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
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onClose, true);
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
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="ts-context-menu__item"
            disabled={item.disabled}
            onMouseDown={(event) => event.preventDefault()}
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
