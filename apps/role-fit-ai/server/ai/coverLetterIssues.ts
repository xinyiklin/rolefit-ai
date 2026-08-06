import type {
  CoverLetterIssue,
  CoverLetterIssueCategory,
  CoverLetterIssueCode,
  CoverLetterIssueRecovery
} from "../../src/lib/coverLetterFailure.ts";
import { UserSafeAiError } from "./errors.ts";

export type CoverLetterValidationIssue = {
  code: CoverLetterIssueCode;
  category: CoverLetterIssueCategory;
  detail: string;
  recovery: CoverLetterIssueRecovery;
  repairMessage: string;
  claim?: string;
  unsupportedValue?: string;
  paragraphIndex?: number;
  sentenceIndex?: number;
};

const BLOCKED_MESSAGE =
  "The tailored draft did not pass RoleFit's evidence checks. Your current letter was kept.";

function displayText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function repairMessagesForCoverLetterIssues(
  issues: CoverLetterValidationIssue[]
): string[] {
  return [...new Set(issues.map((issue) => displayText(issue.repairMessage, 600)).filter(Boolean))];
}

export function publicCoverLetterIssues(
  issues: CoverLetterValidationIssue[]
): CoverLetterIssue[] {
  const safe: CoverLetterIssue[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const detail = displayText(issue.detail, 300);
    if (!detail) continue;
    const claim = displayText(issue.claim, 280);
    const unsupportedValue = displayText(issue.unsupportedValue, 120);
    const dedupeKey = [issue.code, issue.category, claim, unsupportedValue, detail].join("\u0000");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    safe.push({
      code: issue.code,
      category: issue.category,
      detail,
      recovery: issue.recovery,
      ...(claim ? { claim } : {}),
      ...(unsupportedValue ? { unsupportedValue } : {})
    });
    if (safe.length === 8) break;
  }
  if (safe.length > 0) return safe;
  return [{
    code: "invalid_structure",
    category: "structure",
    detail: "The provider response did not contain a cover letter RoleFit could safely inspect.",
    recovery: "retry"
  }];
}

export class CoverLetterBlockedError extends UserSafeAiError {
  readonly issues: CoverLetterIssue[];
  readonly repairAttempted: boolean;

  constructor(issues: CoverLetterValidationIssue[], repairAttempted: boolean) {
    super(BLOCKED_MESSAGE, 422);
    this.name = "CoverLetterBlockedError";
    this.issues = publicCoverLetterIssues(issues);
    this.repairAttempted = repairAttempted;
  }
}
