import type { ResumeData, ResumeEntry } from "@typeset/engine/lib/resumeData.ts";

import {
  profileHeadingLinkage,
  profileHeadingName,
  type ProfileHeadingLinkage,
  type ProfileLinkScope
} from "../../shared/candidateProfileContract.ts";
import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import { buildResumePolishScope } from "./resumePolishScope.ts";

// The Profile Background as the linker partitions it: one block per heading
// that starts its own stretch of text, each block carrying the raw lines from
// its heading to the next block. Editing writes one block's lines back and
// leaves every other byte of the Background untouched.

export type ProfileNoteBlock = {
  // Line range [start, end) in the Background.
  start: number;
  end: number;
  level: number;
  heading: string;
  // Lines after the heading, with trailing blank lines dropped.
  body: string;
  linkage: ProfileHeadingLinkage;
};

export type ProfileNotes = {
  // Text above the first heading; null when there is none.
  preamble: { end: number; body: string } | null;
  blocks: ProfileNoteBlock[];
  byEntry: Map<string, ProfileNoteBlock[]>;
  // Blocks no entry owns, grouping headings included only when they carry text.
  general: ProfileNoteBlock[];
};

// Every standard entry can own notes here, whatever the Polish scope says for
// a given session: the Profile is global, the scope is not.
export function profileNotesScope(resume: ResumeData): ProfileLinkScope {
  return buildResumePolishScope(resume, resume.sections.map((section) => section.id), []);
}

function trimTrailingBlank(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end -= 1;
  return lines.slice(0, end);
}

export function parseProfileNotes(scope: ProfileLinkScope, background: string): ProfileNotes {
  const lines = background.split("\n");
  const headings = profileHeadingLinkage(scope, background).filter((heading) => heading.block);
  const blocks = headings.map((linkage, index): ProfileNoteBlock => {
    const end = headings[index + 1]?.line ?? lines.length;
    return {
      start: linkage.line,
      end,
      level: linkage.level,
      heading: linkage.text,
      body: trimTrailingBlank(lines.slice(linkage.line + 1, end)).join("\n"),
      linkage
    };
  });
  const byEntry = new Map<string, ProfileNoteBlock[]>();
  const general: ProfileNoteBlock[] = [];
  for (const block of blocks) {
    const { status, entryId } = block.linkage;
    if (status === "linked" && entryId) byEntry.set(entryId, [...(byEntry.get(entryId) ?? []), block]);
    else if (status !== "grouping" || block.body) general.push(block);
  }
  const preambleEnd = headings[0]?.line ?? lines.length;
  const preambleBody = trimTrailingBlank(lines.slice(0, preambleEnd)).join("\n");
  return {
    preamble: preambleBody.trim() ? { end: preambleEnd, body: preambleBody } : null,
    blocks,
    byEntry,
    general
  };
}

function splice(background: string, start: number, end: number, replacement: string[]): string {
  const lines = background.split("\n");
  // A block that is followed by more text ends with exactly one blank line.
  const trailing = end < lines.length && replacement.length ? [""] : [];
  lines.splice(start, end - start, ...replacement, ...trailing);
  return lines.join("\n");
}

export function replaceProfileBlock(background: string, block: ProfileNoteBlock, heading: string, body: string): string {
  const headingLine = `${"#".repeat(block.level)} ${heading.trim() || block.heading}`;
  return writeProfileLines(background, block.start, block.end, headingLine, body).background;
}

// Rewrites lines [start, end) as one heading line and a body, and reports where
// the written lines now end. An editor keeps that end and writes the same span
// next time, so a heading typed into a body stays in the editor's own lines
// even though the parser now reads it as a new note.
export function writeProfileLines(background: string, start: number, end: number, headingLine: string, body: string): { background: string; end: number } {
  const lines = background.split("\n");
  const bodyLines = trimTrailingBlank(body.split("\n"));
  // A block that is followed by more text ends with exactly one blank line.
  const trailing = end < lines.length ? [""] : [];
  lines.splice(start, end - start, headingLine, ...bodyLines, ...trailing);
  return { background: lines.join("\n"), end: start + 1 + bodyLines.length + trailing.length };
}

// A body as it is stored: trailing blank lines dropped.
export function normalizeNoteBody(body: string): string {
  return trimTrailingBlank(body.split("\n")).join("\n");
}

export function replaceProfilePreamble(background: string, end: number, body: string): string {
  return splice(background, 0, end, trimTrailingBlank(body.split("\n")));
}

// Whether rewriting lines [start, end) leaves every heading outside them linked
// as before: renaming "# Experience" would unlink every entry note beneath it.
export function keepsOtherLinks(scope: ProfileLinkScope, before: string, after: string, start: number, end: number): boolean {
  const shift = after.split("\n").length - before.split("\n").length;
  const outside = (text: string, spanEnd: number) => profileHeadingLinkage(scope, text)
    .filter((heading) => heading.line < start || heading.line >= spanEnd)
    .map((heading) => `${heading.text}\n${heading.status}\n${heading.entryId ?? ""}`);
  const was = outside(before, end);
  const now = outside(after, end + shift);
  return was.length === now.length && was.every((item, index) => item === now[index]);
}

export function removeProfileBlock(background: string, block: ProfileNoteBlock): string {
  const lines = background.split("\n");
  lines.splice(block.start, block.end - block.start);
  return trimTrailingBlank(lines).join("\n");
}

// Appends an empty block and reports the line it starts on, so the editor can
// open it before the text re-parses. It is a "##" note unless the heading
// above it would change how it links (a level-1 entry or free heading), then "#".
export function appendProfileBlock(background: string, heading: string, scope: ProfileLinkScope = null): { background: string; start: number } {
  const prefix = background.trimEnd();
  const start = prefix ? prefix.split("\n").length + 1 : 0;
  const at = (level: number) => `${prefix ? `${prefix}\n\n` : ""}${"#".repeat(level)} ${heading.trim()}\n`;
  const placed = profileHeadingLinkage(scope, at(2)).find((candidate) => candidate.line === start);
  const alone = headingLinkPreview(scope, heading);
  const nested = !placed?.block || placed.status !== alone?.status || placed.entryId !== alone?.entryId || placed.reason !== alone?.reason;
  return { background: at(nested ? 1 : 2), start };
}

function plain(value: string | null | undefined): string {
  return stripInlineMarks(value ?? "").trim();
}

export function entryTitle(entry: ResumeEntry): string {
  return plain(entry.titleLeft) || plain(entry.subtitleLeft);
}

// The heading a fresh block gets: the name the linker will match, plus the
// entry's dates when the resume shows them. The type (professional, personal
// project) is the user's to add.
export function defaultEntryHeading(entry: ResumeEntry, name = entryTitle(entry)): string {
  return composeProfileHeading(name, plain(entry.titleRight) || plain(entry.subtitleRight));
}

// A heading as the linker reads it: the name before the first "(", " — ",
// "|" or ":" (the same cut `profileHeadingName` makes), and the detail after.
export function splitProfileHeading(heading: string): { name: string; detail: string } {
  const text = heading.replace(/[*_`]+/g, "").replace(/\s+#+\s*$/, "").trim();
  const name = profileHeadingName(text);
  let detail = text.slice(name.length).trim();
  if (detail.startsWith("(")) {
    detail = detail.slice(1);
    detail = detail.endsWith(")") ? detail.slice(0, -1) : detail.replace(")", "");
  } else {
    detail = detail.replace(/^[—–\-|:]\s*/, "");
  }
  return { name, detail: detail.trim() };
}

export function composeProfileHeading(name: string, detail: string): string {
  return detail.trim() ? `${name.trim()} (${detail.trim()})` : name.trim();
}

// What a heading would link to on its own, for previewing a typed name.
export function headingLinkPreview(scope: ProfileLinkScope, heading: string): ProfileHeadingLinkage | undefined {
  return heading.trim() ? profileHeadingLinkage(scope, `## ${heading.trim()}`)[0] : undefined;
}

// The name that links a heading to this entry and no other: its title, else
// its subtitle; null when two entries or a section share both.
export function entryLinkName(scope: ProfileLinkScope, entry: ResumeEntry): string | null {
  for (const candidate of [plain(entry.titleLeft), plain(entry.subtitleLeft)]) {
    const name = profileHeadingName(candidate);
    if (name && headingLinkPreview(scope, name)?.entryId === entry.id) return name;
  }
  return null;
}

// Relinking rewrites only the heading's name; its detail and body stay.
export function relinkProfileBlock(background: string, block: ProfileNoteBlock, name: string): string {
  return replaceProfileBlock(background, block, composeProfileHeading(name, splitProfileHeading(block.heading).detail), block.body);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
