import type { Application, ApplicationStatus } from "../hooks/useApplications";

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  interested: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn"
};

export const BOARD_STATUSES: ApplicationStatus[] = [
  "interested",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn"
];

export function displayCompany(app: Application) {
  return app.company?.trim() || app.title.split(/[|·-]/)[0]?.trim() || "Unknown company";
}

export function displayRole(app: Application) {
  return app.role?.trim() || "Role not set";
}

export function displayTitle(app: Application) {
  const company = displayCompany(app);
  const role = displayRole(app);
  return role === "Role not set" ? company : `${company} - ${role}`;
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

export function fitScore(app: Application) {
  return typeof app.fitScore === "number"
    ? app.fitScore
    : typeof app.tailoredFitScore === "number"
    ? app.tailoredFitScore
    : null;
}

export function fitLabel(score: number | null) {
  if (score === null) return "Not scored";
  if (score >= 85) return "Strong match";
  if (score >= 75) return "Good match";
  if (score >= 60) return "Stretch";
  return "Weak match";
}

export function fitTone(score: number | null) {
  if (score === null) return "neutral";
  if (score >= 85) return "strong";
  if (score >= 75) return "good";
  if (score >= 60) return "stretch";
  return "weak";
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
  // An explicit choice in the detail modal wins over the derived guess.
  if (app.priority) return app.priority;
  const score = fitScore(app);
  if (score !== null && score >= 85) return "High";
  if (app.status === "interviewing" || app.status === "offer") return "High";
  if (score !== null && score < 65) return "Low";
  return "Medium";
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
  const currency = (salaryCurrency || "").trim();
  const symbol = currency === "USD" ? "$" : "";
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
  try {
    // Bare YYYY-MM-DD (e.g. the inspector's date input) parses as UTC midnight
    // and renders the previous day in UTC-negative zones; anchor it to local time.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    const date = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(iso);
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function averageFit(applications: Application[]) {
  const scores = applications.map(fitScore).filter((score): score is number => typeof score === "number");
  if (!scores.length) return null;
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

export function statusCount(applications: Application[], status: ApplicationStatus) {
  return applications.filter((app) => app.status === status).length;
}

// Average fit-score lift from tailoring (tailoredFitScore - baseFitScore), across
// applications where both scores are recorded. Returns null when no data.
export function averageLift(applications: Application[]): number | null {
  const withLift = applications.filter(
    (app) => typeof app.baseFitScore === "number" && typeof app.tailoredFitScore === "number"
  );
  if (!withLift.length) return null;
  const total = withLift.reduce(
    (sum, app) => sum + Number(app.tailoredFitScore) - Number(app.baseFitScore),
    0
  );
  return Math.round(total / withLift.length);
}

// -------- Docket (Up next) --------

export type DocketItem = {
  app: Application;
  kind: "overdue" | "due" | "quiet";
  label: string;
  // Human-readable date tag for the left column: "Jun 09" for explicit dates,
  // "{n}d" for quiet items (days since last touch).
  dateTag: string;
};

const INACTIVE_STATUSES: ApplicationStatus[] = ["rejected", "withdrawn"];

function isInactive(app: Application) {
  return INACTIVE_STATUSES.includes(app.status);
}

// Formats an ISO date string as "Jun 09" in local time, date-only.
function shortDate(iso: string) {
  if (!iso) return "";
  try {
    // Parse as local date (YYYY-MM-DD) to avoid UTC-offset shift.
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

// Returns YYYY-MM-DD for a Date in local time.
function localDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function buildDocket(applications: Application[], now: Date): DocketItem[] {
  const todayStr = localDateString(now);
  const plusSevenStr = localDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));

  const overdueItems: DocketItem[] = [];
  const dueItems: DocketItem[] = [];
  const quietItems: DocketItem[] = [];
  const seen = new Set<string>();

  for (const app of applications) {
    if (isInactive(app)) continue;
    const followup = app.followupAt?.slice(0, 10);
    if (followup && followup < todayStr) {
      // Overdue
      overdueItems.push({
        app,
        kind: "overdue",
        label: "Follow-up overdue",
        dateTag: shortDate(followup)
      });
      seen.add(app.id);
    } else if (followup && followup >= todayStr && followup <= plusSevenStr) {
      // Due within 7 days
      let label = "Follow-up";
      if (app.status === "interviewing") label = "Interview prep";
      else if (app.status === "offer") label = "Offer review";
      dueItems.push({ app, kind: "due", label, dateTag: shortDate(followup) });
      seen.add(app.id);
    }
  }

  // Quiet: applied, no followupAt, no response in >= 14 days
  for (const app of applications) {
    if (seen.has(app.id)) continue;
    if (app.status !== "applied") continue;
    if (app.followupAt) continue;
    const lastTouch = app.appliedAt || app.updatedAt;
    if (!lastTouch) continue;
    const lastDate = parseDate(lastTouch);
    if (!lastDate) continue;
    const days = Math.floor((now.getTime() - lastDate.getTime()) / 86_400_000);
    if (days >= 14) {
      quietItems.push({
        app,
        kind: "quiet",
        label: `No response in ${days}d`,
        dateTag: `${days}d`
      });
    }
  }

  // Sort overdue oldest first, due soonest first, quiet longest first
  overdueItems.sort((a, b) => (a.app.followupAt ?? "").localeCompare(b.app.followupAt ?? ""));
  dueItems.sort((a, b) => (a.app.followupAt ?? "").localeCompare(b.app.followupAt ?? ""));
  quietItems.sort((a, b) => {
    const aTouch = a.app.appliedAt || a.app.updatedAt || "";
    const bTouch = b.app.appliedAt || b.app.updatedAt || "";
    return aTouch.localeCompare(bTouch); // oldest first = longest wait first
  });

  return [...overdueItems, ...dueItems, ...quietItems].slice(0, 4);
}
