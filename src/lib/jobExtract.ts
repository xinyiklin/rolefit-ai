// Local, dependency-free distiller for imported job postings.
//
// The server hands back tag-stripped text from a job page (or a Workday CXS
// description). This helper trims that down to the parts worth feeding the
// model — the role intro, responsibilities, and qualifications — by dropping
// standalone UI noise (Apply/Save/cookie banners) and the trailing boilerplate
// that pads most postings (ATS metadata, "More about the company" marketing,
// EEO/legal statements).
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
  /equal opportunity employer/i,
  /equal employment opportunity/i,
  /^we are an equal\b/i,
  /\be-?verify\b/i,
  /^applicants? (with disabilities|who require)/i,
  /^(privacy|cookie) (policy|notice|statement)\b/i
];

// Standalone lines that are pure page furniture, dropped wherever they appear.
const NOISE_LINE: RegExp[] = [
  /^(apply|apply now|easy apply|save|save job|saved|share|share this job|print|email)$/i,
  /^(back to (search results|jobs|search)|view all jobs|see all jobs)$/i,
  /^(sign in|signin|create (an )?account|register|log ?in)$/i,
  /^we use cookies/i,
  /^(accept|accept all|reject|manage) cookies?$/i,
  /^\d+\+? (days?|hours?|weeks?|months?) ago$/i,
  /^(home|jobs|careers|search)$/i
];

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

export function extractRelevantJobText(raw: string, maxChars = 12_000): string {
  const cleaned = normalize(String(raw ?? ""));
  if (!cleaned) return "";

  // 1) Drop standalone noise lines (nav, buttons, cookie banners).
  const kept = cleaned.split("\n").filter((line) => {
    const t = line.trim();
    if (!t) return true; // keep blank lines for paragraph structure
    return !NOISE_LINE.some((re) => re.test(t));
  });

  // 2) Cut at the first trailing-boilerplate marker that appears after we've
  //    already accumulated real content, so short posts are never truncated.
  let cut = kept.length;
  let contentSeen = 0;
  for (let i = 0; i < kept.length; i += 1) {
    const t = kept[i].trim();
    // Test against content seen on PRIOR lines, so the very first line can never
    // be treated as trailing boilerplate (which would cut everything to "").
    if (t && contentSeen > 400 && TRAILING_BOILERPLATE.some((re) => re.test(t))) {
      cut = i;
      break;
    }
    if (t) contentSeen += t.length;
  }

  return normalize(kept.slice(0, cut).join("\n")).slice(0, maxChars);
}
