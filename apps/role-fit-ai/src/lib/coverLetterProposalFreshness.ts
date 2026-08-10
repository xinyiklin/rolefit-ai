export type CoverLetterProposalIdentity = {
  contentFingerprint: string;
  resumeFingerprint: string;
};

export type CoverLetterProposalFreshness = {
  stale: boolean;
  resumeChanged: boolean;
};

// A proposal was already grounded against the resume captured at Polish time.
// Later resume edits merit another human look, but only changes to the letter's
// own target, guidance, or non-resume evidence make that proposal unusable.
export function resolveCoverLetterProposalFreshness(
  captured: CoverLetterProposalIdentity,
  current: CoverLetterProposalIdentity
): CoverLetterProposalFreshness {
  return {
    stale: captured.contentFingerprint !== current.contentFingerprint,
    resumeChanged: captured.resumeFingerprint !== current.resumeFingerprint
  };
}
