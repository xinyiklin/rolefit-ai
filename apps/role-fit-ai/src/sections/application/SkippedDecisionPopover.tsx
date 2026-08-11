import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject
} from "react";
import {
  NOT_APPLYING_REASON_LABEL,
  type NotApplyingReason
} from "../../hooks/useApplications";

type SkippedDecisionPopoverProps = {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  reason: "" | NotApplyingReason;
  note: string;
  onReasonChange: (value: "" | NotApplyingReason) => void;
  onNoteChange: (value: string) => void;
  onClose: (restoreFocus?: boolean) => void;
};

type PopoverPosition = {
  top: number;
  left: number;
  width: number;
};

export function SkippedDecisionPopover({
  open,
  triggerRef,
  reason,
  note,
  onReasonChange,
  onNoteChange,
  onClose
}: SkippedDecisionPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLSelectElement>(null);
  const [position, setPosition] = useState<PopoverPosition>({ top: 0, left: 0, width: 420 });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const panel = panelRef.current.getBoundingClientRect();
    const margin = 16;
    const gap = 8;
    const width = Math.min(420, window.innerWidth - margin * 2);
    const left = Math.min(
      Math.max(margin, anchor.left),
      Math.max(margin, window.innerWidth - width - margin)
    );
    const below = anchor.bottom + gap;
    const top = below + panel.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, anchor.top - panel.height - gap);
    setPosition({ top, left, width });
    const focusFrame = window.requestAnimationFrame(() => reasonRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    }
    function handleScroll(event: Event) {
      if (window.innerWidth <= 760) return;
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      onClose(true);
    }
    function handleResize() {
      if (window.innerWidth <= 760) return;
      onClose(true);
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
    "--skip-popover-top": `${position.top}px`,
    "--skip-popover-left": `${position.left}px`,
    "--skip-popover-width": `${position.width}px`
  } as CSSProperties;

  return (
    <div
      ref={panelRef}
      id="application-skipped-decision"
      className="application-skip-popover"
      role="dialog"
      aria-label="Skipped decision"
      style={style}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
      }}
    >
      <div className="application-skip-popover__fields">
        <label className="field">
          <span>Reason</span>
          <select
            ref={reasonRef}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value as "" | NotApplyingReason)}
          >
            <option value="">No reason recorded</option>
            {Object.entries(NOT_APPLYING_REASON_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Decision note <small>Optional</small></span>
          <textarea
            className="textarea"
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            maxLength={2_000}
            placeholder="What made you skip this role?"
            rows={3}
          />
        </label>
      </div>

      <div className="application-skip-popover__actions">
        <button type="button" className="secondary-button is-compact" onClick={() => onClose(true)}>
          Done
        </button>
      </div>
    </div>
  );
}
