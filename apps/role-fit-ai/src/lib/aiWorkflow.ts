export type AiStageKey = "job-analysis" | "resume-polish" | "cover" | "answers";

export type AiStageStatus = "idle" | "running" | "done" | "failed" | "stopped";

export type AiStageState = {
  status: AiStageStatus;
  error?: string;
  errorHeadline?: string;
  note?: string;
  noteTone?: "ok" | "warn" | "info";
};

export type PolishProgressState = {
  polish: AiStageState;
};

export type AiWorkflowStage = {
  key: AiStageKey;
  state: AiStageState;
  onRetry?: () => void;
  onStop?: () => void;
};

export const AI_STAGE_COPY: Record<AiStageKey, Record<"idle" | "running" | "done" | "failed" | "stopped", string>> = {
  "job-analysis": { idle: "Job analysis", running: "Analyzing job", done: "Job analyzed", failed: "Job analysis failed", stopped: "Job analysis stopped" },
  "resume-polish": { idle: "Resume Polish", running: "Polishing resume", done: "Resume Polish complete", failed: "Resume Polish failed", stopped: "Resume Polish stopped" },
  cover: { idle: "Cover letter", running: "Polishing cover letter", done: "Cover letter proposal ready", failed: "Cover letter failed", stopped: "Cover letter stopped" },
  answers: { idle: "Application answers", running: "Drafting answers", done: "Answers ready", failed: "Answers failed", stopped: "Answers stopped" }
};

export const AI_WORKFLOW_TITLE: Record<AiStageKey, string> = {
  "job-analysis": "Job analysis",
  "resume-polish": "Resume Polish",
  cover: "Cover letter",
  answers: "Application answers"
};

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
