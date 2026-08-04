export type CoverLetterBlockerCode =
  | "unsupported-claim"
  | "unsupported-number"
  | "unsupported-outcome"
  | "missing-evidence-reference"
  | "unresolved-template"
  | "invalid-structure"
  | "generic-language"
  | "length";

export type CoverLetterBlockerRecovery = "retry" | "add-evidence" | "edit-template";

export type CoverLetterBlocker = {
  code: CoverLetterBlockerCode;
  summary: string;
  detail: string;
  excerpt?: string;
  recovery: CoverLetterBlockerRecovery;
};

export type CoverLetterFailureResponse = {
  status: "blocked";
  error: string;
  blockers: CoverLetterBlocker[];
};

const BLOCKER_CODES = new Set<CoverLetterBlockerCode>([
  "unsupported-claim",
  "unsupported-number",
  "unsupported-outcome",
  "missing-evidence-reference",
  "unresolved-template",
  "invalid-structure",
  "generic-language",
  "length"
]);
const RECOVERIES = new Set<CoverLetterBlockerRecovery>([
  "retry",
  "add-evidence",
  "edit-template"
]);

function safeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function quotedExcerpt(value: string): string | undefined {
  const match = value.match(/["“]([^"”]{1,160})["”]/);
  const excerpt = safeText(match?.[1], 160);
  return excerpt || undefined;
}

function blockerShape(violation: string): Omit<CoverLetterBlocker, "detail" | "excerpt"> {
  if (/claims? an? outcome/i.test(violation)) {
    return {
      code: "unsupported-outcome",
      summary: "Outcome was not supported",
      recovery: "add-evidence"
    };
  }
  if (/number, scale, or duration/i.test(violation)) {
    return {
      code: "unsupported-number",
      summary: "Number was not supported",
      recovery: "add-evidence"
    };
  }
  if (/claims? ["“]|no supplied evidence supports/i.test(violation)) {
    return {
      code: "unsupported-claim",
      summary: "Candidate claim was not supported",
      recovery: "add-evidence"
    };
  }
  if (/evidence id|cite at least one evidence/i.test(violation)) {
    return {
      code: "missing-evidence-reference",
      summary: "Evidence reference was missing",
      recovery: "retry"
    };
  }
  if (/template token|bracketed/i.test(violation)) {
    return {
      code: "unresolved-template",
      summary: "Template detail was unresolved",
      recovery: "edit-template"
    };
  }
  if (/generic brochure|filler enthusiasm/i.test(violation)) {
    return {
      code: "generic-language",
      summary: "Draft language was too generic",
      recovery: "retry"
    };
  }
  if (/longer than one page|tighten it substantially/i.test(violation)) {
    return {
      code: "length",
      summary: "Draft was too long",
      recovery: "retry"
    };
  }
  return {
    code: "invalid-structure",
    summary: "Draft structure was invalid",
    recovery: "retry"
  };
}

function blockerDetail(
  shape: Omit<CoverLetterBlocker, "detail" | "excerpt">,
  excerpt?: string
): string {
  switch (shape.code) {
    case "unsupported-claim":
      return excerpt
        ? `“${excerpt}” was not found in your resume or personal context.`
        : "The proposal included a candidate claim that was not found in your evidence.";
    case "unsupported-number":
      return "The proposal included a number, scale, or duration that was not found in your evidence.";
    case "unsupported-outcome":
      return excerpt
        ? `“${excerpt}” describes an outcome that was not found in your evidence.`
        : "The proposal described an outcome that was not found in your evidence.";
    case "missing-evidence-reference":
      return "The AI response omitted a valid evidence reference RoleFit requires. Retry the request.";
    case "unresolved-template":
      return "The proposal left a template detail unresolved. Update the template and tailor again.";
    case "generic-language":
      return "The proposal relied on generic cover-letter language. Retry for a more specific draft.";
    case "length":
      return "The proposal exceeded the safe cover-letter length limit. Retry for a shorter draft.";
    default:
      return "The AI response did not follow RoleFit's required cover-letter structure. Retry the request.";
  }
}

// Validator findings are deterministic but may contain internal evidence ids.
// Map them to fixed user-facing details and expose only a bounded claim excerpt.
export function coverLetterBlockersFromViolations(
  violations: readonly string[]
): CoverLetterBlocker[] {
  return violations.slice(0, 8).map((rawViolation) => {
    const violation = safeText(rawViolation, 320) || "The proposal did not meet the cover-letter contract.";
    const shape = blockerShape(violation);
    const excerpt = quotedExcerpt(violation);
    return { ...shape, detail: blockerDetail(shape, excerpt), ...(excerpt ? { excerpt } : {}) };
  });
}

// Network responses are untrusted even on loopback. Keep only the closed
// blocker vocabulary and bounded strings before anything reaches UI chrome.
export function parseCoverLetterBlockers(value: unknown): CoverLetterBlocker[] {
  if (!Array.isArray(value)) return [];
  const blockers: CoverLetterBlocker[] = [];
  for (const raw of value.slice(0, 8)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const candidate = raw as Record<string, unknown>;
    const code = candidate.code as CoverLetterBlockerCode;
    const recovery = candidate.recovery as CoverLetterBlockerRecovery;
    const summary = safeText(candidate.summary, 120);
    const detail = safeText(candidate.detail, 320);
    const excerpt = safeText(candidate.excerpt, 160);
    if (!BLOCKER_CODES.has(code) || !RECOVERIES.has(recovery) || !summary || !detail) continue;
    blockers.push({ code, recovery, summary, detail, ...(excerpt ? { excerpt } : {}) });
  }
  return blockers;
}
