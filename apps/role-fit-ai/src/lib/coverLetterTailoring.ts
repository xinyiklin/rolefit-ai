import {
  coverLetterParagraphs,
  coverLetterResumeData,
  parseCoverLetterText
} from "@typeset/engine/lib/coverLetter.ts";
import { sharedWholeFieldFormat, withWholeFieldFormat } from "@typeset/engine/lib/inlineMarksText.ts";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";

// The letter an accepted Cover letter Polish proposal produces. Polish returns
// plain paragraphs; they keep the size and font the current paragraphs share,
// and the current letterhead.
export function tailoredCoverLetterData(current: ResumeData | null, tailored: string): ResumeData {
  const format = sharedWholeFieldFormat(current ? coverLetterParagraphs(current) : []);
  const parsed = coverLetterResumeData(
    coverLetterParagraphs(parseCoverLetterText(tailored)).map((paragraph) => withWholeFieldFormat(paragraph, format))
  );
  if (!current) return parsed;
  return {
    ...parsed,
    header: current.header ? { ...current.header, contact: [...current.header.contact] } : null
  };
}
