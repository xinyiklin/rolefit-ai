// Deterministic structure for an imported PDF: the name, contact items,
// section headings, entries, bullets, skills rows, and summary paragraphs.
// Every piece of source text ends up in exactly one place: a document field,
// the consumed list (bullet markers, separators, a skills label's colon), or a
// Not placed finding. Uncertain decisions become Check findings.

import {
  newBullet,
  newEntry,
  newSection,
  newSkillEntry,
  newSummaryEntry,
  type ResumeBullet,
  type ResumeData,
  type ResumeEntry,
  type ResumeSectionData
} from "@typeset/engine/lib/resumeData.ts";
import { fieldKey } from "@typeset/engine/typeset/types.ts";
import { inferSectionType, isSectionHeader } from "../sections.ts";
import { markedField, plainField, renderField, splitOnSeparators, type FieldDraft } from "./fieldText.ts";
import { joinPieces, slicePiece, type LayoutLine, type LayoutLines, type LinePiece } from "./layoutLines.ts";
import type { PdfRule } from "./pdfLayout.ts";
import { isDateLike } from "./rowDates.ts";

export type ImportCheck = { kind: "check"; id: string; fieldKey: string | null; reason: string; source: string };
export type ImportUnplaced = { kind: "unplaced"; id: string; text: string; reason: string; page: number };
export type ImportFinding = ImportCheck | ImportUnplaced;

export type ConsumedRole = "marker" | "separator" | "label-colon";
export type ConsumedPiece = { spanId: string; text: string; role: ConsumedRole };

export type ImportDraft = {
  data: ResumeData;
  findings: ImportFinding[];
  consumed: ConsumedPiece[];
  evidence: {
    // Lines that carry resume content (page furniture excluded).
    contentLines: LayoutLine[];
    nameLine: LayoutLine | null;
    headingLines: LayoutLine[];
    ruledHeadings: number;
    bodySize: number;
  };
};

type EntrySlot = "titleLeft" | "titleRight" | "subtitleLeft" | "subtitleRight";

type BulletDraft = { bullet: ResumeBullet; draft: FieldDraft; textX: number; marker: boolean; last: LayoutLine };

type EntryDraft = {
  sectionId: string;
  entry: ResumeEntry;
  slots: Partial<Record<EntrySlot, FieldDraft>>;
  bullets: BulletDraft[];
  headRows: number;
  titleLine: LayoutLine | null;
  skills?: { label: FieldDraft | null; list: FieldDraft; last: LayoutLine };
};

type SectionDraft = { section: ResumeSectionData; entries: EntryDraft[] };

const PAGE_NUMBER_RE = /^(?:page\s*)?\d{1,3}(?:\s*(?:of|\/)\s*\d{1,3})?$/i;
const CONTACT_HEADING_RE =
  /^(?:contact(?:\s+(?:info(?:rmation)?|details|me))?|personal\s+(?:details|information|info)|details|links|get\s+in\s+touch)$/i;
const SKILLS_LIKE_RE = /\b(?:technologies|tools|toolbox|tech(?:nical)?\s+stack|competenc|proficienc|expertise)/i;
function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function content(line: LayoutLine): LinePiece[] {
  return line.segments.flat();
}

function styleOf(line: LayoutLine): string {
  return `${line.font}|${line.size}|${line.bold}|${line.italic}|${line.caps}`;
}

// An entry row's style is its leading text's: a regular date beside a short
// bold employer must not make the row read as regular.
function leadStyle(line: LayoutLine): { key: string; bold: boolean; italic: boolean; size: number } {
  const lead = line.segments[0].filter((piece) => /[\p{L}\p{N}]/u.test(piece.text));
  const pieces = lead.length ? lead : line.segments[0];
  const bold = pieces.every((piece) => piece.span.bold);
  const italic = pieces.every((piece) => piece.span.italic);
  const size = Math.round(pieces[0].span.size * 2) / 2;
  return { key: `${pieces[0].span.font}|${size}|${bold}|${italic}`, bold, italic, size };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function buildResumeDraft(source: LayoutLines, rules: readonly PdfRule[]): ImportDraft {
  const { lines, bodySize } = source;
  const findings: ImportFinding[] = [];
  const consumed: ConsumedPiece[] = [];
  let findingId = 0;

  const check = (key: string | null, reason: string, sourceText: string) => {
    if (findings.some((finding) => finding.kind === "check" && finding.fieldKey === key && finding.reason === reason)) return;
    findings.push({ kind: "check", id: `f${(findingId += 1)}`, fieldKey: key, reason, source: sourceText });
  };
  const unplace = (pieces: readonly LinePiece[], reason: string) => {
    const text = joinPieces(pieces);
    if (text) findings.push({ kind: "unplaced", id: `f${(findingId += 1)}`, text, reason, page: pieces[0].span.page });
  };
  const consume = (pieces: readonly LinePiece[], role: ConsumedRole) => {
    for (const current of pieces) consumed.push({ spanId: current.span.id, text: current.text, role });
  };
  const linePieces = (line: LayoutLine) => (line.marker ? [line.marker, ...content(line)] : content(line));

  for (const { piece, reason } of source.excluded) unplace([piece], reason);

  const pitch = median(lines.filter((line) => line.gapAbove !== null && line.gapAbove > 0 && Math.abs(line.size - bodySize) <= 1).map((line) => line.gapAbove!)) ?? bodySize * 1.2;
  const isFull = (line: LayoutLine) => line.right >= line.regionRight - Math.max(3 * line.size, 0.12 * (line.regionRight - line.regionLeft));
  const flows = (line: LayoutLine, previous: LayoutLine) =>
    line.page === previous.page && line.region === previous.region
      ? line.gapAbove !== null && line.gapAbove <= pitch * 1.45
      : line.page === previous.page + 1 && line.gapAbove === null;

  // Page furniture: page numbers and lines repeated at the top or bottom of
  // several pages. They stay visible as Not placed rather than vanish.
  const dropped = new Set<LayoutLine>();
  const pages = new Map<number, LayoutLine[]>();
  for (const line of lines) pages.set(line.page, [...(pages.get(line.page) ?? []), line]);
  // A running header repeats text from an earlier page's top (page 1's top is
  // the name and contact block); a running footer repeats at the same position
  // and size. A role title that recurs across a page break is neither.
  const earlierEdges: { line: LayoutLine; top: boolean }[] = [];
  for (const pageLines of pages.values()) {
    const edges = [...pageLines.slice(0, 2).map((line) => ({ line, top: true })), ...pageLines.slice(-2).map((line) => ({ line, top: false }))]
      .filter((edge, index, all) => all.findIndex((other) => other.line === edge.line) === index);
    for (const { line, top } of edges) {
      if ((line === pageLines[0] || line === pageLines[pageLines.length - 1]) && PAGE_NUMBER_RE.test(line.text)) {
        dropped.add(line);
        unplace(linePieces(line), "Page number.");
      } else if (
        earlierEdges.some(
          (earlier) =>
            earlier.top === top &&
            earlier.line.text === line.text &&
            (top || (Math.abs(earlier.line.y - line.y) <= 3 && Math.abs(earlier.line.size - line.size) < 0.5))
        )
      ) {
        dropped.add(line);
        unplace(linePieces(line), "Repeated at the top or bottom of every page.");
      }
    }
    earlierEdges.push(...edges);
  }
  const body = lines.filter((line) => !dropped.has(line));
  // A row's last segment in the right half of its column, starting where
  // another row's does (a tab stop), is its right-hand value short of the margin.
  const lastSegmentX = (line: LayoutLine) => line.segments[line.segments.length - 1][0].x;
  const tabbed = body.filter((line) => line.segments.length > 1);
  const atTabStop = (line: LayoutLine) =>
    lastSegmentX(line) >= (line.regionLeft + line.regionRight) / 2 &&
    tabbed.some((other) => other !== line && other.region === line.region && Math.abs(lastSegmentX(other) - lastSegmentX(line)) <= 1.5);

  // ── Name ──────────────────────────────────────────────────────────────────
  const firstPage = body.filter((line) => line.page === 0);
  const nameCandidates = firstPage.filter((line) => {
    const lead = joinPieces(line.segments[0]);
    return !line.marker && words(lead) <= 6 && line.text.length <= 80 && !/@|\d{3}|https?:/i.test(lead);
  });
  let nameLine = nameCandidates.reduce<LayoutLine | null>((best, line) => (!best || line.size > best.size ? line : best), null);
  let nameGuessed = false;
  if (nameLine && !(nameLine.size >= bodySize * 1.25 || (nameLine.bold && firstPage.indexOf(nameLine) < 3))) nameLine = null;
  if (!nameLine && nameCandidates[0] && firstPage.indexOf(nameCandidates[0]) === 0) {
    nameLine = nameCandidates[0];
    nameGuessed = true;
  }

  // ── Headings ──────────────────────────────────────────────────────────────
  const boldChars = body.reduce((sum, line) => sum + (line.bold ? line.text.length : 0), 0);
  const allChars = body.reduce((sum, line) => sum + line.text.length, 0) || 1;
  const bodyBold = boldChars / allChars > 0.6;
  const ruled = (line: LayoutLine) =>
    rules.some(
      (rule) =>
        rule.page === line.page &&
        rule.x0 <= line.x + line.size &&
        rule.x1 - rule.x0 >= 0.4 * (line.regionRight - line.regionLeft) &&
        rule.y >= line.y - 1.6 * line.size &&
        rule.y <= line.y + 1.1 * line.size
    );
  const signals = (line: LayoutLine) =>
    Number(line.size >= bodySize * 1.08) + Number(line.bold && !bodyBold) + Number(line.caps || line.smallCaps) + Number(ruled(line));
  const candidate = (line: LayoutLine) =>
    line !== nameLine &&
    !line.marker &&
    line.segments.length === 1 &&
    words(line.text) <= 6 &&
    line.text.length <= 50 &&
    !/[.,;]$/.test(line.text) &&
    /\p{L}/u.test(line.text) &&
    !/@|https?:|www\./i.test(line.text);
  const vocabulary = (line: LayoutLine) => isSectionHeader(line.text.toLowerCase().replace(/:$/, ""));
  const strong = body.filter((line) => candidate(line) && vocabulary(line) && signals(line) >= 1);
  const signatures = new Set(strong.map(styleOf));
  const weakPath = signatures.size === 0;
  const headingSet = new Set<LayoutLine>(
    body.filter(
      (line) =>
        candidate(line) &&
        (strong.includes(line) ||
          (signatures.has(styleOf(line)) && signals(line) >= 1) ||
          (weakPath && signals(line) >= 2 && (line.gapAbove === null || line.gapAbove >= pitch * 1.4)))
    )
  );
  const headingLines = body.filter((line) => headingSet.has(line));

  // ── Header ────────────────────────────────────────────────────────────────
  const contact: FieldDraft[] = [];
  const addContactLine = (line: LayoutLine, segments: LinePiece[][]) => {
    if (line.marker) consume([line.marker], "marker");
    for (const segment of segments) {
      const { parts, separators } = splitOnSeparators(segment);
      consume(separators, "separator");
      for (const part of parts) {
        contact.push(plainField(part));
        const text = joinPieces(part);
        if (words(text) > 8) check(fieldKey({ kind: "contact", index: contact.length - 1 }), "A long line near the top was placed with the contact details; it may belong in a section.", text);
      }
    }
  };

  const firstHeadingIndex = body.findIndex((line) => headingSet.has(line));
  const headerEnd = firstHeadingIndex < 0 ? Math.min(body.length, 3) : firstHeadingIndex;
  let nameDraft: FieldDraft | null = null;
  for (const line of body.slice(0, headerEnd)) {
    if (line === nameLine) continue;
    addContactLine(line, line.segments);
  }
  if (nameLine) {
    nameDraft = plainField(nameLine.segments[0]);
    if (nameLine.segments.length > 1) addContactLine({ ...nameLine, marker: null }, nameLine.segments.slice(1));
    if (nameGuessed) check(fieldKey({ kind: "name" }), "The name was taken from the first line.", nameLine.text);
  } else {
    check(null, "No name was found at the top of the first page.", "");
  }
  if (firstHeadingIndex < 0) check(null, "No section headings were found; the text was placed in one untitled section.", "");

  // ── Sections ──────────────────────────────────────────────────────────────
  const sections: SectionDraft[] = [];
  const groups: { heading: LayoutLine | null; lines: LayoutLine[] }[] = [];
  for (const line of body.slice(headerEnd)) {
    if (line === nameLine) continue;
    if (headingSet.has(line)) groups.push({ heading: line, lines: [] });
    else if (groups.length) groups[groups.length - 1].lines.push(line);
    else groups.push({ heading: null, lines: [line] });
  }

  for (const group of groups) {
    const headingText = group.heading ? joinPieces(group.heading.segments[0]) : "";
    if (group.heading && CONTACT_HEADING_RE.test(headingText)) {
      unplace(content(group.heading), "Contact heading; its items are in the header.");
      for (const line of group.lines) addContactLine(line, line.segments);
      continue;
    }
    let type = inferSectionType(headingText);
    if (type === "standard" && SKILLS_LIKE_RE.test(headingText)) type = "skills";
    const draft: SectionDraft = { section: { ...newSection(type, headingText), items: [] }, entries: [] };
    sections.push(draft);
    if (group.heading && !strong.includes(group.heading)) {
      check(fieldKey({ kind: "heading", sectionId: draft.section.id }), weakPath ? "Possible section heading." : "Read as a section heading from its styling.", headingText);
    }
    if (type === "skills") parseSkills(draft, group.lines);
    else if (type === "summary") parseSummary(draft, group.lines);
    else parseStandard(draft, group.lines);
  }

  function addEntry(draft: SectionDraft, entry: ResumeEntry): EntryDraft {
    const entryDraft: EntryDraft = { sectionId: draft.section.id, entry, slots: {}, bullets: [], headRows: 0, titleLine: null };
    draft.section.items.push(entry);
    draft.entries.push(entryDraft);
    return entryDraft;
  }

  function addBullet(entryDraft: EntryDraft, line: LayoutLine, marker: boolean): BulletDraft {
    const bullet = newBullet("");
    entryDraft.entry.bullets.push(bullet);
    const bulletDraft: BulletDraft = { bullet, draft: markedField(content(line)), textX: line.x, marker, last: line };
    entryDraft.bullets.push(bulletDraft);
    return bulletDraft;
  }

  function continues(line: LayoutLine, previous: LayoutLine, textX: number, marker: boolean): boolean {
    if (line.marker || line.segments.length > 1 || !flows(line, previous) || Math.abs(line.size - previous.size) >= 0.6) return false;
    // A wrapped line reaches the margin, unless it broke a word with a hyphen.
    if (!isFull(previous) && !/\p{L}-$/u.test(previous.text)) return false;
    const aligned = Math.abs(line.x - textX) <= 0.8 * line.size;
    return marker ? aligned : aligned || line.x >= textX - 0.8 * line.size;
  }

  function mapRow(entryDraft: EntryDraft, line: LayoutLine, row: "title" | "subtitle") {
    const [leftSlot, rightSlot]: [EntrySlot, EntrySlot] = row === "title" ? ["titleLeft", "titleRight"] : ["subtitleLeft", "subtitleRight"];
    const keyFor = (slot: EntrySlot) => fieldKey({ kind: "entry", sectionId: entryDraft.sectionId, entryId: entryDraft.entry.id, field: slot });
    let segments = line.segments;
    let right: LinePiece[] | null = null;
    const last = segments[segments.length - 1];
    if (segments.length > 1 && (last[last.length - 1].right >= line.regionRight - 1.5 * line.size || atTabStop(line))) {
      right = last;
      segments = segments.slice(0, -1);
    }
    let left: LinePiece[] = segments.flat();
    let subtitle: LinePiece[] | null = null;
    if (segments.length === 1 && !right) {
      const { parts, separators } = splitOnSeparators(segments[0]);
      if (parts.length > 1) {
        consume(separators, "separator");
        const dateIndex = parts.findIndex((part, index) => index > 0 && isDateLike(joinPieces(part)));
        if (dateIndex > 0) right = parts.splice(dateIndex, 1)[0];
        left = parts[0];
        if (row === "title" && parts.length > 1) subtitle = parts[1];
        const rest = parts.slice(row === "title" ? 2 : 1);
        if (rest.length) {
          left = [...left, ...rest.flat()];
          check(keyFor(leftSlot), "Text from one row was combined into this field.", line.text);
        }
      }
    } else if (segments.length > 1) {
      check(keyFor(leftSlot), "Text from one row was combined into this field.", line.text);
    }
    entryDraft.slots[leftSlot] = markedField(left);
    if (right) entryDraft.slots[rightSlot] = markedField(right);
    if (subtitle) {
      entryDraft.slots.subtitleLeft = markedField(subtitle);
      entryDraft.headRows = 2;
    }
  }

  function parseStandard(draft: SectionDraft, sectionLines: readonly LayoutLine[]) {
    let current: EntryDraft | null = null;
    let bullet: BulletDraft | null = null;
    let titleStyle: string | null = null;
    let markerless = false;
    for (const line of sectionLines) {
      if (line.marker) {
        consume([line.marker], "marker");
        current ??= addEntry(draft, { ...newEntry(), bullets: [] });
        bullet = addBullet(current, line, true);
        continue;
      }
      if (bullet && continues(line, bullet.last, bullet.textX, bullet.marker)) {
        bullet.draft.lines.push(content(line));
        bullet.last = line;
        continue;
      }
      const flowsFromHead = current?.titleLine ? flows(line, current.titleLine) || line.gapAbove === null : false;
      if (current && !current.bullets.length && current.headRows === 1 && !current.slots.titleRight && line.segments.length === 1 && isDateLike(line.text) && flowsFromHead) {
        current.slots.titleRight = markedField(content(line));
        continue;
      }
      if (current && !current.bullets.length && current.headRows === 1 && current.titleLine && flowsFromHead && isSubtitle(line, current.titleLine)) {
        mapRow(current, line, "subtitle");
        current.headRows = 2;
        continue;
      }
      const lead = leadStyle(line);
      const titleLike = line.segments.length > 1 || (lead.bold && !bodyBold) || (titleStyle !== null && lead.key === titleStyle);
      const prose = words(line.text) > 12 && line.segments.length === 1;
      if ((current && !titleLike) || (!current && prose && !lead.bold)) {
        current ??= addEntry(draft, { ...newEntry(), bullets: [] });
        bullet = addBullet(current, line, false);
        if (!markerless) {
          markerless = true;
          check(
            fieldKey({ kind: "bullet", sectionId: draft.section.id, entryId: current.entry.id, bulletId: bullet.bullet.id }),
            "Lines without bullet markers were read as bullets.",
            line.text
          );
        }
        continue;
      }
      current = addEntry(draft, { ...newEntry(), bullets: [] });
      current.titleLine = line;
      current.headRows = 1;
      mapRow(current, line, "title");
      bullet = null;
      if (titleStyle === null) titleStyle = lead.key;
      else if (lead.key !== titleStyle && !lead.bold) {
        check(
          fieldKey({ kind: "entry", sectionId: draft.section.id, entryId: current.entry.id, field: "titleLeft" }),
          "Styled differently from the other entries in this section; check where it belongs.",
          line.text
        );
      }
    }
  }

  function isSubtitle(line: LayoutLine, titleLine: LayoutLine): boolean {
    if (line.segments.length > 2 || words(line.text) > 14) return false;
    const lead = leadStyle(line);
    const titleLead = leadStyle(titleLine);
    const differs = lead.bold !== titleLead.bold || lead.italic !== titleLead.italic || lead.size !== titleLead.size;
    if (differs) return true;
    // Same-style rows that both end in a right-aligned value are a title and
    // subtitle ("Company · City" over "Role · Dates") unless both values are
    // dates, which reads as two dated items (a certifications list).
    const rightText = (row: LayoutLine) => (row.segments.length > 1 ? joinPieces(row.segments[row.segments.length - 1]) : null);
    const lineRight = rightText(line);
    const titleRight = rightText(titleLine);
    return lineRight !== null && titleRight !== null && !(isDateLike(lineRight) && isDateLike(titleRight));
  }

  function parseSummary(draft: SectionDraft, sectionLines: readonly LayoutLine[]) {
    let paragraph: BulletDraft | null = null;
    for (const line of sectionLines) {
      if (line.marker) consume([line.marker], "marker");
      if (paragraph && !line.marker && continues(line, paragraph.last, paragraph.textX, false)) {
        paragraph.draft.lines.push(content(line));
        paragraph.last = line;
        continue;
      }
      const entry = newSummaryEntry("");
      const entryDraft = addEntry(draft, entry);
      paragraph = { bullet: entry.bullets[0], draft: markedField(content(line)), textX: line.x, marker: false, last: line };
      entryDraft.bullets.push(paragraph);
    }
  }

  function splitLabel(line: LayoutLine): { label: LinePiece[]; colon: LinePiece | null; rest: LinePiece[] } | null {
    const pieces = content(line);
    let offset = 0;
    for (let index = 0; index < pieces.length; index += 1) {
      const current = pieces[index];
      const colonAt = current.text.indexOf(":");
      if (colonAt >= 0) {
        const labelText = joinPieces([...pieces.slice(0, index), slicePiece(current.span, current.start, current.start + colonAt)]);
        if (offset + colonAt > 40 || !labelText || words(labelText) > 5 || current.text.slice(colonAt + 1).startsWith("//")) return null;
        const after = slicePiece(current.span, current.start + colonAt + 1, current.end);
        const rest = [...(after.text ? [after] : []), ...pieces.slice(index + 1)];
        if (!rest.length) return null;
        return {
          label: [...pieces.slice(0, index), ...(colonAt > 0 ? [slicePiece(current.span, current.start, current.start + colonAt)] : [])],
          colon: slicePiece(current.span, current.start + colonAt, current.start + colonAt + 1),
          rest
        };
      }
      offset += current.text.length + 1;
    }
    if (line.segments.length > 1 && line.segments[0].every((current) => current.span.bold) && words(joinPieces(line.segments[0])) <= 4) {
      return { label: line.segments[0], colon: null, rest: line.segments.slice(1).flat() };
    }
    return null;
  }

  function parseSkills(draft: SectionDraft, sectionLines: readonly LayoutLine[]) {
    let row: EntryDraft | null = null;
    for (const line of sectionLines) {
      if (line.marker) consume([line.marker], "marker");
      const labelled = splitLabel(line);
      if (!labelled && row?.skills && !line.marker && continues(line, row.skills.last, row.skills.last.x, false)) {
        row.skills.list.lines.push(content(line));
        row.skills.last = line;
        continue;
      }
      row = addEntry(draft, newSkillEntry("", ""));
      if (labelled) {
        if (labelled.colon) consume([labelled.colon], "label-colon");
        row.skills = { label: plainField(labelled.label), list: plainField(labelled.rest), last: line };
      } else {
        row.skills = { label: null, list: plainField(content(line)), last: line };
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const render = (field: FieldDraft, key: string | null): string => {
    const rendered = renderField(field);
    if (rendered.joinedHyphen) check(key, "Joined a word that was split across lines with a hyphen.", rendered.text);
    return rendered.text;
  };
  for (const draft of sections) {
    const sectionId = draft.section.id;
    for (const entryDraft of draft.entries) {
      const { entry } = entryDraft;
      if (entryDraft.skills) {
        entry.titleLeft = entryDraft.skills.label ? render(entryDraft.skills.label, null) : "";
        entry.subtitleLeft = render(entryDraft.skills.list, fieldKey({ kind: "skillsRow", sectionId, entryId: entry.id }));
        continue;
      }
      for (const slot of ["titleLeft", "titleRight", "subtitleLeft", "subtitleRight"] as const) {
        const field = entryDraft.slots[slot];
        entry[slot] = field ? render(field, fieldKey({ kind: "entry", sectionId, entryId: entry.id, field: slot })) : "";
      }
      for (const bulletDraft of entryDraft.bullets) {
        bulletDraft.bullet.text = render(bulletDraft.draft, fieldKey({ kind: "bullet", sectionId, entryId: entry.id, bulletId: bulletDraft.bullet.id }));
      }
    }
  }

  const name = nameDraft ? renderField(nameDraft).text : "";
  const contactItems = contact.map((field) => renderField(field).text).filter(Boolean);
  const data: ResumeData = {
    header: name || contactItems.length ? { visible: true, name: name || null, contact: contactItems } : null,
    sections: sections.map((draft) => draft.section)
  };
  return {
    data,
    findings,
    consumed,
    evidence: { contentLines: body, nameLine, headingLines, ruledHeadings: headingLines.filter(ruled).length, bodySize }
  };
}
