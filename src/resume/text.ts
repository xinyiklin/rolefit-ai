// Shared low-level text utilities used across keyword extraction, scoring,
// rewriting, and diffing. No domain tables live here — only generic string
// helpers depended on by two or more of those modules.

export const hasMetric = (text: string) =>
  /(\$\s?\d+|\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*(?:percent|x|k|m|tb|gb|mb)\b|\d+\+|\d+(?:\.\d+)?\s+(?:\w+\s+){0,2}(?:users?|requests?|records?|models?|endpoints?|apps?|patients?|facilities?|hours?|days?|weeks?|months?|ms|milliseconds?|seconds?|minutes?)\b)/i.test(text);
// Bullet glyphs include the copy-paste variants Word/Google-Docs/PDF exports
// produce (◦ ▪ ● ○ ‣ ⁃ ∙ …), not just "- * •" — otherwise a resume pasted with
// those glyphs registers ZERO bullets and falls back to default bulletQuality.
// The trailing \s+ is required, so a glyph inside text or a "2020-2023" date span
// is never mistaken for a bullet. The middle dot "·" is deliberately EXCLUDED — it
// is the contact/heading SEPARATOR ("email · phone · link"), so a fragment that
// starts with "· " must not register as a bullet.
const BULLET_GLYPHS = "-*•◦▪▫■□●○‣⁃∙";
const BULLET_RE = new RegExp(`^\\s*[${BULLET_GLYPHS}]\\s+`);
export const isBullet = (line: string) => BULLET_RE.test(line);
export const stripBullet = (line: string) => line.replace(BULLET_RE, "").trim();
export const sectionName = (line: string) => line.trim().replace(/:$/, "").toLowerCase();
export const isContactLine = (line: string) => /@|https?:\/\/|github\.com|linkedin\.com|\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/i.test(line);
export const isKnownSection = (line: string) =>
  [
    "summary",
    "targeted summary",
    "core skills",
    "skills",
    "technical skills",
    "projects",
    "experience",
    "work experience",
    // Experience-header variants — without these a section boundary goes
    // unrecognized, so an education-first resume with one of these headers had its
    // real experience years masked (and the education state machine never cleared).
    "professional experience",
    "employment history",
    "work history",
    "career history",
    "relevant experience",
    "professional background",
    "education",
    "certifications"
    // NOTE: deliberately NOT adding awards/honors/publications/coursework/activities/
    // languages/etc. Many are SUB-headers nested under Education, and this flat list
    // drives the education date-shield in scoring.ts professionalExperienceText —
    // recognizing them would clear the shield mid-Education and leak degree-era dates
    // into years-of-experience, INFLATING seniority (the unsafe over-claim direction).
    // Leaving them unrecognized keeps post-education content shielded, which only ever
    // LOWERS the estimate (safe). A proper fix needs a nesting-aware section model.
  ].includes(sectionName(line));

export function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/\bpostgre\s*sql\b/g, "postgresql")
    .replace(/\bnodejs\b/g, "node.js")
    .replace(/\breactjs\b/g, "react")
    .replace(/\brestful\b/g, "rest")
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const titleCase = (text: string) =>
  text
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (["api", "apis", "css", "html", "sql"].includes(word)) return word.toUpperCase();
      if (word === "javascript") return "JavaScript";
      if (word === "node.js") return "Node.js";
      if (word === "postgresql") return "PostgreSQL";
      if (word === "react") return "React";
      if (word === "rest") return "REST";
      if (word === "typescript") return "TypeScript";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");

export const unique = (items: string[]) => Array.from(new Set(items));
export const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
