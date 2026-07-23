// Probes for src/lib/jobTarget.ts — inferApplicationTitle() (the tracker's
// fallback application title) and inferCompanyFromUrl() (the fallback company
// name before/without an AI distill pass). Mirrors the job-identity-eval style:
// a plain `check(name, actual, expected)` array. Both functions must never
// invent a company/title from ambiguous input — job boards and unknown hosts
// resolve to "" / "Untitled role" rather than guessing.
//
//   node src/lib/__evals__/job-target-eval.mjs

import { inferApplicationTitle, inferCompanyFromUrl } from "../jobTarget.ts";

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}\n  expected: ${JSON.stringify(expected)}\n  got:      ${JSON.stringify(actual)}`);
  }
}

// ── inferCompanyFromUrl: ATS hosts carrying the employer in the FIRST path segment
check("greenhouse job-boards wrapper: run-together slug title-cased on first letter only", inferCompanyFromUrl("https://job-boards.greenhouse.io/remodelhealth/jobs/12345"), "Remodelhealth");
check("greenhouse legacy boards host", inferCompanyFromUrl("https://boards.greenhouse.io/acme/jobs/1"), "Acme");
check("lever hyphenated slug title-cases each word", inferCompanyFromUrl("https://jobs.lever.co/acme-labs/9f8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f"), "Acme Labs");
check("ashby slug", inferCompanyFromUrl("https://jobs.ashbyhq.com/acme/9f8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f/application"), "Acme");
check("smartrecruiters slug", inferCompanyFromUrl("https://jobs.smartrecruiters.com/Acme-Corp/743999912345678-software-engineer-ii"), "Acme Corp");
check("workable slug", inferCompanyFromUrl("https://apply.workable.com/acme/j/ABCDEF1234/"), "Acme");
// Real breezy.hr posting URLs are <tenant>.breezy.hr/p/<id>: the employer lives
// in the sub-domain, and the "p" path segment is chrome (in GENERIC_URL_TOKENS),
// so the path-first branch falls through to the sub-domain tenant.
check("breezy.hr: 'p' path segment is chrome, sub-domain tenant wins", inferCompanyFromUrl("https://acme.breezy.hr/p/abcdef1234"), "Acme");
check("teamtailor slug via path", inferCompanyFromUrl("https://jobs.teamtailor.com/acme/jobs/123-software-engineer"), "Acme");

// ── ATS hosts carrying the employer in the SUB-DOMAIN instead
check("workday tenant from sub-domain, wd-pod skipped", inferCompanyFromUrl("https://nvidia.wd5.myworkdayjobs.com/en-US/External/job/US-CA-Santa-Clara/Software-Engineer_JR-90210"), "Nvidia");
check("workday tenant that is generic ('jobs') yields no guess", inferCompanyFromUrl("https://jobs.wd1.myworkdayjobs.com/en-US/External"), "");
check("bamboohr tenant via sub-domain (path is a bare id, not a slug)", inferCompanyFromUrl("https://acme.bamboohr.com/careers/12"), "Acme");
check("greenhouse: generic first path segment falls back to sub-domain, which is also generic -> no guess", inferCompanyFromUrl("https://boards.greenhouse.io/careers/jobs/123"), "");

// ── Job boards / aggregators: employer never encoded in the URL
check("linkedin never yields a company guess", inferCompanyFromUrl("https://www.linkedin.com/jobs/view/3987654321/"), "");
check("indeed never yields a company guess", inferCompanyFromUrl("https://www.indeed.com/viewjob?jk=abcdef0123456789"), "");
check("glassdoor never yields a company guess", inferCompanyFromUrl("https://www.glassdoor.com/job-listing/software-engineer-acme-JV_KO0,17.htm"), "");
check("wellfound never yields a company guess", inferCompanyFromUrl("https://wellfound.com/jobs/12345-software-engineer"), "");

// ── Other (non-ATS, non-board) hosts: hostname label, generic sub-domains dropped
check("bare company domain", inferCompanyFromUrl("https://www.acme.com/careers/software-engineer"), "Acme");
check("generic 'jobs.' sub-domain dropped, base label kept", inferCompanyFromUrl("https://jobs.acme.com/openings/1"), "Acme");
check("unknown host still yields a label (not a board, not an ATS)", inferCompanyFromUrl("https://randomstartup.io/apply/42"), "Randomstartup");

// ── Malformed / empty URLs never throw, never invent a company
check("empty string url -> no guess", inferCompanyFromUrl(""), "");
check("not a url -> caught, no guess", inferCompanyFromUrl("not a url"), "");
check("scheme-only garbage -> caught, no guess", inferCompanyFromUrl("https://"), "");
check("javascript: url -> caught or no host match, no guess", inferCompanyFromUrl("javascript:alert(1)"), "");

// ── inferApplicationTitle: URL wins over jobDescription when present
check(
  "url present: hostname + pathname truncated to 30 chars, www stripped",
  inferApplicationTitle("https://www.acme.com/careers/software-engineer-ii-remote-us", ""),
  "acme.com/careers/software-engineer-ii-"
);
check("url present with bare '/' path: no path suffix appended", inferApplicationTitle("https://acme.com/", ""), "acme.com");
check("url present with no path at all: no path suffix appended", inferApplicationTitle("https://acme.com", ""), "acme.com");

// ── Falls through to jobDescription first qualifying line when url is empty/invalid
check(
  "empty url falls through to first JD line over 6 chars, capped at 80",
  inferApplicationTitle("", "Software Engineer II\nAcme is hiring across the platform team."),
  "Software Engineer II"
);
check(
  "malformed url falls through to JD text too (catch, not throw)",
  inferApplicationTitle("not a url", "Staff Data Engineer\nMore body text here."),
  "Staff Data Engineer"
);
check(
  "short lines (<=6 chars) are skipped in favor of the first qualifying line",
  inferApplicationTitle("", "Hi\nyo\nSoftware Engineer II at Acme"),
  "Software Engineer II at Acme"
);
check(
  "a qualifying line longer than 80 chars is truncated to exactly 80",
  inferApplicationTitle("", "A".repeat(120)).length,
  80
);

// ── Total absence of usable signal -> the honest fallback, never invented
check("empty url and empty jobDescription -> 'Untitled role'", inferApplicationTitle("", ""), "Untitled role");
check("empty url and whitespace-only jobDescription -> 'Untitled role'", inferApplicationTitle("", "   \n   \n  "), "Untitled role");

if (failures > 0) {
  console.log(`\n${failures} case(s) failed`);
  process.exit(1);
}
console.log("\nAll job-target probes passed");
