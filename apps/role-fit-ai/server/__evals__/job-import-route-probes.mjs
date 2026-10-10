// Production-path probes for /api/import-job and the extension resolver.
// Every case drives the real handleImportJob / resolveImportedJobText through
// the real fetchPublicHtml (DNS validation, pinning, redirects, byte cap) with
// a synthetic offline transport. All postings are invented fixtures.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

import { cleanFrameUrls, handleImportJob, resolveImportedJobText } from "../jobImport.ts";

const PUBLIC_IP = "93.184.216.34";
const PRIVATE_IP = "10.0.0.5";

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

// Offline transport: `routes` maps a full href (or origin+pathname) to a
// response; anything else is a 404. `privateHosts` resolve to a private IP.
function transport(routes, { privateHosts = [] } = {}) {
  const calls = [];
  const lookup = async (hostname, options) => {
    const all = [{ address: privateHosts.includes(hostname) ? PRIVATE_IP : PUBLIC_IP, family: 4 }];
    return options && options.all ? all : all[0];
  };
  const request = (url, _options, onResponse) => {
    calls.push(url.href);
    const route = routes[url.href] ?? routes[url.origin + url.pathname] ?? { status: 404, body: "Not found" };
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => {};
    queueMicrotask(() => {
      const res = new Readable({ read() {} });
      res.statusCode = route.status ?? 200;
      res.headers = route.headers ?? {};
      onResponse(res);
      res.push(Buffer.from(route.body ?? ""));
      res.push(null);
    });
    return req;
  };
  return { deps: { lookup, request }, calls };
}

async function importUrl(url, deps) {
  const req = Readable.from([Buffer.from(JSON.stringify({ url }))]);
  req.method = "POST";
  let status = 0;
  let body = "";
  const res = {
    writeHead(code) { status = code; return res; },
    end(chunk) { body = String(chunk ?? ""); }
  };
  await handleImportJob(req, res, deps);
  return { status, ...JSON.parse(body) };
}

let failures = 0;
async function probe(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error?.message ?? error}`);
  }
}
const ok = (result, pattern) => {
  assert.equal(result.status, 200, `expected success, got ${result.status}: ${result.error ?? ""}`);
  if (pattern) assert.match(result.text, pattern);
};
const fails = (result, pattern = /paste/i) => {
  assert.notEqual(result.status, 200, `expected failure, got text: ${String(result.text).slice(0, 120)}`);
  assert.match(result.error, pattern);
};

// --- Embedded Ashby boards ---------------------------------------------------
const UUID_A = "11111111-2222-4333-8444-555555555555";
const UUID_B = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const ashbyBoard = (jobs) => ({ status: 200, body: JSON.stringify({ jobs }) });
const ashbyJob = (id, title) => ({ id, title, location: "Remote", descriptionHtml: jdHtml(title) });
const embedWrapper = (embeds) => ({
  status: 200,
  body: page({ body: `${marketing}<div id="ashby_embed"></div>${embeds}` })
});
const embedScript = (board) => `<script id="ashby-script" src="https://jobs.ashbyhq.com/${board}/embed"></script>`;
// Successful Ashby selections are cached by board + job for two minutes, so
// each case uses its own board slug.
const embedCase = (board) => ({
  url: `https://www.${board}.example/company/careers?ashby_jid=${UUID_A}&utm_source=feed`,
  api: `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`
});

await probe("embedded Ashby board resolves only the requested ashby_jid", async () => {
  const { url, api } = embedCase("embedco");
  const { deps } = transport({
    [url]: embedWrapper(embedScript("embedco")),
    [api]: ashbyBoard([ashbyJob(UUID_B, "Account Executive"), ashbyJob(UUID_A, "Platform Engineer")])
  });
  const result = await importUrl(url, deps);
  ok(result, /Role: Platform Engineer/);
  assert.doesNotMatch(result.text, /Account Executive|Our company is growing fast/);
});

await probe("embedded Ashby board without the requested job fails instead of importing company prose", async () => {
  const { url, api } = embedCase("missingco");
  const { deps } = transport({
    [url]: embedWrapper(embedScript("missingco")),
    [api]: ashbyBoard([ashbyJob(UUID_B, "Account Executive")])
  });
  fails(await importUrl(url, deps));
});

await probe("conflicting or malformed Ashby embed evidence does not resolve a board", async () => {
  const { url } = embedCase("conflictco");
  for (const embeds of [embedScript("conflictco") + embedScript("otherco"), embedScript("bad%2Fboard")]) {
    const { deps, calls } = transport({ [url]: embedWrapper(embeds) });
    fails(await importUrl(url, deps));
    assert(!calls.some((href) => href.startsWith("https://api.ashbyhq.com/")), "no board API is guessed");
  }
});

await probe("a foreign embed host is not treated as Ashby evidence", async () => {
  const url = `https://careers.brand.example/jobs?ashby_jid=${UUID_A}`;
  const { deps, calls } = transport({
    [url]: { status: 200, body: page({ body: `<h1>Platform Engineer</h1>${jdHtml("Platform Engineer")}<script src="https://evil.example/embedco/embed"></script>` }) }
  });
  ok(await importUrl(url, deps), /Responsibilities/);
  assert(!calls.some((href) => href.includes("ashbyhq.com")), "no Ashby request without Ashby evidence");
});

// --- Direct Ashby boards -----------------------------------------------------
const DIRECT_URL = `https://jobs.ashbyhq.com/bigco/${UUID_A}?source=feed`;
const DIRECT_PAGE = `https://jobs.ashbyhq.com/bigco/${UUID_A}`;
const DIRECT_API = "https://api.ashbyhq.com/posting-api/job-board/bigco?includeCompensation=true";
const exactAshbyPage = (identifier) => ({
  status: 200,
  body: shell(ldScript({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Full Stack Engineer",
    identifier: { "@type": "PropertyValue", name: "BigCo", value: identifier },
    hiringOrganization: { "@type": "Organization", name: "BigCo" },
    description: jdHtml("Full Stack Engineer")
  }))
});

await probe("an oversized Ashby board falls back to the exact job page's matching JobPosting", async () => {
  const { deps } = transport({
    [DIRECT_API]: { status: 200, body: "x".repeat(5_000_001) },
    [DIRECT_URL]: exactAshbyPage(UUID_A)
  });
  const result = await importUrl(DIRECT_URL, deps);
  ok(result, /Role: Full Stack Engineer/);
  assert.match(result.text, /Company: BigCo/);
});

await probe("an oversized Ashby board does not accept a mismatched exact-page identifier", async () => {
  const { deps } = transport({
    [DIRECT_API]: { status: 200, body: "x".repeat(5_000_001) },
    [DIRECT_URL]: exactAshbyPage(UUID_B)
  });
  fails(await importUrl(DIRECT_URL, deps));
});

await probe("a private-host rejection on the Ashby board is not converted into a fallback", async () => {
  const { deps, calls } = transport({
    [DIRECT_API]: { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } },
    [DIRECT_URL]: exactAshbyPage(UUID_A)
  });
  fails(await importUrl(DIRECT_URL, deps), /public http or https/i);
  assert(!calls.includes(DIRECT_URL), "the exact page is not fetched after a security rejection");
});

await probe("a direct Ashby board without the requested job fails without a careers-page substitute", async () => {
  const { deps } = transport({
    [DIRECT_API]: ashbyBoard([ashbyJob(UUID_B, "Account Executive")]),
    [DIRECT_URL]: { status: 200, body: page({ body: marketing }) }
  });
  fails(await importUrl(DIRECT_URL, deps));
});

await probe("Handshake's branded Ashby URL fails when its board lacks the requested job", async () => {
  const url = `https://joinhandshake.com/careers/job/?ashby_jid=${UUID_A}`;
  const { deps } = transport({
    "https://api.ashbyhq.com/posting-api/job-board/handshake?includeCompensation=true": ashbyBoard([ashbyJob(UUID_B, "Sales")]),
    [url]: { status: 200, body: page({ body: marketing }) }
  });
  fails(await importUrl(url, deps));
});

await probe("a direct Ashby board with the requested job still imports from the API", async () => {
  const { deps } = transport({ [DIRECT_API]: ashbyBoard([ashbyJob(UUID_A, "Backend Engineer")]) });
  ok(await importUrl(DIRECT_URL, deps), /Role: Backend Engineer/);
});

// --- JobPosting JSON-LD ------------------------------------------------------
const posting = (fields) => ({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Associate Developer",
  hiringOrganization: { "@type": "Organization", name: "Lifeco" },
  jobLocation: { "@type": "Place", address: { addressLocality: "New York", addressRegion: "NY", addressCountry: "US" } },
  description: jdHtml("Associate Developer"),
  ...fields
});
const NUMERIC_URL = "https://careers.lifeco.example/careers/job/31415926?microsite=lifeco.example&domain=lifeco.example";

await probe("JobPosting bound by its URL to a numeric selector imports the structured JD", async () => {
  const { deps } = transport({
    [NUMERIC_URL]: {
      status: 200,
      body: shell(ldScript(posting({ url: "https://careers.lifeco.example/careers/job/31415926-associate-developer-new-york?domain=lifeco.example" })))
    }
  });
  const result = await importUrl(NUMERIC_URL, deps);
  ok(result, /Role: Associate Developer/);
  assert.match(result.text, /Company: Lifeco/);
  assert.match(result.text, /Location: New York, NY, US/);
  assert.match(result.text, /• Design, build, and operate/);
});

await probe("a readable page that already shows the bound JD keeps its fuller page text", async () => {
  const body = `<h1>Associate Developer</h1>${jdHtml("Associate Developer")}<p>The pay range for this role is $95,000 - $115,000.</p>`;
  const { deps } = transport({
    [NUMERIC_URL]: { status: 200, body: page({ head: ldScript(posting({ url: NUMERIC_URL })), body }) }
  });
  const result = await importUrl(NUMERIC_URL, deps);
  ok(result, /pay range for this role/);
  assert.doesNotMatch(result.text, /^Role: /);
});

await probe("JobPosting inside @graph and arrays is found", async () => {
  const { deps } = transport({
    [NUMERIC_URL]: {
      status: 200,
      body: shell(ldScript({ "@graph": [{ "@type": "WebPage" }, [posting({ url: "https://careers.lifeco.example/careers/job/31415926" })]] }))
    }
  });
  ok(await importUrl(NUMERIC_URL, deps), /Role: Associate Developer/);
});

await probe("an unrelated, ambiguous, malformed, short, or code-only JobPosting is not accepted", async () => {
  const other = posting({ url: "https://careers.lifeco.example/careers/job/22222222" });
  const bound = (description) => posting({ url: "https://careers.lifeco.example/careers/job/31415926", description });
  const variants = [
    ldScript(other),
    ldScript(posting({ identifier: { "@type": "PropertyValue", value: "00ff00ff00ff00ff" } })),
    ldScript([bound(jdHtml("Associate Developer")), bound(jdHtml("Staff Architect"))]),
    '<script type="application/ld+json">{"@type":"JobPosting",</script>',
    ldScript({ "@type": "Organization", url: "https://careers.lifeco.example/careers/job/31415926", description: jdHtml("x") }),
    ldScript(bound("<h2>Responsibilities</h2><h2>Qualifications</h2>")),
    ldScript(bound("function init(){var a=1;if(a==1){run(a);}}".repeat(12)))
  ];
  for (const head of variants) {
    const { deps } = transport({ [NUMERIC_URL]: { status: 200, body: shell(head) } });
    fails(await importUrl(NUMERIC_URL, deps));
  }
});

await probe("slug fragments and conflicting same-host URLs never bind a JobPosting", async () => {
  const url = "https://careers.bank.example/Bank/job/New-York-Engineer-NY-10019/43210/";
  const cases = [
    posting({ title: "Other Role", identifier: { "@type": "PropertyValue", value: "10019" } }),
    posting({ identifier: { value: "43210" }, url: "https://careers.bank.example/Bank/job/Other-Role/98765/" })
  ];
  for (const node of cases) {
    const { deps } = transport({ [url]: { status: 200, body: shell(ldScript(node)) } });
    fails(await importUrl(url, deps));
  }
  const suffix = "https://careers.lifeco.example/careers/job/R-123";
  const other = transport({ [suffix]: { status: 200, body: shell(ldScript(posting({ url: `${suffix}-4` }))) } });
  fails(await importUrl(suffix, other.deps));
});

await probe("a 404 page with JobPosting data is not recovered", async () => {
  const url = "https://careers.mfgco.example/jobs/software-engineer-7a7a7a7a-1b1b-4c2c-8d3d-4e4e4e4e4e4e";
  const { deps } = transport({
    [url]: { status: 404, body: shell(`<link rel="canonical" href="https://careers.mfgco.example/page-not-found">${ldScript(posting({}))}`) }
  });
  fails(await importUrl(url, deps), /HTTP 404/);
});

await probe("a provider-prefixed requisition binds through its canonical page and title", async () => {
  const url = "https://careers.research.example/us/en/job/RSCHUSR246810EXTERNALENUS/Software-Engineer?utm_source=feed";
  const head = (title) => '<link rel="canonical" href="https://careers.research.example/us/en/job/R246810/Software-Engineer">' +
    ldScript(posting({ title, identifier: { "@type": "PropertyValue", name: "Research", value: "R246810" } }));
  const bound = transport({ [url]: { status: 200, body: page({ head: head("Software Engineer"), body: `<p>Apply now.</p>${marketing}` }) } });
  ok(await importUrl(url, bound.deps), /Role: Software Engineer[\s\S]*Responsibilities/);
  const wrongTitle = transport({ [url]: { status: 200, body: shell(head("Program Manager")) } });
  fails(await importUrl(url, wrongTitle.deps));
});

await probe("query selectors such as pid stay part of JobPosting identity", async () => {
  const url = "https://assoc.example/careers?domain=assoc.example&start=0&pid=70707070";
  const match = transport({ [url]: { status: 200, body: shell(ldScript(posting({ url: "https://assoc.example/careers?utm_source=x&domain=assoc.example&pid=70707070" }))) } });
  ok(await importUrl(url, match.deps), /Role: Associate Developer/);
  const other = transport({ [url]: { status: 200, body: shell(ldScript(posting({ url: "https://assoc.example/careers?domain=assoc.example&pid=70707099" }))) } });
  fails(await importUrl(url, other.deps));
});

await probe("Workday pages never turn boilerplate JobPosting data into a JD", async () => {
  const url = "https://acme.wd1.myworkdayjobs.com/External/job/Austin-TX/Software-Engineer_JR900001";
  const { deps } = transport({
    "https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External/job/Austin-TX/Software-Engineer_JR900001": { status: 404, body: "{}" },
    [url]: { status: 200, body: shell(ldScript(posting({ title: "", identifier: { value: "JR900001" }, description: marketing }))) }
  });
  fails(await importUrl(url, deps));
});

await probe("Workday CXS imports keep working", async () => {
  const url = "https://acme.wd1.myworkdayjobs.com/External/job/Austin-TX/Software-Engineer_JR900002";
  const { deps } = transport({
    "https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External/job/Austin-TX/Software-Engineer_JR900002": {
      status: 200,
      body: JSON.stringify({ jobPostingInfo: { title: "Software Engineer", location: "Austin, TX", jobDescription: jdHtml("Software Engineer") } })
    }
  });
  ok(await importUrl(url, deps), /^Software Engineer · Austin, TX/);
});

// --- Oracle candidate experience --------------------------------------------
const ORACLE_URL = "https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_77/job/61803?utm_medium=jobshare";
const oracleApi = (origin) => `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails`;
const oraclePage = (site = "CX_77") => ({ status: 200, body: page({ body: `<div id="app" data-sitenumber="${site}"></div>` }) });
const oracleItem = (id, extra = {}) => ({
  Id: id,
  Title: "Software Development Engineer",
  PrimaryLocation: "Sunnyvale, CA, United States",
  ExternalDescriptionStr: jdHtml("Software Development Engineer"),
  ExternalResponsibilitiesStr: "<ul><li>Own the scheduling service end to end.</li></ul>",
  ExternalQualificationsStr: "<ul><li>Bachelor's degree in computer science.</li></ul>",
  InternalQualificationsStr: "<p>INTERNAL-ONLY qualification notes.</p>",
  InternalResponsibilitiesStr: "<p>INTERNAL-ONLY responsibility notes.</p>",
  CorporateDescriptionStr: "<p>CORPORATE boilerplate.</p>",
  ...extra
});
const oracleResponse = (items) => ({ status: 200, body: JSON.stringify({ items, count: items.length }) });

await probe("Oracle candidate experience imports only the exact requisition's external fields", async () => {
  const origin = new URL(ORACLE_URL).origin;
  const { deps, calls } = transport({ [ORACLE_URL]: oraclePage(), [oracleApi(origin)]: oracleResponse([oracleItem("61803")]) });
  const result = await importUrl(ORACLE_URL, deps);
  ok(result, /Role: Software Development Engineer/);
  assert.match(result.text, /Own the scheduling service/);
  assert.match(result.text, /Bachelor's degree/);
  assert.doesNotMatch(result.text, /INTERNAL-ONLY|CORPORATE/);
  const api = new URL(calls.find((href) => href.includes("/hcmRestApi/")));
  assert.equal(api.origin, origin, "the API stays on the posting's origin");
  assert.equal(api.searchParams.get("finder"), 'ById;Id="61803",siteNumber=CX_77');
});

await probe("Oracle empty, mismatched, and multi-item responses fail", async () => {
  const origin = new URL(ORACLE_URL).origin;
  for (const items of [[], [oracleItem("99999")], [oracleItem("61803"), oracleItem("61803")]]) {
    const { deps } = transport({ [ORACLE_URL]: oraclePage(), [oracleApi(origin)]: oracleResponse(items) });
    fails(await importUrl(ORACLE_URL, deps));
  }
});

await probe("Oracle rejects malformed or conflicting site numbers without calling the API", async () => {
  const conflicting = { status: 200, body: page({ body: '<div data-sitenumber="CX_1"></div><div data-sitenumber="CX_2"></div>' }) };
  for (const route of [oraclePage("CX 1;finder=All"), conflicting]) {
    const { deps, calls } = transport({ [ORACLE_URL]: route });
    fails(await importUrl(ORACLE_URL, deps));
    assert(!calls.some((href) => href.includes("/hcmRestApi/")));
  }
});

await probe("the observed Dell branded Oracle origin is recognized", async () => {
  const url = "https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/job/271828";
  const { deps } = transport({
    [url]: oraclePage("CX_88"),
    [oracleApi("https://enterpriseplatform.dell.com")]: oracleResponse([oracleItem("271828")])
  });
  ok(await importUrl(url, deps), /Role: Software Development Engineer/);
});

// --- iCIMS -------------------------------------------------------------------
const ICIMS_URL = "https://careers-acme.icims.com/jobs/8128/associate-software-engineer/job?mobile=false&width=907";
const icimsFrame = (src) => page({
  body: `<script>/* loader */</script><noscript><iframe src="${src}" id="noscript_icims_content_iframe"></iframe></noscript>`
});
const icimsJob = page({
  body: '<div class="iCIMS_Navigation">Welcome page Returning Candidate?</div>' +
    '<div class="iCIMS_JobContainer"><div class="iCIMS_JobContent">' +
    '<h1 class="iCIMS_Header">Associate Software Engineer</h1><span>US-IL-Chicago</span>' +
    `<h2 class="iCIMS_InfoMsg iCIMS_InfoField_Job">Job Description</h2><div class="iCIMS_InfoMsg iCIMS_InfoMsg_Job">${jdHtml("Associate Software Engineer")}</div>` +
    '</div></div><div class="iCIMS_JobOptions"><h2>Options</h2><a class="iCIMS_ApplyOnlineButton">Apply for this job online</a></div>'
});
const ICIMS_FRAME = "https://careers-acme.icims.com/jobs/8128/associate-software-engineer/job?mobile=false&width=907&in_iframe=1";

await probe("iCIMS decodes the job iframe URL and imports only its job content", async () => {
  const { deps, calls } = transport({
    [ICIMS_URL]: { status: 200, body: icimsFrame(ICIMS_FRAME.replace(/&/g, "&amp;")) },
    [ICIMS_FRAME]: { status: 200, body: icimsJob }
  });
  const result = await importUrl(ICIMS_URL, deps);
  ok(result, /Associate Software Engineer[\s\S]*Responsibilities/);
  assert.doesNotMatch(result.text, /Apply for this job online|Returning Candidate/);
  assert.equal(calls.filter((href) => href.includes("in_iframe=1")).length, 1, "the job frame is fetched once");
});

await probe("iCIMS rejects another job's frame, a cross-origin frame, and a frame without job content", async () => {
  const cases = [
    [ICIMS_FRAME.replace("/jobs/8128/", "/jobs/9999/"), icimsJob],
    [ICIMS_FRAME.replace("careers-acme.icims.com", "careers-other.icims.com"), icimsJob],
    [ICIMS_FRAME, page({ body: '<div class="iCIMS_JobOptions">Options</div>' })]
  ];
  for (const [frame, body] of cases) {
    const { deps, calls } = transport({ [ICIMS_URL]: { status: 200, body: icimsFrame(frame) }, [frame]: { status: 200, body } });
    fails(await importUrl(ICIMS_URL, deps));
    assert(!calls.includes("https://careers-other.icims.com/jobs/8128/associate-software-engineer/job?mobile=false&width=907&in_iframe=1"));
  }
});

await probe("an iCIMS job frame that redirects to a private target is rejected", async () => {
  const { deps } = transport({
    [ICIMS_URL]: { status: 200, body: icimsFrame(ICIMS_FRAME) },
    [ICIMS_FRAME]: { status: 302, headers: { location: "http://intranet.local/admin" } }
  });
  fails(await importUrl(ICIMS_URL, deps), /public http or https/i);
});

// --- Dayforce ----------------------------------------------------------------
const DAYFORCE_URL = "https://jobs.dayforcehcm.com/en-US/acme/CANDIDATEPORTAL/jobs/4096?src=feed";
const nextData = (value) => page({ body: `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(value)}</script>` });
const dayforceData = (jobData) => ({
  props: { pageProps: { _nextI18Next: { strings: { cookieBanner: "We use cookies to improve your experience. ".repeat(20) } }, jobData } }
});
const dayforceJob = (id) => ({
  jobPostingId: id,
  jobTitle: "Software Engineer I ",
  postingLocations: [{ formattedAddress: "Austin, TX, 1 Main St", cityName: "Austin", stateCode: "TX" }],
  jobPostingContent: { jobDescriptionHeader: "<p>About Acme.</p>", jobDescription: jdHtml("Software Engineer I"), jobDescriptionFooter: "<p>Equal opportunity employer.</p>" }
});

await probe("Dayforce page data imports the exact posting description", async () => {
  const { deps } = transport({ [DAYFORCE_URL]: { status: 200, body: nextData(dayforceData(dayforceJob(4096))) } });
  ok(await importUrl(DAYFORCE_URL, deps), /Role: Software Engineer I[\s\S]*Responsibilities/);
});

await probe("Dayforce mismatched, malformed, and description-free data fail", async () => {
  const noDescription = dayforceJob(4096);
  noDescription.jobPostingContent = { jobDescriptionHeader: "", jobDescription: "", jobDescriptionFooter: "" };
  const bodies = [
    nextData(dayforceData(dayforceJob(4097))),
    page({ body: '<script id="__NEXT_DATA__" type="application/json">{"props":</script>' + marketing }),
    nextData(dayforceData(undefined)),
    nextData(dayforceData(noDescription))
  ];
  for (const body of bodies) {
    const { deps } = transport({ [DAYFORCE_URL]: { status: 200, body } });
    fails(await importUrl(DAYFORCE_URL, deps));
  }
});

// --- Workable ----------------------------------------------------------------
const WORKABLE_URL = "https://apply.workable.com/acme-main/j/AB12CD34EF/";
const WORKABLE_API = "https://apply.workable.com/api/v2/accounts/acme-main/jobs/AB12CD34EF";
const workableJob = (extra = {}) => ({
  shortcode: "AB12CD34EF",
  title: "Junior Software Engineer",
  state: "published",
  location: { city: "Austin", region: "Texas", country: "United States" },
  description: jdHtml("Junior Software Engineer"),
  requirements: "<ul><li>Shipped a full-stack TypeScript application.</li></ul>",
  benefits: "<ul><li>Health insurance.</li></ul>",
  ...extra
});

await probe("Workable's public posting API imports the exact published job", async () => {
  const { deps } = transport({ [WORKABLE_API]: { status: 200, body: JSON.stringify(workableJob()) } });
  const result = await importUrl(WORKABLE_URL, deps);
  ok(result, /Role: Junior Software Engineer/);
  assert.match(result.text, /Shipped a full-stack TypeScript application/);
});

await probe("Workable unpublished, missing, and mismatched postings fail", async () => {
  for (const route of [
    { status: 200, body: JSON.stringify(workableJob({ state: "closed" })) },
    { status: 404, body: "{}" },
    { status: 200, body: JSON.stringify(workableJob({ shortcode: "AA00000000" })) }
  ]) {
    const { deps } = transport({ [WORKABLE_API]: route });
    fails(await importUrl(WORKABLE_URL, deps));
  }
});

await probe("Workable path components are validated before building an API URL", async () => {
  const url = "https://apply.workable.com/acme%2F..%2Fadmin/j/AB12CD34EF";
  const { deps, calls } = transport({});
  fails(await importUrl(url, deps), /HTTP 404/);
  assert(!calls.some((href) => href.includes("/api/v2/")));
});

// --- Microsoft Careers (Eightfold) --------------------------------------------
const MS_ID = "1970393550000001";
const MS_URL = `https://apply.careers.microsoft.com/careers/job/${MS_ID}`;
const MS_API = `https://apply.careers.microsoft.com/api/pcsx/position_details?position_id=${MS_ID}`;
const msPosition = (extra = {}) => ({
  status: 200,
  data: {
    id: Number(MS_ID),
    name: "Software Engineer II",
    locations: ["United States, Washington, Redmond", "United States, Washington, Redmond"],
    jobDescription: `<b>Overview</b>${jdHtml("Software Engineer II")}`,
    ...extra
  }
});
const msPage = page({
  head: ldScript(posting({ url: MS_URL, description: "<p>Short summary of the role only.</p>".repeat(8) })),
  body: marketing
});

await probe("a Microsoft Careers link imports the full position, not the page summary", async () => {
  for (const url of [MS_URL, `${MS_URL}/?src=JB-10000`, `https://apply.careers.microsoft.com/careers?pid=${MS_ID}&domain=microsoft.com`]) {
    const { deps, calls } = transport({ [MS_API]: { status: 200, body: JSON.stringify(msPosition()) }, [MS_URL]: { status: 200, body: msPage } });
    const result = await importUrl(url, deps);
    ok(result, /Role: Software Engineer II\nLocation: United States, Washington, Redmond\n/);
    assert.match(result.text, /Responsibilities[\s\S]*Qualifications/);
    assert.doesNotMatch(result.text, /Short summary/);
    assert.deepEqual(calls, [MS_API], "only the position details are fetched");
  }
});

await probe("missing, mismatched, and unreadable Microsoft positions fail; other errors report status", async () => {
  for (const route of [
    { status: 404, body: JSON.stringify({ status: 404, error: { message: "Position not found" }, data: {} }) },
    { status: 200, body: JSON.stringify(msPosition({ id: 1970393550000002 })) },
    { status: 200, body: JSON.stringify(msPosition({ jobDescription: "<p>Apply now.</p>" })) },
    { status: 200, body: "not json" }
  ]) {
    const { deps } = transport({ [MS_API]: route, [MS_URL]: { status: 200, body: msPage } });
    fails(await importUrl(MS_URL, deps), /Could not find this job's description/);
  }
  const { deps } = transport({ [MS_API]: { status: 503, body: "" } });
  fails(await importUrl(MS_URL, deps), /HTTP 503/);
});

await probe("other Microsoft paths stay on the generic page path", async () => {
  const url = "https://apply.careers.microsoft.com/careers/job/12x34";
  const { deps, calls } = transport({ [url]: { status: 200, body: page({ body: `<h1>Engineer</h1>${jdHtml("Engineer")}` }) } });
  ok(await importUrl(url, deps), /Responsibilities/);
  assert(!calls.some((href) => href.includes("/api/pcsx/")));
});

// --- Rippling ----------------------------------------------------------------
const RIP_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const RIP_API = `https://api.rippling.com/platform/api/ats/v1/board/acme-co/jobs/${RIP_ID}`;
const RIP_CAREERS = "http://www.acme.example/careers/open-roles";
const ripplingJob = (extra = {}) => ({
  uuid: RIP_ID,
  name: "Backend Engineer",
  workLocations: ["Seattle, WA", "San Francisco, CA"],
  description: { company: "<p>Acme builds payroll tools.</p>", role: jdHtml("Backend Engineer") },
  ...extra
});

await probe("a Rippling posting imports from its board API in every link form", async () => {
  for (const url of [
    `https://ats.rippling.com/acme-co/jobs/${RIP_ID}`,
    `https://ats.rippling.com/en-GB/acme-co/jobs/${RIP_ID}`,
    `https://ats.rippling.com/acme-co/jobs/${RIP_ID.toUpperCase()}/`,
    `https://ats.rippling.com/acme-co/jobs/${RIP_ID}?jobSite=LinkedIn`
  ]) {
    const { deps, calls } = transport({ [RIP_API]: { status: 200, body: JSON.stringify(ripplingJob()) } });
    const result = await importUrl(url, deps);
    ok(result, /Role: Backend Engineer\nLocation: Seattle, WA; San Francisco, CA\n/);
    assert.match(result.text, /Responsibilities[\s\S]*About\nAcme builds payroll tools/);
    assert.deepEqual(calls, [RIP_API], `${url} reads only the board API`);
  }
});

await probe("a closed Rippling posting fails instead of importing the careers page", async () => {
  const url = `https://ats.rippling.com/acme-co/jobs/${RIP_ID}`;
  const { deps, calls } = transport({
    [RIP_API]: { status: 404, body: "" },
    [url]: { status: 308, headers: { location: RIP_CAREERS } },
    [RIP_CAREERS]: { status: 200, body: page({ body: `<h1>Careers at Acme</h1>${marketing}` }) }
  });
  fails(await importUrl(url, deps), /Could not find this job's description/);
  assert.deepEqual(calls, [RIP_API]);
  for (const job of [ripplingJob({ uuid: "ffffffff-4e5f-4a6b-8c7d-9e0f1a2b3c4d" }), ripplingJob({ description: { role: "" } })]) {
    const mismatch = transport({ [RIP_API]: { status: 200, body: JSON.stringify(job) } });
    fails(await importUrl(url, mismatch.deps), /Could not find/);
  }
});

await probe("Rippling path components are validated before building an API URL", async () => {
  for (const url of [
    `https://ats.rippling.com/acme%2F..%2Fadmin/jobs/${RIP_ID}`,
    "https://ats.rippling.com/acme-co/jobs/not-a-uuid",
    "https://ats.rippling.com/acme-co/jobs"
  ]) {
    const { deps, calls } = transport({});
    fails(await importUrl(url, deps), /HTTP 404/);
    assert(!calls.some((href) => href.includes("api.rippling.com")), url);
  }
});

// --- UKG / UltiPro -----------------------------------------------------------
const OPP_ID = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const UKG_URL = `https://recruiting2.ultipro.com/ACME1038/JobBoard/5a1e2b3c-4d5e-4f60-8a71-b2c3d4e5f601/OpportunityDetail?opportunityId=${OPP_ID}&source=feed`;
const ukgPage = (literal) => page({
  body: `<script>\n  $(function () {\n    var opportunity = new US.Opportunity.CandidateOpportunityDetail(${literal});\n    var applicantSourceId = null;\n  });\n</script>`
});
const ukgOpportunity = (extra = {}) => ({
  Id: OPP_ID,
  Title: "Software Engineer, Level 1",
  Locations: [{ Address: { City: "Waller", State: { Name: "Texas", Code: "TX" } } }],
  Description: `${jdHtml("Software Engineer")}<p>Quoted braces stay data: "});" and {nested}.</p>`,
  OpportunityIsClosed: false,
  ...extra
});

await probe("UKG imports the strict JSON literal for the exact opportunity", async () => {
  const { deps } = transport({ [UKG_URL]: { status: 200, body: ukgPage(JSON.stringify(ukgOpportunity())) } });
  const result = await importUrl(UKG_URL, deps);
  ok(result, /Role: Software Engineer, Level 1/);
  assert.match(result.text, /Location: Waller, TX/);
  assert.match(result.text, /Quoted braces stay data/);
  assert.doesNotMatch(result.text, /Status: Closed/);
});

await probe("a UKG opportunity marked closed keeps its historical JD with an explicit status", async () => {
  const { deps } = transport({ [UKG_URL]: { status: 200, body: ukgPage(JSON.stringify(ukgOpportunity({ OpportunityIsClosed: true }))) } });
  ok(await importUrl(UKG_URL, deps), /Status: Closed/);
});

await probe("UKG wrong ids, malformed literals, and expressions fail without evaluation", async () => {
  globalThis.__ukgEvaluated = false;
  for (const literal of [
    JSON.stringify(ukgOpportunity({ Id: "6f5e4d3c-2b1a-4098-8776-5544332211aa" })),
    '{"Id":"' + OPP_ID + '","Description":',
    "window.__payload",
    `Object.assign(${JSON.stringify(ukgOpportunity())}, (globalThis.__ukgEvaluated = true, {}))`,
    `{Id: "${OPP_ID}", Description: "unquoted keys are not JSON"}`
  ]) {
    const { deps } = transport({ [UKG_URL]: { status: 200, body: ukgPage(literal) } });
    fails(await importUrl(UKG_URL, deps));
  }
  assert.equal(globalThis.__ukgEvaluated, false, "page script is never evaluated");
});

// --- Source-specific failures ------------------------------------------------
await probe("a LinkedIn sign-in or search shell fails instead of importing navigation", async () => {
  const url = "https://www.linkedin.com/jobs/view/9900112233/?trackingId=x";
  const { deps } = transport({
    [url]: { status: 200, body: page({ head: "<title>10,000+ Junior Developer jobs in United States</title>", body: `<nav>Skip to main content Sign in Join now</nav>${marketing}` }) }
  });
  fails(await importUrl(url, deps), /LinkedIn/);
});

await probe("a LinkedIn job page with its description still imports", async () => {
  const url = "https://www.linkedin.com/jobs/view/9900445566/";
  const body = '<ul><li class="description__job-criteria-item"><h3>Seniority level</h3><span>Entry level</span></li></ul>' +
    `<div class="show-more-less-html__markup">${jdHtml("Platform Engineer")}</div>`;
  const { deps } = transport({ [url]: { status: 200, body: page({ body }) } });
  ok(await importUrl(url, deps), /Seniority level: Entry level[\s\S]*Responsibilities/);
});

const GH_EMBED = (board, token) => `https://job-boards.greenhouse.io/embed/job_app?for=${board}&token=${token}`;
const ghJob = page({
  body: `<h1>Software Engineer I</h1><div class="job__location"><div>Remote</div></div><div class="job__description">${jdHtml("Software Engineer I")}</div><div class="application--container">Apply</div>`
});

await probe("a direct Greenhouse job missing from its board fails instead of importing the board", async () => {
  const url = "https://job-boards.greenhouse.io/acmeco/jobs/5550002002";
  const { deps } = transport({
    [GH_EMBED("acmeco", "5550002002")]: { status: 200, body: page({ body: `<h1>Jobs at Acmeco</h1>${marketing}` }) },
    [url]: { status: 200, body: page({ body: `<h1>Jobs at Acmeco</h1>${marketing}` }) }
  });
  fails(await importUrl(url, deps));
});

await probe("a rate-limited job board reports its HTTP status, not a missing job", async () => {
  const url = "https://job-boards.greenhouse.io/acmeco/jobs/5550005005";
  const { deps } = transport({ [GH_EMBED("acmeco", "5550005005")]: { status: 429, body: "" } });
  fails(await importUrl(url, deps), /HTTP 429/);
  assert.equal(await resolveImportedJobText("Captured text.", url, deps), "Captured text.");
});

await probe("direct Greenhouse jobs keep importing", async () => {
  const url = "https://job-boards.greenhouse.io/acmeco/jobs/5550001001";
  const { deps } = transport({ [GH_EMBED("acmeco", "5550001001")]: { status: 200, body: ghJob } });
  ok(await importUrl(url, deps), /Role: Software Engineer I/);
});

await probe("a branded gh_jid wrapper with board evidence fails when the board lacks the job", async () => {
  const url = "https://careers.brand.example/jobs/?gh_jid=5550003003";
  const { deps } = transport({
    [url]: { status: 200, body: page({ body: `${marketing}<script src="https://boards.greenhouse.io/embed/job_board/js?for=brandco"></script>` }) },
    [GH_EMBED("brandco", "5550003003")]: { status: 404, body: "" }
  });
  fails(await importUrl(url, deps));
});

await probe("a branded gh_jid page without board evidence keeps its readable JD", async () => {
  const url = "https://www.consult.example/job/5550004004?gh_jid=5550004004";
  const { deps } = transport({ [url]: { status: 200, body: page({ body: `<h1>Software Engineer</h1>${jdHtml("Software Engineer")}` }) } });
  ok(await importUrl(url, deps), /Responsibilities/);
});

await probe("a Jobvite missing-job shell fails while a Jobvite JD imports", async () => {
  const url = "https://jobs.jobvite.com/acmecareers/job/zQx7Lm2P?__jvst=Job%20Board";
  const missing = transport({
    [url]: { status: 200, body: page({ body: `<div class="jv-page-error"><h2 class="jv-page-error-header">The job listing no longer exists.</h2></div>${marketing}` }) }
  });
  fails(await importUrl(url, missing.deps));
  const present = transport({
    [url]: { status: 200, body: page({ body: `<h2 class="jv-header">Platform Engineer</h2><div class="jv-job-detail-description">${jdHtml("Platform Engineer")}</div>` }) }
  });
  ok(await importUrl(url, present.deps), /Responsibilities/);
});

await probe("a historical JD that mentions closed language is not rejected by a phrase blacklist", async () => {
  const url = "https://careers.fund.example/job/analyst-credit-technology";
  const body = page({ body: `<h1>Analyst</h1><p>This role supports closed-end funds that are no longer accepting new capital.</p>${jdHtml("Analyst")}` });
  const { deps } = transport({ [url]: { status: 200, body } });
  ok(await importUrl(url, deps), /closed-end funds/);
});

// --- Unsafe URLs stay blocked ----------------------------------------------
await probe("unsafe original URLs and private DNS answers are rejected", async () => {
  const { deps, calls } = transport({}, { privateHosts: ["rebind.example"] });
  fails(await importUrl("http://127.0.0.1/jobs/1", deps), /public http or https/i);
  fails(await importUrl("https://jobs.example:8443/jobs/1", deps), /public http or https/i);
  fails(await importUrl("https://rebind.example/jobs/1", deps), /private or local/i);
  assert.equal(calls.length, 0, "no connection is opened for a rejected host");
});

// --- Extension enrichment ----------------------------------------------------
await probe("extension enrichment resolves recognized sources and keeps captured text otherwise", async () => {
  const captured = "Captured visible JD text from the browser tab.";
  const resolved = embedCase("extensionco");
  const embedded = transport({
    [resolved.url]: embedWrapper(embedScript("extensionco")),
    [resolved.api]: ashbyBoard([ashbyJob(UUID_A, "Platform Engineer")])
  });
  assert.match(await resolveImportedJobText(captured, resolved.url, embedded.deps), /Role: Platform Engineer/);

  const origin = new URL(ORACLE_URL).origin;
  const oracle = transport({ [ORACLE_URL]: oraclePage(), [oracleApi(origin)]: oracleResponse([oracleItem("61803")]) });
  assert.match(await resolveImportedJobText(captured, ORACLE_URL, oracle.deps), /Role: Software Development Engineer/);

  const absent = embedCase("absentco");
  const missing = transport({ [absent.url]: embedWrapper(embedScript("absentco")), [absent.api]: ashbyBoard([]) });
  assert.equal(await resolveImportedJobText(captured, absent.url, missing.deps), captured);

  const generic = transport({ [NUMERIC_URL]: { status: 200, body: shell(ldScript(posting({ url: NUMERIC_URL }))) } });
  assert.equal(await resolveImportedJobText(captured, NUMERIC_URL, generic.deps), captured, "no generic scrape replaces captured text");

  const blocked = transport({ [ICIMS_URL]: { status: 200, body: icimsFrame(ICIMS_FRAME) }, [ICIMS_FRAME]: { status: 302, headers: { location: "http://10.0.0.1/" } } });
  assert.equal(await resolveImportedJobText(captured, ICIMS_URL, blocked.deps), captured);
});

// --- Embedded job-board frames -------------------------------------------------
const COMPANY_PAGE = "https://www.brand.example/careers/backend-engineer";
const FRAME_GH = GH_EMBED("brandco", "5550006006");
const FRAME_RIP = `https://ats.rippling.com/acme-co/jobs/${RIP_ID}`;
const companyRoute = { [COMPANY_PAGE]: { status: 200, body: page({ body: marketing }) } };
const captured = "Captured company page text around an embedded application frame.";

await probe("one recognized job-board frame resolves an unrecognized page's posting", async () => {
  const gh = transport({ ...companyRoute, [FRAME_GH]: { status: 200, body: ghJob } });
  // The same posting framed under two spellings is one candidate, not ambiguity.
  const frames = ["https://www.youtube-nocookie.com/embed/abc", FRAME_GH, "https://boards.greenhouse.io/embed/job_app?token=5550006006&for=brandco"];
  assert.match(await resolveImportedJobText(captured, COMPANY_PAGE, gh.deps, frames), /Role: Software Engineer I/);
  assert(!gh.calls.some((href) => href.includes("youtube")), "an unrecognized frame is never fetched");

  const rip = transport({ ...companyRoute, [RIP_API]: { status: 200, body: JSON.stringify(ripplingJob()) } });
  assert.match(await resolveImportedJobText(captured, COMPANY_PAGE, rip.deps, [FRAME_RIP]), /Role: Backend Engineer/);

  const leverFrame = "https://jobs.lever.co/brandco/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const lever = transport({ ...companyRoute, [leverFrame]: { status: 200, body: page({ body: `<h2>Data Engineer</h2>${jdHtml("Data Engineer")}` }) } });
  assert.match(await resolveImportedJobText(captured, COMPANY_PAGE, lever.deps, [leverFrame]), /Data Engineer[\s\S]*Responsibilities/);
});

await probe("ambiguous, unrecognized, unsafe, or failing frames keep the captured text", async () => {
  const cases = [
    [[FRAME_GH, FRAME_RIP], { [FRAME_GH]: { status: 200, body: ghJob }, [RIP_API]: { status: 200, body: JSON.stringify(ripplingJob()) } }],
    [["https://widgets.example/chat", "https://www.brand.example/apply?gh_jid=5550006006"], {}],
    [["http://127.0.0.1/jobs/1", "javascript:alert(1)", "not a url", 42, "https://jobs.example:8443/jobs/1"], {}],
    [[FRAME_RIP], { [RIP_API]: { status: 404, body: "" } }],
    [[GH_EMBED("brandco", "5550007007")], { [GH_EMBED("brandco", "5550007007")]: { status: 503, body: "" } }]
  ];
  for (const [frames, routes] of cases) {
    const { deps, calls } = transport({ ...companyRoute, ...routes });
    assert.equal(await resolveImportedJobText(captured, COMPANY_PAGE, deps, frames), captured, JSON.stringify(frames));
    if (!Object.keys(routes).length) {
      assert.deepEqual(calls.filter((href) => href !== COMPANY_PAGE), [], "nothing beyond the page is fetched");
    }
  }
});

await probe("extension enrichment resolves Microsoft and Rippling and keeps the capture when they fail", async () => {
  const ms = transport({ [MS_API]: { status: 200, body: JSON.stringify(msPosition()) } });
  assert.match(await resolveImportedJobText(captured, MS_URL, ms.deps), /Role: Software Engineer II/);
  const rip = transport({ [RIP_API]: { status: 200, body: JSON.stringify(ripplingJob()) } });
  assert.match(await resolveImportedJobText(captured, FRAME_RIP, rip.deps), /Role: Backend Engineer/);
  for (const [url, api, status] of [[MS_URL, MS_API, 503], [MS_URL, MS_API, 404], [FRAME_RIP, RIP_API, 503], [FRAME_RIP, RIP_API, 404]]) {
    const { deps } = transport({ [api]: { status, body: "" } });
    assert.equal(await resolveImportedJobText(captured, url, deps), captured, `${url} ${status}`);
  }
});

await probe("a recognized page URL ignores its frames", async () => {
  const url = "https://job-boards.greenhouse.io/acmeco/jobs/5550001001";
  const { deps, calls } = transport({ [GH_EMBED("acmeco", "5550001001")]: { status: 200, body: ghJob } });
  assert.match(await resolveImportedJobText(captured, url, deps, [FRAME_RIP]), /Role: Software Engineer I/);
  assert(!calls.some((href) => href.includes("rippling")));

  const workday = "https://acme.wd5.myworkdayjobs.com/External/job/Remote/Engineer_R100";
  const miss = transport({ [RIP_API]: { status: 200, body: JSON.stringify(ripplingJob()) } });
  assert.equal(await resolveImportedJobText(captured, workday, miss.deps, [FRAME_RIP]), captured, "a Workday CXS miss keeps the capture");
  assert(!miss.calls.some((href) => href.includes("rippling")));
});

await probe("frame URL input is bounded to eight strings of at most 2,000 characters", async () => {
  assert.deepEqual(cleanFrameUrls(undefined), []);
  assert.deepEqual(cleanFrameUrls("https://a.example/"), []);
  assert.deepEqual(cleanFrameUrls(["https://a.example/", 7, null, `https://b.example/${"x".repeat(2_000)}`]), ["https://a.example/"]);
  assert.equal(cleanFrameUrls(Array.from({ length: 20 }, (_, i) => `https://f${i}.example/`)).length, 8);
});

if (failures) {
  console.log(`${failures} job import route probe(s) failed`);
  process.exitCode = 1;
} else {
  console.log("PASS job import route probes");
}
