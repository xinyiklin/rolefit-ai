// The `.resume` file format — a lossless, fully client-side JSON serialization
// of the editor's structured ResumeData (see ./resumeData.ts). This is the
// save/load counterpart to the PDF export: no server route, no network call.
// Envelope: { format: "rolefit.resume", version: 1, data: ResumeData }.
//
// Parsing follows the repo's "parse, don't validate" convention (see
// server/ai/*): never throw on shape, coerce/clamp defensively so a
// hand-edited or partially-malformed file still loads something sane. The
// only thing worth throwing on is truly unusable input (not JSON at all).
//
// IDs are always remapped through the existing newSection/newEntry/newBullet
// constructors. A `.resume` saved in a prior session embeds ids like
// "bullet-1" that would collide with this session's module-level uid()
// counter (resumeData.ts) on the first structural edit after load — so every
// load mints fresh ids and only carries over the field VALUES (including any
// inline <b>/<i>/<u> marks, which just live inside those string values).

import {
  newBullet,
  newEntry,
  newSection,
  type ResumeBullet,
  type ResumeData,
  type ResumeEntry,
  type ResumeSectionData,
  type ResumeSectionType
} from "./resumeData.ts";

const RESUME_FILE_FORMAT = "rolefit.resume";
const RESUME_FILE_VERSION = 1;

export function serializeResumeFile(data: ResumeData): string {
  return JSON.stringify({ format: RESUME_FILE_FORMAT, version: RESUME_FILE_VERSION, data }, null, 2);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function coerceContact(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") out.push(entry);
    else if (typeof entry === "number" || typeof entry === "boolean") out.push(String(entry));
  }
  return out;
}

// Fresh id via newBullet(); only the text VALUE is carried over.
function coerceBullet(raw: unknown): ResumeBullet {
  if (typeof raw === "string") return { ...newBullet(), text: raw };
  const source = asRecord(raw);
  return { ...newBullet(), text: str(source.text) };
}

// Empty arrays are preserved as empty (a skills row commonly has bullets: [])
// so the round trip stays lossless — never pad a missing/short list.
function coerceBullets(raw: unknown): ResumeBullet[] {
  return Array.isArray(raw) ? raw.map(coerceBullet) : [];
}

const SECTION_TYPES: readonly ResumeSectionType[] = ["standard", "skills", "summary"];
function coerceSectionType(raw: unknown): ResumeSectionType {
  return typeof raw === "string" && (SECTION_TYPES as readonly string[]).includes(raw) ? (raw as ResumeSectionType) : "standard";
}

// Fresh id via newEntry(); every field VALUE (titles/subtitles/bullets) is
// carried over verbatim, including any inline mark tags inside the strings.
function coerceEntry(raw: unknown): ResumeEntry {
  const source = asRecord(raw);
  return {
    ...newEntry(),
    titleLeft: str(source.titleLeft),
    titleRight: str(source.titleRight),
    subtitleLeft: str(source.subtitleLeft),
    subtitleRight: str(source.subtitleRight),
    bullets: coerceBullets(source.bullets)
  };
}

function defaultHeadingFor(type: ResumeSectionType): string {
  return type === "skills" ? "Skills" : type === "summary" ? "Summary" : "New Section";
}

// Fresh id via newSection(); heading/type/items are all replaced with the
// coerced values from the file.
function coerceSection(raw: unknown): ResumeSectionData {
  const source = asRecord(raw);
  const type = coerceSectionType(source.type);
  return {
    ...newSection(type),
    heading: str(source.heading, defaultHeadingFor(type)),
    type,
    items: Array.isArray(source.items) ? source.items.map(coerceEntry) : []
  };
}

// Parse a `.resume` file's text into a ResumeData, remapping every id. Accepts
// either the enveloped `{ format, version, data }` shape or a bare ResumeData
// object (resilience for hand-edited files that dropped the envelope). Throws
// only when the input isn't JSON or has no object to read from — every other
// shape mismatch is coerced rather than rejected.
export function parseResumeFile(json: string): ResumeData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("This file isn't valid JSON — it may not be a .resume file.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("This .resume file doesn't contain usable resume data.");
  }

  const envelope = parsed as Record<string, unknown>;
  const looksEnveloped = typeof envelope.format === "string" || (envelope.data !== undefined && envelope.data !== null);
  const record = asRecord(looksEnveloped ? envelope.data : envelope);

  return {
    name: str(record.name),
    contact: coerceContact(record.contact),
    sections: Array.isArray(record.sections) ? record.sections.map(coerceSection) : []
  };
}
