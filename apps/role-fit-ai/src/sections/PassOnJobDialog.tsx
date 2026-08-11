import { useId, useRef, useState } from "react";
import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";
import {
  NOT_APPLYING_REASON_LABEL,
  type NotApplyingReason
} from "../lib/notApplying.ts";

type PassOnJobDialogProps = {
  initialReason: NotApplyingReason | "";
  initialNote: string;
  busy: boolean;
  error: string;
  onSave: (reason: NotApplyingReason | "", note: string) => void | Promise<void>;
  onCancel: () => void;
};

export function PassOnJobDialog({
  initialReason,
  initialNote,
  busy,
  error,
  onSave,
  onCancel
}: PassOnJobDialogProps) {
  const [reason, setReason] = useState<NotApplyingReason | "">(initialReason);
  const [note, setNote] = useState(initialNote);
  const cardRef = useRef<HTMLFormElement>(null);
  const reasonRef = useRef<HTMLSelectElement>(null);
  const titleId = useId();
  const detailId = useId();
  const handleKeyDown = useModalFocus({
    active: true,
    containerRef: cardRef,
    initialFocusRef: reasonRef,
    onClose: busy ? () => undefined : onCancel
  });

  return (
    <div
      className="rename-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={detailId}
      onKeyDown={handleKeyDown}
    >
      <div
        className="rename-dialog__backdrop"
        aria-hidden="true"
        onMouseDown={busy ? undefined : onCancel}
      />
      <form
        className="rename-dialog__card pass-job-dialog"
        ref={cardRef}
        tabIndex={-1}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void onSave(reason, note);
        }}
      >
        <p className="rename-dialog__head" id={titleId}>Pass on this job?</p>
        <p className="confirm-dialog__message" id={detailId}>
          Save this posting as Not applying so RoleFit can recognize it if you encounter it again. No application will be recorded.
        </p>

        <label className="pass-job-dialog__field">
          <span>Reason <small>Optional</small></span>
          <select
            ref={reasonRef}
            value={reason}
            onChange={(event) => setReason(event.target.value as NotApplyingReason | "")}
            disabled={busy}
          >
            <option value="">No reason selected</option>
            {Object.entries(NOT_APPLYING_REASON_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <label className="pass-job-dialog__field">
          <span>Short note <small>Optional</small></span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 2_000))}
            rows={3}
            maxLength={2_000}
            placeholder="Why you decided not to apply"
            disabled={busy}
          />
        </label>

        {busy ? (
          <p className="apply-download__busy" role="status" aria-live="polite">
            Saving…
          </p>
        ) : null}
        {error ? <p className="rename-dialog__error" role="alert">{error}</p> : null}

        <footer className="rename-dialog__actions">
          <button type="button" className="ghost-button is-compact" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary-button is-compact" disabled={busy}>
            {busy ? "Saving…" : "Save as not applying"}
          </button>
        </footer>
      </form>
    </div>
  );
}
