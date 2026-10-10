import type { FitGapDisplayStatus } from "../../../shared/polishFitFindings.ts";

export type FitGapStatementRow = {
  id: string;
  jobExcerpt: string;
  status: FitGapDisplayStatus;
  // Where an ADDRESSED gap is addressed: edit locations or paragraph labels.
  where: string[];
};

type FitGapStatementsProps = {
  rows: readonly FitGapStatementRow[];
  earlierVersion: boolean;
};

const STATUS_LABELS: Record<FitGapDisplayStatus, string> = {
  ADDRESSED: "Addressed",
  NO_EVIDENCE: "No evidence",
  NOT_REPORTED: "Not reported"
};

function detail(row: FitGapStatementRow): string {
  if (row.status === "ADDRESSED") return `in ${[...new Set(row.where)].join("; ")}`;
  if (row.status === "NO_EVIDENCE") return "your resume and Background don't support it";
  return "";
}

// Shared presentation for both proposal rails: what each document's run said
// about the Fit gaps it was sent. The owning workflow decides each status.
export function FitGapStatements({ rows, earlierVersion }: FitGapStatementsProps) {
  if (!rows.length) return null;
  return (
    <details className="proposal-fit-gaps">
      <summary>What this proposal did about Fit gaps</summary>
      {earlierVersion ? <p className="proposal-fit-gaps__note">From a Fit Assessment of an earlier version of your resume or Background.</p> : null}
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <blockquote>{row.jobExcerpt}</blockquote>
            <p className="proposal-fit-gaps__status">
              <strong>{STATUS_LABELS[row.status]}</strong>{detail(row) ? ` · ${detail(row)}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <p className="proposal-fit-gaps__note">These are the model's own statements, not a check of your evidence.</p>
    </details>
  );
}
