// Offline probes for the plain-text -> schema parser (the renderResumeTex path;
// the studio's renderResumeTexFromSchema bypasses it). No personal data.
//
//   node server/latex/__evals__/parse-resume-text.mjs
//
// Locks the structure-detection heuristics: name/contact split, em-dash heading
// columns, bullet attachment, summary paragraphs — and pins the one KNOWN
// limitation (a 4-word ALL-CAPS employer parses as a section) as current
// behavior, so a future isSectionHeader fix flips this test on purpose.

import { parseResumeText } from "../parseResumeText.ts";

const fixture = `Jane Doe
jane@example.com | github.com/jane | New York, NY

SUMMARY
Backend engineer with 5 years building APIs.

EXPERIENCE
Software Engineer — Acme Corp — 2020-2024 — Remote
- Built REST APIs in Python
- Led a 3-person team

GORDON FOOD SERVICE COMPANY
- Cashier and stocker

TECHNICAL SKILLS
Languages: Python, SQL`;

const s = parseResumeText(fixture);
const section = (h) => s.sections.find((sec) => sec.heading === h);
const experience = section("EXPERIENCE");
const expItem = experience?.items?.[0];
const summary = s.sections.find((sec) => /summary/i.test(sec.heading));

// Title-Case + trailing-colon headers must parse here too — this server parser and
// the client editor parser now import the SAME isSectionHeader from
// src/resume/sections.ts; before that, a normally-formatted Title-Case resume
// collapsed its body into the contact line.
const titleCaseDoc = parseResumeText(
  "Jane Doe\njane@example.com\n\nExperience:\nSoftware Engineer — Acme — 2020-2024\n- Built APIs\n\nEducation\nState University — BS CS — 2019"
);

const checks = [
  // --- name + contact ---
  ["first line is the name", s.name === "Jane Doe"],
  ["contact splits on | into 3 pieces", Array.isArray(s.contact) && s.contact.length === 3],
  ["contact keeps the email", s.contact.includes("jane@example.com")],
  ["name line is not a section", !s.sections.some((sec) => sec.heading === "Jane Doe")],

  // --- em-dash heading -> four columns ---
  ["em-dash heading title", expItem?.title === "Software Engineer"],
  ["em-dash heading subtitle", expItem?.subtitle === "Acme Corp"],
  ["em-dash heading meta (dates)", expItem?.meta === "2020-2024"],
  ["em-dash heading location", expItem?.location === "Remote"],

  // --- bullet attachment ---
  ["bullets attach to the item above them", (expItem?.bullets ?? []).length === 2],
  ["bullet text strips the marker", (expItem?.bullets ?? [])[0] === "Built REST APIs in Python"],

  // --- summary paragraph preserved as content, not dropped ---
  ["summary section detected", Boolean(summary)],
  ["summary paragraph preserved", (summary?.items?.[0]?.bullets ?? []).some((b) => /Backend engineer/.test(b))],

  // --- Title-Case + colon headers parse (server + client share src/resume/sections.ts) ---
  ["Title-Case/colon headers parse into 2 sections", titleCaseDoc.sections.length === 2],
  ["Title-Case heading drops trailing colon", titleCaseDoc.sections.every((sec) => !sec.heading.endsWith(":"))],

  // --- skills section heading detected ---
  ["technical skills section detected", Boolean(section("TECHNICAL SKILLS"))],

  // --- KNOWN LIMITATION (pinned): isSectionHeader treats a <=4-word ALL-CAPS
  // line as a heading, so a SHOUTING employer name becomes a spurious section
  // instead of an item under EXPERIENCE. Locked as current behavior; if
  // isSectionHeader is later tightened, flip these two on purpose. ---
  ["known gap: ALL-CAPS employer becomes a section", s.sections.some((sec) => sec.heading === "GORDON FOOD SERVICE COMPANY")],
  ["known gap: that employer is NOT an EXPERIENCE item", !(experience?.items ?? []).some((i) => /gordon/i.test(i.title))]
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length) {
  for (const [name] of failures) console.error(`FAIL ${name}`);
  console.error(JSON.stringify(s, null, 2));
  process.exit(1);
}

console.log(`parse-resume-text probes passed (${checks.length}/${checks.length})`);
