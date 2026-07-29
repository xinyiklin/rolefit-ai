type MarkClean = () => void;

export function commitDocumentSaveBaseline(
  markContentClean: MarkClean,
  _markStyleClean: MarkClean
): void {
  markContentClean();
}
