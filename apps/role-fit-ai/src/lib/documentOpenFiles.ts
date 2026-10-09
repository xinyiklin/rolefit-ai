import {
  MAX_COVER_LETTER_FILE_BYTES,
  parseCoverLetterFile
} from "@typeset/engine/lib/coverLetter.ts";
import {
  MAX_RESUME_FILE_BYTES,
  parseResumeFile
} from "@typeset/engine/lib/resumeFile.ts";
import { MAX_IMPORT_PDF_BYTES } from "../resume/pdfImport/importErrors.ts";

type UploadFile = {
  name: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export async function prepareResumeUpload(
  file: UploadFile
): Promise<ReturnType<typeof parseResumeFile>> {
  if (!/\.resume$/i.test(file.name)) {
    throw new Error("Choose a .resume file. Other formats are not supported.");
  }
  if (file.size > MAX_RESUME_FILE_BYTES) {
    throw new Error("This .resume file is larger than the 2 MB limit.");
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new Error("The .resume file could not be read. Try choosing it again.");
  }
  return parseResumeFile(bytes);
}

// A PDF is never opened as a document: these bytes only feed the importer,
// which checks the PDF signature itself and refuses anything it cannot read.
export async function prepareResumePdfImport(file: UploadFile & { type?: string }): Promise<Uint8Array> {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    throw new Error("Choose a .pdf file to import.");
  }
  if (file.size > MAX_IMPORT_PDF_BYTES) {
    throw new Error("This PDF is larger than the 10 MB import limit.");
  }
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error("The PDF could not be read. Try choosing it again.");
  }
}

export async function prepareCoverLetterUpload(
  file: UploadFile
): Promise<ReturnType<typeof parseCoverLetterFile>> {
  if (!/\.cover$/i.test(file.name)) {
    throw new Error("Choose a .cover file. Other formats are not supported.");
  }
  if (file.size > MAX_COVER_LETTER_FILE_BYTES) {
    throw new Error("This .cover file is larger than the 2 MB limit.");
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new Error("The .cover file could not be read. Try choosing it again.");
  }
  return parseCoverLetterFile(bytes);
}
