import { useId, useRef, useState, type RefObject } from "react";
import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";
import type { NotApplyingReason } from "../lib/notApplying.ts";
import type { SkipReasonSuggestion } from "../lib/skipReasonSuggestions.ts";
import { SkipReasonChecklist } from "./application/SkipReasonChecklist";

type SkipJobDialogProps = {
  initialReasons: NotApplyingReason[];
  initialNote: string;
  suggestions: SkipReasonSuggestion[];
  busy: boolean;
  error: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onSave: (reasons: NotApplyingReason[], note: string) => void | Promise<void>;
  onCancel: () => void;
};

export function SkipJobDialog({
  initialReasons,
  initialNote,
  suggestions,
  busy,
  error,
  returnFocusRef,
  onSave,
  onCancel
}: SkipJobDialogProps) {
  const [reasons, setReasons] = useState<NotApplyingReason[]>(initialReasons);
  const [note, setNote] = useState(initialNote);
  const cardRef = useRef<HTMLFormElement>(null);
  const firstReasonRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const detailId = useId();
  const handleKeyDown = useModalFocus({
    active: true,
    containerRef: cardRef,
    initialFocusRef: firstReasonRef,
    returnFocusRef,
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
        className="rename-dialog__card skip-job-dialog"
        ref={cardRef}
        tabIndex={-1}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void onSave(reasons, note);
        }}
      >
        <p className="rename-dialog__head" id={titleId}>Skip this job?</p>
        <p className="confirm-dialog__message" id={detailId}>
          Save this posting as Skipped so RoleFit can recognize it if you encounter it again. No application is recorded.
        </p>

        <SkipReasonChecklist
          legend={<>Reasons <small>Optional</small></>}
          value={reasons}
          savedReasons={initialReasons}
          onChange={setReasons}
          suggestions={suggestions}
          disabled={busy}
          firstInputRef={firstReasonRef}
        />

        <label className="skip-job-dialog__field">
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
            {busy ? "Saving…" : "Save as skipped"}
          </button>
        </footer>
      </form>
    </div>
  );
}
