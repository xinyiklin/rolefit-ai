import type { PolishedResume } from "../../resumeEngine";

type ResumeTabProps = {
  result: PolishedResume | null;
  resultSourceLabel: string;
  scoreContext: string;
};

export function ResumeTab({ result, resultSourceLabel, scoreContext }: ResumeTabProps) {
  return (
    <section className="studio-card">
      <div className="studio-card__head">
        <h2>Tailored resume{resultSourceLabel ? ` · ${resultSourceLabel}` : ""}</h2>
        {scoreContext ? <span className="studio-card__meta">{scoreContext}</span> : null}
      </div>
      <textarea
        className="resume-output"
        readOnly
        aria-label="Copy-ready polished resume"
        value={result?.polishedText || "Your tailored resume will appear here after you add a job target and resume draft."}
      />
    </section>
  );
}
