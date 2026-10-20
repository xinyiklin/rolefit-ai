import { useRef, type RefObject } from "react";
import type { NotApplyingReason } from "../../lib/notApplying";
import { AnchoredPopover } from "./AnchoredPopover";
import { SkipReasonChecklist } from "./SkipReasonChecklist";

type SkippedDecisionPopoverProps = {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  reasons: NotApplyingReason[];
  savedReasons: NotApplyingReason[];
  note: string;
  onReasonsChange: (value: NotApplyingReason[]) => void;
  onNoteChange: (value: string) => void;
  onClose: (restoreFocus?: boolean) => void;
};

export function SkippedDecisionPopover({
  open,
  triggerRef,
  reasons,
  savedReasons,
  note,
  onReasonsChange,
  onNoteChange,
  onClose
}: SkippedDecisionPopoverProps) {
  const reasonRef = useRef<HTMLInputElement>(null);

  return (
    <AnchoredPopover
      open={open}
      id="application-skipped-decision"
      label="Skipped decision"
      triggerRef={triggerRef}
      initialFocusRef={reasonRef}
      onClose={onClose}
    >
      <div className="application-skip-popover__fields">
        <SkipReasonChecklist
          legend="Reasons"
          value={reasons}
          savedReasons={savedReasons}
          onChange={onReasonsChange}
          firstInputRef={reasonRef}
        />
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
    </AnchoredPopover>
  );
}
