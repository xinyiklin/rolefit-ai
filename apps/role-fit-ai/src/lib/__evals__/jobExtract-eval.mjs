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

const { extractJobPosting, extractKnownTechKeywords } = await loadJobExtract();

assert.deepEqual(
  extractKnownTechKeywords("Required: Python, TypeScript, React, Next.js, SQL, AWS, and modern LLMs."),
  ["TypeScript", "React", "Next.js", "Python", "SQL", "AWS", "LLMs"],
  "shared technology recognizer keeps the Brellium stack, including Next.js and LLMs"
);

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

// (16) JD-corpus hardening regressions (real-posting failure modes).

// Anti-fab: "401k plan" must not be read as a $401,000 salary, even when the
// benefits paragraph also says "compensation".
assert.equal(
  extractJobPosting(`Software Engineer\nAcme\n\nBenefits\nWe offer competitive compensation and a 401k plan to teammates.\nQualifications\nPython.`).tracking.salaryMin,
  undefined,
  "'401k plan' must not be read as a $401,000 salary"
);

// Anti-fab: "20 hours or more per week" must not be read as $20/hr.
assert.equal(
  extractJobPosting(`Software Engineer\nAcme\n\nBenefits\nTeammates working 20 hours or more per week are eligible for compensation and benefits.\nQualifications\nPython.`).tracking.salaryMin,
  undefined,
  "'20 hours or more per week' must not fabricate $20/hr"
);

// Salary: shared-k range "$120-150k" scales BOTH numbers.
const sharedK = extractJobPosting(`Software Engineer\nAcme\n\nCompensation\nThe pay range is $120-150k per year.\nQualifications\nPython.`).tracking;
assert.equal(sharedK.salaryMin, 120000, "shared-k range min must be propagated");
assert.equal(sharedK.salaryMax, 150000, "shared-k range max");

// Salary: a "$X/yr - $Y/yr" range parses as one range (floor < ceiling), not two
// lone candidates whose sort reports the ceiling as the floor.
const splitRange = extractJobPosting(`Software Engineer\nAcme\n\nBase pay range\n$71,100.00/yr - $127,000.00/yr\nQualifications\nPython.`).tracking;
assert.equal(splitRange.salaryMin, 71100, "split /yr range floor");
assert.equal(splitRange.salaryMax, 127000, "split /yr range ceiling");

// Anti-fab: LinkedIn AI-assistant chrome must not fabricate an "AI" tech keyword.
const aiChrome = extractJobPosting(`Software Engineer\nAcme\n\nUse AI to assess how you fit\nGet AI-powered advice\nResponsibilities\nBuild web apps with React.\nQualifications\nJavaScript.`).tailoringText;
assert(!/Tech Stack \/ Keywords:[\s\S]*\bAI\b/.test(aiChrome), "LinkedIn AI chrome must not fabricate an AI tech keyword");

// Anti-fab: the company name token "Visa" must not be read as a work-auth need.
assert.equal(
  extractJobPosting(`Software Engineer\nVisa\n\nResponsibilities\nBuild payment systems.\nVisa requires at least 3 days in office.\nQualifications\nJava.`).tracking.workAuth,
  undefined,
  "company name 'Visa' must not be read as a work-auth requirement"
);

// Seniority: mentee/possessive copy must not over-tag leadership/ownership, but a
// real people-management cue still does.
const noLead = sectionBody(
  extractJobPosting(`Software Engineer\nAcme\n\nResponsibilities\nYou will be paired with a mentor.\nWork on your own technical tasks.\nQualifications\nPython.`).tailoringText,
  "Seniority Signals",
  "Domain Signals"
);
assert(!/leadership/i.test(noLead), "'paired with a mentor' must not tag leadership");
assert(!/ownership/i.test(noLead), "'your own technical tasks' must not tag ownership");
assert.match(
  sectionBody(extractJobPosting(`Engineering Manager\nAcme\n\nResponsibilities\nLead a team of engineers.\nQualifications\nPython.`).tailoringText, "Seniority Signals", "Domain Signals"),
  /leadership/i,
  "'lead a team of engineers' must tag leadership"
);

// uniqueItems must not amputate a real leading word that happens to be a label.
assert.match(
  extractJobPosting(`Software Engineer\nAcme\n\nResponsibilities\nSkills to address straightforward problems independently.\nQualifications\nPython.`).tailoringText,
  /Skills to address straightforward problems/i,
  "'Skills to address...' must keep its leading word"
);

// Title: a comma-bearing title is kept; the stacked header yields location+company.
const stacked = extractJobPosting(`Software Engineer, Safety\nMountain View, CA\nWaymo\n\nResponsibilities\nBuild safety-critical systems.\nDesign test harnesses.\nReview code.\nQualifications\n5 years of Python.\nStrong CS fundamentals.\nAbout the team\nWaymo builds autonomous driving technology.`).tracking;
assert.equal(stacked.title, "Software Engineer, Safety", "comma-bearing title must be kept");
assert.equal(stacked.location, "Mountain View, CA", "stacked-header location must be read");
assert.equal(stacked.company, "Waymo", "stacked-header company (body-echo gated) must be read");

// A prose "Location:" sentence must be rejected (not stored as the location).
assert.equal(
  extractJobPosting(`Software Engineer\nAcme\n\nLocation: This role is hybrid (3-4 days a week in our main office).\nResponsibilities\nBuild things.\nQualifications\nPython.`).tracking.location,
  undefined,
  "a prose 'Location:' sentence must not be stored as the location"
);

// LinkedIn "apply for the <Title> role at <Company>" names the employer verbatim.
assert.equal(
  extractJobPosting(`Software Engineer\nNew York, NY\n\nJoin to apply for the Software Engineer role at Datadog\nResponsibilities\nBuild monitoring.\nQualifications\nGo.\nDatadog builds monitoring tools.`).tracking.company,
  "Datadog",
  "LinkedIn 'apply for the X role at Y' must set company"
);

// Heading coverage: new section variants route to the correct buckets.
const headings = extractJobPosting(`Software Engineer\nAcme\n\nEssential Duties and Responsibilities\nWrite clean code.\nReview pull requests.\nCore Qualifications\n3 years of Java.\nStrong CS fundamentals.`).tailoringText;
assert.match(headings, /Core Responsibilities:[\s\S]*Write clean code/i, "'Essential Duties and Responsibilities' collected as responsibilities");
assert.match(headings, /Required Qualifications:[\s\S]*3 years of Java/i, "'Core Qualifications' collected as required qualifications");

// Anti-fab (review HIGH-1): a comma-bearing title must NOT be read as a location
// (the 2-letter tail is restricted to real US state codes, and the location reader
// skips the title and role-noun lines).
const commaTitleNoLoc = extractJobPosting(`Senior Engineer, AI\nAcme\n\nResponsibilities\nBuild ML systems.\nQualifications\nPython.`).tracking;
assert.equal(commaTitleNoLoc.location, undefined, "'Senior Engineer, AI' must not be read as a location");

// Anti-fab (review HIGH-2): a product/partner named in the header and echoed in the
// duties must NOT be mistaken for the employer (echo gate requires a self-cue).
const productNotCompany = extractJobPosting(`Software Engineer\nPhotoshop\n\nResponsibilities\nYou will work on Photoshop daily.\nIntegrate with Salesforce for CRM.\nQualifications\nJava.`).tracking;
assert.notEqual(productNotCompany.company, "Photoshop", "a product the role builds must not be the company");
assert.notEqual(productNotCompany.company, "Salesforce", "a partner the role integrates with must not be the company");
// Exercise the echo-gate path directly: a bare "<product> is …" sentence must NOT
// qualify the product as the employer (review HIGH — plain copula self-cue).
const productIsCue = extractJobPosting(`Software Engineer\nPhotoshop\n\nResponsibilities\nBuild plugins.\nPhotoshop is the primary tool for this role and Salesforce is the CRM we use.\nQualifications\nJava.`).tracking;
assert.notEqual(productIsCue.company, "Photoshop", "'Photoshop is the primary tool' must not make Photoshop the company");
assert.notEqual(productIsCue.company, "Salesforce", "'Salesforce is the CRM' must not make Salesforce the company");

// Anti-fab (review MED-1): a one-comma prose intro must NOT be accepted as a title.
const proseNotTitle = extractJobPosting(`At Acme, we build great software\nResponsibilities\nShip features.\nAt Acme, we build great software\nQualifications\nGo.`).tracking;
assert.notEqual(proseNotTitle.title, "At Acme, we build great software", "a prose intro must not be read as a title");

// Recall (review LOW-3): a real visa requirement is still captured as workAuth.
assert.match(
  extractJobPosting(`Software Engineer\nAcme\n\nRequirements\nCandidates must hold a valid work visa.\nProficiency in Python.`).tracking.workAuth ?? "",
  /visa/i,
  "a real 'must hold a valid work visa' requirement must be captured"
);

// camelCase company brands ("iHeartMedia") are plausible employers.
assert.equal(
  extractJobPosting(`Software Engineer\nNew York, NY\n\nJoin to apply for the Software Engineer role at iHeartMedia\nResponsibilities\nBuild streaming features.\nQualifications\nJava development.`).tracking.company,
  "iHeartMedia",
  "camelCase company brand must be accepted"
);

// (17) Findings from REAL extension-captured Workday JDs (Salesforce, Cox).

// Anti-fab: a sentence-final salary "$74,000.00 - $111,000.00." must parse as the
// real range, not collapse to a $0 floor (trailing "." → NaN → 0 bug).
const sentenceSalary = extractJobPosting(`Software Engineer\nAcme\n\nCompensation:\nCompensation includes a base salary in the range of $74,000.00 - $111,000.00. The base salary may vary.\nQualifications\nPython.`).tracking;
assert.equal(sentenceSalary.salaryMin, 74000, "sentence-final salary floor must be 74000, not 0");
assert.equal(sentenceSalary.salaryMax, 111000, "sentence-final salary ceiling must be 111000");

// Workday screen-reader suffix "<title> page is loaded" must be stripped.
assert.equal(
  extractJobPosting(`Software Engineering AMTS (College Grad) page is loaded\nSalesforce\n\nResponsibilities\nBuild products.\nQualifications\nJava.\nSalesforce is the #1 AI CRM.`).tracking.title,
  "Software Engineering AMTS (College Grad)",
  "Workday 'page is loaded' suffix must be stripped from the title"
);

// Salesforce-style headings route correctly; the benefits/footer closers do not
// leak into responsibilities/quals.
const sf = extractJobPosting(`Software Engineer\nSalesforce\n\nWhat You'll Actually Be Doing\nArchitect and deliver scalable products.\nDevelop test automation frameworks.\nYou're Our Person If\nStrong background in Computer Science.\nEven Better If\nExperience with large language models.\nUnleash Your Potential\nWhen you join Salesforce you will be limitless.\nAccommodations\nIf you need a reasonable accommodation, submit a request.\nPosting Statement\nSalesforce is an equal opportunity employer.`).tailoringText;
assert.match(sf, /Core Responsibilities:[\s\S]*Architect and deliver scalable products/i, "'What You'll Actually Be Doing' collected as responsibilities");
assert.match(sf, /Required Qualifications:[\s\S]*Strong background in Computer Science/i, "'You're Our Person If' collected as required");
assert(!/reasonable accommodation|equal opportunity employer|be limitless/i.test(sf), "benefits/accommodations/posting-statement footer must not leak into tailoring");

// (18) Careers-site pages (extension body.innerText fallback): a leading nav block
// must not become the title, the main role (first role-shaped line) must beat a
// later related-jobs entry, and nav/CTA furniture must not pass as company/location.
const careers = extractJobPosting(`Skip to main content
Jobs
Dashboard
Sign in
Join Our Talent Community
Single Position
View All Jobs
Senior Data Engineer
Austin, TX
Apply Now
Add to cart
Job description
Acme Corp is a leading data analytics company.
Responsibilities
Build and operate data pipelines.
Qualifications
5 years of SQL experience.
Sr Manager, Marketing Operations
Apply Now`);
assert.equal(careers.tracking.title, "Senior Data Engineer", "title from top-down role-shaped scan, not nav chrome or a related job");
assert.equal(careers.tracking.company, "Acme Corp", "company from self-cue, not the 'Join Our Talent Community' nav");
assert.notEqual(careers.tracking.company, "Our Talent Community", "'Join Our Talent Community' must not be the company");

// Anti-fab (review BLOCKER): a nav PROFESSION category ("Engineering", "Sales
// Engineering") must not be read as the title — the real role (agent role noun,
// 2+ words) must win even when categories appear first.
const navCategory = extractJobPosting(`Skip to content\nCareers\nProfessions\nEngineering\nSales Engineering\nSoftware Development Engineer II\nSeattle, WA\nApply Now\nJob Description\nBuild services.\nResponsibilities\nDesign systems.\nQualifications\nJava.`).tracking;
assert.equal(navCategory.title, "Software Development Engineer II", "nav profession category must not be the title");

// An apply-button label stacked under a "Job Location" label is not a location.
const srLoc = extractJobPosting(`Software Engineer\nAcme\n\nJob Location\nI'm interested\nResponsibilities\nBuild things.\nQualifications\nPython.\nAcme is a software company.`).tracking;
assert.notEqual(srLoc.location, "I'm interested", "apply-button text must not be stored as the location");

// "Position ID:" / "Req #" metadata lines must not be taken as the title.
const reqMeta = extractJobPosting(`Skip to main content\nPosition ID: J0526-2196\nReq #363\nFull Stack Developer\nApply Now\nResponsibilities\nBuild.\nQualifications\nJavaScript.`).tracking;
assert.equal(reqMeta.title, "Full Stack Developer", "a req-id/position-id line must not be the title");

// (19) Tailoring-BODY quality (the part that drives resume tailoring/review).

// "What You Have" heads qualifications — must not leak into responsibilities.
const whatYouHave = extractJobPosting(`Software Engineer\nAcme\n\nWhat You'll Do\nBuild scalable services.\nShip features end to end.\nWhat You Have\n3 years of backend experience.\nProficiency in Python and SQL.`).tailoringText;
const wyhResp = (whatYouHave.match(/Core Responsibilities:\n([\s\S]*?)\n\nRequired/) || [])[1] || "";
const wyhReq = (whatYouHave.match(/Required Qualifications:\n([\s\S]*?)\n\nPreferred/) || [])[1] || "";
assert(/Build scalable services/i.test(wyhResp), "duties stay under responsibilities");
assert(/3 years of backend experience/i.test(wyhReq), "'What You Have' routes to required qualifications");
assert(!/3 years of backend experience/i.test(wyhResp), "quals must not leak into responsibilities");

// Intro/marketing prose and policy boilerplate must NOT land as qualifications —
// including via the keyword-sweep fallback (a JD with no Requirements heading).
const coxLike = extractJobPosting(`Software Engineer\nAcme\n\nJob Overview\nAs a Software Engineer you will apply your knowledge of modern software design and frameworks.\nResponsibilities\nWrite clean code.\nUnderstanding of databases.\n18 months experience in Java.\nDrug Testing\nTo be employed in this role, you will need to clear a pre-employment drug test.\nThe City is an Equal Opportunity employer.`).tailoringText;
const coxReq = (coxLike.match(/Required Qualifications:\n([\s\S]*?)\n\nPreferred/) || [])[1] || "";
// Note: a generic "As a <role> you will…" intro is NOT filtered — distinguishing it
// from a real "As an engineer you will build X" duty is unreliable, and dropping
// real duties hurts tailoring worse than a stray intro line (review HIGH).
assert(!/clear a pre-employment drug test/i.test(coxReq), "'pre-employment drug test' policy must not be a qualification");
assert(!/equal opportunity/i.test(coxReq), "EEO-employer boilerplate must not be a qualification");
// Real domain content using those keywords must SURVIVE (no over-filter).
const domainKeep = extractJobPosting(`Software Engineer\nAcme\n\nResponsibilities\nDevelop drug screening assays for the discovery team.\nBuild background screening integrations for the HR platform.\nChampion equal opportunity initiatives across hiring.\nQualifications\nPython.`).tailoringText;
const dkResp = (domainKeep.match(/Core Responsibilities:\n([\s\S]*?)\n\nRequired/) || [])[1] || "";
assert(/drug screening assays/i.test(dkResp), "real 'drug screening assays' duty must survive");
assert(/background screening integrations/i.test(dkResp), "real 'background screening integrations' duty must survive");
assert(/equal opportunity initiatives/i.test(dkResp), "real 'equal opportunity initiatives' duty must survive");

// A product blurb sitting in the intro (not under a quals heading) must not be
// pulled into the qualifications — the "What You Have" heading scopes the quals.
const teamBlurb = extractJobPosting(`Software Engineer\nCommure\n\nThe Revenue Cycle Team at Commure powers practices everywhere.\nWhat You Have\n3 years of full-stack experience.\nProficiency in React and Python.`).tailoringText;
const tbReq = (teamBlurb.match(/Required Qualifications:\n([\s\S]*?)\n\nPreferred/) || [])[1] || "";
assert(!/Team at Commure powers/i.test(tbReq), "an intro product blurb must not be a qualification");
assert(/3 years of full-stack experience/i.test(tbReq), "the real qualification is retained");

// A "Section N:" numbering prefix on real headings must not block the match.
const sectioned = extractJobPosting(`Software Engineer\nAcme\n\nSection 1: Position Summary\nWe build great software.\nSection 2: Job Functions, Essential Duties and Responsibilities\nAnalyze, implement and maintain software applications.\nAssist in planning across the SDLC.\nSection 3: Experience, Skills, Knowledge Requirements\nUp to two years of professional software experience.\nUnderstanding of data structures and algorithms.`).tailoringText;
assert.match(sectioned, /Core Responsibilities:[\s\S]*Analyze, implement and maintain/i, "'Section 2: …Duties and Responsibilities' routes to responsibilities");
assert.match(sectioned, /Required Qualifications:[\s\S]*two years of professional software experience/i, "'Section 3: Experience, Skills, Knowledge Requirements' routes to required");

// Inline "Duties: A. B. C." prose (no bullets) must split into separate duties,
// and an inline "Skills Required: …" must be captured as a qualification.
const inlineProse = extractJobPosting(`Software Engineer\nAcme\n\nDESCRIPTION:\nDuties: Design, develop and implement scalable software solutions across the stack. Solve complex business problems through innovation and sound engineering practices. Troubleshoot and resolve application code-related issues in production.\nQUALIFICATIONS:\nSkills Required: This position requires experience with Java and Python for backend services.`).tailoringText;
const ipResp = (inlineProse.match(/Core Responsibilities:\n([\s\S]*?)\n\nRequired/) || [])[1] || "";
assert(/Design, develop and implement scalable software solutions/i.test(ipResp), "inline 'Duties:' prose split — duty 1");
assert(/Solve complex business problems/i.test(ipResp), "inline 'Duties:' prose split — duty 2");
assert((ipResp.match(/^- /gm) || []).length >= 3, "inline 'Duties:' prose splits into >=3 duties, not one blob");
assert(/Required Qualifications:[\s\S]*experience with Java and Python/i.test(inlineProse), "inline 'Skills Required:' captured as a qualification");

// Application-process boilerplate (video interview / how to prepare) is not a qual.
const apptNoise = extractJobPosting(`Software Engineer\nAcme\n\nQualifications\n3 years of Python.\nQualified candidates must complete a video interview assessment after applying.\nHow to prepare: Set aside 40-45 minutes for the self-guided assessment.`).tailoringText;
const anReq = (apptNoise.match(/Required Qualifications:\n([\s\S]*?)\n\nPreferred/) || [])[1] || "";
assert(/3 years of Python/i.test(anReq), "the real qualification is kept");
assert(!/video interview|how to prepare|set aside/i.test(anReq), "application-process boilerplate must not be a qualification");

// "Do you qualify? You likely do if you have…" heads qualifications (SkillStorm).
const doYouQualify = extractJobPosting(`Software Engineer\nAcme\n\nWhat you'll do:\nBuild internal tools.\nDo you qualify? You likely do if you have one of the following:\nA bachelor's degree in a technical field.\nAt least one year of professional experience.`).tailoringText;
assert.match(doYouQualify, /Required Qualifications:[\s\S]*bachelor's degree in a technical field/i, "'Do you qualify?' routes to required qualifications");

console.log("jobExtract evals passed");
