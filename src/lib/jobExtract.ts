// Local, dependency-free distiller for imported job postings.
//
// The server hands back tag-stripped text from a job page (or a Workday CXS
// description). This helper trims that down to the parts worth feeding the
// model — the role intro, responsibilities, and qualifications — by dropping
// standalone UI noise (Apply/Save/cookie banners), empty bullets and blank
// rows left over from the HTML, and the trailing boilerplate that pads most
// postings (ATS metadata, "More about the company" marketing, benefits/perks,
// EEO/legal statements) — none of which help the model tailor a résumé.
//
// It is best-effort and conservative: it only cuts a trailing section once it
// has already seen a meaningful amount of content, so it won't truncate a short
// posting or an intro that happens to look like boilerplate. When unsure it
// keeps text rather than risk discarding real requirements — the UI tells the
// user to review the result before polishing.

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
  // Benefits / perks / "why join us" marketing — real, but not what the model
  // tailors a résumé against, and almost always near the end of a posting.
  // ['’] tolerates both straight and curly apostrophes from scraped text.
  /^(benefits|perks|our benefits|the benefits|what we offer|what['’]?s in it for you)\b/i,
  /^(what you['’]?ll (receive|get)|what you get|compensation (and|&) benefits)\b/i,
  /^(why (you['’]?ll love|join|work)|perks (and|&) benefits)\b/i,
  // Application instructions and pay-transparency legalese.
  /^(how to apply|to apply\b|ready to apply)/i,
  /pay transparency/i,
  // Closing marketing / culture CTAs and salary/benefits prose that trail the
  // real requirements — common on Workday / large-employer postings, and they
  // sit above the EEO line so the EEO cut alone misses them. Match the culture
  // *header* line, not generic CTA verbs like "own your opportunity" that also
  // open many postings ("YOUR IMPACT / Own your opportunity to ...").
  /\bis your place\b/i, // "<Company> IS YOUR PLACE" culture block (cuts the
  // following Growth/Support/Rewards/Community perks + closing CTA with it)
  /^total rewards\b/i,
  /salary range for this position/i,
  /^the (likely|base|expected|anticipated) (salary|pay|compensation|base pay|pay range)\b/i,
  // Workday footer metadata block (label lines whose values follow on the next
  // line); cutting at the first one drops the whole trailing block.
  /^(scheduled weekly hours|travel required|telecommuting options?|work location|additional work locations?)\s*:?\s*$/i,
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
  // Standalone salary/comp pill (e.g. "$120,000 - $150,000 / yr") — page
  // furniture, and pay is not something the model tailors a résumé against.
  /^\$?[\d,]+(\.\d+)?(k)?(\s*[-–—to]+\s*\$?[\d,]+(\.\d+)?(k)?)?(\s*(\/|per)?\s*(yr|year|hour|hr|annum|month|mo))?$/i,
  /^(home|jobs|careers|search)$/i
];

const LOW_VALUE_METADATA_LABEL: RegExp[] = [
  /^type of requisition\s*:?\s*$/i,
  /^public trust\/other required\s*:?\s*$/i,
  /^job family\s*:?\s*$/i
];

// A bullet or list marker with no real text after it — empty <li> spacers,
// icon-only items, or stray punctuation rows left over from the scraped HTML.
// We strip leading markers and treat the line as empty if nothing alphanumeric
// remains.
function isEmptyMarker(line: string): boolean {
  const stripped = line
    .replace(/^[\s•·‣◦▪●○*\-–—]+/, "") // leading bullet glyphs / dashes
    .replace(/^\d+[.)]\s*/, ""); // or a leading "1." / "2)" list number
  return !/[A-Za-z0-9]/.test(stripped);
}

function normalize(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function nextTextIndex(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].trim()) return i;
  }
  return -1;
}

function isMetadataLabel(line: string): boolean {
  return /^[A-Za-z][A-Za-z0-9 /&'’()-]+:\s*$/.test(line.trim());
}

function removeLowValueMetadata(lines: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!LOW_VALUE_METADATA_LABEL.some((re) => re.test(t))) {
      result.push(lines[i]);
      continue;
    }

    // Workday emits "Label:" on one row and the value on the next. These
    // labels are ATS metadata, not requirements; skip the paired value too.
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
  return removePreDescriptionMarketing(removeDuplicateClearanceMetadata(removeLowValueMetadata(lines)));
}

export function extractRelevantJobText(raw: string, maxChars = 12_000): string {
  const cleaned = normalize(String(raw ?? ""));
  if (!cleaned) return "";

  // 1) Drop standalone noise lines (nav, buttons, cookie banners) and empty
  //    bullets / marker-only rows. Blank lines are kept here so paragraph
  //    structure survives; normalize() collapses any runs at the end.
  const kept = cleaned.split("\n").filter((line) => {
    const t = line.trim();
    if (!t) return true; // keep blank lines for paragraph structure
    if (isEmptyMarker(t)) return false; // bullet/dash/number with no content
    return !NOISE_LINE.some((re) => re.test(t));
  });
  const filtered = removeWorkdayFurniture(kept);

  // 2) Cut at the first trailing-boilerplate marker that appears after we've
  //    already accumulated real content, so short posts are never truncated.
  let cut = filtered.length;
  let contentSeen = 0;
  for (let i = 0; i < filtered.length; i += 1) {
    const t = filtered[i].trim();
    // Test against content seen on PRIOR lines, so the very first line can never
    // be treated as trailing boilerplate (which would cut everything to "").
    if (t && contentSeen > 400 && TRAILING_BOILERPLATE.some((re) => re.test(t))) {
      cut = i;
      break;
    }
    if (t) contentSeen += t.length;
  }

  // 3) Collapse consecutive duplicate lines (scraped pages often repeat the
  //    title or a bullet); blanks are exempt so paragraph breaks are preserved.
  const deduped: string[] = [];
  for (const line of filtered.slice(0, cut)) {
    const t = line.trim();
    if (t && t === deduped[deduped.length - 1]?.trim()) continue;
    deduped.push(line);
  }

  return normalize(deduped.join("\n")).slice(0, maxChars);
}
