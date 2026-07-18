export type AiStageKey = "distill" | "tailor" | "review" | "cover" | "answers";

export type AiStageStatus = "idle" | "running" | "done" | "failed" | "stopped";

export type AiStageState = {
  status: AiStageStatus;
  error?: string;
  errorHeadline?: string;
  note?: string;
  noteTone?: "ok" | "warn" | "info";
};

export type PolishProgressState = {
  tailor: AiStageState;
  review: AiStageState;
};

export type AiWorkflowStage = {
  key: AiStageKey;
  state: AiStageState;
  onRetry?: () => void;
  onStop?: () => void;
};

export const AI_STAGE_COPY: Record<AiStageKey, Record<"idle" | "running" | "done" | "failed" | "stopped", string>> = {
  distill: { idle: "Distill", running: "Distilling", done: "Distilled", failed: "Distill failed", stopped: "Distill stopped" },
  tailor: { idle: "Tailor", running: "Tailoring", done: "Tailored", failed: "Tailor failed", stopped: "Tailor stopped" },
  review: { idle: "Review", running: "Reviewing", done: "Reviewed", failed: "Review failed", stopped: "Review stopped" },
  cover: { idle: "Cover letter", running: "Drafting cover letter", done: "Cover letter ready", failed: "Cover letter failed", stopped: "Cover letter stopped" },
  answers: { idle: "Application answers", running: "Drafting answers", done: "Answers ready", failed: "Answers failed", stopped: "Answers stopped" }
};

export function workflowStepLabel(step: number, total: number): string {
  return `Step ${step} of ${total}`;
}

export function workflowCurrentIndex(stages: Pick<AiWorkflowStage, "state">[]): number {
  const running = stages.findIndex((stage) => stage.state.status === "running");
  if (running >= 0) return running;
  const stopped = stages.findIndex((stage) => stage.state.status === "failed" || stage.state.status === "stopped");
  if (stopped >= 0) return stopped;
  const waiting = stages.findIndex((stage) => stage.state.status === "idle");
  if (waiting >= 0) return waiting;
  return Math.max(0, stages.length - 1);
}

export function workflowStageIsBlocked(stages: Pick<AiWorkflowStage, "state">[], index: number): boolean {
  return stages
    .slice(0, index)
    .some((stage) => stage.state.status === "failed" || stage.state.status === "stopped");
}

export function workflowStageCanAdvance(state: AiStageState): boolean {
  return state.status === "done";
}

// Stable-enough identity for one client workflow request. Inputs are plain
// serializable request values; callers snapshot this before fetch and reject a
// response when the live fingerprint no longer matches.
export function workflowInputFingerprint(input: unknown): string {
  return JSON.stringify(input);
}

export function workflowRequestIsCurrent(
  requestGeneration: number,
  currentGeneration: number,
  requestFingerprint: string,
  currentFingerprint: string,
  signal?: AbortSignal
): boolean {
  return (
    requestGeneration === currentGeneration &&
    requestFingerprint === currentFingerprint &&
    signal?.aborted !== true
  );
}
