// Local, dependency-free distiller for imported job postings.
//
// The server hands back tag-stripped text from a job page (or a known ATS JSON
// description). This helper produces two related outputs:
// - compact tailoring text for the model/review path
// - separately extracted tracking facts (role summary, location, compensation)
//
// The split matters: pay, benefits, application instructions, and legal copy are
// useful for the user's tracker, but they should not burn tokens in the resume
// tailoring prompt or steer the model toward irrelevant wording.
//
// It is best-effort and conservative. When unsure, it keeps potential role
// requirements and reports missing tracking fields so the user can fill them in
// manually instead of relying on guessed facts.

export type ExtractedSalaryPeriod = "yr" | "mo" | "hr";

export type ExtractedJobTracking = {
  title?: string;
  role?: string;
  company?: string;
  source?: string;
  location?: string;
  jobType?: string;
  workAuth?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string;
  salaryPeriod?: ExtractedSalaryPeriod;
  roleDescription?: string;
};

export type ExtractedJobPosting = {
  tailoringText: string;
  roleDescription: string;
  tracking: ExtractedJobTracking;
  manualReviewFields: string[];
  sourceTextLength: number;
};

type ExtractOptions = {
  url?: string;
  maxChars?: number;
};

// Lines that, once real content has been seen, mark the start of trailing
// boilerplate we can safely drop.
const TRAILING_BOILERPLATE: RegExp[] = [
  /^#?li-[a-z0-9]+\b/i, // LinkedIn tracking tag, e.g. "#LI-PP1"
  /^more about\b/i,
  // Narrow: "About us/the company" is trailing marketing, but "About the team/role"
  // is often a real section, so don't treat those as a cut point.
  /^about (us|the company|our company)\b/i,
  /^business unit\s*:/i,
  /^scheduled weekly hours\s*:/i,
  /^number of openings\b/i,
  /^worker type\s*:/i,
  /^primary location\s*:/i,
  /^job (req(uisition)?|posting) (id|number)\s*:/i,
  // Benefits / perks / "why join us" marketing. These are useful tracker facts
  // only when the user copies them manually; they do not help tailor a resume.
  /^(benefits|perks|our benefits|the benefits|what we offer|what['']?s in it for you)\b/i,
  /^(what you['']?ll (receive|get)|what you get|compensation (and|&) benefits)\b/i,
  // "Why you'll love this job" often introduces the actual role (American
  // Airlines-style pages); benefits sections use "What you'll get/receive" or
  // explicit perks/benefits language below.
  /^(why (join|work)|perks (and|&) benefits)\b/i,
  /^what you['']?ll get\b/i,
  // Application instructions and pay-transparency legalese.
  /^(how to apply|to apply\b|ready to apply)/i,
  /pay transparency/i,
  /\bis your place\b/i,
  /^total rewards\b/i,
  /^salary range for this position/i,
  /^the (likely|base|expected|anticipated) (salary|pay|compensation|base pay|pay range)\b/i,
  // Workday footer metadata block (label lines whose values follow on the next
  // line); cutting at the first one drops the whole trailing block.
  /^(scheduled weekly hours|travel required|telecommuting options?|additional work locations?)\s*:?\s*$/i,
  /equal opportunity employer/i,
  /equal employment opportunity/i,
  /^we are an equal\b/i,
  /\be-?verify\b/i,
  /^applicants? (with disabilities|who require)/i,
  /^(privacy|cookie) (policy|notice|statement)\b/i
];

// Standalone lines that are pure page furniture, dropped wherever they appear.
const NOISE_LINE: RegExp[] = [
  // ATS page title repeated above the real role title (e.g. Greenhouse renders
  // "Job Application for <Role> at <Company>"); a leading bullet may survive.
  // Note: extractTracking runs on rawLines and can still see this line for
  // Greenhouse company/title parsing before it's removed from tailoring lines.
  /^[•·‣◦▪●○*\-–—\s]*job application for\b/i,
  /^(apply|apply now|easy apply|quick apply|save|save job|saved|share|share this job|print|email)$/i,
  /^apply (on company website|externally|with (linkedin|indeed))$/i,
  /^(report (this )?job|flag this job)$/i,
  /^(follow us|connect with us|join our talent (community|network))$/i,
  /^(back to (search results|jobs|search)|view all jobs|see all jobs)$/i,
  /^(sign in|signin|create (an )?account|register|log ?in)$/i,
  /^(show|read|see) (more|less)$/i,
  /^we use cookies/i,
  /^(accept|accept all|reject|manage) cookies?$/i,
  /^as noted above,\s*this list is intended\b/i,
  /^\d+\+? (days?|hours?|weeks?|months?) ago$/i,
  /^(just posted|new)$/i,
  // LinkedIn guest/job-view UI chrome. These survive into tailoring text and
  // (a) fabricate an "AI" tech keyword + domain via TECH_KEYWORDS/DOMAIN_SIGNALS
  // matching "AI" in "Use AI to assess…", and (b) get mistaken for the job title
  // by the reappear/proximity fallback ("Email or phone", "Tailor my resume").
  /^use ai to assess\b/i,
  /^get ai[- ]powered advice\b/i,
  /^am i a good fit\b/i,
  /^tailor my resume$/i,
  /^how can i best position myself\b/i,
  /^how does my (background|profile|experience)\b/i,
  /^(email or phone|email|password|forgot password\??)$/i,
  /^join to apply\b/i,
  /^sign in to (access|view|evaluate|tailor|see|save|apply|continue|find)\b/i,
  /^see who .+ (has )?hired for this role$/i,
  /^(meet the team|people you may know|set alert|create job alert|save alert)$/i,
  /^see more jobs$/i,
  /^\d+(,\d{3})*\+? (applicants?|people clicked apply)$/i,
  /^(be among the first|over \d+ applicants?)\b/i,
  /^get notified about new\b/i,
  // Careers-site navigation / CTA chrome. When the extension falls back to
  // document.body.innerText (no JD selector matched), the page leads with this
  // nav block; without removing it the title fallback grabs "Dashboard" / "Sign
  // in" / "Amazon Jobs home page" instead of the role.
  /^skip to (main )?content$/i,
  /^(single position|view all jobs?|all jobs|view job)$/i,
  /^add to (cart|favou?rites?)$/i,
  /^view favou?rites?$/i,
  /^(apply now|apply externally|apply for this (job|role|position)|easy apply|quick apply|start (your )?application|submit (your )?application)$/i,
  /^my (career|settings|profile|jobs)$/i,
  /^career opportunities$/i,
  /^join (our )?talent (community|network)$/i,
  /^activate career alerts$/i,
  /^find similar (career|jobs?)/i,
  /^create (your )?(profile|account)\b/i,
  /^(candidate|partner|employee) login$/i,
  /^\d+ notifications?$/i,
  /^find out how well you match\b/i,
  /^upload your resume\b/i,
  /^i['‘’]?m interested$/i,
  /^company and benefits$/i,
  /^(dashboard|profile|culture|locations|professions|programs|hiring tips|my career|life at\b.*)$/i,
  // Standalone salary/comp pill (e.g. "$120,000 - $150,000 / yr"). Salary is
  // extracted into tracking metadata before this line is removed from prompt text.
  /^\$?[\d,]+(\.\d+)?(k)?(\s*[-–—to]+\s*\$?[\d,]+(\.\d+)?(k)?)?(\s*(\/|per)?\s*(yr|year|hour|hr|annum|month|mo))?$/i,
  /^(home|jobs|careers|search)$/i
];

const LOW_VALUE_METADATA_LABEL: RegExp[] = [
  /^type of requisition\s*:?\s*$/i,
  /^public trust\/other required\s*:?\s*$/i,
  /^job family\s*:?\s*$/i,
  /^job qualifications\s*:?\s*$/i  // Fix #12: Workday "Job Qualifications:" label
];

const NON_TAILORING_SECTION: RegExp[] = [
  // Fix(JD-corpus): allow a leading modifier ("Expected Compensation", "Annual
  // Salary") — the anchored form missed them and the comp block leaked into quals.
  /^(expected |anticipated |target |annual )?(compensation|salary|pay range|base pay|total rewards)\b/i,
  /^logistics\s*(?:and|&)\s*compensation\b/i,  // only the "Logistics & Compensation" block, not a "Logistics coordination…" duty
  /^physical (?:demands|requirements)\b/i,  // boilerplate, never a tailoring qual
  /^accommodations?\s*:?\s*$/i,  // STANDALONE "Accommodations" footer heading only (not "Accommodation industry experience…")
  /^posting statement\b/i,      // Fix(JD-corpus): Workday "Posting Statement" footer
  /^unleash your potential\b/i, // Fix(JD-corpus): a benefits/culture closer, not duties (Salesforce)
  /^(benefits|perks|our benefits|what we offer|what['']?s in it for you)\b/i,
  /^what we['‘’]?ll bring\b/i,  // Fix(JD-test): "What we'll bring" perks/benefits section (Toyota) — boundary so preferred-quals collection stops before benefits
  /^job designation\b/i,  // Fix(JD-test): "Job Designation" (Hybrid/Remote work-arrangement block, Docusign) — logistics, not a duty/qual
  /^(how to apply|application instructions|about (us|the company|our company))\b/i,
  /^(equal opportunity|eeo|privacy notice|cookie notice)\b/i,
  // Fix #19: filter culture/values nav sections that appear before actual job content
  /^(our values|living our values|company values|core values|win together)\b/i
];

const TAILORING_SECTION: RegExp[] = [
  /^(job description|position description|overview|role overview|about the role|the role|your impact)\b/i,
  /^(responsibilities|what you['']?ll do|what you will do|day to day)\b/i,
  /^you will:?\s*$/i,
  /^(requirements|qualifications|minimum qualifications|basic qualifications|required qualifications|preferred qualifications)\b/i,
  /^all you['']?ll need for success\b/i,
  // Fix #2 (TAILORING_SECTION): narrow "skills" and "experience" to bare heading only
  // so "Experience with Git..." and "Skills in Python" are not treated as section headings.
  /^(technical skills|what we['']?re looking for|who you are)\b/i,
  /^skills$/i,
  /^experience$/i
];

const SECTION_HEADING: RegExp[] = [...NON_TAILORING_SECTION, ...TAILORING_SECTION];

const COMPANY_CONTEXT_HEADING: RegExp[] = [
  /^company \/ product context\b/i,
  /^about (?!the role\b).+/i,
  /^about us\b/i,
  /^who we are\b/i,
  /^our company\b/i,
  /^company overview\b/i
];

// Fix #1: Added heading variants for responsibilities, required, preferred
const RESPONSIBILITY_HEADING: RegExp[] = [
  /^((core|key) )?responsibilit(y|ies)\b/i,  // Fix #1: covers "core/key responsibilities" + bare form
  /^what you['']?ll do\b/i,
  /^what you will do\b/i,
  /^what you(?: will|['‘’]?ll)(?:\s+\w+)? be doing\b/i,  // "What you will be doing" / "What You'll Be Doing" (Toyota) / "What You'll Actually Be Doing" (Salesforce, optional adverb)
  /^your impact\b/i,
  /^you will:?\s*$/i,  // only bare "You will" or "You will:" — not "You will work alongside..."
  /^day[- ]to[- ]day\b/i,
  /^job duties\b/i,           // Fix #1: added
  /^example projects?\b/i,    // Fix #1: added
  // Fix(JD-corpus): common duty-section variants that fell through to the lossy
  // verb-sweep fallback, leaking intro/marketing prose into responsibilities.
  /^(essential )?(duties|functions|job functions)(\s*(?:and|&)\s*responsibilit(?:y|ies))?\b/i,
  /^principal duties\b/i,
  /^duties\s*(?:and|&)\s*responsibilit(?:y|ies)\b/i,
  /^roles?\s*(?:and|&)\s*responsibilit(?:y|ies)\b/i,
  /^the work( itself)?\s*:?\s*$/i,
  /^job description and responsibilit(?:y|ies)\b/i,
  /^what (?:is|we) expect(?:ed)? of you\b/i
];

const REQUIRED_HEADING: RegExp[] = [
  /^required qualifications?\b/i,
  /^minimum qualifications?\b/i,
  /^basic qualifications?\b/i,       // AWS / Northwood-style "Basic Qualifications"
  /^basic requirements?\b/i,
  /^requirements?\b/i,
  /^qualifications?\b/i,
  /^what we['']?re looking for\b/i,
  /^who you are\b/i,
  /^required skills?\b/i,              // Fix #1: added
  /^must[- ]?haves?\s*:?\s*$/i,        // Fix(JD-test): STANDALONE "Must-have(s)" heading only — anchored so a "Must have <X>" requirement bullet isn't mistaken for a heading (which would drop it / end collection)
  /^you(?:['‘’]?ll)? have\s*:?\s*$/i,  // Fix(JD-test): STANDALONE "You have"/"You'll have" heading only — not a "You have <X>" requirement bullet
  /^all you['']?ll need for success\b/i,
  /^skills,\s*licenses?\s*(?:&|and)\s*certifications?\b/i,
  /^what you bring\b/i,  // Fix(JD-test): "What you bring" umbrella requirements heading (Toyota)
  /^what you(?:['‘’]?ll)? have\b/i,  // "What You Have" / "What You'll Have" quals heading (Ashby/Commure)
  /^you must have$/i,    // Fix(JD-test): "YOU MUST HAVE" standalone heading (Honeywell)
  /^basic$/i,            // Fix(JD-test): bare "Basic" subheading (Docusign); mirrors skills/experience
  /^what you[\u0027\u2018\u2019]?ll need( to succeed)?\b/i,  // Fix #1: added
  // Fix #2: narrow bare "skills" and "experience" to ONLY the standalone heading,
  // not lines like "Experience: 0-3 years…" or "Experience with Git…".
  // matchesHeading() strips a trailing colon before testing, so we anchor on the
  // stripped form (just the word itself, nothing following).
  /^skills$/i,
  /^experience$/i,
  // Fix(JD-corpus): more required-quals heading variants seen in real postings.
  /^core qualifications?\b/i,
  /^(position|job|role) requirements?\b/i,
  /^key requirements?\b/i,
  /^who we['‘’]?re looking for\b/i,
  /^what we require\b/i,
  /^what you(?:['‘’]?ll)? bring\b/i,
  /^you['‘’]?ll thrive\b/i,
  /^you['‘’]?re our (?:ideal )?(?:person|candidate|fit)\b/i,  // Salesforce "You're Our Person If…"
  /^experience,\s*skills(?:,|\s*(?:and|&))/i,  // "Experience, Skills, Knowledge Requirements" (Ascensus)
  /^(?:knowledge|skills),\s*(?:skills|knowledge)\b/i,
  /^skills required\b/i,  // inline "Skills Required: …" (JPMC/Oracle)
  /^minimum education\b/i,  // inline "Minimum education and experience required: …"
  /^do you qualify\b/i,  // "Do you qualify? You likely do if you have…" (SkillStorm)
  /^you likely (?:do|qualify|have)\b/i,
  /^required$/i  // bare "Required" split from a "Qualifications / Required" header
];

const PREFERRED_HEADING: RegExp[] = [
  /^preferred qualifications?\b/i,
  /^preferred skills\b/i,
  /^nice[- ]to[- ]haves?\b/i,  // Fix(JD-test): also matches plural "Nice-to-haves"
  /^bonus\b/i,
  /^plus(es)?\b/i,
  /^additional skills?\b/i,   // Fix #19: "Additional skills:" is typically a preferred/bonus section
  /^added bonus\b/i,  // Fix(JD-test): "Added bonus if you have" preferred section (Toyota)
  /^we value$/i,      // Fix(JD-test): "WE VALUE" standalone preferred heading (Honeywell)
  /^what (?:will )?set(?:s)? you apart\b/i,  // Fix(JD-corpus)
  /^even better if\b/i,  // Salesforce "Even Better If…" (bonus quals)
  /^desirable\b/i,
  /^desired (?:qualifications?|skills?|experience)\b/i,
  /^what can give you an edge\b/i,
  /^preferred\b/i  // Fix #1: added as LAST entry so longer required variants win
];

const STRUCTURE_HEADING: RegExp[] = [
  ...COMPANY_CONTEXT_HEADING,
  ...RESPONSIBILITY_HEADING,
  ...REQUIRED_HEADING,
  ...PREFERRED_HEADING,
  ...NON_TAILORING_SECTION,
  ...TAILORING_SECTION
];

// Job-content headings that should RE-OPEN a skipped non-tailoring section (so a
// benefits block — "What we'll bring" — sitting between "What you bring" and a
// preferred section doesn't swallow the section after it). Code-review fix: the
// preferred set here is the STRONG, unambiguous headings only — bare "bonus" /
// "plus(es)" / "preferred" / "additional skills" are EXCLUDED because benefits
// prose routinely opens with them ("Bonus potential up to 15%", "Plus generous
// PTO"), which would wrongly re-open the skipped benefits block.
const CONTENT_REENTRY_HEADING: RegExp[] = [
  ...RESPONSIBILITY_HEADING,
  ...REQUIRED_HEADING,
  /^preferred qualifications?\b/i,
  /^preferred skills\b/i,
  /^nice[- ]to[- ]haves?\b/i,
  /^added bonus\b/i,
  /^we value$/i,
  /^about you\b/i,   // Fix(JD-corpus): body re-opens after a comp/benefits skip
  /^you likely\b/i
];

// Fix #13: C# regex — \bc#\b never matches because # is non-word; use boundary
// workaround with a lookbehind/lookahead that avoids \w on either side.
// Fix #14: Added Flask, FastAPI, Vue, Elasticsearch, Express.js, HTML, CSS
const TECH_KEYWORDS: Array<[string, RegExp]> = [
  ["JavaScript", /\bjavascript\b|\bjs\b/i],
  ["TypeScript", /\btypescript\b/i],
  ["React", /\breact(?:\.js|js)?\b/i],
  ["Node.js", /\bnode(?:\.js|js)?\b/i],
  ["Python", /\bpython\b/i],
  ["Java", /\bjava\b/i],
  ["C++", /\bc\+\+|\bcpp\b/i],  // Fix(JD-test): dropped trailing \b — it never matched "C++," before punctuation
  ["C#", /(^|[^\w])c#(?=[^\w]|$)/i],  // Fix #13
  // "go" is a common verb ("go above and beyond"), so bare Go only counts when
  // it looks like a language mention: Golang, "Go programming/development",
  // known experience phrases, or a comma/slash/paren-delimited tech list item.
  ["Go", /\bgolang\b|\bgo\s+(?:language|programming|development|developer|engineer|services?|apis?|backend|microservices?)\b|(?:\b(?:experience with|proficien(?:t|cy) in|knowledge of|using|with|in|write(?:s|ing)?|build(?:ing)? with|building)\s+)go(?=\s*(?:[,.;)/]|$|\band\b|\bor\b|\s+(?:services?|apis?|backend|microservices?)\b))|(?:^|[,(;/]\s*)go(?=\s*(?:[,.;)/]|$|\band\b|\bor\b))/i],
  ["Ruby", /\bruby\b/i],
  // Fix(JD-test): Salesforce platform/ecosystem (was entirely absent — central tech of the Honeywell Sparta role)
  ["Salesforce", /\bsalesforce(?:dx)?\b|\bapex\b|\bagentforce\b|\bdatacloud\b|\bsfdx\b|\bsf cli\b|\blightning web components?\b|\blwc\b/i],
  ["SQL", /\bsql\b/i],
  ["PostgreSQL", /\bpostgres(?:ql)?\b/i],
  ["MySQL", /\bmysql\b/i],
  ["MongoDB", /\bmongodb\b/i],
  ["Redis", /\bredis\b/i],
  ["Flask", /\bflask\b/i],            // Fix #14
  ["FastAPI", /\bfastapi\b/i],         // Fix #14
  ["Vue", /\bvue(?:\.js|js)?\b/i],     // Fix #14
  ["Elasticsearch", /\belastic(?:search)?\b/i],  // Fix #14
  ["Express.js", /\bexpress\.?js\b/i], // Fix #14: require .js suffix to avoid prose "express"
  ["HTML", /\bhtml\b/i],               // Fix #14
  ["CSS", /\bcss\b/i],                 // Fix #14
  ["AWS", /\baws\b|\bamazon web services\b/i],
  ["Azure", /\bazure\b/i],
  ["GCP", /\bgcp\b|\bgoogle cloud\b/i],
  ["Docker", /\bdocker\b/i],
  ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["REST APIs", /\brest(?:ful)? apis?\b|\bapi development\b/i],
  ["GraphQL", /\bgraphql\b/i],
  ["Microservices", /\bmicroservices?\b/i],
  ["CI/CD", /\bci\/cd\b|\bcontinuous integration\b|\bcontinuous delivery\b/i],
  // Bare "testing" is a process word ("code reviews, testing, and debugging"),
  // not a stack signal — require a concrete testing practice or framework.
  ["Testing", /\bunit test(?:s|ing)?\b|\bintegration test(?:s|ing)?\b|\bautomated test(?:s|ing)?\b|\btest[- ]driven\b|\btdd\b|\bjest\b|\bpytest\b|\bcypress\b|\bplaywright\b/i],
  ["Git", /\bgit\b|\bgithub\b|\bgitlab\b/i],
  ["Agile", /\bagile\b|\bscrum\b/i],
  ["Machine learning", /\bmachine learning\b|\bml\b/i],
  ["AI", /\bai\b|\bartificial intelligence\b|\bllm\b|\blarge language models?\b/i],
  ["Data structures", /\bdata structures?\b/i],
  ["Algorithms", /\balgorithms?\b/i],
  // Fix(JD-test): broaden language/framework/data-tool coverage. Appended at the
  // end so the top-14 cap still favors the more common keywords above; these
  // surface for roles that center on them. "Spring" is gated to a Spring product
  // so the season word can't fire.
  ["Rust", /\brust\b/i],
  ["Kotlin", /\bkotlin\b/i],
  // Fix(JD-test): "swift" is a common adjective ("swift support"), so require a
  // dev-context word (the language in a comma-list is missed, but precision wins
  // for an anti-fabrication brief).
  ["Swift", /\bswiftui\b|\bswift\s+(?:developer|engineer|programming|programmer|language|sdk)\b/i],
  ["Scala", /\bscala\b/i],
  ["PHP", /\bphp\b/i],
  // Fix(JD-test): anchor ".net" to a start/space/paren so a "company.net" domain
  // or "x@y.net" email in the page body doesn't fabricate .NET.
  [".NET", /(?:^|[\s(\[\/,])\.net\b|\bdotnet\b|\basp\.net\b|\bvb\.net\b/i],  // Fix: allow "/" and "," delimiters ("C#/.NET", "C++,.NET") while still excluding "company.net" domains
  ["Spring", /\bspring\s?(?:boot|framework|mvc|cloud|security|data)\b/i],
  ["Django", /\bdjango\b/i],
  ["Angular", /\bangular\b/i],
  ["Rails", /\bruby on rails\b|\brails\b/i],
  ["Kafka", /\bkafka\b/i],
  ["Spark", /\bapache spark\b|\bpyspark\b|\bspark\s+(?:streaming|sql)\b/i],  // Fix(JD-test): explicit forms only — bare "spark" is a common verb ("spark ideas")
  ["Terraform", /\bterraform\b/i],
  ["Snowflake", /\bsnowflake\b(?!\s+schema)/i],  // Fix: exclude "snowflake schema" (a data-modeling term, not the Snowflake product)
  ["Airflow", /\bairflow\b/i]
];

const DOMAIN_SIGNALS: Array<[string, RegExp]> = [
  ["healthcare", /\bhealth(?:care)?\b|\bclinical\b|\bpatient\b|\bmedical\b|\blife sciences?\b|\bregulated industr/i],
  ["fintech", /\bfintech\b|\bfinancial\b|\bpayments?\b|\bbanking\b|\bcapital markets?\b|\bprivate equity\b|\binvest(?:ing|ments?)\b/i],
  ["AI", /\bai\b|\bartificial intelligence\b|\bmachine learning\b|\bllm\b/i],
  // Bare "platform" fired on product words ("CMS platform", "reading platform");
  // require an infra context so a generic product page doesn't tag infrastructure.
  ["infrastructure", /\binfrastructure\b|\bcloud platform\b|\bplatform engineering\b|\bcloud\b|\bdevops\b|\bsre\b/i],
  ["SaaS", /\bsaas\b|\bsoftware as a service\b/i],
  ["enterprise", /\benterprise\b|\bb2b\b/i],
  ["security", /\bsecurity\b|\bcybersecurity\b|\bcompliance\b|\bsoc 2\b/i],
  ["identity", /\bidentity verification\b|\bidv\b|\bkyc\b|\bdocument verification\b/i],  // Fix(JD-test): IDV/identity domain (Docusign)
  ["data", /\bdata\b|\banalytics\b|\bbi\b|\bwarehouse\b|\bpipeline\b/i],
  ["e-commerce", /\be-?commerce\b|\bretail\b|\bmarketplace\b/i],
  ["aviation", /\bairline\b|\baviation\b|\bflights?\b|\bairports?\b/i],
  // Fix #17: narrow education domain to avoid "continuous learning" or bare "Education:" label
  ["education", /\bedtech\b|\be-?learning\b|\beducation(al)? (technology|platform|company|sector)\b/i],
  ["government", /\bgovernment\b|\bpublic sector\b|\bfederal\b/i]
];

const SOURCE_BY_HOST: Array<[RegExp, string]> = [
  [/(^|\.)linkedin\.com$/i, "LinkedIn"],
  [/(^|\.)indeed\.com$/i, "Job board"],
  [/(^|\.)greenhouse\.io$/i, "Company site"],
  [/(^|\.)lever\.co$/i, "Company site"],
  [/(^|\.)myworkdayjobs\.com$/i, "Company site"]
];

// A bullet or list marker with no real text after it — empty <li> spacers,
// icon-only items, or stray punctuation rows left over from the scraped HTML.
function isEmptyMarker(line: string): boolean {
  const stripped = line
    .replace(/^[\s•·‣◦▪●○*\-–—]+/, "")
    .replace(/^\d+[.)]\s*/, "");
  return !/[A-Za-z0-9]/.test(stripped);
}

// Curly/smart quote normalization. Uses String.fromCharCode for all quote-like
// characters to prevent editor auto-replacement of apostrophes/quotes.
// U+2018/U+2019 = left/right single quotation marks; U+201C/U+201D = double.
// U+0027 = plain apostrophe; U+0022 = plain double-quote; U+00A0 = NBSP.
const CURLY_SINGLE_RE = new RegExp(
  `[${String.fromCharCode(0x2018)}${String.fromCharCode(0x2019)}]`, `g`
);
const CURLY_DOUBLE_RE = new RegExp(
  `[${String.fromCharCode(0x201c)}${String.fromCharCode(0x201d)}]`, `g`
);
const STRAIGHT_APOSTROPHE = String.fromCharCode(0x27);
const STRAIGHT_DQUOTE = String.fromCharCode(0x22);
const NBSP = String.fromCharCode(0xa0);
const NEWLINE = String.fromCharCode(0x0a);

function normalize(raw: string): string {
  return raw
    .replace(/\r\n?/g, NEWLINE)
    .replace(new RegExp(NBSP, `g`), ` `)           // NBSP → regular space
    .replace(CURLY_SINGLE_RE, STRAIGHT_APOSTROPHE) // curly single quotes → straight
    .replace(CURLY_DOUBLE_RE, STRAIGHT_DQUOTE)     // curly double quotes → straight
    .replace(/[ \t]+/g, ` `)
    .split(NEWLINE)
    // Strip Workday's screen-reader announcement suffix ("<title> page is loaded")
    // so it doesn't pollute the job title or role description.
    .map((line) => line.trim().replace(/\s+page is loaded$/i, ""))
    .join(NEWLINE)
    .replace(/\n{3,}/g, `\n\n`)
    .trim();
}

function nextTextIndex(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].trim()) return i;
  }
  return -1;
}

function isMetadataLabel(line: string): boolean {
  return /^[A-Za-z][A-Za-z0-9 /&''()-]+:\s*$/.test(line.trim());
}

// Bare ATS field labels that sit on their own line ABOVE their value
// ("Job Category"\n"Technology"). They carry no trailing colon, so isMetadataLabel
// misses them — and then the title fallback mistakes the label (or the value
// stacked beneath it) for the job title.
const ATS_FIELD_LABEL =
  /^(job (id|category|function|level|type|family|req(uisition)?(\s*id)?)|posting date|expiration date|date posted|workplace expectation|work(place)? type|worker type|pay|salary|compensation|seniority level|experience level|employment type|requisition(\s*id)?|req id|department|division|business unit|schedule|shift)\s*:?\s*$/i;

function isBareFieldLabel(line: string): boolean {
  const t = line.trim();
  return isMetadataLabel(t) || ATS_FIELD_LABEL.test(t);
}

// Strip a leading "Section 2:", "Part 3 -", "Step 1." numbering prefix that some
// ATSes prepend to real section headings ("Section 2: Job Functions, Essential
// Duties and Responsibilities") — otherwise the heading match fails and the whole
// section's duties/quals are dropped. Also drop a trailing colon.
function headingCore(line: string): string {
  return line
    .trim()
    // Only "Section/Part N" — document-section markers. NOT "Step/Phase N", which
    // are numbered PROCESS-STEP duties ("Step 1: Requirements gathering with…") and
    // must stay content, not be re-read as a Requirements heading.
    .replace(/^(?:section|part)\s+\d+\s*[:.)\-–—]\s*/i, "")
    .replace(/:\s*$/, "");
}

function isSectionHeading(line: string): boolean {
  const t = headingCore(line);
  return t.length > 1 && t.length <= 90 && SECTION_HEADING.some((re) => re.test(t));
}

function isStructureHeading(line: string): boolean {
  const t = headingCore(line);
  return t.length > 1 && t.length <= 100 && STRUCTURE_HEADING.some((re) => re.test(t));
}

function matchesHeading(line: string, headings: RegExp[]): boolean {
  const t = headingCore(line);
  return t.length > 1 && t.length <= 100 && headings.some((re) => re.test(t));
}

function inlineHeadingContent(line: string, headings: RegExp[]): string {
  const t = line.trim();
  const colon = t.indexOf(":");
  if (colon <= 0) return "";
  const heading = t.slice(0, colon).trim();
  const value = t.slice(colon + 1).trim();
  if (!value || !matchesHeading(heading, headings)) return "";
  return value;
}

function isTailoringHeading(line: string): boolean {
  const t = line.trim();
  return t.length <= 90 && TAILORING_SECTION.some((re) => re.test(t));
}

function isNonTailoringHeading(line: string): boolean {
  const t = line.trim();
  if (t.length > 90 || !NON_TAILORING_SECTION.some((re) => re.test(t))) return false;
  // An inline "Label: value" (e.g. "Salary: $80,000–$110,000/yr", "Compensation:
  // competitive") is a metadata line, not a section START. Treating it as a section
  // opener made removeNonTailoringSections skip the entire job body that followed.
  // Only a BARE comp/benefits heading (no trailing value) opens skip-mode.
  const colon = t.indexOf(":");
  if (colon > 0 && t.slice(colon + 1).trim().length > 0) return false;
  return true;
}

function isLowValueLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^[-–—•·‣◦▪●○*\s]+$/.test(t)) return true;
  if (isPromptMetadataLine(t)) return true;
  return false;
}

function isPromptMetadataLine(line: string): boolean {
  const t = line.trim();
  return (
    /^(company|role|title|job title|position|posting start date|requisition id|job id|job number|location|job location|work location|cities|employment type|job type|seniority level|experience level|job function|industries)\s*[:|]/i.test(
      t
    ) ||
    // ATS id lines that the title fallback would otherwise grab ("Position ID:
    // J0526-2196", "Req #363", "Requisition No. 42").
    /^(position id|req(?:uisition)?\.?\s*(?:id|#|no\.?|number)?)\b/i.test(t)
  );
}

// Fix #8: guard against JS/template code becoming content
function isLikelyProse(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  // Quick prose check: reject lines where code-ish chars are dense. "$" is
  // deliberately excluded — comp lines like "Salary: $90k-$110k" are real
  // content; the JS-pattern test below still catches "$(...)" jQuery calls.
  const codeChars = (t.match(/[{}();=<>|]/g) ?? []).length;
  if (codeChars / t.length > 0.08) return false;
  // Reject JS-pattern lines
  if (/function\s*\(|=>|==|\bvar\s|\$\(/.test(t)) return false;
  return true;
}

function cleanSummaryLine(line: string): string {
  return line
    .replace(/^[\s•·‣◦▪●○*\-–—]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();
}

function clipSentence(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  const clipped = compact.slice(0, maxChars - 1);
  const lastStop = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf(";"), clipped.lastIndexOf(","));
  return `${(lastStop > maxChars * 0.55 ? clipped.slice(0, lastStop) : clipped).trim()}...`;
}

// Fix #10: strip compensation language only when salary/pay/benefit terms present
function stripCompensationLanguage(text: string): string {
  const chunks = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|;\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .filter(
      (chunk) =>
        !/\b(compensation|salary|base pay|pay range|benefits?|total rewards)\b/i.test(chunk)
    );
  return chunks.join(" ").trim();
}

// Fix #3: split run-on paragraph bullets on label boundaries before clipping
function splitRunOnBullets(line: string): string[] {
  if (line.length <= 250) return [line];
  // Split on "Label: text" boundaries (capital-letter word followed by colon)
  // Only split when the pattern appears mid-line (not at the very start)
  const parts = line.split(/(?=\b[A-Z][A-Za-z &/]{2,30}: )/);
  if (parts.length < 2) return [line];
  // Keep only chunks with >=20 chars of real content
  const valid = parts.map((p) => p.trim()).filter((p) => p.length >= 20);
  if (valid.length < 2) return [line];
  return valid;
}

function uniqueItems(items: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawItem of items) {
    // Fix #3: expand run-on bullets before clipping
    const expanded = splitRunOnBullets(rawItem);
    for (const item of expanded) {
      const cleaned = cleanSummaryLine(item)
        .replace(/^(required|preferred) qualifications?\s*:?\s*/i, "")
        // Strip an echoed section label ONLY when it reads as a label, not as the
        // first word of a sentence: either a colon follows it, or the remainder
        // starts uppercase (a new heading-like clause). The uppercase check is
        // case-SENSITIVE (no /i), so a real bullet like "Skills to address
        // straightforward problems" (lowercase remainder) keeps its leading word.
        .replace(
          /^(responsibilit(?:y|ies)|requirements?|skills)\s*(:)?\s*(.*)$/i,
          (m, _label, colon, rest) =>
            colon ? rest : /^[A-Z]/.test(rest) ? rest : m
        )
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned.length < 8) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(clipSentence(cleaned, 220));
      if (result.length >= maxItems) break;
    }
    if (result.length >= maxItems) break;
  }
  return result;
}

// Fix #4: isPreferredItem checks only the FIRST sentence of the item.
// An item is demoted to preferred only when the preferred cue appears in its
// first sentence (up to first period/semicolon). If the item has no sentence
// punctuation within 200 chars, treat the whole item as one sentence.
// This keeps multi-sentence items like "Programming Skills: ... in a full-stack
// role. Familiarity with Go Lang... is a plus." required (cue is in sentence 2),
// while correctly demoting single-sentence items that end with "is a plus".
function isPreferredItemStrict(item: string): boolean {
  const firstSentenceEnd = item.search(/[.;]/);
  // Use the full first sentence; no arbitrary char limit
  const checkWindow = firstSentenceEnd > 0
    ? item.slice(0, firstSentenceEnd + 1)
    : item;
  return /\b(preferred|nice[- ]to[- ]have|bonus|plus)\b/i.test(checkWindow);
}

function isListLikeContent(line: string): boolean {
  const t = cleanSummaryLine(line);
  if (t.length < 8) return false;
  if (isPromptMetadataLine(t) || isStructureHeading(t) || isEmptyMarker(t)) return false;
  // Bare "Label:" lines produced by Workday reflow or other ATS sources are not content
  if (isMetadataLabel(t)) return false;
  // Fix(JD-test): narrowed bare "privacy" → privacy-policy furniture only. Bare
  // "privacy" dropped real duties that merely mention it (Docusign: "Partner
  // with security, privacy, and compliance teams …"); the actual policy/notice
  // furniture is still caught here and by TRAILING_BOILERPLATE/NON_TAILORING.
  if (/salary|compensation|benefits|equal (?:opportunity|employment) (?:opportunity )?employer|equal employment opportunit|privacy (?:policy|notice|statement)|cookies?|apply now/i.test(t)) return false;
  return true;
}

// Some ATSes pack a whole section into one inline line ("Duties: Design X.
// Implement Y. Maintain Z.") instead of bullets. Split a long multi-sentence
// inline value into separate items so each duty/qual is captured; keep short or
// single-sentence values whole.
function splitProseItems(value: string): string[] {
  const v = value.trim();
  if (v.length <= 140) return [v];
  const parts = v
    .split(/(?<=[.;])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
  return parts.length >= 2 ? parts : [v];
}

function collectUnderHeadings(lines: string[], headings: RegExp[], maxItems: number): string[] {
  const collected: string[] = [];
  let active = false;

  for (const line of lines) {
    const t = cleanSummaryLine(line);
    if (!t) continue;
    const inlineContent = inlineHeadingContent(t, headings);
    if (inlineContent) {
      active = true;
      for (const piece of splitProseItems(inlineContent)) {
        if (isListLikeContent(piece)) collected.push(piece);
      }
      if (collected.length >= maxItems * 2) break;
      continue;
    }
    if (matchesHeading(t, headings)) {
      active = true;
      continue;
    }
    if (active && isStructureHeading(t)) {
      active = false;
      continue;
    }
    if (!active || !isListLikeContent(t)) continue;
    collected.push(t);
    if (collected.length >= maxItems * 2) break;
  }

  return uniqueItems(collected, maxItems);
}

function fallbackItems(lines: string[], patterns: RegExp[], maxItems: number): string[] {
  return uniqueItems(
    lines.filter((line) => {
      const t = cleanSummaryLine(line);
      // Fix #9: exclude structure headings from fallback collection
      if (isStructureHeading(t)) return false;
      return isListLikeContent(t) && patterns.some((re) => re.test(t));
    }),
    maxItems
  );
}

function bulletLines(items: string[], emptyText: string): string[] {
  return (items.length ? items : [emptyText]).map((item) => `- ${item}`);
}

// Fix #12: Workday merged label/value lines — split trailing label off
// Only applies to a fixed safe set of known Workday field names appearing at
// line end after other text.
const WORKDAY_TRAILING_LABELS =
  /\b(Experience|Certifications?|US Citizenship Required|Education|Travel Required|Clearance Level[^:]{0,30})\s*:\s*$/i;

function splitWorkdayTrailingLabel(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    const match = line.match(WORKDAY_TRAILING_LABELS);
    // Only split when there is content BEFORE the trailing label
    if (match && match.index !== undefined && match.index > 0) {
      const before = line.slice(0, match.index).trim();
      const label = match[0].trim();
      if (before) {
        result.push(before);
        result.push(label);
        continue;
      }
    }
    result.push(line);
  }
  return result;
}

function removeLowValueMetadata(lines: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!LOW_VALUE_METADATA_LABEL.some((re) => re.test(t))) {
      result.push(lines[i]);
      continue;
    }

    const valueIndex = nextTextIndex(lines, i + 1);
    if (valueIndex === -1) continue;
    i = isMetadataLabel(lines[valueIndex]) ? valueIndex - 1 : valueIndex;
  }
  return result;
}

function removeDuplicateClearanceMetadata(lines: string[]): string[] {
  const currentLabelIndex = lines.findIndex((line) =>
    /^clearance level must currently possess\s*:?\s*$/i.test(line.trim())
  );
  const ableLabelIndex = lines.findIndex((line) =>
    /^clearance level must be able to obtain\s*:?\s*$/i.test(line.trim())
  );
  if (currentLabelIndex === -1 || ableLabelIndex === -1) return lines;

  const currentValueIndex = nextTextIndex(lines, currentLabelIndex + 1);
  const ableValueIndex = nextTextIndex(lines, ableLabelIndex + 1);
  if (currentValueIndex === -1 || ableValueIndex === -1) return lines;

  const currentValue = lines[currentValueIndex].trim().toLowerCase();
  const ableValue = lines[ableValueIndex].trim().toLowerCase();
  if (!currentValue || currentValue !== ableValue) return lines;

  return lines.filter((_, index) => index !== ableLabelIndex && index !== ableValueIndex);
}

function removePreDescriptionMarketing(lines: string[]): string[] {
  const firstDescription = lines.findIndex((line) => /^job description\s*:?\s*$/i.test(line.trim()));
  if (firstDescription === -1) return lines;

  const secondDescription = lines.findIndex(
    (line, index) => index > firstDescription && /^job description\s*:?\s*$/i.test(line.trim())
  );
  if (secondDescription === -1 || secondDescription - firstDescription > 12) return lines;

  const segment = lines.slice(firstDescription, secondDescription).join("\n");
  const looksLikeMarketing =
    /^our company$/im.test(segment) ||
    (/^your impact$/im.test(segment) && /own your opportunity to/i.test(segment));
  if (!looksLikeMarketing) return lines;

  return [...lines.slice(0, firstDescription), ...lines.slice(secondDescription)];
}

function removeWorkdayFurniture(lines: string[]): string[] {
  // Fix #12: split trailing labels before other Workday cleanup
  const reflowed = splitWorkdayTrailingLabel(lines);
  return removePreDescriptionMarketing(removeDuplicateClearanceMetadata(removeLowValueMetadata(reflowed)));
}

function removeNonTailoringSections(lines: string[]): string[] {
  const result: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (!skipping) result.push(line);
      continue;
    }

    if (isNonTailoringHeading(t)) {
      skipping = true;
      continue;
    }

    if (skipping && (isTailoringHeading(t) || matchesHeading(t, CONTENT_REENTRY_HEADING))) {
      skipping = false;
      result.push(line);
      continue;
    }

    if (!skipping) result.push(line);
  }

  return result;
}

function compactDuplicateLines(lines: string[]): string[] {
  const deduped: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t && t === deduped[deduped.length - 1]?.trim()) continue;
    deduped.push(line);
  }
  return deduped;
}

function cutTrailingBoilerplate(lines: string[]): string[] {
  let cut = lines.length;
  let contentSeen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    // Test against content seen on PRIOR lines, so the very first line can never
    // be treated as trailing boilerplate (which would cut everything to "").
    if (t && contentSeen > 400 && TRAILING_BOILERPLATE.some((re) => re.test(t))) {
      cut = i;
      break;
    }
    if (t) contentSeen += t.length;
  }
  return lines.slice(0, cut);
}

function valueForLabel(lines: string[], labels: string[]): string {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sameLine = line.match(new RegExp(`^${escaped}\\s*(?:[:|]|-)\\s*(.+)$`, "i"));
      if (sameLine?.[1]?.trim()) return sameLine[1].trim();

      if (new RegExp(`^${escaped}\\s*:?$`, "i").test(line)) {
        const next = nextTextIndex(lines, i + 1);
        if (next !== -1) return lines[next].trim();
      }
    }
  }
  return "";
}

function parseLinkedInTitleLine(lines: string[]) {
  const titleLine = lines.find((line) => /\bhiring\b/i.test(line) && /\|\s*linkedin\b/i.test(line));
  const match = titleLine?.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+(.+?)\s*\|\s*linkedin\b/i);
  if (!match) return {};
  return {
    company: match[1].trim(),
    title: match[2].trim(),
    location: match[3].trim()
  };
}

function sourceFromUrl(rawUrl?: string): string {
  if (!rawUrl) return "";
  try {
    const host = new URL(rawUrl).hostname;
    return SOURCE_BY_HOST.find(([re]) => re.test(host))?.[1] ?? "";
  } catch {
    return "";
  }
}

function normalizeJobType(value: string): string {
  const t = value.trim();
  if (!t) return "";
  if (/full[-\s]?time/i.test(t)) return "Full-time";
  if (/part[-\s]?time/i.test(t)) return "Part-time";
  if (/contract/i.test(t)) return "Contract";
  if (/intern(ship)?/i.test(t)) return "Internship";
  if (/temporary|temp/i.test(t)) return "Temporary";
  return t.slice(0, 60);
}

function parseAmount(value: string): number {
  const raw = value.trim();
  const hasK = /k$/i.test(raw.replace(/\s+/g, ""));
  // Strip non-numerics, then collapse a trailing dot and any extra dots so a
  // sentence-final amount ("$111,000.00.") doesn't become "111000.00." → NaN → 0.
  const digits = raw
    .replace(/[^0-9.]/g, "")
    .replace(/\.+$/, "")
    .replace(/\.(?=.*\.)/g, "");
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(hasK ? parsed * 1000 : parsed);
}

function normalizePeriod(value: string): ExtractedSalaryPeriod | undefined {
  if (/^(hour|hr)$/i.test(value)) return "hr";
  if (/^(month|mo)$/i.test(value)) return "mo";
  if (/^(year|yr|annum|annual|annually)$/i.test(value)) return "yr";
  return undefined;
}

// Fix(JD-test): map a detected currency symbol to an ISO-ish code so a non-USD
// posting ("£55,000 - £75,000") is not silently reported as USD (anti-fab). An
// empty symbol (compensation known only from a "Pay:" label) defaults to USD.
function currencyFromSymbol(sym: string): string {
  if (/^(USD|US\$)$/i.test(sym)) return "USD";
  if (/^GBP$/i.test(sym)) return "GBP";
  if (/£/.test(sym)) return "GBP";
  if (/^EUR$/i.test(sym)) return "EUR";
  if (/€/.test(sym)) return "EUR";
  if (/^JPY$/i.test(sym)) return "JPY";
  if (/¥/.test(sym)) return "JPY";
  if (/^(CAD|CA\$|C\$)$/i.test(sym)) return "CAD";
  if (/^(AUD|A\$)$/i.test(sym)) return "AUD";
  return "USD";
}

function extractSalary(lines: string[]): Pick<
  ExtractedJobTracking,
  "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod"
> {
  const candidates: Array<{
    min: number;
    max: number | null;
    period?: ExtractedSalaryPeriod;
    currency: string;
    isUpTo: boolean;
    score: number;
  }> = [];
  // Currency tokens recognized adjacent to an amount. Multi-char tokens precede
  // bare "$" so "US$"/"CA$" aren't truncated to "$"; group 1 captures the symbol
  // (and the alternation also lets a non-$ symbol sit between min and max so the
  // range "£55,000 - £75,000" no longer collapses to a single number).
  const CUR = String.raw`USD|US\$|CAD|CA\$|C\$|AUD|A\$|GBP|EUR|JPY|£|€|¥|\$`;
  // Code-review fix: the leading currency token must NOT be glued to a preceding
  // letter — without the lookbehind, "ABC$5,000" captures "C$" (→ CAD) and "EUR"
  // matches inside a word, fabricating a foreign currency on a US amount. Group 1
  // still captures the symbol; group indices are unchanged.
  // A pay-period token. The trailing \b is load-bearing: without it "hour" matches
  // inside "hours" ("20 hours or more per week"), captures a period, and fabricates
  // a $20/hr salary. With \b, only genuine pay-period forms ("/hr", "per hour",
  // "annually", "/year") match; a plural count noun ("hours"/"years") does not, so
  // the looksLikeCount guard below can reject it.
  const PERIOD = String.raw`(?:\s*(?:\/|per)?\s*(year|yr|annum|annual|annually|hour|hr|month|mo)\b)`;
  // groups: 1=currency symbol, 2=min, 3=period-after-min, 4=max, 5=period-after-max.
  // A period token is allowed BEFORE the range connector so "$71,100/yr - $127,000/yr"
  // parses as ONE range instead of two lone candidates (which made the sort report
  // the ceiling as the floor). The connector also accepts "and" ("$71,100 and $127,000").
  // Number groups END IN A DIGIT (`\d(?:[\d,.]*\d)?`) so a sentence-final amount
  // ("$111,000.00.") captures "111,000.00" and not the trailing period.
  const NUM = String.raw`\d(?:[\d,.]*\d)?(?:\s?[kK])?`;
  const money = new RegExp(
    String.raw`(?:(?<![A-Za-z])(${CUR}))?\s*(${NUM})${PERIOD}?(?:\s*(?:-|–|—|to|and)\s*(?:${CUR})?\s*(${NUM}))?${PERIOD}?`,
    "gi"
  );

  // A comp keyword counts only when it's on the SAME line as the amount, or on a
  // BARE label line directly above it ("Pay"\n"111000-185000"). A keyword buried
  // in an adjacent prose sentence does NOT: the old 3-line join bled "200 hours"
  // from a benefits paragraph into the next paragraph's "base pay" sentence and
  // reported $200/hr. Matching per-line (not a join) closes that leak in both
  // directions while still reading the label→value pattern.
  const COMP_LABEL =
    /^(pay|salary|compensation|base (pay|salary)|pay range|salary range|target (pay|salary)|annual (pay|salary)|total (rewards|compensation))(?:\s+range)?\s*:?\s*$/i;
  const SAME_LINE_COMP = /salary|compensation|base pay|pay range|total rewards/i;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    let prev = "";
    for (let j = i - 1; j >= 0; j -= 1) {
      if (lines[j]?.trim()) {
        prev = lines[j].trim();
        break;
      }
    }
    const compContext = SAME_LINE_COMP.test(line) || COMP_LABEL.test(prev);
    for (const match of line.matchAll(money)) {
      const sym = match[1] ?? "";
      let min = parseAmount(match[2] ?? "");
      let max = match[4] ? parseAmount(match[4]) : null;
      const period = normalizePeriod(match[5] || match[3] || "");
      if (!min) continue;

      // Shared-k range: "120-150k" / "$90-120k" — the trailing k applies to BOTH
      // numbers, but parseAmount scales per-token, so min comes back unscaled
      // (120 → $120/yr nonsense). Propagate the k when only the max carries it.
      const minHasK = /[kK]\s*$/.test((match[2] ?? "").trim());
      const maxHasK = /[kK]\s*$/.test((match[4] ?? "").trim());
      if (max !== null && maxHasK && !minHasK && min < 1000 && max >= 1000) {
        min *= 1000;
      }

      const currency = Boolean(sym);
      const range = max !== null && max !== min;
      const hasPeriod = Boolean(period);
      // "up to $X" / "as much as $X": the lone figure is the ceiling, not floor.
      const lead = line.slice(Math.max(0, (match.index ?? 0) - 14), match.index ?? 0);
      const isUpTo = max === null && /\b(?:up to|as much as)\s*$/i.test(lead);
      // A bare year ("Founded in 2015, salaries are competitive") or a counted
      // quantity ("10,000 employees", "180 countries") on a comp-context line has
      // no pay shape — skip it so compContext below can't promote it to a salary.
      const after = line.slice((match.index ?? 0) + match[0].length).trimStart();
      const looksLikeCount =
        /^(?:employees?|customers?|users?|people|persons?|clients?|companies|countries|members?|applicants?|candidates?|openings?|years?|months?|days?|hours?)\b/i.test(after);
      if (!currency && !range && !hasPeriod && ((min >= 1900 && min <= 2099) || looksLikeCount)) continue;
      // Retirement-plan figures are never salary: "a 401k plan", "401(k) match",
      // "403b". A benefits paragraph that elsewhere says "compensation" would
      // otherwise set compContext and report "401k" as a $401,000 salary.
      const numCore = (match[2] ?? "").replace(/\s/g, "");
      const isRetirementPlan =
        /^(401\(?k\)?|403\(?b\)?|457\(?b\)?)$/i.test(numCore) ||
        (/^(401|403|457)$/.test(numCore) && /^\(?[kb]\)?\b/i.test(after));
      if (isRetirementPlan) continue;

      // Anti-fabrication gate. Outside an explicit comp context, a number is only
      // compensation when it has the SHAPE of pay: a currency token AND either a
      // range or an explicit period. This rejects lone perk figures with a "$"
      // ("$6,000 adoption assistance", "$2,500 training budget") and bare counts
      // ("10,000 employees") that the currency-OR-comp gate used to let through.
      if (!compContext) {
        if (!currency) continue;
        if (!range && !hasPeriod) continue;
      }

      const highValue = min >= 1000 || (max ?? 0) >= 1000;
      const hourly = period === "hr" && min >= 8 && min <= 500;
      if (!highValue && !hourly) continue;

      let score = 0;
      if (compContext) score += 5;
      if (range) score += 4;
      if (period) score += 2;
      if (highValue || hourly) score += 1;
      candidates.push({ min, max, period, currency: currencyFromSymbol(sym), isUpTo, score });
    }
  }

  const best = candidates.sort((a, b) => b.score - a.score || (b.max ?? b.min) - (a.max ?? a.min))[0];
  if (!best) return {};

  // "up to $X": report the figure as the ceiling, leaving the floor open.
  if (best.isUpTo) {
    return {
      salaryMin: null,
      salaryMax: best.min,
      salaryCurrency: best.currency,
      salaryPeriod: best.period ?? (best.min >= 1000 ? "yr" : undefined)
    };
  }
  const min = best.max !== null && best.max < best.min ? best.max : best.min;
  const max = best.max !== null && best.max < best.min ? best.min : best.max;
  return {
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: best.currency,
    salaryPeriod: best.period ?? (min >= 1000 ? "yr" : undefined)
  };
}

// EEO / application-form boilerplate to skip in workAuth extraction
const WORK_AUTH_SKIP: RegExp[] = [
  /equal opportunity|without regard|protected veteran/i,
  /select\.{3}|select\.\.\./i  // form dropdown widgets
];

// Bare metadata label lines (just a label ending with colon, no value):
// not suitable as a workAuth answer.
function isBareLabelLine(line: string): boolean {
  const t = line.trim();
  // Matches "Label:" or "Label: " with nothing of substance after the colon
  return /^[A-Za-z][A-Za-z0-9 /&''().-]+:\s*$/.test(t);
}

// Prefer lines that clearly state a MUST/REQUIRED stance
const WORK_AUTH_STRONG: RegExp = /\b(must|required?|only|unable|cannot)\b/i;

// Fix #6: extended workAuth extraction with sponsor/visa/citizen/clearance variants,
// EEO boilerplate filtering, and preference for "must/required" lines.
// When a matching line is an EEO paragraph that also contains a real auth sentence,
// split it into sentences and extract the relevant sentence.
function extractWorkAuth(lines: string[]): string {
  // "visas?" alone matched the company name token "Visa" → fabricated a work-auth
  // requirement. Require a work-context word after "visa" (or sponsorship nearby)
  // so the employer "Visa" can't masquerade as a visa requirement.
  const AUTH_PATTERN =
    /\b(sponsor(?:ship)?|visa\s+(?:sponsor\w*|status|holder|requirement|petition|eligib\w*|is\s+(?:required|needed|necessary)|are\s+required)|(?:require|need|hold|obtain|have|possess)\w*\s+(?:\w[\w-]*\s+){0,3}visa|citizens?(?:hip)?|work authorization|authorized to work|employment authorization|(?:security )?clearance)\b/i;

  // Collect candidate lines or individual sentences from lines
  const candidates: string[] = [];

  for (const entry of lines) {
    if (!AUTH_PATTERN.test(entry)) continue;
    if (isBareLabelLine(entry)) continue;

    if (WORK_AUTH_SKIP.some((re) => re.test(entry))) {
      // The line itself has EEO boilerplate — but it may contain a real auth
      // sentence embedded. Split and check individual sentences.
      const sentences = entry
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 20);
      for (const sentence of sentences) {
        if (
          AUTH_PATTERN.test(sentence) &&
          !WORK_AUTH_SKIP.some((re) => re.test(sentence))
        ) {
          candidates.push(sentence);
        }
      }
    } else {
      candidates.push(entry);
    }
  }

  if (!candidates.length) return "";

  // Prefer lines with a strong mandatory signal
  const strong = candidates.find((c) => WORK_AUTH_STRONG.test(c));
  const chosen = strong ?? candidates[0];
  return clipSentence(cleanSummaryLine(chosen), 220);
}

function extractReviewMetadata(lines: string[]) {
  return {
    seniority: valueForLabel(lines, ["Seniority level", "Experience level"]),
    // Fix #5e: added "Working Schedule" to jobType label list
    employmentType: valueForLabel(lines, ["Employment type", "Job type", "Working Schedule"]),
    jobFunction: valueForLabel(lines, ["Job function"]),
    industries: valueForLabel(lines, ["Industries"])
  };
}

// --- Fix #20: prose-based company/role extraction --------------------------
// Page chrome (title tag, URL, breadcrumb headings) is an unreliable source for
// the employer and role: many ATS render a generic page title or bury the name
// in nav. The posting *body* is more dependable — the company names itself in a
// "Who we are"/"About us" opener, a stock-ticker parenthesis, or an "At X, we…"
// sentence; the role appears in a "looking for a <Role>" line. These helpers
// read those signals, each gated so a generic phrase can never pass as a name.

// First word of a company candidate that is a real name, not a sentence opener.
const COMPANY_STOPWORDS = new Set([
  "we", "our", "the", "this", "that", "you", "your", "us", "about", "who", "what",
  "join", "welcome", "team", "company", "role", "position", "job", "here", "as",
  "at", "in", "for", "a", "an", "it", "they", "work", "working", "apply", "please",
  "note", "summary", "overview", "description", "responsibilities", "requirements",
  "qualifications", "benefits", "compensation", "salary", "location", "remote",
  "hybrid", "onsite", "their", "his", "her", "its", "these", "those", "founded",
  // Careers-site nav phrases that the "Join <Company>" / "About <Company>" cues
  // would otherwise capture ("Join Our Talent Community", "Talent Network").
  "talent", "community", "network", "opportunities", "alerts", "login",
  "dashboard", "settings", "notifications", "careers", "career"
]);

// Role-name nouns: a prose role candidate's HEAD word must be one of these so
// candidate-facing copy ("looking for a new challenge") and vague phrases
// ("Operations Partner Across Regions") can't be mistaken for a job title.
// Deliberately excludes ambiguous bare words (lead/head/partner/operations/
// sales/support) that read as common nouns more often than as a title head.
const ROLE_NOUN =
  /\b(engineer(?:ing)?|developer|programmer|manager|designer|analyst|scientist|architect|administrator|specialist|consultant|director|officer|coordinator|associate|intern|representative|recruiter|strategist|marketer|writer|researcher|technician|devops|sre|product manager|accountant|controller|counsel|attorney|nurse|teacher|advisor|agent|generalist)\b/i;

// AGENT role nouns only (no "-ing" category form). Used by the careers-page
// top-down title scan so a nav PROFESSION category ("Engineering", "Sales
// Engineering", "Marketing") — which ROLE_NOUN's "engineer(?:ing)?" would accept —
// can't be mistaken for a role title, while "Software Engineer" still matches.
const TITLE_ROLE_NOUN =
  /\b(engineer|developer|programmer|manager|designer|analyst|scientist|architect|administrator|specialist|consultant|director|officer|coordinator|associate|intern|representative|recruiter|strategist|writer|researcher|technician|devops|sre|accountant|controller|counsel|attorney|nurse|teacher|advisor|generalist)\b/i;

// Fix(JD-test): strip a leading RUN of recruiter fluff, including chained forms
// joined by "and"/"&" and an optional "highly[- ]" intensifier, so the prose
// role "passionate and highly motivated Software Engineer" reduces to
// "Software Engineer" — not the junk fragment "and highly motivated Software
// Engineer" that survived the single-token strip.
const ROLE_FLUFF =
  /^(?:(?:and|&)\s+)?(?:(?:highly[- ])?(?:experienced|talented|passionate|motivated|skilled|seasoned|exceptional|dynamic|enthusiastic|results[- ]driven|hands[- ]on|world[- ]class|rockstar|ninja|self[- ]starter|curious|driven|dedicated|detail[- ]oriented|creative|innovative|ambitious|collaborative|proactive|versatile|well[- ]rounded)\s+(?:and\s+|&\s+)?)+/i;

function cleanCompanyName(name: string): string {
  return name
    .replace(/^[\s,;:.()-]+/, "")
    .replace(/[\s,;:.()-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlausibleCompany(name: string): boolean {
  const t = cleanCompanyName(name);
  if (t.length < 2 || t.length > 60) return false;
  // Allow a leading uppercase/digit OR a lowercase-initial camelCase brand
  // ("iHeartMedia", "uShip", "eBay") — but not an all-lowercase word.
  if (!/^[A-Z0-9]/.test(t) && !/^[a-z][a-z]*[A-Z]/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 6) return false;
  // Reject when every word is a generic sentence/stopword (e.g. "Our Team").
  if (words.every((w) => COMPANY_STOPWORDS.has(w.replace(/[^a-z0-9]/gi, "").toLowerCase()))) return false;
  // A role title is not a company.
  if (ROLE_NOUN.test(t)) return false;
  return true;
}

function isPlausibleRole(role: string): boolean {
  const t = role.trim();
  if (t.length < 3 || t.length > 60) return false;
  const words = t.split(/\s+/);
  if (words.length > 6) return false;
  // A role names a person, not a collective — reject org/unit tails.
  if (/\b(team|group|org|organi[sz]ation|department|division|function|unit)$/i.test(t)) return false;
  // The role noun must be the HEAD (last one or two words), so "Operations
  // Partner Across Regions" (tail "Across Regions") is rejected while
  // "Senior Backend Engineer" (tail "Backend Engineer") passes.
  return ROLE_NOUN.test(words.slice(-2).join(" "));
}

// A "Role:" or "Title:" label sometimes heads a prose paragraph (a "Role:"
// section describing the job) rather than naming the position. A real job title
// is a short noun phrase, never a sentence/paragraph — gate the labelled value so
// "As a Software Engineer at X, you will be pivotal in designing… our customers."
// is rejected (and a cleaner path can recover the actual title).
function looksLikeJobTitle(value: string): boolean {
  const t = value.trim();
  if (t.length < 2 || t.length > 90) return false;
  // Sentence punctuation as a break ("…X. You…") or a trailing stop signals prose,
  // not a title. A mid-token dot ("Node.js Developer") is fine — require a space
  // after the stop, or end-of-string.
  if (/[.!?]\s/.test(t) || /[.!?]$/.test(t)) return false;
  return true;
}

// Lower-case prose roles get title-cased; a role that already carries caps
// (e.g. "iOS Engineer") is trusted as written.
function titleCaseRole(role: string): string {
  if (/[A-Z]/.test(role)) return role;
  return role.replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

const COMPANY_NAME = "([A-Z][A-Za-z0-9&.'-]*(?:\\s+[A-Z][A-Za-z0-9&.'-]*){0,5}?)";

// Grammatically self-naming openers — safe ANYWHERE in the body because the
// sentence structure makes the employer its own subject. A partner/competitor
// named in the duties section does not match these forms.
function companyFromSelfCue(sentence: string): string {
  const s = sentence.trim();
  const patterns: RegExp[] = [
    // "At <Company>, we/our/you …"
    new RegExp(`^At\\s+${COMPANY_NAME}\\s*,\\s+(?:we|our|you|the team|employees|everyone)\\b`),
    // "We are <Company>, a …" (not "We are looking/seeking/hiring …")
    new RegExp(`^We are\\s+${COMPANY_NAME}\\s*,`),
    // "Join our American Airlines family…" — employer-brand intro copy.
    new RegExp(`\\bJoin\\s+our\\s+${COMPANY_NAME}\\s+(?:family|team)\\b`),
    // "Join <Company>!" / "Welcome to <Company>." (employer CTA). Fix(JD-test):
    // require a CTA terminator (punctuation, "today"/"now", or end of sentence)
    // so a role-overview line — "Join Enterprise Intelligence as an Associate
    // Full Stack Engineer supporting…" — no longer captures the team name as the
    // employer; the later "At <Company>, we…" self-cue then correctly wins.
    new RegExp(`^(?:Join|Welcome to)\\s+${COMPANY_NAME}(?:\\s*[!.,]|\\s+(?:today|now)\\b|\\s*$)`)
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const name = cleanCompanyName(m[1]);
      if (isPlausibleCompany(name)) return name;
    }
  }
  return "";
}

// "<Company> is/was/has been a/the …" — descriptive, NOT self-cued, so a tool or
// customer ("Slack is the tool we use") could match. Only trusted inside a
// self-description zone (see extractCompanyFromProse), where the subject is the
// employer by construction.
function companyFromIsClause(sentence: string): string {
  const re = new RegExp(
    `^${COMPANY_NAME}\\s+(?:is|was|has been)\\s+(?:a|an|the|one of|now|currently|looking|seeking|hiring|building|on a mission|proud|growing|redefining|reinventing|transforming|headquartered|a leading|a global|the world)\\b`
  );
  const m = sentence.trim().match(re);
  if (m) {
    const name = cleanCompanyName(m[1]);
    if (isPlausibleCompany(name)) return name;
  }
  return "";
}

// Stock-ticker company: the legal name precedes the exchange parenthesis, e.g.
// "PAR Technology Corporation (NYSE: PAR)". Reliable only within a
// self-description zone — the body may cite other public companies.
function tickerCompany(sentence: string): string {
  const m = sentence.match(
    /([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,5})\s*\(\s*(?:NYSE|NASDAQ|Nasdaq|NYSE American|AMEX|LSE|TSX|TSXV|ASX|Euronext|FTSE|ticker|symbol)\s*[:\s]/
  );
  if (m) {
    const name = cleanCompanyName(m[1]);
    if (isPlausibleCompany(name)) return name;
  }
  return "";
}

// Where the employer describes itself: the opening intro (everything before the
// first responsibilities/requirements heading, capped) plus any "About us" /
// "Who we are" section. Confining the weak ticker / "X is a…" signals here
// prevents capturing a partner, competitor, client, or tool named in the duties.
function introZoneEnd(lines: string[]): number {
  let nonEmpty = 0;
  // End the intro at the first *job-content* heading only. Marketing/values/
  // about headings are themselves self-description, so they don't close the zone.
  const jobHeadings = [...RESPONSIBILITY_HEADING, ...REQUIRED_HEADING, ...PREFERRED_HEADING];
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!t) continue;
    if (matchesHeading(t, jobHeadings)) return i;
    // Hard raw-index ceiling so a furniture-heavy page can't extend the zone far
    // enough to trust a competitor/tool "X is a…" clause as the employer.
    if (i > 30) return i;
    // Don't count nav/CTA furniture toward the cap — a heavy careers-site nav
    // block would otherwise push the company self-cue ("<Co> is a…") out of zone.
    if (NOISE_LINE.some((re) => re.test(t)) || isBareFieldLabel(t)) continue;
    nonEmpty += 1;
    if (nonEmpty >= 12) return i + 1;
  }
  return lines.length;
}

function aboutZoneRange(lines: string[]): [number, number] | null {
  const idx = lines.findIndex((l) =>
    /^(who we are|who are we|about us|about the company|about our company|our company|company overview|our story)\b/i.test(
      l.trim()
    )
  );
  if (idx === -1) return null;
  let end = Math.min(idx + 7, lines.length);
  for (let j = idx + 1; j < end; j += 1) {
    if (lines[j].trim() && isStructureHeading(lines[j].trim())) {
      end = j;
      break;
    }
  }
  return [idx + 1, end];
}

function extractCompanyFromProse(lines: string[]): string {
  // (A) Self-cued openers are reliable anywhere — the grammar names the employer.
  for (const raw of lines) {
    const line = cleanSummaryLine(raw);
    if (!line || !isLikelyProse(line)) continue;
    const name = companyFromSelfCue(line);
    if (name) return name;
  }

  // (B) Weaker signals (ticker, "X is a…") only inside a self-description zone.
  const introEnd = introZoneEnd(lines);
  const about = aboutZoneRange(lines);
  const inZone = (i: number) => i < introEnd || (about !== null && i >= about[0] && i < about[1]);

  for (let i = 0; i < lines.length; i += 1) {
    if (!inZone(i)) continue;
    const line = cleanSummaryLine(lines[i]);
    if (!line || !isLikelyProse(line) || isStructureHeading(line)) continue;
    const ticker = tickerCompany(line);
    if (ticker) return ticker;
    const named = companyFromIsClause(line);
    if (named) return named;
  }
  return "";
}

function extractRoleFromProse(lines: string[]): string {
  for (const raw of lines) {
    const line = cleanSummaryLine(raw);
    if (!line) continue;
    const m = line.match(
      /\b(?:looking for|seeking|hiring|recruiting|searching for|in search of)\s+(?:a|an|our\s+(?:next|new)|your\s+next)\s+(.+?)(?=\s+(?:to|who|that|which|with|in|at|for|on|based|located|join|across|within|reporting|team)\b|[—–(.,;:]|$)/i
    );
    if (!m) continue;
    const role = cleanSummaryLine(m[1].replace(ROLE_FLUFF, ""))
      .replace(/[\s,;:.]+$/, "")
      .trim();
    if (isPlausibleRole(role)) return titleCaseRole(role);
  }
  return "";
}

// A real location value is a short place phrase, not a prose sentence. Rejects
// "This role is hybrid (3-4 days a week …)" and "Austin, TX 78701, remote or
// hybrid optional team environment" while keeping "Mountain View, CA" / "Remote".
function looksLikeLocationValue(v: string): boolean {
  const t = v.trim();
  if (!t || t.length > 80) return false; // allow multi-city ("SF, CA; NY, NY; Remote")
  if (/[.!?]/.test(t)) return false; // sentence punctuation → prose
  // Page furniture stacked under a "Job Location" label ("I'm interested" apply
  // button, nav like "Professions") is not a place.
  if (NOISE_LINE.some((re) => re.test(t))) return false;
  // Prose/job-copy words that never belong in a clean place value.
  if (/\b(role|position|you|your|we|our|team|week|optional|environment|responsib\w*|looking|days?|experience|candidates?|reporting)\b/i.test(t)) return false;
  return true;
}

function extractTracking(lines: string[], url?: string): ExtractedJobTracking {
  const linkedInTitle = parseLinkedInTitleLine(lines);
  // Fix #5e: added "Work Location" to location label list
  const labelledTitle = valueForLabel(lines, ["Role", "Title", "Job title", "Position"]);
  const title =
    (looksLikeJobTitle(labelledTitle) ? labelledTitle : "") ||
    linkedInTitle.title ||
    "";
  const company = valueForLabel(lines, ["Company", "Organization", "Employer"]) || linkedInTitle.company || "";
  // A "Location:" label sometimes heads a prose sentence ("Location: This role is
  // hybrid (3-4 days a week in our Mountain View office)") rather than a place.
  // Reject the prose form so the strict positional reader can recover a clean
  // "City, ST"; a genuine short place value is kept.
  const labelledLocation = valueForLabel(lines, ["Location", "Locations", "Job location", "Primary location", "Work Location"]);
  const location =
    (looksLikeLocationValue(labelledLocation) ? labelledLocation : "") ||
    linkedInTitle.location ||
    "";
  const employmentType = valueForLabel(lines, ["Employment type", "Job type", "Working Schedule"]);
  const roleDescription = buildRoleDescription(lines);

  // --- Tracking fallbacks (Fix #5) ---

  // Resolved title/company from primary paths
  let resolvedTitle = title;
  let resolvedCompany = company;
  let resolvedLocation = location;

  // Fix #5b: Workday "Title · Location" first-line pattern
  // First non-empty raw line containing " · " → split on first " · ".
  // Both halves must look like real values, not breadcrumbs/ratings — a wrong
  // guess here would invent a job fact, so reject anything chrome-shaped.
  if (!resolvedTitle || !resolvedLocation) {
    const looksLikeChrome = (value: string) =>
      NOISE_LINE.some((re) => re.test(value)) ||
      isPromptMetadataLine(value) ||
      /^(home|careers?|jobs?|search|menu|about|help)$/i.test(value) ||
      /\b(stars?|reviews?|ratings?)\b/i.test(value) ||
      !/^[A-Za-z]/.test(value);
    const firstNonEmpty = lines.find((l) => l.trim().length > 0);
    if (firstNonEmpty) {
      const dotIdx = firstNonEmpty.indexOf(" · ");
      if (dotIdx !== -1) {
        const titlePart = firstNonEmpty.slice(0, dotIdx).trim();
        const locPart = firstNonEmpty.slice(dotIdx + 3).trim();
        if (
          titlePart.length >= 2 &&
          titlePart.length <= 120 &&
          locPart.length >= 1 &&
          locPart.length <= 80 &&
          !titlePart.includes(": ") &&
          !locPart.includes(": ") &&
          !looksLikeChrome(titlePart) &&
          !looksLikeChrome(locPart)
        ) {
          if (!resolvedTitle) resolvedTitle = titlePart;
          if (!resolvedLocation) resolvedLocation = locPart;
        }
      }
    }
  }

  // Fix #5a: Greenhouse "Job Application for <Title> at <Company>" line
  // NOISE_LINE removes this from tailoring lines but extractTracking sees rawLines
  if (!resolvedTitle || !resolvedCompany) {
    for (const line of lines) {
      const m = line.match(/job application for (.+?) at (.+)/i);
      if (m) {
        if (!resolvedTitle) resolvedTitle = m[1].trim();
        if (!resolvedCompany) resolvedCompany = m[2].trim();
        break;
      }
    }
  }

  // Fix(JD-corpus): LinkedIn names the employer verbatim in a stable phrase —
  // "(Join to) apply for the <Title> role at <Company>" — and in "<Company>
  // provided pay range". Parse these before the weaker prose heuristics. The
  // company is gated through isPlausibleCompany; the title corroborates only.
  if (!resolvedCompany || !resolvedTitle) {
    for (const line of lines) {
      const m = line
        .trim()
        .match(/^(?:join to )?apply for (?:the\s+)?(.+?)\s+role\s+at\s+(.+?)\s*$/i);
      if (m) {
        const co = cleanCompanyName(m[2]);
        if (!resolvedCompany && isPlausibleCompany(co)) resolvedCompany = co;
        if (!resolvedTitle && looksLikeJobTitle(m[1].trim()) && isPlausibleRole(m[1].trim())) {
          resolvedTitle = m[1].trim();
        }
        if (resolvedCompany) break;
      }
    }
  }
  if (!resolvedCompany) {
    for (const line of lines) {
      const m = line.trim().match(/^(.+?)\s+provided pay range\b/i);
      const co = m ? cleanCompanyName(m[1]) : "";
      if (co && isPlausibleCompany(co)) {
        resolvedCompany = co;
        break;
      }
    }
  }

  // Fix #20: company from posting prose (ticker / "Who we are" opener / "At X,
  // we…") — more reliable than the page title or the "About X" heading below.
  if (!resolvedCompany) {
    const fromProse = extractCompanyFromProse(lines);
    if (fromProse) resolvedCompany = fromProse;
  }

  // Fix #19: "As a [Job Title] at/with/in [Company]" — common intro sentence,
  // and a chance to also recover the company from "...at <Company>,".
  if (!resolvedTitle || !resolvedCompany) {
    for (const line of lines) {
      const m = line.match(
        /\bAs (?:a|an) ((?:[A-Z][A-Za-z]+[ ]){0,4}[A-Z][A-Za-z]+) (?:at|with|for) ([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4})/
      );
      if (m) {
        const candidate = m[1].trim();
        // Gate the title through isPlausibleRole so "As a Global Leader at…" or
        // "As a Trusted Partner with…" can't pass as a job title.
        if (!resolvedTitle && isPlausibleRole(candidate)) resolvedTitle = candidate;
        if (!resolvedCompany) {
          const co = cleanCompanyName(m[2]);
          if (isPlausibleCompany(co)) resolvedCompany = co;
        }
        if (resolvedTitle && resolvedCompany) break;
      }
    }
  }

  // Fix(JD-corpus): careers-site pages (extension body.innerText fallback) lead
  // with a nav block, so the real role title isn't near line 1 and the generic
  // fallback grabs nav chrome ("Dashboard", "Sign in", a company name). The MAIN
  // role title is reliably the FIRST role-shaped line from the top — related-jobs
  // widgets (each with their own title + Apply) always come later in the DOM, so a
  // top-down scan naturally takes the primary role. Bounded to the region BEFORE
  // the first responsibilities/requirements heading so a duty line (which can also
  // contain a role noun) can't be mistaken for the title.
  if (!resolvedTitle) {
    const firstJobHeading = lines.findIndex((line) =>
      matchesHeading(line, [...RESPONSIBILITY_HEADING, ...REQUIRED_HEADING, ...PREFERRED_HEADING])
    );
    const scanEnd = firstJobHeading === -1 ? Math.min(lines.length, 40) : firstJobHeading;
    for (let i = 0; i < scanEnd; i += 1) {
      const cand = lines[i]
        .trim()
        // Strip a leading breadcrumb ("All Jobs / <Title>") and a recruiting prefix.
        .replace(/^(?:view )?all jobs\s*[\/›»>|]\s*/i, "")
        .replace(/^(?:now hiring|we['‘’]?re hiring|hiring|job opening|open (?:role|position|req))\s*[:\-–—]\s*/i, "")
        .trim();
      if (!cand || cand.length < 8 || cand.length > 90) continue;
      if (/[.!?]/.test(cand)) continue;
      if ((cand.match(/,/g) ?? []).length > 1) continue;
      // Must be a real role title: an AGENT role noun (not "Engineering"), at least
      // two words, and not a nav listing ("Engineering Jobs", "Developer Roles").
      if (!TITLE_ROLE_NOUN.test(cand)) continue;
      if (cand.split(/\s+/).length < 2) continue;
      if (/\b(jobs?|roles?|openings?|opportunities|categor(?:y|ies)|listings?)$/i.test(cand)) continue;
      if (
        NOISE_LINE.some((re) => re.test(cand)) ||
        isBareFieldLabel(cand) ||
        isStructureHeading(cand) ||
        isPromptMetadataLine(cand) ||
        isEmptyMarker(cand)
      ) continue;
      // Not a location / work-mode line, and not the resolved company.
      if (/^[A-Z][\w.'’&-]+(?:[ -][\w.'’&-]+)*,\s*[A-Z]{2}\b/.test(cand)) continue;
      if (/^(remote|hybrid|on-?site|united states|full[- ]time|part[- ]time|contract)\b/i.test(cand)) continue;
      if (resolvedCompany && cand.toLowerCase() === resolvedCompany.toLowerCase()) continue;
      // Skip a value stacked under a bare ATS field label ("Job Function"\n
      // "Software Engineering") — that's metadata, not the role title.
      let prevNonEmpty = "";
      for (let p = i - 1; p >= 0; p -= 1) {
        if (lines[p].trim()) {
          prevNonEmpty = lines[p].trim();
          break;
        }
      }
      if (isBareFieldLabel(prevNonEmpty)) continue;
      resolvedTitle = cand;
      break;
    }
  }

  // Fix #20: role from posting prose ("looking for a <Role>") — ranks above the
  // generic-heading guess below, which the page title can mislead.
  if (!resolvedTitle) {
    const fromProse = extractRoleFromProse(lines);
    if (fromProse) resolvedTitle = fromProse;
  }

  // Fix #5c: Generic title fallback — first raw line 8-70 chars, no sentence
  // punctuation, not furniture, reappears later in the document (case-insensitive).
  // Secondary: a short non-furniture line immediately before a section/metadata heading
  // (page H1 pattern: <title> then <General Information> etc.).
  if (!resolvedTitle) {
    const lowerLines = lines.map((l) => l.trim().toLowerCase());
    let proximityCandidate: string | undefined;
    const titleSearchEnd = lines.findIndex((line) =>
      matchesHeading(line, [...RESPONSIBILITY_HEADING, ...REQUIRED_HEADING, ...PREFERRED_HEADING])
    );
    const end = titleSearchEnd === -1 ? Math.min(lines.length, 25) : Math.min(titleSearchEnd, 25);

    for (let i = 0; i < end; i += 1) {
      let candidate = lines[i].trim();
      if (!candidate) continue;
      // Fix(JD-test): strip a leading recruiting prefix ("Now Hiring: <Title>",
      // "We're hiring — <Title>", "Job Opening: <Title>") before validating, so
      // the prefix doesn't end up inside tracking.title.
      candidate = candidate
        .replace(/^(?:now hiring|we['‘’]?re hiring|hiring|job opening|open (?:role|position|req))\s*[:\-–—]\s*/i, "")
        .trim();
      if (candidate.length < 8 || candidate.length > 70) continue;
      // Sentence-terminal punctuation signals prose; a comma is a normal title
      // separator ("Software Engineer, Safety", "SWE Intern, Internal Apps").
      // Allow at most one comma so a multi-clause prose line is still rejected.
      if (/[.!?;]/.test(candidate)) continue;
      if ((candidate.match(/,/g) ?? []).length > 1) continue;
      // The comma relaxation must not admit prose: reject a sentence opener or a
      // ", <pronoun/article/verb>" clause ("At Acme, we build great software").
      if (/^(?:at|join|we|our|the|this|as|in|for|to)\b/i.test(candidate)) continue;
      if (/,\s+(?:we|you|our|the|a|an|to|and|is|are|that|which|who)\b/i.test(candidate)) continue;
      // Skip bullet-prefixed lines — these are list items from navigation, not titles
      if (/^[•·‣◦▪●○]/.test(candidate)) continue;
      // Skip common page-chrome / navigation strings that aren't job titles
      if (/^(skip to (content|main)|accessibility|navigation|menu|home|page|click here|log(in| in)|register|sign up|get started|contact( us)?|learn more|view (all|more)|search|explore|discover|download|browse)\b/i.test(candidate)) continue;
      if (
        NOISE_LINE.some((re) => re.test(candidate)) ||
        isPromptMetadataLine(candidate) ||
        isBareFieldLabel(candidate) ||
        isStructureHeading(candidate) ||
        isEmptyMarker(candidate)
      ) continue;
      // A line equal to the resolved employer name is the company, not the title.
      // LinkedIn repeats the company name verbatim, so it would otherwise win the
      // "reappears" branch and be reported as the job title ("Neuralink").
      if (resolvedCompany && candidate.toLowerCase() === resolvedCompany.toLowerCase()) continue;

      // A value stacked under a bare ATS label ("Job Category"\n"Technology",
      // "Job Function"\n"Software Engineering") is metadata, not a title — the
      // proximity heuristic below otherwise reads every such value as a title.
      let prevNonEmpty = "";
      for (let p = i - 1; p >= 0; p -= 1) {
        if (lines[p].trim()) {
          prevNonEmpty = lines[p].trim();
          break;
        }
      }
      if (isBareFieldLabel(prevNonEmpty)) continue;

      const lc = candidate.toLowerCase();
      // Preferred: reappears later
      const reappears = lowerLines.slice(i + 1).some((l) => l === lc);
      if (reappears) {
        resolvedTitle = candidate;
        break;
      }

      // Secondary: appears immediately before a section/metadata heading or
      // page furniture (short title-case/caps section header like "General Information")
      if (!proximityCandidate) {
        for (let j = i + 1; j < lines.length; j += 1) {
          const next = lines[j].trim();
          if (!next) continue;
          const isSectionLike =
            isStructureHeading(next) ||
            isMetadataLabel(next) ||
            // short heading-like line: 3-40 chars, no lower-case-start, no sentence punct
            (next.length >= 3 && next.length <= 40 && /^[A-Z]/.test(next) && !/[.!?;]/.test(next));
          if (isSectionLike) {
            proximityCandidate = candidate;
          }
          break; // only look at the very next non-empty line
        }
      }
    }

    // Use proximity candidate only if no reappear match was found
    if (!resolvedTitle && proximityCandidate) {
      resolvedTitle = proximityCandidate;
    }
  }

  // Fix #5d: Company fallback — "About <CompanyName>" heading where the name
  // is not a generic placeholder phrase. The captured name must start with a
  // real uppercase letter (the heading match itself is case-insensitive, so
  // without this check "about our team" would capture "our team" as a company).
  if (!resolvedCompany) {
    const GENERIC_ABOUT =
      /^(us|you|me|our (company|team)|the (company|role|team|job|position|opportunity)|this (role|job|position|opportunity)|working here)$/i;
    for (const line of lines) {
      // Allow an optional trailing colon ("About Neuralink:") and a comma in the
      // legal name ("About Wildfire Defense Systems, Inc."); cleanCompanyName +
      // isPlausibleCompany still gate the captured value.
      const m = line.trim().match(/^about ([A-Z][\w.&',\- ]{1,48}):?$/i);
      const name = m ? cleanCompanyName(m[1]) : "";
      if (name && /^[A-Z]/.test(name) && !GENERIC_ABOUT.test(name) && isPlausibleCompany(name)) {
        // Fix(JD-test): section headings are often styled ALL-CAPS ("ABOUT
        // HONEYWELL"). Normalize an all-caps name to title case PER TOKEN, but
        // leave short tokens (<= 4 chars) as-is so acronyms survive — "HONEYWELL"
        // → "Honeywell", "GENERAL MOTORS" → "General Motors", but "BMW AG" and
        // "IBM" stay untouched.
        resolvedCompany =
          name.length >= 6 && name === name.toUpperCase()
            ? name.replace(/[A-Za-z]+/g, (w) => (w.length > 4 ? w.charAt(0) + w.slice(1).toLowerCase() : w))
            : name;
        break;
      }
    }
  }

  // Fix(JD-corpus): conservative POSITIONAL stacked-header reader. Many ATS pages
  // and LinkedIn topcards render the role on the first text line, then the company
  // and/or a "City, ST" location on their own bare lines just below — no labels.
  // Read these only from the first few non-furniture lines, and only into still-
  // blank fields:
  //   - LOCATION: a strict "City, ST[, United States]" or "Remote/Hybrid/Onsite"
  //     shape (self-gating — almost nothing else matches it).
  //   - COMPANY: a plausible company name that ALSO re-appears verbatim later in
  //     the body (echo gate), so a one-off tagline can't pass as the employer.
  {
    // The 2-letter tail is restricted to a real US state code (or an explicit
    // country) so a comma-title like "Senior Engineer, AI" / "Designer, UX" cannot
    // pass as a location. (US state set + DC.)
    const US_STATE =
      "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
    const LOCATION_SHAPE = new RegExp(
      String.raw`^[A-Z][\w.'’&-]+(?:[ -][\w.'’&-]+)*,\s*(?:${US_STATE})(?:\s+\d{5})?(?:,?\s*(?:United States|USA|US))?$`
    );
    const LOCATION_COUNTRY =
      /^[A-Z][\w.'’&-]+(?:[ -][\w.'’&-]+)*,\s*(?:United States|USA|Canada|United Kingdom|UK|Australia|India|Ireland|Germany|France|Singapore|Remote)$/;
    // Only "Remote/Hybrid/Onsite" optionally followed by a SEPARATOR (so
    // "Remote first company" prose does not become the location).
    const REMOTE_SHAPE = /^(?:remote|hybrid|on-?site)(?:\s*[-–(/,][\w ,/()-]{0,40})?$/i;
    const headerWindow: string[] = [];
    for (let i = 0; i < lines.length && headerWindow.length < 8; i += 1) {
      const t = lines[i].trim();
      if (t) headerWindow.push(t);
    }
    const isFurniture = (t: string) =>
      NOISE_LINE.some((re) => re.test(t)) ||
      isBareFieldLabel(t) ||
      isStructureHeading(t) ||
      isPromptMetadataLine(t);
    const isLocationShape = (t: string) =>
      LOCATION_SHAPE.test(t) || LOCATION_COUNTRY.test(t) || (t.length <= 48 && REMOTE_SHAPE.test(t));

    if (!resolvedLocation) {
      for (const t of headerWindow) {
        // A role title is not a location (defends the comma-title relaxation).
        if (t === resolvedTitle || isFurniture(t) || ROLE_NOUN.test(t)) continue;
        if (isLocationShape(t)) {
          resolvedLocation = t;
          break;
        }
      }
    }
    if (!resolvedCompany) {
      const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const t of headerWindow) {
        if (t === resolvedTitle || isFurniture(t) || isLocationShape(t)) continue;
        // A bare-line company is a NAME, not a sentence.
        if (/\b(is|are|was|were|will|provides?|builds?|offers?|helps?|seeks?|hiring)\b/i.test(t)) continue;
        const co = cleanCompanyName(t);
        if (!isPlausibleCompany(co)) continue;
        const esc = escapeRe(co);
        // Echo gate: the name must reappear in a SELF-DESCRIPTION ("At <co>", "<co>
        // is a … company", "<co> builds/provides …", "<co> is hiring/was founded").
        const selfCue = new RegExp(
          String.raw`^(?:at|join|welcome to|about)\s+${esc}\b|\b${esc}\s+(?:is|are|was|has|builds?|powers?|provides?|offers?|helps?|develops?|delivers?|operates?|specializes?|serves?|is hiring|is looking|provided pay)\b`,
          "i"
        );
        // …but NOT when the sentence describes the name as a PRODUCT/TOOL the role
        // uses ("Photoshop is required", "Salesforce is the CRM", "Workday is one of
        // the systems") — that names a product/partner, not the employer.
        const productUse = new RegExp(
          String.raw`\b${esc}\s+is\s+(?:the\s+|a\s+|an\s+|our\s+|their\s+|your\s+|one of\s+(?:the\s+)?|(?:the\s+)?(?:primary|main|preferred|default|core)\s+)*(?:tools?|tooling|systems?|crm|erp|frameworks?|library|libraries|platform we use|software we use|applications?|apps?|databases?|ide|stack|required|used|needed|leveraged|utilized)\b`,
          "i"
        );
        if (lines.some((l) => selfCue.test(l.trim()) && !productUse.test(l.trim()))) {
          resolvedCompany = co;
          break;
        }
      }
    }
  }

  return {
    title: resolvedTitle ? resolvedTitle.slice(0, 200) : undefined,
    role: resolvedTitle ? resolvedTitle.slice(0, 200) : undefined,
    company: resolvedCompany ? resolvedCompany.slice(0, 200) : undefined,
    source: sourceFromUrl(url) || undefined,
    location: resolvedLocation ? resolvedLocation.slice(0, 200) : undefined,
    jobType: normalizeJobType(employmentType) || undefined,
    workAuth: extractWorkAuth(lines) || undefined,
    ...extractSalary(lines),
    roleDescription: roleDescription || undefined
  };
}

// Fix #7: buildRoleDescription — skip intro candidates that are <60 chars or
// match isStructureHeading; append subsequent lines when sentence is incomplete;
// Fix #8: skip lines that fail isLikelyProse
function buildRoleDescription(lines: string[], maxChars = 900): string {
  const collectFrom = (start: number) => {
    const picked: string[] = [];
    for (let i = start; i < lines.length && picked.join(" ").length < maxChars; i += 1) {
      const line = cleanSummaryLine(lines[i]);
      if (!line) continue;
      if (isNonTailoringHeading(line)) break;
      if (picked.length && isSectionHeading(line)) break;
      if (isLowValueLine(line) || /^about [A-Z0-9][\w .&-]{1,80}$/i.test(line)) continue;
      if (/salary|compensation|benefits|equal opportunity|privacy/i.test(line)) continue;
      // Fix #8: skip JS/template junk
      if (!isLikelyProse(line)) continue;
      picked.push(line);
      if (picked.length >= 4) break;
    }
    const joined = picked.join(" ");
    return clipSentence(joined, maxChars);
  };

  // Collect lines into a complete sentence (ending with punctuation),
  // appending subsequent non-heading lines if the picked text doesn't end with
  // sentence-ending punctuation. Bounded by maxChars.
  const collectUntilSentence = (start: number) => {
    const picked: string[] = [];
    for (let i = start; i < lines.length; i += 1) {
      const line = cleanSummaryLine(lines[i]);
      if (!line) continue;
      if (isNonTailoringHeading(line)) break;
      if (picked.length && isSectionHeading(line)) break;
      if (isLowValueLine(line) || /^about [A-Z0-9][\w .&-]{1,80}$/i.test(line)) {
        if (picked.length) break; // stop collecting if we have something
        continue;
      }
      if (/salary|compensation|benefits|equal opportunity|privacy/i.test(line)) break;
      if (!isLikelyProse(line)) break;
      picked.push(line);
      const joined = picked.join(" ");
      if (joined.length >= maxChars) break;
      // If we have a complete sentence, stop
      if (/[.!?]$/.test(line.trim())) break;
      if (picked.length >= 6) break; // safety cap
    }
    return clipSentence(picked.join(" "), maxChars);
  };

  const introHeading = lines.findIndex((line) =>
    /^(about the role|the role|role overview|overview|job description|position description|your impact)\b/i.test(line.trim())
  );
  if (introHeading !== -1) {
    const text = collectFrom(introHeading + 1);
    if (text.length > 80) return text;
  }

  const introLine = lines.find((line) => {
    const cleaned = cleanSummaryLine(line);
    // Fix #7: skip short or heading-like intro lines
    if (cleaned.length < 60) return false;
    if (isStructureHeading(cleaned)) return false;
    if (!isLikelyProse(cleaned)) return false;
    // Must start with an uppercase letter (prevents picking up continuation fragments)
    if (!/^[A-Z]/.test(cleaned)) return false;
    return /\b(we are looking for|we are seeking|you will|this role|in this role|join .* as|responsible for)\b/i.test(line);
  });
  if (introLine) {
    const idx = lines.indexOf(introLine);
    return collectUntilSentence(idx);
  }

  const responsibilities = lines.findIndex((line) =>
    /^(responsibilities|what you['']?ll do|what you will do|your impact|you will)\b/i.test(line.trim())
  );
  if (responsibilities !== -1) {
    const text = collectFrom(responsibilities + 1);
    if (text.length > 60) return text;
  }

  const firstUseful = lines.findIndex((line) => {
    const cleaned = cleanSummaryLine(line);
    // Fix #7: must be >=60 chars, not a structure heading, and be prose
    return cleaned.length >= 60 && !isLowValueLine(cleaned) && !isSectionHeading(cleaned) && isLikelyProse(cleaned);
  });
  return firstUseful === -1 ? "" : collectUntilSentence(firstUseful);
}

function buildTailoringLines(lines: string[]): string[] {
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (isEmptyMarker(t)) return false;
    if (isPromptMetadataLine(t)) return false;
    return !NOISE_LINE.some((re) => re.test(t));
  });

  return compactDuplicateLines(
    cutTrailingBoilerplate(removeNonTailoringSections(removeWorkdayFurniture(kept)))
  );
}

// Fix #11: extractCompanyProductContext — prefer tailoring lines over rawLines
function extractCompanyProductContext(
  tailoringLines: string[],
  rawLines: string[],
  tracking: ExtractedJobTracking
): string {
  // Fix #19: context quality gate — reject heading-based results that look like
  // concatenated nav items (e.g. "Win Together at PAR Sustainability at PAR Living Our Values"):
  // must be >=80 chars OR contain sentence-ending punctuation.
  const isQualityContext = (s: string) => s.length >= 80 || /[.!?]/.test(s);

  // Try tailoring lines first
  const fromHeadingTailoring = collectUnderHeadings(tailoringLines, COMPANY_CONTEXT_HEADING, 3);
  const headingContextTailoring = stripCompensationLanguage(fromHeadingTailoring.join(" "));
  if (headingContextTailoring && isLikelyProse(headingContextTailoring) && isQualityContext(headingContextTailoring)) {
    return clipSentence(headingContextTailoring, 520);
  }

  // Fall back to rawLines
  const fromHeading = collectUnderHeadings(rawLines, COMPANY_CONTEXT_HEADING, 3);
  const headingContext = stripCompensationLanguage(fromHeading.join(" "));
  if (headingContext && isLikelyProse(headingContext) && isQualityContext(headingContext)) return clipSentence(headingContext, 520);

  if (tracking.roleDescription && isLikelyProse(tracking.roleDescription)) {
    return clipSentence(stripCompensationLanguage(tracking.roleDescription), 520);
  }
  return "";
}

// Fix(JD-test): a recruiter-intro paragraph or reporting-structure sentence that
// sits directly under a "What you'll do"/"Overview" heading is not a duty — drop
// it so it doesn't occupy (and evict, via the cap) a real responsibility bullet.
// Code-review fix: anchor the "is/are looking for" form to the START with a short
// (<=2 word) subject so it only matches an INTRO opener ("Docusign is looking
// for…"), NOT a real duty that merely contains the phrase ("Define what the
// business is looking for and translate it to specs").
const RESP_INTRO_NOISE =
  /^(?:\S+\s+){0,2}(?:is|are)\s+(?:looking for|seeking|hiring)\b|\bindividual contributor role\b|^the responsibilities? (?:include|are)\b|(?:include|are)s?,?\s+but\s+(?:are|is)\s+not\s+limited to\b|^while we (?:do\s?n['‘’]?t|don['‘’]?t) expect\b|\b(?:authorized to work|sponsor(?:ship)?|work visa|local candidates only)\b|^need help\??$|^the (?:requirements|qualifications) listed below\b|\bare representative of the (?:knowledge|skills)\b|\b(?:pass|complete|consent to|undergo|subject to|contingent (?:up)?on|clear|able to clear|required to (?:pass|complete|undergo|consent))\b[^.]{0,45}\b(?:pre-?employment\s+)?(?:drug (?:test|screen)|background (?:check|screening))\b|\bis an equal opportunity\b|\bequal (?:opportunity|employment opportunity) employer\b|\bact in accordance with (?:all |applicable |the |our |company )*(?:policies|policy|code of conduct)\b|\b(?:complete|completing) (?:a |the )?(?:video |self[- ]guided )?(?:interview|screening) assessment\b|^how to prepare\b|\bset aside \d+[- ]\d+ minutes\b/i;

// Fix #18: caps: responsibilities 7→8, preferred 6→9
function extractResponsibilities(lines: string[]): string[] {
  // Collect generously, drop intro/reporting/disclaimer noise, THEN cap — so
  // removing a leading non-duty line lets a real duty take its place instead of
  // shrinking the list (the noise items would otherwise occupy capped slots).
  const fromSections = collectUnderHeadings(lines, RESPONSIBILITY_HEADING, 16)
    .filter((item) => !RESP_INTRO_NOISE.test(item))
    .slice(0, 12);  // Fix(JD-corpus): cap 8→12 (freed slots backfill with real duties)
  if (fromSections.length) return fromSections;
  // Fix #9: extended fallback verbs with gerund forms and assist/contribute/participate/help
  return fallbackItems(
    lines,
    [
      /\b(you will|responsible for|build(?:ing)?|develop(?:ing)?|design(?:ing)?|implement(?:ing)?|maintain(?:ing)?|collaborate|own|support|ship|debug|test|assist|contribute|participate|help)\b/i
    ],
    8
  ).filter((item) => !RESP_INTRO_NOISE.test(item));
}

function extractQualifications(lines: string[]) {
  // Fix(JD-test): collect generously so the preferred-demotion split below sees
  // the whole section — a low cap truncated trailing "is a plus"/"preferred"
  // items before they could be demoted (Rochester lost 2). Final caps (8/9)
  // still apply downstream, so this only widens what reaches demotion.
  // Drop intro/marketing/policy boilerplate (same filter as responsibilities) so a
  // "As a <role> you will…" intro, a "The <team> at <Co>…" product blurb, or a
  // drug-test/security-policy line can't land as a qualification.
  const requiredRaw = collectUnderHeadings(lines, REQUIRED_HEADING, 20).filter((item) => !RESP_INTRO_NOISE.test(item));
  // Fix #4: use strict preferred check (first ~40 chars / first sentence only)
  const preferredRaw = [
    ...collectUnderHeadings(lines, PREFERRED_HEADING, 9),  // Fix #18: 6→9
    ...requiredRaw.filter(isPreferredItemStrict)
  ].filter((item) => !RESP_INTRO_NOISE.test(item));
  const required = requiredRaw.filter((item) => !isPreferredItemStrict(item));
  const requiredFallback = required.length
    ? []
    : fallbackItems(
        lines,
        [
          /\b(required|must|need|qualification|experience with|proficient|proficiency|knowledge of|years? of experience)\b/i
        ],
        8
      );

  return {
    // Filter the COMBINED list (incl. the keyword-sweep fallback, which otherwise
    // bypasses the noise filter) so an intro paragraph matched via "knowledge of"
    // or a "drug test" line can't land as a required qualification.
    required: uniqueItems([...required, ...requiredFallback].filter((item) => !RESP_INTRO_NOISE.test(item)), 8),
    preferred: uniqueItems(preferredRaw, 9)  // Fix #18: 6→9
  };
}

function extractTechKeywords(lines: string[], tracking: ExtractedJobTracking): string[] {
  const source = [
    tracking.title,
    tracking.roleDescription,
    ...lines
  ]
    .filter(Boolean)
    .join("\n");
  // Fix(JD-test): cap raised 14→18 so the broadened keyword set (Salesforce +
  // Rust/Kotlin/Terraform/… appended below the common keywords) can still surface
  // a posting's central tech instead of being crowded out by the top-14.
  return TECH_KEYWORDS.filter(([, re]) => re.test(source)).map(([label]) => label).slice(0, 18);
}

// Fix #15: years regex must handle en/em dashes, and only count when within
// ~40 chars of "experience"/"exp"; "over 50 years" of company history skipped.
// Fix #16: "senior" only from title or seniority metadata, not anywhere in body.
function extractSenioritySignals(
  lines: string[],
  tracking: ExtractedJobTracking,
  reviewMetadata: ReturnType<typeof extractReviewMetadata>
): string[] {
  // Fix #16: only use title + reviewMetadata for senior signal, not all lines
  const titleAndMeta = [tracking.title, reviewMetadata.seniority].filter(Boolean).join("\n");
  // Full source still used for junior/years signals but NOT for "senior"
  const source = [tracking.title, reviewMetadata.seniority, ...lines].filter(Boolean).join("\n");
  const signals: string[] = [];
  const add = (value: string) => {
    if (!signals.some((existing) => existing.toLowerCase() === value.toLowerCase())) signals.push(value);
  };

  if (reviewMetadata.seniority) add(reviewMetadata.seniority);
  // Skip the synthetic junior tag when explicit metadata already says it
  // ("Entry level" + "entry-level / junior" reads as a duplicate).
  if (
    !signals.some((existing) => /\b(entry|junior|new grad)\b/i.test(existing)) &&
    /\b(entry[- ]level|new grad|early[- ]career|junior|jr\.?)\b/i.test(source)
  ) {
    add("entry-level / junior");
  }

  // Fix #15: match en/em dashes in year ranges; require "experience"/"exp" context within 40 chars
  const yearsPattern = /(\d+(?:[+]|\s*(?:-|–|—|to)\s*\d+[+]?)?\s*(?:\+\s*)?years?)/gi;
  const yearsMatches: string[] = [];
  for (const match of source.matchAll(yearsPattern)) {
    const start = match.index ?? 0;
    // Check ~40-char window around the match for experience context
    const window = source.slice(Math.max(0, start - 40), start + match[0].length + 40);
    if (!/\bexp(?:erience)?\b/i.test(window)) continue;
    // Skip "over N years" of company history heuristic — if number is large (>20)
    // and context mentions "company"/"investing"/"operating"
    if (/\b(company|invest|operat|collect)\b/i.test(window) && parseInt(match[0]) > 20) continue;
    const normalized = match[1].replace(/\s+/g, " ").trim();
    yearsMatches.push(normalized);
    if (yearsMatches.length >= 3) break;
  }
  yearsMatches.forEach(add);

  // Fix #16 + JD-test: add "senior" only when the TITLE names a senior technical
  // role ("Senior [Staff/Principal/Lead] Engineer/Developer/…") or seniority
  // metadata says so. This anchors on the role HEAD, so a comp-band title like
  // NYL's "Senior Associate - Associate Full Stack Engineer" (where "Senior"
  // modifies the pay grade "Associate", >3 tokens from "Engineer") does NOT
  // fire, and — unlike a body-text gate — a real "Senior Engineer" posting is
  // never demoted by mentoring copy ("mentor early-career engineers").
  // Code-review fix: one shared technical-role-head list so the senior and
  // staff/principal detectors can't drift apart (they previously had divergent
  // head sets — e.g. "Staff SRE" failed to register).
  const SENIOR_HEAD = "engineer|developer|programmer|architect|scientist|sre|devops|analyst|designer";
  const seniorTitle = new RegExp(
    String.raw`\b(?:senior|sr\.?)\s+(?:staff\s+|principal\s+|lead\s+)?(?:[A-Za-z.+/&-]+\s+){0,3}(?:${SENIOR_HEAD})\b`,
    "i"
  );
  if (seniorTitle.test(titleAndMeta) || /\bsenior\b/i.test(reviewMetadata.seniority ?? "")) add("senior");

  // Fix(JD-test): staff/principal/distinguished/fellow are senior-or-above IC
  // levels (title-anchored to a technical role head, so "principal investigator"
  // or prose "staff are friendly" can't fire).
  const staffLevel = titleAndMeta.match(
    new RegExp(String.raw`\b(staff|principal|distinguished|fellow)\s+(?:[A-Za-z.+/&-]+\s+){0,3}(?:${SENIOR_HEAD})\b`, "i")
  );
  if (staffLevel) add(`${staffLevel[1].toLowerCase()}-level`);

  // Fix(JD-test): intern / co-op from the TITLE only — a body mention of
  // "internship experience preferred" must not tag a senior role an internship.
  if (/\bintern(?:ship)?\b|\bco-?op\b/i.test(tracking.title ?? "")) add("intern");

  // Fix(JD-test): dropped bare "manage"/"manager" — they over-matched routine
  // copy ("manage time", "agreement management") and reports-to lines ("Senior
  // Manager"), tagging individual-contributor roles as leadership.
  // Leadership requires a people/team-management cue, NOT a reports-to line
  // ("Tech Lead (Engineer III)"), a mentee ("paired with a mentor"), a company
  // name ("Mentor Talent Acquisition"), or culture marketing ("our leadership
  // position"). Bare "lead"/"mentor"/"leadership" over-fired on all of those.
  const LEADERSHIP_CUE =
    /\bleadership\s+(?:skills?|experience|abilities|qualities|opportunit\w+)\b|\btechnical leadership\b|\btake\s+(?:the\s+)?lead\b|\b(?:lead|leads|leading|mentor|mentors|mentoring|mentorship|coach|guide)\s+(?:and\s+\w+\s+)?(?:a\s+|the\s+|our\s+|other\s+|junior\s+|cross[- ]functional\s+)*(?:teams?|engineers?|developers?|peers?|members|reports|squad|group|interns?)\b/i;
  if (LEADERSHIP_CUE.test(source)) add("leadership");
  // Ownership requires an ownership noun or an "own <work-object>" cue — the bare
  // possessive adjective ("planning your own technical work") no longer fires.
  const OWNERSHIP_CUE =
    /\bownership\b|\bend[- ]to[- ]end\b|\bown(?:s|ed|ing)?\s+(?:the\s+|our\s+|full\s+|complete\s+|entire\s+)?(?:delivery|roadmap|projects?|features?|outcomes?|products?|services?|systems?|components?|initiatives?)\b/i;
  if (OWNERSHIP_CUE.test(source)) add("ownership");
  return signals.slice(0, 6);
}

function extractDomainSignals(
  tracking: ExtractedJobTracking,
  reviewMetadata: ReturnType<typeof extractReviewMetadata>,
  companyContext: string
): string[] {
  // Domain signals describe what the company/product is about, so they are
  // read only from company-identity surfaces (company, title, role summary,
  // company context, Industries metadata) — never from the full JD body, where
  // a passing mention ("a database of healthcare providers" as one duty)
  // would masquerade as the company's domain.
  const source = [
    tracking.company,
    tracking.title,
    tracking.roleDescription,
    reviewMetadata.industries,
    companyContext
  ]
    .filter(Boolean)
    .join("\n");
  return DOMAIN_SIGNALS.filter(([, re]) => re.test(source)).map(([label]) => label).slice(0, 8);
}

function buildStructuredTailoringText(
  rawLines: string[],
  tracking: ExtractedJobTracking,
  reviewMetadata: ReturnType<typeof extractReviewMetadata>,
  maxChars: number
): string {
  const tailoringLines = buildTailoringLines(rawLines);
  // Fix #11: pass tailoringLines first, fall back to rawLines in extractCompanyProductContext
  const context = extractCompanyProductContext(tailoringLines, rawLines, tracking);
  const responsibilities = extractResponsibilities(tailoringLines);
  const { required, preferred } = extractQualifications(tailoringLines);
  const tech = extractTechKeywords(tailoringLines, tracking);
  const seniority = extractSenioritySignals(tailoringLines, tracking, reviewMetadata);
  const domains = extractDomainSignals(tracking, reviewMetadata, context);
  const title = tracking.title || tracking.role || "";

  const sections = [
    `Job Title:\n${title || "[manual input needed: job title]"}`,
    `Company / Product Context:\n${context || "[manual input needed: 1-3 sentence company or product summary]"}`,
    ["Core Responsibilities:", ...bulletLines(responsibilities, "[manual input needed: core responsibilities]")].join("\n"),
    ["Required Qualifications:", ...bulletLines(required, "[manual input needed: required qualifications]")].join("\n"),
    ["Preferred Qualifications:", ...bulletLines(preferred, "Not specified")].join("\n"),
    ["Tech Stack / Keywords:", ...bulletLines(tech, "[manual input needed: tech stack or keywords]")].join("\n"),
    ["Seniority Signals:", ...bulletLines(seniority, "Not specified")].join("\n"),
    ["Domain Signals:", ...bulletLines(domains, "Not specified")].join("\n")
  ];

  return normalize(sections.join("\n\n")).slice(0, maxChars);
}

function manualReviewFields(result: ExtractedJobPosting): string[] {
  const fields: string[] = [];
  const tt = result.tailoringText;
  // Fix #8: also push "job description" when responsibilities AND required quals
  // AND tech keywords are all placeholders (garbage page detection)
  const allPlaceholders =
    /\[manual input needed: core responsibilities\]/i.test(tt) &&
    /\[manual input needed: required qualifications\]/i.test(tt) &&
    /\[manual input needed: tech stack or keywords\]/i.test(tt);
  if (result.tailoringText.trim().length < 40 || allPlaceholders) fields.push("job description");
  if (!result.tracking.title && !result.tracking.role) fields.push("role title");
  if (!result.tracking.company) fields.push("company");
  if (!result.roleDescription) fields.push("role summary");
  if (!result.tracking.location) fields.push("location");
  if (result.tracking.salaryMin == null && result.tracking.salaryMax == null) fields.push("compensation");
  if (/\[manual input needed: core responsibilities\]/i.test(tt)) fields.push("responsibilities");
  if (/\[manual input needed: required qualifications\]/i.test(tt)) fields.push("required qualifications");
  if (/\[manual input needed: tech stack or keywords\]/i.test(tt)) fields.push("tech stack keywords");
  return fields;
}

export function extractJobPosting(raw: string, options: ExtractOptions = {}): ExtractedJobPosting {
  const cleaned = normalize(String(raw ?? ""));
  if (!cleaned) {
    return {
      tailoringText: "",
      roleDescription: "",
      tracking: sourceFromUrl(options.url) ? { source: sourceFromUrl(options.url) } : {},
      manualReviewFields: ["job description", "role title", "company", "role summary", "location", "compensation"],
      sourceTextLength: 0
    };
  }

  // Apply Workday trailing-label split at the rawLines level so that
  // extractTracking (and workAuth in particular) sees the clean split form.
  const rawLines = splitWorkdayTrailingLabel(cleaned.split("\n"));
  const tracking = extractTracking(rawLines, options.url);
  const reviewMetadata = extractReviewMetadata(rawLines);
  const maxChars = options.maxChars ?? 9_000;
  const tailoringText = buildStructuredTailoringText(rawLines, tracking, reviewMetadata, maxChars);
  const roleDescription = tracking.roleDescription ?? "";
  const result: ExtractedJobPosting = {
    tailoringText,
    roleDescription,
    tracking,
    manualReviewFields: [],
    sourceTextLength: cleaned.length
  };
  result.manualReviewFields = manualReviewFields(result);
  return result;
}
