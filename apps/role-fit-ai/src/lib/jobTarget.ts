export function inferApplicationTitle(url: string, jobDescription: string) {
  try {
    if (url) {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, "") + (u.pathname && u.pathname !== "/" ? u.pathname.slice(0, 30) : "");
    }
  } catch {
    // fall through
  }
  const firstLine = jobDescription
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 6);
  if (firstLine) return firstLine.slice(0, 80);
  return "Untitled role";
}

// ATS hosts that carry the employer slug in the FIRST path segment rather than
// the hostname, e.g. job-boards.greenhouse.io/remodelhealth/jobs/123 or
// jobs.lever.co/acme/<id>. Reading the host on these yields chrome ("job-boards").
const ATS_PATH_HOSTS =
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|breezy\.hr|recruitee\.com|teamtailor\.com|bamboohr\.com|myworkdayjobs\.com)$/i;

// Job boards / aggregators: the employer is NEVER the host (they list many
// companies), so the URL can't yield a company name — it must come from the
// posting text. Returning the board name ("Linkedin") would be a wrong guess.
const JOB_BOARD_HOSTS =
  /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|monster\.com|dice\.com|simplyhired\.com|wellfound\.com|angel\.co|builtin\.com|themuse\.com|stackoverflow\.com|jobs\.com)$/i;

// Hostname labels / path slugs that are ATS chrome, not an employer name.
const GENERIC_URL_TOKENS = new Set([
  "job", "jobs", "job-boards", "jobboards", "boards", "board", "careers", "career",
  "apply", "applications", "application", "hire", "hiring", "work", "secure", "app",
  "www", "recruiting", "recruit", "talent", "my", "portal", "embed", "en", "us"
]);

// "remodel-health" / "acme corp" → "Remodel Health" / "Acme Corp". A run-together
// slug ("remodelhealth") can't be word-split, so only the first letter is cased.
function titleCaseSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ""))
    .join(" ");
}

export function inferCompanyFromUrl(url: string) {
  try {
    if (!url) return "";
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const segments = u.pathname.split("/").filter(Boolean);

    // Job boards never encode the employer in the URL — leave it to the distiller
    // (the posting text) or manual review rather than guessing the board's name.
    if (JOB_BOARD_HOSTS.test(host)) return "";

    // Workday is the exception: the employer is always the sub-domain tenant
    // (nvidia.wd5.myworkdayjobs.com → Nvidia); the first path segment is the
    // site name ("External", "Careers"), which is chrome.
    if (/(^|\.)myworkdayjobs\.com$/i.test(host)) {
      const tenant = host.split(".")[0];
      return tenant && !GENERIC_URL_TOKENS.has(tenant) ? titleCaseSlug(tenant) : "";
    }

    // ATS hosts: the employer is usually the first path segment
    // (job-boards.greenhouse.io/<company>/…, jobs.lever.co/<company>/…) but some
    // carry it in the sub-domain instead (<tenant>.myworkdayjobs.com,
    // <company>.bamboohr.com, <company>.greenhouse.io). Try the path first, then
    // the left-most non-chrome sub-domain label (skipping Workday pods like wd5).
    if (ATS_PATH_HOSTS.test(host)) {
      const slug = (segments[0] ?? "").toLowerCase();
      if (slug && !GENERIC_URL_TOKENS.has(slug)) return titleCaseSlug(slug);
      const sub = host
        .split(".")
        .slice(0, -2) // drop the ATS base domain (SLD.TLD)
        .find((label) => label && !GENERIC_URL_TOKENS.has(label) && !/^wd\d+$/.test(label));
      return sub ? titleCaseSlug(sub) : ""; // empty beats a chrome guess like "Job boards"
    }

    // Other hosts: take the company label from the hostname, dropping known
    // generic sub-domains (jobs.acme.com → Acme) and the TLD.
    const labels = host
      .replace(/\.(com|io|co|net|ai|app|dev|org|hr|us|inc|xyz)$/, "")
      .split(".")
      .filter((label) => label && !GENERIC_URL_TOKENS.has(label));
    const company = labels[0] ?? "";
    return company ? titleCaseSlug(company) : "";
  } catch {
    return "";
  }
}
