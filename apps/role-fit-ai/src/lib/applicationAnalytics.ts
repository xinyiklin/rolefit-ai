import type { Application } from "../hooks/useApplications";
import type { FitVerdict, SubmissionReadiness } from "../../shared/fitAssessmentContract.ts";
import { displayCompany, parseDate } from "./applicationFacts.ts";

export const FIT_VERDICT_ORDER: FitVerdict[] = ["STRONG_FIT", "REASONABLE_FIT", "STRETCH", "LIMITED_FIT"];
export const READINESS_ORDER: SubmissionReadiness[] = ["READY", "REVISIONS_RECOMMENDED", "EVIDENCE_NEEDED", "NOT_READY"];

function monthBucket(date: Date) {
  return `${date.toLocaleDateString([], { month: "short" })} '${String(date.getFullYear()).slice(-2)}`;
}

export function monthlyApplicationsSent(applications: Application[]) {
  const buckets = new Map<string, { label: string; applications: number }>();
  for (const application of applications) {
    const date = parseDate(application.appliedAt);
    if (!date) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const row = buckets.get(key) ?? { label: monthBucket(date), applications: 0 };
    row.applications += 1;
    buckets.set(key, row);
  }
  return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
}

export function topTrackedCompanies(applications: Application[]) {
  const counts = new Map<string, number>();
  for (const application of applications) {
    const company = displayCompany(application);
    counts.set(company, (counts.get(company) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
}

export function recurringMissingCoreRequirements(applications: Application[]) {
  const counts = new Map<string, number>();
  for (const application of applications) {
    for (const requirement of application.initialFitAudit?.assessment.requirements ?? []) {
      if (requirement.importance !== "CORE" || requirement.coverage !== "MISSING") continue;
      counts.set(requirement.requirement, (counts.get(requirement.requirement) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
}

export function recurringAdjacentCoreRequirements(applications: Application[]) {
  const counts = new Map<string, number>();
  for (const application of applications) {
    for (const requirement of application.initialFitAudit?.assessment.requirements ?? []) {
      if (requirement.importance !== "CORE" || requirement.coverage !== "ADJACENT") continue;
      counts.set(requirement.requirement, (counts.get(requirement.requirement) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
}

export function recurringResumeVisibilityGaps(applications: Application[]) {
  const counts = new Map<string, number>();
  for (const application of applications) {
    for (const requirement of application.submissionAssessment?.requirementVisibility ?? []) {
      if (requirement.coverage === "COVERED") continue;
      counts.set(requirement.requirement, (counts.get(requirement.requirement) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
}

export function resumePolishModeDistribution(applications: Application[]) {
  let automatic = 0;
  let manual = 0;
  for (const application of applications) {
    if (application.resumeUsed !== "tailored") continue;
    if (application.resumePolishMode === "automatic") automatic += 1;
    if (application.resumePolishMode === "manual") manual += 1;
  }
  return { automatic, manual };
}

export function fitVerdictDistribution(applications: Application[]) {
  const counts = new Map<FitVerdict, number>(FIT_VERDICT_ORDER.map((verdict) => [verdict, 0]));
  for (const application of applications) {
    const verdict = application.initialFitAudit?.assessment.verdict;
    if (verdict) counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
  }
  return FIT_VERDICT_ORDER.map((verdict) => ({ verdict, count: counts.get(verdict) ?? 0 }));
}

export function interviewProgressionByFitVerdict(applications: Application[]) {
  return FIT_VERDICT_ORDER.map((verdict) => {
    const submitted = applications.filter((application) =>
      application.initialFitAudit?.assessment.verdict === verdict && Boolean(parseDate(application.appliedAt))
    );
    const progressed = submitted.filter((application) => application.status === "interviewing" || application.status === "offer").length;
    return {
      verdict,
      submitted: submitted.length,
      progressed,
      rate: submitted.length ? Math.round((progressed / submitted.length) * 100) : null
    };
  });
}

export function assessmentCoverage(applications: Application[]) {
  let lowConfidence = 0;
  let unresolvedEligibility = 0;
  let adjacentCore = 0;
  let assessed = 0;
  for (const application of applications) {
    const assessment = application.initialFitAudit?.assessment;
    if (!assessment) continue;
    assessed += 1;
    if (assessment.confidence === "LOW") lowConfidence += 1;
    if (assessment.eligibility.status === "UNCERTAIN") unresolvedEligibility += 1;
    adjacentCore += assessment.requirements.filter((item) => item.importance === "CORE" && item.coverage === "ADJACENT").length;
  }
  return { assessed, lowConfidence, unresolvedEligibility, adjacentCore };
}

export function submissionReadinessDistribution(applications: Application[]) {
  return READINESS_ORDER.map((readiness) => ({
    readiness,
    count: applications.filter((application) => application.submissionAssessment?.readiness === readiness).length
  }));
}

export function trackingHygiene(applications: Application[]) {
  let missingFollowup = 0;
  let closed = 0;
  let submitted = 0;
  for (const application of applications) {
    if (!application.followupAt && !["rejected", "withdrawn"].includes(application.status)) missingFollowup += 1;
    if (["rejected", "withdrawn"].includes(application.status)) closed += 1;
    if (parseDate(application.appliedAt)) submitted += 1;
  }
  return { missingFollowup, closed, submitted };
}
