import type { Application, ApplicationStatus } from "../hooks/useApplications";
import type { FitAssessmentSnapshot, FitAssessmentVerdict } from "../../shared/fitAssessmentContract.ts";
import { describeProviderModel } from "../config/aiOptions.ts";
import { displayCompany, parseDate } from "./applicationFacts.ts";
import { APPLICATION_STATUSES } from "./applicationStatusTransitions.ts";
import { ATS_LABELS, atsPostingKey, postingIdentityFromText } from "./jobIdentity.ts";

export { displayCompany, parseDate };

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  // Use a settled decision label while retaining the stored `not_applying` key.
  not_applying: "Skipped",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn"
};

export const BOARD_STATUSES: readonly ApplicationStatus[] = APPLICATION_STATUSES;

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
  STRONG: { label: "Strong", tone: "strong", rank: 4 },
  REASONABLE: { label: "Reasonable", tone: "good", rank: 3 },
  STRETCH: { label: "Stretch", tone: "stretch", rank: 2 },
  LIMITED: { label: "Limited", tone: "weak", rank: 1 }
};

export function fitAssessmentVerdictLabel(verdict: FitAssessmentVerdict): string {
  return FIT_ASSESSMENT_DISPLAY[verdict].label;
}

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

// Stored tracker URLs are untrusted text. Return only browser-safe external
// destinations so every clickable posting link shares one boundary.
export function safeExternalUrl(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return "";
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : "";
  } catch {
    return "";
  }
}

export function safeExternalUrls(urls: readonly string[]): string[] {
  return [...new Set(urls.map(safeExternalUrl).filter(Boolean))];
}

// Compact display host for a validated posting link. Strips the leading
// "www." so boards read as short chips.
export function hostLabel(url: string): string {
  const safeUrl = safeExternalUrl(url);
  return safeUrl ? new URL(safeUrl).hostname.replace(/^www\./, "") : "";
}

export type PostingIdentity = {
  /** The posting's own identifier, e.g. "JR-90210" or "4012345". */
  id: string;
  /** What kind of id it is — displayed with the value, since a board's internal
   *  id and the employer's requisition number mean different things. */
  label: string;
};

// Lever and Ashby identify a posting by UUID. Those are not ids a person reads
// off a page, quotes to a recruiter, or recognizes later, and a 36-character
// value only wraps across the display surfaces, so they count as no id.
const OPAQUE_POSTING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The identifier the employer or board gives this posting, derived from the
// same evidence duplicate matching already reads: a requisition id printed in
// the saved posting text first, then an ATS posting id parsed from a saved
// link. Nothing is stored or invented — a record with neither has no id to show.
export function postingIdentity(
  app: Pick<Application, "jobUrl" | "sourceUrls" | "jobDescription" | "rawJobDescription">
): PostingIdentity | null {
  const textIdentity = postingIdentityFromText(app.rawJobDescription?.trim() || app.jobDescription);
  if (textIdentity) return textIdentity;
  for (const url of [app.jobUrl, ...(app.sourceUrls ?? []).map((source) => source.url)]) {
    const key = atsPostingKey(safeExternalUrl(url));
    if (key && !OPAQUE_POSTING_ID.test(key.jobId)) {
      return { id: key.jobId, label: `${ATS_LABELS[key.ats] ?? key.ats} ID` };
    }
  }
  return null;
}

// One posting id per application, derived once per tracker list. Search reads
// this instead of re-deriving every record's id on each keystroke.
export function postingIdIndex(applications: readonly Application[]): Map<string, string> {
  return new Map(applications.map((app) => [app.id, postingIdentity(app)?.id ?? ""]));
}

// Higher ranks lead table results while a query is active. Identity fields are
// the search contract so hidden posting prose cannot flood a company lookup.
export function applicationSearchRank(
  app: Application,
  query: string,
  postingId: string
): number | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const company = displayCompany(app).toLowerCase();
  const role = displayRole(app).toLowerCase();
  const title = String(app.title ?? "").toLowerCase();
  const normalizedPostingId = postingId.toLowerCase();

  if (company === needle) return 6;
  if (company.startsWith(needle)) return 5;
  if (normalizedPostingId.includes(needle)) return 4;
  if (company.includes(needle)) return 3;
  if (role.includes(needle) || title.includes(needle)) return 2;
  return null;
}
