import type { FitAssessmentResult } from "../../shared/fitAssessmentContract.ts";
import type { Application } from "../hooks/useApplications";
import { isSubmittedApplication } from "./applicationAnalytics.ts";
import { displayCompany, displayRole, formatCompactDate } from "./applicationDisplay.ts";
import { extractJobConstraints, type JobConstraintKind } from "./jobConstraints.ts";
import {
  NOT_APPLYING_REASONS,
  normalizeNotApplyingReasons,
  type NotApplyingReason
} from "./notApplying.ts";

export type SkipReasonSuggestion = {
  reason: NotApplyingReason;
  basis: string;
};

export type SkipReasonPrompt = {
  initialReasons: NotApplyingReason[];
  initialNote: string;
  suggestions: SkipReasonSuggestion[];
};

type AssessedFitResult = Extract<FitAssessmentResult, { status: "ASSESSED" }>;

// Classify only the posting text Fit cited, never the model's note. Terms are
// whole words, a medical/site/drug/background clearance does not count, and
// OPT/CPT need student-visa context, so a CPT billing code or an "opt-out"
// cannot read as a work-authorization condition.
const CLEARANCE_TERMS = /\b(?:security clearance|(?<!\b(?:medical|site|drug|background|customs|credit)\s)clearance|TS\/SCI|top secret|polygraph|U\.?S\.? citizen(?:ship|s)?|citizenship|U\.?S\.? persons?|ITAR|export[\s-]controls?)\b/i;
const WORK_AUTHORIZATION_TERMS = /\b(?:sponsor(?:ship|ing)?|H-?1B|work authori[sz]ation|authori[sz]ed to work|eligible to work|employment authori[sz]ation|STEM OPT|OPT\/CPT|CPT\/OPT|F-1 (?:visa|students?|status))\b/i;

const CONSTRAINT_REASON: Partial<Record<JobConstraintKind, NotApplyingReason>> = {
  onsite: "location",
  relocation: "location",
  travel: "schedule",
  shift: "schedule",
  oncall: "schedule",
  weekends: "schedule",
  overtime: "schedule"
};

export function classifyEligibilityExcerpt(excerpt: string): NotApplyingReason[] {
  const reasons: NotApplyingReason[] = [];
  if (WORK_AUTHORIZATION_TERMS.test(excerpt)) reasons.push("work_authorization");
  if (CLEARANCE_TERMS.test(excerpt)) reasons.push("clearance");
  return reasons;
}

function quote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 139).trimEnd()}…` : flat;
}

// Local evidence for the Skip dialog. A prior decision on the same posting is
// the only thing pre-checked when it exists; otherwise strong evidence is
// pre-checked and weak evidence is only marked. Nothing here calls a provider.
export function suggestSkipReasons({
  priorDecision,
  linkedApplication,
  fitResult,
  jobText
}: {
  priorDecision: Pick<Application, "notApplyingReasons" | "notApplyingNote"> | null;
  linkedApplication: Application | null;
  fitResult: AssessedFitResult | null;
  jobText: string;
}): SkipReasonPrompt {
  const strong: SkipReasonSuggestion[] = [];
  const weak: SkipReasonSuggestion[] = [];

  if (linkedApplication && isSubmittedApplication(linkedApplication)) {
    strong.push({
      reason: "already_applied",
      basis: `Linked to your application for ${displayRole(linkedApplication)} at ${displayCompany(linkedApplication)}, applied ${formatCompactDate(linkedApplication.appliedAt ?? "")}`
    });
  }
  const eligibility = fitResult?.eligibility;
  if (eligibility?.jobExcerpt && (eligibility.status === "BLOCKED" || eligibility.status === "CHECK")) {
    const blocked = eligibility.status === "BLOCKED";
    const basis = `Fit eligibility ${blocked ? "blocked" : "to check"}: "${quote(eligibility.jobExcerpt)}"`;
    for (const reason of classifyEligibilityExcerpt(eligibility.jobExcerpt)) {
      (blocked ? strong : weak).push({ reason, basis });
    }
  }
  for (const constraint of extractJobConstraints(jobText)) {
    const reason = CONSTRAINT_REASON[constraint.kind];
    if (reason) weak.push({ reason, basis: `Posting mentions "${quote(constraint.detail)}"` });
  }
  if (fitResult?.verdict === "LIMITED") weak.push({ reason: "fit", basis: "Fit verdict: Limited" });

  const priorReasons = priorDecision ? normalizeNotApplyingReasons(priorDecision.notApplyingReasons) : [];
  const prior = priorReasons.map((reason) => ({ reason, basis: "Your earlier skip of this posting" }));
  const basisByReason = new Map<NotApplyingReason, string>();
  for (const suggestion of [...prior, ...strong, ...weak]) {
    if (!basisByReason.has(suggestion.reason)) basisByReason.set(suggestion.reason, suggestion.basis);
  }

  return {
    initialReasons: priorDecision ? priorReasons : normalizeNotApplyingReasons(strong.map(({ reason }) => reason)),
    initialNote: priorDecision?.notApplyingNote ?? "",
    suggestions: NOT_APPLYING_REASONS
      .filter((reason) => basisByReason.has(reason))
      .map((reason) => ({ reason, basis: basisByReason.get(reason) as string }))
  };
}
