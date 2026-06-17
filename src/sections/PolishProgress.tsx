import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, RotateCcw, X } from "lucide-react";

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

// How long a completed stage card stays on screen (after the WHOLE run settles)
// before it leaves, plus the exit duration (>= the CSS transition on
// `.polish-stage.is-leaving`). STAGGER_MS offsets each subsequent card so they
// leave ONE BY ONE (Tailor, then Review) instead of all at once.
const DONE_HOLD_MS = 10000;
const FADE_MS = 500; // >= the CSS `.is-leaving` collapse (440ms) so unmount lands after it
const STAGGER_MS = 800;

const STAGE_COPY: Record<"tailor" | "review", Record<"running" | "done" | "failed", string>> = {
  tailor: { running: "Tailoring", done: "Tailored", failed: "Tailor failed" },
  review: { running: "Reviewing", done: "Reviewed", failed: "Review failed" }
};

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// One self-contained card per stage. Running shows a live elapsed timer + step;
// a completed card freezes the final duration, then (once the whole run has
// settled) holds DONE_HOLD_MS and fades out + unmounts; a failed card persists
// with Retry + Dismiss. Every status change resets the lifecycle.
function StageCard({
  stageKey,
  state,
  step,
  total,
  onRetry,
  onDismiss,
  busy
}: {
  stageKey: "tailor" | "review";
  state: StageState;
  step: number;
  total: number;
  onRetry: (stage: "tailor" | "review") => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const { status, error } = state;
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);

  // Elapsed timer: tick while running, freeze the final duration on settle.
  useEffect(() => {
    if (status === "running") {
      startRef.current = Date.now();
      setElapsedMs(0);
      const id = window.setInterval(() => {
        if (startRef.current != null) setElapsedMs(Date.now() - startRef.current);
      }, 1000);
      return () => window.clearInterval(id);
    }
    if ((status === "done" || status === "failed") && startRef.current != null) {
      setElapsedMs(Date.now() - startRef.current);
    }
  }, [status]);

  // Reset the leave lifecycle only when a FRESH run starts this stage (status →
  // running) — not on every dep change. Otherwise retrying a failed sibling
  // (which toggles `busy`) would resurrect an already-dismissed card.
  useEffect(() => {
    if (status === "running") {
      setLeaving(false);
      setGone(false);
    }
  }, [status]);

  // Auto-dismiss a completed stage, but only after the WHOLE polish has settled
  // (busy=false) and a deliberate hold — never the instant this stage finishes.
  useEffect(() => {
    if (status !== "done" || busy) return;
    // Stagger by step so sibling cards leave one-by-one (Tailor, then Review).
    const leaveDelay = DONE_HOLD_MS + (step - 1) * STAGGER_MS;
    const fadeAt = window.setTimeout(() => setLeaving(true), leaveDelay);
    const goneAt = window.setTimeout(() => setGone(true), leaveDelay + FADE_MS);
    return () => {
      window.clearTimeout(fadeAt);
      window.clearTimeout(goneAt);
    };
  }, [status, busy, step]);

  if (status === "idle" || gone) return null;

  const stepText = total > 1 ? `Step ${step} of ${total}` : "";
  const elapsedText = elapsedMs > 0 || status === "running" ? formatElapsed(elapsedMs) : "";
  const meta = [stepText, elapsedText].filter(Boolean).join(" · ");

  return (
    <div
      className={`polish-stage polish-stage--${status}${leaving ? " is-leaving" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="polish-stage__icon" aria-hidden="true">
        {status === "running" ? (
          <span className="polish-spinner" />
        ) : status === "done" ? (
          <Check size={14} strokeWidth={2.5} />
        ) : (
          <AlertCircle size={14} />
        )}
      </span>
      <div className="polish-stage__body">
        <span className="polish-stage__title">{STAGE_COPY[stageKey][status]}</span>
        {meta ? <span className="polish-stage__meta">{meta}</span> : null}
        {status === "failed" && error ? <span className="polish-stage__error">{error}</span> : null}
      </div>
      {status === "failed" ? (
        <div className="polish-stage__actions">
          <button
            type="button"
            className="ghost-button is-compact polish-stage__retry"
            onClick={() => onRetry(stageKey)}
            disabled={busy}
          >
            <RotateCcw size={12} aria-hidden="true" />
            Retry
          </button>
          <button
            type="button"
            className="polish-stage__dismiss"
            onClick={onDismiss}
            aria-label={`Dismiss ${STAGE_COPY[stageKey].failed}`}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

// A fixed, transparent stack of per-stage cards (Tailor above Review). The stack
// has no chrome, so once every stage has finished and faded out nothing remains.
export function PolishProgress({ stages, progress, onRetry, onDismiss, busy }: PolishProgressProps) {
  const showTailor = stages === "tailor" || stages === "both";
  const showReview = stages === "review" || stages === "both";
  const total = stages === "both" ? 2 : 1;

  return (
    <div className="polish-progress" aria-label="Polish progress">
      {showTailor ? (
        <StageCard
          stageKey="tailor"
          state={progress.tailor}
          step={1}
          total={total}
          onRetry={onRetry}
          onDismiss={onDismiss}
          busy={busy}
        />
      ) : null}
      {showReview ? (
        <StageCard
          stageKey="review"
          state={progress.review}
          step={stages === "both" ? 2 : 1}
          total={total}
          onRetry={onRetry}
          onDismiss={onDismiss}
          busy={busy}
        />
      ) : null}
    </div>
  );
}
