// The AI stages a user can configure independently, in pipeline order.
//
// This list is the ONE place a stage is declared. `StageId`, the persisted
// settings keys, the settings seeder, the Copy-settings control, and the
// Settings dialog all derive from it, because eight hand-maintained copies of
// "the stages" is how a new stage ends up configurable in one place and
// hardcoded to Resume Polish's provider in another — which is exactly the state the
// cover letter and Q&A stages were in before they were added here.
//
// `settingsPrefix` is the localStorage key prefix. Resume Polish keeps its original
// unprefixed fields; the other stages use explicit names.

export type AiStageId = "job-analysis" | "resume-polish" | "final-check" | "cover" | "answers";

export type AiStageDescriptor = {
  readonly id: AiStageId;
  /** Name used by the Copy-from control. */
  readonly label: string;
  /** Settings-dialog heading: names the work, not the pipeline position. */
  readonly title: string;
  readonly blurb: string;
  readonly settingsPrefix: "" | "finalCheck" | "jobAnalysis" | "cover" | "answers";
};

export const AI_STAGES: readonly AiStageDescriptor[] = [
  {
    id: "job-analysis",
    label: "Job analysis",
    title: "Job analysis",
    blurb: "Structures the posting and, when enabled, checks Initial Fit.",
    settingsPrefix: "jobAnalysis"
  },
  {
    id: "resume-polish",
    label: "Resume Polish",
    title: "Resume Polish",
    blurb: "Creates one grounded proposal for the resume sections marked Polish.",
    settingsPrefix: ""
  },
  {
    id: "final-check",
    label: "Document check",
    title: "Check current document",
    blurb: "Checks the current resume or cover letter after proposal decisions or later edits.",
    settingsPrefix: "finalCheck"
  },
  {
    id: "cover",
    label: "Cover letter",
    title: "Cover letter",
    blurb: "Creates a grounded whole-letter proposal for you to accept or discard.",
    settingsPrefix: "cover"
  },
  {
    id: "answers",
    label: "Application questions",
    title: "Application questions",
    blurb: "Drafts grounded answers to an application's written questions.",
    settingsPrefix: "answers"
  }
];

export const AI_STAGE_IDS: readonly AiStageId[] = AI_STAGES.map((stage) => stage.id);

/** The persisted [provider, model, effort] key triple for one stage. */
export function stageSettingsKeys(stage: AiStageDescriptor): {
  provider: string;
  model: string;
  effort: string;
} {
  const prefix = stage.settingsPrefix;
  // Resume Polish's unprefixed keys are the original names, not a pattern the other
  // stages follow: `aiProvider`/`selectedModel`/`cliReasoningEffort`.
  if (prefix === "") {
    return { provider: "aiProvider", model: "selectedModel", effort: "cliReasoningEffort" };
  }
  return {
    provider: `${prefix}Provider`,
    model: `${prefix}SelectedModel`,
    effort: `${prefix}CliReasoningEffort`
  };
}
