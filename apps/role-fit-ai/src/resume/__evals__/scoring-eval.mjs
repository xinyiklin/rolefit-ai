// Offline probes for the scorer (scoring.ts). Before this, every recalibrated
// constant — the concision threshold, the rubric weights, and the corpus
// calibration affine — was unlocked, so a future edit could silently regress the
// local-vs-AI calibration the eval corpus was used to tune. These probes pin the
// load-bearing behaviors with synthetic inputs (no private corpus).
//
//   node src/resume/__evals__/scoring-eval.mjs
//
// scoring.ts imports ./keywords + ./text, so it must be BUNDLED before import.

import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

async function load() {
  const entry = fileURLToPath(new URL("../scoring.ts", import.meta.url));
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent"
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { analyzeResumeText } = await load();
const sc = (resume, job) => analyzeResumeText(resume, job).score;
const finite = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
const allFinite = (s) => Object.values(s).every(finite);

const JOB = ["Tech Stack / Keywords:", "- React", "- TypeScript", "- Node.js", "- REST API", "- testing", "- git", "Seniority Signals:", "- entry-level"].join("\n");

const shortBullets = [
  "Jane Dev",
  "jane@example.com | github.com/jane",
  "",
  "SUMMARY",
  "Frontend-leaning full-stack engineer.",
  "",
  "EXPERIENCE",
  "Acme | Software Engineer | 2023-2025",
  "- Built React and TypeScript dashboards used by 2,000 internal users",
  "- Developed REST APIs in Node.js and added testing across the service",
  "- Improved git-based code review turnaround by 30 percent",
  "",
  "SKILLS",
  "Languages: TypeScript, JavaScript",
  "",
  "EDUCATION",
  "State University | BS Computer Science | 2019-2023"
].join("\n");

// Same resume but every bullet padded well past the 210-char concision threshold.
const pad = " and this clause keeps going well past any reasonable bullet length to exceed the two-hundred-ten character concision threshold by a comfortable margin indeed truly";
const longBullets = shortBullets
  .split("\n")
  .map((l) => (/^- /.test(l) ? l + pad : l))
  .join("\n");

const weakResume = [
  "Pat Doe",
  "pat@example.com",
  "",
  "EXPERIENCE",
  "Diner | Server | 2021-2023",
  "- Took orders and carried plates to tables during busy shifts",
  "",
  "EDUCATION",
  "Community College | AA | 2019-2021"
].join("\n");

const seniorJob = ["Senior Staff Software Engineer", "Requirements", "- 8+ years of professional software engineering experience required", "- React, TypeScript, Node.js"].join("\n");

// Same content, but bullets use a copy-paste "●" glyph instead of "-".
const dotBullets = shortBullets.split("\n").map((l) => (/^- /.test(l) ? l.replace(/^- /, "● ") : l)).join("\n");

// Recent short experience, but with OLD academic dates under a non-"Education"
// header ("Academic Background") that must not leak into years-of-experience.
const academicResume = [
  "Pat Doe",
  "pat@example.com",
  "",
  "EXPERIENCE",
  "Acme | Software Engineer | 2023-2025",
  "- Built React services for the internal platform used across the org",
  "",
  "ACADEMIC BACKGROUND",
  "State University | BS Computer Science | 2016-2020"
].join("\n");

// Education FIRST, then a non-standard experience header ("Employment History"):
// the variant header must clear the education state so real senior experience is
// still counted (regression guard — masking real years tanks a true senior fit).
const educationFirstResume = [
  "Sam Lee",
  "sam@example.com",
  "",
  "ACADEMIC BACKGROUND",
  "State University | BS Computer Science | 2016-2020",
  "",
  "EMPLOYMENT HISTORY",
  "BigCo | Senior Software Engineer | 2012-2024",
  "- Built and scaled React + Node.js platforms used across the org",
  "- Led REST API design and testing for the payments service"
].join("\n");

// New-grad (one year of real dates) whose bullet contains a 4-digit METRIC
// ("2000 users") that must NOT be read as a calendar year (which would inflate
// seniority and clear a senior bar).
const metricResume = [
  "Sam New",
  "sam@example.com",
  "",
  "EXPERIENCE",
  "Acme | Software Engineer | 2024-2025",
  "- Built a dashboard used by 2000 internal users that cut load time 40 percent",
  "",
  "EDUCATION",
  "State University | BS Computer Science | 2024"
].join("\n");

// An Education-internal sub-header ("Coursework") with OLD dates must NOT clear the
// education shield and leak degree-era years into experience (would inflate seniority).
const eduSubHeaderResume = ["Pat New", "p@x.com", "", "EXPERIENCE", "Acme | Software Engineer | 2024-2025", "- Built React apps", "", "EDUCATION", "State University | BS CS | 2020-2024", "Coursework", "Algorithms and Data Structures 2014-2017"].join("\n");
// A verb that merely starts with a month prefix ("marketed") or the modal "may",
// followed by a 4-digit metric, must NOT be read as a calendar year.
const verbMetricResume = ["Pat New", "p@x.com", "", "EXPERIENCE", "Acme | Software Engineer | 2024-2025", "- marketed to 2000 users; some records may 2015 predate the migration"].join("\n");
// MM/YYYY and month-prefixed ranges MUST be credited as real tenure.
const mmYyyyResume = ["Sr Dev", "s@x.com", "", "EXPERIENCE", "BigCo | Senior Software Engineer | 01/2016 - 06/2024", "- Led React and Node.js platforms across the org"].join("\n");
// BARE single years in a "Company | Title | YYYY" column (no range) MUST be credited
// — but a bullet metric ("2000 users") on the same resume must NOT inflate.
const bareYearResume = ["Sr Dev", "s@x.com", "", "EXPERIENCE", "BigCo | Senior Software Engineer | 2016", "- Scaled a platform used by 2000 users daily", "OldCo | Software Engineer | 2024", "- Built React services"].join("\n");

const strong = sc(shortBullets, JOB);
const dot = sc(dotBullets, JOB);
const long = sc(longBullets, JOB);
const weak = sc(weakResume, JOB);
const seniorFit = sc(shortBullets, seniorJob);
const academicSenior = sc(academicResume, seniorJob);

const checks = [
  // concision is revived (was a constant 35 for every resume before the fix)
  ["concision is not the old constant floor 35", strong.concision > 35],
  ["short clean bullets score high concision (>=90)", strong.concision >= 90],
  ["padded over-long bullets score lower concision than short ones", long.concision < strong.concision],

  // calibration: a well-matched, metric-rich resume reaches a meaningful band,
  // and clearly beats a weak/irrelevant one (rank order holds).
  ["strong matched resume reaches >= REASONABLE-adjacent (>=68)", strong.overall >= 68],
  ["strong resume clearly outscores a weak/irrelevant one", strong.overall - weak.overall >= 20],
  ["weak/irrelevant resume stays out of strong-fit territory (<70)", weak.overall < 70],

  // seniority guardrail still caps a no-experience resume against a senior bar
  ["senior-bar role caps the early-career resume below REASONABLE (<70)", seniorFit.overall < 70],

  // bullet-glyph robustness: "●" bullets are scored identically to "-" bullets
  // (not the empty-bullets bulletQuality fallback)
  ["copy-paste ● bullets scored same as - bullets", dot.bulletQuality === strong.bulletQuality && dot.concision === strong.concision],

  // education-leak: old academic dates under a non-"Education" header do not
  // inflate years-of-experience past the senior bar (seniority stays capped low)
  ["non-'Education' academic header dates do not leak into experience years", academicSenior.seniority < 50],

  // regression guard: a variant experience header ("Employment History") after an
  // education-first section must NOT mask real senior experience
  ["variant experience header still credits real senior years", sc(educationFirstResume, seniorJob).seniority >= 80],

  // a 4-digit METRIC ("2000 users") must not be read as a calendar year and inflate
  // seniority past a senior bar
  ["metric '2000 users' not counted as a year (seniority stays low vs senior bar)", sc(metricResume, seniorJob).seniority < 50],

  // round-4 regression guards: none of these may INFLATE seniority (over-claim)
  ["Education-internal dated sub-header does not leak degree years", sc(eduSubHeaderResume, seniorJob).seniority < 50],
  ["verb/modal before a metric ('marketed 2000', 'may 2015') is not a year", sc(verbMetricResume, seniorJob).seniority < 50],
  // MM/YYYY and month-prefixed ranges ARE credited (real senior, safe-direction fix)
  ["MM/YYYY range ('01/2016 - 06/2024') credits real senior tenure", sc(mmYyyyResume, seniorJob).seniority >= 80],
  // bare single years in column headings ARE credited (2016..2024 = 8y span), and the
  // bullet metric '2000 users' on the same resume does NOT inflate beyond that
  ["bare single-year columns credit real tenure (and bullet metric does not over-inflate)", sc(bareYearResume, seniorJob).seniority >= 80],

  // numerical robustness (audit verified no NaN/Infinity; lock it)
  ["empty resume + empty job → all finite [0,100]", allFinite(sc("", ""))],
  ["degenerate single-line inputs → all finite [0,100]", allFinite(sc("- a", "x"))],
  ["huge input does not break scoring", allFinite(sc(("- React ".repeat(5000)), JOB))]
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length) {
  for (const [name] of failures) console.error(`FAIL ${name}`);
  console.error(`(debug) strong=${JSON.stringify(strong)} weak.overall=${weak.overall} long.concision=${long.concision} seniorFit.overall=${seniorFit.overall}`);
  process.exit(1);
}
console.log(`scoring probes passed (${checks.length}/${checks.length})`);
