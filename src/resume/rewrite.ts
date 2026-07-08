// Post-AI text normalization for the polished resume: re-anchors the header,
// strips duplicated contact lines, dedupes SUMMARY/SKILLS sections, and
// restores section spacing. The deterministic local REWRITE engine that used
// to live here (polishResume) and the local cover-letter draft were removed by
// user decision (D011): the only local fallbacks the app keeps are the distill
// engine and the fit estimate.

import { isBullet, isContactLine, isKnownSection, sectionName } from "./text";

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
