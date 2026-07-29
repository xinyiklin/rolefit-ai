import { paragraphFragmentsFromHtml } from "./clipboardHtmlImport.ts";

// Structural paste choices operate on logical blocks. Rich HTML wins because
// it retains the supported inline grammar; plain text is only a fallback and
// splits on authored, nonempty lines rather than guessing at header roles.
export function clipboardBlocks(html: string, plainText: string): string[] {
  const rich = paragraphFragmentsFromHtml(html);
  if (rich?.length) return rich;
  return plainText
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
}

export function defaultDocumentPasteMapping(blockCount: number): {
  nameIndex: number | null;
  bodyStart: number;
} {
  if (blockCount <= 1) return { nameIndex: null, bodyStart: 0 };
  const bodyStart = Math.min(2, blockCount - 1);
  return { nameIndex: 0, bodyStart };
}
