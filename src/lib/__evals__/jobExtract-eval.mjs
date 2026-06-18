import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import * as esbuild from "esbuild";

async function loadJobExtract() {
  const source = await readFile(new URL("../jobExtract.ts", import.meta.url), "utf8");
  const output = await esbuild.transform(source, { loader: "ts", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString("base64")}`);
}

function hasPlaceholder(text, label) {
  return new RegExp(`\\[manual input needed: ${label}`, "i").test(text);
}

function sectionBody(text, heading, nextHeading) {
  return text.match(new RegExp(heading + ":\\n([\\s\\S]*?)\\n\\n" + nextHeading + ":", "i"))?.[1] ?? "";
}

const { extractJobPosting } = await loadJobExtract();

const americanAirlinesShape = `
Posting Start Date: 6/9/26
Location: DFW Headquarters Building 8 (DFW-SV08)
Cities: Fort Worth - TX
Requisition ID: 85706
Job Description
Intro
Join our American Airlines family and grow your expertise while supporting reliable airline software.
Why you'll love this job
As one diverse, high-performing team dedicated to technical excellence, you will deliver digital products that drive a more reliable and profitable airline.
What you'll do
As noted above, this list is intended to reflect the current job but there may be additional essential functions.
Writes, tests, and documents technical work products according to organizational standards and practices.
Efficiently debugs design-time and run-time problems caused by interactions with other services.
Designs new implementations and provides enhancements to existing architectures.
All you'll need for success
Minimum Qualifications- Education & Prior Job Experience
Bachelor's degree in Computer Science, Engineering, or equivalent experience/training.
1+ years of experience designing, developing, and implementing large-scale solutions in production environments.
Preferred Qualifications- Education & Prior Job Experience
Airline Industry experience
Skills, Licenses & Certifications
Programming Languages: Java, Python, C#, Javascript/Typescript
Deployment Technologies: Kubernetes, Docker
Source Control: GitHub, Azure DevOps
CICD: GitHub Actions, Azure DevOps
Integration/APIs Technologies: Kafka, REST, GraphQL
Test Automation: Selenium, Cypress, PyTest, Playwright
What you'll get
Travel Perks: Explore the world with flight benefits.
`;

const aa = extractJobPosting(americanAirlinesShape);
assert.equal(aa.tracking.title, undefined);
assert.equal(aa.tracking.company, "American Airlines");
assert.equal(aa.tracking.location, "DFW Headquarters Building 8 (DFW-SV08)");
assert(!hasPlaceholder(aa.tailoringText, "core responsibilities"));
assert(!hasPlaceholder(aa.tailoringText, "required qualifications"));
assert(!hasPlaceholder(aa.tailoringText, "tech stack or keywords"));
assert.match(aa.tailoringText, /Core Responsibilities:\n- Writes, tests, and documents technical work products/i);
assert.match(aa.tailoringText, /Required Qualifications:\n- Bachelor's degree/i);
assert.match(aa.tailoringText, /Tech Stack \/ Keywords:[\s\S]*JavaScript[\s\S]*Kubernetes[\s\S]*GraphQL/i);
assert.match(aa.tailoringText, /Domain Signals:\n- aviation/i);
assert(!/Cities: Fort Worth - TX|Airline Industry experience/.test(aa.tailoringText.match(/Job Title:\n(.+)/)?.[1] ?? ""));

const normalTitleShape = `
Software Engineer
General Information
Location: Austin, TX
Job Description
What you will do
Build APIs and write automated tests for customer-facing systems.
Required Qualifications
1+ years of experience with JavaScript and REST APIs.
`;

const normal = extractJobPosting(normalTitleShape);
assert.equal(normal.tracking.title, "Software Engineer");
assert.equal(normal.tracking.location, "Austin, TX");

// ATS metadata stack (Starbucks-shaped): bare "Job Category"/"Job Function"
// labels and the values stacked beneath them must not be mistaken for the title;
// a bare "Pay" label feeds the real range, and a "200 hours" count sitting next
// to a "base pay" sentence must NOT bleed in as $200/hr.
const atsMetadataStack = `
software engineer- ST, Seattle, WA
Seattle, Washington, United States
Job ID
260034646
Job Category
Technology
Job Function
Software Engineering
Job Level
Individual Contributor
Pay
111000-185000
Responsibilities
Build and operate reliable services.
You will accrue vacation up to a maximum of 200 hours (316 in CA) for roles at director or above.
The actual base pay offered to the successful candidate depends on many factors.
`;
const ats = extractJobPosting(atsMetadataStack);
assert.equal(ats.tracking.title, undefined); // "Job Category"/"Technology" are not titles
assert.equal(ats.tracking.salaryMin, 111000); // bare "Pay" label → real range
assert.equal(ats.tracking.salaryMax, 185000);
assert.equal(ats.tracking.salaryPeriod, "yr"); // not $200/hr from the vacation-hours bleed

// "Role:" section paragraph (Northwood-shaped): the label heads a prose
// paragraph, not the title — the "As a <Title> at <Company>" sentence recovers
// it; "Basic Qualifications" is a required-quals heading; a bare "Compensation"
// label feeds the range.
const roleSectionParagraph = `
Software Engineer – General (new grad / early career)
Location
Torrance, CA
Compensation
$120K – $140K • Offers Equity
Role:
As a Software Engineer at Northwood, you will be pivotal in designing and optimizing the global service that delivers connectivity to our customers. You will have ownership over key areas.
Basic Qualifications:
0-2 years of professional software development experience.
Completed bachelor's degree in Computer Science or related field.
Preferred Qualifications:
Proficiency in Rust, Golang, or C/C++.
`;
const roleSection = extractJobPosting(roleSectionParagraph);
assert.equal(roleSection.tracking.title, "Software Engineer"); // not the "Role:" paragraph
assert.equal(roleSection.tracking.company, "Northwood");
assert(!hasPlaceholder(roleSection.tailoringText, "required qualifications"));
assert.match(roleSection.tailoringText, /Required Qualifications:\n- 0-2 years/i);
assert.equal(roleSection.tracking.salaryMin, 120000);
assert.equal(roleSection.tracking.salaryMax, 140000);

// Perk dollar figures (Toyota-shaped): "$2,500 training budget", "$6,000
// adoption assistance" carry a currency token but no range/period/comp context —
// they are perks, not compensation, and must not fabricate a salary.
const perksWithDollars = `
Toyota Connected is looking for a Software Engineer to join our Mobility team.
Responsibilities
Write maintainable, tested code and ship features.
Required Qualifications
Experience writing clean, tested code in Java.
What's in it for you?
Annual $2,500 Training Budget to help you grow.
Adoption Assistance of $5,000 for regular adoptions or $6,000 for special needs.
Home office stipend of $1,000 to help furnish a remote office.
`;
const perks = extractJobPosting(perksWithDollars);
assert.equal(perks.tracking.salaryMin, undefined); // no fabricated salary from perks
assert.equal(perks.tracking.salaryMax, undefined);
assert(perks.manualReviewFields.includes("compensation"));
assert.equal(perks.tracking.title, "Software Engineer"); // prose role still recovered

// --- JD-test regression fixtures (distilled from 5 real SWE postings) ---------

// (1a) An explicit early-career body must SUPPRESS a comp-band "Senior <X>"
// title (New York Life "Senior Associate" is a pay grade, not senior IC).
const earlyCareerSeniorBand = `
Senior Associate - Associate Full Stack Engineer
Location
New York, NY
Role Overview
This role is designed for an early-career engineer who wants broad exposure.
Required Qualifications
Proficiency in React and Python.
`;
const ecsb = extractJobPosting(earlyCareerSeniorBand);
assert(!/Seniority Signals:[\s\S]*-\s*senior\b/i.test(ecsb.tailoringText), "comp-band 'Senior' must be suppressed on an early-career role");
assert.match(ecsb.tailoringText, /Seniority Signals:\n- entry-level \/ junior/i);

// (1b) A street address ("...Hoyt Drive") must NOT seed an "ownership" signal,
// and C++ before a comma must be detected.
const addressDrive = `
Software Engineer IT
Location16 Malcolm Hoyt Drive, Newburyport, MA
Responsibilities
Develop, test, and maintain software applications.
Required Qualifications
0-2 years of experience. Proficiency in Python, Java, C#, C++, or JavaScript.
`;
const adrv = extractJobPosting(addressDrive);
assert(!/-\s*ownership\b/.test(adrv.tailoringText), "street 'Drive' must not seed an ownership signal");
assert.match(adrv.tailoringText, /Tech Stack[\s\S]*C\+\+/i, "C++ followed by a comma must be detected");

// (2) A 'Join <Team> as a ...' role-overview line must NOT win company over a
// real 'At <Company>, we' self-cue later in the body.
const joinTeamThenAt = `
Associate Engineer
Join Enterprise Intelligence as an Associate Full Stack Engineer supporting products.
Company Overview
At New York Life, our 180-year legacy fuels our future.
`;
assert.equal(extractJobPosting(joinTeamThenAt).tracking.company, "New York Life");

// (3) 'What you bring' (required) + 'Added bonus if you have' (preferred)
// headings; the 'What we'll bring' benefits section must be excluded.
const bringAndBonus = `
Software Engineer
What you bring
Up to 2 years of software engineering experience.
Basic understanding of RESTful APIs.
Added bonus if you have
Hands-on experience with AWS services like Lambda and S3.
Experience with Infrastructure as Code (Terraform).
What we'll bring
A great benefits package and tuition reimbursement.
`;
const bab = extractJobPosting(bringAndBonus);
assert.match(bab.tailoringText, /Required Qualifications:\n- Up to 2 years/i, "'What you bring' items are required");
assert.match(bab.tailoringText, /Preferred Qualifications:\n- Hands-on experience with AWS/i, "'Added bonus' items are preferred");
assert(!/Preferred Qualifications:\n- Not specified/i.test(bab.tailoringText));
assert(!/benefits package/i.test(bab.tailoringText), "'What we'll bring' benefits must be excluded");

// (4) ALL-CAPS 'YOU MUST HAVE'/'WE VALUE' headings (Honeywell) must not leak as
// bullets; 'WE VALUE' is preferred; Salesforce ecosystem + ALL-CAPS company.
const mustHaveValue = `
Software Engineer I
Qualifications
YOU MUST HAVE
1 year experience with Java, Python, and/or SalesforceDX.
WE VALUE
Experience with AWS cloud services.
SF Lightning Web Components development.
ABOUT HONEYWELL
Honeywell builds technologies that address the world's challenges.
`;
const mhv = extractJobPosting(mustHaveValue);
assert(!/-\s*(YOU MUST HAVE|WE VALUE)\b/.test(mhv.tailoringText), "section labels must not appear as bullets");
assert.match(mhv.tailoringText, /Preferred Qualifications:\n- Experience with AWS/i, "'WE VALUE' items are preferred");
assert(!/Preferred Qualifications:\n- Not specified/i.test(mhv.tailoringText));
assert.match(mhv.tailoringText, /Tech Stack[\s\S]*Salesforce/i, "Salesforce ecosystem must be detected");
assert.equal(mhv.tracking.company, "Honeywell", "ALL-CAPS 'About' heading normalized to title case");

// (5) A prose role with chained recruiter fluff must reduce to the clean title.
const fluffyRole = `
Overview
Toyota Financial Services is seeking a passionate and highly motivated Software Engineer to join our growing technology team.
Required Qualifications
Experience writing clean code in Java.
`;
assert.equal(extractJobPosting(fluffyRole).tracking.title, "Software Engineer", "chained recruiter fluff stripped from prose role");

// (6) A genuine "Senior <X> Engineer" title must keep its "senior" signal even
// when the body mentions mentoring junior/new-grad engineers (review finding 2:
// the senior signal is title-anchored, not body-gated).
const seniorEng = extractJobPosting(`
Senior Backend Engineer
Required Qualifications
6+ years building distributed services. You will mentor new grad and junior developers.
`);
assert.match(seniorEng.tailoringText, /Seniority Signals:[\s\S]*-\s*senior\b/i, "a 'Senior ... Engineer' title keeps 'senior' despite junior/new-grad mentoring copy");

// (7) A benefits section sitting BETWEEN two job-content sections must not
// swallow the preferred section that follows it (review finding 1).
const benefitsMidstream = extractJobPosting(`
Software Engineer
What you bring
Two years of experience with Python.
What we'll bring
A generous benefits package and 401k match.
Nice to have
Experience with Kubernetes and Terraform.
`);
assert.match(benefitsMidstream.tailoringText, /Preferred Qualifications:\n- Experience with Kubernetes/i, "preferred section after a midstream benefits block must survive");
assert(!/benefits package/i.test(benefitsMidstream.tailoringText), "midstream benefits block must still be excluded");

// (8) Docusign-shaped: an intro paragraph + reporting line under "What you'll
// do", a "Job Designation" work-arrangement block, and a duty that merely
// mentions "privacy". Intro/reporting/work-arrangement must NOT be duties; the
// privacy-mentioning duty must survive; quals after the block must survive.
const introAndDesignation = `
Software Engineer
What you'll do
Acme is looking for engineers to join our team and build great things.
This position is an individual contributor role reporting to the Senior Manager.
Responsibility
Build resilient backend services and APIs.
Partner with security, privacy, and compliance teams on data protection.
Job Designation
Hybrid:
Employee divides their time between in-office and remote work.
What you bring
Two years of experience with Go.
`;
const iad = extractJobPosting(introAndDesignation);
assert(!/-\s*Acme is looking for/i.test(iad.tailoringText), "recruiter-intro line must not be a responsibility bullet");
assert(!/-\s*This position is an individual contributor/i.test(iad.tailoringText), "reporting-structure line must not be a responsibility bullet");
assert(!/Employee divides their time/i.test(iad.tailoringText), "work-arrangement block must be excluded");
assert.match(iad.tailoringText, /-\s*Partner with security, privacy/i, "a duty merely mentioning 'privacy' must survive");
assert.match(iad.tailoringText, /Required Qualifications:[\s\S]*Two years of experience with Go/i, "quals after the work-arrangement block must survive");

// (9) Salary edge cases: non-USD currency preserved (not fabricated as USD) and
// its range kept; "up to $X" reported as ceiling; hourly; non-pay numbers ignored.
const gbp = extractJobPosting(`Software Engineer\nSalary: £55,000 - £75,000 per year\nQualifications\nPython.`).tracking;
assert.equal(gbp.salaryMin, 55000); assert.equal(gbp.salaryMax, 75000); assert.equal(gbp.salaryCurrency, "GBP");
const upto = extractJobPosting(`Software Engineer\nThe base salary is up to $200,000 depending on experience.\nQualifications\nGo.`).tracking;
assert.equal(upto.salaryMin, null, "'up to $X' must report X as the ceiling, not the floor"); assert.equal(upto.salaryMax, 200000);
const hourly = extractJobPosting(`Support Engineer\nCompensation: $45.00 - $60.00 per hour\nQualifications\nLinux.`).tracking;
assert.equal(hourly.salaryMin, 45); assert.equal(hourly.salaryMax, 60); assert.equal(hourly.salaryPeriod, "hr");
const nonpay = extractJobPosting(`Software Engineer\nQualifications\n3 years experience.\nBenefits\n401(k) with match. Over 10,000 employees. Founded in 1998.`);
assert.equal(nonpay.tracking.salaryMin, undefined, "401k/employee-count/founding-year are not salary");
assert(nonpay.manualReviewFields.includes("compensation"));

// (10) Seniority: staff/principal levels + intern (title-anchored).
assert.match(extractJobPosting(`Staff Software Engineer\nQualifications\n10 years experience.`).tailoringText, /Seniority Signals:[\s\S]*staff-level/i);
assert.match(extractJobPosting(`Principal Engineer\nQualifications\n12 years experience.`).tailoringText, /Seniority Signals:[\s\S]*principal-level/i);
assert.match(extractJobPosting(`Principal Full Stack Software Engineer\nQualifications\n12 years experience.`).tailoringText, /Seniority Signals:[\s\S]*principal-level/i);
assert.match(extractJobPosting(`Staff Front End Software Engineer\nQualifications\n10 years experience.`).tailoringText, /Seniority Signals:[\s\S]*staff-level/i);
assert.match(extractJobPosting(`Distinguished Machine Learning Software Engineer\nQualifications\n12 years experience.`).tailoringText, /Seniority Signals:[\s\S]*distinguished-level/i);
assert.match(extractJobPosting(`Software Engineering Intern\nQualifications\nPursuing a BS in Computer Science.`).tailoringText, /Seniority Signals:[\s\S]*-\s*intern\b/i);

// (11) Expanded tech coverage; Must-haves/Nice-to-haves buckets; Locations
// plural label; recruiting-prefix stripped from title.
assert.match(extractJobPosting(`Software Engineer\nQualifications\nRust, Kotlin, Swift, Scala, .NET, Spring Boot, Django, Angular, Kafka, Terraform.`).tailoringText, /Rust[\s\S]*Kotlin[\s\S]*\.NET[\s\S]*Django[\s\S]*Terraform/i);
const mh = extractJobPosting(`Software Engineer\nMust-haves\n3 years of Python.\nNice-to-haves\nKubernetes experience.`).tailoringText;
assert.match(mh, /Required Qualifications:\n- 3 years of Python/i);
assert.match(mh, /Preferred Qualifications:\n- Kubernetes experience/i);
assert.equal(extractJobPosting(`Software Engineer\nLocations: San Francisco, CA; New York, NY; or Remote\nQualifications\nReact.`).tracking.location, "San Francisco, CA; New York, NY; or Remote");
assert.equal(extractJobPosting(`Now Hiring: Senior Backend Engineer\nResponsibilities\nDesign services.\nQualifications\n8 years experience.`).tracking.title, "Senior Backend Engineer");

// (12) Code-review-fix regressions: "You have <X>" / "Must have <X>" are
// requirement BULLETS, not headings, so they must survive collection.
const youHaveBullets = extractJobPosting(`Software Engineer\nRequirements\nYou have 5+ years of Python experience.\nYou'll have ownership of the platform.\nMust have strong communication skills.`).tailoringText;
assert.match(youHaveBullets, /-\s*You have 5\+ years of Python/i, "'You have <X>' must stay a requirement bullet");
assert.match(youHaveBullets, /-\s*Must have strong communication/i, "'Must have <X>' must stay a requirement bullet");

// (13) Tech keywords must not fabricate from English prose / page furniture.
const techProse = extractJobPosting(`Software Engineer\nResponsibilities\nWe want people who spark new ideas and provide swift support to customers.\nApply at careers.contoso.net for this role.\nQualifications\nPython.`).tailoringText;
assert(!/-\s*Spark\b/.test(techProse), "'spark new ideas' must not fabricate Apache Spark");
assert(!/-\s*Swift\b/.test(techProse), "'swift support' must not fabricate Swift");
assert(!/-\s*\.NET\b/.test(techProse), "a '.net' domain must not fabricate .NET");

// (14) A bare year on a comp-context line is not a salary.
const yearSalary = extractJobPosting(`Software Engineer\nThe salary is competitive; we were founded in 2015.\nQualifications\nGo.`).tracking;
assert.equal(yearSalary.salaryMin, undefined, "a bare year on a comp-context line must not be reported as salary");
assert.equal(yearSalary.salaryMax, undefined);

// (15) Same-line section labels must preserve the value after the colon. These
// are common in compact ATS text; treating the whole line as only a heading
// drops the actual duty/requirement.
const inlineSections = extractJobPosting(`
Software Engineer
Responsibilities: Build resilient APIs for customer workflows.
Requirements: 3+ years of Python experience.
Preferred Qualifications: Experience with Kubernetes.
`).tailoringText;
assert.match(inlineSections, /Core Responsibilities:\n- Build resilient APIs/i, "inline Responsibilities value must survive");
assert.match(inlineSections, /Required Qualifications:\n- 3\+ years of Python/i, "inline Requirements value must survive");
assert.match(inlineSections, /Preferred Qualifications:\n- Experience with Kubernetes/i, "inline Preferred Qualifications value must survive");

// (16) Currency codes near the amount must be preserved just like symbols; do
// not silently fabricate USD for Canadian/Australian/European/Japanese ranges.
const cad = extractJobPosting(`Software Engineer\nSalary: CAD 120,000 - 140,000 per year\nQualifications\nPython.`).tracking;
assert.equal(cad.salaryMin, 120000); assert.equal(cad.salaryMax, 140000); assert.equal(cad.salaryCurrency, "CAD");
const eur = extractJobPosting(`Software Engineer\nCompensation: EUR 70,000 to EUR 90,000 annually\nQualifications\nPython.`).tracking;
assert.equal(eur.salaryMin, 70000); assert.equal(eur.salaryMax, 90000); assert.equal(eur.salaryCurrency, "EUR");

// (17) Bare "go" as an English verb must not fabricate the Go language, while
// normal language contexts still surface it.
const goVerb = extractJobPosting(`Software Engineer\nResponsibilities\nGo above and beyond for customers.\nQualifications\nPython.`).tailoringText;
assert(!/-\s*Go\b/.test(sectionBody(goVerb, "Tech Stack / Keywords", "Seniority Signals")), "go above and beyond must not fabricate Go");
assert.match(extractJobPosting(`Software Engineer\nQualifications\nExperience with Go and Python.`).tailoringText, /Tech Stack[\s\S]*Go/i, "language-shaped Go context must still be detected");
assert.match(extractJobPosting(`Software Engineer\nQualifications\nRust, Go, and Python.`).tailoringText, /Tech Stack[\s\S]*Go/i, "comma-list Go context must still be detected");
assert.match(extractJobPosting(`Software Engineer\nQualifications\nGo programming experience and Python.`).tailoringText, /Tech Stack[\s\S]*Go/i, "Go programming context must be detected");
assert.match(extractJobPosting(`Software Engineer\nQualifications\nExperience building Go services and Python APIs.`).tailoringText, /Tech Stack[\s\S]*Go/i, "Go services context must be detected");

// (15) Round-3 code-review-fix regressions.
// A "Bonus"/"Plus" line INSIDE a skipped benefits block must not re-open it.
const benefitsLeak = extractJobPosting(`Software Engineer\nWhat you bring\nTwo years of Python experience.\nWhat we'll bring\nBonus potential up to 15% of base.\nPlus generous PTO and a 401k match.\nQualifications\nSQL experience.`).tailoringText;
assert(!/Bonus potential|generous PTO/i.test(benefitsLeak), "a 'Bonus'/'Plus' line inside a benefits block must not re-open it");
assert.match(benefitsLeak, /Required Qualifications:[\s\S]*SQL experience/i, "a real section after a benefits block still re-opens");

// ".NET" with a slash delimiter ("C#/.NET") is detected; a ".net" domain is not.
assert.match(extractJobPosting(`Software Engineer\nQualifications\nExperience in C#/.NET and SQL.`).tailoringText, /Tech Stack[\s\S]*\.NET/i, "'C#/.NET' must detect .NET");

// A real duty containing "is looking for" must survive (not dropped as intro noise).
assert.match(extractJobPosting(`Product Engineer\nWhat you'll do\nDefine what the business is looking for and translate it into specs.\nShip features end to end.\nQualifications\nPython.`).tailoringText, /-\s*Define what the business is looking for/i, "a duty containing 'is looking for' must survive");

// "snowflake schema" (a data-modeling term) must not fabricate the Snowflake product.
assert(!/Tech Stack[\s\S]*Snowflake/i.test(extractJobPosting(`Data Engineer\nQualifications\nDesign a snowflake schema in Redshift.`).tailoringText), "'snowflake schema' must not fabricate Snowflake");

// A currency token glued inside a word must not be read as a foreign currency.
assert.notEqual(extractJobPosting(`Software Engineer\nThe salary range is ABC$120,000 - ABC$150,000.\nQualifications\nGo.`).tracking.salaryCurrency, "CAD", "'C$' glued inside a word must not be read as CAD");

// A counted quantity on a comp-context line is not a salary.
assert.equal(extractJobPosting(`Software Engineer\nWe offer a competitive salary and have 5,000 customers.\nQualifications\nGo.`).tracking.salaryMin, undefined, "'5,000 customers' must not be read as salary");

console.log("jobExtract evals passed");
