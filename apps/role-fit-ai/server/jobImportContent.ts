// Pure posting-content parsing for job import: the single HTML→text converter
// and the exact-posting selectors for each recognized source. No I/O here;
// jobImport.ts owns URL targets, fetch sequencing, caches, and HTTP outcomes.

// Decode a numeric character reference, clamping control chars (which could
// inject fake structure into the prompt) and rejecting out-of-range values.
// fromCodePoint (not fromCharCode) so astral code points aren't truncated.
function fromCharRef(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return " ";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;|&apos;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&#(\d+);/g, (_, n) => fromCharRef(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => fromCharRef(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, " ");
}

// Convert posting HTML to readable text while keeping paragraph/bullet breaks
// (the front-end job analyzer and the description box both read better with them).
export function htmlToText(html: unknown): string {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr|section|header|footer|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlAttr(tag: string, attr: string): string {
  const match = String(tag || "").match(new RegExp(`${attr}=["']([^"']*)["']`, "i"));
  return match?.[1] ?? "";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Mirrors isLikelyProse in src/lib/jobExtract.ts. "$" stays out of the char
// class so salary lines like "$90k-$110k" are not penalized; "$(...)" jQuery
// calls are still caught by the JS-pattern test.
function isCodeShapedLine(t: string): boolean {
  const codeChars = (t.match(/[{}();=<>|]/g) ?? []).length;
  if (codeChars / t.length > 0.08) return true;
  return /function\s*\(|=>|==|\bvar\s|\$\(/.test(t);
}

// JS-only ATS pages (e.g. UltiPro) can clear the length gate with script and
// template junk. Weigh by characters, not lines: such pages hide a few huge
// code lines among dozens of one-char bullet/punctuation lines, so a
// line-count majority misses them. Letter-free lines count as unreadable too.
export function isMostlyCodeShaped(text: string): boolean {
  let readable = 0;
  let unreadable = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (isCodeShapedLine(t) || !/[a-zA-Z]/.test(t)) unreadable += t.length;
    else readable += t.length;
  }
  return unreadable >= readable;
}

function readableBody(html: unknown): string {
  const text = htmlToText(html);
  return text.length >= 200 && !isMostlyCodeShaped(text) ? text : "";
}

function headerLine(value: unknown): string {
  return typeof value === "string" ? htmlToText(value).replace(/\s+/g, " ").trim().slice(0, 500) : "";
}

function postingText(header: Array<[string, unknown]>, body: string): string {
  const lines = header.map(([label, field]) => {
    const line = headerLine(field);
    return line ? `${label}: ${line}` : "";
  }).filter(Boolean);
  return htmlToText([...lines, "", body].join("\n"));
}

function sections(parts: Array<[string, unknown]>): string {
  return parts.map(([heading, html]) => {
    const text = htmlToText(html);
    return text ? [heading, text].filter(Boolean).join("\n") : "";
  }).filter(Boolean).join("\n\n");
}

function metaContent(html: string, name: string): string {
  const meta = String(html || "")
    .match(/<meta\b[^>]*>/gi)
    ?.find((tag) => {
      const key = htmlAttr(tag, "name") || htmlAttr(tag, "property");
      return key.toLowerCase() === name.toLowerCase();
    });
  return meta ? htmlToText(htmlAttr(meta, "content")) : "";
}

function linkedInHeaderLines(html: string): string[] {
  const title = metaContent(html, "og:title") || metaContent(html, "twitter:title");
  const match = title.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+(.+?)\s*\|\s*LinkedIn\b/i);
  if (!match) return [];
  return [
    `Company: ${match[1].trim()}`,
    `Role: ${match[2].trim()}`,
    `Location: ${match[3].trim()}`
  ];
}

function linkedInCriteriaLines(html: string): string[] {
  const items = [...String(html || "").matchAll(/<li[^>]*class=["'][^"']*description__job-criteria-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)];
  return items
    .map((item) => htmlToText(item[1]).split("\n").map((line) => line.trim()).filter(Boolean))
    .map((parts) => {
      if (parts.length < 2) return "";
      return `${parts[0].replace(/:$/, "")}: ${parts.slice(1).join(" ")}`;
    })
    .filter(Boolean);
}

export function linkedInJobText(html: string): string {
  if (!/(\bshow-more-less-html__markup\b|\bdescription__job-criteria-item\b)/i.test(String(html || ""))) {
    return "";
  }
  const body = [...String(html || "").matchAll(/<div[^>]*class=["'][^"']*show-more-less-html__markup[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => htmlToText(match[1]))
    .filter((text) => text.length > 80);
  if (!body.length) return "";

  const lines = [...linkedInHeaderLines(html), ...linkedInCriteriaLines(html), body.join("\n\n")];
  return htmlToText(lines.join("\n\n"));
}

function firstHtmlText(html: string, pattern: RegExp): string {
  const match = String(html || "").match(pattern);
  return match ? htmlToText(match[1]) : "";
}

export function greenhouseEmbeddedJobText(html: string): string {
  const source = String(html || "");
  if (!/\bjob__description\b/i.test(source)) return "";

  const title = firstHtmlText(source, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const location = firstHtmlText(
    source,
    /<div\b[^>]*class=["'][^"']*\bjob__location\b[^"']*["'][^>]*>[\s\S]*?<div\b[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i
  );

  const descriptionStart = source.search(/<div\b[^>]*class=["'][^"']*\bjob__description\b[^"']*["'][^>]*>/i);
  if (descriptionStart < 0) return "";
  const rest = source.slice(descriptionStart);
  const endMarkers = [
    rest.search(/<div\b[^>]*class=["'][^"']*\bjob-alert\b/i),
    rest.search(/<div\b[^>]*class=["'][^"']*\bapplication--container\b/i),
    rest.search(/<div\b[^>]*class=["'][^"']*\bdivider\b/i)
  ].filter((index) => index > 0);
  const descriptionHtml = rest.slice(0, endMarkers.length ? Math.min(...endMarkers) : rest.length);
  const description = htmlToText(descriptionHtml);
  if (description.length < 200) return "";

  return htmlToText([
    title ? `Role: ${title}` : "",
    location ? `Location: ${location}` : "",
    description
  ].filter(Boolean).join("\n\n"));
}

export function ashbyPostingText(value: unknown, jobId: string): string {
  if (!isRecord(value) || !Array.isArray(value.jobs)) return "";
  const posting = value.jobs.find((candidate) =>
    isRecord(candidate) &&
    typeof candidate.id === "string" &&
    candidate.id.toLowerCase() === jobId.toLowerCase()
  );
  if (!isRecord(posting)) return "";
  const description = typeof posting.descriptionPlain === "string"
    ? htmlToText(posting.descriptionPlain)
    : htmlToText(posting.descriptionHtml);
  if (description.length < 200) return "";
  const compensation = isRecord(posting.compensation) ? posting.compensation.compensationTierSummary : "";
  return postingText([
    ["Role", posting.title],
    ["Location", posting.location],
    ["Employment type", posting.employmentType],
    ["Workplace", posting.workplaceType],
    ["Department", posting.department],
    ["Team", posting.team],
    ["Compensation", compensation]
  ], description);
}

// --- schema.org JobPosting ---------------------------------------------------

// Query parameters that select a posting; all others (tracking, locale,
// microsite) are ignored when comparing a structured URL with the request.
const SELECTOR_PARAMS = new Set([
  "pid", "id", "jobid", "job_id", "gh_jid", "ashby_jid", "opportunityid", "jk", "rid", "token", "requisitionid"
]);

function parseUrl(value: unknown, base?: URL): URL | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(decodeEntities(value.trim()), base);
  } catch {
    return null;
  }
}

function selectorParams(u: URL): Map<string, string> {
  const params = new Map<string, string>();
  for (const [key, value] of u.searchParams) {
    if (SELECTOR_PARAMS.has(key.toLowerCase())) params.set(key.toLowerCase(), value);
  }
  return params;
}

function pathSegments(u: URL): string[] {
  return u.pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
}

const isIdLike = (value: string): boolean => value.length >= 5 && /\d/.test(value);

// Whole path segments and selector values only: pieces of a slug (a ZIP code,
// a UUID chunk) are not job identities.
function requestedIds(u: URL): Set<string> {
  const ids = new Set<string>();
  for (const segment of pathSegments(u)) if (isIdLike(segment)) ids.add(segment.toLowerCase());
  for (const value of selectorParams(u).values()) if (isIdLike(value)) ids.add(value.toLowerCase());
  return ids;
}

// Same host, same selector params, and the same path — or one path extending
// an id-bearing path with a "-slug" suffix (e.g. /job/42989249-title, not /job/R-1-2).
function sameJobUrl(candidate: URL, requested: URL): boolean {
  if (candidate.hostname.toLowerCase() !== requested.hostname.toLowerCase()) return false;
  const want = selectorParams(requested);
  const have = selectorParams(candidate);
  if (want.size !== have.size || [...want].some(([key, value]) => have.get(key) !== value)) return false;
  const a = requested.pathname.replace(/\/+$/, "");
  const b = candidate.pathname.replace(/\/+$/, "");
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter !== longer && !(longer.startsWith(`${shorter}-`) && /^[a-z]/i.test(longer.slice(shorter.length + 1)))) {
    return false;
  }
  return want.size > 0 || /\d/.test(shorter.split("/").pop() ?? "");
}

function identifierValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(identifierValues);
  if (isRecord(value)) return identifierValues(value.value);
  if (typeof value === "string" || typeof value === "number") return [String(value).trim().toLowerCase()];
  return [];
}

const titleKey = (value: unknown): string =>
  String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function canonicalUrl(html: string, base: URL): URL | null {
  const tag = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i)?.[0] ?? "";
  return parseUrl(htmlAttr(tag, "href"), base);
}

// A provider-prefixed requisition (e.g. ACMEUSR117614EXTERNALENUS) binds only
// when the page's canonical names the bare identifier and the URL slug matches
// the posting title.
function prefixedRequisitionMatch(node: Record<string, unknown>, requested: URL, canonical: URL | null): boolean {
  if (!canonical || canonical.hostname.toLowerCase() !== requested.hostname.toLowerCase()) return false;
  const segments = pathSegments(requested).map((segment) => segment.toLowerCase());
  const canonicalSegments = new Set(pathSegments(canonical).map((segment) => segment.toLowerCase()));
  const slug = titleKey(pathSegments(requested).pop()?.replace(/[-_]+/g, " "));
  return identifierValues(node.identifier).some((id) =>
    isIdLike(id) &&
    canonicalSegments.has(id) &&
    segments.some((segment) => segment !== id && segment.includes(id)) &&
    slug !== "" &&
    slug === titleKey(node.title)
  );
}

function jobPostingNodes(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) return value.flatMap((item) => jobPostingNodes(item, depth + 1));
  if (!isRecord(value)) return [];
  const type = value["@type"];
  const isPosting = type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
  return [...(isPosting ? [value] : []), ...jobPostingNodes(value["@graph"], depth + 1)];
}

function postingLocation(value: unknown): string {
  const places = Array.isArray(value) ? value : [value];
  const names = places.map((place) => {
    const address = isRecord(place) ? place.address : undefined;
    if (!isRecord(address)) return "";
    const country = isRecord(address.addressCountry) ? address.addressCountry.name : address.addressCountry;
    return [address.addressLocality, address.addressRegion, country]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .join(", ");
  }).filter(Boolean);
  return [...new Set(names)].join("; ");
}

// Strictly parses application/ld+json blocks and returns the one JobPosting
// bound to the requested URL, id, or canonical requisition; ambiguity fails.
export function jobPostingJsonLdText(html: string, requested: URL): string {
  const source = String(html || "");
  const canonical = canonicalUrl(source, requested);
  const ids = requestedIds(requested);
  const texts = new Set<string>();
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\btype=["']?application\/ld\+json/i.test(match[1])) continue;
    let value: unknown;
    try {
      value = JSON.parse(match[2]);
    } catch {
      continue; // a malformed block is not evidence
    }
    for (const node of jobPostingNodes(value)) {
      const url = parseUrl(node.url, requested);
      // A node naming another URL on this host describes another posting.
      const urlBound = url !== null && sameJobUrl(url, requested);
      if (url && !urlBound && url.hostname.toLowerCase() === requested.hostname.toLowerCase()) continue;
      const bound = urlBound ||
        identifierValues(node.identifier).some((id) => isIdLike(id) && ids.has(id)) ||
        prefixedRequisitionMatch(node, requested, canonical);
      if (!bound) continue;
      const description = readableBody(node.description);
      if (!description) continue;
      const organization = isRecord(node.hiringOrganization) ? node.hiringOrganization.name : "";
      texts.add(postingText([
        ["Role", node.title],
        ["Company", organization],
        ["Location", postingLocation(node.jobLocation)]
      ], description));
    }
  }
  return texts.size === 1 ? [...texts][0] : "";
}

// True when readable page text already shows most of a structured posting's
// body, so a working generic import is kept rather than replaced.
export function pageShowsPosting(pageText: string, posting: string): boolean {
  const key = (line: string): string => line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const page = key(pageText);
  const lines = posting.split("\n")
    .filter((line) => !/^(Role|Company|Location): /.test(line))
    .map(key)
    .filter((line) => line.length >= 30);
  return lines.length > 0 && lines.filter((line) => page.includes(line)).length / lines.length >= 0.8;
}

// --- Source-specific posting data -------------------------------------------

export function oracleRequisitionText(value: unknown, jobId: string): string {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length !== 1) return "";
  const item = value.items[0];
  if (!isRecord(item) || String(item.Id ?? "") !== jobId) return "";
  const body = sections([
    ["", item.ExternalDescriptionStr],
    ["Responsibilities", item.ExternalResponsibilitiesStr],
    ["Qualifications", item.ExternalQualificationsStr]
  ]);
  if (!readableBody(body)) return "";
  return postingText([["Role", item.Title], ["Location", item.PrimaryLocation]], body);
}

export function icimsJobText(html: string): string {
  const source = String(html || "");
  const start = source.search(/<div\b[^>]*class=["'][^"']*\biCIMS_JobContent\b/i);
  if (start < 0) return "";
  const rest = source.slice(start);
  const end = rest.search(/<div\b[^>]*class=["'][^"']*\b(?:iCIMS_JobOptions|iCIMS_PageFooter)\b/i);
  if (end < 0) return "";
  const text = htmlToText(rest.slice(0, end));
  return readableBody(text) ? text : "";
}

export function dayforceJobText(html: string, jobId: string): string {
  const json = String(html || "").match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!json) return "";
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return "";
  }
  const props = isRecord(value) ? value.props : undefined;
  const pageProps = isRecord(props) ? props.pageProps : undefined;
  const job = isRecord(pageProps) ? pageProps.jobData : undefined;
  if (!isRecord(job) || String(job.jobPostingId ?? "") !== jobId) return "";
  const content = isRecord(job.jobPostingContent) ? job.jobPostingContent : {};
  if (!readableBody(content.jobDescription)) return "";
  const body = sections([
    ["", content.jobDescriptionHeader],
    ["", content.jobDescription],
    ["", content.jobDescriptionFooter]
  ]);
  return postingText([["Role", job.jobTitle]], body);
}

// Returns the JSON object literal starting at `index` when it is immediately
// closed by ")". String-aware so braces inside quoted text don't end the scan.
function jsonCallArgument(source: string, index: number): string {
  let start = index;
  while (/\s/.test(source[start] ?? "")) start += 1;
  if (source[start] !== "{") return "";
  let depth = 0;
  let inString = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        let close = i + 1;
        while (/\s/.test(source[close] ?? "")) close += 1;
        return source[close] === ")" ? source.slice(start, i + 1) : "";
      }
    }
  }
  return "";
}

const UKG_CALL = "new US.Opportunity.CandidateOpportunityDetail(";

export function ukgOpportunityText(html: string, opportunityId: string): string {
  const source = String(html || "");
  const call = source.indexOf(UKG_CALL);
  if (call < 0 || source.indexOf(UKG_CALL, call + 1) >= 0) return "";
  const literal = jsonCallArgument(source, call + UKG_CALL.length);
  let value: unknown;
  try {
    value = JSON.parse(literal);
  } catch {
    return "";
  }
  if (!isRecord(value) || String(value.Id ?? "").toLowerCase() !== opportunityId.toLowerCase()) return "";
  const description = readableBody(value.Description);
  if (!description) return "";
  const locations = (Array.isArray(value.Locations) ? value.Locations : []).map((location) => {
    const address = isRecord(location) ? location.Address : undefined;
    if (!isRecord(address)) return "";
    const state = isRecord(address.State) ? address.State.Code || address.State.Name : "";
    return [address.City, state].filter((part) => typeof part === "string" && part).join(", ");
  }).filter(Boolean);
  return postingText([
    ["Role", value.Title],
    ["Location", [...new Set(locations)].join("; ")],
    ["Status", value.OpportunityIsClosed === true ? "Closed" : ""]
  ], description);
}

export function workablePostingText(value: unknown, shortcode: string): string {
  if (!isRecord(value) || String(value.shortcode ?? "").toUpperCase() !== shortcode.toUpperCase()) return "";
  if (value.state !== "published" || !readableBody(value.description)) return "";
  const location = isRecord(value.location)
    ? [value.location.city, value.location.region, value.location.country]
      .filter((part) => typeof part === "string" && part).join(", ")
    : "";
  const body = sections([
    ["", value.description],
    ["Requirements", value.requirements],
    ["Benefits", value.benefits]
  ]);
  return postingText([["Role", value.title], ["Location", location]], body);
}

function stringList(value: unknown): string {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string" && item))].join("; ") : "";
}

export function eightfoldPositionText(value: unknown, positionId: string): string {
  const data = isRecord(value) ? value.data : undefined;
  if (!isRecord(data) || String(data.id ?? "") !== positionId || !readableBody(data.jobDescription)) return "";
  return postingText(
    [["Role", data.name], ["Location", stringList(data.locations) || data.location]],
    htmlToText(data.jobDescription)
  );
}

export function ripplingJobText(value: unknown, jobId: string): string {
  if (!isRecord(value) || String(value.uuid ?? "").toLowerCase() !== jobId) return "";
  const description = isRecord(value.description) ? value.description : {};
  if (!readableBody(description.role)) return "";
  const body = sections([["", description.role], ["About", description.company]]);
  return postingText([["Role", value.name], ["Location", stringList(value.workLocations)]], body);
}

export function jobviteMissingJob(html: string): boolean {
  const source = String(html || "");
  return /class=["'][^"']*\bjv-page-error\b/i.test(source) &&
    !/class=["'][^"']*\bjv-job-detail-description\b/i.test(source);
}
