import type { Application, ApplicationStatus } from "../hooks/useApplications";
import type { StrictReviewVerdict } from "../resume/types";
import { VERDICT_LABEL, VERDICT_TONE, verdictFromScore } from "./fitVerdict";

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

// Score -> tone (fit-color class only). Thresholds MIRROR verdictForScore in
// server/ai/sanitize.mjs (STRONG FIT >=85, REASONABLE FIT >=70, STRETCH >=46,
// DON'T APPLY <46) and verdictFromScore in lib/fitVerdict.ts — keep in sync. The
// fit LABEL now always comes from the shared verdict vocabulary (appFitVerdict /
// fitVerdict.ts) so the tracker, review pane, and resume header never disagree.
// The old fitLabel "Strong/Good/Stretch/Weak match" vocabulary was removed — it
// was the source of the tracker-vs-review mismatch.
export function fitTone(score: number | null) {
  if (score === null) return "neutral";
  if (score >= 85) return "strong";
  if (score >= 70) return "good";
  if (score >= 46) return "stretch";
  return "weak";
}

// The application's fit as a VERDICT band, in the SAME vocabulary the review
// pane and resume header use — so the tracker can never show "Good match" while
// strict review says "Reasonable fit". Prefer the verdict captured at apply time
// (the real, gap-capped strict-review verdict); otherwise derive it from the
// stored score. Label AND tone come from the same verdict so they agree.
export function appFitVerdict(
  app: Application
): { verdict: StrictReviewVerdict; label: string; tone: "strong" | "good" | "stretch" | "weak" } | null {
  const stored = app.review?.verdict as StrictReviewVerdict | undefined;
  const verdict = stored && VERDICT_LABEL[stored] ? stored : verdictFromScore(fitScore(app));
  if (!verdict) return null;
  return { verdict, label: VERDICT_LABEL[verdict], tone: VERDICT_TONE[verdict] };
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
  // Below the STRETCH floor (46, the DON'T APPLY boundary) — not just below 65 —
  // so a 46-64 "Stretch" reads Medium priority, consistent with its label.
  if (score !== null && score < 46) return "Low";
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
  const currency = (salaryCurrency || "").trim().toUpperCase();
  // The distiller can now emit non-USD currencies, so render their native symbol
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
