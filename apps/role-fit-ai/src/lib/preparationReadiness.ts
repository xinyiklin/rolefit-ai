export type PreparationReadinessInput = Readonly<{
  jobPrepared: boolean;
  includeResume: boolean;
  resumeReady: boolean;
  includeCoverLetter: boolean;
  coverLetterReady: boolean;
  isPreparing: boolean;
}>;

export type PreparationReadinessCheckKey =
  | "job"
  | "resume"
  | "cover"
  | "preparation";

export type PreparationReadinessCheckStatus =
  | "ready"
  | "blocked"
  | "working"
  | "excluded";

export type PreparationReadinessCheck = Readonly<{
  key: PreparationReadinessCheckKey;
  label: string;
  ready: boolean;
  status: PreparationReadinessCheckStatus;
  detail: string;
}>;

export type PreparationReadiness = Readonly<{
  canApply: boolean;
  primaryBlocker: string;
  checks: Readonly<
    Record<PreparationReadinessCheckKey, PreparationReadinessCheck>
  >;
}>;

export function getPreparationReadiness({
  jobPrepared,
  includeResume,
  resumeReady,
  includeCoverLetter,
  coverLetterReady,
  isPreparing
}: PreparationReadinessInput): PreparationReadiness {
  const preparationReady = !isPreparing;
  const resumeSatisfied = !includeResume || resumeReady;
  const coverSatisfied = !includeCoverLetter || coverLetterReady;
  const canApply =
    jobPrepared && resumeSatisfied && coverSatisfied && preparationReady;

  // Active work comes first so Apply never suggests starting another corrective
  // action while the current preparation can still settle the package.
  const primaryBlocker = isPreparing
    ? "Wait for preparation to finish."
    : !jobPrepared
      ? "Prepare a job before applying."
      : includeResume && !resumeReady
        ? "Choose a ready resume or turn off Include."
        : includeCoverLetter && !coverLetterReady
          ? "Choose a ready cover letter or turn off Include."
          : "";

  return {
    canApply,
    primaryBlocker,
    checks: {
      job: {
        key: "job",
        label: "Job",
        ready: jobPrepared,
        status: jobPrepared ? "ready" : "blocked",
        detail: jobPrepared ? "Job prepared." : "Prepare a job posting."
      },
      resume: {
        key: "resume",
        label: "Resume",
        ready: resumeSatisfied,
        status: !includeResume ? "excluded" : resumeReady ? "ready" : "blocked",
        detail: !includeResume
          ? "Not included in this Apply."
          : resumeReady
            ? "Included and ready."
            : "Choose or create a resume."
      },
      cover: {
        key: "cover",
        label: "Cover letter",
        ready: coverSatisfied,
        status: !includeCoverLetter ? "excluded" : coverLetterReady ? "ready" : "blocked",
        detail: !includeCoverLetter
          ? "Not included in this Apply."
          : coverLetterReady
            ? "Included and ready."
            : "Complete a cover letter."
      },
      preparation: {
        key: "preparation",
        label: "Preparation",
        ready: preparationReady,
        status: isPreparing ? "working" : "ready",
        detail: isPreparing
          ? "Finishing the selected job or materials."
          : jobPrepared
            ? "Preparation complete."
            : "Ready to prepare."
      }
    }
  };
}
