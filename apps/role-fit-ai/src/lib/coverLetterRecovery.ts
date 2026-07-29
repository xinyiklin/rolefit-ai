export type CoverLetterRecoveryState = {
  documentDirty: boolean;
  documentTitle: string;
  persistedDocumentTitle: string;
  hasContent: boolean;
};

// Kept pure so title/style recovery semantics can be exercised without
// mounting the hook or touching browser storage.
export function coverLetterRecoveryDirty({
  documentDirty,
  documentTitle: _documentTitle,
  persistedDocumentTitle: _persistedDocumentTitle,
  hasContent
}: CoverLetterRecoveryState): boolean {
  return documentDirty && hasContent;
}
