import type { AiStageId } from "../config/aiStages.ts";

// Fit Assessment reports its progress through Prepare, not this workflow strip.
export type AiStageKey = Exclude<AiStageId, "fit-assessment">;

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
  "application-review": { idle: "Final review", running: "Reviewing application", done: "Application review finished", failed: "Application review failed", stopped: "Application review stopped" },
  "job-analysis": { idle: "Job analysis", running: "Analyzing job", done: "Job analyzed", failed: "Job analysis failed", stopped: "Job analysis stopped" },
  "resume-polish": { idle: "Resume Polish", running: "Polishing resume", done: "Resume Polish complete", failed: "Resume Polish failed", stopped: "Resume Polish stopped" },
  "cover-polish": { idle: "Cover letter Polish", running: "Polishing cover letter", done: "Cover letter proposal ready", failed: "Cover letter Polish failed", stopped: "Cover letter Polish stopped" },
  "application-answers": { idle: "Application answers", running: "Drafting answers", done: "Answers ready", failed: "Answers failed", stopped: "Answers stopped" }
};

export const AI_WORKFLOW_TITLE: Record<AiStageKey, string> = {
  "application-review": "Final application review",
  "job-analysis": "Job analysis",
  "resume-polish": "Resume Polish",
  "cover-polish": "Cover letter Polish",
  "application-answers": "Application answers"
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
