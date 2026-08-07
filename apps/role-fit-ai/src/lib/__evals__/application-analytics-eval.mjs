import assert from "node:assert/strict";
import {
  assessmentCoverage,
  fitVerdictDistribution,
  interviewProgressionByFitVerdict,
  monthlyApplicationsSent,
  recurringAdjacentCoreRequirements,
  recurringMissingCoreRequirements,
  recurringResumeVisibilityGaps,
  resumePolishModeDistribution,
  submissionReadinessDistribution,
  topTrackedCompanies,
  trackingHygiene
} from "../applicationAnalytics.ts";
import { parseDate } from "../applicationFacts.ts";

const priorTimeZone = process.env.TZ;
process.env.TZ = "America/New_York";
const localDateOnly = parseDate("2026-07-20");
assert.equal(localDateOnly?.getFullYear(), 2026);
assert.equal(localDateOnly?.getMonth(), 6);
assert.equal(localDateOnly?.getDate(), 20);
if (priorTimeZone === undefined) delete process.env.TZ;
else process.env.TZ = priorTimeZone;

const assessment = (verdict, confidence, eligibility, requirements) => ({
  verdict, confidence, eligibility: { status: eligibility }, requirements
});
const base = { title: "Role", jobUrl: "", createdAt: "2026-04-01T12:00:00.000Z", updatedAt: "2026-07-01T12:00:00.000Z" };
const applications = [
  {
    ...base, id: "withdrawn", company: "Acme", status: "withdrawn",
    initialFitAudit: { assessment: assessment("STRETCH", "LOW", "UNCERTAIN", [
      { requirement: "Kubernetes", importance: "CORE", coverage: "MISSING" }
    ]) }
  },
  {
    ...base, id: "submitted", company: "Acme", status: "interviewing",
    appliedAt: "2026-05-03T12:00:00.000Z", followupAt: "2026-05-10T12:00:00.000Z",
    initialFitAudit: { assessment: assessment("REASONABLE_FIT", "HIGH", "SATISFIED", [
      { requirement: "Kubernetes", importance: "CORE", coverage: "MISSING" },
      { requirement: "Distributed systems", importance: "CORE", coverage: "ADJACENT" }
    ]) },
    submissionAssessment: {
      readiness: "READY",
      requirementVisibility: [
        { requirement: "Distributed systems", importance: "CORE", coverage: "ADJACENT" }
      ]
    },
    resumeUsed: "tailored",
    resumePolishMode: "automatic"
  },
  {
    ...base, id: "saved", company: "Beta", status: "interested",
    initialFitAudit: { assessment: assessment("REASONABLE_FIT", "MEDIUM", "SATISFIED", []) },
    submissionAssessment: {
      readiness: "REVISIONS_RECOMMENDED",
      requirementVisibility: [
        { requirement: "Distributed systems", importance: "CORE", coverage: "MISSING" }
      ]
    },
    resumeUsed: "tailored",
    resumePolishMode: "manual"
  }
];

assert.equal(monthlyApplicationsSent(applications).length, 1);
assert.deepEqual(trackingHygiene(applications), { missingFollowup: 1, closed: 1, submitted: 1 });
assert.deepEqual(topTrackedCompanies(applications)[0], ["Acme", 2]);
assert.equal(fitVerdictDistribution(applications).find((row) => row.verdict === "REASONABLE_FIT").count, 2);
assert.deepEqual(recurringMissingCoreRequirements(applications)[0], ["Kubernetes", 2]);
assert.deepEqual(recurringAdjacentCoreRequirements(applications)[0], ["Distributed systems", 1]);
assert.deepEqual(recurringResumeVisibilityGaps(applications)[0], ["Distributed systems", 2]);
assert.deepEqual(resumePolishModeDistribution(applications), { automatic: 1, manual: 1 });
assert.equal(interviewProgressionByFitVerdict(applications).find((row) => row.verdict === "REASONABLE_FIT").rate, 100);
assert.deepEqual(assessmentCoverage(applications), { assessed: 3, lowConfidence: 1, unresolvedEligibility: 1, adjacentCore: 1 });
assert.equal(submissionReadinessDistribution(applications).find((row) => row.readiness === "READY").count, 1);

console.log("PASS categorical application analytics");
