// Probes for the shared job-identity module (src/lib/jobIdentity.ts) — the
// layered duplicate matcher behind the apply-time duplicate warning and the
// extension /api/extension/analyze lookup. Offline + deterministic; discovered
// automatically by `npm test`.

import {
  atsPostingKey,
  findDuplicateApplications,
  groupDuplicateApplications,
  jdFingerprint,
  jdSimilarity,
  locationsCompatible,
  normalizeCompanyName,
  normalizeJobUrl,
  normalizeRoleTitle,
  requisitionIdFromText
} from "../jobIdentity.ts";

let failures = 0;
function check(name, actual, expected) {
  const got = typeof actual === "object" ? JSON.stringify(actual) : String(actual);
  const want = typeof expected === "object" ? JSON.stringify(expected) : String(expected);
  if (got === want) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}\n  expected: ${want}\n  got:      ${got}`);
  }
}

// A JD body long enough to clear the fingerprint floors, reused across cases.
const JD_BODY = `
We are hiring a Software Engineer II to build customer-facing scheduling tools.
Responsibilities include designing React components, maintaining Node services,
improving PostgreSQL query performance, writing integration tests, reviewing
pull requests, and collaborating with product managers on roadmap planning.
Requirements: three years professional experience with JavaScript or TypeScript,
familiarity with cloud infrastructure, experience operating production systems,
strong written communication, and comfort working in an agile environment.
Preferred: healthcare domain experience, GraphQL, Terraform, and Kubernetes.
Benefits include medical coverage, retirement matching, and flexible time off.
`.trim();

const OTHER_BODY = `
The Platform Data team seeks a Staff Data Engineer for our warehouse rebuild.
Responsibilities: architecting Spark pipelines, managing Airflow orchestration,
modeling dimensional schemas in Snowflake, mentoring junior data engineers, and
partnering with analytics stakeholders on governance policies and cataloging.
Requirements: seven years building batch and streaming data platforms, deep
Python expertise, Kafka, warehouse cost optimization, and dbt modeling rigor.
Preferred: fintech reporting background, Scala, Iceberg, and lakehouse designs.
`.trim();

// ── URL normalization ────────────────────────────────────────────────────────
check(
  "normalizeJobUrl strips tracking params + fragment + trailing slash",
  normalizeJobUrl("https://example.com/careers/123/?utm_source=li&trk=feed#apply"),
  "https://example.com/careers/123"
);
check(
  "normalizeJobUrl keeps meaningful params",
  normalizeJobUrl("https://acme.com/jobs?gh_jid=4012345&utm_medium=social"),
  "https://acme.com/jobs?gh_jid=4012345"
);
// normalizeJobUrl equality drives SILENT merges, so ambiguous params that some
// sites use as the posting identifier must survive normalization — two jobs
// differing only by them must NOT compare equal.
check(
  "normalizeJobUrl keeps ambiguous identifier-ish params distinct",
  normalizeJobUrl("https://x.com/apply?position=111") === normalizeJobUrl("https://x.com/apply?position=222"),
  false
);
check(
  "normalizeJobUrl keeps ref params distinct",
  normalizeJobUrl("https://x.com/careers?ref=RQ123") === normalizeJobUrl("https://x.com/careers?ref=RQ456"),
  false
);
check("normalizeJobUrl passes invalid urls through", normalizeJobUrl("not a url"), "not a url");

// ── ATS posting keys ─────────────────────────────────────────────────────────
check(
  "greenhouse board url → key ignores tenant",
  atsPostingKey("https://boards.greenhouse.io/acme/jobs/4012345")?.key,
  "greenhouse:4012345"
);
check(
  "greenhouse embedded gh_jid on company site → same key",
  atsPostingKey("https://www.acme.com/careers/open-roles?gh_jid=4012345")?.key,
  "greenhouse:4012345"
);
check(
  "lever url → uuid key",
  atsPostingKey("https://jobs.lever.co/acme/9f8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f")?.key,
  "lever:9f8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f"
);
check(
  "ashby url → uuid key",
  atsPostingKey("https://jobs.ashbyhq.com/acme/9f8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f/application")?.key,
  "ashby:9f8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f"
);
check(
  "smartrecruiters url → numeric key",
  atsPostingKey("https://jobs.smartrecruiters.com/Acme/743999912345678-software-engineer-ii")?.key,
  "smartrecruiters:743999912345678"
);
check(
  "workday url → tenant-scoped req key",
  atsPostingKey("https://nvidia.wd5.myworkdayjobs.com/en-US/External/job/US-CA-Santa-Clara/Software-Engineer_JR-90210")?.key,
  "workday:nvidia:JR-90210"
);
check(
  "linkedin view url and currentJobId param agree",
  atsPostingKey("https://www.linkedin.com/jobs/view/3987654321/?refId=abc")?.key ===
    atsPostingKey("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3987654321")?.key,
  true
);
check(
  "indeed jk param → key",
  atsPostingKey("https://www.indeed.com/viewjob?jk=abcdef0123456789&from=serp")?.key,
  "indeed:abcdef0123456789"
);
check("plain company page → no key", atsPostingKey("https://acme.com/careers/software-engineer"), null);

// ── Requisition ids ──────────────────────────────────────────────────────────
check("req id with label parses", requisitionIdFromText("About us...\nRequisition ID: JR-2931\nDuties..."), "JR-2931");
check("job number parses", requisitionIdFromText("Job #: 2024-118 — Software Engineer"), "2024-118");
check("bare year rejected", requisitionIdFromText("Posting number: 2024"), "");
check("unlabeled numbers ignored", requisitionIdFromText("We have 12345 customers worldwide"), "");

// ── Normalizers ──────────────────────────────────────────────────────────────
check("company legal suffixes strip", normalizeCompanyName("Acme, Inc."), normalizeCompanyName("ACME"));
check("company brand words kept", normalizeCompanyName("Acme Labs") === normalizeCompanyName("Acme"), false);
check(
  "title parentheticals strip",
  normalizeRoleTitle("Software Engineer II (R-1234, Remote)"),
  normalizeRoleTitle("Software Engineer II")
);
check("title levels kept distinct", normalizeRoleTitle("Engineer II") === normalizeRoleTitle("Engineer III"), false);
check("locations: unknown compatible", locationsCompatible("", "New York, NY"), true);
check("locations: remote compatible", locationsCompatible("Remote (US)", "Austin, TX"), true);
check("locations: shared token compatible", locationsCompatible("New York, NY", "New York"), true);
check("locations: different cities contradict", locationsCompatible("Austin, TX", "Seattle, WA"), false);

// ── Fingerprints ─────────────────────────────────────────────────────────────
check("identical text similarity 1", jdSimilarity(jdFingerprint(JD_BODY), jdFingerprint(JD_BODY)), 1);
check("different roles similarity low", jdSimilarity(jdFingerprint(JD_BODY), jdFingerprint(OTHER_BODY)) < 0.3, true);
check("empty fingerprint never matches", jdSimilarity(jdFingerprint(""), jdFingerprint(JD_BODY)), 0);

// ── Layered matcher ──────────────────────────────────────────────────────────
const baseApp = {
  id: "a1",
  title: "Software Engineer II at Acme",
  company: "Acme",
  role: "Software Engineer II",
  location: "New York, NY",
  jobUrl: "https://boards.greenhouse.io/acme/jobs/4012345",
  jobDescription: JD_BODY,
  status: "applied"
};

// Exact same posting reached via the embedded board on the company site.
{
  const matches = findDuplicateApplications(
    { jobUrl: "https://acme.com/careers?gh_jid=4012345&utm_source=linkedin", jobText: "" },
    [baseApp]
  );
  check("tier1: cross-url ats id → exact same-posting", {
    n: matches.length,
    level: matches[0]?.level,
    confidence: matches[0]?.confidence
  }, { n: 1, level: "same-posting", confidence: "exact" });
}

// Same URL modulo tracking params.
{
  const matches = findDuplicateApplications(
    { jobUrl: "https://boards.greenhouse.io/acme/jobs/4012345?utm_campaign=x#app", jobText: "" },
    [baseApp]
  );
  check("tier2: normalized url → exact", matches[0]?.confidence, "exact");
}

// A record's sourceUrls participate in URL tiers.
{
  const appWithSources = { ...baseApp, jobUrl: "https://acme.com/careers/se2", sourceUrls: [{ url: "https://www.linkedin.com/jobs/view/3987654321/" }] };
  const matches = findDuplicateApplications(
    { jobUrl: "https://www.linkedin.com/jobs/collections/rec/?currentJobId=3987654321", jobText: "" },
    [appWithSources]
  );
  check("sourceUrls: linkedin id in sourceUrls → exact", matches[0]?.confidence, "exact");
}

// Requisition id in both bodies, company agrees.
{
  const matches = findDuplicateApplications(
    { jobUrl: "https://www.linkedin.com/jobs/view/111", jobText: `Requisition ID: JR-2931\n${JD_BODY}`, company: "Acme" },
    [{ ...baseApp, jobDescription: `Req ID: JR-2931\n${JD_BODY}` }]
  );
  check("tier3: shared req id → high same-posting", {
    level: matches[0]?.level,
    confidence: matches[0]?.confidence
  }, { level: "same-posting", confidence: "high" });
}

// Cross-board repost: same company + title + near-identical JD, no shared URL/id.
{
  const matches = findDuplicateApplications(
    {
      jobUrl: "https://www.indeed.com/viewjob?jk=00000000cafebabe",
      jobText: `${JD_BODY}\nPosted 3 days ago via Indeed.`,
      company: "Acme, Inc.",
      role: "Software Engineer II"
    },
    [baseApp]
  );
  check("tier4: cross-board repost → high repost", {
    level: matches[0]?.level,
    confidence: matches[0]?.confidence
  }, { level: "repost", confidence: "high" });
}

// Same company + title, different description, compatible location → possible only.
{
  const matches = findDuplicateApplications(
    { jobUrl: "", jobText: OTHER_BODY, company: "Acme", role: "Software Engineer II", location: "New York" },
    [baseApp]
  );
  check("same title, different JD → possible same-company-role", {
    level: matches[0]?.level,
    confidence: matches[0]?.confidence
  }, { level: "same-company-role", confidence: "possible" });
}

// Same company + title, different description AND contradicting location → no match.
{
  const matches = findDuplicateApplications(
    { jobUrl: "", jobText: OTHER_BODY, company: "Acme", role: "Software Engineer II", location: "Seattle, WA" },
    [baseApp]
  );
  check("truly separate opening → no match", matches.length, 0);
}

// Unknown company on the board side: near-identical body still flags a repost.
{
  const matches = findDuplicateApplications(
    { jobUrl: "https://www.linkedin.com/jobs/view/222", jobText: JD_BODY },
    [{ ...baseApp, company: "" }]
  );
  check("no-company near-identical JD → high repost", matches[0]?.confidence, "high");
}

// Different company entirely → never matches on text alone at company tier.
{
  const matches = findDuplicateApplications(
    { jobUrl: "", jobText: JD_BODY, company: "Globex", role: "Software Engineer II" },
    [baseApp]
  );
  // Company tier is skipped (different companies); the no-company tier is
  // skipped too (both companies known). Identical text alone must not match.
  check("known different companies → no match", matches.length, 0);
}

// Confidence ordering: exact sorts before possible.
{
  const other = { ...baseApp, id: "a2", jobUrl: "https://jobs.lever.co/acme/9f8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f", jobDescription: OTHER_BODY };
  const matches = findDuplicateApplications(
    { jobUrl: "https://boards.greenhouse.io/acme/jobs/4012345", jobText: OTHER_BODY, company: "Acme", role: "Software Engineer II" },
    [other, baseApp]
  );
  check("matches sorted strongest-first", matches[0]?.confidence, "exact");
}

// ── Tracker-wide grouping ────────────────────────────────────────────────────
{
  // Two boards of the same Compa job (LinkedIn + Ashby → different ATS ids, so
  // they cluster on company+title+JD), one Compa app plus two unrelated jobs.
  const roster = [
    { id: "li", title: "Software Engineer at Compa", company: "Compa", role: "Software Engineer", jobUrl: "https://www.linkedin.com/jobs/view/4339434305/", jobDescription: JD_BODY },
    { id: "ashby", title: "Software Engineer at Compa", company: "Compa", role: "Software Engineer", jobUrl: "https://jobs.ashbyhq.com/compa/ffbbc5c1-f8e9-444e-b4fb-89010a4a2398", jobDescription: JD_BODY },
    { id: "other", title: "Staff Data Engineer at Globex", company: "Globex", role: "Staff Data Engineer", jobUrl: "https://boards.greenhouse.io/globex/jobs/77", jobDescription: OTHER_BODY },
    { id: "lonely", title: "Designer at Initech", company: "Initech", role: "Designer", jobUrl: "https://jobs.lever.co/initech/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", jobDescription: "Design systems and prototypes for the Initech suite of office products." }
  ];
  const groups = groupDuplicateApplications(roster);
  check("grouping: exactly one duplicate group", groups.length, 1);
  check("grouping: the group holds the two Compa boards", groups[0]?.applications.map((a) => a.id).sort().join(","), "ashby,li");
  check("grouping: group confidence is high", groups[0]?.confidence, "high");
  check("grouping: group records the pairwise edge", groups[0]?.edges.length, 1);
  check("grouping: unrelated jobs are not grouped", groups.some((g) => g.applications.some((a) => a.id === "other" || a.id === "lonely")), false);
}

{
  // Transitive chain: three boards of one job pairwise-match → a single group of 3.
  const key = "https://boards.greenhouse.io/acme/jobs/4012345";
  const chain = [
    { id: "a", title: "Software Engineer II at Acme", company: "Acme", role: "Software Engineer II", jobUrl: key, jobDescription: JD_BODY },
    { id: "b", title: "Software Engineer II at Acme", company: "Acme", role: "Software Engineer II", jobUrl: "https://acme.com/careers?gh_jid=4012345", jobDescription: JD_BODY },
    { id: "c", title: "Software Engineer II at Acme", company: "Acme, Inc.", role: "Software Engineer II", jobUrl: "https://www.indeed.com/viewjob?jk=00000000cafebabe", jobDescription: `${JD_BODY}\nvia Indeed` }
  ];
  const groups = groupDuplicateApplications(chain);
  check("grouping: transitive chain → one group of three", { n: groups.length, size: groups[0]?.applications.length }, { n: 1, size: 3 });
}

check("grouping: empty roster → no groups", groupDuplicateApplications([]).length, 0);
check("grouping: null-safe", groupDuplicateApplications(null).length, 0);

if (failures > 0) {
  console.log(`\n${failures} case(s) failed`);
  process.exit(1);
}
console.log("\nAll job-identity probes passed");
