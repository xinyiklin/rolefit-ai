import {
  evidenceEntryName,
  type CoverLetterEvidenceItem,
  type CoverLetterBodyParagraph
} from "../../src/lib/coverLetterEvidence.ts";
import type { ResolvedCoverLetterContext } from "../../src/lib/coverLetterPreflight.ts";
import { GROUPING_HEADINGS, profileHeadingName, profileHeadingOwners, profileHeadings } from "../../shared/candidateProfileContract.ts";
import type { CoverLetterValidationIssue } from "./coverLetterIssues.ts";
import { affirmativeEvidence, candidateClaimIssue, evidenceSegments, hasContradictoryClaimEvidence } from "./claimEvidence.ts";
import { curatedClaimTerms, hasUnsupportedOwnershipIncrease, isTermGrounded } from "./grounding.ts";
import { candidateClaimSentences, coverLetterGroundingIssues } from "./coverLetterGroundingIssues.ts";

function unsupportedAffiliation(sentence: string, grounding: string): string | null {
  // Explicit prior affiliations need candidate evidence; ordinary acronyms are
  // not names merely because they are capitalized.
  const affiliations = /(?:^At |\b(?:worked (?:at|for)|employed by|joined|my (?:work|role|time) at) )([A-Z][\p{L}\p{N}.'’&-]*(?:[ \t]+(?!(?:I|We|My|Our)\b)[A-Z][\p{L}\p{N}.'’&-]*)*)/gu;
  for (const match of sentence.matchAll(affiliations)) {
    if (!isTermGrounded(match[1], grounding)) return `Unsupported affiliation: ${match[1]}`;
  }
  return null;
}

const ENTRY_LABEL_SEPARATOR = " · ";

// Groups evidence by entry. A resume entry's items share its label. Profile
// lines follow the shared Profile linker: a heading that names exactly one
// standard resume entry (with every enclosing heading naming it or merely
// grouping) joins that entry; any other heading forms its own group; lines under
// no heading, or directly under a grouping heading, stand alone. Skills rows and
// entries without a dated label never link.
function evidenceGroups(evidence: CoverLetterEvidenceItem[]): Map<string, string> {
  const groups = new Map<string, string>();
  // The label carries the entry's name, dates, employer or stack, and link; each
  // name-like segment answers for the entry, as titleLeft and subtitleLeft do.
  const entries = new Map<string, { id: string; titleLeft: string }>();
  for (const item of evidence) {
    if (item.source !== "resume" || !item.entry?.includes(ENTRY_LABEL_SEPARATOR)) continue;
    const group = `resume\u0000${item.section ?? ""}\u0000${item.entry}`;
    for (const [index, segment] of item.entry.split(ENTRY_LABEL_SEPARATOR).entries()) {
      const name = segment.trim();
      // The first segment is the entry name; a later one names it only when it
      // reads like an employer or school, never a stack list, location, or date.
      if (!name || entries.has(`${group}\u0000${name}`)) continue;
      if (index > 0 && (/[,\d]|https?:\/\/|\.[a-z]{2,}(?:\/|$)/i.test(name) || name.split(/\s+/).length > 6 || curatedClaimTerms(name).length > 0)) continue;
      entries.set(`${group}\u0000${name}`, { id: group, titleLeft: name });
    }
  }
  for (const item of evidence) {
    if (item.source === "resume") groups.set(item.id, `resume\u0000${item.section ?? ""}\u0000${item.entry ?? item.id}`);
  }
  const scope = { sections: [{ id: "resume", heading: "Resume", type: "standard", entries: [...entries.values()] }] };
  const profileItems = evidence.filter((item) => item.source === "profile");
  const lines: Array<{ itemId: string; text: string }> = [];
  for (const item of profileItems) for (const text of item.text.split("\n")) lines.push({ itemId: item.id, text });
  const profileText = lines.map((line) => line.text).join("\n");
  const headings = profileHeadings(profileText);
  const ends = headings.map((heading, index) =>
    headings.slice(index + 1).find((next) => next.level <= heading.level)?.line ?? lines.length);
  // Owners are read by heading position: a "### Atlas" nested under an unrelated
  // heading is not the top-level "## Atlas" even though the text matches.
  const owners = profileHeadingOwners(scope, profileText);
  const grouping = new Set(GROUPING_HEADINGS);
  const nameKey = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const entryNames = new Set([...entries.values()].map((entry) => nameKey(entry.titleLeft)));
  for (const [lineIndex, line] of lines.entries()) {
    if (groups.has(line.itemId)) continue;
    let innermost = -1;
    for (const [index, heading] of headings.entries()) {
      if (heading.line <= lineIndex && lineIndex < ends[index]) innermost = index;
    }
    let group = line.itemId;
    if (innermost >= 0) {
      const headingName = (index: number) => headings[index].text.replace(/[*_`]+/g, "").replace(/\s+#+\s*$/, "").trim();
      // The nearest linked enclosing heading owns the line, as the shared linker
      // keeps a non-naming subheading inside its section.
      let owner: string | undefined;
      for (let index = innermost; index >= 0 && !owner; index -= 1) {
        if (headings[index].line > lineIndex || lineIndex >= ends[index]) continue;
        owner = owners[index] ?? undefined;
        // An unlinked heading that names some entry ("### Beacon" under "## Atlas")
        // is excluded from its parent's section, as the shared linker excludes it.
        if (!owner && entryNames.has(nameKey(profileHeadingName(headingName(index))))) break;
      }
      if (owner) group = owner;
      else if (!grouping.has(profileHeadingName(headingName(innermost)).toLowerCase())) group = `profile\u0000${innermost}`;
    }
    groups.set(line.itemId, group);
  }
  return groups;
}

export function coverLetterParagraphClaims({
  paragraphs, evidence, authoredProse, jobText, employerContext, resolved
}: {
  paragraphs: CoverLetterBodyParagraph[];
  evidence: CoverLetterEvidenceItem[];
  authoredProse: string;
  jobText: string;
  employerContext?: string;
  resolved: ResolvedCoverLetterContext;
}): { issues: CoverLetterValidationIssue[]; warnings: string[] } {
  const issues: CoverLetterValidationIssue[] = [];
  const warnings: string[] = [];
  const groups = evidenceGroups(evidence);
  const sources = evidence.map((item) => ({
    id: item.id, entry: evidenceEntryName(item.entry), group: groups.get(item.id) ?? item.id,
    text: `${item.entry ?? ""}\n${item.text}`
  }));
  if (authoredProse) sources.push({ id: "source_letter", entry: "", group: "source_letter", text: authoredProse });
  const employer = `${jobText}\n${employerContext ?? ""}`;
  // Only a resume entry with a multi-part label (title plus dates, employer, or
  // stack) can be named: a Skills row ("Cloud"), a single-title entry, or an
  // answer label never narrows a sentence to itself or lends its tools to a job.
  const nameable = new Set(evidence.filter((item) => item.source === "resume" && item.entry?.includes(ENTRY_LABEL_SEPARATOR)).map((item) => evidenceEntryName(item.entry)));
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    // A citation grounds its whole entry: the other bullets of that resume entry
    // and the Profile section its heading names, never another entry.
    const citedGroups = new Set(sources.filter((source) => paragraph.evidenceIds.includes(source.id)).map((source) => source.group));
    const cited = sources.filter((source) => citedGroups.has(source.group));
    const candidateSentences = candidateClaimSentences(paragraph.text, resolved);
    for (const sentence of evidenceSegments(paragraph.text)) {
      const isCandidate = candidateSentences.some((candidate) => candidate.includes(sentence));
      // Case-sensitive: "Frontend" is a Skills row, "the frontend" is not a reference to it.
      const named = isCandidate ? sources.filter((source) => source.entry && nameable.has(source.entry) &&
        /^[A-Z]/.test(sentence.match(new RegExp(`(?:^|[^\\p{L}\\p{N}])(${source.entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=$|[^\\p{L}\\p{N}])`, "iu"))?.[1] ?? "")) : [];
      const names = new Set(named.map((source) => source.entry));
      // Explicitly named work is checked against that entry alone, cited or not:
      // it cannot borrow another entry's tools or outcomes, and a missed citation
      // is bookkeeping, not a false fact.
      const namedGroups = new Set(named.map((source) => source.group));
      const allowed = namedGroups.size === 1
        ? sources.filter((source) => namedGroups.has(source.group))
        : names.size === 1 && cited.some((source) => namedGroups.has(source.group))
          ? cited.filter((source) => namedGroups.has(source.group))
          : cited;
      const sourceText = isCandidate ? allowed.map((source) => source.text).join("\n") : employer;
      if (isCandidate && hasContradictoryClaimEvidence(sentence, sourceText)) {
        warnings.push(`Check conflicting candidate evidence for paragraph ${paragraphIndex + 1}.`);
      }
      const grounding = affirmativeEvidence(sourceText);
      const factualIssues = isCandidate ? coverLetterGroundingIssues({
        coverLetterText: sentence, jobText, grounding, resolved
      }) : [];
      issues.push(...factualIssues.map((issue) => ({ ...issue, paragraphIndex })));
      // The source letter is the candidate's own prose, but it can be stale: a
      // value only it supports is surfaced so the base letter gets corrected.
      if (isCandidate && allowed.some((source) => source.id === "source_letter")) {
        const withoutSource = affirmativeEvidence(allowed.filter((source) => source.id !== "source_letter").map((source) => source.text).join("\n"));
        const flagged = new Set(factualIssues.map((issue) => issue.unsupportedValue));
        for (const issue of coverLetterGroundingIssues({ coverLetterText: sentence, jobText, grounding: withoutSource, resolved })) {
          if (issue.unsupportedValue && !flagged.has(issue.unsupportedValue)) {
            warnings.push(`Paragraph ${paragraphIndex + 1}: "${issue.unsupportedValue}" comes only from your base letter; the resume and Profile do not state it.`);
          }
        }
      }
      const conflict = (isCandidate
        ? hasUnsupportedOwnershipIncrease(sentence, grounding, grounding) ? "Unsupported ownership or responsibility" : null
        : candidateClaimIssue(sentence, sourceText, sourceText)) ||
        (isCandidate ? unsupportedAffiliation(sentence, grounding) : null);
      if (conflict && factualIssues.length === 0) {
        issues.push({
          code: isCandidate ? "unsupported_claim" : "unsupported_employer_claim",
          category: "evidence", recovery: isCandidate ? "add_evidence" : "retry",
          claim: sentence, paragraphIndex,
          detail: "This statement contains a factual claim absent from its cited source.",
          repairMessage: `Remove or correct the unsupported factual claim: ${conflict}. Preserve its source and attribution.`
        });
      } else if (isCandidate && names.size > 1) {
        warnings.push(`Check the attribution across the experiences cited in paragraph ${paragraphIndex + 1}.`);
      }
    }
  }
  return { issues, warnings: [...new Set(warnings)] };
}
