// Local, dependency-free distiller for imported job postings.
//
// The server hands back tag-stripped text from a job page (or a known ATS JSON
// description). This helper produces two related outputs:
// - compact tailoring text for the model/review path
// - separately extracted tracking facts (role summary, location, compensation)
//
// The split matters: pay, benefits, application instructions, and legal copy are
// useful for the user's tracker, but they should not burn tokens in the resume
// tailoring prompt or steer the model toward irrelevant wording.
//
// It is best-effort and conservative. When unsure, it keeps potential role
// requirements and reports missing tracking fields so the user can fill them in
// manually instead of relying on guessed facts.

export type ExtractedSalaryPeriod = "yr" | "mo" | "hr";

export type ExtractedJobTracking = {
  title?: string;
  role?: string;
  company?: string;
  source?: string;
  location?: string;
  jobType?: string;
  workAuth?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string;
  salaryPeriod?: ExtractedSalaryPeriod;
  roleDescription?: string;
};

export type ExtractedJobPosting = {
  tailoringText: string;
  roleDescription: string;
  tracking: ExtractedJobTracking;
  manualReviewFields: string[];
  sourceTextLength: number;
};

type ExtractOptions = {
  url?: string;
  maxChars?: number;
};

// Lines that, once real content has been seen, mark the start of trailing
// boilerplate we can safely drop.
const TRAILING_BOILERPLATE: RegExp[] = [
  /^#?li-[a-z0-9]+\b/i, // LinkedIn tracking tag, e.g. "#LI-PP1"
  /^more about\b/i,
  // Narrow: "About us/the company" is trailing marketing, but "About the team/role"
  // is often a real section, so don't treat those as a cut point.
  /^about (us|the company|our company)\b/i,
  /^business unit\s*:/i,
  /^scheduled weekly hours\s*:/i,
  /^number of openings\b/i,
  /^worker type\s*:/i,
  /^primary location\s*:/i,
  /^job (req(uisition)?|posting) (id|number)\s*:/i,
  // Benefits / perks / "why join us" marketing. These are useful tracker facts
  // only when the user copies them manually; they do not help tailor a resume.
  /^(benefits|perks|our benefits|the benefits|what we offer|what['']?s in it for you)\b/i,
  /^(what you['']?ll (receive|get)|what you get|compensation (and|&) benefits)\b/i,
  /^(why (you['']?ll love|join|work)|perks (and|&) benefits)\b/i,
  // Application instructions and pay-transparency legalese.
  /^(how to apply|to apply\b|ready to apply)/i,
  /pay transparency/i,
  /\bis your place\b/i,
  /^total rewards\b/i,
  /^salary range for this position/i,
  /^the (likely|base|expected|anticipated) (salary|pay|compensation|base pay|pay range)\b/i,
  // Workday footer metadata block (label lines whose values follow on the next
  // line); cutting at the first one drops the whole trailing block.
  /^(scheduled weekly hours|travel required|telecommuting options?|additional work locations?)\s*:?\s*$/i,
  /equal opportunity employer/i,
  /equal employment opportunity/i,
  /^we are an equal\b/i,
  /\be-?verify\b/i,
  /^applicants? (with disabilities|who require)/i,
  /^(privacy|cookie) (policy|notice|statement)\b/i
];

// Standalone lines that are pure page furniture, dropped wherever they appear.
const NOISE_LINE: RegExp[] = [
  // ATS page title repeated above the real role title (e.g. Greenhouse renders
  // "Job Application for <Role> at <Company>"); a leading bullet may survive.
  // Note: extractTracking runs on rawLines and can still see this line for
  // Greenhouse company/title parsing before it's removed from tailoring lines.
  /^[•·‣◦▪●○*\-–—\s]*job application for\b/i,
  /^(apply|apply now|easy apply|quick apply|save|save job|saved|share|share this job|print|email)$/i,
  /^apply (on company website|externally|with (linkedin|indeed))$/i,
  /^(report (this )?job|flag this job)$/i,
  /^(follow us|connect with us|join our talent (community|network))$/i,
  /^(back to (search results|jobs|search)|view all jobs|see all jobs)$/i,
  /^(sign in|signin|create (an )?account|register|log ?in)$/i,
  /^(show|read|see) (more|less)$/i,
  /^we use cookies/i,
  /^(accept|accept all|reject|manage) cookies?$/i,
  /^\d+\+? (days?|hours?|weeks?|months?) ago$/i,
  /^(just posted|new)$/i,
  // Standalone salary/comp pill (e.g. "$120,000 - $150,000 / yr"). Salary is
  // extracted into tracking metadata before this line is removed from prompt text.
  /^\$?[\d,]+(\.\d+)?(k)?(\s*[-–—to]+\s*\$?[\d,]+(\.\d+)?(k)?)?(\s*(\/|per)?\s*(yr|year|hour|hr|annum|month|mo))?$/i,
  /^(home|jobs|careers|search)$/i
];

const LOW_VALUE_METADATA_LABEL: RegExp[] = [
  /^type of requisition\s*:?\s*$/i,
  /^public trust\/other required\s*:?\s*$/i,
  /^job family\s*:?\s*$/i,
  /^job qualifications\s*:?\s*$/i  // Fix #12: Workday "Job Qualifications:" label
];

const NON_TAILORING_SECTION: RegExp[] = [
  /^(compensation|salary|pay range|base pay|total rewards)\b/i,
  /^(benefits|perks|our benefits|what we offer|what['']?s in it for you)\b/i,
  /^(how to apply|application instructions|about (us|the company|our company))\b/i,
  /^(equal opportunity|eeo|privacy notice|cookie notice)\b/i
];

const TAILORING_SECTION: RegExp[] = [
  /^(job description|overview|role overview|about the role|the role|your impact)\b/i,
  /^(responsibilities|what you['']?ll do|what you will do|day to day)\b/i,
  /^you will:?\s*$/i,
  /^(requirements|qualifications|minimum qualifications|required qualifications|preferred qualifications)\b/i,
  // Fix #2 (TAILORING_SECTION): narrow "skills" and "experience" to bare heading only
  // so "Experience with Git..." and "Skills in Python" are not treated as section headings.
  /^(technical skills|what we['']?re looking for|who you are)\b/i,
  /^skills$/i,
  /^experience$/i
];

const SECTION_HEADING: RegExp[] = [...NON_TAILORING_SECTION, ...TAILORING_SECTION];

const COMPANY_CONTEXT_HEADING: RegExp[] = [
  /^company \/ product context\b/i,
  /^about (?!the role\b).+/i,
  /^about us\b/i,
  /^who we are\b/i,
  /^our company\b/i,
  /^company overview\b/i
];

// Fix #1: Added heading variants for responsibilities, required, preferred
const RESPONSIBILITY_HEADING: RegExp[] = [
  /^((core|key) )?responsibilit(y|ies)\b/i,  // Fix #1: covers "core/key responsibilities" + bare form
  /^what you['']?ll do\b/i,
  /^what you will do\b/i,
  /^your impact\b/i,
  /^you will:?\s*$/i,  // only bare "You will" or "You will:" — not "You will work alongside..."
  /^day[- ]to[- ]day\b/i,
  /^job duties\b/i,           // Fix #1: added
  /^example projects?\b/i     // Fix #1: added
];

const REQUIRED_HEADING: RegExp[] = [
  /^required qualifications?\b/i,
  /^minimum qualifications?\b/i,
  /^requirements?\b/i,
  /^qualifications?\b/i,
  /^what we['']?re looking for\b/i,
  /^who you are\b/i,
  /^required skills?\b/i,              // Fix #1: added
  /^what you[\u0027\u2018\u2019]?ll need( to succeed)?\b/i,  // Fix #1: added
  // Fix #2: narrow bare "skills" and "experience" to ONLY the standalone heading,
  // not lines like "Experience: 0-3 years…" or "Experience with Git…".
  // matchesHeading() strips a trailing colon before testing, so we anchor on the
  // stripped form (just the word itself, nothing following).
  /^skills$/i,
  /^experience$/i
];

const PREFERRED_HEADING: RegExp[] = [
  /^preferred qualifications?\b/i,
  /^preferred skills\b/i,
  /^nice[- ]to[- ]have\b/i,
  /^bonus\b/i,
  /^plus(es)?\b/i,
  /^preferred\b/i  // Fix #1: added as LAST entry so longer required variants win
];

const STRUCTURE_HEADING: RegExp[] = [
  ...COMPANY_CONTEXT_HEADING,
  ...RESPONSIBILITY_HEADING,
  ...REQUIRED_HEADING,
  ...PREFERRED_HEADING,
  ...NON_TAILORING_SECTION,
  ...TAILORING_SECTION
];

// Fix #13: C# regex — \bc#\b never matches because # is non-word; use boundary
// workaround with a lookbehind/lookahead that avoids \w on either side.
// Fix #14: Added Flask, FastAPI, Vue, Elasticsearch, Express.js, HTML, CSS
const TECH_KEYWORDS: Array<[string, RegExp]> = [
  ["JavaScript", /\bjavascript\b|\bjs\b/i],
  ["TypeScript", /\btypescript\b/i],
  ["React", /\breact(?:\.js|js)?\b/i],
  ["Node.js", /\bnode(?:\.js|js)?\b/i],
  ["Python", /\bpython\b/i],
  ["Java", /\bjava\b/i],
  ["C++", /\bc\+\+\b|\bcpp\b/i],
  ["C#", /(^|[^\w])c#(?=[^\w]|$)/i],  // Fix #13
  ["Go", /\bgolang\b|\bgo\b/i],
  ["Ruby", /\bruby\b/i],
  ["SQL", /\bsql\b/i],
  ["PostgreSQL", /\bpostgres(?:ql)?\b/i],
  ["MySQL", /\bmysql\b/i],
  ["MongoDB", /\bmongodb\b/i],
  ["Redis", /\bredis\b/i],
  ["Flask", /\bflask\b/i],            // Fix #14
  ["FastAPI", /\bfastapi\b/i],         // Fix #14
  ["Vue", /\bvue(?:\.js|js)?\b/i],     // Fix #14
  ["Elasticsearch", /\belastic(?:search)?\b/i],  // Fix #14
  ["Express.js", /\bexpress\.?js\b/i], // Fix #14: require .js suffix to avoid prose "express"
  ["HTML", /\bhtml\b/i],               // Fix #14
  ["CSS", /\bcss\b/i],                 // Fix #14
  ["AWS", /\baws\b|\bamazon web services\b/i],
  ["Azure", /\bazure\b/i],
  ["GCP", /\bgcp\b|\bgoogle cloud\b/i],
  ["Docker", /\bdocker\b/i],
  ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["REST APIs", /\brest(?:ful)? apis?\b|\bapi development\b/i],
  ["GraphQL", /\bgraphql\b/i],
  ["Microservices", /\bmicroservices?\b/i],
  ["CI/CD", /\bci\/cd\b|\bcontinuous integration\b|\bcontinuous delivery\b/i],
  // Bare "testing" is a process word ("code reviews, testing, and debugging"),
  // not a stack signal — require a concrete testing practice or framework.
  ["Testing", /\bunit test(?:s|ing)?\b|\bintegration test(?:s|ing)?\b|\bautomated test(?:s|ing)?\b|\btest[- ]driven\b|\btdd\b|\bjest\b|\bpytest\b|\bcypress\b|\bplaywright\b/i],
  ["Git", /\bgit\b|\bgithub\b|\bgitlab\b/i],
  ["Agile", /\bagile\b|\bscrum\b/i],
  ["Machine learning", /\bmachine learning\b|\bml\b/i],
  ["AI", /\bai\b|\bartificial intelligence\b|\bllm\b|\blarge language models?\b/i],
  ["Data structures", /\bdata structures?\b/i],
  ["Algorithms", /\balgorithms?\b/i]
];

const DOMAIN_SIGNALS: Array<[string, RegExp]> = [
  ["healthcare", /\bhealth(?:care)?\b|\bclinical\b|\bpatient\b|\bmedical\b/i],
  ["fintech", /\bfintech\b|\bfinancial\b|\bpayments?\b|\bbanking\b|\bcapital markets?\b|\bprivate equity\b|\binvest(?:ing|ments?)\b/i],
  ["AI", /\bai\b|\bartificial intelligence\b|\bmachine learning\b|\bllm\b/i],
  ["infrastructure", /\binfrastructure\b|\bplatform\b|\bcloud\b|\bdevops\b|\bsre\b/i],
  ["SaaS", /\bsaas\b|\bsoftware as a service\b/i],
  ["enterprise", /\benterprise\b|\bb2b\b/i],
  ["security", /\bsecurity\b|\bcybersecurity\b|\bcompliance\b|\bsoc 2\b/i],
  ["data", /\bdata\b|\banalytics\b|\bbi\b|\bwarehouse\b|\bpipeline\b/i],
  ["e-commerce", /\be-?commerce\b|\bretail\b|\bmarketplace\b/i],
  // Fix #17: narrow education domain to avoid "continuous learning" or bare "Education:" label
  ["education", /\bedtech\b|\be-?learning\b|\beducation(al)? (technology|platform|company|sector)\b/i],
  ["government", /\bgovernment\b|\bpublic sector\b|\bfederal\b/i]
];

const SOURCE_BY_HOST: Array<[RegExp, string]> = [
  [/(^|\.)linkedin\.com$/i, "LinkedIn"],
  [/(^|\.)indeed\.com$/i, "Job board"],
  [/(^|\.)greenhouse\.io$/i, "Company site"],
  [/(^|\.)lever\.co$/i, "Company site"],
  [/(^|\.)myworkdayjobs\.com$/i, "Company site"]
];

// A bullet or list marker with no real text after it — empty <li> spacers,
// icon-only items, or stray punctuation rows left over from the scraped HTML.
function isEmptyMarker(line: string): boolean {
  const stripped = line
    .replace(/^[\s•·‣◦▪●○*\-–—]+/, "")
    .replace(/^\d+[.)]\s*/, "");
  return !/[A-Za-z0-9]/.test(stripped);
}

// Curly/smart quote normalization. Uses String.fromCharCode for all quote-like
// characters to prevent editor auto-replacement of apostrophes/quotes.
// U+2018/U+2019 = left/right single quotation marks; U+201C/U+201D = double.
// U+0027 = plain apostrophe; U+0022 = plain double-quote; U+00A0 = NBSP.
const CURLY_SINGLE_RE = new RegExp(
  `[${String.fromCharCode(0x2018)}${String.fromCharCode(0x2019)}]`, `g`
);
const CURLY_DOUBLE_RE = new RegExp(
  `[${String.fromCharCode(0x201c)}${String.fromCharCode(0x201d)}]`, `g`
);
const STRAIGHT_APOSTROPHE = String.fromCharCode(0x27);
const STRAIGHT_DQUOTE = String.fromCharCode(0x22);
const NBSP = String.fromCharCode(0xa0);
const NEWLINE = String.fromCharCode(0x0a);

function normalize(raw: string): string {
  return raw
    .replace(/\r\n?/g, NEWLINE)
    .replace(new RegExp(NBSP, `g`), ` `)           // NBSP → regular space
    .replace(CURLY_SINGLE_RE, STRAIGHT_APOSTROPHE) // curly single quotes → straight
    .replace(CURLY_DOUBLE_RE, STRAIGHT_DQUOTE)     // curly double quotes → straight
    .replace(/[ \t]+/g, ` `)
    .split(NEWLINE)
    .map((line) => line.trim())
    .join(NEWLINE)
    .replace(/\n{3,}/g, `\n\n`)
    .trim();
}

function nextTextIndex(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].trim()) return i;
  }
  return -1;
}

function isMetadataLabel(line: string): boolean {
  return /^[A-Za-z][A-Za-z0-9 /&''()-]+:\s*$/.test(line.trim());
}

function isSectionHeading(line: string): boolean {
  const t = line.trim();
  return t.length > 1 && t.length <= 90 && SECTION_HEADING.some((re) => re.test(t));
}

function isStructureHeading(line: string): boolean {
  const t = line.trim().replace(/:\s*$/, "");
  return t.length > 1 && t.length <= 100 && STRUCTURE_HEADING.some((re) => re.test(t));
}

function matchesHeading(line: string, headings: RegExp[]): boolean {
  const t = line.trim().replace(/:\s*$/, "");
  return t.length > 1 && t.length <= 100 && headings.some((re) => re.test(t));
}

function isTailoringHeading(line: string): boolean {
  const t = line.trim();
  return t.length <= 90 && TAILORING_SECTION.some((re) => re.test(t));
}

function isNonTailoringHeading(line: string): boolean {
  const t = line.trim();
  return t.length <= 90 && NON_TAILORING_SECTION.some((re) => re.test(t));
}

function isLowValueLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^[-–—•·‣◦▪●○*\s]+$/.test(t)) return true;
  if (isPromptMetadataLine(t)) return true;
  return false;
}

function isPromptMetadataLine(line: string): boolean {
  return /^(company|role|title|job title|position|location|job location|employment type|job type|seniority level|experience level|job function|industries)\s*[:|]/i.test(
    line.trim()
  );
}

// Fix #8: guard against JS/template code becoming content
function isLikelyProse(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  // Quick prose check: reject lines where code-ish chars are dense. "$" is
  // deliberately excluded — comp lines like "Salary: $90k-$110k" are real
  // content; the JS-pattern test below still catches "$(...)" jQuery calls.
  const codeChars = (t.match(/[{}();=<>|]/g) ?? []).length;
  if (codeChars / t.length > 0.08) return false;
  // Reject JS-pattern lines
  if (/function\s*\(|=>|==|\bvar\s|\$\(/.test(t)) return false;
  return true;
}

function cleanSummaryLine(line: string): string {
  return line
    .replace(/^[\s•·‣◦▪●○*\-–—]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();
}

function clipSentence(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  const clipped = compact.slice(0, maxChars - 1);
  const lastStop = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf(";"), clipped.lastIndexOf(","));
  return `${(lastStop > maxChars * 0.55 ? clipped.slice(0, lastStop) : clipped).trim()}...`;
}

// Fix #10: strip compensation language only when salary/pay/benefit terms present
function stripCompensationLanguage(text: string): string {
  const chunks = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|;\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter(
      (chunk) =>
        !/\b(compensation|salary|base pay|pay range|benefits?|total rewards)\b/i.test(chunk)
    );
  return chunks.join(" ").trim();
}

// Fix #3: split run-on paragraph bullets on label boundaries before clipping
function splitRunOnBullets(line: string): string[] {
  if (line.length <= 250) return [line];
  // Split on "Label: text" boundaries (capital-letter word followed by colon)
  // Only split when the pattern appears mid-line (not at the very start)
  const parts = line.split(/(?=\b[A-Z][A-Za-z &/]{2,30}: )/);
  if (parts.length < 2) return [line];
  // Keep only chunks with >=20 chars of real content
  const valid = parts.map((p) => p.trim()).filter((p) => p.length >= 20);
  if (valid.length < 2) return [line];
  return valid;
}

function uniqueItems(items: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawItem of items) {
    // Fix #3: expand run-on bullets before clipping
    const expanded = splitRunOnBullets(rawItem);
    for (const item of expanded) {
      const cleaned = cleanSummaryLine(item)
        .replace(/^(required|preferred) qualifications?\s*:?\s*/i, "")
        .replace(/^(responsibilit(y|ies)|requirements?|skills)\s*:?\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned.length < 8) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(clipSentence(cleaned, 220));
      if (result.length >= maxItems) break;
    }
    if (result.length >= maxItems) break;
  }
  return result;
}

// Fix #4: isPreferredItem checks only the FIRST sentence of the item.
// An item is demoted to preferred only when the preferred cue appears in its
// first sentence (up to first period/semicolon). If the item has no sentence
// punctuation within 200 chars, treat the whole item as one sentence.
// This keeps multi-sentence items like "Programming Skills: ... in a full-stack
// role. Familiarity with Go Lang... is a plus." required (cue is in sentence 2),
// while correctly demoting single-sentence items that end with "is a plus".
function isPreferredItemStrict(item: string): boolean {
  const firstSentenceEnd = item.search(/[.;]/);
  // Use the full first sentence; no arbitrary char limit
  const checkWindow = firstSentenceEnd > 0
    ? item.slice(0, firstSentenceEnd + 1)
    : item;
  return /\b(preferred|nice[- ]to[- ]have|bonus|plus)\b/i.test(checkWindow);
}

function isListLikeContent(line: string): boolean {
  const t = cleanSummaryLine(line);
  if (t.length < 8) return false;
  if (isPromptMetadataLine(t) || isStructureHeading(t) || isEmptyMarker(t)) return false;
  // Bare "Label:" lines produced by Workday reflow or other ATS sources are not content
  if (isMetadataLabel(t)) return false;
  if (/salary|compensation|benefits|equal opportunity|privacy|cookies?|apply now/i.test(t)) return false;
  return true;
}

function collectUnderHeadings(lines: string[], headings: RegExp[], maxItems: number): string[] {
  const collected: string[] = [];
  let active = false;

  for (const line of lines) {
    const t = cleanSummaryLine(line);
    if (!t) continue;
    if (matchesHeading(t, headings)) {
      active = true;
      continue;
    }
    if (active && isStructureHeading(t)) {
      active = false;
      continue;
    }
    if (!active || !isListLikeContent(t)) continue;
    collected.push(t);
    if (collected.length >= maxItems * 2) break;
  }

  return uniqueItems(collected, maxItems);
}

function fallbackItems(lines: string[], patterns: RegExp[], maxItems: number): string[] {
  return uniqueItems(
    lines.filter((line) => {
      const t = cleanSummaryLine(line);
      // Fix #9: exclude structure headings from fallback collection
      if (isStructureHeading(t)) return false;
      return isListLikeContent(t) && patterns.some((re) => re.test(t));
    }),
    maxItems
  );
}

function bulletLines(items: string[], emptyText: string): string[] {
  return (items.length ? items : [emptyText]).map((item) => `- ${item}`);
}

// Fix #12: Workday merged label/value lines — split trailing label off
// Only applies to a fixed safe set of known Workday field names appearing at
// line end after other text.
const WORKDAY_TRAILING_LABELS =
  /\b(Experience|Certifications?|US Citizenship Required|Education|Travel Required|Clearance Level[^:]{0,30})\s*:\s*$/i;

function splitWorkdayTrailingLabel(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    const match = line.match(WORKDAY_TRAILING_LABELS);
    // Only split when there is content BEFORE the trailing label
    if (match && match.index !== undefined && match.index > 0) {
      const before = line.slice(0, match.index).trim();
      const label = match[0].trim();
      if (before) {
        result.push(before);
        result.push(label);
        continue;
      }
    }
    result.push(line);
  }
  return result;
}

function removeLowValueMetadata(lines: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!LOW_VALUE_METADATA_LABEL.some((re) => re.test(t))) {
      result.push(lines[i]);
      continue;
    }

    const valueIndex = nextTextIndex(lines, i + 1);
    if (valueIndex === -1) continue;
    i = isMetadataLabel(lines[valueIndex]) ? valueIndex - 1 : valueIndex;
  }
  return result;
}

function removeDuplicateClearanceMetadata(lines: string[]): string[] {
  const currentLabelIndex = lines.findIndex((line) =>
    /^clearance level must currently possess\s*:?\s*$/i.test(line.trim())
  );
  const ableLabelIndex = lines.findIndex((line) =>
    /^clearance level must be able to obtain\s*:?\s*$/i.test(line.trim())
  );
  if (currentLabelIndex === -1 || ableLabelIndex === -1) return lines;

  const currentValueIndex = nextTextIndex(lines, currentLabelIndex + 1);
  const ableValueIndex = nextTextIndex(lines, ableLabelIndex + 1);
  if (currentValueIndex === -1 || ableValueIndex === -1) return lines;

  const currentValue = lines[currentValueIndex].trim().toLowerCase();
  const ableValue = lines[ableValueIndex].trim().toLowerCase();
  if (!currentValue || currentValue !== ableValue) return lines;

  return lines.filter((_, index) => index !== ableLabelIndex && index !== ableValueIndex);
}

function removePreDescriptionMarketing(lines: string[]): string[] {
  const firstDescription = lines.findIndex((line) => /^job description\s*:?\s*$/i.test(line.trim()));
  if (firstDescription === -1) return lines;

  const secondDescription = lines.findIndex(
    (line, index) => index > firstDescription && /^job description\s*:?\s*$/i.test(line.trim())
  );
  if (secondDescription === -1 || secondDescription - firstDescription > 12) return lines;

  const segment = lines.slice(firstDescription, secondDescription).join("\n");
  const looksLikeMarketing =
    /^our company$/im.test(segment) ||
    (/^your impact$/im.test(segment) && /own your opportunity to/i.test(segment));
  if (!looksLikeMarketing) return lines;

  return [...lines.slice(0, firstDescription), ...lines.slice(secondDescription)];
}

function removeWorkdayFurniture(lines: string[]): string[] {
  // Fix #12: split trailing labels before other Workday cleanup
  const reflowed = splitWorkdayTrailingLabel(lines);
  return removePreDescriptionMarketing(removeDuplicateClearanceMetadata(removeLowValueMetadata(reflowed)));
}

function removeNonTailoringSections(lines: string[]): string[] {
  const result: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (!skipping) result.push(line);
      continue;
    }

    if (isNonTailoringHeading(t)) {
      skipping = true;
      continue;
    }

    if (skipping && isTailoringHeading(t)) {
      skipping = false;
      result.push(line);
      continue;
    }

    if (!skipping) result.push(line);
  }

  return result;
}

function compactDuplicateLines(lines: string[]): string[] {
  const deduped: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t && t === deduped[deduped.length - 1]?.trim()) continue;
    deduped.push(line);
  }
  return deduped;
}

function cutTrailingBoilerplate(lines: string[]): string[] {
  let cut = lines.length;
  let contentSeen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    // Test against content seen on PRIOR lines, so the very first line can never
    // be treated as trailing boilerplate (which would cut everything to "").
    if (t && contentSeen > 400 && TRAILING_BOILERPLATE.some((re) => re.test(t))) {
      cut = i;
      break;
    }
    if (t) contentSeen += t.length;
  }
  return lines.slice(0, cut);
}

function valueForLabel(lines: string[], labels: string[]): string {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sameLine = line.match(new RegExp(`^${escaped}\\s*(?:[:|]|-)\\s*(.+)$`, "i"));
      if (sameLine?.[1]?.trim()) return sameLine[1].trim();

      if (new RegExp(`^${escaped}\\s*:?$`, "i").test(line)) {
        const next = nextTextIndex(lines, i + 1);
        if (next !== -1) return lines[next].trim();
      }
    }
  }
  return "";
}

function parseLinkedInTitleLine(lines: string[]) {
  const titleLine = lines.find((line) => /\bhiring\b/i.test(line) && /\|\s*linkedin\b/i.test(line));
  const match = titleLine?.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+(.+?)\s*\|\s*linkedin\b/i);
  if (!match) return {};
  return {
    company: match[1].trim(),
    title: match[2].trim(),
    location: match[3].trim()
  };
}

function sourceFromUrl(rawUrl?: string): string {
  if (!rawUrl) return "";
  try {
    const host = new URL(rawUrl).hostname;
    return SOURCE_BY_HOST.find(([re]) => re.test(host))?.[1] ?? "";
  } catch {
    return "";
  }
}

function normalizeJobType(value: string): string {
  const t = value.trim();
  if (!t) return "";
  if (/full[-\s]?time/i.test(t)) return "Full-time";
  if (/part[-\s]?time/i.test(t)) return "Part-time";
  if (/contract/i.test(t)) return "Contract";
  if (/intern(ship)?/i.test(t)) return "Internship";
  if (/temporary|temp/i.test(t)) return "Temporary";
  return t.slice(0, 60);
}

function parseAmount(value: string): number {
  const raw = value.trim();
  const hasK = /k$/i.test(raw.replace(/\s+/g, ""));
  const parsed = Number(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(hasK ? parsed * 1000 : parsed);
}

function normalizePeriod(value: string): ExtractedSalaryPeriod | undefined {
  if (/^(hour|hr)$/i.test(value)) return "hr";
  if (/^(month|mo)$/i.test(value)) return "mo";
  if (/^(year|yr|annum|annual|annually)$/i.test(value)) return "yr";
  return undefined;
}

function extractSalary(lines: string[]): Pick<
  ExtractedJobTracking,
  "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod"
> {
  const candidates: Array<{
    min: number;
    max: number | null;
    period?: ExtractedSalaryPeriod;
    score: number;
  }> = [];
  const money =
    /(?:\b(USD|US\$)\s*)?(\$)?\s*(\d[\d,.]*(?:\s?[kK])?)(?:\s*(?:-|–|—|to)\s*(?:USD|US\$|\$)?\s*(\d[\d,.]*(?:\s?[kK])?))?(?:\s*(?:\/|per)?\s*(year|yr|annum|annual|annually|hour|hr|month|mo))?/gi;

  for (let i = 0; i < lines.length; i += 1) {
    const context = [lines[i - 1], lines[i], lines[i + 1]].filter(Boolean).join(" ");
    const compContext = /salary|compensation|base pay|pay range|total rewards/i.test(context);
    for (const match of context.matchAll(money)) {
      const min = parseAmount(match[3] ?? "");
      const max = match[4] ? parseAmount(match[4]) : null;
      const period = normalizePeriod(match[5] ?? "");
      if (!min) continue;

      // Anti-fabrication gate: a bare number ("10,000 employees", "50,000 users")
      // is never a salary. Require an explicit currency token or comp wording
      // near the match before treating it as compensation.
      const currency = Boolean(match[1] || match[2]);
      if (!currency && !compContext) continue;

      const highValue = min >= 1000 || (max ?? 0) >= 1000;
      const hourly = period === "hr" && min >= 8 && min <= 500;
      if (!highValue && !hourly) continue;

      const range = max !== null && max !== min;
      let score = 0;
      if (compContext) score += 5;
      if (range) score += 4;
      if (period) score += 2;
      if (highValue || hourly) score += 1;
      candidates.push({ min, max, period, score });
    }
  }

  const best = candidates.sort((a, b) => b.score - a.score || (b.max ?? b.min) - (a.max ?? a.min))[0];
  if (!best) return {};

  const min = best.max !== null && best.max < best.min ? best.max : best.min;
  const max = best.max !== null && best.max < best.min ? best.min : best.max;
  return {
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: "USD",
    salaryPeriod: best.period ?? (min >= 1000 ? "yr" : undefined)
  };
}

// EEO / application-form boilerplate to skip in workAuth extraction
const WORK_AUTH_SKIP: RegExp[] = [
  /equal opportunity|without regard|protected veteran/i,
  /select\.{3}|select\.\.\./i  // form dropdown widgets
];

// Bare metadata label lines (just a label ending with colon, no value):
// not suitable as a workAuth answer.
function isBareLabelLine(line: string): boolean {
  const t = line.trim();
  // Matches "Label:" or "Label: " with nothing of substance after the colon
  return /^[A-Za-z][A-Za-z0-9 /&''().-]+:\s*$/.test(t);
}

// Prefer lines that clearly state a MUST/REQUIRED stance
const WORK_AUTH_STRONG: RegExp = /\b(must|required?|only|unable|cannot)\b/i;

// Fix #6: extended workAuth extraction with sponsor/visa/citizen/clearance variants,
// EEO boilerplate filtering, and preference for "must/required" lines.
// When a matching line is an EEO paragraph that also contains a real auth sentence,
// split it into sentences and extract the relevant sentence.
function extractWorkAuth(lines: string[]): string {
  const AUTH_PATTERN =
    /\b(sponsor(?:ship)?|visas?|citizens?(?:hip)?|work authorization|authorized to work|employment authorization|(?:security )?clearance)\b/i;

  // Collect candidate lines or individual sentences from lines
  const candidates: string[] = [];

  for (const entry of lines) {
    if (!AUTH_PATTERN.test(entry)) continue;
    if (isBareLabelLine(entry)) continue;

    if (WORK_AUTH_SKIP.some((re) => re.test(entry))) {
      // The line itself has EEO boilerplate — but it may contain a real auth
      // sentence embedded. Split and check individual sentences.
      const sentences = entry
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 20);
      for (const sentence of sentences) {
        if (
          AUTH_PATTERN.test(sentence) &&
          !WORK_AUTH_SKIP.some((re) => re.test(sentence))
        ) {
          candidates.push(sentence);
        }
      }
    } else {
      candidates.push(entry);
    }
  }

  if (!candidates.length) return "";

  // Prefer lines with a strong mandatory signal
  const strong = candidates.find((c) => WORK_AUTH_STRONG.test(c));
  const chosen = strong ?? candidates[0];
  return clipSentence(cleanSummaryLine(chosen), 220);
}

function extractReviewMetadata(lines: string[]) {
  return {
    seniority: valueForLabel(lines, ["Seniority level", "Experience level"]),
    // Fix #5e: added "Working Schedule" to jobType label list
    employmentType: valueForLabel(lines, ["Employment type", "Job type", "Working Schedule"]),
    jobFunction: valueForLabel(lines, ["Job function"]),
    industries: valueForLabel(lines, ["Industries"])
  };
}

function extractTracking(lines: string[], url?: string): ExtractedJobTracking {
  const linkedInTitle = parseLinkedInTitleLine(lines);
  // Fix #5e: added "Work Location" to location label list
  const title =
    valueForLabel(lines, ["Role", "Title", "Job title", "Position"]) ||
    linkedInTitle.title ||
    "";
  const company = valueForLabel(lines, ["Company", "Organization", "Employer"]) || linkedInTitle.company || "";
  const location =
    valueForLabel(lines, ["Location", "Job location", "Primary location", "Work Location"]) ||
    linkedInTitle.location ||
    "";
  const employmentType = valueForLabel(lines, ["Employment type", "Job type", "Working Schedule"]);
  const roleDescription = buildRoleDescription(lines);

  // --- Tracking fallbacks (Fix #5) ---

  // Resolved title/company from primary paths
  let resolvedTitle = title;
  let resolvedCompany = company;
  let resolvedLocation = location;

  // Fix #5b: Workday "Title · Location" first-line pattern
  // First non-empty raw line containing " · " → split on first " · ".
  // Both halves must look like real values, not breadcrumbs/ratings — a wrong
  // guess here would invent a job fact, so reject anything chrome-shaped.
  if (!resolvedTitle || !resolvedLocation) {
    const looksLikeChrome = (value: string) =>
      NOISE_LINE.some((re) => re.test(value)) ||
      isPromptMetadataLine(value) ||
      /^(home|careers?|jobs?|search|menu|about|help)$/i.test(value) ||
      /\b(stars?|reviews?|ratings?)\b/i.test(value) ||
      !/^[A-Za-z]/.test(value);
    const firstNonEmpty = lines.find((l) => l.trim().length > 0);
    if (firstNonEmpty) {
      const dotIdx = firstNonEmpty.indexOf(" · ");
      if (dotIdx !== -1) {
        const titlePart = firstNonEmpty.slice(0, dotIdx).trim();
        const locPart = firstNonEmpty.slice(dotIdx + 3).trim();
        if (
          titlePart.length >= 2 &&
          titlePart.length <= 120 &&
          locPart.length >= 1 &&
          locPart.length <= 80 &&
          !titlePart.includes(": ") &&
          !locPart.includes(": ") &&
          !looksLikeChrome(titlePart) &&
          !looksLikeChrome(locPart)
        ) {
          if (!resolvedTitle) resolvedTitle = titlePart;
          if (!resolvedLocation) resolvedLocation = locPart;
        }
      }
    }
  }

  // Fix #5a: Greenhouse "Job Application for <Title> at <Company>" line
  // NOISE_LINE removes this from tailoring lines but extractTracking sees rawLines
  if (!resolvedTitle || !resolvedCompany) {
    for (const line of lines) {
      const m = line.match(/job application for (.+?) at (.+)/i);
      if (m) {
        if (!resolvedTitle) resolvedTitle = m[1].trim();
        if (!resolvedCompany) resolvedCompany = m[2].trim();
        break;
      }
    }
  }

  // Fix #5c: Generic title fallback — first raw line 8-70 chars, no sentence
  // punctuation, not furniture, reappears later in the document (case-insensitive).
  // Secondary: a short non-furniture line immediately before a section/metadata heading
  // (page H1 pattern: <title> then <General Information> etc.).
  if (!resolvedTitle) {
    const lowerLines = lines.map((l) => l.trim().toLowerCase());
    let proximityCandidate: string | undefined;

    for (let i = 0; i < lines.length; i += 1) {
      const candidate = lines[i].trim();
      if (!candidate) continue;
      if (candidate.length < 8 || candidate.length > 70) continue;
      if (/[.!?;,]/.test(candidate)) continue;
      // Skip common page-chrome / navigation strings that aren't job titles
      if (/^(skip to (content|main)|accessibility|navigation|menu|home|page|click here|log(in| in)|register|sign up|get started|contact( us)?|learn more|view (all|more)|search|explore|discover|download|browse)\b/i.test(candidate)) continue;
      if (
        NOISE_LINE.some((re) => re.test(candidate)) ||
        isPromptMetadataLine(candidate) ||
        isStructureHeading(candidate) ||
        isEmptyMarker(candidate)
      ) continue;

      const lc = candidate.toLowerCase();
      // Preferred: reappears later
      const reappears = lowerLines.slice(i + 1).some((l) => l === lc);
      if (reappears) {
        resolvedTitle = candidate;
        break;
      }

      // Secondary: appears immediately before a section/metadata heading or
      // page furniture (short title-case/caps section header like "General Information")
      if (!proximityCandidate) {
        for (let j = i + 1; j < lines.length; j += 1) {
          const next = lines[j].trim();
          if (!next) continue;
          const isSectionLike =
            isStructureHeading(next) ||
            isMetadataLabel(next) ||
            // short heading-like line: 3-40 chars, no lower-case-start, no sentence punct
            (next.length >= 3 && next.length <= 40 && /^[A-Z]/.test(next) && !/[.!?;]/.test(next));
          if (isSectionLike) {
            proximityCandidate = candidate;
          }
          break; // only look at the very next non-empty line
        }
      }
    }

    // Use proximity candidate only if no reappear match was found
    if (!resolvedTitle && proximityCandidate) {
      resolvedTitle = proximityCandidate;
    }
  }

  // Fix #5d: Company fallback — "About <CompanyName>" heading where the name
  // is not a generic placeholder phrase. The captured name must start with a
  // real uppercase letter (the heading match itself is case-insensitive, so
  // without this check "about our team" would capture "our team" as a company).
  if (!resolvedCompany) {
    const GENERIC_ABOUT =
      /^(us|you|me|our (company|team)|the (company|role|team|job|position|opportunity)|this (role|job|position|opportunity)|working here)$/i;
    for (const line of lines) {
      const m = line.trim().match(/^about ([A-Z][\w.&' -]{1,40})$/i);
      const name = m?.[1].trim() ?? "";
      if (name && /^[A-Z]/.test(name) && !GENERIC_ABOUT.test(name)) {
        resolvedCompany = name;
        break;
      }
    }
  }

  return {
    title: resolvedTitle ? resolvedTitle.slice(0, 200) : undefined,
    role: resolvedTitle ? resolvedTitle.slice(0, 200) : undefined,
    company: resolvedCompany ? resolvedCompany.slice(0, 200) : undefined,
    source: sourceFromUrl(url) || undefined,
    location: resolvedLocation ? resolvedLocation.slice(0, 200) : undefined,
    jobType: normalizeJobType(employmentType) || undefined,
    workAuth: extractWorkAuth(lines) || undefined,
    ...extractSalary(lines),
    roleDescription: roleDescription || undefined
  };
}

// Fix #7: buildRoleDescription — skip intro candidates that are <60 chars or
// match isStructureHeading; append subsequent lines when sentence is incomplete;
// Fix #8: skip lines that fail isLikelyProse
function buildRoleDescription(lines: string[], maxChars = 900): string {
  const collectFrom = (start: number) => {
    const picked: string[] = [];
    for (let i = start; i < lines.length && picked.join(" ").length < maxChars; i += 1) {
      const line = cleanSummaryLine(lines[i]);
      if (!line) continue;
      if (isNonTailoringHeading(line)) break;
      if (picked.length && isSectionHeading(line)) break;
      if (isLowValueLine(line) || /^about [A-Z0-9][\w .&-]{1,80}$/i.test(line)) continue;
      if (/salary|compensation|benefits|equal opportunity|privacy/i.test(line)) continue;
      // Fix #8: skip JS/template junk
      if (!isLikelyProse(line)) continue;
      picked.push(line);
      if (picked.length >= 4) break;
    }
    const joined = picked.join(" ");
    return clipSentence(joined, maxChars);
  };

  // Collect lines into a complete sentence (ending with punctuation),
  // appending subsequent non-heading lines if the picked text doesn't end with
  // sentence-ending punctuation. Bounded by maxChars.
  const collectUntilSentence = (start: number) => {
    const picked: string[] = [];
    for (let i = start; i < lines.length; i += 1) {
      const line = cleanSummaryLine(lines[i]);
      if (!line) continue;
      if (isNonTailoringHeading(line)) break;
      if (picked.length && isSectionHeading(line)) break;
      if (isLowValueLine(line) || /^about [A-Z0-9][\w .&-]{1,80}$/i.test(line)) {
        if (picked.length) break; // stop collecting if we have something
        continue;
      }
      if (/salary|compensation|benefits|equal opportunity|privacy/i.test(line)) break;
      if (!isLikelyProse(line)) break;
      picked.push(line);
      const joined = picked.join(" ");
      if (joined.length >= maxChars) break;
      // If we have a complete sentence, stop
      if (/[.!?]$/.test(line.trim())) break;
      if (picked.length >= 6) break; // safety cap
    }
    return clipSentence(picked.join(" "), maxChars);
  };

  const introHeading = lines.findIndex((line) =>
    /^(about the role|the role|role overview|overview|job description|your impact)\b/i.test(line.trim())
  );
  if (introHeading !== -1) {
    const text = collectFrom(introHeading + 1);
    if (text.length > 80) return text;
  }

  const introLine = lines.find((line) => {
    const cleaned = cleanSummaryLine(line);
    // Fix #7: skip short or heading-like intro lines
    if (cleaned.length < 60) return false;
    if (isStructureHeading(cleaned)) return false;
    if (!isLikelyProse(cleaned)) return false;
    // Must start with an uppercase letter (prevents picking up continuation fragments)
    if (!/^[A-Z]/.test(cleaned)) return false;
    return /\b(we are looking for|we are seeking|you will|this role|in this role|join .* as|responsible for)\b/i.test(line);
  });
  if (introLine) {
    const idx = lines.indexOf(introLine);
    return collectUntilSentence(idx);
  }

  const responsibilities = lines.findIndex((line) =>
    /^(responsibilities|what you['']?ll do|what you will do|your impact|you will)\b/i.test(line.trim())
  );
  if (responsibilities !== -1) {
    const text = collectFrom(responsibilities + 1);
    if (text.length > 60) return text;
  }

  const firstUseful = lines.findIndex((line) => {
    const cleaned = cleanSummaryLine(line);
    // Fix #7: must be >=60 chars, not a structure heading, and be prose
    return cleaned.length >= 60 && !isLowValueLine(cleaned) && !isSectionHeading(cleaned) && isLikelyProse(cleaned);
  });
  return firstUseful === -1 ? "" : collectUntilSentence(firstUseful);
}

function buildTailoringLines(lines: string[]): string[] {
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (isEmptyMarker(t)) return false;
    if (isPromptMetadataLine(t)) return false;
    return !NOISE_LINE.some((re) => re.test(t));
  });

  return compactDuplicateLines(
    cutTrailingBoilerplate(removeNonTailoringSections(removeWorkdayFurniture(kept)))
  );
}

// Fix #11: extractCompanyProductContext — prefer tailoring lines over rawLines
function extractCompanyProductContext(
  tailoringLines: string[],
  rawLines: string[],
  tracking: ExtractedJobTracking
): string {
  // Try tailoring lines first
  const fromHeadingTailoring = collectUnderHeadings(tailoringLines, COMPANY_CONTEXT_HEADING, 3);
  const headingContextTailoring = stripCompensationLanguage(fromHeadingTailoring.join(" "));
  if (headingContextTailoring) {
    // Fix #8: guard against prose
    if (isLikelyProse(headingContextTailoring)) {
      return clipSentence(headingContextTailoring, 520);
    }
  }

  // Fall back to rawLines
  const fromHeading = collectUnderHeadings(rawLines, COMPANY_CONTEXT_HEADING, 3);
  const headingContext = stripCompensationLanguage(fromHeading.join(" "));
  if (headingContext && isLikelyProse(headingContext)) return clipSentence(headingContext, 520);

  if (tracking.roleDescription && isLikelyProse(tracking.roleDescription)) {
    return clipSentence(stripCompensationLanguage(tracking.roleDescription), 520);
  }
  return "";
}

// Fix #18: caps: responsibilities 7→8, preferred 6→9
function extractResponsibilities(lines: string[]): string[] {
  const fromSections = collectUnderHeadings(lines, RESPONSIBILITY_HEADING, 8);  // Fix #18: 7→8
  if (fromSections.length) return fromSections;
  // Fix #9: extended fallback verbs with gerund forms and assist/contribute/participate/help
  return fallbackItems(
    lines,
    [
      /\b(you will|responsible for|build(?:ing)?|develop(?:ing)?|design(?:ing)?|implement(?:ing)?|maintain(?:ing)?|collaborate|own|support|ship|debug|test|assist|contribute|participate|help)\b/i
    ],
    6
  );
}

function extractQualifications(lines: string[]) {
  const requiredRaw = collectUnderHeadings(lines, REQUIRED_HEADING, 12);
  // Fix #4: use strict preferred check (first ~40 chars / first sentence only)
  const preferredRaw = [
    ...collectUnderHeadings(lines, PREFERRED_HEADING, 9),  // Fix #18: 6→9
    ...requiredRaw.filter(isPreferredItemStrict)
  ];
  const required = requiredRaw.filter((item) => !isPreferredItemStrict(item));
  const requiredFallback = required.length
    ? []
    : fallbackItems(
        lines,
        [
          /\b(required|must|need|qualification|experience with|proficient|proficiency|knowledge of|years? of experience)\b/i
        ],
        8
      );

  return {
    required: uniqueItems([...required, ...requiredFallback], 8),
    preferred: uniqueItems(preferredRaw, 9)  // Fix #18: 6→9
  };
}

function extractTechKeywords(lines: string[], tracking: ExtractedJobTracking): string[] {
  const source = [
    tracking.title,
    tracking.roleDescription,
    ...lines
  ]
    .filter(Boolean)
    .join("\n");
  return TECH_KEYWORDS.filter(([, re]) => re.test(source)).map(([label]) => label).slice(0, 14);
}

// Fix #15: years regex must handle en/em dashes, and only count when within
// ~40 chars of "experience"/"exp"; "over 50 years" of company history skipped.
// Fix #16: "senior" only from title or seniority metadata, not anywhere in body.
function extractSenioritySignals(
  lines: string[],
  tracking: ExtractedJobTracking,
  reviewMetadata: ReturnType<typeof extractReviewMetadata>
): string[] {
  // Fix #16: only use title + reviewMetadata for senior signal, not all lines
  const titleAndMeta = [tracking.title, reviewMetadata.seniority].filter(Boolean).join("\n");
  // Full source still used for junior/years signals but NOT for "senior"
  const source = [tracking.title, reviewMetadata.seniority, ...lines].filter(Boolean).join("\n");
  const signals: string[] = [];
  const add = (value: string) => {
    if (!signals.some((existing) => existing.toLowerCase() === value.toLowerCase())) signals.push(value);
  };

  if (reviewMetadata.seniority) add(reviewMetadata.seniority);
  // Skip the synthetic junior tag when explicit metadata already says it
  // ("Entry level" + "entry-level / junior" reads as a duplicate).
  if (
    !signals.some((existing) => /\b(entry|junior|new grad)\b/i.test(existing)) &&
    /\b(entry[- ]level|new grad|early career|junior|jr\.?)\b/i.test(source)
  ) {
    add("entry-level / junior");
  }

  // Fix #15: match en/em dashes in year ranges; require "experience"/"exp" context within 40 chars
  const yearsPattern = /(\d+(?:[+]|\s*(?:-|–|—|to)\s*\d+[+]?)?\s*(?:\+\s*)?years?)/gi;
  const yearsMatches: string[] = [];
  for (const match of source.matchAll(yearsPattern)) {
    const start = match.index ?? 0;
    // Check ~40-char window around the match for experience context
    const window = source.slice(Math.max(0, start - 40), start + match[0].length + 40);
    if (!/\bexp(?:erience)?\b/i.test(window)) continue;
    // Skip "over N years" of company history heuristic — if number is large (>20)
    // and context mentions "company"/"investing"/"operating"
    if (/\b(company|invest|operat|collect)\b/i.test(window) && parseInt(match[0]) > 20) continue;
    const normalized = match[1].replace(/\s+/g, " ").trim();
    yearsMatches.push(normalized);
    if (yearsMatches.length >= 3) break;
  }
  yearsMatches.forEach(add);

  // Fix #16: senior only from title/metadata
  if (/\bsenior\b|\bsr\.?\b/i.test(titleAndMeta)) add("senior");

  if (/\blead\b|\bleadership\b|\bmentor\b|\bmanage\b|\bmanager\b/i.test(source)) add("leadership");
  if (/\bown\b|\bownership\b|\bend-to-end\b|\bdrive\b/i.test(source)) add("ownership");
  return signals.slice(0, 6);
}

function extractDomainSignals(
  tracking: ExtractedJobTracking,
  reviewMetadata: ReturnType<typeof extractReviewMetadata>,
  companyContext: string
): string[] {
  // Domain signals describe what the company/product is about, so they are
  // read only from company-identity surfaces (company, title, role summary,
  // company context, Industries metadata) — never from the full JD body, where
  // a passing mention ("a database of healthcare providers" as one duty)
  // would masquerade as the company's domain.
  const source = [
    tracking.company,
    tracking.title,
    tracking.roleDescription,
    reviewMetadata.industries,
    companyContext
  ]
    .filter(Boolean)
    .join("\n");
  return DOMAIN_SIGNALS.filter(([, re]) => re.test(source)).map(([label]) => label).slice(0, 8);
}

function buildStructuredTailoringText(
  rawLines: string[],
  tracking: ExtractedJobTracking,
  reviewMetadata: ReturnType<typeof extractReviewMetadata>,
  maxChars: number
): string {
  const tailoringLines = buildTailoringLines(rawLines);
  // Fix #11: pass tailoringLines first, fall back to rawLines in extractCompanyProductContext
  const context = extractCompanyProductContext(tailoringLines, rawLines, tracking);
  const responsibilities = extractResponsibilities(tailoringLines);
  const { required, preferred } = extractQualifications(tailoringLines);
  const tech = extractTechKeywords(tailoringLines, tracking);
  const seniority = extractSenioritySignals(tailoringLines, tracking, reviewMetadata);
  const domains = extractDomainSignals(tracking, reviewMetadata, context);
  const title = tracking.title || tracking.role || "";

  const sections = [
    `Job Title:\n${title || "[manual input needed: job title]"}`,
    `Company / Product Context:\n${context || "[manual input needed: 1-3 sentence company or product summary]"}`,
    ["Core Responsibilities:", ...bulletLines(responsibilities, "[manual input needed: core responsibilities]")].join("\n"),
    ["Required Qualifications:", ...bulletLines(required, "[manual input needed: required qualifications]")].join("\n"),
    ["Preferred Qualifications:", ...bulletLines(preferred, "Not specified")].join("\n"),
    ["Tech Stack / Keywords:", ...bulletLines(tech, "[manual input needed: tech stack or keywords]")].join("\n"),
    ["Seniority Signals:", ...bulletLines(seniority, "Not specified")].join("\n"),
    ["Domain Signals:", ...bulletLines(domains, "Not specified")].join("\n")
  ];

  return normalize(sections.join("\n\n")).slice(0, maxChars);
}

function manualReviewFields(result: ExtractedJobPosting): string[] {
  const fields: string[] = [];
  const tt = result.tailoringText;
  // Fix #8: also push "job description" when responsibilities AND required quals
  // AND tech keywords are all placeholders (garbage page detection)
  const allPlaceholders =
    /\[manual input needed: core responsibilities\]/i.test(tt) &&
    /\[manual input needed: required qualifications\]/i.test(tt) &&
    /\[manual input needed: tech stack or keywords\]/i.test(tt);
  if (result.tailoringText.trim().length < 40 || allPlaceholders) fields.push("job description");
  if (!result.tracking.title && !result.tracking.role) fields.push("role title");
  if (!result.tracking.company) fields.push("company");
  if (!result.roleDescription) fields.push("role summary");
  if (!result.tracking.location) fields.push("location");
  if (result.tracking.salaryMin == null && result.tracking.salaryMax == null) fields.push("compensation");
  if (/\[manual input needed: core responsibilities\]/i.test(tt)) fields.push("responsibilities");
  if (/\[manual input needed: required qualifications\]/i.test(tt)) fields.push("required qualifications");
  if (/\[manual input needed: tech stack or keywords\]/i.test(tt)) fields.push("tech stack keywords");
  return fields;
}

export function extractJobPosting(raw: string, options: ExtractOptions = {}): ExtractedJobPosting {
  const cleaned = normalize(String(raw ?? ""));
  if (!cleaned) {
    return {
      tailoringText: "",
      roleDescription: "",
      tracking: sourceFromUrl(options.url) ? { source: sourceFromUrl(options.url) } : {},
      manualReviewFields: ["job description", "role title", "company", "role summary", "location", "compensation"],
      sourceTextLength: 0
    };
  }

  // Apply Workday trailing-label split at the rawLines level so that
  // extractTracking (and workAuth in particular) sees the clean split form.
  const rawLines = splitWorkdayTrailingLabel(cleaned.split("\n"));
  const tracking = extractTracking(rawLines, options.url);
  const reviewMetadata = extractReviewMetadata(rawLines);
  const maxChars = options.maxChars ?? 9_000;
  const tailoringText = buildStructuredTailoringText(rawLines, tracking, reviewMetadata, maxChars);
  const roleDescription = tracking.roleDescription ?? "";
  const result: ExtractedJobPosting = {
    tailoringText,
    roleDescription,
    tracking,
    manualReviewFields: [],
    sourceTextLength: cleaned.length
  };
  result.manualReviewFields = manualReviewFields(result);
  return result;
}

export function extractRelevantJobText(raw: string, maxChars = 9_000): string {
  return extractJobPosting(raw, { maxChars }).tailoringText;
}
