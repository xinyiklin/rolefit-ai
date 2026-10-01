// The AI stages a user can configure independently, in pipeline order.
//
// This list is the ONE place a stage is declared. `StageId`, the persisted
// settings keys, the settings seeder, the Copy-settings control, and the
// Settings dialog all derive from it, because eight hand-maintained copies of
// "the stages" is how a new stage ends up configurable in one place and
// hardcoded to Resume Polish's provider in another — which is exactly the state the
// cover letter and Q&A stages were in before they were added here.
//
// `settingsPrefix` is the persisted key prefix: `<prefix>Provider`,
// `<prefix>SelectedModel`, and `<prefix>CliReasoningEffort`.

export type AiStageId =
  | "job-analysis"
  | "fit-assessment"
  | "resume-polish"
  | "cover-polish"
  | "application-answers"
  | "application-review";

export type AiStageDescriptor = {
  readonly id: AiStageId;
  /** Name used by the Copy-from control. */
  readonly label: string;
  /** Settings-dialog heading: names the work, not the pipeline position. */
  readonly title: string;
  readonly blurb: string;
  readonly settingsPrefix:
    | "jobAnalysis"
    | "fitAssessment"
    | "resumePolish"
    | "coverPolish"
    | "applicationAnswers"
    | "applicationReview";
  readonly supportsInstructions: boolean;
};

export const AI_STAGES: readonly AiStageDescriptor[] = [
  {
    id: "job-analysis",
    label: "Job analysis",
    title: "Job analysis",
    blurb: "Structures the captured posting into the editable job brief.",
    settingsPrefix: "jobAnalysis",
    // Extraction is a fixed, complete posting-to-brief contract. A guidance
    // control would promise influence that the request deliberately does not accept.
    supportsInstructions: false
  },
  {
    id: "fit-assessment",
    label: "Fit Assessment",
    title: "Fit Assessment",
    blurb: "Assesses the selected resume and your Profile against the captured posting.",
    settingsPrefix: "fitAssessment",
    // The assessment rubric is fixed. A free-form override could turn advisory
    // screening into a user-authored verdict preference instead of evidence review.
    supportsInstructions: false
  },
  {
    id: "resume-polish",
    label: "Resume Polish",
    title: "Resume Polish",
    blurb: "Creates one grounded proposal for the resume sections marked Polish.",
    settingsPrefix: "resumePolish",
    supportsInstructions: true
  },
  {
    id: "cover-polish",
    label: "Cover letter Polish",
    title: "Cover letter Polish",
    blurb: "Creates a grounded whole-letter proposal for you to accept or discard.",
    settingsPrefix: "coverPolish",
    supportsInstructions: true
  },
  {
    id: "application-answers",
    label: "Application questions",
    title: "Application questions",
    blurb: "Drafts grounded answers to an application's written questions.",
    settingsPrefix: "applicationAnswers",
    supportsInstructions: true
  },
  {
    id: "application-review",
    label: "Final application review",
    title: "Final application review",
    blurb: "Reviews the current included materials when you request it; never changes or submits them.",
    settingsPrefix: "applicationReview",
    supportsInstructions: false
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
  return {
    provider: `${prefix}Provider`,
    model: `${prefix}SelectedModel`,
    effort: `${prefix}CliReasoningEffort`
  };
}
