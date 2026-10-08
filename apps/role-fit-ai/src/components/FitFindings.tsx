import { useId, type ReactNode } from "react";
import { Check, CircleDashed, TriangleAlert } from "lucide-react";
import type { FitAssessmentEvidenceSource, FitAssessmentResult } from "../../shared/fitAssessmentContract.ts";
import type { FitWarnings } from "../lib/applicationDisplay.ts";
import { ContentWarnings } from "./ContentWarnings";

const EVIDENCE_SOURCE_LABEL: Record<FitAssessmentEvidenceSource, string> = {
  RESUME: "Resume",
  CANDIDATE_CONTEXT: "Profile"
};

// Every Fit surface renders the same findings so each finding's warning sits
// beside the finding it names.
export function FitFindings({ result, warnings }: { result: FitAssessmentResult; warnings: FitWarnings }) {
  const eligibility = result.eligibility && result.eligibility.status !== "CLEAR" ? result.eligibility : undefined;
  if (!result.matches.length && !result.gaps.length && !eligibility) return null;
  return (
    <div className="fit-findings">
      {result.matches.length ? (
        <FindingGroup label="Matches">
          {result.matches.map((match, index) => (
            <Finding key={index} kind="match" warnings={warnings.matches[index]}>
              <span>{match.jobExcerpt}</span>
              <small>{EVIDENCE_SOURCE_LABEL[match.candidateSource]}: {match.candidateExcerpt}</small>
            </Finding>
          ))}
        </FindingGroup>
      ) : null}
      {result.gaps.length ? (
        <FindingGroup label="Gaps">
          {result.gaps.map((gap, index) => {
            const detail = result.gapDetails?.find((item) => item.jobExcerpt === gap);
            return (
              <Finding key={index} kind="gap" warnings={warnings.gaps[index]}>
                <span>{gap}</span>
                {detail?.note ? <small>{detail.note}</small> : null}
                {detail?.candidateExcerpt ? (
                  <small>
                    {detail.relationship === "transferable" ? "Reported transferable evidence" : "Candidate reference"}:{" "}
                    {detail.candidateExcerpt}
                  </small>
                ) : null}
              </Finding>
            );
          })}
        </FindingGroup>
      ) : null}
      {eligibility ? (
        <FindingGroup label="Eligibility">
          <Finding kind="eligibility" warnings={warnings.eligibility}>
            <span>
              <strong>{eligibility.status === "BLOCKED" ? "Reported eligibility conflict." : "Confirm eligibility."}</strong>
              {eligibility.jobExcerpt ? ` ${eligibility.jobExcerpt}` : null}
            </span>
            {eligibility.note ? <small>{eligibility.note}</small> : null}
            {eligibility.candidateExcerpt ? <small>Profile: {eligibility.candidateExcerpt}</small> : null}
          </Finding>
        </FindingGroup>
      ) : null}
    </div>
  );
}

function FindingGroup({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <div className="fit-findings__group">
      <p className="fit-findings__label" id={labelId}>{label}</p>
      <ul aria-labelledby={labelId}>{children}</ul>
    </div>
  );
}

const FINDING_MARK = { match: Check, gap: CircleDashed, eligibility: TriangleAlert } as const;

function Finding({ kind, warnings, children }: {
  kind: keyof typeof FINDING_MARK;
  warnings: readonly string[];
  children: ReactNode;
}) {
  const Mark = FINDING_MARK[kind];
  return (
    <li className={`fit-finding fit-finding--${kind}`}>
      <Mark className="fit-finding__mark" size={13} strokeWidth={2.25} aria-hidden="true" />
      <div className="fit-finding__body">
        {children}
        <ContentWarnings warnings={warnings} />
      </div>
    </li>
  );
}
