import { extractKeywords, includesKeyword, ROLE_KEYWORDS, startsWithAction } from "./keywords";
import { scoreResume } from "./scoring";
import {
  hasMetric,
  isBullet,
  isContactLine,
  isKnownSection,
  normalizeText,
  sectionName,
  sentenceCase,
  stripBullet,
  titleCase,
  unique
} from "./text";
import type { PolishedResume } from "./types";

const TECHNICAL_SECTION_NAMES = new Set(["core skills", "skills", "technical skills"]);

// Markers that the action in a bullet is NOT the candidate's own completed work,
// even after a weak-lead phrase is stripped: a negation ("...never shipped"), a
// passive ("...was handled by X"), a peripheral role ("shadowed/observed..."), or
// a third-party attribution clause ("...that the QA team closed"). When any match,
// we must NOT assert a leading action verb — doing so would invert or misattribute
// the claim. The relative-clause arm requires a relative pronoun AND a team/role
// noun, so a beneficiary phrase like "for the platform team" (no pronoun) is left
// strengthenable. These are high-confidence, low-false-positive markers; this is a
// best-effort refusal to INVENT, not a proof of correctness — the preferred AI
// polish plus human review handle the nuance rules can't.
const NOT_OWNED_ACTION =
  /\b(?:never|didn'?t|did not|do(?:es)? not|don'?t|wasn'?t|was not|weren'?t|were not|hasn'?t|haven'?t|hadn'?t|no longer|not yet|unable to|shadow(?:ed|ing)?|observ(?:ed|ing)|sat in on|assisted with)\b|\b(?:was|were|been|is|are)\s+\w+(?:ed|en)\s+by\b|\b(?:who|that|which|whom)\b(?:\W+\w+){0,4}?\W+(?:qa|team|teams|engineer|engineers|developer|developers|contractor|contractors|vendor|consultant|colleague|teammate|department|manager|staff|lead|leads)\b/i;

function scoreBullet(line: string, keywords: string[]) {
  const clean = stripBullet(line).toLowerCase();
  const keywordHits = keywords.filter((keyword) => includesKeyword(clean, keyword)).length;
  return keywordHits * 4 + (startsWithAction(clean) ? 3 : 0) + (hasMetric(clean) ? 3 : 0) - Math.max(0, clean.length - 180) / 60;
}

function polishBullet(line: string, keywords: string[], promptForMetric: boolean) {
  const original = stripBullet(line).replace(/\s+/g, " ").replace(/[.;]\s*$/, "");
  if (!original) return "";

  const weakLead = original
    .replace(/^(responsible for|worked on|helped with|used|utilized|created)\s+/i, "")
    .replace(/^(built|designed|developed|implemented|led|managed|optimized)\s+to\s+/i, "");
  // We ASSERT a leading action verb only when BOTH hold: (1) a recognized
  // weak-lead phrase ("responsible for", "worked on", …) was stripped, and (2) the
  // remaining text carries no NOT_OWNED_ACTION marker (negation / passive /
  // third-party attribution). Either guard alone is insufficient — a stripped weak
  // lead can still front text the source negates or credits to someone else
  // ("...shadowing a senior who built X", "...tickets that the QA team closed"). A
  // bullet that started with its OWN words ("never deployed to prod") is likewise
  // left intact. When in doubt we keep the source lead; at worst a weak bullet
  // keeps a lower-energy lead. Best-effort refusal to invent, not a formal proof.
  const weakLeadWasStripped = weakLead !== original;
  let body = sentenceCase(weakLead);

  // Don't prepend a verb when the lead is already a gerund ("-ing" word). The lead
  // may be a real verb ("deploying X" — prepending would double it: "Deployed
  // deploying X") OR a noun-modifier ("testing frameworks", "pricing engine" —
  // stripping/replacing it would corrupt the claim). Either way the safe move is to
  // leave the gerund lead as-is; "Deploying X" is weaker but truthful, and the
  // preferred AI polish phrases these better.
  const leadsWithGerund = /^\w+ing\b/i.test(weakLead);
  if (!startsWithAction(weakLead) && weakLeadWasStripped && !leadsWithGerund && !NOT_OWNED_ACTION.test(weakLead)) {
    body = `${chooseActionVerb(weakLead, keywords)} ${weakLead.charAt(0).toLowerCase()}${weakLead.slice(1)}`.trim();
  }

  // Only truncate genuinely bloated bullets. The cutoff matches the scorer's
  // revived concision threshold (210 chars in scoring.ts) so the polisher no
  // longer ellipsis-truncates normal ~190-char bullets that the scorer treats as
  // fine — which both lost real content and looked unfinished.
  if (body.length > 210) {
    body = `${body.slice(0, 207).replace(/\s+\S*$/, "")}...`;
  }

  if (promptForMetric && !hasMetric(body)) {
    body = `${body} [add metric: scope, scale, time saved, revenue, quality, or adoption]`;
  }

  return `- ${body}`;
}

function chooseActionVerb(text: string, keywords: string[]) {
  const normalized = normalizeText(text);
  if (/\b(migrat|transfer|onboard|coordinat)\w*/.test(normalized)) return "Coordinated";
  // Cloud/DevOps work reads best with deployment/automation verbs rather than the
  // generic "Built". Checked before the api/backend branch so a "deployed via
  // Docker on AWS" bullet is led by "Deployed", not "Built". (All returned verbs
  // are in ACTION_VERBS so the polished bullet scores as action-led.)
  if (/\b(deploy|docker|kubernetes|k8s|container|pipeline|ci\/cd|cicd|terraform|provision|infrastructure)\w*/.test(normalized)) return "Deployed";
  if (/\b(automat|orchestrat|script)\w*/.test(normalized)) return "Automated";
  if (/\b(debug|troubleshoot|fix|resolved?)\b/.test(normalized)) return "Resolved";
  if (/\b(test|validated?|verified?|qa)\b/.test(normalized)) return "Validated";
  if (/\b(database|postgresql|sql|model|schema)\b/.test(normalized)) return "Designed";
  if (/\b(api|backend|server|endpoint)\b/.test(normalized)) return "Built";
  if (/\b(frontend|react|typescript|javascript|ui|interface)\b/.test(normalized)) return "Developed";
  if (keywords.some((keyword) => includesKeyword(normalized, keyword))) return "Delivered";
  return "Strengthened";
}

function condenseBulletGroups(lines: string[], keywords: string[]) {
  const output: string[] = [];
  let trimmedGroups = 0;
  let index = 0;

  while (index < lines.length) {
    if (!isBullet(lines[index])) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const group: string[] = [];
    while (index < lines.length && isBullet(lines[index])) {
      group.push(lines[index]);
      index += 1;
    }

    const ranked = [...group].sort((a, b) => scoreBullet(b, keywords) - scoreBullet(a, keywords));
    if (group.length > 5) trimmedGroups += 1;
    output.push(...ranked.slice(0, 5).map((line, rankedIndex) => polishBullet(line, keywords, rankedIndex < 2)));
  }

  return { lines: output, trimmedGroups };
}

function trimBlankEdges(lines: string[]) {
  const output = [...lines];
  while (output.length && !output[0].trim()) output.shift();
  while (output.length && !output[output.length - 1].trim()) output.pop();
  return output;
}

function compactBlankLines(lines: string[]) {
  const output: string[] = [];
  for (const line of lines) {
    if (!line.trim() && !output[output.length - 1]?.trim()) continue;
    output.push(line);
  }
  return trimBlankEdges(output).join("\n");
}

function addSectionSpacing(lines: string[]) {
  const output: string[] = [];
  for (const line of lines) {
    if (isKnownSection(line) && output.length && output[output.length - 1].trim()) {
      output.push("");
    }
    output.push(line);
  }
  return output;
}

function splitResumeHeader(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim());
  const name = first >= 0 ? lines[first].trim() : "";
  const contact = first >= 0 ? lines[first + 1]?.trim() ?? "" : "";

  if (name && contact && isContactLine(contact) && !isKnownSection(name)) {
    return {
      header: [name, contact],
      body: trimBlankEdges(lines.slice(first + 2))
    };
  }

  return {
    header: [] as string[],
    body: trimBlankEdges(first >= 0 ? lines.slice(first) : [])
  };
}

function skipSection(lines: string[], start: number) {
  let index = start + 1;
  while (index < lines.length && !isKnownSection(lines[index])) index += 1;
  return index;
}

function removeSections(lines: string[], labels: Set<string>) {
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    if (labels.has(sectionName(lines[index]))) {
      index = skipSection(lines, index);
      continue;
    }

    output.push(lines[index]);
    index += 1;
  }

  return trimBlankEdges(output);
}

// A skill named in the resume is "claimed" (assertable as held experience) only
// if it appears in at least one line that is NOT purely aspirational or
// disclaimed. Otherwise the summary/skills section would overclaim a skill the
// source only said it WANTED to learn or had passing familiarity with ("Familiar
// with: Kubernetes" -> asserting "hands-on experience with Kubernetes"). Markers
// are deliberately narrow and chosen to avoid colliding with real skill names
// (notably NOT bare "learning", which is inside "machine learning"). A skill that
// also appears in any non-aspirational line (a real accomplishment bullet) stays.
const ASPIRATIONAL_SKILL =
  /\b(?:familiar(?:ity)? with|exposure to|some exposure|basic (?:knowledge|understanding|familiarity)|currently learning|want(?:ing)? to learn|hoping to (?:learn|use)|eager to (?:learn|use)|aspir\w* to (?:learn|use)|plan(?:ning)? to learn|interested in learning|beginner|studying|played with|tinkered with|dabbled(?: in)?|self-?taught|self-?study|coursework|on the side|in my spare time|for fun|as a hobby)\b/i;

function skillIsClaimed(resumeText: string, keyword: string) {
  // Scope the aspirational test to the CLAUSE the keyword sits in, splitting only
  // on newline and ";" — NOT on "," or "|", which double as LIST separators: a
  // marker must keep governing every item of a list it introduces ("Familiar with:
  // React, Vue, Docker" / "Familiar with: React | Vue | Docker" exclude ALL),
  // while a true clause break still un-taints the next clause ("Familiar with Rust;
  // built Docker pipelines" claims Docker). Erring toward the marker governing more
  // is the safe (under-claim) direction.
  const clauses = resumeText.split(/[\n;]/).filter((clause) => includesKeyword(clause, keyword));
  return clauses.some((clause) => !ASPIRATIONAL_SKILL.test(clause));
}

// A line with a real (non-contact) TITLE segment among its pipe/bullet-separated
// parts is an entry/project HEADING ("Portfolio Site | github.com/x | 2024"), not a
// stray duplicate contact line — so it must never be dropped just because it also
// contains a URL/email. A pure contact line ("email | phone | github") has no such
// title segment and is still droppable.
function looksLikeEntryHeading(line: string): boolean {
  // True if any "|"/bullet-separated segment is a real (non-contact) title — biased
  // toward KEEPING the line: dropping a real heading loses content, whereas keeping
  // a stray duplicate contact line is only cosmetic. No word-count cap, so a verbose
  // title ("Senior Engineer, Platform Team, Acme Worldwide | github.com/x") is kept.
  return line.split(/\s*[|·•]\s*/).some((segment) => {
    const part = segment.trim();
    return part.length > 0 && /[a-zA-Z]/.test(part) && !isContactLine(part) && !/^\d/.test(part);
  });
}

function buildSummary(keywords: string[], resumeText: string) {
  // Strictly evidence-bounded: the only facts we may assert are skills that
  // appear in BOTH the source resume and the job keywords (a real
  // resume↔JD overlap) AND are not purely aspirational. Never hardcode an
  // academic credential or a concrete skill list — for a non-CS / non-web
  // candidate that fabricates both a degree and specific technical experience.
  // With no derivable evidence, emit a bracketed placeholder the user fills in
  // rather than a fabricated claim.
  const claimed = keywords.filter((keyword) => skillIsClaimed(resumeText, keyword));
  // Drop a single-word keyword already covered by a longer matched phrase so the
  // summary doesn't read "Machine Learning, Learning, Machine" — extractKeywords
  // surfaces both a bigram and its component unigrams.
  const matched = claimed
    .filter((keyword) => !claimed.some((other) => other !== keyword && other.split(/[\s/]+/).includes(keyword)))
    .slice(0, 7);
  if (matched.length === 0) {
    return ["SUMMARY", "[add summary: your background and target role]"];
  }

  const skills = matched.map(titleCase).join(", ");
  return [
    "SUMMARY",
    `Targeting the role with hands-on experience across ${skills}, grounded in truthful project evidence.`
  ];
}

function buildTechnicalSkills(keywords: string[], resumeText: string) {
  const resumeSkills = ROLE_KEYWORDS.filter(({ keyword }) => skillIsClaimed(resumeText, keyword)).map(({ keyword }) => keyword);
  const targetedSkills = keywords.filter((keyword) => resumeSkills.includes(keyword));
  const skills = unique([...targetedSkills, ...resumeSkills]).slice(0, 12).map(titleCase);

  if (skills.length < 4) return [];
  return ["TECHNICAL SKILLS", skills.join(" | ")];
}

function hasTechnicalSection(lines: string[]) {
  return lines.some((line) => TECHNICAL_SECTION_NAMES.has(sectionName(line)));
}

function localEngineLabel(polishedText: string, trimmedGroups: number) {
  return unique([
    "Local engine ranked bullets by role keyword evidence, action verbs, metrics, and concision.",
    polishedText.includes("[add metric") ? "Metric prompts mark stronger proof to add before submitting." : "Existing measurable proof was preserved.",
    trimmedGroups ? "Long bullet groups were trimmed to the strongest five items." : "Role sections stay at five bullets or fewer."
  ]).slice(0, 4);
}

function localEngineFixes(missingKeywords: string[], trimmedGroups: number) {
  return unique([
    missingKeywords.length ? `Add truthful evidence for: ${missingKeywords.slice(0, 6).join(", ")}.` : "Keyword coverage is strong; review for company-specific wording.",
    trimmedGroups ? "Review trimmed bullets and restore any must-have evidence manually." : "Replace every bracketed metric prompt with a real number or remove it.",
    "Use the AI version when available for finer phrasing, but keep this local draft as a safe copy-ready baseline."
  ]).slice(0, 4);
}

export function polishResume(resumeText: string, jobText: string): PolishedResume {
  const jobKeywords = extractKeywords(jobText);
  const { header, body } = splitResumeHeader(resumeText);
  const sourceBody = removeSections(body, new Set(["summary", "targeted summary", "core skills"]));
  const { lines, trimmedGroups } = condenseBulletGroups(sourceBody, jobKeywords);
  const bodyWithSkills = hasTechnicalSection(lines) ? lines : [...buildTechnicalSkills(jobKeywords, resumeText), "", ...lines];
  const polishedBody = bodyWithSkills.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const summary = buildSummary(jobKeywords, resumeText);
  const polishedText = normalizePolishedResume([...header, "", ...summary, "", polishedBody].join("\n").trim(), resumeText);
  const matchedKeywords = jobKeywords.filter((keyword) => includesKeyword(polishedText, keyword));
  const missingKeywords = jobKeywords.filter((keyword) => !includesKeyword(resumeText, keyword)).slice(0, 10);
  const score = scoreResume(polishedText, jobKeywords, jobText, trimmedGroups);

  return {
    polishedText,
    source: "local",
    score,
    topKeywords: jobKeywords,
    matchedKeywords,
    missingKeywords,
    strengths: localEngineLabel(polishedText, trimmedGroups),
    fixes: localEngineFixes(missingKeywords, trimmedGroups),
    trimmedBulletGroups: trimmedGroups
  };
}

export function draftCoverLetter(resumeText: string, jobText: string, polishedText = resumeText) {
  const source = splitResumeHeader(resumeText);
  const candidateName = source.header[0]?.trim() || "[Your name]";
  const jobKeywords = extractKeywords(jobText);
  const matchedKeywords = jobKeywords.filter((keyword) => includesKeyword(polishedText, keyword)).slice(0, 5);
  const skillLine = matchedKeywords.length
    ? matchedKeywords.map(titleCase).join(", ")
    : "[add 2-3 relevant skills]";
  const evidenceBullets = polishedText
    .split("\n")
    .filter(isBullet)
    .sort((a, b) => scoreBullet(b, matchedKeywords) - scoreBullet(a, matchedKeywords))
    .slice(0, 2)
    .map((line) => stripBullet(line).replace(/\s*\[add metric:[^\]]+\]/gi, " [add metric]"));
  const evidenceLine =
    evidenceBullets.length > 0
      ? `Two examples I would bring to the role are: ${evidenceBullets.join("; ")}.`
      : "My project work gives me practical experience turning requirements into working software.";

  return [
    candidateName,
    "[Today's date]",
    "",
    "[Hiring manager]",
    "[Company]",
    "",
    "Dear [Hiring manager],",
    "",
    `I am applying for the [role title] role at [Company]. My background is [add your background], and my project experience aligns with the role through ${skillLine}.`,
    "",
    evidenceLine,
    "",
    "I am especially interested in roles where I can keep learning while contributing reliable code, clear API behavior, readable user-facing workflows, and steady debugging habits.",
    "",
    "I would welcome the chance to discuss how my project experience can support your engineering team. Thank you for your time and consideration.",
    "",
    "Sincerely,",
    candidateName
  ].join("\n");
}

export function normalizePolishedResume(polishedText: string, sourceResumeText: string) {
  const source = splitResumeHeader(sourceResumeText);
  const polished = splitResumeHeader(polishedText);
  const header = polished.header.length ? polished.header : source.header;
  const headerSet = new Set(header.map((line) => line.trim()).filter(Boolean));
  const body = trimBlankEdges(polished.body).filter((line) => {
    const trimmed = line.trim();
    // The isContactLine drop is meant to strip a duplicated header contact line
    // from the body — it must NOT delete a real accomplishment BULLET, nor an
    // entry/project HEADING, that merely contains an email/URL/phone ("- Built the
    // notifications@ pipeline"; "Portfolio Site | github.com/x | 2024"). Drop only a
    // pure contact line that is neither a bullet nor a titled heading.
    return trimmed && !headerSet.has(trimmed) && !(isContactLine(trimmed) && !isBullet(line) && !looksLikeEntryHeading(trimmed));
  });
  const hasTechnicalSkills = body.some((line) => sectionName(line) === "technical skills");
  const output: string[] = [];
  let sawSummary = false;
  let sawSkills = false;
  let index = 0;

  while (index < body.length) {
    const line = body[index];
    const section = sectionName(line);

    if (section === "summary" || section === "targeted summary") {
      if (sawSummary) {
        index = skipSection(body, index);
        continue;
      }
      output.push("SUMMARY");
      sawSummary = true;
      index += 1;
      continue;
    }

    if ((section === "core skills" || section === "skills") && hasTechnicalSkills) {
      index = skipSection(body, index);
      continue;
    }

    if (section === "core skills" || section === "skills" || section === "technical skills") {
      if (sawSkills) {
        index = skipSection(body, index);
        continue;
      }
      output.push(section === "technical skills" ? line : "TECHNICAL SKILLS");
      sawSkills = true;
      index += 1;
      continue;
    }

    output.push(line);
    index += 1;
  }

  return compactBlankLines([...header, "", ...addSectionSpacing(output)]);
}
