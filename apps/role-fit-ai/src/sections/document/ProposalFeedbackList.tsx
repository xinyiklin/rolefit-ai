type ProposalFeedbackListProps = {
  title: string;
  items: string[];
  tone?: "default" | "warning";
};

// Shared presentation only: each workflow keeps ownership of generation,
// validation, and acceptance while feedback reads consistently across documents.
export function ProposalFeedbackList({
  title,
  items,
  tone = "default"
}: ProposalFeedbackListProps) {
  if (!items.length) return null;
  return (
    <section className={`proposal-feedback proposal-feedback--${tone}`}>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
}
