// Single source of truth for resume SECTION vocabulary + classification, shared by
// the client scorer (src/resume/text.ts, scoring.ts), the client editor parser
// (src/lib/resumeData.ts), and the server LaTeX text parser (server/latex/*.mjs).
//
// Why a .mjs (not .ts): node runs the server parser directly and cannot import TS,
// while the bundler builds the client; a plain-ESM module is the one form both can
// consume (the TS side gets types from sections.d.mts). Before this, the same
// vocabulary lived in 4+ hand-synced copies that repeatedly drifted apart (a client
// scorer list, a client parser regex, a server parser regex, a server template
// regex) — the root cause of several section-classification bugs.
//
// The model is NESTING-AWARE. A heading has a level:
//   - TOP-LEVEL: experience / education / skills / summary / projects / certifications
//   - SUB-SECTION: coursework / awards / honors / publications / activities / … which
//     are usually nested under Education or Experience.
// The PARSER recognizes BOTH levels (to split each into its own editor section), but
// the scorer's education date-shield only clears on a TOP-LEVEL NON-education section
// — so a dated "Coursework" line under Education never leaks degree years into
// years-of-experience (the inflation bug that recurred whenever these lists drifted).

// Trim + strip one trailing colon, no lowercasing — the base used by both the
// case-sensitive header regexes and `normalize`. Centralized so the colon rule has
// one definition.
const stripTrim = (line) => String(line ?? "").trim().replace(/:$/, "");
// The section-name key for exact matches (also exported as `sectionName` from
// text.ts, so the scorer/rewrite label-matching and boundary detection can't drift).
export const normalize = (line) => stripTrim(line).toLowerCase();

// ── Bullet glyphs ─────────────────────────────────────────────────────────────
// The copy-paste bullet glyphs Word/Docs/PDF exports produce. "·" (U+00B7) is
// deliberately excluded — it is the contact/heading separator. The scorer matches
// exactly these; the parsers additionally accept numbered lists ("1." / "1)").
export const BULLET_GLYPHS = "-*•◦▪▫■□●○‣⁃∙";

// ── Section header detection (the PARSER's question: "start a new section here?") ─
// ALL-CAPS short line, OR a recognized section-title phrase in ANY case. The phrase
// is anchored to the whole line (only an optional "& X" tail) so a job title that
// merely contains a section word ("Education Coordinator") is NOT a header. Covers
// both top-level sections and sub-sections.
const ALL_CAPS_HEADER_RE = /^[A-Z0-9][A-Z0-9 &/\-]+$/;
const SECTION_TITLE_RE =
  /^(?:(?:work|professional|relevant|employment|career|academic|technical|core|key|other|additional|selected|personal)\s+)*(?:experience|education|skills|projects?|summary|objective|profile|highlights?|certifications?|licenses?|achievements?|accomplishments?|awards?|honou?rs?|background|history|publications?|patents?|involvement|activities|interests|languages?|volunteer(?:ing)?|leadership|coursework|competenc(?:e|ies)|qualifications?)(?:\s*(?:&|and|\/)\s*[a-z]+)?$/i;

export function isSectionHeader(line) {
  // Tolerate a trailing colon ("Experience:") which the char classes reject.
  const trimmed = stripTrim(line);
  if (trimmed.length < 2 || trimmed.length > 50) return false;
  // Section headings are usually one or two words; cap at 4 so a SHOUTING company
  // name is not mistaken for a heading.
  if (trimmed.split(/\s+/).length > 4) return false;
  return ALL_CAPS_HEADER_RE.test(trimmed) || SECTION_TITLE_RE.test(trimmed);
}

// ── Top-level section names (the SCORER/REWRITE boundary detector) ──────────────
// Exact-name match. This is intentionally NARROWER than isSectionHeader: it excludes
// sub-sections (awards/coursework/…) so the education shield and the polisher's
// section-removal walk treat only genuine top-level sections as boundaries.
const TOP_LEVEL_NAMES = new Set([
  "summary",
  "targeted summary",
  "core skills",
  "skills",
  "technical skills",
  "projects",
  "experience",
  "work experience",
  "professional experience",
  "employment history",
  "work history",
  "career history",
  "relevant experience",
  "professional background",
  "education",
  "certifications"
]);

export function isTopLevelSectionHeader(line) {
  return TOP_LEVEL_NAMES.has(normalize(line));
}

// ── Editor section type (skills | summary | standard) ───────────────────────────
// Skills wins over summary so "Skills Summary" keeps its label-colon rows.
const SKILLS_HEADING_RE = /\b(?:technical\s+skills|skills|core\s+skills)\b/i;
const SUMMARY_HEADING_RE = /\b(?:summary|objective|profile|about\s+me|highlights)\b/i;

export function inferSectionType(heading) {
  const trimmed = String(heading ?? "").trim();
  if (SKILLS_HEADING_RE.test(trimmed)) return "skills";
  if (SUMMARY_HEADING_RE.test(trimmed)) return "summary";
  return "standard";
}

// Summary-but-not-skills heading (templates render these as plain paragraphs).
export function isSummaryHeading(heading) {
  const trimmed = String(heading ?? "").trim();
  return SUMMARY_HEADING_RE.test(trimmed) && !SKILLS_HEADING_RE.test(trimmed);
}

// ── Education heading (the scorer's date-shield trigger) ─────────────────────────
// "Education" plus common variants ("Academic Background", "Education & Training").
// Full-match anchored + a pipe/year guard so a JOB entry like "Academic Advisor |
// 2020-2022" is never mistaken for the education header. The "education & X" arm is
// restricted to genuine education suffixes so a WORK section "Education & Outreach"
// is not masked.
const EDUCATION_SECTION_RE =
  /^(?:education|academics?|academic\s+(?:background|history|qualifications?|credentials?|record)|education\s+(?:and|&)\s+(?:training|certifications?|credentials?|qualifications?|learning|development))$/i;

export function isEducationHeading(line) {
  const name = normalize(line);
  if (name === "education") return true;
  return EDUCATION_SECTION_RE.test(name) && !String(line ?? "").includes("|") && !/\b(?:19|20)\d{2}\b/.test(String(line ?? ""));
}
