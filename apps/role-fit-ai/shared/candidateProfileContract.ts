// The Profile Background is sent whole or not at all: every AI stage that uses
// candidate context declines above this limit instead of cutting the text.
export const PROFILE_BACKGROUND_CHAR_LIMIT = 12_000;
// Upper bound for the declared-facts block prepended to the Background.
export const CANDIDATE_FACTS_CONTEXT_MAX_LENGTH = 1_000;
export const CANDIDATE_CONTEXT_CHAR_LIMIT = PROFILE_BACKGROUND_CHAR_LIMIT + CANDIDATE_FACTS_CONTEXT_MAX_LENGTH;

export const PROFILE_BACKGROUND_LIMIT_MESSAGE =
  "Your Profile Background is over 12,000 characters. Shorten it in Settings > Profile.";

// Fit measures NFKC-normalized text and the other stages send raw text, so the
// limit applies to whichever is longer.
export function profileTextLength(text: string): number {
  return Math.max(text.length, text.normalize("NFKC").length);
}

export function profileBackgroundLimitError(background: string): string | null {
  return profileTextLength(background) > PROFILE_BACKGROUND_CHAR_LIMIT ? PROFILE_BACKGROUND_LIMIT_MESSAGE : null;
}

// Server-side bound on the merged facts + Background string.
export function candidateContextLimitError(context: string): string | null {
  return profileTextLength(context) > CANDIDATE_CONTEXT_CHAR_LIMIT ? PROFILE_BACKGROUND_LIMIT_MESSAGE : null;
}

export type ProfileHeading = { line: number; level: number; text: string };

// Markdown headings in Profile text, by line index. Closed fenced code is not
// prose; an unclosed fence must not hide every later heading.
export function profileHeadings(text: string): ProfileHeading[] {
  const lines = text.split("\n");
  const fences = lines.flatMap((line, index) => (/^ {0,3}(?:```|~~~)/.test(line) ? [index] : []));
  const pairedFences = new Set(fences.length % 2 ? fences.slice(0, -1) : fences);
  const headings: ProfileHeading[] = [];
  let inFence = false;
  for (const [index, line] of lines.entries()) {
    if (pairedFences.has(index)) inFence = !inFence;
    else if (!inFence) {
      const heading = /^ {0,3}(#{1,6})[ \t]+(\S.*)$/.exec(line);
      if (heading) headings.push({ line: index, level: heading[1].length, text: heading[2].trim() });
    }
  }
  return headings;
}

// "CareFlow (personal project, 2025–present)" and "CareFlow — personal
// project" both name "CareFlow"; hyphenated names stay whole.
export function profileHeadingName(heading: string): string {
  return heading
    .replace(/[*_`]+/g, "")
    .replace(/\s+#+\s*$/, "")
    .split(/\s*\(|\s[—–-]\s|\||:/)[0]
    .trim();
}

function nameKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function plainScopeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/<\/?[a-z][^>]*>/gi, "").replace(/\s+/g, " ").trim() : "";
}

// A name answers as written, by its first "|" segment, and by the same
// reduction a heading gets, so "## Typeset (open source)" names "Typeset (open source)".
function nameKeys(value: unknown): string[] {
  const plain = plainScopeText(value);
  if (!plain) return [];
  const keys = new Set<string>();
  for (const name of [plain, plain.split("|")[0], profileHeadingName(plain)]) {
    const key = nameKey(name.replace(/[*_`]+/g, ""));
    if (key) keys.add(key);
  }
  return [...keys];
}

export type ProfileLinkScope = { sections?: unknown; contextSections?: unknown; locked?: unknown } | null | undefined;

// [title, subtitle] of each omitted standard entry. Client and server both
// pass the list through here, so linking sees identical names on each side.
export function normalizeOmittedEntryNames(value: unknown): string[][] {
  return (Array.isArray(value) ? value : []).slice(0, 200).flatMap((names) => {
    const [title, role] = Array.isArray(names) ? names : [];
    const pair = [plainScopeText(title).slice(0, 300), plainScopeText(role).slice(0, 300)];
    return pair.some(Boolean) ? [pair] : [];
  });
}

// An entry answers to its title or its subtitle: resumes put the employer or
// project on either line. An omitted entry can make a name ambiguous but never
// owns Profile text.
type LinkableEntry = { id: string | null; names: string[] };

// Headings that group entries rather than name one: the resume's own section
// headings and the usual Profile groupings.
export const GROUPING_HEADINGS = [
  "experience", "work experience", "professional experience", "employment", "work history", "work",
  "jobs", "internships", "projects", "personal projects", "side projects", "academic projects",
  "open source", "research", "volunteering", "volunteer work", "leadership", "activities",
  "education", "background", "professional", "other"
];

function standardSections(scope: ProfileLinkScope): Array<{ heading: unknown; entries: unknown }> {
  return [scope?.sections, scope?.contextSections].flatMap((value) => (Array.isArray(value) ? value : [])).flatMap((section) => {
    if (!section || typeof section !== "object") return [];
    const { id, heading, type, entries } = section as { id?: unknown; heading?: unknown; type?: unknown; entries?: unknown };
    // The server drops sections without an id or visible heading before linking.
    return type === "standard" && typeof id === "string" && id.trim() && plainScopeText(heading) ? [{ heading, entries }] : [];
  });
}

function linkableEntries(scope: ProfileLinkScope): LinkableEntry[] {
  const entries = standardSections(scope).flatMap(({ entries }) => (Array.isArray(entries) ? entries : []).flatMap((entry): LinkableEntry[] => {
    if (!entry || typeof entry !== "object") return [];
    const { id, titleLeft, subtitleLeft } = entry as { id?: unknown; titleLeft?: unknown; subtitleLeft?: unknown };
    if (typeof id !== "string" || !id.trim()) return [];
    return [{ id, names: [...new Set([...nameKeys(titleLeft), ...nameKeys(subtitleLeft)])] }];
  }));
  const locked = scope?.locked && typeof scope.locked === "object" ? scope.locked as { omittedEntryNames?: unknown } : {};
  for (const names of normalizeOmittedEntryNames(locked.omittedEntryNames)) {
    entries.push({ id: null, names: [...new Set(names.flatMap(nameKeys))] });
  }
  return entries;
}

type HeadingAnalysis = {
  lines: string[];
  headings: ProfileHeading[];
  ends: number[];
  // Whether a heading's own name matches any entry.
  names: boolean[];
  owners: (string | null)[];
  parents: number[];
};

function analyzeProfileHeadings(scope: ProfileLinkScope, profile: string): HeadingAnalysis {
  const lines = profile.split("\n");
  const headings = profileHeadings(profile);
  const entries = headings.length ? linkableEntries(scope) : [];
  const grouping = new Set([
    ...GROUPING_HEADINGS,
    ...standardSections(scope).map(({ heading }) => nameKey(profileHeadingName(plainScopeText(heading))))
  ].filter(Boolean));
  const ends = headings.map((heading, index) =>
    headings.slice(index + 1).find((next) => next.level <= heading.level)?.line ?? lines.length);
  const parents = headings.map((heading, index) => {
    for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
      if (headings[candidate].level < heading.level && ends[candidate] > heading.line) return candidate;
    }
    return -1;
  });
  const keys = headings.map((heading) => nameKey(profileHeadingName(heading.text)));
  // A grouping word never names an entry, even one whose title reduces to it
  // ("Research | Prof. Smith Lab"), so a whole group cannot become one entry's.
  const matches = keys.map((key) => (key && !grouping.has(key) ? entries.filter((entry) => entry.names.includes(key)) : []));
  // A heading links only when every enclosing heading names the same entry or
  // just groups entries. Any other enclosing heading ("My years at Acme") is
  // context the linker cannot read, so nothing beneath it links.
  const owners = matches.map((own, index) => {
    let candidates = own;
    for (let parent = parents[index]; candidates.length && parent >= 0; parent = parents[parent]) {
      if (matches[parent].length) candidates = candidates.filter((entry) => matches[parent].includes(entry));
      else if (!grouping.has(keys[parent])) candidates = [];
    }
    return candidates.length === 1 ? candidates[0].id : null;
  });
  return { lines, headings, ends, names: matches.map((list) => list.length > 0), owners, parents };
}

type LinkedBlock = { owner: string; heading: string; text: string };

// A Profile heading links the text beneath it to the one standard resume entry
// it names. A heading naming no entry, or several, stays unlinked, and nested
// text under a heading that names any other entry is never this entry's evidence.
function linkedBlocks(scope: ProfileLinkScope, profile: string): LinkedBlock[] {
  const blocks: LinkedBlock[] = [];
  const { lines, headings, ends, names, owners, parents } = analyzeProfileHeadings(scope, profile);
  for (const [index, heading] of headings.entries()) {
    const owner = owners[index];
    if (!owner) continue;
    let ancestor = parents[index];
    while (ancestor >= 0 && owners[ancestor] !== owner) ancestor = parents[ancestor];
    if (ancestor >= 0) continue;
    const excluded = new Set<number>();
    for (let nested = index + 1; nested < headings.length && headings[nested].line < ends[index]; nested += 1) {
      if (names[nested] && owners[nested] !== owner) {
        for (let line = headings[nested].line; line < ends[nested]; line += 1) excluded.add(line);
      }
    }
    const text = lines.slice(heading.line, ends[index]).filter((_, offset) => !excluded.has(heading.line + offset)).join("\n").trim();
    blocks.push({ owner, heading: heading.text.replace(/[*_`]+/g, "").replace(/\s+#+\s*$/, "").trim(), text });
  }
  return blocks;
}

export function linkProfileBlocks(scope: ProfileLinkScope, profile: string): Map<string, string> {
  const linked = new Map<string, string>();
  for (const { owner, text } of linkedBlocks(scope, profile)) {
    linked.set(owner, linked.has(owner) ? `${linked.get(owner)}\n\n${text}` : text);
  }
  return linked;
}

// Every whole heading linked to each entry, so a review row can show all the
// Profile text an edit may have used.
export function linkedProfileHeadings(scope: ProfileLinkScope, profile: string): Map<string, string[]> {
  const headings = new Map<string, string[]>();
  for (const { owner, heading } of linkedBlocks(scope, profile)) {
    headings.set(owner, [...(headings.get(owner) ?? []), heading]);
  }
  return headings;
}

// Profile text under any heading that names a resume entry, linked or not.
// Such text is never suggested as missing from the resume.
export function profileTextOnResume(scope: ProfileLinkScope, profile: string): string[] {
  const { lines, headings, ends, names } = analyzeProfileHeadings(scope, profile);
  return headings.flatMap((heading, index) => (names[index] ? [lines.slice(heading.line, ends[index]).join("\n")] : []));
}
