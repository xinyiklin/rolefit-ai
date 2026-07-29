type MarkClean = () => void;

export function commitDocumentSaveBaseline(
  markContentClean: MarkClean,
  markStyleClean: MarkClean
): void {
  markContentClean();
  markStyleClean();
}
