// The references-only contract between the PDF importer and the Resume import
// AI stage. The model never returns text: every field is a list of references
// to the source pieces the client sent, optionally narrowed to an exact
// substring of one piece. The server validates a reply before answering, and
// the client validates again before rebuilding the document from its own copy
// of the pieces. Dependency-free so both runtimes import it.

export const RESUME_IMPORT_PROMPT_VERSION = "resume-import-structure-v1";

export const RESUME_IMPORT_LIMITS = {
  lines: 1_500,
  pieces: 3_000,
  pieceChars: 2_000,
  textChars: 40_000
} as const;

const STRUCTURE_LIMITS = { contact: 60, sections: 60, entries: 200, bullets: 100, refs: 400 } as const;

const RESUME_IMPORT_SECTION_TYPES = ["standard", "skills", "summary"] as const;
export type ResumeImportSectionType = (typeof RESUME_IMPORT_SECTION_TYPES)[number];

const REGIONS = ["main", "top", "left", "right"] as const;

export type ResumeImportPiece = { id: string; text: string };

export type ResumeImportLine = {
  page: number;
  region: (typeof REGIONS)[number];
  x: number;
  size: number;
  bold: boolean;
  italic: boolean;
  // The line began with a bullet marker, which is not sent as a piece.
  marker: boolean;
  pieces: ResumeImportPiece[];
};

export type PieceRef = string | { piece: string; text: string };

export type ImportedEntryRefs = {
  titleLeft: PieceRef[];
  titleRight: PieceRef[];
  subtitleLeft: PieceRef[];
  subtitleRight: PieceRef[];
  bullets: PieceRef[][];
};

export type ImportedSectionRefs = {
  heading: PieceRef[];
  type: ResumeImportSectionType;
  entries: ImportedEntryRefs[];
};

export type ResumeImportStructure = {
  name: PieceRef[];
  contact: PieceRef[][];
  sections: ImportedSectionRefs[];
};

export class ResumeImportContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeImportContractError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

// Request lines arrive from the browser; anything malformed or oversized is
// refused before a provider sees it.
export function parseResumeImportLines(value: unknown): ResumeImportLine[] {
  const refuse = (message: string): never => {
    throw new ResumeImportContractError(message);
  };
  if (!Array.isArray(value) || !value.length) refuse("Send the PDF's extracted lines to interpret.");
  const lines = value as unknown[];
  if (lines.length > RESUME_IMPORT_LIMITS.lines) refuse("This PDF has too many lines to interpret.");
  const ids = new Set<string>();
  let chars = 0;
  const parsed = lines.map((raw) => {
    if (!isRecord(raw) || !Array.isArray(raw.pieces)) return refuse("The extracted lines are malformed.");
    const { page, region, x, size, bold, italic, marker } = raw;
    if (
      !Number.isInteger(page) || (page as number) < 1 ||
      !REGIONS.includes(region as (typeof REGIONS)[number]) ||
      typeof x !== "number" || !Number.isFinite(x) ||
      typeof size !== "number" || !Number.isFinite(size) ||
      typeof bold !== "boolean" || typeof italic !== "boolean" || typeof marker !== "boolean"
    ) {
      return refuse("The extracted lines are malformed.");
    }
    const pieces = (raw.pieces as unknown[]).map((piece) => {
      if (!isRecord(piece) || typeof piece.id !== "string" || typeof piece.text !== "string") return refuse("The extracted lines are malformed.");
      if (!/^p\d{1,5}$/.test(piece.id) || ids.has(piece.id) || !piece.text.trim() || piece.text.length > RESUME_IMPORT_LIMITS.pieceChars) {
        return refuse("The extracted lines are malformed.");
      }
      ids.add(piece.id);
      chars += piece.text.length;
      return { id: piece.id, text: piece.text };
    });
    return { page: page as number, region: region as ResumeImportLine["region"], x, size, bold, italic, marker, pieces };
  });
  if (ids.size > RESUME_IMPORT_LIMITS.pieces || chars > RESUME_IMPORT_LIMITS.textChars) {
    refuse("This PDF has more text than AI interpretation accepts. Use the local reading.");
  }
  return parsed;
}

// Validates a model reply against the pieces that were sent. A reference must
// name a sent piece, and a narrowed reference must quote that piece exactly;
// anything else makes the whole reply unusable. Missing fields read as empty
// and unknown fields are ignored, because neither can carry text into the
// document.
export function validateResumeImportStructure(raw: unknown, pieceText: ReadonlyMap<string, string>): ResumeImportStructure {
  const fail = (message: string): never => {
    throw new ResumeImportContractError(message);
  };
  const list = (value: unknown, max: number): unknown[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) return fail("The reply's structure is malformed.");
    if (value.length > max) return fail("The reply is larger than any resume.");
    return value;
  };
  const refs = (value: unknown): PieceRef[] =>
    list(value, STRUCTURE_LIMITS.refs).map((ref) => {
      if (typeof ref === "string") {
        if (!pieceText.has(ref)) fail("The reply referenced text that was not sent.");
        return ref;
      }
      if (!isRecord(ref) || typeof ref.piece !== "string" || typeof ref.text !== "string") return fail("The reply's structure is malformed.");
      const source = pieceText.get(ref.piece);
      if (source === undefined) return fail("The reply referenced text that was not sent.");
      if (!ref.text.trim() || !source.includes(ref.text)) return fail("The reply contained text that is not in the PDF.");
      return { piece: ref.piece, text: ref.text };
    });
  if (!isRecord(raw)) return fail("The reply's structure is malformed.");
  return {
    name: refs(raw.name),
    contact: list(raw.contact, STRUCTURE_LIMITS.contact).map(refs),
    sections: list(raw.sections, STRUCTURE_LIMITS.sections).map((section) => {
      if (!isRecord(section)) return fail("The reply's structure is malformed.");
      const type = section.type ?? "standard";
      if (!RESUME_IMPORT_SECTION_TYPES.includes(type as ResumeImportSectionType)) return fail("The reply used an unknown section type.");
      return {
        heading: refs(section.heading),
        type: type as ResumeImportSectionType,
        entries: list(section.entries, STRUCTURE_LIMITS.entries).map((entry) => {
          if (!isRecord(entry)) return fail("The reply's structure is malformed.");
          return {
            titleLeft: refs(entry.titleLeft),
            titleRight: refs(entry.titleRight),
            subtitleLeft: refs(entry.subtitleLeft),
            subtitleRight: refs(entry.subtitleRight),
            bullets: list(entry.bullets, STRUCTURE_LIMITS.bullets).map(refs)
          };
        })
      };
    })
  };
}

export function resumeImportPieceText(lines: readonly ResumeImportLine[]): Map<string, string> {
  return new Map(lines.flatMap((line) => line.pieces.map((piece) => [piece.id, piece.text] as const)));
}
