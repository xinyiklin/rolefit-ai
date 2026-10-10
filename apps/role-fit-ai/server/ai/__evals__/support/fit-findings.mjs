// Frozen Fit findings for the synthetic Resume and Cover Polish corpora, sent
// exactly as Polish receives them: benchmark-only labels and provenance never
// reach the prompt.
export function polishFitFindings(fixture) {
  const findings = fixture.fitFindings;
  if (!findings) return null;
  return {
    earlierVersion: findings.earlierVersion,
    matches: findings.matches,
    gaps: findings.gaps.map(({ id, jobExcerpt }) => ({ id, jobExcerpt }))
  };
}

// Statements per gap, graded against the hand labels and, for cited rewrites,
// against Astra's own per-edit labels. A claim of ADDRESSED on a gap labelled
// no-evidence, or one resting on an edit Astra calls unsupported, fails the case.
export function gradeFitGaps(fixture, result, edits = [], factCheck = null) {
  const gaps = fixture.fitFindings?.gaps ?? [];
  if (!gaps.length) return null;
  const statements = new Map((result.fitGaps ?? []).map((item) => [item.gap, item]));
  const unsupported = new Set((factCheck?.edits ?? []).filter((label) => !label.supported)
    .map((label) => edits.find((edit) => edit.n === label.n)?.targetId).filter(Boolean));
  const rows = gaps.map((gap) => {
    const statement = statements.get(gap.id);
    const status = statement?.status ?? "NOT_REPORTED";
    const refs = statement?.targetIds ?? statement?.paragraphs ?? [];
    return {
      gap: gap.id, expect: gap.expect, status,
      addressedNoEvidence: status === "ADDRESSED" && gap.expect === "no-evidence",
      addressedByUnsupported: status === "ADDRESSED" && refs.some((ref) => unsupported.has(ref))
    };
  });
  const count = (predicate) => rows.filter(predicate).length;
  return {
    rows,
    addressed: count((row) => row.status === "ADDRESSED"),
    noEvidence: count((row) => row.status === "NO_EVIDENCE"),
    notReported: count((row) => row.status === "NOT_REPORTED"),
    addressedNoEvidenceGap: count((row) => row.addressedNoEvidence),
    addressedByUnsupported: count((row) => row.addressedByUnsupported)
  };
}

export const fitGapFailures = (grade) => (grade ? grade.addressedNoEvidenceGap + grade.addressedByUnsupported : 0);
