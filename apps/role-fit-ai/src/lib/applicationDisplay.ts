import type { Application, ApplicationStatus } from "../hooks/useApplications";
import type { FitAssessmentSnapshot, FitAssessmentVerdict } from "../../shared/fitAssessmentContract.ts";
import { describeProviderModel } from "../config/aiOptions.ts";
import { parseDate } from "./applicationFacts.ts";

export { displayCompany, parseDate } from "./applicationFacts.ts";

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  // "Skipped" (not "Not applying"): every sibling label is a settled past-tense
  // state, and "Not applying"/"Applied" differ by too little to scan apart in
  // the Stage column. "Passed" was rejected — beside Interviewing/Offer it
  // reads as passing a round. The stored key stays `not_applying`.
  not_applying: "Skipped",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn"
};

export const BOARD_STATUSES: ApplicationStatus[] = [
  "not_applying",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn"
];

export type ApplicationActivityGroup = "active" | "inactive";

export const ACTIVITY_STATUS_GROUPS: Record<
  ApplicationActivityGroup,
  readonly ApplicationStatus[]
> = {
  active: ["applied", "interviewing", "offer"],
  inactive: ["not_applying", "rejected", "withdrawn"]
};

export type ApplicationActivityFilter =
  | "all"
  | ApplicationActivityGroup
  | ApplicationStatus;

export function activityGroupForFilter(
  filter: ApplicationActivityFilter
): ApplicationActivityGroup | null {
  if (filter === "all") return null;
  if (filter === "active" || filter === "inactive") return filter;
  return ACTIVITY_STATUS_GROUPS.active.includes(filter) ? "active" : "inactive";
}

export function isInactiveApplication(app: Pick<Application, "status">): boolean {
  return app.status === "not_applying" || app.status === "rejected" || app.status === "withdrawn";
}

export function matchesActivityFilter(
  app: Pick<Application, "status">,
  filter: ApplicationActivityFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "inactive") return isInactiveApplication(app);
  if (filter === "active") return !isInactiveApplication(app);
  return app.status === filter;
}

export function activityCount(
  applications: Application[],
  filter: Exclude<ApplicationActivityFilter, "all">
): number {
  return applications.filter((app) => matchesActivityFilter(app, filter)).length;
}

export function applicationActivityDate(
  app: Pick<Application, "status" | "notApplyingAt" | "appliedAt" | "createdAt">
): string {
  return app.status === "not_applying"
    ? app.notApplyingAt || app.createdAt || ""
    : app.appliedAt || app.createdAt || "";
}

export function displayRole(app: Application) {
  return app.role?.trim() || "Role not set";
}

export function companyInitials(name: string) {
  const words = name
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

const FIT_ASSESSMENT_DISPLAY: Record<FitAssessmentVerdict, {
  label: string;
  tone: "strong" | "good" | "stretch" | "weak";
  rank: number;
}> = {
  STRONG: { label: "Strong fit", tone: "strong", rank: 4 },
  REASONABLE: { label: "Reasonable fit", tone: "good", rank: 3 },
  STRETCH: { label: "Stretch", tone: "stretch", rank: 2 },
  LIMITED: { label: "Limited fit", tone: "weak", rank: 1 }
};

// Tracker fit is the compact Fit Assessment verdict captured for the exact resume
// selected during Prepare. There is no numeric fallback or historical review
// reader.
export function appFitVerdict(
  app: Application
): { verdict: FitAssessmentVerdict; label: string; tone: "strong" | "good" | "stretch" | "weak" } | null {
  const verdict = app.fitAssessment?.result.verdict;
  if (!verdict) return null;
  return { verdict, ...FIT_ASSESSMENT_DISPLAY[verdict] };
}

export function fitAssessmentRank(app: Application): number {
  const verdict = app.fitAssessment?.result.verdict;
  return verdict ? FIT_ASSESSMENT_DISPLAY[verdict].rank : 0;
}

export function fitAssessmentRunLabel(snapshot: FitAssessmentSnapshot): string {
  const parts: string[] = [];
  if (snapshot.assessedAt && Number.isFinite(Date.parse(snapshot.assessedAt))) {
    parts.push(`Last assessed ${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(snapshot.assessedAt))}`);
  }
  if (snapshot.provider) {
    parts.push(describeProviderModel(snapshot.provider, snapshot.model ?? ""));
  }
  if (snapshot.reasoningEffort) parts.push(`${snapshot.reasoningEffort} reasoning`);
  const rubricVersion = snapshot.promptVersion?.match(/-v([1-9]\d*)$/)?.[1];
  if (rubricVersion) parts.push(`rubric v${rubricVersion}`);
  return parts.join(" · ");
}

export function nextAction(app: Application) {
  if (app.status === "not_applying") return "No action";
  if (app.followupAt) return `Follow up ${formatCompactDate(app.followupAt)}`;
  if (app.status === "interviewing") return "Prepare interview";
  if (app.status === "offer") return "Review offer";
  if (app.status === "applied") return "Awaiting response";
  if (app.status === "rejected" || app.status === "withdrawn") return "No action";
  return "Review job details";
}

const SALARY_PERIOD_LABEL: Record<string, string> = { yr: "/yr", mo: "/mo", hr: "/hr" };

// Compact compensation string from the stored min/max/currency/period, e.g.
// "$160k – $200k /yr" or "USD 120,000 /yr". Returns "" when nothing is set.
export function formatSalary(
  comp: Pick<Application, "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod">
) {
  const { salaryMin, salaryMax, salaryCurrency, salaryPeriod } = comp;
  const hasMin = typeof salaryMin === "number";
  const hasMax = typeof salaryMax === "number";
  if (!hasMin && !hasMax) return "";
  const currency = (salaryCurrency || "").trim().toUpperCase();
  // Job analysis can emit non-USD currencies, so render their native symbol
  // (falls back to an ISO-code prefix for anything unmapped).
  const CURRENCY_SYMBOL: Record<string, string> = {
    USD: "$", GBP: "£", EUR: "€", JPY: "¥", CAD: "C$", AUD: "A$"
  };
  const symbol = CURRENCY_SYMBOL[currency] ?? "";
  const fmt = (value: number) => {
    if (symbol) {
      return value >= 1000 && value % 1000 === 0 ? `${symbol}${value / 1000}k` : `${symbol}${value.toLocaleString()}`;
    }
    return value.toLocaleString();
  };
  const prefix = symbol ? "" : currency ? `${currency} ` : "";
  const range =
    hasMin && hasMax
      ? `${fmt(salaryMin as number)} – ${fmt(salaryMax as number)}`
      : fmt((hasMin ? salaryMin : salaryMax) as number);
  const period = salaryPeriod ? ` ${SALARY_PERIOD_LABEL[salaryPeriod] ?? ""}`.trimEnd() : "";
  return `${prefix}${range}${period}`.trim();
}

export function formatCompactDate(iso: string) {
  if (!iso) return "";
  const date = parseDate(iso);
  return date
    ? date.toLocaleDateString([], { month: "short", day: "numeric" })
    : iso;
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function statusCount(applications: Application[], status: ApplicationStatus) {
  return applications.filter((app) => app.status === status).length;
}

// Compact display host for a posting link: http(s) only — anything else returns
// "" and the caller skips rendering a link (one safety rule everywhere a stored
// URL becomes clickable). Strips the leading "www." so boards read as short
// chips. Shared by TrackerInspector's "Found on" chips and the duplicate-review
// modal's member links.
export function hostLabel(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return "";
  try {
    return new URL(trimmed).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
