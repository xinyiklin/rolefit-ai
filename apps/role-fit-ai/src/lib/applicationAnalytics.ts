import type { Application } from "../hooks/useApplications";
import { displayCompany, parseDate } from "./applicationFacts.ts";

function monthBucket(date: Date) {
  return `${date.toLocaleDateString([], { month: "short" })} '${String(date.getFullYear()).slice(-2)}`;
}

export function isSubmittedApplication(application: Application) {
  // Legacy or manually edited records may still carry appliedAt after being
  // marked Skipped. Status is the authoritative decision provenance: a
  // a skipped decision is never an employer submission event.
  return application.status !== "not_applying" && Boolean(parseDate(application.appliedAt));
}

export function monthlyApplicationsSent(applications: Application[]) {
  // Only an explicit appliedAt is a submission event. createdAt is a tracking
  // event and updatedAt can represent any edit, so neither can stand in for an
  // employer interaction without making the analytics sound more certain than
  // the stored data.
  const buckets = new Map<string, { label: string; applications: number }>();
  for (const application of applications) {
    if (!isSubmittedApplication(application)) continue;
    const date = parseDate(application.appliedAt);
    if (!date) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const row = buckets.get(key) ?? { label: monthBucket(date), applications: 0 };
    row.applications += 1;
    buckets.set(key, row);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6);
}

export function topTrackedCompanies(applications: Application[]) {
  const counts = new Map<string, number>();
  for (const application of applications) {
    const company = displayCompany(application);
    counts.set(company, (counts.get(company) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
}

export function trackingHygiene(applications: Application[]) {
  let missingFollowup = 0;
  let closed = 0;
  let submitted = 0;

  for (const application of applications) {
    if (!application.followupAt && !["not_applying", "rejected", "withdrawn"].includes(application.status)) {
      missingFollowup += 1;
    }
    if (["rejected", "withdrawn"].includes(application.status)) closed += 1;
    if (isSubmittedApplication(application)) submitted += 1;
  }

  return { missingFollowup, closed, submitted };
}
