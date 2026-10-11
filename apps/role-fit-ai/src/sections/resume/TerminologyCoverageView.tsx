import type { JobTerm, TerminologyCoverage } from "../../resume/terminology";

const GROUPS = [
  { key: "onResume", label: "On your resume" },
  { key: "relatedOnly", label: "Only a related term" },
  { key: "notOnResume", label: "Not on your resume" }
] as const;

const names = (terms: JobTerm[]) => terms.map((term) => term.keyword).join(", ");

// Which recognized posting terms the current resume uses, folded away. Advisory
// only: it scores nothing and is separate from Fit.
export function TerminologyCoverageView({ coverage }: { coverage: TerminologyCoverage }) {
  const groups = GROUPS.filter(({ key }) => coverage[key].length);
  if (!groups.length) return null;
  return (
    <details className="resume-proposal__terms">
      <summary>Posting terms and your resume</summary>
      <dl>
        {groups.map(({ key, label }) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{names(coverage[key])}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
