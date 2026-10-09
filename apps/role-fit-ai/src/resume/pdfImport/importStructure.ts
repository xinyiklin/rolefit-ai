// The client half of AI interpretation: the lines sent to the Resume import
// stage, and the rebuild of a validated reply into a document from the
// client's own copy of the PDF text. A reply can only point at pieces; any part
// of a piece it leaves out becomes a consumed separator or a Not placed item,
// so the same preservation audit applies as to the local reading.

import {
  newBullet,
  newEntry,
  newSection,
  newSkillEntry,
  newSummaryEntry,
  type ResumeData,
  type ResumeEntry,
  type ResumeSectionData
} from "@typeset/engine/lib/resumeData.ts";
import { fieldKey } from "@typeset/engine/typeset/types.ts";
import {
  ResumeImportContractError,
  resumeImportPieceText,
  validateResumeImportStructure,
  type PieceRef,
  type ResumeImportLine,
  type ResumeImportStructure
} from "../../../shared/resumeImportContract.ts";
import { auditImport } from "./importAudit.ts";
import type { PdfImportResult } from "./importResumePdf.ts";
import { renderField, type FieldDraft } from "./fieldText.ts";
import { slicePiece, type LayoutLines, type LinePiece, type LineRegion } from "./layoutLines.ts";
import type { ConsumedPiece, ImportFinding } from "./resumeFromLayout.ts";

type ImportRequestPieces = Map<string, { piece: LinePiece; line: number; segment: number }>;

const HYPHEN_REASON = "Joined a word that was split across lines with a hyphen.";

export function importRequestLines(source: LayoutLines): { lines: ResumeImportLine[]; pieces: ImportRequestPieces } {
  const pieces: ImportRequestPieces = new Map();
  let next = 0;
  let segment = 0;
  const lines = source.lines.map((line, index) => ({
    page: line.page + 1,
    region: line.region,
    x: Math.round(line.x * 10) / 10,
    size: line.size,
    bold: line.bold,
    italic: line.italic,
    marker: line.marker !== null,
    pieces: line.segments.flatMap((members) => {
      segment += 1;
      return members.map((piece) => {
        const id = `p${(next += 1)}`;
        pieces.set(id, { piece, line: index, segment });
        return { id, text: piece.text };
      });
    })
  }));
  return { lines, pieces };
}

// What a reply may leave between the parts of a piece it splits: whitespace,
// separator glyphs, and a label's colon, and only where the parts land in
// different fields. Anything else would let a reply drop or move words.
const SPLIT_GAP_RE = /^[\s|•·◦▪∙:]*$/u;
const READING_ORDER_REASON = "Placed out of the PDF's reading order; check that it belongs here.";
const PASSED_OVER_REASON = "Text between this field's parts in the PDF was left out; check that nothing is missing.";
const pieceOrder = (id: string) => Number(id.slice(1));
const refPiece = (ref: PieceRef) => (typeof ref === "string" ? ref : ref.piece);

// The fields outside every longest in-order run, so a swap flags both of its
// sides while the fields around a move stay quiet.
function movedFields(orders: readonly number[]): Set<number> {
  const ending = orders.map(() => 1);
  const starting = orders.map(() => 1);
  for (let i = 0; i < orders.length; i += 1) {
    for (let j = 0; j < i; j += 1) if (orders[j] <= orders[i]) ending[i] = Math.max(ending[i], ending[j] + 1);
  }
  for (let i = orders.length - 1; i >= 0; i -= 1) {
    for (let j = i + 1; j < orders.length; j += 1) if (orders[j] >= orders[i]) starting[i] = Math.max(starting[i], starting[j] + 1);
  }
  const longest = Math.max(0, ...ending);
  const onRun = orders.map((_, i) => ending[i] + starting[i] - 1 === longest);
  const atRank = new Map<number, number>();
  orders.forEach((_, i) => {
    if (onRun[i]) atRank.set(ending[i], (atRank.get(ending[i]) ?? 0) + 1);
  });
  return new Set(orders.flatMap((_, i) => (onRun[i] && atRank.get(ending[i]) === 1 ? [] : [i])));
}

export function resolveImportStructure(
  structure: ResumeImportStructure,
  source: LayoutLines,
  pieces: ImportRequestPieces
): { data: ResumeData; findings: ImportFinding[]; consumed: ConsumedPiece[] } {
  const uses = new Map<string, { start: number; end: number; field: number }[]>();
  const findings: ImportFinding[] = [];
  const placed: { key: string | null; text: string; order: number; region: LineRegion; passedOver: string[] }[] = [];
  let findingId = 0;
  let fieldCount = 0;
  const nextId = () => `ai${(findingId += 1)}`;
  const reject = (message: string): never => {
    throw new ResumeImportContractError(message);
  };

  // A field is one run of the PDF's text in order. A cut piece can only end or
  // start it, and it may pass over whole lines or another stretch of a line
  // (another column, a page break), never words inside the stretches it uses.
  const field = (refs: readonly PieceRef[], marks: boolean): { draft: FieldDraft; passedOver: string[] } => {
    const fieldIndex = (fieldCount += 1);
    const lines: LinePiece[][] = [];
    const passedOver: string[] = [];
    let lastLine = -1;
    let previous: { order: number; segment: number; piece: LinePiece; slice: LinePiece } | null = null;
    for (const ref of refs) {
      const pieceId = refPiece(ref);
      const entry = pieces.get(pieceId) ?? reject("The reply referenced text that was not sent.");
      const order = pieceOrder(pieceId);
      if (previous && order < previous.order) reject("The reply reordered text within a field.");
      const earlier = uses.get(pieceId) ?? [];
      let slice = entry.piece;
      if (typeof ref === "string") {
        if (earlier.length) reject("The reply used the same text twice.");
      } else {
        // The parts of one piece follow each other through the reply in order.
        const at = entry.piece.span.text.indexOf(ref.text, earlier.length ? earlier[earlier.length - 1].end : entry.piece.start);
        if (at < 0 || at + ref.text.length > entry.piece.end) reject("The reply took parts of a line out of order.");
        slice = slicePiece(entry.piece.span, at, at + ref.text.length);
      }
      if (previous && order !== previous.order) {
        const cutAfter = previous.piece.span.text.slice(previous.slice.end, previous.piece.end);
        const cutBefore = entry.piece.span.text.slice(entry.piece.start, slice.start);
        if (cutAfter.trim() || cutBefore.trim()) reject("The reply joined part of a line to other text in one field.");
        for (let between = previous.order + 1; between < order; between += 1) {
          const { segment } = pieces.get(`p${between}`)!;
          if (segment === previous.segment || segment === entry.segment) reject("The reply left words out of the middle of a field.");
          passedOver.push(`p${between}`);
        }
      }
      previous = { order, segment: entry.segment, piece: entry.piece, slice };
      uses.set(pieceId, [...earlier, { start: slice.start, end: slice.end, field: fieldIndex }]);
      if (entry.line !== lastLine) {
        lines.push([]);
        lastLine = entry.line;
      }
      lines[lines.length - 1].push(slice);
    }
    return { draft: { lines, marks }, passedOver };
  };
  const render = (refs: readonly PieceRef[], marks: boolean, key: string | null): string => {
    const { draft, passedOver } = field(refs, marks);
    const rendered = renderField(draft);
    if (rendered.joinedHyphen) findings.push({ kind: "check", id: nextId(), fieldKey: key, reason: HYPHEN_REASON, source: rendered.text });
    if (refs.length) {
      const first = refPiece(refs[0]);
      const region = source.lines[pieces.get(first)!.line].region;
      placed.push({ key, text: rendered.text, order: pieceOrder(first), region, passedOver });
    }
    return rendered.text;
  };

  const name = render(structure.name, false, fieldKey({ kind: "name" }));
  const contact: string[] = [];
  for (const refs of structure.contact) {
    const text = render(refs, false, fieldKey({ kind: "contact", index: contact.length }));
    if (text) contact.push(text);
  }

  const sections: ResumeSectionData[] = structure.sections.map((sectionRefs) => {
    const section: ResumeSectionData = { ...newSection(sectionRefs.type, ""), items: [] };
    section.heading = render(sectionRefs.heading, false, fieldKey({ kind: "heading", sectionId: section.id }));
    for (const entryRefs of sectionRefs.entries) {
      if (sectionRefs.type === "skills") {
        const row = newSkillEntry("", "");
        section.items.push(row);
        const key = fieldKey({ kind: "skillsRow", sectionId: section.id, entryId: row.id });
        const extra = [entryRefs.titleRight, entryRefs.subtitleRight, ...entryRefs.bullets].filter((refs) => refs.length);
        row.titleLeft = render(entryRefs.titleLeft, false, key);
        row.subtitleLeft = render([...entryRefs.subtitleLeft, ...extra.flat()], false, key);
        if (extra.length) findings.push({ kind: "check", id: nextId(), fieldKey: key, reason: "Text from other fields was added to this skills row.", source: row.subtitleLeft });
      } else if (sectionRefs.type === "summary") {
        const paragraphs = [entryRefs.titleLeft, entryRefs.titleRight, entryRefs.subtitleLeft, entryRefs.subtitleRight, ...entryRefs.bullets];
        for (const refs of paragraphs.filter((current) => current.length)) {
          const paragraph = newSummaryEntry("");
          section.items.push(paragraph);
          const bullet = paragraph.bullets[0];
          bullet.text = render(refs, true, fieldKey({ kind: "bullet", sectionId: section.id, entryId: paragraph.id, bulletId: bullet.id }));
        }
      } else {
        const entry: ResumeEntry = { ...newEntry(), bullets: [] };
        section.items.push(entry);
        for (const slot of ["titleLeft", "titleRight", "subtitleLeft", "subtitleRight"] as const) {
          entry[slot] = render(entryRefs[slot], true, fieldKey({ kind: "entry", sectionId: section.id, entryId: entry.id, field: slot }));
        }
        for (const refs of entryRefs.bullets.filter((current) => current.length)) {
          const bullet = newBullet("");
          entry.bullets.push(bullet);
          bullet.text = render(refs, true, fieldKey({ kind: "bullet", sectionId: section.id, entryId: entry.id, bulletId: bullet.id }));
        }
      }
    }
    return section;
  });

  // Bullet markers are structure; a piece the reply never used is listed
  // whole; a piece it split must be covered except for the allowed gaps.
  const consumed: ConsumedPiece[] = [];
  for (const line of source.lines) {
    if (line.marker) consumed.push({ spanId: line.marker.span.id, text: line.marker.text, role: "marker" });
  }
  for (const { piece, reason } of source.excluded) {
    findings.push({ kind: "unplaced", id: nextId(), text: piece.text, reason, page: piece.span.page });
  }
  for (const [pieceId, { piece }] of pieces) {
    const parts = uses.get(pieceId);
    if (!parts) {
      findings.push({ kind: "unplaced", id: nextId(), text: piece.text, reason: "The AI interpretation left this out.", page: piece.span.page });
      continue;
    }
    const gap = (start: number, end: number, sameField: boolean) => {
      const text = piece.span.text.slice(start, end);
      if (!SPLIT_GAP_RE.test(text)) reject("The reply split a line in a way that drops or moves words.");
      const glyphs = text.replace(/\s/g, "");
      if (glyphs && sameField) reject("The reply dropped a separator inside a field.");
      // A label's colon ends the label; one inside a value ("3:1", "9:30") is text.
      for (let at = start; at < end; at += 1) {
        if (piece.span.text[at] === ":" && at + 1 < piece.end && /\S/u.test(piece.span.text[at + 1])) {
          reject("The reply split a value at a colon.");
        }
      }
      for (const char of glyphs) consumed.push({ spanId: piece.span.id, text: char, role: char === ":" ? "label-colon" : "separator" });
    };
    let position = piece.start;
    parts.forEach((part, index) => {
      gap(position, part.start, index > 0 && parts[index - 1].field === part.field);
      position = part.end;
    });
    gap(position, piece.end, false);
  }

  // Text a field passed over that no field used may be a dropped word; a field
  // that moved through its column's reading order may be a swap.
  for (const current of placed) {
    if (current.passedOver.some((id) => !uses.has(id))) {
      findings.push({ kind: "check", id: nextId(), fieldKey: current.key, reason: PASSED_OVER_REASON, source: current.text });
    }
  }
  for (const region of new Set(placed.map((current) => current.region))) {
    const column = placed.filter((current) => current.region === region);
    for (const index of movedFields(column.map((current) => current.order))) {
      findings.push({ kind: "check", id: nextId(), fieldKey: column[index].key, reason: READING_ORDER_REASON, source: column[index].text });
    }
  }

  return {
    data: { header: name || contact.length ? { visible: true, name: name || null, contact } : null, sections },
    findings,
    consumed
  };
}

// A provider reply as a complete import, or the reason it cannot be used. The
// reply is validated again here against the lines this client sent, and the
// rebuilt document must pass the same audit as the local reading.
export function interpretedImport(
  reply: unknown,
  local: PdfImportResult
): { ok: true; result: PdfImportResult } | { ok: false; reason: string } {
  const { lines, pieces } = importRequestLines(local.lines);
  let resolved: ReturnType<typeof resolveImportStructure>;
  try {
    resolved = resolveImportStructure(validateResumeImportStructure(reply, resumeImportPieceText(lines)), local.lines, pieces);
  } catch (error) {
    if (error instanceof ResumeImportContractError) return { ok: false, reason: error.message };
    throw error;
  }
  const findings = [...resolved.findings, ...local.styleFindings];
  const audit = auditImport(local.layout.spans, resolved.data, findings, resolved.consumed);
  if (!audit.ok) {
    return { ok: false, reason: audit.added.length ? "The reply repeated or added text." : "The reply lost text without leaving it out." };
  }
  return { ok: true, result: { ...local, data: resolved.data, findings, audit } };
}
