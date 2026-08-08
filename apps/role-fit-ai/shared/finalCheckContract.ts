export const FINAL_CHECK_STATUSES = ["READY", "REVIEW", "NEEDS_EVIDENCE"] as const;
export const FINAL_CHECK_ISSUE_KINDS = ["UNSUPPORTED", "MISSING", "CLARITY"] as const;

export type FinalCheckStatus = (typeof FINAL_CHECK_STATUSES)[number];
export type FinalCheckIssueKind = (typeof FINAL_CHECK_ISSUE_KINDS)[number];

export type FinalCheckIssue = {
  kind: FinalCheckIssueKind;
  detail: string;
  action: string;
};

export type FinalCheckResult = {
  status: FinalCheckStatus;
  summary: string;
  issues: FinalCheckIssue[];
};

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function sanitizeFinalCheckWireResult(raw: unknown): FinalCheckResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const status = text(source.status, 24).toUpperCase();
  if (!(FINAL_CHECK_STATUSES as readonly string[]).includes(status)) return null;
  const summary = text(source.summary, 360);
  if (!summary || !Array.isArray(source.issues)) return null;

  const issues: FinalCheckIssue[] = [];
  for (const rawIssue of source.issues) {
    if (!rawIssue || typeof rawIssue !== "object" || Array.isArray(rawIssue)) return null;
    const issue = rawIssue as Record<string, unknown>;
    const kind = text(issue.kind, 24).toUpperCase();
    const detail = text(issue.detail, 500);
    const action = text(issue.action, 360);
    if (
      !(FINAL_CHECK_ISSUE_KINDS as readonly string[]).includes(kind)
      || !detail
      || !action
    ) return null;
    issues.push({ kind: kind as FinalCheckIssueKind, detail, action });
    if (issues.length === 5) break;
  }

  const derivedStatus: FinalCheckStatus = issues.some((issue) => issue.kind === "UNSUPPORTED")
    ? "NEEDS_EVIDENCE"
    : issues.length
      ? "REVIEW"
      : "READY";
  if (status !== derivedStatus) return null;
  return { status: derivedStatus, summary, issues };
}
