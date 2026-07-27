// Probes for the client-only duplicate scan cache (src/lib/duplicateScan.ts) —
// the layer that keeps the Applications tab from rerunning the O(n²) identity
// scan on every visit. Offline + deterministic; discovered automatically by
// `npm test`.
//
// It also carries a benchmark of the underlying scan. That benchmark makes NO
// timing assertions (CI machines are shared and would make it flaky) — it
// prints wall-clock per size so a regression is visible in the log. Default
// sizes stay small; the full 50/100/300/500 sweep the review asked for is
// opt-in:
//
//   ROLEFIT_DUPLICATE_BENCH=full node src/lib/__evals__/duplicate-scan-eval.mjs

import {
  cachedDuplicateScan,
  computeDuplicateScan,
  duplicateIdsOf,
  duplicateScanIdentity,
  duplicateScanStats,
  rehydrateDuplicateGroups,
  resetDuplicateScanCache
} from "../duplicateScan.ts";
import { groupDuplicateApplications } from "../jobIdentity.ts";

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

// A body long enough to clear the matcher's fingerprint floors.
const JD_BODY = `
We are hiring a Software Engineer II to build customer-facing scheduling tools.
Responsibilities include designing React components, maintaining Node services,
improving PostgreSQL query performance, writing integration tests, reviewing
pull requests, and collaborating with product managers on roadmap planning.
Requirements: three years professional experience with JavaScript or TypeScript,
familiarity with cloud infrastructure, experience operating production systems,
strong written communication, and comfort working in an agile environment.
`;

const OTHER_BODY = `
Our restaurant group seeks a pastry chef to lead morning production baking.
Duties include laminating dough, managing walk-in inventory, training junior
bakers, maintaining sanitation records, and coordinating catering orders with
the events team. Requires culinary certification, five years bakery experience,
early morning availability, and the ability to lift fifty pounds repeatedly.
`;

function app(overrides) {
  return {
    id: "a1",
    title: "Software Engineer II at Northwind",
    company: "Northwind",
    role: "Software Engineer II",
    jobUrl: "https://boards.greenhouse.io/northwind/jobs/4012345",
    jobDescription: JD_BODY,
    status: "interested",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

// The same posting seen on two boards — one duplicate cluster of two.
const PAIR = [
  app({ id: "a1" }),
  app({ id: "a2", jobUrl: "https://www.linkedin.com/jobs/view/992211" , sourceUrls: [{ url: "https://boards.greenhouse.io/northwind/jobs/4012345", addedAt: "2026-01-02T00:00:00.000Z" }] })
];

const UNRELATED = app({
  id: "b1",
  title: "Pastry Chef at Blue Fig",
  company: "Blue Fig",
  role: "Pastry Chef",
  jobUrl: "https://bluefig.example.com/careers/pastry",
  jobDescription: OTHER_BODY
});

// ── The scan itself still finds what jobIdentity finds ───────────────────────
resetDuplicateScanCache();
const baseList = [...PAIR, UNRELATED];
const baseKey = duplicateScanIdentity(baseList);
const cold = computeDuplicateScan(baseList, baseKey);
check("cold scan finds one cluster", cold.groups.length, 1);
check("cluster holds both postings", cold.groups[0].memberIds.slice().sort(), ["a1", "a2"]);
check(
  "cached groups store ids, never records",
  Object.keys(cold.groups[0]).sort(),
  ["confidence", "edges", "memberIds"]
);
check(
  "projection matches the unwrapped scan",
  groupDuplicateApplications(baseList).length,
  cold.groups.length
);

// ── A repeat visit with unchanged identity data never rescans ────────────────
{
  const before = duplicateScanStats.scans;
  const hit = cachedDuplicateScan(duplicateScanIdentity(baseList));
  check("repeat visit hits the cache", hit === cold, true);
  check("repeat visit runs no scan", duplicateScanStats.scans - before, 0);
}

// ── Presentation-only edits do not invalidate matching ───────────────────────
for (const [name, patch] of [
  ["status", { status: "interviewing" }],
  ["appliedAt", { appliedAt: "2026-02-02T00:00:00.000Z" }],
  ["createdAt", { createdAt: "2025-12-01T00:00:00.000Z" }],
  ["notes", { notes: "called the recruiter" }],
  ["followupAt", { followupAt: "2026-03-03T00:00:00.000Z" }],
  ["priority", { priority: "High" }],
  ["resumeArtifacts", { resumeArtifacts: { hasPdf: true } }],
  ["attachments", { attachments: [{ fileName: "t.pdf", label: "T", size: 10, contentType: "application/pdf", savedAt: "2026-02-02T00:00:00.000Z" }] }]
]) {
  // React replaces the edited record with a new object, exactly as here.
  const edited = [{ ...baseList[0], ...patch }, baseList[1], baseList[2]];
  const before = duplicateScanStats.scans;
  const hit = cachedDuplicateScan(duplicateScanIdentity(edited));
  check(`${name} edit reuses the scan`, hit === cold, true);
  check(`${name} edit runs no scan`, duplicateScanStats.scans - before, 0);
}

// ── Matching-relevant edits invalidate exactly once ──────────────────────────
for (const [name, patch] of [
  ["jobUrl", { jobUrl: "https://boards.greenhouse.io/northwind/jobs/9999999" }],
  ["company", { company: "Southwind" }],
  ["role", { role: "Staff Engineer" }],
  ["title", { title: "Staff Engineer at Northwind" }],
  ["location", { location: "Austin, TX" }],
  ["jobDescription", { jobDescription: `${JD_BODY} Additional duties apply.` }],
  // Must differ from jobDescription: the key (like the matcher) reads raw text
  // in preference to the distilled brief, so identical raw text is correctly
  // not a change at all.
  ["rawJobDescription", { rawJobDescription: `${JD_BODY} Posted directly by the hiring team.` }],
  ["sourceUrls", { sourceUrls: [{ url: "https://jobs.example.com/x", addedAt: "2026-01-05T00:00:00.000Z" }] }],
  ["duplicateDismissedIds", { duplicateDismissedIds: ["a2"] }]
]) {
  const edited = [{ ...baseList[0], ...patch }, baseList[1], baseList[2]];
  check(`${name} edit changes the scan identity`, duplicateScanIdentity(edited) !== baseKey, true);
  check(`${name} edit misses the cache`, cachedDuplicateScan(duplicateScanIdentity(edited)), null);
}

// A dismissed pair really does stop grouping (the scan is re-run, not reused).
{
  const dismissed = [{ ...baseList[0], duplicateDismissedIds: ["a2"] }, baseList[1], baseList[2]];
  const result = computeDuplicateScan(dismissed, duplicateScanIdentity(dismissed));
  check("dismissing the pair empties the cluster list", result.groups.length, 0);
}

// ── Rehydration reads the CURRENT records, not the scanned ones ──────────────
{
  resetDuplicateScanCache();
  const key = duplicateScanIdentity(baseList);
  const scan = computeDuplicateScan(baseList, key);
  // Same identity fields, newer presentation state — the case that used to
  // leave the merge modal warning about the wrong files.
  const current = [
    { ...baseList[0], status: "offer", resumeArtifacts: { hasPdf: true }, notes: "current" },
    baseList[1],
    baseList[2]
  ];
  const groups = rehydrateDuplicateGroups(scan, current);
  const a1 = groups[0].applications.find((a) => a.id === "a1");
  check("rehydrated record is the live object", a1 === current[0], true);
  check("rehydrated record carries the new status", a1.status, "offer");
  check("rehydrated record carries the new artifacts", a1.resumeArtifacts.hasPdf, true);
  check("duplicate ids come from the live groups", [...duplicateIdsOf(groups)].sort(), ["a1", "a2"]);
}

// ── A stale-but-valid scan degrades to fewer groups, never to wrong ones ─────
{
  resetDuplicateScanCache();
  const trio = [
    app({ id: "c1" }),
    app({ id: "c2", jobUrl: "https://www.linkedin.com/jobs/view/1" , sourceUrls: [{ url: "https://boards.greenhouse.io/northwind/jobs/4012345", addedAt: "2026-01-02T00:00:00.000Z" }] }),
    app({ id: "c3", jobUrl: "https://indeed.com/viewjob?jk=2", sourceUrls: [{ url: "https://boards.greenhouse.io/northwind/jobs/4012345", addedAt: "2026-01-03T00:00:00.000Z" }] })
  ];
  const scan = computeDuplicateScan(trio, duplicateScanIdentity(trio));
  check("three boards form one cluster", scan.groups[0].memberIds.length, 3);

  const afterDelete = rehydrateDuplicateGroups(scan, [trio[0], trio[1]]);
  check("deleted member drops out", afterDelete[0].applications.map((a) => a.id), ["c1", "c2"]);
  check(
    "edges naming a deleted member are pruned",
    afterDelete[0].edges.every((edge) => edge.a !== "c3" && edge.b !== "c3"),
    true
  );

  const afterMerge = rehydrateDuplicateGroups(scan, [trio[0]]);
  check("a cluster below two members is dropped", afterMerge.length, 0);
  check("empty scan rehydrates to nothing", rehydrateDuplicateGroups(null, trio).length, 0);
}

// ── Losing a member must not leave unrelated records grouped ─────────────────
// A~B~C joined transitively; remove B and A/C have NO evidence linking them.
// Presenting them as duplicates would offer a merge that deletes a row.
{
  const chain = {
    key: "chain",
    groups: [
      {
        memberIds: ["A", "B", "C"],
        edges: [
          { a: "A", b: "B", level: "repost", confidence: "high", evidence: ["A~B"] },
          { a: "B", b: "C", level: "repost", confidence: "exact", evidence: ["B~C"] }
        ],
        confidence: "exact"
      }
    ]
  };
  const broken = rehydrateDuplicateGroups(chain, [{ id: "A" }, { id: "C" }]);
  check("a broken chain yields no evidence-free cluster", broken.length, 0);

  // Removing an END of the chain leaves a genuinely connected pair.
  const kept = rehydrateDuplicateGroups(chain, [{ id: "B" }, { id: "C" }]);
  check("a still-connected pair survives", kept.length, 1);
  check("survivor keeps only its own edge", kept[0].edges.map((e) => e.evidence[0]), ["B~C"]);
  check("survivor confidence comes from its own edge", kept[0].confidence, "exact");

  // The strongest edge belonged to the removed part, so confidence must drop
  // rather than inherit the original cluster's rank.
  const weakened = rehydrateDuplicateGroups(chain, [{ id: "A" }, { id: "B" }]);
  check("confidence is re-ranked from surviving edges", weakened[0].confidence, "high");

  // One removal can split a cluster into two independent real pairs.
  const forked = {
    key: "fork",
    groups: [
      {
        memberIds: ["A", "B", "C", "D", "E"],
        edges: [
          { a: "A", b: "B", level: "repost", confidence: "high", evidence: ["A~B"] },
          { a: "B", b: "C", level: "repost", confidence: "high", evidence: ["B~C"] },
          { a: "C", b: "D", level: "repost", confidence: "high", evidence: ["C~D"] },
          { a: "D", b: "E", level: "repost", confidence: "high", evidence: ["D~E"] }
        ],
        confidence: "high"
      }
    ]
  };
  const split = rehydrateDuplicateGroups(forked, [{ id: "A" }, { id: "B" }, { id: "D" }, { id: "E" }]);
  check("a split cluster yields both real pairs", split.length, 2);
  check(
    "each pair keeps its own members",
    split.map((g) => g.applications.map((a) => a.id).join("")).sort(),
    ["AB", "DE"]
  );
}

// ── A record without an id never enters the cache ────────────────────────────
{
  resetDuplicateScanCache();
  const idless = [{ ...PAIR[0], id: undefined }, PAIR[1]];
  const scan = computeDuplicateScan(idless, duplicateScanIdentity(idless));
  check("a cluster needing an id-less member is dropped", scan.groups.length, 0);
  check(
    "no undefined ever reaches memberIds",
    scan.groups.every((g) => g.memberIds.every((id) => typeof id === "string")),
    true
  );
}

// ── The per-record key memo hashes only what changed ─────────────────────────
{
  const list = [app({ id: "d1" }), app({ id: "d2" }), app({ id: "d3" })];
  duplicateScanIdentity(list); // prime
  const primed = duplicateScanStats.hashedRecords;
  duplicateScanIdentity(list);
  duplicateScanIdentity(list);
  check("unchanged records are never rehashed", duplicateScanStats.hashedRecords - primed, 0);

  const edited = [{ ...list[0], notes: "typed one character" }, list[1], list[2]];
  duplicateScanIdentity(edited);
  check("one edited record costs one hash", duplicateScanStats.hashedRecords - primed, 1);
}

// ── Benchmark (no timing assertions — logged for regression visibility) ──────
function syntheticApplications(count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    // Deterministic filler with enough shared vocabulary to be a realistic
    // non-match: the matcher's expensive path is the pair that ALMOST matches.
    const filler = Array.from({ length: 60 }, (_, w) => `term${(i * 7 + w * 13) % 400}`).join(" ");
    out.push(
      app({
        id: `bench-${i}`,
        company: `Company ${i % 40}`,
        role: `Engineer ${i % 12}`,
        title: `Engineer ${i % 12} at Company ${i % 40}`,
        jobUrl: `https://boards.greenhouse.io/c${i % 40}/jobs/${5_000_000 + i}`,
        jobDescription: `${JD_BODY}\n${filler}\n${JD_BODY}`
      })
    );
  }
  return out;
}

const SIZES = process.env.ROLEFIT_DUPLICATE_BENCH === "full" ? [50, 100, 300, 500] : [50, 100];
console.log(`\n-- duplicate scan benchmark (${SIZES.join("/")} applications) --`);
for (const size of SIZES) {
  const list = syntheticApplications(size);
  const key = duplicateScanIdentity(list);
  resetDuplicateScanCache();
  const started = process.hrtime.bigint();
  const result = computeDuplicateScan(list, key);
  const scanMs = Number(process.hrtime.bigint() - started) / 1e6;

  const cachedStart = process.hrtime.bigint();
  const hit = cachedDuplicateScan(key);
  const cachedMs = Number(process.hrtime.bigint() - cachedStart) / 1e6;

  const pairs = (size * (size - 1)) / 2;
  console.log(
    `  n=${String(size).padStart(3)}  pairs=${String(pairs).padStart(6)}  ` +
      `scan=${scanMs.toFixed(1)}ms  revisit=${cachedMs.toFixed(3)}ms  groups=${result.groups.length}`
  );
  check(`benchmark n=${size} revisit is a cache hit`, hit === result, true);
}

console.log(failures ? `\n${failures} FAILED` : "\nAll duplicate-scan checks passed");
process.exit(failures ? 1 : 0);
