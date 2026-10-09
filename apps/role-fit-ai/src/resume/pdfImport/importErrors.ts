// Import limits and refusals. Kept apart from the pdf.js adapter so the file
// preflight and the review UI can name them without loading the importer.

export const MAX_IMPORT_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_PDF_PAGES = 10;

export type PdfImportErrorKind =
  | "not-pdf"
  | "too-large"
  | "too-many-pages"
  | "encrypted"
  | "malformed"
  | "no-text"
  | "unreadable"
  | "overlay-text"
  | "unaccounted";

export class PdfImportError extends Error {
  readonly kind: PdfImportErrorKind;
  constructor(kind: PdfImportErrorKind, message: string) {
    super(message);
    this.name = "PdfImportError";
    this.kind = kind;
  }
}

const REFUSALS: Record<PdfImportErrorKind, string> = {
  "not-pdf": "This file is not a PDF. Choose a .pdf resume.",
  "too-large": "This PDF is larger than the 10 MB import limit.",
  "too-many-pages": `This PDF has more than ${MAX_IMPORT_PDF_PAGES} pages, which is beyond the import limit.`,
  encrypted: "This PDF is password-protected. Remove the password and import it again.",
  malformed: "This PDF could not be read. It may be damaged; export it again and retry.",
  "no-text": "This PDF has no selectable text. It may be a scan; scanned resumes can't be imported yet.",
  unreadable: "This PDF's text can't be read: its fonts don't map to real characters. Export it again from the original document.",
  "overlay-text": "This PDF has filled form fields or added text boxes, whose text can't be imported. Print it to a new PDF, which flattens them, and import that copy.",
  unaccounted: "Some of this PDF's text couldn't be imported faithfully, so nothing was imported. Please report the file's layout."
};

export function pdfImportError(kind: PdfImportErrorKind): PdfImportError {
  return new PdfImportError(kind, REFUSALS[kind]);
}
