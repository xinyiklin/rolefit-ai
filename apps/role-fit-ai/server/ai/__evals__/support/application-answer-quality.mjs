import { createHash } from "node:crypto";
import { extractAnswerConstraints, validateAnswerConstraints } from "../../../../shared/applicationAnswersContract.ts";
import { ANSWER_JUDGE_PROTOCOL, ANSWER_JUDGE_RUBRIC } from "./application-answer-judge-protocol.mjs";

export const ANSWER_BENCHMARK_ARMS = [
  { id: "opus-low", provider: "claude-cli", model: "claude-opus-5-5", reasoningEffort: "low" },
  { id: "opus-medium", provider: "claude-cli", model: "claude-opus-5-5", reasoningEffort: "medium" },
  { id: "opus-high", provider: "claude-cli", model: "claude-opus-5-5", reasoningEffort: "high" },
  { id: "sol-low", provider: "codex-cli", model: "gpt-6.1-sol", reasoningEffort: "low" },
  { id: "sol-medium", provider: "codex-cli", model: "gpt-6.1-sol", reasoningEffort: "medium" },
  { id: "sol-high", provider: "codex-cli", model: "gpt-6.1-sol", reasoningEffort: "high" },
  { id: "sonnet-low", provider: "claude-cli", model: "claude-sonnet-5-5", reasoningEffort: "low" },
  { id: "sonnet-medium", provider: "claude-cli", model: "claude-sonnet-5-5", reasoningEffort: "medium" },
  { id: "sonnet-high", provider: "claude-cli", model: "claude-sonnet-5-5", reasoningEffort: "high" }
];
export const ANSWER_BENCHMARK_JUDGES = ANSWER_JUDGE_PROTOCOL.approvedBy.map(({ approved, ...judge }) => {
  if (!approved) throw new Error("Every judge must approve the shared protocol before grading.");
  return judge;
});
export const qualityDimensions = ["naturalness", "evidence", "readability", "instructions", "economy"];
export const evidenceConcerns = ["none", "unconfirmed-personal", "unsupported-concrete", "contradiction"];
export const hash = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

export function fixtureRequest(fixture, arm) {
  return {
    ...arm, mode: "conversation", applicationId: `benchmark-${fixture.id}`,
    question: { id: fixture.id, revision: 1, text: fixture.question },
    answerRevisionId: `${fixture.id}-${arm.id}`, resumeText: fixture.resumeText,
    candidateContext: fixture.candidateContext, jobText: fixture.jobText, rawJobText: fixture.rawJobText,
    ...(fixture.previousAnswer ? { previousAnswer: fixture.previousAnswer } : {}),
    ...(fixture.refinement ? { refinement: fixture.refinement } : {}),
    ...(fixture.explicitFacts ? { explicitFacts: fixture.explicitFacts } : {}),
    ...(fixture.clarification ? { clarification: fixture.clarification } : {})
  };
}

export function blindAnswers(fixtureId, records, judgeId) {
  // Stable randomized order allows exact replay and differs for each family judge.
  return records.filter((record) => record.answer).sort((a, b) => hash(`${fixtureId}:${judgeId}:${a.arm}`).localeCompare(hash(`${fixtureId}:${judgeId}:${b.arm}`)))
    .map((record, i) => ({ label: String.fromCharCode(65 + i), arm: record.arm, answer: record.answer.answer, clarification: record.answer.clarification ?? "", counts: record.answer.counts, compliant: record.answer.compliant, mechanicalChecks: record.checks ?? [] }));
}

export function answerControlChecks(fixture, answer) {
  const validation = validateAnswerConstraints(answer.answer, extractAnswerConstraints(fixture.question));
  const checks = [{ check: "exact-counts-replay", passed: ["words", "characters", "sentences"].every((key) => validation.counts[key] === answer.counts?.[key]) }];
  if (answer.answer) checks.push({ check: "employer-length-limits", passed: validation.compliant });
  if (fixture.needsClarification) checks.push({ check: "necessary-separate-clarification", passed: answer.status === "needs-input" && !answer.answer && Boolean(answer.clarification?.trim()) });
  if (fixture.expectedAnswer !== undefined) checks.push({ check: "exact-requested-answer", passed: answer.answer === fixture.expectedAnswer });
  if (fixture.protectedText !== undefined) checks.push({ check: "protected-text-unchanged", passed: answer.answer.includes(fixture.protectedText) });
  return checks;
}

export function judgePrompts(fixture, blind) {
  return {
    systemPrompt: `You are now in the grading phase. Both judges approved the following rubric. Candidate answers ARE supplied in this request; references to the earlier no-answer discussion describe the completed consensus phase. Apply the agreed criteria and return only grading JSON.\n\n${ANSWER_JUDGE_RUBRIC}`,
    userPrompt: JSON.stringify({ question: fixture.question, detectedConstraints: extractAnswerConstraints(fixture.question), evidence: { resume: fixture.resumeText, profile: fixture.candidateContext, job: fixture.jobText, posting: fixture.rawJobText, explicitFacts: fixture.explicitFacts, clarification: fixture.clarification }, expectation: fixture.expectation, previousAnswer: fixture.previousAnswer, refinement: fixture.refinement, answers: blind.map(({ arm, ...answer }) => answer) })
  };
}

export function parseAnswerJudgment(raw, blind) {
  if (!raw || !Array.isArray(raw.ratings) || raw.ratings.length !== blind.length) throw new Error("judge shape");
  const byLabel = new Map(blind.map((item) => [item.label, item.arm]));
  const seen = new Set();
  return raw.ratings.map((rating) => {
    if (!byLabel.has(rating.label) || seen.has(rating.label) || qualityDimensions.some((key) => !Number.isInteger(rating[key]) || rating[key] < 1 || rating[key] > 5)
      || typeof rating.usable !== "boolean" || typeof rating.severeFabrication !== "boolean"
      || !evidenceConcerns.includes(rating.evidenceConcern)
      || (rating.severeFabrication && (rating.usable || ["none", "unconfirmed-personal"].includes(rating.evidenceConcern)))
      || !Array.isArray(rating.missingParts) || rating.missingParts.some((value) => typeof value !== "string") || typeof rating.reason !== "string") throw new Error("judge shape");
    seen.add(rating.label);
    return { ...rating, arm: byLabel.get(rating.label), reason: rating.reason.slice(0, 400), score: (rating.naturalness * 25 + rating.evidence * 25 + rating.readability * 20 + rating.instructions * 15 + rating.economy * 15) / 5 };
  });
}

export function summarizeAnswers(records, judgments) {
  return ANSWER_BENCHMARK_ARMS.map((arm) => {
    const rows = records.filter((row) => row.arm === arm.id);
    const ratings = judgments.flatMap((row) => row.ratings ?? []).filter((row) => row.arm === arm.id);
    const latency = rows.filter((row) => row.answer && Number.isFinite(row.elapsedMs)).map((row) => row.elapsedMs).sort((a, b) => a - b);
    const midpoint = Math.floor(latency.length / 2);
    return {
      ...arm, attempted: rows.length, completed: rows.filter((row) => row.answer).length,
      compliant: rows.filter((row) => row.answer?.compliant && row.answer.status === "ready").length,
      clarifications: rows.filter((row) => row.answer?.status === "needs-input").length,
      providerRequests: rows.some((row) => row.attempts === null) ? null : rows.reduce((sum, row) => sum + (row.attempts ?? 0), 0),
      latencySamples: latency.length,
      medianSeconds: latency.length ? (latency.length % 2 ? latency[midpoint] : (latency[midpoint - 1] + latency[midpoint]) / 2) / 1000 : null,
      judgeRatings: ratings.length, score: ratings.length ? ratings.reduce((sum, row) => sum + row.score, 0) / ratings.length : null,
      dimensions: Object.fromEntries(qualityDimensions.map((dimension) => [dimension, ratings.length ? ratings.reduce((sum, row) => sum + row[dimension], 0) / ratings.length : null])),
      evidenceConcerns: Object.fromEntries(evidenceConcerns.map((concern) => [concern, ratings.filter((rating) => rating.evidenceConcern === concern).length])),
      deterministicChecks: { total: rows.flatMap((row) => row.checks ?? []).length, passed: rows.flatMap((row) => row.checks ?? []).filter((check) => check.passed).length,
        failures: rows.flatMap((row) => (row.checks ?? []).filter((check) => !check.passed).map(({ check }) => ({ fixture: row.fixture, check }))) },
      judgeScores: Object.fromEntries(ANSWER_BENCHMARK_JUDGES.map((judge) => {
        const scores = judgments.filter((row) => row.judge === judge.id).flatMap((row) => row.ratings ?? []).filter((row) => row.arm === arm.id);
        return [judge.id, scores.length ? scores.reduce((sum, row) => sum + row.score, 0) / scores.length : null];
      })),
      judgedUsable: ratings.filter((row) => row.usable && !row.severeFabrication).length,
      severeFabricationFlags: ratings.filter((row) => row.severeFabrication).length,
      // A provider's reported estimate is not an invoice or subscription charge.
      providerReportedCostUsd: rows.length && rows.every((row) => row.usage?.costUsd != null) ? rows.reduce((sum, row) => sum + row.usage.costUsd, 0) : null,
      totalTokens: rows.length && rows.every((row) => row.usage?.totalTokens != null) ? rows.reduce((sum, row) => sum + row.usage.totalTokens, 0) : null
    };
  });
}

export function compareAnswerSettings(judgments, reference = "sol-high") {
  const fixtures = [...new Set(judgments.map(({ fixture }) => fixture))];
  const paired = (fixture, arm) => {
    const ratings = ANSWER_BENCHMARK_JUDGES.map((judge) => judgments.find((row) => row.fixture === fixture && row.judge === judge.id)?.ratings?.find((rating) => rating.arm === arm));
    return ratings.every(Boolean) ? ratings.reduce((sum, rating) => sum + rating.score, 0) / ratings.length : null;
  };
  return ANSWER_BENCHMARK_ARMS.filter(({ id }) => id !== reference).map(({ id }) => {
    const differences = fixtures.flatMap((fixture) => {
      const a = paired(fixture, id), b = paired(fixture, reference);
      return a === null || b === null ? [] : [a - b];
    });
    return { arm: id, reference, pairedCases: differences.length, meanDifference: differences.length ? differences.reduce((sum, value) => sum + value, 0) / differences.length : null,
      wins: differences.filter((value) => value > 0).length, ties: differences.filter((value) => value === 0).length, losses: differences.filter((value) => value < 0).length };
  });
}
