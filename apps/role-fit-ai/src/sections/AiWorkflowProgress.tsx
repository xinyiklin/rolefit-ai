import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Circle, RotateCcw, Square, X } from "lucide-react";
import {
  AI_STAGE_COPY,
  workflowCurrentIndex,
  workflowStageIsBlocked,
  workflowStepLabel,
  type AiStageKey,
  type AiStageState,
  type AiWorkflowStage
} from "../lib/aiWorkflow";

const DONE_HOLD_MS = 10000;
const FADE_MS = 360;

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function StageIcon({ status }: { status: AiStageState["status"] }) {
  if (status === "running") return <span className="ai-workflow__spinner" />;
  if (status === "done") return <Check size={13} strokeWidth={2.5} />;
  if (status === "failed") return <AlertCircle size={13} />;
  if (status === "stopped") return <Square size={10} fill="currentColor" strokeWidth={0} />;
  return <Circle size={10} />;
}

function StageRow({
  stage,
  step,
  total,
  blockedByEarlierFailure,
  busy
}: {
  stage: AiWorkflowStage;
  step: number;
  total: number;
  blockedByEarlierFailure: boolean;
  busy: boolean;
}) {
  const { state } = stage;
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (state.status === "running") {
      startRef.current = Date.now();
      setElapsedMs(0);
      const interval = window.setInterval(() => {
        if (startRef.current !== null) setElapsedMs(Date.now() - startRef.current);
      }, 1000);
      return () => window.clearInterval(interval);
    }
    if (state.status !== "idle" && startRef.current !== null) {
      setElapsedMs(Date.now() - startRef.current);
    }
  }, [state.status]);

  const statusCopy = state.status === "idle"
    ? blockedByEarlierFailure ? "Not run" : "Waiting"
    : AI_STAGE_COPY[stage.key][state.status];
  const meta = [
    workflowStepLabel(step, total),
    state.status === "running" || elapsedMs > 0 ? formatElapsed(elapsedMs) : ""
  ].filter(Boolean).join(" · ");
  const showFailure = state.status === "failed" || state.status === "stopped";

  return (
    <div className={`ai-workflow__stage ai-workflow__stage--${state.status}${blockedByEarlierFailure ? " is-blocked" : ""}`}>
      <span className="ai-workflow__stage-icon" aria-hidden="true">
        <StageIcon status={state.status} />
      </span>
      <div className="ai-workflow__stage-body">
        <span className="ai-workflow__stage-title">{statusCopy}</span>
        <span className="ai-workflow__stage-meta">{meta}</span>
        {state.status === "done" && state.note ? (
          <span className={`ai-workflow__note ai-workflow__note--${state.noteTone ?? "info"}`}>{state.note}</span>
        ) : null}
        {showFailure && (state.errorHeadline || state.error) ? (
          <span className="ai-workflow__reason">
            {state.errorHeadline ? <strong>{state.errorHeadline}</strong> : null}
            {state.errorHeadline && state.error ? ": " : null}
            {state.error}
          </span>
        ) : null}
      </div>
      <div className="ai-workflow__stage-actions">
        {state.status === "running" && stage.onStop ? (
          <button type="button" className="ghost-button is-compact" onClick={stage.onStop}>
            <Square size={9} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            Stop
          </button>
        ) : null}
        {state.status === "failed" && stage.onRetry ? (
          <button type="button" className="ghost-button is-compact" onClick={stage.onRetry} disabled={busy}>
            <RotateCcw size={11} aria-hidden="true" />
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function AiWorkflowProgress({
  stages,
  onDismiss,
  busy,
  title = "AI workflow"
}: {
  stages: AiWorkflowStage[];
  onDismiss: () => void;
  busy: boolean;
  title?: string;
}) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const hasStarted = stages.some((stage) => stage.state.status !== "idle");
  const hasFailure = stages.some((stage) => stage.state.status === "failed" || stage.state.status === "stopped");
  const allDone = stages.length > 0 && stages.every((stage) => stage.state.status === "done");
  const currentIndex = workflowCurrentIndex(stages);
  const anyRunning = stages.some((stage) => stage.state.status === "running");
  const failedStage = stages.find((stage) => stage.state.status === "failed" || stage.state.status === "stopped");
  const currentStage = stages[Math.min(currentIndex, Math.max(0, stages.length - 1))];
  const liveSummary = failedStage
    ? `${title}: ${AI_STAGE_COPY[failedStage.key][failedStage.state.status]}.`
    : allDone
      ? `${title} complete.`
      : currentStage?.state.status === "running"
        ? `${title}: ${AI_STAGE_COPY[currentStage.key].running}.`
        : `${title} ready.`;

  useEffect(() => {
    if (anyRunning) {
      setLeaving(false);
      setGone(false);
    }
  }, [anyRunning]);

  useEffect(() => {
    if (!allDone || busy || hasFailure) return;
    const leaveTimer = window.setTimeout(() => setLeaving(true), DONE_HOLD_MS);
    const goneTimer = window.setTimeout(() => setGone(true), DONE_HOLD_MS + FADE_MS);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(goneTimer);
    };
  }, [allDone, busy, hasFailure]);

  if (!stages.length || !hasStarted || gone) return null;

  return (
    <section className={`ai-workflow${leaving ? " is-leaving" : ""}`} aria-label={`${title} progress`}>
      {/* Announce stage transitions, not the visible elapsed timer that updates
          every second inside StageRow. */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveSummary}</span>
      <header className="ai-workflow__head">
        <div>
          <strong>{title}</strong>
          <span>{workflowStepLabel(currentIndex + 1, stages.length)}</span>
        </div>
        <button
          type="button"
          className="ai-workflow__dismiss"
          onClick={onDismiss}
          aria-label={busy ? "Hide progress; the current stage keeps running" : "Dismiss progress"}
        >
          <X size={13} aria-hidden="true" />
        </button>
      </header>
      <div className="ai-workflow__stages">
        {stages.map((stage, index) => {
          const blockedByEarlierFailure = workflowStageIsBlocked(stages, index);
          return (
            <StageRow
              key={stage.key}
              stage={stage}
              step={index + 1}
              total={stages.length}
              blockedByEarlierFailure={blockedByEarlierFailure}
              busy={busy}
            />
          );
        })}
      </div>
    </section>
  );
}

export function TaskProgress({
  stageKey,
  state,
  onRetry,
  onDismiss
}: {
  stageKey: Extract<AiStageKey, "cover" | "answers">;
  state: AiStageState;
  onRetry?: () => void;
  onDismiss: () => void;
}) {
  return (
    <AiWorkflowProgress
      stages={[{ key: stageKey, state, onRetry }]}
      onDismiss={onDismiss}
      busy={state.status === "running"}
      title={stageKey === "cover" ? "Cover letter" : "Application answers"}
    />
  );
}
