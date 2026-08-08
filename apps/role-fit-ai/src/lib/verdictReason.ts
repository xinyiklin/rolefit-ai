function coverageReasonForScore(score: number): string {
  if (score >= 85) return `The reviewed evidence covers the role's key requirements. Fit score: ${score}.`;
  if (score >= 70) return `The reviewed evidence covers most key requirements. Fit score: ${score}.`;
  if (score >= 46) return `Important requirement gaps remain. Fit score: ${score}.`;
  return `The reviewed evidence does not cover enough key requirements. Fit score: ${score}.`;
}

// Saved applications preserve the review sentence produced at apply time.
// Translate only the old deterministic server templates at presentation time so
// existing records receive the clearer copy without mutating personal tracker
// data. Model-authored and already-current reasons pass through unchanged.
export function displayVerdictReason(value: string): string {
  const reason = value.trim();
  if (!reason) return "";
  if (/^Server verdict: a required eligibility gate is unmet, which forces DON'T APPLY\.$/i.test(reason)) {
    return "A required eligibility condition is not met.";
  }

  const capped = reason.match(
    /^Server verdict: (\d+) missing required qualifications? capped the fit score at (\d+), setting the .+ band\.$/i
  );
  if (capped) {
    const count = Number(capped[1]);
    const score = Number(capped[2]);
    return count === 1
      ? `One required qualification is missing. Fit score capped at ${score}.`
      : `${count} required qualifications are missing. Fit score capped at ${score}.`;
  }

  const recomputed = reason.match(
    /^Server verdict: recomputed from requirement-coverage evidence to the .+ band \(score (\d+)\)\.$/i
  );
  return recomputed ? coverageReasonForScore(Number(recomputed[1])) : reason;
}
