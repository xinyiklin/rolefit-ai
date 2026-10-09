// Job-posting identity + duplicate matching, shared by the client tracker
// (src/hooks/useApplications.ts, src/App.tsx) and the server extension routes
// (server/extension/index.ts → /api/extension/analyze).
//
// A plain, dependency-free .ts module: Node runs the server routes directly via
// native TypeScript type stripping, and the bundler builds the client, so both
// import this single source of truth. Same pattern as src/resume/sections.ts.
// Keep this module dependency-free and side-effect-free.
//
// The same job routinely appears under different URLs (LinkedIn, Indeed, the
// company site, and the underlying ATS), so URL equality alone under-detects
// duplicates. Matching is LAYERED — each tier is independent evidence, and the
// result carries which tier fired so callers can warn instead of silently
// merging uncertain matches:
//
//   Tier 1  ATS posting id parsed from the URL   → exact  "same-posting"
//   Tier 2  requisition id found in the JD text  → exact  "same-posting"
//   Tier 3  conflicting ids + exceptionally     → possible "same-company-role"
//           strong metadata/content agreement
//   Tier 4  normalized URL equality, unless      → exact  "same-posting"
//           explicit ids conflict
//   Tier 5  no ids + company/title + strong      → high   "repost"
//           lexical and phrase overlap              /possible "same-company-role"
//
// Different explicit ids normally mean separate postings. An ultra-high,
// review-only guard catches the narrow case where an id may have been entered
// incorrectly; it never creates an automatic merge. "Truly separate openings
// with the same title" stay unmatched: company/title metadata alone is not
// duplicate evidence. The no-id tier requires substantial descriptions with
// both lexical and ordered-phrase overlap; low-overlap or incomplete
// descriptions return no match at all.

// ── Public types ─────────────────────────────────────────────────────────────
export type AtsPostingKey = {
  ats: string;
  tenant: string;
  jobId: string;
  /** Stable comparison key, e.g. "greenhouse:4012345" or "workday:nvidia:JR-90210". */
  key: string;
};

export type SourceUrlEntry = { url: string; source?: string; addedAt: string };

export type DuplicateLevel = "same-posting" | "repost" | "same-company-role";
export type DuplicateConfidence = "exact" | "high" | "possible";

export type DuplicateTarget = {
  jobUrl?: string;
  /** Job description text — raw posting text preferred over a prepared brief. */
  jobText?: string;
  company?: string;
  role?: string;
  location?: string;
};

export type DuplicateCandidate = {
  /** Stable id — required for group edges to reference members. */
  id?: string;
  jobUrl?: string;
  jobDescription?: string;
  rawJobDescription?: string;
  company?: string;
  role?: string;
  title?: string;
  location?: string;
  sourceUrls?: { url?: string }[];
  /** Tracker records the user has explicitly reviewed as separate openings. */
  duplicateDismissedIds?: string[];
};

export type DuplicateMatch<T extends DuplicateCandidate = DuplicateCandidate> = {
  application: T;
  level: DuplicateLevel;
  confidence: DuplicateConfidence;
  evidence: string[];
};

export type DuplicateEdge = {
  /** id of one application in the pair. */
  a: string;
  /** id of the other application in the pair. */
  b: string;
  level: DuplicateLevel;
  confidence: DuplicateConfidence;
  evidence: string[];
};

export type DuplicateGroup<T extends DuplicateCandidate = DuplicateCandidate> = {
  /** ≥2 applications joined transitively into one duplicate cluster. */
  applications: T[];
  /** Pairwise matches within the group, so the UI can show why each pair joined. */
  edges: DuplicateEdge[];
  /** The strongest confidence among the group's edges. */
  confidence: DuplicateConfidence;
};

// Internal — a record that may carry any target or candidate field, since
// buildSignature reads them all defensively.
type SignatureInput = DuplicateTarget & DuplicateCandidate;

// Internal — a precomputed comparison signature for one record. It holds only
// cheap identity metadata plus the description text, so it stays small enough
// for the client cache layer to keep per record across scans.
type Signature = {
  atsKeys: Map<string, AtsPostingKey>;
  normUrls: Set<string>;
  reqId: string;
  company: string;
  role: string;
  location: string | undefined;
  text: string;
};

// Internal — description features, tokenized on first use within one call.
type ContentFeatures = { fingerprint: Set<string>; shingles: () => Set<string> };

// Internal — the outcome of comparing two signatures (before an application is
// attached).
type MatchResult = { level: DuplicateLevel; confidence: DuplicateConfidence; evidence: string[] };

// Tracking/analytics query params stripped during URL normalization.
// (Descended from server/extension/index.ts, which now re-exports
// normalizeJobUrl as normalizeUrl.) normalizeJobUrl equality drives SILENT
// tracker merges (tier 2), so this set is deliberately NARROWER than the old
// display-only version: only params that are unambiguously analytics on every
// site are stripped. Ambiguous values stay because some career sites use them
// as posting identifiers; the other identity tiers can recover an under-match.
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid",
  "ref_src", "trk", "trackingid", "originalsubdomain"
]);

// Normalize a URL for comparison: strip tracking params, drop the fragment,
// and remove a trailing slash from the path. Invalid URLs are returned as-is.
export function normalizeJobUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const param of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(param.toLowerCase())) {
        parsed.searchParams.delete(param);
      }
    }
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.replace(/\/+$/, "");
    }
    parsed.pathname = pathname;
    let result = parsed.toString();
    // toString re-appends a trailing slash for an empty path; trim a bare
    // host trailing slash too for stable comparison.
    if (result.endsWith("/") && !parsed.search) {
      result = result.replace(/\/+$/, "");
    }
    return result;
  } catch {
    return url;
  }
}

// Shared by prepared snapshots, duplicate merge, and the server sanitizer.
// Primary URLs are excluded; duplicates keep the earliest timestamp and a label.
export function dedupeSourceUrls(
  candidates: readonly { url?: string; source?: string; addedAt?: string }[] | undefined | null,
  primaryUrl: string | undefined | null,
  fallbackAddedAt: string,
  max = 10
): SourceUrlEntry[] {
  const primaryTrimmed = String(primaryUrl || "").trim();
  const primaryNorm = primaryTrimmed ? normalizeJobUrl(primaryTrimmed) : "";
  const byNorm = new Map<string, SourceUrlEntry>();
  for (const entry of Array.isArray(candidates) ? candidates : []) {
    const url = String(entry?.url ?? "").trim();
    if (!url) continue;
    const norm = normalizeJobUrl(url);
    if (primaryNorm && norm === primaryNorm) continue;
    const source = typeof entry?.source === "string" && entry.source ? entry.source : undefined;
    const addedAt = typeof entry?.addedAt === "string" && entry.addedAt ? entry.addedAt : fallbackAddedAt;
    const prior = byNorm.get(norm);
    if (!prior) {
      byNorm.set(norm, { url, source, addedAt });
      continue;
    }
    const earlier = addedAt < prior.addedAt;
    byNorm.set(norm, {
      url: earlier ? url : prior.url,
      source: prior.source ?? source,
      addedAt: earlier ? addedAt : prior.addedAt
    });
  }
  return [...byNorm.values()].slice(0, Math.max(0, max));
}

// Also used by the tracker's posting-id display, so one board never reads as
// two different names.
export const ATS_LABELS: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  workday: "Workday",
  linkedin: "LinkedIn",
  indeed: "Indeed",
  glassdoor: "Glassdoor"
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Greenhouse / Lever / Ashby / LinkedIn / Indeed / Glassdoor ids are unique
// across the whole platform, so their keys omit the tenant. Workday req ids
// are only unique per tenant, so its key keeps the tenant.
function makeKey(ats: string, tenant: string, jobId: string, tenantScoped = false): AtsPostingKey {
  return {
    ats,
    tenant: tenant || "",
    jobId,
    key: tenantScoped ? `${ats}:${tenant}:${jobId}` : `${ats}:${jobId}`
  };
}

// Parse a stable ATS/job-board posting identity out of a URL, or null when the
// URL carries none. Conservative: only shapes where the id is genuinely the
// posting's identity are recognized — a wrong key is worse than no key.
export function atsPostingKey(url: string | undefined | null): AtsPostingKey | null {
  try {
    const u = new URL(String(url || ""));
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const segments = u.pathname.split("/").filter(Boolean);

    // Greenhouse: boards.greenhouse.io/<tenant>/jobs/<id> (also job-boards.*,
    // boards.eu.*), or an embedded board on a company site via ?gh_jid=<id>.
    if (/(^|\.)greenhouse\.io$/.test(host)) {
      const jobsIdx = segments.indexOf("jobs");
      const id = jobsIdx >= 0 ? segments[jobsIdx + 1] ?? "" : "";
      if (/^\d{4,}$/.test(id)) {
        return makeKey("greenhouse", jobsIdx > 0 ? segments[0].toLowerCase() : "", id);
      }
    }
    const ghJid = u.searchParams.get("gh_jid");
    if (ghJid && /^\d{4,}$/.test(ghJid)) return makeKey("greenhouse", "", ghJid);

    // Lever: jobs.lever.co/<tenant>/<uuid>
    if (/(^|\.)lever\.co$/.test(host) && segments.length >= 2 && UUID_RE.test(segments[1])) {
      return makeKey("lever", segments[0].toLowerCase(), segments[1].toLowerCase());
    }

    // Ashby: jobs.ashbyhq.com/<tenant>/<uuid>
    if (/(^|\.)ashbyhq\.com$/.test(host) && segments.length >= 2 && UUID_RE.test(segments[1])) {
      return makeKey("ashby", segments[0].toLowerCase(), segments[1].toLowerCase());
    }

    // SmartRecruiters: jobs.smartrecruiters.com/<Tenant>/<digits>(-slug)
    if (/(^|\.)smartrecruiters\.com$/.test(host) && segments.length >= 2) {
      const m = segments[1].match(/^(\d{6,})(?:-|$)/);
      if (m) return makeKey("smartrecruiters", segments[0].toLowerCase(), m[1]);
    }

    // Workday: <tenant>.wd<N>.myworkdayjobs.com/<site>/job/<location>/<slug>_<REQID>
    // The trailing _<REQID> (e.g. _JR-90210, _R123456) is the requisition id.
    if (/(^|\.)myworkdayjobs\.com$/.test(host)) {
      const tenant = host.split(".")[0];
      const last = segments[segments.length - 1] ?? "";
      const m = last.match(/_([A-Za-z]{0,4}-?\d{3,}(?:-\d+)?)$/);
      if (m && tenant && !/^wd\d+$/.test(tenant)) {
        return makeKey("workday", tenant, m[1].toUpperCase(), true);
      }
    }

    // LinkedIn: /jobs/view/<id>(-slug), or list views via ?currentJobId=<id>.
    if (/(^|\.)linkedin\.com$/.test(host)) {
      const viewIdx = segments.indexOf("view");
      const fromPath = viewIdx >= 0 ? (segments[viewIdx + 1] ?? "").match(/^(\d{6,})/) : null;
      const fromParam = (u.searchParams.get("currentJobId") ?? "").match(/^(\d{6,})$/);
      const id = fromPath?.[1] ?? fromParam?.[1];
      if (id) return makeKey("linkedin", "", id);
    }

    // Indeed: /viewjob?jk=<hex>
    if (/(^|\.)indeed\.com$/.test(host)) {
      const jk = u.searchParams.get("jk");
      if (jk && /^[0-9a-f]{8,}$/i.test(jk)) return makeKey("indeed", "", jk.toLowerCase());
    }

    // Glassdoor: ?jobListingId=<digits>
    if (/(^|\.)glassdoor\.(com|co\.[a-z]{2}|[a-z]{2})$/.test(host)) {
      const id = u.searchParams.get("jobListingId");
      if (id && /^\d{6,}$/.test(id)) return makeKey("glassdoor", "", id);
    }

    return null;
  } catch {
    return null;
  }
}

// Company sites and boards often print the ATS requisition id in the posting
// body ("Requisition ID: JR-2931", "Job ID: 2024-118"), which survives across
// boards even when the URLs share nothing. Conservative: requires an explicit
// id-ish label, a digit-bearing value, and rejects bare years.
const REQ_ID_RE =
  /\b(req(?:uisition)?|job|posting|position)\s*(id|number|no\.?|#)\s*[:\-#]?\s*([A-Za-z]{0,6}[-_ ]?\d[\dA-Za-z-]{2,18})/i;

export type TextPostingIdentity = {
  id: string;
  label: string;
};

export function postingIdentityFromText(text: string | undefined | null): TextPostingIdentity | null {
  const head = String(text || "").slice(0, 6000);
  const m = head.match(REQ_ID_RE);
  if (!m) return null;
  const id = m[3].replace(/[\s_]+/g, "-").toUpperCase().replace(/-+$/, "");
  const digits = id.replace(/[^0-9]/g, "");
  if (/^(19|20)\d{2}$/.test(digits)) return null; // a bare year is not an id
  if (digits.length < 4 && !/^[A-Z]+-?\d{3,}$/.test(id)) return null;

  const noun = /^req/i.test(m[1])
    ? "Requisition"
    : `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}`;
  const kind = /^id$/i.test(m[2]) ? "ID" : "number";
  return { id, label: `${noun} ${kind}` };
}

export function requisitionIdFromText(text: string | undefined | null): string {
  return postingIdentityFromText(text)?.id ?? "";
}

// "Acme, Inc." / "ACME Corp" / "acme" all compare equal. Only legal suffixes
// are stripped — brand words ("Labs", "Health") stay, since removing them
// would merge genuinely different companies.
export function normalizeCompanyName(name: string | undefined | null): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:incorporated|inc|llc|llp|ltd|limited|corp|corporation|company|co|gmbh|plc|ag|bv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "Software Engineer II (R-1234, Remote)" → "software engineer ii".
// Level markers (ii, iii, senior) are kept — different levels are different
// roles. Parentheticals/brackets are dropped: they carry req ids and location
// tags, not role identity.
export function normalizeRoleTitle(title: string | undefined | null): string {
  return String(title || "")
    .toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLocationText(value: string | undefined | null): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// True unless the two locations actively contradict each other. Unknown on
// either side is compatible (missing data must not block a duplicate warning),
// "remote" is compatible with anything, and sharing any substantial token
// ("new york ny" vs "new york") is compatible.
export function locationsCompatible(a?: string | null, b?: string | null): boolean {
  const na = normalizeLocationText(a);
  const nb = normalizeLocationText(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  if (na.includes("remote") || nb.includes("remote")) return true;
  const tokensA = new Set(na.split(" "));
  return nb.split(" ").some((t) => t.length >= 3 && tokensA.has(t));
}

const FINGERPRINT_CHARS = 15_000;
const FINGERPRINT_MAX_TOKENS = 1_500;
const FINGERPRINT_MAX_SHINGLES = 2_000;
// Fuzzy duplicate warnings need enough content on BOTH sides to distinguish a
// real repost from company boilerplate or a few shared role terms. Exact URL /
// ATS-id and requisition-id tiers do not depend on these floors.
const COMPARABLE_FINGERPRINT_MIN_TOKENS = 50;
const POSSIBLE_REPOST_MIN_SIMILARITY = 0.78;
const POSSIBLE_REPOST_MIN_SEQUENCE_OVERLAP = 0.65;
const POSSIBLE_REPOST_MIN_LENGTH_RATIO = 0.65;
// Conflicting ids are much stronger counter-evidence than missing ids. Raise a
// review-only candidate only when both records expose an identity and their
// metadata plus substantial descriptions are nearly indistinguishable.
const CONFLICTING_ID_REVIEW_MIN_TOKENS = 60;
const CONFLICTING_ID_REVIEW_MIN_SIMILARITY = 0.96;
const CONFLICTING_ID_REVIEW_MIN_SEQUENCE_OVERLAP = 0.94;
const CONFLICTING_ID_REVIEW_MIN_LENGTH_RATIO = 0.9;

function jdTokens(text: string | undefined | null): string[] {
  return String(text || "")
    .toLowerCase()
    .slice(0, FINGERPRINT_CHARS)
    .split(/[^a-z0-9+#.]+/)
    .filter((token) => token.length >= 4 && !/^[\d.]+$/.test(token));
}

// Compact content fingerprint of a job description: the set of distinct
// substantial tokens. Set-of-tokens (vs shingles) is deliberately loose so a
// repost with shuffled sections still scores high, while different roles at
// the same company (different duties/stack) score low. Bare numbers are
// excluded — dates and salary figures churn between reposts of the same job.
export function jdFingerprint(text: string | undefined | null): Set<string> {
  return fingerprintOf(jdTokens(text));
}

function fingerprintOf(tokens: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const token of tokens) {
    set.add(token);
    if (set.size >= FINGERPRINT_MAX_TOKENS) break;
  }
  return set;
}

// Ordered three-token shingles keep shared company boilerplate or a similar
// keyword inventory from looking like the same posting. Reordered sections
// still retain their within-sentence shingles, while unrelated prose that uses
// the same vocabulary does not.
function shinglesOf(tokens: readonly string[]): Set<string> {
  const shingles = new Set<string>();
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    shingles.add(`${tokens[index]}\u0001${tokens[index + 1]}\u0001${tokens[index + 2]}`);
    if (shingles.size >= FINGERPRINT_MAX_SHINGLES) break;
  }
  return shingles;
}

// Jaccard similarity of two fingerprints, 0..1. Empty fingerprints never match.
export function jdSimilarity(a: Set<string> | undefined | null, b: Set<string> | undefined | null): number {
  if (!a?.size || !b?.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const token of small) if (large.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function setContainment(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const value of small) if (large.has(value)) intersection += 1;
  return intersection / small.size;
}

function setSizeRatio(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  return Math.min(a.size, b.size) / Math.max(a.size, b.size);
}

// app.title is usually "Role at Company" (makeApplicationRecord); recover the
// role half when the record has no explicit role field.
function roleFromTitle(title: string | undefined | null): string {
  return String(title || "").split(/\s+at\s+/i)[0] ?? "";
}

function candidateText(app: SignatureInput): string {
  const raw = typeof app.rawJobDescription === "string" ? app.rawJobDescription : "";
  const prepared = typeof app.jobDescription === "string" ? app.jobDescription : "";
  return raw.trim() ? raw : prepared;
}

/** Strongest first. Exported so callers rank edges by the same order. */
export const CONFIDENCE_RANK: Record<DuplicateConfidence, number> = { exact: 0, high: 1, possible: 2 };

// Precompute a record's comparison signature once. Works for both a stored
// application (jobUrl + sourceUrls + jobDescription/rawJobDescription) and an
// apply-time target ({ jobUrl, jobText, company, role, location }). Every known
// URL of the record (its jobUrl AND all sourceUrls) contributes to the posting-id
// and normalized-URL sets, so a canonical record keeps matching no matter which
// board the other side is on.
function buildSignature(rec: SignatureInput): Signature {
  const urls = [rec?.jobUrl, ...(Array.isArray(rec?.sourceUrls) ? rec.sourceUrls.map((s) => s?.url) : [])]
    .filter((u): u is string => typeof u === "string" && !!u.trim());
  const atsKeys = new Map<string, AtsPostingKey>(); // key string -> { ats, jobId, ... } for evidence
  const normUrls = new Set<string>();
  for (const url of urls) {
    const key = atsPostingKey(url);
    if (key) atsKeys.set(key.key, key);
    normUrls.add(normalizeJobUrl(url.trim()));
  }
  const text = typeof rec?.jobText === "string" ? rec.jobText : candidateText(rec ?? {});
  return {
    atsKeys,
    normUrls,
    reqId: requisitionIdFromText(text),
    company: normalizeCompanyName(rec?.company),
    role: normalizeRoleTitle(rec?.role || roleFromTitle(rec?.title)),
    location: rec?.location,
    text
  };
}

// One memo per scan call: each description is tokenized at most once, and only
// when a tier reads it. Most pairs are decided by ids or metadata first. Phrase
// shingles are rarer still (only near-identical descriptions reach them).
function contentFeatureMemo(): (sig: Signature) => ContentFeatures {
  const memo = new Map<Signature, ContentFeatures>();
  return (sig) => {
    let features = memo.get(sig);
    if (!features) {
      let shingles: Set<string> | undefined;
      features = {
        fingerprint: jdFingerprint(sig.text),
        shingles: () => (shingles ??= shinglesOf(jdTokens(sig.text)))
      };
      memo.set(sig, features);
    }
    return features;
  };
}

// The single layered-match implementation, over two precomputed signatures.
// Order is strongest-first; the first tier that fires wins. Symmetric in a and b,
// so it can drive both the target-vs-list scan and the tracker-wide pairing.
//   level      "same-posting" | "repost" | "same-company-role"
//   confidence "exact" (definitive identity; callers may still offer a bypass)
//              | "high" (merge with user consent)
//              | "possible" (warn only, never auto-merge)
//
// The tracker-wide scan compares only the pairs candidatePairs produces. A tier
// that can accept a pair outside them must extend candidatePairs too, or the
// scan will silently miss it (duplicate-scan-scale-eval catches the gap).
function matchSignatures(
  a: Signature,
  b: Signature,
  features: (sig: Signature) => ContentFeatures
): MatchResult | null {
  // Tier 1: a posting id shared by any URL of each side.
  for (const [key, meta] of a.atsKeys) {
    if (b.atsKeys.has(key)) {
      return {
        level: "same-posting",
        confidence: "exact",
        evidence: [`Same ${ATS_LABELS[meta.ats] ?? meta.ats} posting (#${meta.jobId})`]
      };
    }
  }

  // Tier 2: the same requisition id printed in both descriptions is definitive.
  // It is skipped when both sides name different companies because internal job
  // numbers can collide across employers.
  if (a.reqId && a.reqId === b.reqId) {
    const companiesConflict = Boolean(a.company && b.company && a.company !== b.company);
    if (!companiesConflict) return { level: "same-posting", confidence: "exact", evidence: [`Same requisition ID ${a.reqId}`] };
  }

  const aHasExplicitId = Boolean(a.atsKeys.size || a.reqId);
  const bHasExplicitId = Boolean(b.atsKeys.size || b.reqId);
  let locationMemo: boolean | undefined;
  const compatibleLocation = (): boolean =>
    (locationMemo ??= locationsCompatible(a.location, b.location));

  // Description features — tokenizing, then up to ~1,500 fingerprint plus
  // ~2,000 shingle lookups per pair — are the expensive part of this function,
  // and MOST PAIRS NEVER CONSUME THEM. A pair with an explicit id on only one
  // side is rejected outright further down, and every tier that does read them
  // is gated first on company/role/location agreement. Each accessor is lazy
  // and memoized, and every condition below orders its pure operands so the
  // metadata comparisons run first; && short-circuits, so the order never
  // changes a result.
  const aFingerprint = (): Set<string> => features(a).fingerprint;
  const bFingerprint = (): Set<string> => features(b).fingerprint;
  const lengthRatio = (): number => setSizeRatio(aFingerprint(), bFingerprint());
  const descriptionsComparable = (): boolean =>
    aFingerprint().size >= COMPARABLE_FINGERPRINT_MIN_TOKENS &&
    bFingerprint().size >= COMPARABLE_FINGERPRINT_MIN_TOKENS;
  let similarityMemo = -1;
  const similarityOf = (): number =>
    similarityMemo >= 0 ? similarityMemo : (similarityMemo = jdSimilarity(aFingerprint(), bFingerprint()));
  let sequenceMemo = -1;
  const sequenceOverlapOf = (): number =>
    sequenceMemo >= 0
      ? sequenceMemo
      : (sequenceMemo = setContainment(features(a).shingles(), features(b).shingles()));
  const similarityPctOf = (): number => Math.round(similarityOf() * 100);

  // Tier 3: different explicit ids normally identify separate postings. Keep
  // one narrow review-only escape hatch for likely data-entry errors: both
  // sides must expose an id, agree on company/title and compatible location,
  // and have nearly identical substantial descriptions. Evaluate this BEFORE
  // URL equality so a shared generic/company URL cannot override contradictory
  // posting ids. This is "possible", so callers never merge automatically.
  if (aHasExplicitId && bHasExplicitId) {
    const sameCompany = Boolean(a.company && b.company && a.company === b.company);
    const sameRole = Boolean(a.role && b.role && a.role === b.role);
    if (
      sameCompany &&
      sameRole &&
      compatibleLocation() &&
      aFingerprint().size >= CONFLICTING_ID_REVIEW_MIN_TOKENS &&
      bFingerprint().size >= CONFLICTING_ID_REVIEW_MIN_TOKENS &&
      lengthRatio() >= CONFLICTING_ID_REVIEW_MIN_LENGTH_RATIO &&
      similarityOf() >= CONFLICTING_ID_REVIEW_MIN_SIMILARITY &&
      sequenceOverlapOf() >= CONFLICTING_ID_REVIEW_MIN_SEQUENCE_OVERLAP
    ) {
      return {
        level: "same-company-role",
        confidence: "possible",
        evidence: ["Posting IDs differ", "Same company and title", `${similarityPctOf()}% description overlap`]
      };
    }
    // Ordinary conflicting-id cases stay separate even when a normalized URL
    // happens to match.
    return null;
  }

  // Tier 4: a normalized URL shared by either side, provided explicit ids did
  // not conflict above. This still catches no-id and one-sided-id records for
  // the exact same posting URL.
  for (const url of a.normUrls) {
    if (b.normUrls.has(url)) return { level: "same-posting", confidence: "exact", evidence: ["Same posting URL"] };
  }

  // An id on only one side is not enough evidence to compare identities and
  // must not fall through to content matching.
  if (aHasExplicitId || bHasExplicitId) return null;

  // Tier 5: no ids on either side, so require company/title agreement plus
  // substantial lexical AND ordered-phrase overlap. This deliberately favors a
  // missed advisory over a false duplicate warning.
  if (a.company && b.company && a.company === b.company) {
    const sameRole = Boolean(a.role && b.role && a.role === b.role);
    if (
      sameRole &&
      compatibleLocation() &&
      descriptionsComparable() &&
      lengthRatio() >= 0.75 &&
      similarityOf() >= 0.88 &&
      sequenceOverlapOf() >= 0.8
    ) {
      return { level: "repost", confidence: "high", evidence: ["Same company and title", `${similarityPctOf()}% description overlap`] };
    }
    if (
      !sameRole &&
      compatibleLocation() &&
      descriptionsComparable() &&
      lengthRatio() >= 0.82 &&
      similarityOf() >= 0.94 &&
      sequenceOverlapOf() >= 0.88
    ) {
      return { level: "repost", confidence: "high", evidence: ["Same company", `${similarityPctOf()}% description overlap (retitled posting)`] };
    }
    if (
      sameRole &&
      compatibleLocation() &&
      descriptionsComparable() &&
      lengthRatio() >= POSSIBLE_REPOST_MIN_LENGTH_RATIO &&
      similarityOf() >= POSSIBLE_REPOST_MIN_SIMILARITY &&
      sequenceOverlapOf() >= POSSIBLE_REPOST_MIN_SEQUENCE_OVERLAP
    ) {
      // Same title, compatible location, and strongly similar substantial
      // descriptions could indicate a refresh. Flag, never auto-merge.
      return {
        level: "same-company-role",
        confidence: "possible",
        evidence: ["Same company and title", `${similarityPctOf()}% description overlap`]
      };
    }
    // Same metadata with weak/incomplete description evidence (or contradicting
    // locations below the high-confidence overlap) is a separate opening.
  }

  // Company unknown on a side (common for board pages): near-identical
  // descriptions still identify a repost. This is stricter than the
  // company/title path because there is less corroborating metadata. Known,
  // contradictory roles or locations are disqualifying evidence.
  if (
    (!a.company || !b.company) &&
    (!a.role || !b.role || a.role === b.role) &&
    compatibleLocation() &&
    aFingerprint().size >= 60 &&
    bFingerprint().size >= 60 &&
    lengthRatio() >= 0.85 &&
    similarityOf() >= 0.95 &&
    sequenceOverlapOf() >= 0.9
  ) {
    return { level: "repost", confidence: "high", evidence: [`${similarityPctOf()}% identical description`] };
  }

  return null;
}

// A conservative cache version for the React duplicate scan. It shares the
// matcher's effective text and role selectors, but intentionally keeps safe
// over-invalidation for raw URL and metadata changes rather than pretending to
// be a canonical equality representation.
export function duplicateCandidateKey(rec: DuplicateCandidate): string {
  const dismissedIds = [...new Set(rec.duplicateDismissedIds ?? [])].sort();
  const parts = [
    rec.id,
    rec.jobUrl,
    rec.company,
    rec.role || roleFromTitle(rec.title),
    rec.location,
    candidateText(rec).slice(0, FINGERPRINT_CHARS),
    ...(rec.sourceUrls ?? []).map((entry) => entry?.url),
    ...dismissedIds
  ];
  let length = 0;
  let firstHash = 2166136261;
  let secondHash = 0x9e3779b9;
  const mix = (value: number) => {
    firstHash = Math.imul(firstHash ^ value, 16777619);
    secondHash = Math.imul(secondHash ^ value, 2246822519);
    secondHash ^= secondHash >>> 13;
  };
  for (const value of parts) {
    const text = String(value ?? "");
    length += text.length;
    // Length-prefix every part so embedded NULs or empty fields cannot make
    // two different field sequences feed the same character stream.
    mix(text.length & 0xff);
    mix((text.length >>> 8) & 0xff);
    mix((text.length >>> 16) & 0xff);
    mix((text.length >>> 24) & 0xff);
    for (let index = 0; index < text.length; index += 1) {
      mix(text.charCodeAt(index));
    }
  }
  return `${length.toString(36)}-${(firstHash >>> 0).toString(36)}-${(secondHash >>> 0).toString(36)}`;
}

// Layered duplicate scan of the current job target against stored applications.
// Returns every match, strongest confidence first. `target` is
// { jobUrl?, jobText?, company?, role?, location? }.
export function findDuplicateApplications<T extends DuplicateCandidate>(
  target: DuplicateTarget,
  applications: readonly T[] | undefined | null
): DuplicateMatch<T>[] {
  const apps = Array.isArray(applications) ? applications : [];
  const targetSig = buildSignature(target ?? {});
  const features = contentFeatureMemo();
  const matches: DuplicateMatch<T>[] = [];
  for (const app of apps) {
    if (!app || typeof app !== "object") continue;
    const match = matchSignatures(targetSig, buildSignature(app), features);
    if (match) matches.push({ application: app, ...match });
  }
  matches.sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]);
  return matches;
}

// Every pair matchSignatures can accept shares one of these exact keys: a
// posting id (tier 1), requisition id (tier 2), normalized company (tiers 3 and
// 5a–c), or normalized URL (tier 4). The unknown-company tier (5d) needs no key
// but only pairs id-less records, at least one company-less, whose roles are
// equal or missing — so each id-less, company-less record is paired with the
// id-less records of its role plus the role-less ones (all of them when it has
// no role itself). Returns each pair once as i * n + j (i < j), ascending, which
// is exactly the order the all-pairs loop visited.
function candidatePairs(sigs: readonly Signature[]): Float64Array {
  const n = sigs.length;
  const buckets = new Map<string, number[]>();
  const noIdByRole = new Map<string, number[]>();
  const noId: number[] = [];
  const noIdNoCompany: number[] = [];
  const push = (map: Map<string, number[]>, key: string, index: number) => {
    const list = map.get(key);
    if (list) list.push(index);
    else map.set(key, [index]);
  };
  sigs.forEach((sig, index) => {
    for (const key of sig.atsKeys.keys()) push(buckets, `ats\u0000${key}`, index);
    if (sig.reqId) push(buckets, `req\u0000${sig.reqId}`, index);
    for (const url of sig.normUrls) push(buckets, `url\u0000${url}`, index);
    if (sig.company) push(buckets, `company\u0000${sig.company}`, index);
    if (sig.atsKeys.size || sig.reqId) return;
    noId.push(index);
    push(noIdByRole, sig.role, index);
    if (!sig.company) noIdNoCompany.push(index);
  });

  const codes: number[] = [];
  const add = (x: number, y: number) => {
    if (x !== y) codes.push(x < y ? x * n + y : y * n + x);
  };
  for (const list of buckets.values()) {
    for (let p = 0; p < list.length; p += 1) {
      for (let q = p + 1; q < list.length; q += 1) add(list[p], list[q]);
    }
  }
  const roleless = noIdByRole.get("") ?? [];
  for (const index of noIdNoCompany) {
    const role = sigs[index].role;
    for (const other of role ? noIdByRole.get(role) ?? [] : noId) add(index, other);
    if (role) for (const other of roleless) add(index, other);
  }
  // A pair can arrive through several keys; a numeric sort plus an adjacent
  // dedupe is far cheaper than a Set once candidates reach the millions.
  const sorted = Float64Array.from(codes).sort();
  let unique = 0;
  for (let k = 0; k < sorted.length; k += 1) {
    if (k === 0 || sorted[k] !== sorted[k - 1]) sorted[unique++] = sorted[k];
  }
  return sorted.subarray(0, unique);
}

// Above this many candidate pairs the memo keeps matches only. A tracker of
// mostly id-less, company-less, role-less records makes nearly every pair a
// candidate, and keeping every "no match" verdict would hold tens of MB.
const MEMO_NO_MATCH_PAIR_LIMIT = 250_000;

/**
 * Caller-owned reuse across repeated tracker scans (the client cache layer).
 * Records are immutable, so a signature and a pair verdict stay valid for as
 * long as the same record objects are passed again; new or edited records are
 * new objects and are recomputed. Dismissals are checked on every scan.
 */
export class DuplicateScanMemo {
  readonly signatures = new WeakMap<object, Signature>();
  readonly verdicts = new WeakMap<object, WeakMap<object, MatchResult | null>>();
  /** Pairs the last scan considered, and how many it had to compare afresh. */
  lastScan = { candidatePairs: 0, computedPairs: 0 };
}

// Tracker-wide duplicate scan: cluster ALL stored applications into duplicate
// groups (a one-time "Review duplicates" pass, not the per-apply warning). Each
// group has ≥2 applications joined transitively (A~B, B~C ⇒ one group of three,
// so a repost chain across three boards stays one group); `edges` records the
// pairwise evidence so the UI can show WHY each pair grouped, and `confidence` is
// the strongest edge in the group. Groups are strongest- then largest-first.
// Only candidate pairs are compared, in the same order an all-pairs loop would.
export function groupDuplicateApplications<T extends DuplicateCandidate>(
  applications: readonly T[] | undefined | null,
  memo?: DuplicateScanMemo
): DuplicateGroup<T>[] {
  const apps = (Array.isArray(applications) ? applications : []).filter((a) => a && typeof a === "object");
  const n = apps.length;
  const sigs = apps.map((application) => {
    const cached = memo?.signatures.get(application);
    if (cached) return cached;
    const sig = buildSignature(application);
    memo?.signatures.set(application, sig);
    return sig;
  });
  const dismissedIds = apps.map((application) => new Set(application.duplicateDismissedIds ?? []));
  const features = contentFeatureMemo();
  const candidates = candidatePairs(sigs);
  let computedPairs = 0;
  const verdict = (i: number, j: number): MatchResult | null => {
    let row = memo?.verdicts.get(apps[i]);
    const cached = row?.get(apps[j]);
    if (cached !== undefined) return cached;
    computedPairs += 1;
    const match = matchSignatures(sigs[i], sigs[j], features);
    if (memo && (match || candidates.length <= MEMO_NO_MATCH_PAIR_LIMIT)) {
      if (!row) memo.verdicts.set(apps[i], (row = new WeakMap()));
      row.set(apps[j], match);
    }
    return match;
  };

  // Union-find over app indices.
  const parent = apps.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i: number, j: number): void => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };

  const edges: ({ i: number; j: number } & MatchResult)[] = [];
  for (const pair of candidates) {
    const i = Math.floor(pair / n);
    const j = pair - i * n;
    if (
      apps[i].id &&
      apps[j].id &&
      (dismissedIds[i].has(apps[j].id) || dismissedIds[j].has(apps[i].id))
    ) {
      continue;
    }
    const match = verdict(i, j);
    if (match) {
      union(i, j);
      edges.push({ i, j, ...match });
    }
  }
  if (memo) memo.lastScan = { candidatePairs: candidates.length, computedPairs };

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root)!.push(i);
  }

  const groups: DuplicateGroup<T>[] = [];
  for (const idxs of byRoot.values()) {
    if (idxs.length < 2) continue;
    const inGroup = new Set(idxs);
    const groupEdges: DuplicateEdge[] = edges
      .filter((e) => inGroup.has(e.i) && inGroup.has(e.j))
      // Grouped applications always carry an id (see DuplicateCandidate); the
      // cast keeps the edge id type `string` for the UI consumers.
      .map((e) => ({ a: apps[e.i].id as string, b: apps[e.j].id as string, level: e.level, confidence: e.confidence, evidence: e.evidence }));
    const confidence = groupEdges.reduce<DuplicateConfidence>(
      (best, e) => (CONFIDENCE_RANK[e.confidence] < CONFIDENCE_RANK[best] ? e.confidence : best),
      "possible"
    );
    groups.push({ applications: idxs.map((i) => apps[i]), edges: groupEdges, confidence });
  }

  groups.sort(
    (x, y) => CONFIDENCE_RANK[x.confidence] - CONFIDENCE_RANK[y.confidence] || y.applications.length - x.applications.length
  );
  return groups;
}
