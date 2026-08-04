import { ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import type { DocStyleControls } from "../../hooks/useDocStyle";
import { DOC_STYLE_BOUNDS, DOC_ZOOM_OPTIONS } from "@typeset/engine/lib/documentStyle.ts";

export type ZoomControlProps = {
  docStyle: DocStyleControls;
  onFitZoom?: () => void;
  // Optional because standalone hosts may only resize with the window.
  fitViewportRef?: RefObject<HTMLElement | null>;
};

const MIN_ZOOM_PERCENT = DOC_STYLE_BOUNDS.zoom.min * 100;
const MAX_ZOOM_PERCENT = DOC_STYLE_BOUNDS.zoom.max * 100;

function displayZoom(zoom: number) {
  return `${Number((zoom * 100).toFixed(1))}%`;
}

export function ZoomControl({ docStyle, onFitZoom, fitViewportRef }: ZoomControlProps) {
  const menuId = `zoom-options-${useId().replace(/:/g, "")}`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const onFitZoomRef = useRef(onFitZoom);
  onFitZoomRef.current = onFitZoom;
  const fitAvailable = Boolean(onFitZoom);
  const [fitSelected, setFitSelected] = useState(false);
  const [draft, setDraft] = useState(displayZoom(docStyle.style.zoom));
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top: number;
    width: number;
    placement: "down" | "up";
  } | null>(null);

  useEffect(() => {
    if (!fitSelected) setDraft(displayZoom(docStyle.style.zoom));
    // fitSelected intentionally is not a trigger: changing from Fit to a typed
    // draft must not let the previous numeric zoom overwrite the first key.
  }, [docStyle.style.zoom]);

  // A window resize or host-owned pane transition can alter the page width.
  // Re-run Fit after the geometry settles so the visible Fit state stays true.
  useEffect(() => {
    if (!fitSelected || !fitAvailable) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refit = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => onFitZoomRef.current?.(), 260);
    };
    const fitViewport = fitViewportRef?.current ?? null;
    let viewportWidth = fitViewport?.clientWidth ?? null;
    const resizeObserver =
      fitViewport && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            const nextWidth = fitViewport.clientWidth;
            if (viewportWidth !== null && Math.abs(nextWidth - viewportWidth) < 1) return;
            viewportWidth = nextWidth;
            refit();
          })
        : null;
    if (fitViewport && resizeObserver) resizeObserver.observe(fitViewport);
    window.addEventListener("resize", refit);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", refit);
      if (timer !== null) clearTimeout(timer);
    };
  }, [fitAvailable, fitSelected, fitViewportRef]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }

    const MENU_MAX_H = 280;
    const place = () => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const placement = below < MENU_MAX_H + 12 && rect.top > below ? "up" : "down";
      setMenuPos({
        left: rect.left,
        top: placement === "down" ? rect.bottom + 6 : rect.top - 6,
        width: rect.width,
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

  const commitPercent = (percent: number) => {
    const clamped = Math.min(
      MAX_ZOOM_PERCENT,
      Math.max(MIN_ZOOM_PERCENT, Math.round(percent * 10) / 10)
    );
    setFitSelected(false);
    setDraft(`${Number(clamped.toFixed(1))}%`);
    docStyle.set("zoom", clamped / 100);
  };

  const commitDraft = () => {
    if (fitSelected && draft.trim().toLowerCase() === "fit") {
      setDraft("Fit");
      return;
    }
    const trimmed = draft.trim().replace(/%$/, "");
    const parsed = Number(trimmed);
    // An empty/whitespace draft parses to 0 via Number(""), which would pass
    // the finite check below and clamp to the minimum zoom. Treat it the same
    // as a non-finite draft: revert instead of committing.
    if (trimmed === "" || !Number.isFinite(parsed)) {
      setDraft(displayZoom(docStyle.style.zoom));
      return;
    }
    commitPercent(parsed);
  };

  return (
    <div ref={rootRef} className={`top-toolbar__zoom${open ? " is-open" : ""}`}>
      <label className="top-toolbar__zoom-combobox">
        <span className="sr-only">Page zoom</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          role="combobox"
          aria-label="Page zoom"
          aria-expanded={open}
          aria-controls={menuId}
          aria-haspopup="listbox"
          title={`Page zoom (${MIN_ZOOM_PERCENT}% to ${MAX_ZOOM_PERCENT}%)`}
          onFocus={(event) => {
            setOpen(true);
            event.currentTarget.select();
          }}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setFitSelected(false);
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
              setDraft(fitSelected ? "Fit" : displayZoom(docStyle.style.zoom));
              setOpen(false);
              event.currentTarget.select();
            } else if (event.key === "ArrowDown") {
              setOpen(true);
            }
          }}
        />
        <button
          type="button"
          className="top-toolbar__zoom-toggle"
          aria-label={open ? "Close zoom options" : "Open zoom options"}
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </label>

      {open && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              data-typeset-toolbar-portal
              className="zoom-control__menu"
              role="listbox"
              aria-label="Page zoom options"
              style={{
                position: "fixed",
                left: menuPos.left,
                top: menuPos.top,
                width: menuPos.width,
                transform: menuPos.placement === "up" ? "translateY(-100%)" : undefined
              }}
            >
              {onFitZoom ? (
                <button
                  type="button"
                  role="option"
                  aria-selected={fitSelected}
                  className={fitSelected ? "is-selected" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onFitZoom();
                    setFitSelected(true);
                    setDraft("Fit");
                    setOpen(false);
                  }}
                >
                  Fit
                </button>
              ) : null}
              {DOC_ZOOM_OPTIONS.map((zoom) => (
                <button
                  key={zoom}
                  type="button"
                  role="option"
                aria-selected={!fitSelected && Math.abs(docStyle.style.zoom - zoom) < 0.0001}
                className={!fitSelected && Math.abs(docStyle.style.zoom - zoom) < 0.0001 ? "is-selected" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    commitPercent(zoom * 100);
                    setOpen(false);
                  }}
                >
                  {displayZoom(zoom)}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
