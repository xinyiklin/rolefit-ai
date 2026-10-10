// The preservation check behind every import, deterministic or AI-assisted:
// each non-space character of the PDF's text must appear exactly once across
// the document's fields, the Not placed list, and the consumed structure
// (bullet markers, separators, a skills label's colon). Anything missing or
// extra means text was lost, invented, or duplicated.

import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { INLINE_MARK_TAG_PATTERN, stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import { BULLET_GLYPHS } from "../sections.ts";
import type { PdfSpan } from "./pdfLayout.ts";
import type { ConsumedPiece, ImportFinding } from "./resumeFromLayout.ts";

export type ContentAudit = {
  ok: boolean;
  // A field whose text still forms formatting code once the importer's own
  // marks are removed: source characters that would turn into a tag.
  latentMarkup: boolean;
  // Counted from the joined text, not the PDF's runs, which can be single glyphs.
  sourceWords: number;
  unplacedWords: number;
  // "x ×2" style tallies for diagnostics; empty when the import is faithful.
  lost: string[];
  added: string[];
};

const SEPARATORS = new Set([..."|•·◦▪∙"]);
const MARKERS = new Set([...BULLET_GLYPHS]);
const PRIVATE_USE_RE = /^[\uE000-\uF8FF]$/u;
const TAG_RE = new RegExp(INLINE_MARK_TAG_PATTERN, "i");

function tally(texts: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const char of text.replace(/\s/g, "")) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  return counts;
}

function difference(a: Map<string, number>, b: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [char, count] of a) {
    const missing = count - (b.get(char) ?? 0);
    if (missing > 0) out.push(missing > 1 ? `${char} ×${missing}` : char);
  }
  return out;
}

function fieldTexts(data: ResumeData): string[] {
  const texts: string[] = [];
  if (data.header) texts.push(data.header.name ?? "", ...data.header.contact);
  for (const section of data.sections) {
    texts.push(section.heading);
    for (const entry of section.items) {
      texts.push(entry.titleLeft ?? "", entry.titleRight ?? "", entry.subtitleLeft ?? "", entry.subtitleRight ?? "");
      for (const bullet of entry.bullets) texts.push(bullet.text);
    }
  }
  return texts;
}

function legitimatelyConsumed(piece: ConsumedPiece, spans: ReadonlyMap<string, PdfSpan>): boolean {
  const chars = [...piece.text.replace(/\s/g, "")];
  if (!chars.length) return true;
  if (piece.role === "label-colon") return piece.text === ":";
  if (piece.role === "separator") return chars.every((char) => SEPARATORS.has(char));
  if (chars.length > 2) return false;
  return spans.get(piece.spanId)?.dingbat === true || chars.every((char) => MARKERS.has(char) || PRIVATE_USE_RE.test(char));
}

function countWords(texts: readonly string[]): number {
  return texts.reduce((sum, text) => sum + text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length, 0);
}

export function auditImport(
  spans: readonly PdfSpan[],
  data: ResumeData,
  findings: readonly ImportFinding[],
  consumed: readonly ConsumedPiece[]
): ContentAudit {
  const spanById = new Map(spans.map((span) => [span.id, span]));
  const unplaced = findings.flatMap((finding) => (finding.kind === "unplaced" ? [finding.text] : []));
  const fields = fieldTexts(data).map(stripInlineMarks);
  const latentMarkup = fields.some((text) => TAG_RE.test(text));
  const accounted = [
    ...fields,
    ...unplaced,
    ...consumed.filter((piece) => legitimatelyConsumed(piece, spanById)).map((piece) => piece.text)
  ];
  const sourceTexts = spans.map((span) => span.text);
  const source = tally(sourceTexts);
  const placed = tally(accounted);
  const lost = difference(source, placed);
  const added = difference(placed, source);
  return {
    ok: lost.length === 0 && added.length === 0 && !latentMarkup,
    latentMarkup,
    sourceWords: countWords([...fields, ...unplaced]),
    unplacedWords: countWords(unplaced),
    lost,
    added
  };
}
