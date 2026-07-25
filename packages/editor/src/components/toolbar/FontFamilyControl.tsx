import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FONT_FAMILY_OPTIONS, type FontFamily } from "@typeset/engine/lib/documentStyle.ts";
import { DOCUMENT_FONT_FAMILIES } from "@typeset/engine/typeset/fontRegistry.ts";

// Each row previews its own face, the way a word processor's font menu does, so
// the choice can be made by eye rather than by name. The regular face's CSS
// family is the one the document text actually paints with.
const previewFamily = (value: FontFamily) =>
  `"${DOCUMENT_FONT_FAMILIES[value].faces.regular.cssFamily}"`;

// Rough per-row height used only to decide whether the menu opens up or down.
const ROW_HEIGHT = 30;
const MENU_PADDING = 16;

type FontFamilyControlProps = {
  value: FontFamily | null;
  onChange: (value: FontFamily) => void;
  onCommitFocus?: () => void;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  className?: string;
};

export function FontFamilyControl({
  value,
  onChange,
  onCommitFocus,
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
  const selectedLabel = FONT_FAMILY_OPTIONS.find((option) => option.value === value)?.label ?? "";

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = FONT_FAMILY_OPTIONS.length * ROW_HEIGHT + MENU_PADDING;
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
              data-typeset-toolbar-portal
              className="font-family-control__menu"
              role="listbox"
              aria-label={ariaLabel}
              style={{
                position: "fixed",
                left: menuPos.left,
                top: menuPos.top,
                // A floor, not a size: the stylesheet lets the menu grow to fit
                // the longest family name and metric-twin label.
                minWidth: menuPos.width,
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
                  aria-label={option.metricsOf ? `${option.label}, ${option.metricsOf} metrics` : option.label}
                  className={value === option.value ? "is-selected" : ""}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    requestAnimationFrame(() => onCommitFocus?.());
                  }}
                >
                  <span className="font-family-control__name" style={{ fontFamily: previewFamily(option.value) }}>
                    {option.label}
                  </span>
                  {/* Always rendered, so every row shares one grid and the
                      names stay aligned whether or not a font has a twin. */}
                  <span className="font-family-control__metrics" aria-hidden="true">
                    {option.metricsOf ?? ""}
                  </span>
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
