export type InitialFitAuditFingerprintInput = {
  preparationId: string;
  jobText: string;
  resumeFileName: string;
  resumeDocumentVersion: string;
  resumeText: string;
  honestContext: string;
  provider: string;
  model: string;
  reasoningEffort: string;
  instructions: string;
};

// Compact workflow identity, not a security checksum. Two independent 32-bit
// accumulators make accidental collisions materially less likely while keeping
// private resume/job text out of state keys, logs, and persisted audit records.
export function buildInitialFitAuditFingerprint(
  input: InitialFitAuditFingerprintInput
): string {
  const source = JSON.stringify([
    input.preparationId,
    input.jobText,
    input.resumeFileName,
    input.resumeDocumentVersion,
    input.resumeText,
    input.honestContext,
    input.provider,
    input.model,
    input.reasoningEffort,
    input.instructions
  ]);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `initial-fit-${source.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}
