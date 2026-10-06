// The tailoring brief is capped at 9,000 characters. Before, the assembled text
// was sliced as one string with responsibilities first, so twelve long duties
// could push the required qualifications and the tech stack out of the brief
// that Polish and the scorer read. The assembler now budgets whole items across
// the three long lists and never cuts an item mid-sentence.
//
//   node src/lib/__evals__/tailoring-text-budget-eval.mjs

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

async function load(relative) {
  const bundled = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent"
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
}
const { assembleTailoringText, extractJobPosting } = await load("../jobExtract.ts");
const { parseTailoringSections } = await load("../preparedJobBrief.ts");

let checks = 0;
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };

const HEADINGS = [
  "Job Title:", "Company / Product Context:", "Core Responsibilities:", "Required Qualifications:",
  "Preferred Qualifications:", "Tech Stack / Keywords:", "Seniority Signals:", "Domain Signals:"
];
// Each duty is the sanitizer's 1,000-character maximum, so twelve of them alone
// exceed the 9,000-character brief.
const sentence = (index) => `Own the ${index}th service area and ${"keep every dependent team informed about release scope, incident follow-up, and roadmap changes ".repeat(12)}`.slice(0, 999) + ".";
const longParts = {
  title: "Senior Backend Engineer",
  context: "Northwind builds logistics software.",
  responsibilities: Array.from({ length: 12 }, (_, index) => sentence(index)),
  required: ["Five years of professional backend experience with Python or Java"],
  preferred: ["Experience with event-driven systems", "Prior logistics domain work"],
  tech: ["Python", "PostgreSQL", "Kafka"],
  seniority: ["Senior"],
  domains: ["Logistics"]
};

{
  const brief = assembleTailoringText(longParts);
  check(brief.length <= 9_000, `the budget holds (${brief.length} chars)`);
  for (const heading of HEADINGS) check(brief.includes(`${heading}\n`), `${heading} survives`);
  const parsed = parseTailoringSections(brief);
  check(parsed.requiredQualifications.length === 1 && parsed.requiredQualifications[0].startsWith("Five years"), "the required qualification survives twelve long duties");
  check(parsed.preferredQualifications.length === 2, "both preferred items survive");
  check(parsed.techKeywords.includes("PostgreSQL"), "the tech stack survives");
  check(parsed.responsibilities.length >= 3 && parsed.responsibilities.length < 12, `responsibilities are cut to whole items (${parsed.responsibilities.length} kept)`);
  check(parsed.responsibilities.every((item, index) => item === longParts.responsibilities[index].replace(/\s+/g, " ")), "kept duties are the leading ones, in order and whole");
  check(!/\[manual input needed/.test(brief), "no section fell back to a placeholder");
  const lines = brief.split("\n");
  check(lines.at(-1).startsWith("- Logistics"), "the brief ends on its last whole item, not a cut");
}

{
  // A list is skipped at its first non-fitting item; later items are not reordered in.
  const brief = assembleTailoringText({ ...longParts, required: [sentence(0), "Short requirement"] }, 1_200);
  const parsed = parseTailoringSections(brief);
  check(brief.length <= 1_200, "a custom budget holds");
  check(parsed.requiredQualifications.length === 0, "a list stops at its first item that does not fit instead of promoting a later one");
  check(parsed.preferredQualifications.length === 2, "the other lists still take what fits");
}

{
  // A brief that fits is byte-identical to the unbudgeted scaffold.
  const parts = { ...longParts, responsibilities: longParts.responsibilities.slice(0, 2) };
  const brief = assembleTailoringText(parts);
  assert.equal(brief, assembleTailoringText(parts, 100_000));
  checks += 1;
  check(brief.length < 9_000, "the fixture itself fits");
}

{
  // Empty lists still render their placeholders under budget pressure.
  const brief = assembleTailoringText({ ...longParts, required: [], tech: [] });
  check(brief.includes("[manual input needed: required qualifications]"), "an empty required list keeps its placeholder");
  check(brief.includes("[manual input needed: tech stack or keywords]"), "an empty tech list keeps its placeholder");
  check(brief.length <= 9_000, "placeholders fit the budget");
}

{
  // The local engine shares the assembler and the same cap.
  const posting = [
    "Senior Backend Engineer", "Northwind", "About the role",
    "Responsibilities:", ...longParts.responsibilities.map((item) => `- ${item}`),
    "Requirements:", "- Five years of professional backend experience with Python or Java", "- PostgreSQL in production"
  ].join("\n");
  const extracted = extractJobPosting(posting);
  check(extracted.tailoringText.length <= 9_000, "the local brief holds the cap");
  check(extracted.tailoringText.includes("Required Qualifications:\n"), "the local brief keeps its required section heading");
}

console.log(`Tailoring text budget eval: ${checks}/${checks} checks passed`);
