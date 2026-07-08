// Probes for the shared section model (src/resume/sections.ts) — the single source
// of truth the client scorer/parser and the server parser all import. It is plain
// ESM, so this eval imports it directly (no esbuild bundle needed).
//
//   node src/resume/__evals__/sections-eval.mjs
//
// The load-bearing invariant: a SUB-SECTION (Coursework/Awards/…) is a section
// HEADER for the parser (so it splits into its own editor section) but is NOT a
// TOP-LEVEL header for the scorer (so a dated sub-section under Education never
// clears the date-shield and inflates seniority).

import { BULLET_GLYPHS, inferSectionType, isEducationHeading, isSectionHeader, isSummaryHeading, isTopLevelSectionHeader } from "../sections.ts";

const checks = [
  // ── isSectionHeader (parser: top-level OR sub-section, any case, colon-tolerant)
  ["ALL-CAPS header", isSectionHeader("EXPERIENCE")],
  ["Title-Case header", isSectionHeader("Experience")],
  ["trailing-colon header", isSectionHeader("Experience:")],
  ["multiword title header", isSectionHeader("Technical Skills")],
  ["'& X' header", isSectionHeader("Awards & Honors")],
  ["sub-section is a header (parser splits it)", isSectionHeader("Coursework")],
  ["job-title collision is NOT a header", !isSectionHeader("Education Coordinator")],
  [">4-word line is NOT a header", !isSectionHeader("Software Engineering Experience at BigCo")],

  // ── isTopLevelSectionHeader (scorer/rewrite boundary: top-level ONLY)
  ["top-level experience", isTopLevelSectionHeader("EXPERIENCE")],
  ["top-level experience variant", isTopLevelSectionHeader("Employment History")],
  ["top-level education", isTopLevelSectionHeader("Education")],
  ["top-level skills", isTopLevelSectionHeader("Technical Skills")],

  // ── THE NESTING INVARIANT: sub-sections are headers but NOT top-level boundaries
  ["sub-section 'Awards' is NOT top-level", !isTopLevelSectionHeader("Awards")],
  ["sub-section 'Coursework' is NOT top-level", !isTopLevelSectionHeader("Coursework")],
  ["sub-section 'Publications' is NOT top-level", !isTopLevelSectionHeader("Publications")],
  ["Awards: header=true AND top-level=false (nesting holds)", isSectionHeader("Awards") && !isTopLevelSectionHeader("Awards")],

  // ── inferSectionType (editor type; skills wins over summary)
  ["skills type", inferSectionType("Technical Skills") === "skills"],
  ["'Skills Summary' is skills (skills wins)", inferSectionType("Skills Summary") === "skills"],
  ["summary type", inferSectionType("Summary") === "summary"],
  ["objective is summary", inferSectionType("Objective") === "summary"],
  ["experience is standard", inferSectionType("Experience") === "standard"],
  ["education is standard", inferSectionType("Education") === "standard"],

  // ── isEducationHeading (scorer date-shield trigger)
  ["education heading", isEducationHeading("Education")],
  ["ALL-CAPS education", isEducationHeading("EDUCATION")],
  ["academic background variant", isEducationHeading("Academic Background")],
  ["'Education & Training' is education", isEducationHeading("Education & Training")],
  ["'Education & Outreach' (work) is NOT education", !isEducationHeading("Education & Outreach")],
  ["job entry 'Academic Advisor | 2020-2022' is NOT education", !isEducationHeading("Academic Advisor | 2020-2022")],
  ["experience is NOT education", !isEducationHeading("Experience")],

  // ── isSummaryHeading
  ["summary heading", isSummaryHeading("Summary")],
  ["profile is summary", isSummaryHeading("Profile")],
  ["'Skills Summary' is NOT a summary heading (skills wins)", !isSummaryHeading("Skills Summary")],
  ["plain skills is NOT summary", !isSummaryHeading("Skills")],

  // ── bullet glyphs
  ["BULLET_GLYPHS includes • and ●", BULLET_GLYPHS.includes("•") && BULLET_GLYPHS.includes("●")],
  ["BULLET_GLYPHS excludes the '·' separator", !BULLET_GLYPHS.includes("·")]
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length) {
  for (const [name] of failures) console.error(`FAIL ${name}`);
  process.exit(1);
}
console.log(`sections probes passed (${checks.length}/${checks.length})`);
