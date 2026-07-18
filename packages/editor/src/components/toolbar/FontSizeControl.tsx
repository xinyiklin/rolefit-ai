import { Minus, Plus } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const COMMON_SIZES = [6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

type FontSizeControlProps = {
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  ariaLabel: string;
  title?: string;
  className?: string;
};

function displaySize(value: number | null) {
  return value === null ? "" : Number(value.toFixed(1)).toString();
}

export function FontSizeControl({
  value,
  onChange,
  disabled = false,
  min = 6,
  max = 48,
  ariaLabel,
  title,
  className = ""
}: FontSizeControlProps) {
  const menuId = `font-sizes-${useId().replace(/:/g, "")}`;
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const [draft, setDraft] = useState(displaySize(value));
  const [open, setOpen] = useState(false);
  // The menu is portaled to the body with fixed positioning so an ancestor with
  // `overflow: auto` (e.g. the scrolling Styles popover) never clips it.
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; placement: "down" | "up" } | null>(null);

  useEffect(() => setDraft(displaySize(value)), [value]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const MENU_MAX_H = 232;
    const place = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const placement = below < MENU_MAX_H + 12 && rect.top > below ? "up" : "down";
      setMenuPos({
        left: rect.left + rect.width / 2,
        top: placement === "down" ? rect.bottom + 6 : rect.top - 6,
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

  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next * 10) / 10));
  const commitValue = (next: number) => {
    const clamped = clamp(next);
    setDraft(displaySize(clamped));
    onChange(clamped);
  };
  const commitDraft = () => {
    const parsed = Number(draft.trim());
    if (!Number.isFinite(parsed)) {
      setDraft(displaySize(value));
      return;
    }
    commitValue(parsed);
  };
  const step = (delta: -1 | 1) => {
    const parsed = Number(draft.trim());
    commitValue((Number.isFinite(parsed) ? parsed : value ?? min) + delta);
  };
  const availableSizes = COMMON_SIZES.filter((size) => size >= min && size <= max);

  return (
    <span ref={rootRef} className={`font-size-control${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="font-size-control__step"
        disabled={disabled || (value !== null && value <= min)}
        aria-label="Decrease font size by 1 point"
        title="Decrease font size by 1 pt"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => step(-1)}
      >
        <Minus size={13} aria-hidden="true" />
      </button>
      <span className="font-size-control__value">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          placeholder={value === null ? "Mixed" : undefined}
          disabled={disabled}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={menuId}
          aria-haspopup="listbox"
          title={title}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
              setOpen(false);
              event.currentTarget.select();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(displaySize(value));
              setOpen(false);
            } else if (event.key === "ArrowDown") {
              setOpen(true);
            }
          }}
        />
      </span>
      <button
        type="button"
        className="font-size-control__step"
        disabled={disabled || (value !== null && value >= max)}
        aria-label="Increase font size by 1 point"
        title="Increase font size by 1 pt"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => step(1)}
      >
        <Plus size={13} aria-hidden="true" />
      </button>

      {open && !disabled && menuPos
        ? createPortal(
            <span
              ref={menuRef}
              id={menuId}
              className="font-size-control__menu"
              role="listbox"
              aria-label="Common font sizes"
              style={{
                position: "fixed",
                left: menuPos.left,
                top: menuPos.top,
                transform: menuPos.placement === "down" ? "translateX(-50%)" : "translate(-50%, -100%)"
              }}
            >
              {availableSizes.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="option"
                  aria-selected={value === size}
                  className={value === size ? "is-selected" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    commitValue(size);
                    setOpen(false);
                  }}
                >
                  {size}
                </button>
              ))}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
