// Pure rules for importing a PDF resume: the run sequence (read, extract, then
// the guarded commit), user-facing refusal text, the review summary, and the
// labels review findings show for the field they point at.

import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import { parseFieldKey } from "@typeset/engine/typeset/types.ts";
import type { ContentAudit } from "../resume/pdfImport/importAudit.ts";
import type { PdfImportResult } from "../resume/pdfImport/importResumePdf.ts";
import { PdfImportError } from "../resume/pdfImport/importErrors.ts";

export type ResumeImportOutcome<Snapshot> =
  | { kind: "committed"; result: PdfImportResult; snapshot: Snapshot }
  | { kind: "refused"; message: string }
  // The user kept the current resume at the replacement prompt.
  | { kind: "declined" }
  // A newer import started before this one reached its commit.
  | { kind: "superseded" };

const UNEXPECTED = "This PDF couldn't be imported because of an unexpected error. Nothing was changed.";

export async function runResumeImport<Snapshot>(steps: {
  read(): Promise<Uint8Array>;
  extract(bytes: Uint8Array): Promise<PdfImportResult>;
  commit(result: PdfImportResult): Promise<Snapshot | null>;
  isCurrent(): boolean;
}): Promise<ResumeImportOutcome<Snapshot>> {
  let bytes: Uint8Array;
  try {
    bytes = await steps.read();
  } catch (error) {
    // Preflight messages are written for the user (wrong type, too large).
    return { kind: "refused", message: error instanceof Error ? error.message : UNEXPECTED };
  }
  if (!steps.isCurrent()) return { kind: "superseded" };
  let result: PdfImportResult;
  try {
    result = await steps.extract(bytes);
  } catch (error) {
    return { kind: "refused", message: error instanceof PdfImportError ? error.message : UNEXPECTED };
  }
  if (!steps.isCurrent()) return { kind: "superseded" };
  const snapshot = await steps.commit(result);
  return snapshot === null ? { kind: "declined" } : { kind: "committed", result, snapshot };
}

export function importDocumentTitle(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "").trim() || "Resume";
}

export function importSummary(audit: ContentAudit): string {
  const total = audit.sourceWords;
  if (!audit.unplacedWords) return `All ${total} words from the PDF are in the document.`;
  return `${total - audit.unplacedWords} of ${total} words are in the document; ${audit.unplacedWords} are listed under Not placed.`;
}

const SLOT_LABELS = {
  titleLeft: "title",
  titleRight: "title, right side",
  subtitleLeft: "subtitle",
  subtitleRight: "subtitle, right side"
} as const;

function short(text: string | null | undefined): string {
  const plain = stripInlineMarks(text ?? "").replace(/\s+/g, " ").trim();
  return plain.length > 36 ? `${plain.slice(0, 35)}…` : plain;
}

// Where a finding points, in words. `present` is false once the user has removed
// that field, so the review stops offering to show it.
export function importFindingLocation(data: ResumeData, key: string | null): { label: string; present: boolean } {
  if (key === null) return { label: "Whole document", present: false };
  const src = parseFieldKey(key);
  if (!src) return { label: "Removed field", present: false };
  if (src.kind === "name") return { label: "Name", present: Boolean(data.header?.name) };
  if (src.kind === "contact") {
    return { label: `Contact item ${src.index + 1}`, present: data.header?.contact[src.index] !== undefined };
  }
  const section = data.sections.find((current) => current.id === src.sectionId);
  if (!section) return { label: "Removed field", present: false };
  const heading = short(section.heading) || "Untitled section";
  if (src.kind === "heading") return { label: `${heading} heading`, present: true };
  const entryIndex = section.items.findIndex((item) => item.id === src.entryId);
  const entry = section.items[entryIndex];
  if (!entry) return { label: "Removed field", present: false };
  const entryName = short(entry.titleLeft) || short(entry.subtitleLeft) || `entry ${entryIndex + 1}`;
  if (src.kind === "entry") return { label: `${heading} › ${entryName} › ${SLOT_LABELS[src.field]}`, present: true };
  if (src.kind === "skillsRow") return { label: `${heading} › ${short(entry.titleLeft) || `row ${entryIndex + 1}`}`, present: true };
  const bulletIndex = entry.bullets.findIndex((bullet) => bullet.id === src.bulletId);
  if (bulletIndex < 0) return { label: "Removed field", present: false };
  return {
    label: section.type === "summary" ? `${heading} › paragraph ${entryIndex + 1}` : `${heading} › ${entryName} › bullet ${bulletIndex + 1}`,
    present: true
  };
}
