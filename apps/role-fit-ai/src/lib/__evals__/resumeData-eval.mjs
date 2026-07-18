// Probes for the plain-text -> structured resume parser (parseResumeData) and its
// inverse (serializeResumeData). The parser seeds the editor from pasted text,
// so a header-detection regression silently destroys a resume's structure.
// Before these probes it only recognized ALL-CAPS headers, so a normally-
// formatted Title-Case resume collapsed its entire body into the contact line.
//
//   node src/lib/__evals__/resumeData-eval.mjs
//
// resumeText.ts imports the shared engine, so bundle the integration boundary
// before importing it in Node.

import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

async function load() {
  const entry = fileURLToPath(new URL("../resumeText.ts", import.meta.url));
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

const { parseResumeData, serializeResumeData } = await load();

const titleCase = [
  "Jane Dev",
  "jane@example.com | github.com/jane",
  "",
  "Experience",
  "Acme | Software Engineer | 2023-2025",
  "- Built React dashboards",
  "",
  "Technical Skills",
  "Languages: TypeScript, Python",
  "",
  "Education",
  "State University | BS CS | 2019-2023"
].join("\n");

const tc = parseResumeData(titleCase);
const ac = parseResumeData(titleCase.replace("Experience", "EXPERIENCE").replace("Technical Skills", "TECHNICAL SKILLS").replace("Education", "EDUCATION"));
const lower = parseResumeData(titleCase.replace("Experience", "experience").replace("Education", "education"));
const round = parseResumeData(serializeResumeData(tc));
// Trailing-colon headers ("Experience:", "Education:") — common in pasted/PDF text.
const colon = parseResumeData(titleCase.replace("Experience", "Experience:").replace("Education", "Education:").replace("Technical Skills", "Technical Skills:"));

// Job titles / content lines that merely contain a section word must NOT parse as
// section headers (they belong under the preceding real section).
const collide = parseResumeData(
  [
    "Jane Dev",
    "jane@example.com",
    "",
    "Experience",
    "Education Coordinator | Acme | 2021-2023",
    "- Ran tutoring programs",
    "Software Engineering Experience at BigCo | 2019-2021",
    "- Built APIs"
  ].join("\n")
);

const headings = (r) => r.sections.map((s) => s.heading);
const typeOf = (r, re) => r.sections.find((s) => re.test(s.heading))?.type;

const checks = [
  // Title-Case is recognized (the core fix)
  ["Title-Case headers parse into 3 sections", tc.sections.length === 3],
  ["name kept out of contact", tc.name === "Jane Dev"],
  ["body not collapsed into contact (exactly the 2 contact entries)", tc.contact.length === 2],

  // trailing-colon headers parse + the stored heading drops the colon
  ["colon-suffixed headers parse into 3 sections", colon.sections.length === 3],
  ["stored heading drops the trailing colon", colon.sections.every((s) => !s.heading.endsWith(":"))],
  ["skills type inferred from 'Technical Skills'", typeOf(tc, /technical skills/i) === "skills"],
  ["experience stays a standard section", typeOf(tc, /^experience$/i) === "standard"],

  // case-insensitive + no ALL-CAPS regression
  ["lowercase headers also parse", lower.sections.length === 3],
  ["ALL-CAPS headers still parse", ac.sections.length === 3],

  // round-trip stability (serialize uppercases; re-parse must match)
  ["parse->serialize->parse keeps 3 sections", round.sections.length === 3],
  ["round-trip preserves section types", JSON.stringify(round.sections.map((s) => s.type)) === JSON.stringify(tc.sections.map((s) => s.type))],

  // collision guards
  ["'Education Coordinator' entry is NOT a section header", !headings(collide).some((h) => /coordinator/i.test(h))],
  ["'Software Engineering Experience at BigCo' is NOT a header", !headings(collide).some((h) => /bigco/i.test(h))],
  ["both job entries land under one Experience section", collide.sections.length === 1 && collide.sections[0].items.length === 2]
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length) {
  for (const [name] of failures) console.error(`FAIL ${name}`);
  console.error(`(debug) tc headings=${JSON.stringify(headings(tc))} contact=${JSON.stringify(tc.contact)} collide=${JSON.stringify(headings(collide))}`);
  process.exit(1);
}
console.log(`resumeData parse probes passed (${checks.length}/${checks.length})`);
