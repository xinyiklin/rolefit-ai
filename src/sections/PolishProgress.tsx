import { AlertCircle, Check, RotateCcw } from "lucide-react";

export type StageStatus = "idle" | "running" | "done" | "failed";

export type StageState = {
  status: StageStatus;
  error?: string;
};

export type PolishProgressState = {
  tailor: StageState;
  review: StageState;
};

type PolishProgressProps = {
  stages: "tailor" | "review" | "both";
  progress: PolishProgressState;
  onRetry: (stage: "tailor" | "review") => void;
  onDismiss: () => void;
  busy: boolean;
};

const STAGE_LABELS: Record<"tailor" | "review", string> = {
  tailor: "Tailor",
  review: "Review"
};

function StageRow({
  stageKey,
  state,
  onRetry,
  busy
}: {
  stageKey: "tailor" | "review";
  state: StageState;
  onRetry: (stage: "tailor" | "review") => void;
  busy: boolean;
}) {
  const { status, error } = state;
  return (
    <div className={`polish-progress__row polish-progress__row--${status}`}>
      <span className="polish-progress__label">{STAGE_LABELS[stageKey]}</span>
      <span className="polish-progress__status">
        {status === "running" ? (
          <>
            <span className="loading-dots" aria-hidden="true" />
            <span className="sr-only">Running…</span>
          </>
        ) : status === "done" ? (
          <Check size={13} aria-label="Done" />
        ) : status === "failed" ? (
          <AlertCircle size={13} aria-label="Failed" className="polish-progress__icon--fail" />
        ) : null}
      </span>
      {status === "failed" && error ? (
        <span className="polish-progress__error">{error}</span>
      ) : null}
      {status === "failed" ? (
        <button
          type="button"
          className="ghost-button is-compact polish-progress__retry"
          onClick={() => onRetry(stageKey)}
          disabled={busy}
          aria-label={`Retry ${STAGE_LABELS[stageKey]}`}
        >
          <RotateCcw size={12} aria-hidden="true" />
          Retry
        </button>
      ) : null}
    </div>
  );
}

// Shows selected stage rows (Tailor above Review) with running / done / failed
// status and a per-stage Retry button on failure. Replaces the single-line
// polish-toast for the actual stage progress; the toast is still used for
// ancillary messages.
export function PolishProgress({ stages, progress, onRetry, onDismiss, busy }: PolishProgressProps) {
  const showTailor = stages === "tailor" || stages === "both";
  const showReview = stages === "review" || stages === "both";

  return (
    <div className="polish-progress" role="status" aria-live="polite" aria-label="Polish progress">
      <div className="polish-progress__rows">
        {showTailor ? (
          <StageRow stageKey="tailor" state={progress.tailor} onRetry={onRetry} busy={busy} />
        ) : null}
        {showReview ? (
          <StageRow stageKey="review" state={progress.review} onRetry={onRetry} busy={busy} />
        ) : null}
      </div>
      <button
        type="button"
        className="polish-toast__dismiss"
        onClick={onDismiss}
        aria-label="Dismiss polish progress"
      >
        ×
      </button>
    </div>
  );
}
