
export function ContentWarnings({ warnings }: { warnings?: readonly string[] }) {
  if (!warnings?.length) return null;
  return <div className="content-warnings" role="note" aria-label="Review concerns">
    <strong>Review before use</strong>
    <ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
  </div>;
}
