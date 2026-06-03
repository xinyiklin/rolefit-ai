import { useMemo } from "react";
import type { PolishedResume } from "../../resumeEngine";
import { parseResumeDocument } from "../../lib/resumeDocument";
import { ResumeDocument } from "../ResumeDocument";

type ResumeTabProps = {
  result: PolishedResume | null;
  resultSourceLabel: string;
  scoreContext: string;
  sourceText: string;
};

export function ResumeTab({ result, resultSourceLabel, scoreContext, sourceText }: ResumeTabProps) {
  const model = useMemo(
    () => (result?.polishedText ? parseResumeDocument(result.polishedText, sourceText) : null),
    [result?.polishedText, sourceText]
  );

  return (
    <section className="studio-card studio-card--flush">
      <div className="studio-card__head">
        <h2>Tailored resume{resultSourceLabel ? ` · ${resultSourceLabel}` : ""}</h2>
        {scoreContext ? <span className="studio-card__meta">{scoreContext}</span> : null}
      </div>
      <div className="resume-doc__viewport">
        {model ? (
          <ResumeDocument model={model} />
        ) : (
          <p className="resume-doc__empty">
            Your tailored resume will appear here after you add a job target and resume draft.
          </p>
        )}
      </div>
    </section>
  );
}
