import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FONT_FAMILY_OPTIONS, type FontFamily } from "@typeset/engine/lib/documentStyle.ts";

type FontFamilyControlProps = {
  value: FontFamily | null;
  onChange: (value: FontFamily) => void;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  className?: string;
};

export function FontFamilyControl({
  value,
  onChange,
  disabled = false,
  ariaLabel,
  title,
  className = ""
}: FontFamilyControlProps) {
  const menuId = `font-families-${useId().replace(/:/g, "")}`;
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number; placement: "down" | "up" } | null>(null);
  const selectedLabel = FONT_FAMILY_OPTIONS.find((option) => option.value === value)?.label ?? "Mixed";

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = 112;
      const below = window.innerHeight - rect.bottom;
      const placement = below < menuHeight + 12 && rect.top > below ? "up" : "down";
      const width = Math.max(128, rect.width);
      setMenuPos({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: placement === "down" ? rect.bottom + 6 : rect.top - 6,
        width,
        placement
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    if (!open || !menuPos) return;
    const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    const first = menuRef.current?.querySelector<HTMLButtonElement>("button");
    (selected ?? first)?.focus();
  }, [menuPos, open]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <span ref={rootRef} className={`font-family-control${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="font-family-control__trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={title}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <span>{selectedLabel}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && !disabled && menuPos
        ? createPortal(
            <span
              ref={menuRef}
              id={menuId}
              className="font-family-control__menu"
              role="listbox"
              aria-label={ariaLabel}
              style={{
                position: "fixed",
                left: menuPos.left,
                top: menuPos.top,
                width: menuPos.width,
                transform: menuPos.placement === "down" ? undefined : "translateY(-100%)"
              }}
              onKeyDown={(event) => {
                const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
                const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeAndRestoreFocus();
                } else if (event.key === "Tab") {
                  setOpen(false);
                } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const delta = event.key === "ArrowDown" ? 1 : -1;
                  options[(currentIndex + delta + options.length) % options.length]?.focus();
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  options[event.key === "Home" ? 0 : options.length - 1]?.focus();
                }
              }}
            >
              {FONT_FAMILY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={value === option.value}
                  className={value === option.value ? "is-selected" : ""}
                  onClick={() => {
                    onChange(option.value);
                    closeAndRestoreFocus();
                  }}
                >
                  <span>{option.label}</span>
                  <Check size={13} aria-hidden="true" />
                </button>
              ))}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
