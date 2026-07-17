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
//   Tier 2  normalized URL equality              → exact  "same-posting"
//   Tier 3  requisition id found in the JD text  → high   "same-posting"
//   Tier 4  company + title + description        → high   "repost"
//           overlap (or overlap alone when the      /possible "same-company-role"
//           company is unknown)
//
// "Truly separate openings with the same title" stay unmatched: same company +
// same title with incompatible locations and low description overlap returns
// no match at all.

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
  /** Job description text — raw posting text preferred over a distilled brief. */
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

// Internal — a precomputed comparison signature for one record.
type Signature = {
  atsKeys: Map<string, AtsPostingKey>;
  normUrls: Set<string>;
  reqId: string;
  company: string;
  role: string;
  location: string | undefined;
  fingerprint: Set<string>;
};

// Internal — the outcome of comparing two signatures (before an application is
// attached).
type MatchResult = { level: DuplicateLevel; confidence: DuplicateConfidence; evidence: string[] };

// Tracking/analytics query params stripped during URL normalization.
// (Descended from server/extension/index.ts, which now re-exports
// normalizeJobUrl as normalizeUrl.) normalizeJobUrl equality drives SILENT
// tracker merges (tier 2), so this set is deliberately NARROWER than the old
// display-only version: only params that are unambiguously analytics on every
// site are stripped. Ambiguous ones the old set had — position, src, source,
// ref, refid, savedjobid, pagenum — are KEPT, because some career sites use
// them as the posting identifier and over-stripping would silently merge two
// different jobs. Under-stripping only costs a tier-2 miss that the ATS-id,
// requisition-id, and content tiers can still catch.
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

// Shared normalize-dedup for discovered posting URLs ("Found on" entries).
// One implementation for the THREE writers — the client tracker's upsert merge,
// its duplicate-group merge, and the server sanitizer — so their rules cannot
// drift. Entries whose normalized URL equals the primary are dropped; the same
// normalized URL keeps its EARLIEST addedAt (ISO strings compare lexically) and
// prefers whichever occurrence has a source label; capped at `max`.
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

const ATS_LABELS: Record<string, string> = {
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
  /\b(?:req(?:uisition)?|job|posting|position)\s*(?:id|number|no\.?|#)\s*[:\-#]?\s*([A-Za-z]{0,6}[-_ ]?\d[\dA-Za-z-]{2,18})/i;

export function requisitionIdFromText(text: string | undefined | null): string {
  const head = String(text || "").slice(0, 6000);
  const m = head.match(REQ_ID_RE);
  if (!m) return "";
  const id = m[1].replace(/[\s_]+/g, "-").toUpperCase().replace(/-+$/, "");
  const digits = id.replace(/[^0-9]/g, "");
  if (/^(19|20)\d{2}$/.test(digits)) return ""; // a bare year is not an id
  return digits.length >= 4 || /^[A-Z]+-?\d{3,}$/.test(id) ? id : "";
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

// Compact content fingerprint of a job description: the set of distinct
// substantial tokens. Set-of-tokens (vs shingles) is deliberately loose so a
// repost with shuffled sections still scores high, while different roles at
// the same company (different duties/stack) score low. Bare numbers are
// excluded — dates and salary figures churn between reposts of the same job.
export function jdFingerprint(text: string | undefined | null): Set<string> {
  const tokens = String(text || "")
    .toLowerCase()
    .slice(0, FINGERPRINT_CHARS)
    .split(/[^a-z0-9+#.]+/);
  const set = new Set<string>();
  for (const token of tokens) {
    if (token.length < 4) continue;
    if (/^[\d.]+$/.test(token)) continue;
    set.add(token);
    if (set.size >= FINGERPRINT_MAX_TOKENS) break;
  }
  return set;
}

// Jaccard similarity of two fingerprints, 0..1. Empty fingerprints never match.
export function jdSimilarity(a: Set<string> | undefined | null, b: Set<string> | undefined | null): number {
  if (!a?.size || !b?.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const token of small) if (large.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

// app.title is usually "Role at Company" (makeApplicationDraft); recover the
// role half when the record has no explicit role field.
function roleFromTitle(title: string | undefined | null): string {
  return String(title || "").split(/\s+at\s+/i)[0] ?? "";
}

function candidateText(app: SignatureInput): string {
  const raw = typeof app.rawJobDescription === "string" ? app.rawJobDescription : "";
  const distilled = typeof app.jobDescription === "string" ? app.jobDescription : "";
  return raw.trim() ? raw : distilled;
}

const CONFIDENCE_RANK: Record<DuplicateConfidence, number> = { exact: 0, high: 1, possible: 2 };

// Precompute a record's comparison signature once. Works for both a stored
// application (jobUrl + sourceUrls + jobDescription/rawJobDescription) and an
// apply-time target ({ jobUrl, jobText, company, role, location }). Every known
// URL of the record (its jobUrl AND all sourceUrls) contributes to the posting-id
// and normalized-URL sets, so a canonical record keeps matching no matter which
// board the other side is on. Building this once per record makes the O(n²)
// tracker-wide grouping cheap (n fingerprints, not n²).
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
    fingerprint: jdFingerprint(text)
  };
}

// The single layered-match implementation, over two precomputed signatures.
// Order is strongest-first; the first tier that fires wins. Symmetric in a and b,
// so it can drive both the target-vs-list scan and the tracker-wide pairing.
//   level      "same-posting" | "repost" | "same-company-role"
//   confidence "exact" (safe to merge silently) | "high" (merge with user
//              consent) | "possible" (warn only, never auto-merge)
function matchSignatures(a: Signature, b: Signature): MatchResult | null {
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
  // Tier 2: a normalized URL shared by any URL of each side.
  for (const url of a.normUrls) {
    if (b.normUrls.has(url)) return { level: "same-posting", confidence: "exact", evidence: ["Same posting URL"] };
  }

  const similarity = jdSimilarity(a.fingerprint, b.fingerprint);
  const similarityPct = Math.round(similarity * 100);

  // Tier 3: a requisition id printed in both descriptions. Skipped when both
  // sides name a company and they differ (job numbers collide across ATSes).
  if (a.reqId && a.reqId === b.reqId) {
    const companiesConflict = Boolean(a.company && b.company && a.company !== b.company);
    if (!companiesConflict) return { level: "same-posting", confidence: "high", evidence: [`Same requisition ID ${a.reqId}`] };
  }

  // Tier 4: company + title + description overlap.
  if (a.company && b.company && a.company === b.company) {
    const sameRole = Boolean(a.role && b.role && a.role === b.role);
    if (sameRole && similarity >= 0.85) {
      return { level: "repost", confidence: "high", evidence: ["Same company and title", `${similarityPct}% description overlap`] };
    }
    if (!sameRole && similarity >= 0.9) {
      return { level: "repost", confidence: "high", evidence: ["Same company", `${similarityPct}% description overlap (retitled posting)`] };
    }
    if (sameRole && locationsCompatible(a.location, b.location)) {
      // Same title at the same company but the descriptions don't line up: could
      // be a refresh OR a separate opening — flag, never auto-merge.
      return {
        level: "same-company-role",
        confidence: "possible",
        evidence: ["Same company and title", similarity > 0 ? `${similarityPct}% description overlap` : "descriptions not comparable"]
      };
    }
    // Same company + same title + contradicting locations + low overlap:
    // treated as truly separate openings — no match.
  }

  // Company unknown on a side (common for board pages): near-identical
  // descriptions still identify a repost. The floor on BOTH fingerprint sizes
  // keeps trivially short texts from matching everything.
  if ((!a.company || !b.company) && similarity >= 0.92 && a.fingerprint.size >= 60 && b.fingerprint.size >= 60) {
    return { level: "repost", confidence: "high", evidence: [`${similarityPct}% identical description`] };
  }

  return null;
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
  const matches: DuplicateMatch<T>[] = [];
  for (const app of apps) {
    if (!app || typeof app !== "object") continue;
    const match = matchSignatures(targetSig, buildSignature(app));
    if (match) matches.push({ application: app, ...match });
  }
  matches.sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]);
  return matches;
}

// Tracker-wide duplicate scan: cluster ALL stored applications into duplicate
// groups (a one-time "Review duplicates" pass, not the per-apply warning). Each
// group has ≥2 applications joined transitively (A~B, B~C ⇒ one group of three,
// so a repost chain across three boards stays one group); `edges` records the
// pairwise evidence so the UI can show WHY each pair grouped, and `confidence` is
// the strongest edge in the group. Groups are strongest- then largest-first.
// O(n²) over precomputed signatures — fine for a manual, on-demand scan.
export function groupDuplicateApplications<T extends DuplicateCandidate>(
  applications: readonly T[] | undefined | null
): DuplicateGroup<T>[] {
  const apps = (Array.isArray(applications) ? applications : []).filter((a) => a && typeof a === "object");
  const n = apps.length;
  const sigs = apps.map(buildSignature);

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
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const match = matchSignatures(sigs[i], sigs[j]);
      if (match) {
        union(i, j);
        edges.push({ i, j, ...match });
      }
    }
  }

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
