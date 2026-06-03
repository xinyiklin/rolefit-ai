import { AlertCircle, FileText, ListChecks, Mail } from "lucide-react";
import { PanelHeading } from "../../ui";
import type { PolishedResume } from "../../resumeEngine";

type StrictReviewTabProps = {
  result: PolishedResume | null;
};

export function StrictReviewTab({ result }: StrictReviewTabProps) {
  if (!result?.strictReview) {
    return (
      <section className="studio-card">
        <PanelHeading icon={<ListChecks size={15} aria-hidden="true" />} title="Strict review" />
        <p className="muted-line">
          Enable <strong>Strict review</strong> in Polish, then polish. The recruiter audit lands here.
        </p>
      </section>
    );
  }

  const sr = result.strictReview;

  return (
    <div className="review-stack">
      <section className="studio-card strict-verdict">
        <div className="strict-verdict__hero">
          <strong
            className={`verdict-pill verdict-pill--${sr.verdict.replace(/['\s]+/g, "-").toLowerCase()}`}
          >
            {sr.verdict}
          </strong>
          <p className="strict-verdict__reason">{sr.verdictReason}</p>
        </div>
        <div className="strict-verdict__rec">
          <div
            className={`rec-pill ${sr.recommendation.applyAsIs ? "rec-pill--apply" : "rec-pill--skip"}`}
            title={
              sr.recommendation.applyAsIs
                ? "This tailored draft is ready to send — no further edits needed"
                : "Make the top edits below before applying"
            }
          >
            {sr.recommendation.applyAsIs ? "Apply as-is" : "Edit first"}
          </div>
          <p className="muted-line">{sr.recommendation.reason}</p>
          {sr.recommendation.topEdits.length ? (
            <>
              <h3>Top edits</h3>
              <ol className="ordered-list">
                {sr.recommendation.topEdits.map((edit, idx) => (
                  <li key={idx}>{edit}</li>
                ))}
              </ol>
            </>
          ) : null}
        </div>
      </section>

      {sr.coverage.length ? (
        <section className="studio-card">
          <PanelHeading icon={<ListChecks size={15} aria-hidden="true" />} title="Coverage" />
          <div className="coverage-grid">
            {sr.coverage.map((row, idx) => (
              <div className={`coverage-row coverage-row--${row.status}`} key={`${row.category}-${row.keyword}-${idx}`}>
                <span className="coverage-row__cat">{row.category}</span>
                <span className="coverage-row__key">
                  <em className={`coverage-mark coverage-mark--${row.status}`}>
                    {row.status === "covered" ? "✓" : row.status === "missing" ? "✗" : "⚠"}
                  </em>
                  {row.keyword}
                </span>
                <span className="coverage-row__where">{row.where}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {sr.gaps.length ? (
        <section className="studio-card">
          <PanelHeading icon={<AlertCircle size={15} aria-hidden="true" />} title="Gaps" />
          <div className="gap-list">
            {sr.gaps.map((gap, idx) => (
              <article className={`gap-card gap-card--${gap.severity.toLowerCase()}`} key={idx}>
                <header className="gap-card__head">
                  <strong>{gap.gap}</strong>
                  <span className={`severity-tag severity-tag--${gap.severity.toLowerCase()}`}>{gap.severity}</span>
                </header>
                <p className="gap-card__line">
                  <em>{gap.canHonestlyAdd ? "✓ Can honestly add" : "✗ Cannot add"}</em>
                  {" — "}
                  {gap.evidence}
                </p>
                <p className="gap-card__edit">
                  <strong>Suggested edit:</strong> {gap.suggestedEdit}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {sr.rewrites.length ? (
        <section className="studio-card">
          <PanelHeading icon={<FileText size={15} aria-hidden="true" />} title="Bullet rewrites" />
          <div className="rewrite-list">
            {sr.rewrites.map((rewrite, idx) => (
              <article className="rewrite-card" key={idx}>
                <div className="rewrite-card__before">
                  <p className="eyebrow">Before</p>
                  <p>{rewrite.original}</p>
                </div>
                <div className="rewrite-card__after">
                  <p className="eyebrow">After</p>
                  <p>{rewrite.rewrite}</p>
                  {rewrite.hits.length ? (
                    <div className="mini-chip-list">
                      {rewrite.hits.map((hit) => (
                        <span className="mini-chip mini-chip--covered" key={hit}>
                          ✓ {hit}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {sr.riskFlags.length ? (
        <section className="studio-card">
          <PanelHeading icon={<AlertCircle size={15} aria-hidden="true" />} title="Interview risks" />
          <div className="risk-list">
            {sr.riskFlags.map((flag, idx) => (
              <article className="risk-card" key={idx}>
                <p className="risk-card__bullet">{flag.bullet}</p>
                <p className="risk-card__risk">{flag.risk}</p>
                <p className="risk-card__suggestion">{flag.suggestion}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {sr.recommendation.coverLetterAngle ? (
        <section className="studio-card">
          <PanelHeading icon={<Mail size={15} aria-hidden="true" />} title="Cover letter angle" />
          <p className="cover-angle">{sr.recommendation.coverLetterAngle}</p>
        </section>
      ) : null}
    </div>
  );
}
