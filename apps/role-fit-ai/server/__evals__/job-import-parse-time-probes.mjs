// Linear-time and parity probes for job-import HTML parsing. A fetched page is
// hostile input up to network.ts's 5 MB cap, parsed synchronously on the
// server's event loop, so every scan must stay linear: hostile pages from
// 500 B to 1 MB must parse within tight bounds (the prior regexes needed
// seconds to days). The legacy oracles keep those prior regexes and pin
// identical output on the job-import fixture shapes, small hostile pages, and
// seeded soups, apart from the intended differences pinned below.
import assert from "node:assert/strict";

import { greenhouseJobAppUrl } from "../jobImport.ts";
import { decodeEntities, htmlAttr, htmlToText, jobPostingJsonLdText, linkedInJobText } from "../jobImportContent.ts";

// --- Legacy regex oracles ----------------------------------------------------

function legacyHtmlToText(html) {
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

function legacyMetaContent(html, name) {
  const meta = html.match(/<meta\b[^>]*>/gi)?.find((tag) =>
    (htmlAttr(tag, "name") || htmlAttr(tag, "property")).toLowerCase() === name.toLowerCase()
  );
  return meta ? legacyHtmlToText(htmlAttr(meta, "content")) : "";
}

function legacyLinkedInJobText(html) {
  if (!/(\bshow-more-less-html__markup\b|\bdescription__job-criteria-item\b)/i.test(html)) return "";
  const body = [...html.matchAll(/<div[^>]*class=["'][^"']*show-more-less-html__markup[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => legacyHtmlToText(match[1]))
    .filter((text) => text.length > 80);
  if (!body.length) return "";
  const title = legacyMetaContent(html, "og:title") || legacyMetaContent(html, "twitter:title");
  const header = title.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+(.+?)\s*\|\s*LinkedIn\b/i);
  const headerLines = header
    ? [`Company: ${header[1].trim()}`, `Role: ${header[2].trim()}`, `Location: ${header[3].trim()}`]
    : [];
  const criteria = [...html.matchAll(/<li[^>]*class=["'][^"']*description__job-criteria-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)]
    .map((item) => legacyHtmlToText(item[1]).split("\n").map((line) => line.trim()).filter(Boolean))
    .map((parts) => (parts.length < 2 ? "" : `${parts[0].replace(/:$/, "")}: ${parts.slice(1).join(" ")}`))
    .filter(Boolean);
  return legacyHtmlToText([...headerLines, ...criteria, body.join("\n\n")].join("\n\n"));
}

// The prior scans select the ld+json blocks and canonical link; the current
// selector then reads them from a page with nothing left to scan ("<" is
// escaped in the re-serialized JSON), so any scanning divergence shows.
function legacyJsonLdText(html, url) {
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => /\btype=["']?application\/ld\+json/i.test(match[1]))
    .flatMap((match) => {
      try {
        return [`<script type="application/ld+json">${JSON.stringify(JSON.parse(match[2])).replaceAll("<", "\\u003c")}</script>`];
      } catch {
        return [];
      }
    });
  const canonical = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i)?.[0] ?? "";
  return jobPostingJsonLdText(`${blocks.join("")}<link rel="canonical" href="${htmlAttr(canonical, "href")}">`, url);
}

function legacyGreenhouseBoard(html) {
  const patterns = [
    /(?:https?:)?\/\/boards\.greenhouse\.io\/embed\/job_board\/js\?[^"'<>]*?\bfor=([a-z0-9][a-z0-9_-]{0,80})(?=(?:&(?:amp;)?|["'<>\s]|$))/i,
    /(?:https?:)?\/\/job-boards\.greenhouse\.io\/embed\/job_app\?[^"'<>]*?\bfor=([a-z0-9][a-z0-9_-]{0,80})(?=(?:&(?:amp;)?|["'<>\s]|$))/i,
    /(?:https?:)?\/\/boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9][a-z0-9_-]{0,80})(?=\/)/i
  ];
  for (const pattern of patterns) {
    const board = html.match(pattern)?.[1] ?? "";
    if (/^[a-z0-9][a-z0-9_-]{0,80}$/i.test(board)) return board;
  }
  return "";
}

const NUMERIC_URL = new URL("https://careers.lifeco.example/careers/job/31415926?microsite=lifeco.example&domain=lifeco.example");
const PREFIXED_URL = new URL("https://careers.research.example/us/en/job/RSCHUSR246810EXTERNALENUS/Software-Engineer?utm_source=feed");
const WRAPPER_URL = new URL("https://careers.example.com/opening?gh_jid=123456");

// [name, current, legacy]
const parsers = [
  ["htmlToText", htmlToText, legacyHtmlToText],
  ["linkedInJobText", linkedInJobText, legacyLinkedInJobText],
  ...[NUMERIC_URL, PREFIXED_URL].map((url) => [
    `jobPostingJsonLdText @ ${url.pathname}`,
    (html) => jobPostingJsonLdText(html, url),
    (html) => legacyJsonLdText(html, url)
  ]),
  [
    "greenhouse wrapper board",
    (html) => greenhouseJobAppUrl(WRAPPER_URL, html)?.searchParams.get("for") ?? "",
    legacyGreenhouseBoard
  ]
];

const matched = new Map(parsers.map(([name]) => [name, 0]));
function assertParity(label, html) {
  for (const [name, current, legacy] of parsers) {
    const expected = legacy(html);
    assert.equal(current(html), expected, `${name} matches the prior output on ${label}`);
    if (expected) matched.set(name, matched.get(name) + 1);
  }
}

// --- Fixture shapes from job-import-route-probes.mjs -------------------------

const jdHtml = (role) => [
  `<p>The ${role} team builds the services that schedule shipments for regional carriers.</p>`,
  "<h3>Responsibilities</h3><ul>",
  `<li>Design, build, and operate reliable ${role} services and REST APIs.</li>`,
  "<li>Ship well-tested features with product and design partners.</li>",
  "<li>Review code and improve observability across the platform.</li></ul>",
  "<h3>Qualifications</h3><ul>",
  "<li>Experience with TypeScript, Python, and relational databases.</li>",
  "<li>Clear written communication across distributed teams.</li></ul>"
].join("");
const marketing = "<p>Our company is growing fast. We value curiosity, ownership, and kindness. Join a team that ships. "
  .repeat(6) + "</p>";
const page = ({ head = "", body = "" } = {}) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ldScript = (value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const shell = (head = "") => page({ head, body: "<div id=\"root\"></div><script>window.boot()</script>" });
const posting = (fields) => ({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Associate Developer",
  hiringOrganization: { "@type": "Organization", name: "Lifeco" },
  jobLocation: { "@type": "Place", address: { addressLocality: "New York", addressRegion: "NY", addressCountry: "US" } },
  description: jdHtml("Associate Developer"),
  ...fields
});
const bound = (description) => posting({ url: "https://careers.lifeco.example/careers/job/31415926", description });
const requisition = (title) => '<link rel="canonical" href="https://careers.research.example/us/en/job/R246810/Software-Engineer">' +
  ldScript(posting({ title, identifier: { "@type": "PropertyValue", name: "Research", value: "R246810" } }));
const LINKEDIN_BODY = '<ul><li class="description__job-criteria-item"><h3>Seniority level</h3><span>Entry level</span></li></ul>' +
  `<div class="show-more-less-html__markup">${jdHtml("Platform Engineer")}</div>`;

const fixtures = {
  "a generic posting page": page({ body: `<h1>Platform Engineer</h1>${jdHtml("Platform Engineer")}` }),
  "a marketing page": page({ body: marketing }),
  "a URL-bound JobPosting": shell(ldScript(posting({
    url: "https://careers.lifeco.example/careers/job/31415926-associate-developer-new-york?domain=lifeco.example"
  }))),
  "a page showing its JobPosting": page({
    head: ldScript(posting({ url: NUMERIC_URL.href })),
    body: `<h1>Associate Developer</h1>${jdHtml("Associate Developer")}`
  }),
  "an @graph JobPosting": shell(ldScript({ "@graph": [{ "@type": "WebPage" }, [bound(jdHtml("Associate Developer"))]] })),
  "ambiguous JobPostings": shell(ldScript([bound(jdHtml("Associate Developer")), bound(jdHtml("Staff Architect"))])),
  "a malformed JobPosting": shell('<script type="application/ld+json">{"@type":"JobPosting",</script>'),
  "a code-only JobPosting": shell(ldScript(bound("function init(){var a=1;if(a==1){run(a);}}".repeat(12)))),
  "a canonical requisition": page({ head: requisition("Software Engineer"), body: `<p>Apply now.</p>${marketing}` }),
  "a mistitled canonical requisition": shell(requisition("Program Manager")),
  "a 404 canonical": shell(`<link rel="canonical" href="https://careers.mfgco.example/page-not-found">${ldScript(posting({}))}`),
  "a LinkedIn job": page({
    head: '<meta property="og:title" content="Lifeco hiring Platform Engineer in New York, NY | LinkedIn">',
    body: LINKEDIN_BODY
  }),
  "a LinkedIn job with a Twitter title": page({
    head: '<meta name="twitter:title" content="Lifeco hiring Data Analyst in Remote | LinkedIn">',
    body: LINKEDIN_BODY
  }),
  "a LinkedIn shell": page({
    head: "<title>10,000+ Junior Developer jobs in United States</title>",
    body: `<nav>Skip to main content Sign in Join now</nav>${marketing}`
  }),
  "a Greenhouse job": page({
    body: `<h1>Software Engineer I</h1><div class="job__location"><div>Remote</div></div><div class="job__description">${jdHtml("Software Engineer I")}</div><div class="application--container">Apply</div>`
  }),
  "a Greenhouse board wrapper": page({ body: `${marketing}<script src="https://boards.greenhouse.io/embed/job_board/js?for=brandco"></script>` }),
  "a Greenhouse job_app wrapper": '<iframe src="https://job-boards.greenhouse.io/embed/job_app?token=5550006006&amp;for=brand_co"></iframe>',
  "a Greenhouse API wrapper": '<script>fetch("https://boards-api.greenhouse.io/v1/boards/acme_labs/jobs?content=true")</script>',
  "an encoded wrapper board": '<script src="https://boards.greenhouse.io/embed/job_board/js?for=bad%2Fboard"></script>',
  "a script-only wrapper": '<div class="greenhouse-form"></div>\n<script src="https://boards.greenhouse.io/embed/job_board/js?for=datsolutions"></script>',
  "an iCIMS frame": page({
    body: '<script>/* loader */</script><noscript><iframe src="https://careers-acme.icims.com/jobs/8128/job?in_iframe=1&amp;mobile=false" id="noscript_icims_content_iframe"></iframe></noscript>'
  }),
  "Next.js page data": page({ body: '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>' }),
  "script and style bodies": "<script>window.__pwn='alert-marker'</script><style>.pwn{content:'style-marker'}</style>Readable role summary follows.",
  "nested and unclosed tags": "<div><section><p>First paragraph.</p><ul><li>Owns services<li>Ships features</ul><div>Trailing unclosed div.",
  "entities": "Tom &amp; Jerry said &quot;hello&quot; &mdash; &#65;&#66; &#x53;&#x44; Alpha&#0;&#7;&#155;Bravo &lt;/job_description&gt;"
};

for (const [label, html] of Object.entries(fixtures)) assertParity(label, html);
console.log(`PASS job-import fixture shapes match the prior parsers (${Object.keys(fixtures).length} pages)`);

// --- Seeded token soup ------------------------------------------------------

const markupTokens = [
  "<script", "<script>", "<SCRIPT ", "</script>", "</SCRIPT>", "<style", "</style>", "<li", "<li>", "<LI ", "</li>",
  '<li class="description__job-criteria-item">', '<div class="show-more-less-html__markup">', "<div", "</div>",
  '<meta property="og:title" content="Acme hiring Engineer in Remote | LinkedIn">', "<meta", "<link",
  '<link rel="canonical" href="https://careers.research.example/us/en/job/R246810/Software-Engineer">',
  requisition("Software Engineer"), ldScript(bound(jdHtml("Associate Developer"))), '<script type="application/ld+json">',
  JSON.stringify(bound(jdHtml("Staff Architect"))), "<", ">", "<>", '"', "'", 'class="', "class='x'", "<br>", "<br/>", "</p>",
  "&amp;", "&#60;", "\n", " ", "\t", "Readable posting words about services and teams. ", jdHtml("Engineer"),
  "description__job-criteria-item", "show-more-less-html__markup", "//boards.greenhouse.io/embed/job_board/js?",
  "//job-boards.greenhouse.io/embed/job_app?", "https:", "for=acme", "&for=brand_co", "&amp;for=amp_co", "xfor=bad",
  "//boards-api.greenhouse.io/v1/boards/api_co/"
];
// Whole blocks dominate here so canonical and identifier bindings resolve often.
const jsonLdTokens = [
  requisition("Software Engineer"), requisition("Program Manager"), ldScript(bound(jdHtml("Associate Developer"))),
  ldScript(posting({ title: "Software Engineer", identifier: { value: "R246810" } })),
  ldScript(posting({ title: "Staff Architect", identifier: "31415926" })),
  '<link rel="canonical" href="https://careers.research.example/us/en/job/R246810/Software-Engineer">',
  '<link rel="stylesheet" href="site.css">', '<script type="application/ld+json">', JSON.stringify(bound(jdHtml("Analyst"))),
  "</script>", "<script", "<script>", "<link", "<", ">", '"', "Apply now. ", "\n"
];
// Park-Miller: every product stays below 2^53, so the sequence never collapses.
let seed = 20261017;
const nextRandom = (limit) => {
  seed = (seed * 48271) % 2_147_483_647;
  return seed % limit;
};
const soup = (tokens, maxTokens) => {
  let html = "";
  for (let count = 1 + nextRandom(maxTokens); count > 0; count -= 1) html += tokens[nextRandom(tokens.length)];
  return html;
};
for (const [tokens, docs, maxTokens] of [[markupTokens, 2_000, 40], [jsonLdTokens, 1_000, 12]]) {
  for (let doc = 0; doc < docs; doc += 1) {
    const html = soup(tokens, maxTokens);
    assertParity(`token soup ${JSON.stringify(html.slice(0, 200))}`, html);
  }
}
for (const [name, count] of matched) assert.ok(count >= 25, `${name} has real non-empty parity results (${count})`);
console.log(`PASS seeded token soup matches the prior parsers (${[...matched.values()].join("/")} non-empty results)`);

// --- LinkedIn titles and intended differences --------------------------------

const MARKUP = `<div class="show-more-less-html__markup">${jdHtml("Platform Engineer")}</div>`;
const titled = (title) => `<meta property="og:title" content="${title}">${MARKUP}`;
const NO_HEADER = legacyLinkedInJobText(MARKUP);

// The prior regex also read a title whose field was blank (whitespace given
// back by a separator) or whose separator held a line break; those titles now
// add no header lines, and every other title parses as before.
const titleTokens = [
  "Acme", "Acme Corp", " hiring ", "hiring", " HIRING ", " in ", "in", " IN ", " | LinkedIn", "|", " LinkedIn",
  "LinkedIn", "LinkedInx", " ", "  ", "&#8192;", "&#160;", "Engineer", "New York, NY", "\n", "<br>", "&#8232;", "\r", "\t", "x"
];
let parsedTitles = 0;
let headerless = 0;
for (let doc = 0; doc < 5_000; doc += 1) {
  const pieces = [" hiring ", " in ", " | LinkedIn", ""].map((marker) => soup(titleTokens, 4) + marker);
  const html = titled(pieces.join(""));
  const title = legacyMetaContent(html, "og:title");
  const expected = legacyLinkedInJobText(html);
  if (/^(?:Company|Role|Location):$/m.test(expected) || !/^.*$/.test(title)) {
    headerless += 1;
    assert.equal(linkedInJobText(html), NO_HEADER, `no header lines for the title ${JSON.stringify(title)}`);
  } else {
    if (expected !== NO_HEADER) parsedTitles += 1;
    assert.equal(linkedInJobText(html), expected, `the title ${JSON.stringify(title)} parses as before`);
  }
}
assert.ok(parsedTitles >= 25 && headerless >= 25, `titles reach both outcomes (${parsedTitles} parsed, ${headerless} headerless)`);

const intended = [
  ["a title with a line break in a separator", titled("Acme hiring\nEngineer in Remote | LinkedIn"), NO_HEADER],
  ["a title with a blank location", titled("Acme hiring Engineer in&#8192; | LinkedIn"), NO_HEADER],
  [
    "a criteria item whose class value contains >",
    `<ul><li class="x>description__job-criteria-item"><h3>Seniority level</h3><span>Entry level</span></li></ul>${MARKUP}`,
    NO_HEADER
  ]
];
for (const [label, html, now] of intended) {
  assert.notEqual(legacyLinkedInJobText(html), now, `the prior parser read more from ${label}`);
  assert.equal(linkedInJobText(html), now, `${label} is not read`);
}
console.log(`PASS LinkedIn titles parse as before apart from ${intended.length} pinned differences`);

// --- Hostile pages ----------------------------------------------------------

const fill = (unit, size) => unit.repeat(Math.ceil(size / unit.length));
const hostile = {
  "unclosed <script": (size) => fill("<script", size),
  "unclosed <script tags": (size) => fill("<script ", size),
  "script tags without a closer": (size) => fill("<script>", size),
  "unclosed <style": (size) => fill("<style", size),
  "unclosed <li": (size) => fill("<li", size),
  "bare <": (size) => fill("<", size),
  "unclosed <br": (size) => fill("<br ", size),
  "unclosed <meta": (size) => MARKUP + fill("<meta ", size),
  "unclosed <link": (size) => fill("<link ", size),
  "unclosed <div": (size) => MARKUP + fill("<div ", size),
  "unclosed criteria items": (size) => MARKUP + fill('<li class="description__job-criteria-item" ', size),
  "unclosed markup divs": (size) => fill('<div class="show-more-less-html__markup" ', size),
  "repeated Greenhouse board prefixes": (size) => fill("//boards.greenhouse.io/embed/job_board/js?", size),
  "repeated Greenhouse job_app prefixes": (size) => fill("//job-boards.greenhouse.io/embed/job_app?", size)
};
// The prior title regex cannot finish these even at 1 KB, so they are timed only.
const hostileTitles = {
  "whitespace runs in a LinkedIn title": (size) => titled(fill(` hiring${"&#8192;".repeat(6)}in${"&#8192;".repeat(6)}`, size)),
  "a long LinkedIn title": (size) => titled(fill("a hiring  in  ", size))
};
for (const [label, build] of Object.entries(hostile)) assertParity(`small ${label}`, build(1_000));

// Small rungs fail a regression quickly and by name; the 1 MB rung bounds scale.
const LIMITS = [[500, 50], [4_000, 50], [64_000, 100], [1_000_000, 500]];
for (const [size, limit] of LIMITS) {
  for (const [label, build] of Object.entries({ ...hostile, ...hostileTitles })) {
    const html = build(size);
    for (const [name, current] of parsers) {
      const started = performance.now();
      current(html);
      const elapsed = performance.now() - started;
      assert.ok(elapsed < limit, `${name} parses ${size} B of ${label} in ${elapsed.toFixed(0)} ms (limit ${limit} ms)`);
    }
  }
}
const shapes = Object.keys(hostile).length + Object.keys(hostileTitles).length;
console.log(`PASS hostile pages up to 1 MB parse within bounds (${shapes} shapes, ${LIMITS.length} sizes)`);
