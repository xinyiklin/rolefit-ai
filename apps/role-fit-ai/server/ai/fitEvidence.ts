import { evidencePolarity, evidenceSegments } from "./claimEvidence.ts";

export function isAffirmativeFitEvidence(evidence: string, corpus = evidence): boolean {
  return evidencePolarity(evidence) === "affirmative" && !evidenceSegments(corpus).some(
    (part) => part.includes(evidence) && evidencePolarity(part) !== "affirmative"
  );
}

const EXPERIENCE_SOURCE_TERMS = /\b(?:personal|academic|volunteer|coursework|professional|paid|industry|commercial|employment|employed)\b/i;

// Profile entries carry their experience type on Markdown headings, e.g.
// "## Slotwise (personal project, 2025)". For each occurrence of the excerpt,
// returns the nearest enclosing heading (its own line included) that names a
// type, or "" when none does. Closed fenced code is not prose.
export function excerptSourceHeadings(corpus: string, excerpt: string): string[] {
  const starts: number[] = [];
  for (let at = excerpt ? corpus.indexOf(excerpt) : -1; at >= 0; at = corpus.indexOf(excerpt, at + 1)) starts.push(at);
  if (!starts.length) return [""];
  const lines = corpus.split("\n");
  const fences = lines.flatMap((line, index) => (/^ {0,3}(?:```|~~~)/.test(line) ? [index] : []));
  // An unclosed fence must not hide every later heading.
  const pairedFences = new Set(fences.length % 2 ? fences.slice(0, -1) : fences);
  const labels: string[] = [];
  const open: Array<{ level: number; text: string }> = [];
  let inFence = false;
  let lineStart = 0;
  for (const [index, line] of lines.entries()) {
    if (pairedFences.has(index)) inFence = !inFence;
    else if (!inFence) {
      const heading = /^ {0,3}(#{1,6})[ \t]+(\S.*)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        while (open.length && open[open.length - 1].level >= level) open.pop();
        open.push({ level, text: heading[2].trim() });
      }
    }
    const lineEnd = lineStart + line.length;
    while (labels.length < starts.length && starts[labels.length] <= lineEnd) {
      labels.push([...open].reverse().find((heading) => EXPERIENCE_SOURCE_TERMS.test(heading.text))?.text ?? "");
    }
    lineStart = lineEnd + 1;
  }
  return labels;
}

// A requirement for professional or paid experience that personal work does not meet.
export function restrictsExperienceSource(requirement: string): boolean {
  const personalSourceExcluded = /\b(?:personal|academic|volunteer|coursework)\b[^.;:\n]{0,60}\b(?:not|excluded|insufficient)\b|\b(?:excluding|not)\s+(?:personal|academic|volunteer|coursework)\b/i.test(requirement);
  return /\b(?:professional|paid|industry|commercial)\b/i.test(requirement)
    && (!/\b(?:personal|academic|volunteer|coursework)\b/i.test(requirement) || personalSourceExcluded);
}

// sourceLabel (a Profile heading) informs only this source test, never polarity.
export function experienceSourceConflict(requirement: string, evidence: string, sourceLabel = ""): boolean {
  const sourced = sourceLabel ? `${sourceLabel}\n${evidence}` : evidence;
  return restrictsExperienceSource(requirement)
    && /\b(?:personal|academic|volunteer|coursework)\b/i.test(sourced)
    && !/\b(?:professional|paid|industry|commercial|employment|employed)\b/i.test(sourced);
}

// These checks catch explicit conflicts, not semantic equivalence or overall fit.
export function hasFitEvidenceConflict(requirement: string, evidence: string, corpus = evidence): boolean {
  return !isAffirmativeFitEvidence(evidence, corpus) || experienceSourceConflict(requirement, evidence);
}

export function explicitEligibilityConflict(job: string, candidate: string): boolean {
  if (/\b(?:unless|except|if|provided|depending|case.by.case)\b/i.test(job)) return false;
  if (/\b(?:no|not|without)\b.*\bsponsor/i.test(job) &&
    /\b(?:need|require)\b.*\bsponsor/i.test(candidate) && !/\b(?:not|never)\b/i.test(candidate)) return true;
  if (/\b(?:must|required)\b.*\bclearance/i.test(job) &&
    /\b(?:no|not|lack)\b.*\bclearance/i.test(candidate)) return true;
  return /\b(?:must|required)\b.*\bauthori[sz]ed/i.test(job) && /\bnot\b.*\bauthori[sz]ed/i.test(candidate);
}
