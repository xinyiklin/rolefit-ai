import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, RotateCcw, Square, X } from "lucide-react";

export type StageStatus = "idle" | "running" | "done" | "failed";

export type StageState = {
  status: StageStatus;
  error?: string;
  // General, user-safe failure headline (from classifyFailure) shown bold before
  // `error`'s detail text — e.g. "Timed out — the provider took too long."
  errorHeadline?: string;
  // Optional info line shown on the DONE card — e.g. the distill flow uses it to
  // say whether the brief came from the AI or the local fallback.
  note?: string;
  noteTone?: "ok" | "warn";
};

export type PolishProgressState = {
  tailor: StageState;
  review: StageState;
};

// Every stage that can drive a card. Tailor/Review belong to the polish flow;
// Distill/Cover/Answers are single-step flows that reuse the same card vocabulary.
type StageKey = "tailor" | "review" | "distill" | "cover" | "answers";

type PolishProgressProps = {
  stages: "tailor" | "review" | "both";
  progress: PolishProgressState;
  onRetry: (stage: "tailor" | "review") => void;
  onStop: () => void;
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

const STAGE_COPY: Record<StageKey, Record<"running" | "done" | "failed", string>> = {
  tailor: { running: "Tailoring", done: "Tailored", failed: "Tailor failed" },
  review: { running: "Reviewing", done: "Reviewed", failed: "Review failed" },
  distill: { running: "Distilling", done: "Distilled", failed: "Distill failed" },
  cover: { running: "Drafting cover letter", done: "Cover letter ready", failed: "Cover letter failed" },
  answers: { running: "Drafting answers", done: "Answers ready", failed: "Answers failed" }
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
  onStop,
  onDismiss,
  busy
}: {
  stageKey: StageKey;
  state: StageState;
  step: number;
  total: number;
  // Optional: an event-driven flow (e.g. extension auto-import) has nothing to
  // re-run, so it renders no Retry.
  onRetry?: () => void;
  // Optional: the distill flow has no in-flight cancel, so it renders no Stop.
  onStop?: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const { status, error, errorHeadline, note, noteTone } = state;
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
  // A "warn" note means this DONE card is actually carrying a local-fallback
  // notice plus a Retry action, so it persists like a failed card until the
  // user dismisses or retries — auto-fading it would also silently remove the
  // only affordance for getting the AI result back.
  useEffect(() => {
    if (status !== "done" || busy || noteTone === "warn") return;
    // Stagger by step so sibling cards leave one-by-one (Tailor, then Review).
    const leaveDelay = DONE_HOLD_MS + (step - 1) * STAGGER_MS;
    const fadeAt = window.setTimeout(() => setLeaving(true), leaveDelay);
    const goneAt = window.setTimeout(() => setGone(true), leaveDelay + FADE_MS);
    return () => {
      window.clearTimeout(fadeAt);
      window.clearTimeout(goneAt);
    };
  }, [status, busy, step, noteTone]);

  if (status === "idle" || gone) return null;

  const stepText = total > 1 ? `Step ${step} of ${total}` : "";
  const elapsedText = elapsedMs > 0 || status === "running" ? formatElapsed(elapsedMs) : "";
  const meta = [stepText, elapsedText].filter(Boolean).join(" · ");

  // A fallback (done + warn) and a hard failure describe the same kind of thing —
  // a reason + a consequence — so they render through ONE "reason line": a bold,
  // warm headline (the reason, e.g. "AI unavailable") plus a quiet detail. This
  // keeps the reason looking identical whether it lands on a done+warn
  // Tailor/Distill/Review card or a failed card. A done + ok card is different in
  // kind (a success confirmation), so it keeps its own single accent-colored note.
  const isWarnDone = status === "done" && noteTone === "warn";
  const showReasonLine = status === "failed" || isWarnDone;
  const reasonDetail = status === "failed" ? error : note;

  // A fallback (done + warn) recovered from an AI error, so it carries the SAME
  // alert icon + warm tint as a failed card — a success check would contradict
  // the warm "AI unavailable" reason it shows. Only a clean success keeps the
  // green check.
  const cleanDone = status === "done" && !isWarnDone;

  return (
    <div
      className={`polish-stage polish-stage--${status}${isWarnDone ? " polish-stage--warn" : ""}${leaving ? " is-leaving" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="polish-stage__icon" aria-hidden="true">
        {status === "running" ? (
          <span className="polish-spinner" />
        ) : cleanDone ? (
          <Check size={14} strokeWidth={2.5} />
        ) : (
          <AlertCircle size={14} />
        )}
      </span>
      <div className="polish-stage__body">
        <span className="polish-stage__title">{STAGE_COPY[stageKey][status]}</span>
        {meta ? <span className="polish-stage__meta">{meta}</span> : null}
        {status === "done" && noteTone === "ok" && note ? (
          <span className="polish-stage__note polish-stage__note--ok">{note}</span>
        ) : null}
        {showReasonLine && (errorHeadline || reasonDetail) ? (
          <span className="polish-stage__reason">
            {errorHeadline ? <strong>{errorHeadline}</strong> : null}
            {errorHeadline && reasonDetail ? " — " : null}
            {reasonDetail}
          </span>
        ) : null}
      </div>
      <div className="polish-stage__actions">
        {status === "running" && onStop ? (
          <button
            type="button"
            className="ghost-button is-compact polish-stage__stop"
            onClick={onStop}
          >
            <Square size={10} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            Stop
          </button>
        ) : null}
        {/* One Retry affordance for both a hard failure and a done+warn fallback
            (the AI step failed but a local result already filled the card) —
            same label everywhere so the control reads consistently. */}
        {(status === "failed" || isWarnDone) && onRetry ? (
          <button
            type="button"
            className="ghost-button is-compact polish-stage__retry"
            onClick={onRetry}
            disabled={busy}
          >
            <RotateCcw size={12} aria-hidden="true" />
            Retry
          </button>
        ) : null}
        {/* Close the indicator from any state. While running this only HIDES the
            card — the polish keeps running and its result still lands; use Stop
            to actually cancel. */}
        <button
          type="button"
          className="polish-stage__dismiss"
          onClick={onDismiss}
          aria-label={status === "running" ? "Hide progress (the task keeps running)" : "Dismiss progress"}
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// A fixed, transparent stack of per-stage cards (Tailor above Review). The stack
// has no chrome, so once every stage has finished and faded out nothing remains.
export function PolishProgress({ stages, progress, onRetry, onStop, onDismiss, busy }: PolishProgressProps) {
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
          onRetry={() => onRetry("tailor")}
          onStop={onStop}
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
          onRetry={() => onRetry("review")}
          onStop={onStop}
          onDismiss={onDismiss}
          busy={busy}
        />
      ) : null}
    </div>
  );
}

// A generic single-stage card for event-style flows that have no multi-step
// sequencing (distill, cover-letter draft, application-answers draft): one
// StageCard, no busy/Stop (nothing in-flight to cancel from here). Done can
// carry a note (e.g. AI-vs-local-fallback) and, when that note is a "warn"
// fallback, a Retry action via the shared StageCard fallback-retry path.
export function TaskProgress({
  stageKey,
  state,
  onRetry,
  onDismiss
}: {
  stageKey: "distill" | "cover" | "answers";
  state: StageState;
  onRetry?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="polish-progress" aria-label={`${STAGE_COPY[stageKey].running} progress`}>
      <StageCard stageKey={stageKey} state={state} step={1} total={1} onRetry={onRetry} onDismiss={onDismiss} busy={false} />
    </div>
  );
}

// Thin back-compat wrapper so App.tsx compiles unchanged until it migrates to
// TaskProgress directly.
export function DistillProgress({
  state,
  onRetry,
  onDismiss
}: {
  state: StageState;
  onRetry?: () => void;
  onDismiss: () => void;
}) {
  return <TaskProgress stageKey="distill" state={state} onRetry={onRetry} onDismiss={onDismiss} />;
}
