// A compact deterministic version marker for an editable application document.
// This is not a security checksum; it lets the browser compare the complete
// serialized `.resume` / `.cover` source (including formatting and print style)
// with the source the server committed without duplicating that source in
// applications.json.
export function documentSourceFingerprint(sourceText: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < sourceText.length; index += 1) {
    const code = sourceText.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${sourceText.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}
