// The AI stages a user can configure independently, in pipeline order.
//
// This list is the ONE place a stage is declared. `StageId`, the persisted
// settings keys, the settings seeder, the Copy-settings control, and the
// Settings dialog all derive from it, because eight hand-maintained copies of
// "the stages" is how a new stage ends up configurable in one place and
// hardcoded to Tailor's provider in another — which is exactly the state the
// cover letter and Q&A stages were in before they were added here.
//
// `settingsPrefix` is the localStorage key prefix. Tailor's is empty and Review's
// is `audit` for back-compat with the original single-stage settings shape; do
// not "tidy" those without a migration.

export type AiStageId = "distill" | "tailor" | "review" | "cover" | "answers";

export type AiStageDescriptor = {
  readonly id: AiStageId;
  /** Short name used by the Copy-settings control and the progress rows. */
  readonly label: string;
  /** Settings-dialog heading: names the work, not the pipeline position. */
  readonly title: string;
  readonly blurb: string;
  readonly settingsPrefix: "" | "audit" | "distill" | "cover" | "answers";
};

export const AI_STAGES: readonly AiStageDescriptor[] = [
  {
    id: "distill",
    label: "Distill",
    title: "Job distill",
    blurb: "Turns a job posting into a structured brief.",
    settingsPrefix: "distill"
  },
  {
    id: "tailor",
    label: "Tailor",
    title: "Resume tailor",
    blurb: "Rewrites the sections you marked Tailor against the job.",
    settingsPrefix: ""
  },
  {
    id: "review",
    label: "Review",
    title: "Resume review",
    blurb: "Audits your draft like a recruiter and scores the fit.",
    settingsPrefix: "audit"
  },
  {
    id: "cover",
    label: "Cover",
    title: "Cover letter",
    blurb: "Revises the letter you wrote, from the Cover letter page.",
    settingsPrefix: "cover"
  },
  {
    id: "answers",
    label: "Q&A",
    title: "Application questions",
    blurb: "Drafts answers to an application's written questions.",
    settingsPrefix: "answers"
  }
];

export const AI_STAGE_IDS: readonly AiStageId[] = AI_STAGES.map((stage) => stage.id);

export function aiStage(id: AiStageId): AiStageDescriptor {
  const found = AI_STAGES.find((stage) => stage.id === id);
  if (!found) throw new Error(`Unknown AI stage: ${id}`);
  return found;
}

/** The persisted [provider, model, effort] key triple for one stage. */
export function stageSettingsKeys(stage: AiStageDescriptor): {
  provider: string;
  model: string;
  effort: string;
} {
  const prefix = stage.settingsPrefix;
  // Tailor's unprefixed keys are the original names, not a pattern the other
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
