import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject
} from "react";

type AnchoredPopoverProps = {
  open: boolean;
  id: string;
  label: string;
  triggerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  // Positions the panel under this element instead of the trigger, e.g. the
  // card whose corner button opens it.
  anchorRef?: RefObject<HTMLElement | null>;
  // "right" opens beside the anchor, top-aligned, and falls back to below when
  // the viewport has no room for it.
  placement?: "below" | "right";
  className?: string;
  // `dismissed` marks an incidental close (outside click, scroll, resize) as
  // opposed to Escape or Done, so a host can keep unsaved work open.
  onClose: (restoreFocus?: boolean, dismissed?: boolean) => void;
  children: ReactNode;
};

type PopoverPosition = {
  top: number;
  left: number;
  width: number;
};

// A non-modal panel that edits the host form in place. Below 760px it docks to
// the bottom as a sheet, so scroll and resize only dismiss it on wider screens.
export function AnchoredPopover({
  open,
  id,
  label,
  triggerRef,
  initialFocusRef,
  anchorRef,
  placement = "below",
  className,
  onClose,
  children
}: AnchoredPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<PopoverPosition>({ top: 0, left: 0, width: 420 });

  useLayoutEffect(() => {
    const anchorElement = anchorRef?.current ?? triggerRef.current;
    if (!open || !anchorElement || !panelRef.current) return;
    const anchor = anchorElement.getBoundingClientRect();
    const panel = panelRef.current.getBoundingClientRect();
    const margin = 16;
    const gap = 8;
    const width = Math.min(420, window.innerWidth - margin * 2);
    const beside = anchor.right + gap;
    if (placement === "right" && beside + width <= window.innerWidth - margin) {
      const top = Math.max(margin, Math.min(anchor.top, window.innerHeight - panel.height - margin));
      setPosition({ top, left: beside, width });
    } else {
      const left = Math.min(
        Math.max(margin, anchor.left),
        Math.max(margin, window.innerWidth - width - margin)
      );
      const below = anchor.bottom + gap;
      const top = below + panel.height <= window.innerHeight - margin
        ? below
        : Math.max(margin, anchor.top - panel.height - gap);
      setPosition({ top, left, width });
    }
    // The host modal's focus trap rejects non-tabbable targets, so the fallback
    // is Done rather than the panel itself.
    const focusFrame = window.requestAnimationFrame(() => (initialFocusRef?.current ?? doneRef.current)?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [anchorRef, initialFocusRef, open, placement, triggerRef]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose(false, true);
    }
    function handleScroll(event: Event) {
      if (window.innerWidth <= 760) return;
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      onClose(true, true);
    }
    function handleResize() {
      if (window.innerWidth <= 760) return;
      onClose(true, true);
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose, open, triggerRef]);

  if (!open) return null;

  const style = {
    "--popover-top": `${position.top}px`,
    "--popover-left": `${position.left}px`,
    "--popover-width": `${position.width}px`
  } as CSSProperties;

  return (
    <div
      ref={panelRef}
      id={id}
      className={className ? `application-popover ${className}` : "application-popover"}
      role="dialog"
      aria-label={label}
      style={style}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
      }}
    >
      {children}
      <div className="application-popover__actions">
        <button ref={doneRef} type="button" className="secondary-button is-compact" onClick={() => onClose(true)}>
          Done
        </button>
      </div>
    </div>
  );
}
