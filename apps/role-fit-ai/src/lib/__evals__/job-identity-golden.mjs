// CHARACTERIZATION test for the duplicate matcher (src/lib/jobIdentity.ts).
//
// job-identity-eval.mjs asserts hand-written cases: "this pair should match,
// for this reason". This file asserts something different and complementary —
// that the matcher's verdict for EVERY pair of a fixed corpus is exactly what
// it is today. It encodes no opinion about whether those verdicts are right.
//
// Why: the matcher drives pipeline warnings, relationship suggestions, and
// explicit manual-merge discovery,
// and the extension /api/extension/analyze lookup. Its failure mode is silent —
// a refactor that drops a tier does not throw, it just stops finding a
// duplicate, and the merge path deletes rows. A pure-refactor claim ("same
// results, less work") is unreviewable without this.
//
// When a matcher change is INTENTIONAL, regenerate the block below:
//   ROLEFIT_GOLDEN_UPDATE=1 node apps/role-fit-ai/src/lib/__evals__/job-identity-golden.mjs
// and review every changed line as a behavior change, not a formatting diff.

import { groupDuplicateApplications } from "../jobIdentity.ts";

// ── Corpus ───────────────────────────────────────────────────────────────────
// Bodies are built from a fixed vocabulary so overlap is tunable: `body(n, seed)`
// emits n tokens, and two bodies sharing a prefix overlap by that prefix. The
// matcher's floors are 50 comparable tokens, 60 for the conflicting-id review.

const VOCAB = [
  "engineer", "scheduling", "react", "components", "node", "services", "postgresql",
  "queries", "integration", "tests", "reviews", "roadmap", "planning", "typescript",
  "cloud", "infrastructure", "production", "systems", "written", "communication",
  "agile", "environment", "mentoring", "juniors", "design", "documents", "latency",
  "budgets", "observability", "dashboards", "incident", "response", "rotations",
  "feature", "flags", "migrations", "schemas", "caching", "layers", "throughput",
  "profiling", "traces", "metrics", "alerts", "deployment", "pipelines", "rollback",
  "safety", "capacity", "forecasts", "storage", "sharding", "indexes", "backfills",
  "streaming", "consumers", "idempotency", "retries", "backoff", "timeouts",
  "contracts", "validation", "serialization", "compression", "partitions",
  "replication", "failover", "quorum", "consensus", "leases", "heartbeats",
  "compaction", "snapshots", "checkpoints", "recovery", "durability", "isolation"
];

// n tokens starting at `from`; wraps the vocabulary so long bodies stay unique
// per start offset while sharing a controllable prefix with their neighbours.
function body(n, from = 0) {
  const words = [];
  for (let i = 0; i < n; i += 1) words.push(VOCAB[(from + i) % VOCAB.length]);
  return words.join(" ");
}

// Similarity is Jaccard over token SETS, so a prefix of BASE is a subset of it
// and the ratio is just the length ratio. Each constant is placed against a
// specific threshold; the assertions at the bottom fail if a body stops
// straddling the band it was chosen for.
const BASE = body(70, 0);
// 0.971 vs BASE — clears the conflicting-id review floor (0.96) and the
// unknown-company floor (0.95).
const NEAR_A = body(68, 0);
// 0.943 vs BASE — above the repost floor, below the conflicting-id review.
const NEAR_B = body(66, 0);
// ~0.80 — lands in the "possible refresh" band, not the high band.
const PARTIAL = `${body(56, 0)} ${body(14, 30)}`;
// A second family. 0.867 against BASE keeps it below every content floor, so
// the unknown-company pair below cannot accidentally match the repost family.
const ALT = body(70, 5);
const ALT_NEAR = body(68, 5);
// Different subject entirely.
const UNRELATED = body(70, 38);
// Below the 50-token comparability floor.
const THIN = body(20, 0);

const CORPUS = [
  // 1-2 — tier 1: the same Greenhouse posting id reached from two boards.
  { id: "ats-a", company: "Northwind", role: "Software Engineer II", jobUrl: "https://boards.greenhouse.io/northwind/jobs/4012345", jobDescription: BASE },
  { id: "ats-b", company: "Northwind", role: "Software Engineer II", jobUrl: "https://www.linkedin.com/jobs/view/992211", sourceUrls: [{ url: "https://boards.greenhouse.io/northwind/jobs/4012345" }], jobDescription: UNRELATED },

  // 3-4 — tier 2: the same requisition id printed in both descriptions.
  { id: "req-a", company: "Contoso", role: "Data Engineer", jobUrl: "https://contoso.example.com/careers/1", jobDescription: `Requisition ID REQ-88214. ${BASE}` },
  { id: "req-b", company: "Contoso", role: "Data Engineer", jobUrl: "https://jobs.example.org/listing/xyz", jobDescription: `Job number REQ-88214 ${UNRELATED}` },
  // 5 — same requisition number at a DIFFERENT employer must not match req-a.
  { id: "req-c", company: "Fabrikam", role: "Data Engineer", jobUrl: "https://fabrikam.example.com/careers/9", jobDescription: `Requisition ID REQ-88214. ${UNRELATED}` },

  // 6-7 — tier 3: conflicting explicit ids, but same company/role/location and
  // a near-identical body. Review-only ("possible"), never an automatic merge.
  { id: "conflict-a", company: "Initech", role: "Platform Engineer", location: "Austin, TX", jobUrl: "https://boards.greenhouse.io/initech/jobs/5000001", jobDescription: BASE },
  { id: "conflict-b", company: "Initech", role: "Platform Engineer", location: "Austin, TX", jobUrl: "https://boards.greenhouse.io/initech/jobs/5000002", jobDescription: NEAR_A },
  // 8 — same shape but a different role: separate opening, no match.
  { id: "conflict-c", company: "Initech", role: "Security Engineer", location: "Austin, TX", jobUrl: "https://boards.greenhouse.io/initech/jobs/5000003", jobDescription: NEAR_A },

  // 9-10 — tier 4: the same URL modulo tracking parameters.
  { id: "url-a", company: "Umbrella", role: "Analyst", jobUrl: "https://umbrella.example.com/careers/analyst?utm_source=news", jobDescription: THIN },
  { id: "url-b", company: "Umbrella", role: "Analyst", jobUrl: "https://umbrella.example.com/careers/analyst", jobDescription: THIN },

  // 11 — one-sided id against a no-id record with a near-identical body. This
  // pair is rejected WITHOUT consuming the content math, which is exactly the
  // early return Phase 3 hoists above the set intersections.
  { id: "onesided-noid", company: "Northwind", role: "Software Engineer II", jobUrl: "https://careers.example.net/posting", jobDescription: BASE },

  // 12-13 — tier 5: no ids, same company and role, strong overlap → repost.
  { id: "repost-a", company: "Globex", role: "Backend Engineer", jobUrl: "https://globex.example.com/jobs/a", jobDescription: BASE },
  { id: "repost-b", company: "Globex", role: "Backend Engineer", jobUrl: "https://globex.example.com/jobs/b", jobDescription: NEAR_B },
  // 14 — same company, DIFFERENT role, near-identical body → retitled repost.
  { id: "retitle-a", company: "Globex", role: "Senior Backend Engineer", jobUrl: "https://globex.example.com/jobs/c", jobDescription: NEAR_A },

  // 15-16 — no ids, same company/role, only partial overlap → possible refresh.
  { id: "partial-a", company: "Stark", role: "Design Engineer", jobUrl: "https://stark.example.com/jobs/a", jobDescription: BASE },
  { id: "partial-b", company: "Stark", role: "Design Engineer", jobUrl: "https://stark.example.com/jobs/b", jobDescription: PARTIAL },

  // 17-18 — company unknown on one side (common on board pages).
  { id: "nocompany-a", company: "", role: "Backend Engineer", jobUrl: "https://board.example.com/x", jobDescription: ALT },
  { id: "nocompany-b", company: "Wayne", role: "Backend Engineer", jobUrl: "https://board.example.com/y", jobDescription: ALT_NEAR },

  // 19-20 — same company/role/body but contradictory locations → separate.
  { id: "loc-a", company: "Cyberdyne", role: "Field Engineer", location: "Berlin, Germany", jobUrl: "https://cyberdyne.example.com/a", jobDescription: BASE },
  { id: "loc-b", company: "Cyberdyne", role: "Field Engineer", location: "Tokyo, Japan", jobUrl: "https://cyberdyne.example.com/b", jobDescription: NEAR_A },

  // 21-22 — descriptions below the comparability floor never match on content.
  { id: "thin-a", company: "Soylent", role: "Operations Lead", jobUrl: "https://soylent.example.com/a", jobDescription: THIN },
  { id: "thin-b", company: "Soylent", role: "Operations Lead", jobUrl: "https://soylent.example.com/b", jobDescription: THIN },

  // 23-24 — a pair the user reviewed and kept separate; the decision is
  // recorded on one side only, which must be enough to suppress the group.
  { id: "dismissed-a", company: "Tyrell", role: "Research Engineer", jobUrl: "https://tyrell.example.com/a", jobDescription: BASE, duplicateDismissedIds: ["dismissed-b"] },
  { id: "dismissed-b", company: "Tyrell", role: "Research Engineer", jobUrl: "https://tyrell.example.com/b", jobDescription: NEAR_A },

  // 25-27 — a transitive chain across three boards: locks union-find grouping.
  { id: "chain-a", company: "Aperture", role: "Test Engineer", jobUrl: "https://boards.greenhouse.io/aperture/jobs/7000001", jobDescription: BASE },
  { id: "chain-b", company: "Aperture", role: "Test Engineer", jobUrl: "https://www.linkedin.com/jobs/view/700", sourceUrls: [{ url: "https://boards.greenhouse.io/aperture/jobs/7000001" }], jobDescription: UNRELATED },
  { id: "chain-c", company: "Aperture", role: "Test Engineer", jobUrl: "https://indeed.com/viewjob?jk=700c", sourceUrls: [{ url: "https://www.linkedin.com/jobs/view/700" }], jobDescription: UNRELATED }
];

// ── Observed behavior ────────────────────────────────────────────────────────
// Pairwise verdicts come from the real record path (two-record grouping), not
// from a target adapter — DuplicateTarget drops sourceUrls, rawJobDescription,
// and dismissals, so it would characterize a different function.

function pairVerdicts() {
  const lines = [];
  for (let i = 0; i < CORPUS.length; i += 1) {
    for (let j = i + 1; j < CORPUS.length; j += 1) {
      const groups = groupDuplicateApplications([CORPUS[i], CORPUS[j]]);
      const edge = groups[0]?.edges[0];
      if (!edge) continue;
      lines.push(`${CORPUS[i].id} ~ ${CORPUS[j].id} => ${edge.level}/${edge.confidence} [${edge.evidence.join(" | ")}]`);
    }
  }
  return lines.sort();
}

function clusters() {
  return groupDuplicateApplications(CORPUS)
    .map((group) => `${group.confidence}: ${group.applications.map((a) => a.id).sort().join(",")}`)
    .sort();
}

// ── Golden ───────────────────────────────────────────────────────────────────
const GOLDEN_PAIRS = [
  "ats-a ~ ats-b => same-posting/exact [Same Greenhouse posting (#4012345)]",
  "chain-a ~ chain-b => same-posting/exact [Same Greenhouse posting (#7000001)]",
  "chain-b ~ chain-c => same-posting/exact [Same posting URL]",
  "conflict-a ~ conflict-b => same-company-role/possible [Posting IDs differ | Same company and title | 97% description overlap]",
  "nocompany-a ~ nocompany-b => repost/high [97% identical description]",
  "partial-a ~ partial-b => same-company-role/possible [Same company and title | 80% description overlap]",
  "repost-a ~ repost-b => repost/high [Same company and title | 94% description overlap]",
  "repost-a ~ retitle-a => repost/high [Same company | 97% description overlap (retitled posting)]",
  "repost-b ~ retitle-a => repost/high [Same company | 97% description overlap (retitled posting)]",
  "req-a ~ req-b => same-posting/exact [Same requisition ID REQ-88214]",
  "url-a ~ url-b => same-posting/exact [Same posting URL]"
];

const GOLDEN_CLUSTERS = [
  "exact: ats-a,ats-b",
  "exact: chain-a,chain-b,chain-c",
  "exact: req-a,req-b",
  "exact: url-a,url-b",
  "high: nocompany-a,nocompany-b",
  "high: repost-a,repost-b,retitle-a",
  "possible: conflict-a,conflict-b",
  "possible: partial-a,partial-b"
];

// ── Compare ──────────────────────────────────────────────────────────────────
const pairs = pairVerdicts();
const groups = clusters();

if (process.env.ROLEFIT_GOLDEN_UPDATE) {
  const fmt = (rows) => rows.map((row) => `  ${JSON.stringify(row)}`).join(",\n");
  console.log(`const GOLDEN_PAIRS = [\n${fmt(pairs)}\n];\n`);
  console.log(`const GOLDEN_CLUSTERS = [\n${fmt(groups)}\n];`);
  process.exit(0);
}

let failures = 0;
function diff(label, actual, expected) {
  const added = actual.filter((row) => !expected.includes(row));
  const removed = expected.filter((row) => !actual.includes(row));
  if (!added.length && !removed.length) {
    console.log(`PASS ${label} (${actual.length} entries)`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}`);
  for (const row of removed) console.log(`  - ${row}`);
  for (const row of added) console.log(`  + ${row}`);
}

diff("pairwise verdicts unchanged", pairs, GOLDEN_PAIRS);
diff("tracker-wide clusters unchanged", groups, GOLDEN_CLUSTERS);

// The corpus must keep exercising every branch; a body edit that silently
// stopped clearing a floor would leave the golden green but meaningless.
const totalPairs = (CORPUS.length * (CORPUS.length - 1)) / 2;
function present(label, condition) {
  if (condition) {
    console.log(`PASS corpus still covers ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL corpus no longer covers ${label}`);
  }
}
present("every confidence tier", ["exact", "high", "possible"].every((c) => pairs.some((p) => p.includes(`/${c} `))));
present("every match level", ["same-posting", "repost", "same-company-role"].every((l) => pairs.some((p) => p.includes(`${l}/`))));
present("non-matching pairs", pairs.length < totalPairs / 2);
// A dismissal suppresses the edge itself, so its absence is indistinguishable
// from "never matched". Prove the dismissal is what did it by re-running the
// same pair with the decision stripped.
{
  const [a, b] = CORPUS.filter((record) => record.id.startsWith("dismissed-"));
  const withDecision = groupDuplicateApplications([a, b]).length;
  const without = groupDuplicateApplications([{ ...a, duplicateDismissedIds: undefined }, b]).length;
  present("a reviewed-as-separate pair suppressed only by its dismissal", withDecision === 0 && without === 1);
}
present("the one-sided-id rejection", !pairs.some((p) => p.includes("onesided-noid")));

console.log(failures ? `\n${failures} FAILED — a matcher behavior change` : `\nMatcher behavior unchanged (${totalPairs} pairs characterized)`);
process.exit(failures ? 1 : 0);
