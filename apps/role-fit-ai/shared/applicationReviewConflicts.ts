import type {
  ApplicationReviewInput,
  ApplicationReviewFinding
} from "./applicationReviewContract.ts";

// Narrow local checks flag explicit differences for review; the provider handles
// broader relationships. Similar wording never proves two experiences identical.
export function applicationDocumentConflicts(
  input: ApplicationReviewInput
): ApplicationReviewFinding[] {
  if (!input.includeResume || !input.includeCoverLetter) return [];
  const clauses = (text: string) =>
    text
      .split(/(?<=[.!?])\s+|\n/)
      .map((part) => part.trim())
      .filter(Boolean);
  const task = (text: string) =>
    text
      .toLowerCase()
      .replace(/[.!]$/, "")
      .replace(/\b(?:in|during) (?:19|20)\d{2}\b/g, "")
      .replace(
        /^(?:i |we )?(?:supported|assisted with|helped with|led|owned|managed|built|developed) (?:the |a )?/,
        ""
      )
      .trim();
  const findings: ApplicationReviewFinding[] = [];
  for (const letter of clauses(input.coverLetterText)) {
    for (const resume of clauses(input.resumeText)) {
      if (task(letter).length < 6 || task(letter) !== task(resume)) continue;
      const responsibility =
        /^(?:i |we )?(?:led|owned|managed)\b/i.test(letter) &&
        /^(?:i |we )?(?:supported|assisted with|helped with)\b/i.test(resume);
      const letterYear = letter.match(/\b(?:in|during) ((?:19|20)\d{2})\b/)?.[1];
      const resumeYear = resume.match(/\b(?:in|during) ((?:19|20)\d{2})\b/)?.[1];
      if (!responsibility && !(letterYear && resumeYear && letterYear !== resumeYear)) continue;
      findings.push({
        code: "attribution",
        document: "coverLetter",
        anchor: letter,
        message: "Check differing responsibility or dates across the documents.",
        recovery:
          "Confirm that these passages refer to the same work, then use the supported responsibility and date.",
        evidenceId: "current_resume",
        sourceExcerpt: resume,
        dependencies: ["resume", "coverLetter"]
      });
    }
  }
  return findings;
}
