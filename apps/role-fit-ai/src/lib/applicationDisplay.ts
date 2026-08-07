import type { Application, ApplicationStatus } from "../hooks/useApplications";
import type { FitVerdict } from "../../shared/fitAssessmentContract.ts";
import { parseDate } from "./applicationFacts.ts";
import { VERDICT_LABEL, VERDICT_TONE } from "./fitVerdict.ts";

export { displayCompany, parseDate } from "./applicationFacts.ts";

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  interested: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn"
};

export const BOARD_STATUSES: ApplicationStatus[] = [
  "interested", "applied", "interviewing", "offer", "rejected", "withdrawn"
];

export type ApplicationActivityGroup = "active" | "inactive";
export const ACTIVITY_STATUS_GROUPS: Record<ApplicationActivityGroup, readonly ApplicationStatus[]> = {
  active: ["interested", "applied", "interviewing", "offer"],
  inactive: ["rejected", "withdrawn"]
};
export type ApplicationActivityFilter = "all" | ApplicationActivityGroup | ApplicationStatus;

export function activityGroupForFilter(filter: ApplicationActivityFilter): ApplicationActivityGroup | null {
  if (filter === "all") return null;
  if (filter === "active" || filter === "inactive") return filter;
  return ACTIVITY_STATUS_GROUPS.active.includes(filter) ? "active" : "inactive";
}

export function isInactiveApplication(app: Pick<Application, "status">): boolean {
  return app.status === "rejected" || app.status === "withdrawn";
}

export function matchesActivityFilter(app: Pick<Application, "status">, filter: ApplicationActivityFilter): boolean {
  if (filter === "all") return true;
  if (filter === "inactive") return isInactiveApplication(app);
  if (filter === "active") return !isInactiveApplication(app);
  return app.status === filter;
}

export function activityCount(applications: Application[], filter: Exclude<ApplicationActivityFilter, "all">): number {
  return applications.filter((app) => matchesActivityFilter(app, filter)).length;
}

export function displayRole(app: Application) {
  return app.role?.trim() || "Role not set";
}

export function companyInitials(name: string) {
  const words = name.replace(/[^a-z0-9\s]/gi, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

export function appFitVerdict(app: Application): {
  verdict: FitVerdict;
  label: string;
  tone: "strong" | "good" | "stretch" | "weak";
} | null {
  const verdict = app.initialFitAudit?.assessment.verdict;
  return verdict ? { verdict, label: VERDICT_LABEL[verdict], tone: VERDICT_TONE[verdict] } : null;
}

export function nextAction(app: Application) {
  if (app.followupAt) return `Follow up ${formatCompactDate(app.followupAt)}`;
  if (app.status === "interviewing") return "Prepare interview";
  if (app.status === "offer") return "Review offer";
  if (app.status === "applied") return "Awaiting response";
  if (app.status === "rejected" || app.status === "withdrawn") return "No action";
  return "Review job details";
}

export function priorityFor(app: Application) {
  if (app.priority) return app.priority;
  if (app.status === "interviewing" || app.status === "offer") return "High";
  if (app.status === "rejected" || app.status === "withdrawn") return "Low";
  return "Medium";
}

const SALARY_PERIOD_LABEL: Record<string, string> = { yr: "/yr", mo: "/mo", hr: "/hr" };

export function formatSalary(comp: Pick<Application, "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod">) {
  const { salaryMin, salaryMax, salaryCurrency, salaryPeriod } = comp;
  const hasMin = typeof salaryMin === "number";
  const hasMax = typeof salaryMax === "number";
  if (!hasMin && !hasMax) return "";
  const currency = (salaryCurrency || "").trim().toUpperCase();
  const symbols: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", JPY: "¥", CAD: "C$", AUD: "A$" };
  const symbol = symbols[currency] ?? "";
  const fmt = (value: number) => symbol
    ? value >= 1000 && value % 1000 === 0 ? `${symbol}${value / 1000}k` : `${symbol}${value.toLocaleString()}`
    : value.toLocaleString();
  const prefix = symbol ? "" : currency ? `${currency} ` : "";
  const range = hasMin && hasMax
    ? `${fmt(salaryMin as number)} – ${fmt(salaryMax as number)}`
    : fmt((hasMin ? salaryMin : salaryMax) as number);
  const period = salaryPeriod ? ` ${SALARY_PERIOD_LABEL[salaryPeriod] ?? ""}`.trimEnd() : "";
  return `${prefix}${range}${period}`.trim();
}

export function formatCompactDate(iso: string) {
  if (!iso) return "";
  const date = parseDate(iso);
  return date ? date.toLocaleDateString([], { month: "short", day: "numeric" }) : iso;
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function statusCount(applications: Application[], status: ApplicationStatus) {
  return applications.filter((app) => app.status === status).length;
}

export function hostLabel(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return "";
  try {
    return new URL(trimmed).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
