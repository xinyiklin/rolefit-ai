import { ArrowRight, FileText, ListChecks } from "lucide-react";
import { ChipList, PanelHeading, ScoreMeter, Stat } from "../../ui";
import type { MatchBreakdown, PolishedResume, ResumeDiff } from "../../resumeEngine";
import { scoreLabel, type FitComparison, type ScoreSource } from "../shared";

type ReviewTabProps = {
  scoreSource: ScoreSource;
  scoreContext: string;
  headlineScore: number | null;
  fitComparison: FitComparison | null;
  resumeBulletCount: number;
  matchBreakdown: MatchBreakdown[];
  resumeDiff: ResumeDiff | null;
  result: PolishedResume | null;
};

function evidenceLabel(evidenceType: string) {
  return (
    {
      exact: "Exact evidence",
      adjacent: "Adjacent evidence",
      none: "No evidence"
    }[evidenceType] ?? "Evidence"
  );
}

export function ReviewTab({
  scoreSource,
  scoreContext,
  headlineScore,
  fitComparison,
  resumeBulletCount,
  matchBreakdown,
  resumeDiff,
  result
}: ReviewTabProps) {
  const lift = fitComparison ? fitComparison.tailored - fitComparison.base : 0;
  const missingRequiredSkills = result?.missingRequiredSkills ?? [];
  return (
    <div className="review-stack">
      <section className="studio-card score-panel">
        <div className="score-panel__hero">
          <p className="eyebrow">Fit Score</p>
          <strong className="overall-score">{headlineScore ?? "--"}</strong>
          <span className="score-panel__label">
            {headlineScore !== null ? scoreLabel(headlineScore) : "Awaiting draft"}
          </span>
          <small>{scoreContext}</small>
        </div>
        <div className="score-grid-col">
          <p className="score-grid__caption">
            Signal breakdown · local engine{fitComparison?.source === "ai" ? " (headline above is AI-judged)" : ""}
          </p>
          <div className="score-grid">
            <ScoreMeter label="Keywords" value={scoreSource?.score.keywordFit ?? 0} />
            <ScoreMeter label="Bullets" value={scoreSource?.score.bulletQuality ?? 0} />
            <ScoreMeter label="Seniority" value={scoreSource?.score.seniority ?? 0} />
            <ScoreMeter label="Structure" value={scoreSource?.score.structure ?? 0} />
            <ScoreMeter label="Concision" value={scoreSource?.score.concision ?? 0} />
          </div>
        </div>
        <div className="score-panel__stats">
          <Stat label="Resume bullets" value={resumeBulletCount} />
          <Stat label="Matched" value={scoreSource?.matchedKeywords.length ?? 0} />
          <Stat label="Missing" value={scoreSource?.missingKeywords.length ?? 0} />
        </div>
      </section>

      {fitComparison ? (
        <section className="studio-card fit-compare">
          <PanelHeading
            icon={<ArrowRight size={15} aria-hidden="true" />}
            title="Base vs. tailored"
            description={fitComparison.source === "ai" ? "AI-judged on one scale" : "Local engine estimate"}
          />
          <div className="fit-compare__scores">
            <div className="fit-compare__col">
              <span className="fit-compare__cap">Base resume</span>
              <strong className="fit-compare__num">{fitComparison.base}</strong>
              <span className="fit-compare__lab">{scoreLabel(fitComparison.base)}</span>
            </div>
            <ArrowRight className="fit-compare__arrow" size={20} aria-hidden="true" />
            <div className="fit-compare__col">
              <span className="fit-compare__cap">Tailored</span>
              <strong className="fit-compare__num">{fitComparison.tailored}</strong>
              <span className="fit-compare__lab">{scoreLabel(fitComparison.tailored)}</span>
            </div>
            <div className={`fit-compare__delta ${lift > 0 ? "is-up" : lift < 0 ? "is-down" : "is-flat"}`}>
              {lift > 0 ? `+${lift}` : lift}
              <span>lift</span>
            </div>
          </div>
          {fitComparison.reason ? <p className="fit-compare__reason">{fitComparison.reason}</p> : null}
        </section>
      ) : null}

      <section className="studio-card">
        <PanelHeading icon={<ListChecks size={15} aria-hidden="true" />} title="Match breakdown" />
        <div className="breakdown-grid">
          {matchBreakdown.length ? (
            matchBreakdown.map((group) => (
              <div className="breakdown-card" key={group.category}>
                <div className="breakdown-card__title">
                  <h3>{group.category}</h3>
                  <strong>
                    {group.covered.length}/{group.covered.length + group.missing.length}
                  </strong>
                </div>
                <div className="mini-chip-list">
                  {group.covered.map((item) => (
                    <span className="mini-chip mini-chip--covered" key={`${group.category}-${item}`}>
                      {item}
                    </span>
                  ))}
                  {group.missing.map((item) => (
                    <span className="mini-chip mini-chip--missing" key={`${group.category}-${item}`}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="muted-line">Add a job description to break the match into experience, knowledge, skills, and tools.</p>
          )}
        </div>
      </section>

      {missingRequiredSkills.length ? (
        <section className="studio-card">
          <PanelHeading icon={<ListChecks size={15} aria-hidden="true" />} title="Still missing" />
          <div className="gap-list">
            {missingRequiredSkills.map((item, index) => (
              <article className="gap-card" key={`${item.keyword}-${index}`}>
                <header className="gap-card__head">
                  <strong>{item.keyword}</strong>
                  <span className={`mini-chip mini-chip--${item.canHonestlyAdd ? "covered" : "missing"}`}>
                    {item.canHonestlyAdd ? "Exact evidence" : "Leave as gap"}
                  </span>
                </header>
                <p className="gap-card__line">
                  <em>{evidenceLabel(item.evidenceType)}</em>
                  {item.reason ? ` - ${item.reason}` : ""}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {resumeDiff ? (
        <section className="studio-card">
          <PanelHeading icon={<FileText size={15} aria-hidden="true" />} title="Before / after" />
          <p className="diff-legend">
            <span className="diff-seg diff-seg--added">added</span>
            <span className="diff-seg diff-seg--removed">removed</span>
            <span>Read every change before exporting — added claims are yours to defend.</span>
          </p>
          <div className="diff-inline" role="region" aria-label="Full resume diff, original versus tailored">
            {resumeDiff.segments.length ? (
              resumeDiff.segments.map((seg, index) =>
                seg.type === "equal" ? (
                  <span key={index}>{seg.text}</span>
                ) : (
                  <span
                    key={index}
                    className={`diff-seg diff-seg--${seg.type}`}
                    title={seg.type === "added" ? "Added by tailoring" : "Removed by tailoring"}
                  >
                    {seg.text}
                  </span>
                )
              )
            ) : (
              <span className="diff-empty">No changes between the original and tailored resume.</span>
            )}
          </div>
          {resumeDiff.metricPrompts.length ? (
            <div className="metric-prompts">
              <h3>Metric prompts to resolve</h3>
              <ul>
                {resumeDiff.metricPrompts.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="studio-card insights">
        <div>
          <h3>Interview signals</h3>
          <ul>
            {(result?.strengths ?? [
              "Projects, practical tools, measurable proof, and concise bullets carry entry-level SDE applications."
            ]).map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Next fixes</h3>
          <ul>
            {(result?.fixes ?? [
              "Paste a job description to see missing keywords, then add truthful project evidence."
            ]).map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="studio-card">
        <PanelHeading icon={<ListChecks size={15} aria-hidden="true" />} title="Keywords" />
        <div className="keyword-grid">
          <div>
            <h3>Matched</h3>
            <ChipList
              items={scoreSource?.matchedKeywords.slice(0, 14) ?? []}
              emptyText="Add a resume and job target to see matches."
            />
          </div>
          <div>
            <h3>Missing</h3>
            <ChipList
              items={scoreSource?.missingKeywords.slice(0, 14) ?? []}
              emptyText="No obvious gaps yet."
            />
          </div>
        </div>
      </section>
    </div>
  );
}
