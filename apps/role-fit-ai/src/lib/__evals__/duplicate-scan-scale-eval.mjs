// Scale and equivalence probes for the candidate-indexed duplicate scan
// (src/lib/jobIdentity.ts → groupDuplicateApplications).
//
// The index compares only pairs that share a candidate key. Its failure mode is
// silent — a missing key drops a duplicate without throwing — so this eval
// rebuilds the exact all-pairs result from findDuplicateApplications (which
// still visits every record) on seeded synthetic trackers that plant every
// matcher tier, dismissals, and company-less/role-less records, and requires the
// indexed groups to be identical, order included. It also proves that a memo
// rescan equals a cold scan, and that a realistic 2,000-record tracker compares
// under 5% of all pairs. Synthetic data only; no timing assertions.

import assert from "node:assert/strict";
import {
  DuplicateScanMemo,
  CONFIDENCE_RANK,
  findDuplicateApplications,
  groupDuplicateApplications
} from "../jobIdentity.ts";
import {
  computeDuplicateScan,
  duplicateScanIdentity,
  duplicateScanStats,
  resetDuplicateScanCache
} from "../duplicateScan.ts";

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROLES = [
  "Software Engineer", "Senior Software Engineer", "Backend Engineer", "Frontend Engineer",
  "Data Engineer", "Platform Engineer", "Software Engineer II", "Machine Learning Engineer"
];
const LOCATIONS = ["New York, NY", "Remote", "Seattle, WA", "Austin, TX", "", "Tokyo, Japan"];

// A tracker shaped like the real one: mostly distinct companies with a few
// repeat employers, ~45% ATS URLs, some requisition ids in the text, and a
// share of planted duplicates spanning every tier.
function makeTracker(n, seed, { dupRate = 0.12, noCompanyRate = 0.03, noRoleRate = 0.03, words = [110, 190] } = {}) {
  const random = rng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const word = (length) => Array.from({ length }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(random() * 26)]).join("");
  const vocab = Array.from({ length: 3000 }, () => word(4 + Math.floor(random() * 6)));
  const zipf = () => vocab[Math.min(vocab.length - 1, Math.floor(Math.exp(random() * Math.log(vocab.length))) - 1)];
  const body = (count) => Array.from({ length: count }, zipf).join(" ");
  const keep = (text, fraction) => text.split(" ").map((token) => (random() < fraction ? token : zipf())).join(" ");
  const companies = [];
  const company = () => {
    if (random() < noCompanyRate) return "";
    if (companies.length && random() > 0.72) return pick(companies);
    const name = `${word(7)} ${pick(["Inc.", "Labs", "LLC", "Systems", ""])}`.trim();
    companies.push(name);
    return name;
  };
  const atsUrl = (index) => [
    `https://boards.greenhouse.io/t${index % 9}/jobs/${700000 + index}`,
    `https://jobs.lever.co/t${index % 9}/${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
    `https://acme${index % 5}.wd5.myworkdayjobs.com/External/job/NY/role_JR-${10000 + index}`,
    `https://www.linkedin.com/jobs/view/${4000000000 + index}`
  ][index % 4];
  const apps = [];
  const at = (index) => new Date(Date.UTC(2026, 5, 13) + index * 60_000).toISOString();
  for (let index = 0; index < n; index += 1) {
    const id = `s${seed}-${index}`;
    const prior = apps.length ? pick(apps) : null;
    if (prior && random() < dupRate) {
      const stripped = prior.rawJobDescription.replace(/^Requisition ID: \S+\n/, "");
      const variants = [
        // Tier 1: same ATS posting reached through a source URL.
        () => ({ jobUrl: `https://careers.example.com/a/${id}`, sourceUrls: [{ url: prior.jobUrl }] }),
        // Tier 1 with no shared URL: another URL form of the same posting id.
        () => {
          const greenhouse = prior.jobUrl.match(/greenhouse\.io\/[^/]+\/jobs\/(\d+)/);
          const linkedin = prior.jobUrl.match(/linkedin\.com\/jobs\/view\/(\d+)/);
          if (greenhouse) return { jobUrl: `https://careers.example.com/open?gh_jid=${greenhouse[1]}` };
          if (linkedin) return { jobUrl: `https://www.linkedin.com/jobs/search/?currentJobId=${linkedin[1]}` };
          return { jobUrl: `https://careers.example.com/a2/${id}`, sourceUrls: [{ url: prior.jobUrl }] };
        },
        // Tier 2: the same requisition id printed in both descriptions.
        () => ({ jobUrl: `https://careers.example.com/r/${id}`, rawJobDescription: `Requisition ID: JR-${index}\n${prior.rawJobDescription}`, company: prior.company }),
        // Tier 2 skip: the same id under a different company.
        () => ({ jobUrl: `https://careers.example.com/rc/${id}`, company: `${word(6)} Corp` }),
        // Tier 3: conflicting ids, same company/title, near-identical text.
        () => ({ jobUrl: atsUrl(n + index), rawJobDescription: keep(prior.rawJobDescription, 0.995) }),
        // Tier 4: the same URL with tracking parameters.
        () => ({ jobUrl: `${prior.jobUrl}${prior.jobUrl.includes("?") ? "&" : "?"}utm_source=board` }),
        // Tier 5a: id-less repost, same company and role, strong overlap.
        () => ({ jobUrl: `https://careers.example.com/p/${id}`, rawJobDescription: keep(stripped, 0.94 + random() * 0.06) }),
        // Tier 5c (or nothing): the same, straddling the possible-refresh band.
        () => ({ jobUrl: `https://careers.example.com/q/${id}`, rawJobDescription: keep(stripped, 0.84 + random() * 0.1) }),
        // Tier 5b: retitled id-less repost.
        () => ({ jobUrl: `https://careers.example.com/t/${id}`, role: pick(ROLES), rawJobDescription: keep(stripped, 0.95 + random() * 0.05) }),
        // Tier 5d: a board page with no company (and sometimes no role).
        () => ({ jobUrl: `https://board.example.com/${id}`, company: "", role: random() < 0.3 ? "" : prior.role, rawJobDescription: keep(stripped, 0.96 + random() * 0.04) }),
        // Contradicting location on an otherwise strong repost.
        () => ({ jobUrl: `https://careers.example.com/l/${id}`, location: "Tokyo, Japan", rawJobDescription: keep(stripped, 0.97) })
      ];
      const record = { ...prior, id, createdAt: at(index), updatedAt: at(index), sourceUrls: [], ...pick(variants)() };
      if (random() < 0.2) record.duplicateDismissedIds = [prior.id];
      apps.push(record);
      continue;
    }
    const req = random() < 0.2 ? `Requisition ID: R-${100000 + index}\n` : "";
    apps.push({
      id,
      title: "",
      company: company(),
      role: random() < noRoleRate ? "" : pick(ROLES),
      location: pick(LOCATIONS),
      jobUrl: random() < 0.45 ? atsUrl(index) : `https://careers.example.com/jobs/${id}`,
      sourceUrls: [],
      rawJobDescription: `${req}${body(words[0] + Math.floor(random() * (words[1] - words[0])))}`,
      jobDescription: "",
      status: "applied",
      createdAt: at(index),
      updatedAt: at(index)
    });
  }
  return apps;
}

// The all-pairs result, rebuilt from the linear matcher with the same grouping
// rules groupDuplicateApplications documents.
function allPairsGroups(apps) {
  const indexOf = new Map(apps.map((application, index) => [application, index]));
  const edges = [];
  for (let i = 0; i < apps.length; i += 1) {
    const dismissed = new Set(apps[i].duplicateDismissedIds ?? []);
    for (const match of findDuplicateApplications(apps[i], apps.slice(i + 1))) {
      const j = indexOf.get(match.application);
      if (dismissed.has(apps[j].id) || (apps[j].duplicateDismissedIds ?? []).includes(apps[i].id)) continue;
      edges.push({ i, j, level: match.level, confidence: match.confidence, evidence: match.evidence });
    }
  }
  edges.sort((x, y) => x.i - y.i || x.j - y.j);
  const parent = apps.map((_, index) => index);
  const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (const edge of edges) {
    const a = find(edge.i);
    const b = find(edge.j);
    if (a !== b) parent[a] = b;
  }
  const byRoot = new Map();
  apps.forEach((_, index) => {
    const root = find(index);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(index);
  });
  const groups = [];
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    const inGroup = new Set(members);
    const groupEdges = edges
      .filter((edge) => inGroup.has(edge.i) && inGroup.has(edge.j))
      .map((edge) => ({ a: apps[edge.i].id, b: apps[edge.j].id, level: edge.level, confidence: edge.confidence, evidence: edge.evidence }));
    const confidence = groupEdges.reduce(
      (best, edge) => (CONFIDENCE_RANK[edge.confidence] < CONFIDENCE_RANK[best] ? edge.confidence : best),
      "possible"
    );
    groups.push({ applications: members.map((index) => apps[index]), edges: groupEdges, confidence });
  }
  groups.sort((x, y) => CONFIDENCE_RANK[x.confidence] - CONFIDENCE_RANK[y.confidence] || y.applications.length - x.applications.length);
  return groups;
}

const shape = (groups) => JSON.stringify(groups.map((group) => ({
  ids: group.applications.map((application) => application.id),
  edges: group.edges,
  confidence: group.confidence
})));

// ── 1. Indexed scan equals the all-pairs result ─────────────────────────────
const tiers = new Set();
for (const [n, seed] of [[1000, 1], [400, 2], [400, 3], [400, 4]]) {
  const apps = makeTracker(n, seed);
  const indexed = groupDuplicateApplications(apps);
  assert.equal(shape(indexed), shape(allPairsGroups(apps)), `seed ${seed}: indexed groups equal the all-pairs groups`);
  for (const group of indexed) for (const edge of group.edges) tiers.add(`${edge.level}/${edge.confidence}/${edge.evidence[0].replace(/[\d#]+.*$/, "")}`);
}
// The corpus must actually exercise each tier, or equality proves little.
for (const expected of [
  "same-posting/exact/Same Greenhouse posting (",
  "same-posting/exact/Same requisition ID ",
  "same-posting/exact/Same posting URL",
  "same-company-role/possible/Posting IDs differ",
  "repost/high/Same company and title",
  "repost/high/Same company",
  "same-company-role/possible/Same company and title",
  "repost/high/"
]) {
  assert.ok([...tiers].some((tier) => tier.startsWith(expected)), `the corpus exercises "${expected}"`);
}

// ── 1b. Each candidate key alone still finds its pair ───────────────────────
// Planted reposts usually also share a company, which would hide a missing
// key. Here every pair shares exactly one piece of evidence.
{
  const text = (seed) => {
    const random = rng(seed);
    return Array.from({ length: 90 }, () => Array.from({ length: 6 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(random() * 26)]).join("")).join(" ");
  };
  const record = (id, fields) => ({ id, title: "", role: "", company: "", location: "", sourceUrls: [], rawJobDescription: text(id.length * 31 + id.charCodeAt(id.length - 1)), status: "applied", ...fields });
  const cases = [
    ["posting id", record("ats-a", { company: "Alpha", jobUrl: "https://boards.greenhouse.io/alpha/jobs/5550001" }), record("ats-b", { company: "Beta", jobUrl: "https://careers.beta.example/open?gh_jid=5550001" })],
    ["requisition id", record("req-a", { company: "Gamma", jobUrl: "https://careers.example.com/g1", rawJobDescription: `Requisition ID: JR-44551\n${text(1)}` }), record("req-b", { jobUrl: "https://board.example.com/g2", rawJobDescription: `Requisition ID: JR-44551\n${text(2)}` })],
    // A one-sided requisition id keeps this pair out of the unknown-company path.
    ["posting URL", record("url-a", { company: "Delta", jobUrl: "https://careers.example.com/d/1", rawJobDescription: `Requisition ID: JR-77120\n${text(5)}` }), record("url-b", { jobUrl: "https://careers.example.com/d/1?utm_source=x" })],
    ["unknown company", record("unk-a", { role: "Data Engineer", jobUrl: "https://board.example.com/u1", rawJobDescription: text(3) }), record("unk-b", { company: "Epsilon", role: "Data Engineer", jobUrl: "https://careers.example.com/u2", rawJobDescription: text(3) })],
    ["role-less partner", record("rl-a", { role: "Data Engineer", jobUrl: "https://board.example.com/r1", rawJobDescription: text(4) }), record("rl-b", { company: "Zeta", jobUrl: "https://careers.example.com/r2", rawJobDescription: text(4) })]
  ];
  const background = makeTracker(60, 21, { dupRate: 0 });
  const apps = [...background, ...cases.flatMap(([, a, b]) => [a, b])];
  const indexed = groupDuplicateApplications(apps);
  assert.equal(shape(indexed), shape(allPairsGroups(apps)), "single-key pairs: indexed groups equal the all-pairs groups");
  for (const [label, a, b] of cases) {
    assert.ok(
      indexed.some((group) => group.edges.some((edge) => edge.a === a.id && edge.b === b.id)),
      `a pair sharing only its ${label} is found`
    );
  }
}

// ── 2. A memo rescan equals a cold scan after edits, inserts, and deletes ───
{
  const memo = new DuplicateScanMemo();
  let list = makeTracker(600, 7);
  groupDuplicateApplications(list, memo);
  // Dismissed pairs are skipped before comparison, so a cold scan computes
  // every candidate pair except those.
  assert.ok(memo.lastScan.computedPairs > 0, "a cold memo computes candidate pairs");
  assert.ok(memo.lastScan.computedPairs <= memo.lastScan.candidatePairs, "a cold memo computes no more than the candidates");
  groupDuplicateApplications(list, memo);
  assert.equal(memo.lastScan.computedPairs, 0, "an unchanged rescan reuses every verdict");

  const steps = [
    (current) => current.map((application, index) => (index === 10 ? { ...application, company: current[40].company, role: current[40].role, rawJobDescription: current[40].rawJobDescription } : application)),
    (current) => [{ ...current[25], id: "inserted-1", jobUrl: "https://careers.example.com/inserted-1" }, ...current],
    (current) => current.filter((_, index) => index !== 3 && index !== 77),
    (current) => current.map((application, index) => (index === 30 ? { ...application, duplicateDismissedIds: [current[31].id] } : application)),
    (current) => current.map((application, index) => (index === 5 ? { ...application, jobUrl: current[90].jobUrl } : application))
  ];
  for (const [step, edit] of steps.entries()) {
    list = edit(list);
    const warm = groupDuplicateApplications(list, memo);
    assert.equal(shape(warm), shape(groupDuplicateApplications(list)), `rescan step ${step + 1} equals a cold scan`);
    assert.ok(memo.lastScan.computedPairs < memo.lastScan.candidatePairs / 4, `rescan step ${step + 1} recomputes only changed pairs`);
  }
}

// ── 3. Per-job checks agree with the tracker-wide edges ─────────────────────
{
  const apps = makeTracker(600, 9);
  const pairs = new Set();
  for (const group of groupDuplicateApplications(apps)) {
    for (const edge of group.edges) pairs.add(`${edge.a}|${edge.b}|${edge.level}|${edge.confidence}`);
  }
  for (let k = 0; k < 200; k += 1) {
    const target = apps[(k * 37) % apps.length];
    for (const match of findDuplicateApplications(target, apps)) {
      if (match.application === target) continue;
      const [a, b] = apps.indexOf(target) < apps.indexOf(match.application) ? [target.id, match.application.id] : [match.application.id, target.id];
      const dismissed = (target.duplicateDismissedIds ?? []).includes(match.application.id) || (match.application.duplicateDismissedIds ?? []).includes(target.id);
      if (!dismissed) assert.ok(pairs.has(`${a}|${b}|${match.level}|${match.confidence}`), `per-job match ${a}~${b} is a tracker-wide edge`);
    }
  }
}

// ── 4. A realistic 2,000-record tracker compares under 5% of all pairs ──────
{
  resetDuplicateScanCache();
  const apps = makeTracker(2000, 11, { dupRate: 0.05, noCompanyRate: 0.002, noRoleRate: 0.01 });
  computeDuplicateScan(apps, duplicateScanIdentity(apps));
  const allPairs = (apps.length * (apps.length - 1)) / 2;
  assert.ok(duplicateScanStats.candidatePairs > 0, "the scan considered candidate pairs");
  assert.ok(
    duplicateScanStats.candidatePairs < allPairs * 0.05,
    `${duplicateScanStats.candidatePairs} candidate pairs is under 5% of ${allPairs}`
  );
  console.log(`2,000 records: ${duplicateScanStats.candidatePairs} candidate pairs (${(100 * duplicateScanStats.candidatePairs / allPairs).toFixed(2)}% of all pairs)`);
}

console.log("Duplicate scan scale and equivalence checks passed");
