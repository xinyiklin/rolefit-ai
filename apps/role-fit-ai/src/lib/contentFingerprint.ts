// A stable content identity for provenance checks — "is this still the exact
// text the model was given?" — not a security digest and not a cache key that
// must survive a release. Friendly labels cannot answer that question: two
// files can share a label, editing a document never changes its label, and a
// re-prepared posting keeps the label of the resume it was screened against.
//
// Whitespace is normalized first so a reflow that changes no words is the same
// document. A length prefix plus two independent 32-bit hashes makes an
// accidental collision between two real documents implausible.
export function contentFingerprint(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  let primary = 0x811c9dc5;
  let secondary = 0x01000193;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    primary = Math.imul(primary ^ code, 0x01000193) >>> 0;
    secondary = Math.imul(secondary ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${normalized.length.toString(36)}.${primary.toString(36)}.${secondary.toString(36)}`;
}
