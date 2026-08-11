type ApplicationFitTone = "strong" | "good" | "stretch" | "weak" | "neutral";

type ApplicationFitSummaryProps = {
  label: string;
  tone: ApplicationFitTone;
  summary: string;
};

export function ApplicationFitSummary({ label, tone, summary }: ApplicationFitSummaryProps) {
  return (
    <div
      className={`application-fit-summary application-fit-summary--${tone}`}
      role="group"
      aria-label="Fit assessment verdict and rationale"
    >
      <div className="application-fit-summary__verdict">
        <span>Verdict</span>
        <strong className={`application-fit application-fit--${tone}`}>{label}</strong>
      </div>
      <p className="application-fit-summary__copy">{summary}</p>
    </div>
  );
}
