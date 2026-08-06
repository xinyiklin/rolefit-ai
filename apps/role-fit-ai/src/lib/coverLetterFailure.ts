export type CoverLetterIssueCode =
  | "unsupported_job_term"
  | "unsupported_number"
  | "unsupported_outcome"
  | "unknown_evidence_reference"
  | "missing_evidence_reference"
  | "unresolved_template"
  | "invalid_structure"
  | "quality_contract";

export type CoverLetterIssueCategory =
  | "evidence"
  | "template"
  | "structure"
  | "quality";

export type CoverLetterIssueRecovery = "add_evidence" | "edit_source" | "retry";

export type CoverLetterIssue = {
  code: CoverLetterIssueCode;
  category: CoverLetterIssueCategory;
  claim?: string;
  unsupportedValue?: string;
  detail: string;
  recovery: CoverLetterIssueRecovery;
};

export type CoverLetterBlockedFailure = {
  kind: "blocked";
  issues: CoverLetterIssue[];
  repairAttempted: boolean;
};

const ISSUE_SHAPES: Record<
  CoverLetterIssueCode,
  { category: CoverLetterIssueCategory; recovery: CoverLetterIssueRecovery }
> = {
  unsupported_job_term: { category: "evidence", recovery: "add_evidence" },
  unsupported_number: { category: "evidence", recovery: "add_evidence" },
  unsupported_outcome: { category: "evidence", recovery: "add_evidence" },
  unknown_evidence_reference: { category: "evidence", recovery: "retry" },
  missing_evidence_reference: { category: "evidence", recovery: "retry" },
  unresolved_template: { category: "template", recovery: "edit_source" },
  invalid_structure: { category: "structure", recovery: "retry" },
  quality_contract: { category: "quality", recovery: "retry" }
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function displayText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength)
    : "";
}

function parseIssue(value: unknown): CoverLetterIssue | null {
  const candidate = object(value);
  if (!candidate) return null;
  const code = candidate.code as CoverLetterIssueCode;
  const category = candidate.category as CoverLetterIssueCategory;
  const recovery = candidate.recovery as CoverLetterIssueRecovery;
  const detail = displayText(candidate.detail, 300);
  const expectedShape = ISSUE_SHAPES[code];
  if (
    !expectedShape ||
    expectedShape.category !== category ||
    expectedShape.recovery !== recovery ||
    !detail
  ) {
    return null;
  }
  const claim = displayText(candidate.claim, 280);
  const unsupportedValue = displayText(candidate.unsupportedValue, 120);
  return {
    code,
    category,
    detail,
    recovery,
    ...(claim ? { claim } : {}),
    ...(unsupportedValue ? { unsupportedValue } : {})
  };
}

// Loopback remains a network boundary. Validate every issue and its fixed
// code/category/recovery relationship before rendering it in browser chrome.
export function parseCoverLetterBlockedFailure(value: unknown): CoverLetterBlockedFailure | null {
  const candidate = object(value);
  if (
    candidate?.status !== "blocked" ||
    candidate.reason !== "evidence_checks" ||
    !Array.isArray(candidate.issues)
  ) return null;
  const issues = candidate.issues
    .slice(0, 8)
    .map(parseIssue)
    .filter((issue) => issue !== null);
  if (issues.length === 0) return null;
  return {
    kind: "blocked",
    issues,
    repairAttempted: candidate.repairAttempted === true
  };
}
