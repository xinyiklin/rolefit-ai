export type CoverLetterRecoveryState = {
  documentDirty: boolean;
  documentTitle: string;
  persistedDocumentTitle: string;
};

// Kept pure so title/style recovery semantics can be exercised without
// mounting the hook or touching browser storage.
export function coverLetterRecoveryDirty({
  documentDirty,
  documentTitle,
  persistedDocumentTitle
}: CoverLetterRecoveryState): boolean {
  return documentDirty || documentTitle !== persistedDocumentTitle;
}
