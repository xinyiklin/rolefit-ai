type CoverLetterReviewProps = {
  words: number;
  pageCount: number;
  hasGreeting: boolean;
  hasPlaceholder: boolean;
  status: string;
};

export function CoverLetterReview({
  words,
  pageCount,
  hasGreeting,
  hasPlaceholder,
  status
}: CoverLetterReviewProps) {
  return (
    <aside className="cover-letter-review" aria-label="Cover letter review checklist">
      <p className="cover-letter-review__eyebrow">Human review</p>
      <h2>Before you send</h2>
      <ul>
        <li className={words >= 200 && words <= 400 ? "is-ok" : ""}>
          {words || 0} words <span>aim for roughly 200–400</span>
        </li>
        <li className={pageCount === 1 ? "is-ok" : ""}>
          {pageCount || 0} {pageCount === 1 ? "page" : "pages"} <span>keep it to one page</span>
        </li>
        <li className={hasGreeting ? "is-ok" : ""}>
          Direct greeting <span>use a person, hiring manager, or committee</span>
        </li>
        <li className={!hasPlaceholder ? "is-ok" : ""}>
          No placeholders <span>replace bracketed prompts before applying</span>
        </li>
      </ul>
      <p className="cover-letter-review__note">
        AI makes one grounded revision pass. It does not run a second “review agent”; the original stays recoverable here for comparison.
      </p>
      <details>
        <summary>Writing standard</summary>
        <p>Specific interest, selected evidence, active voice, no résumé repetition, and a natural close.</p>
        <a href="https://capd.mit.edu/resources/career-toolkit-writing-a-cover-letter/" target="_blank" rel="noreferrer">MIT CAPD guidance</a>
        <a href="https://cloudfront.careeronestop.org/JobSearch/Resumes/cover-letters.aspx" target="_blank" rel="noreferrer">CareerOneStop guidance</a>
      </details>
      <p className="cover-letter-review__status" aria-live="polite">{status}</p>
    </aside>
  );
}
