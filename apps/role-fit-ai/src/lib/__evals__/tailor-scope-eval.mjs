// Probes for src/lib/tailorScope.ts — defaultTailorMode(s)/buildTailorScope/
// tailorScopeToText. This is the per-section Tailor/Include/Off contract that
// decides the AI payload: TAILOR sections are the only editable targets (the
// sanitizer's target map comes from `sections` alone), INCLUDE sections are
// read-only evidence that still counts toward fit/cover-letter text, and OFF
// sections are omitted from the payload entirely (heading noted only, for
// audit). Getting this partition wrong either leaks an OFF section into the AI
// payload or makes an INCLUDE section silently editable — both anti-fabrication
// relevant, hence a locked eval.
//
//   node src/lib/__evals__/tailor-scope-eval.mjs

import assert from "node:assert/strict";

import { buildTailorScope, defaultTailorMode, defaultTailorModes, tailorScopeToText } from "../tailorScope.ts";

function section(id, heading, type, items) {
  return { id, heading, type, items };
}
function entry(id, { titleLeft = "", titleRight = "", subtitleLeft = "", subtitleRight = "", bullets = [] } = {}) {
  return { id, titleLeft, titleRight, subtitleLeft, subtitleRight, bullets: bullets.map((text, i) => ({ id: `${id}-b${i}`, text })) };
}

// ── defaultTailorMode: the three buckets ────────────────────────────────────
assert.equal(defaultTailorMode(section("s", "", "standard", [])), "off", "an empty/blank heading is always off, regardless of type");
assert.equal(defaultTailorMode(section("s", "Skills", "skills", [])), "tailor", "a skills-typed section defaults to tailor even with a generic heading");
assert.equal(defaultTailorMode(section("s", "Profile", "summary", [])), "tailor", "a summary-typed section defaults to tailor even with a non-matching heading");
assert.equal(defaultTailorMode(section("s", "Education", "standard", [])), "include", "Education is read-only evidence by default");
assert.equal(defaultTailorMode(section("s", "Certifications", "standard", [])), "include", "Certifications default to include");
assert.equal(defaultTailorMode(section("s", "Awards", "standard", [])), "include", "Awards default to include");
assert.equal(defaultTailorMode(section("s", "Publications", "standard", [])), "include", "Publications default to include");
assert.equal(defaultTailorMode(section("s", "Experience", "standard", [])), "tailor", "Experience is an editable target by default");
assert.equal(defaultTailorMode(section("s", "Projects", "standard", [])), "tailor", "Projects is an editable target by default");
assert.equal(defaultTailorMode(section("s", "Hobbies", "standard", [])), "off", "a heading matching neither list defaults to off");
// Education is checked before the tailor keyword list, so a heading that could
// plausibly match both stays a read-only include (exclusion wins).
assert.equal(defaultTailorMode(section("s", "Education & Training", "standard", [])), "include", "the exclusion regex wins over any coincidental tailor-keyword overlap");

// ── defaultTailorModes: off is the implicit absent-key default ─────────────
const modesResume = {
  name: "Jordan Lee",
  contact: [],
  sections: [
    section("sum", "Summary", "summary", []),
    section("skl", "Technical Skills", "skills", []),
    section("exp", "Experience", "standard", []),
    section("edu", "Education", "standard", []),
    section("awd", "Awards", "standard", []),
    section("hob", "Hobbies", "standard", []),
    section("blank", "", "standard", [])
  ]
};
assert.deepEqual(
  defaultTailorModes(modesResume),
  { sum: "tailor", skl: "tailor", exp: "tailor", edu: "include", awd: "include" },
  "off sections (Hobbies, the blank heading) are absent keys, not explicit 'off' entries"
);
assert.deepEqual(defaultTailorModes(null), {}, "a null resume yields an empty mode map, not a throw");
assert.deepEqual(defaultTailorModes({ name: "", contact: [], sections: [] }), {}, "an empty resume yields an empty mode map");

// ── buildTailorScope: the three disjoint buckets ────────────────────────────
const resume = {
  name: "Jordan Lee",
  contact: ["jordan@example.com"],
  sections: [
    section("sum", "Summary", "summary", [entry("sum-1", { bullets: ["Backend engineer with 5 years of experience."] })]),
    section("exp", "Experience", "standard", [
      entry("exp-1", { titleLeft: "Software Engineer", titleRight: "Acme", subtitleLeft: "Remote", subtitleRight: "2021-2024", bullets: ["Shipped the checkout redesign.", "Reduced latency 30%."] })
    ]),
    section("edu", "Education", "standard", [entry("edu-1", { titleLeft: "B.S. Computer Science", titleRight: "State University" })]),
    section("awd", "Awards", "standard", [entry("awd-1", { titleLeft: "Hackathon winner" })]),
    section("hob", "Hobbies", "standard", [entry("hob-1", { titleLeft: "Chess" })])
  ]
};

const scope = buildTailorScope(resume, ["sum", "exp"], ["edu"]);
assert.deepEqual(scope.locked, { omittedIdentity: true, omittedContact: true, omittedSections: ["Awards", "Hobbies"] }, "identity/contact are always locked-omitted; unassigned sections land in omittedSections by heading only");
assert.deepEqual(scope.sections.map((s) => s.id), ["sum", "exp"], "tailor ids populate the editable `sections` array, in resume order");
assert.deepEqual(scope.contextSections.map((s) => s.id), ["edu"], "context ids populate the read-only `contextSections` array, disjoint from `sections`");
// Structural fail-safe: an omitted section carries ONLY its heading — no items/bullets leak.
assert.deepEqual(scope.locked.omittedSections, ["Awards", "Hobbies"], "omitted sections are headings only, never entry/bullet content");

// A section id in neither set, with a blank heading, is omitted silently (not even a heading recorded).
const blankHeadingResume = { ...resume, sections: [...resume.sections, section("blank", "", "standard", [entry("b-1", { titleLeft: "x" })])] };
const scopeBlank = buildTailorScope(blankHeadingResume, ["sum", "exp"], ["edu"]);
assert.deepEqual(scopeBlank.locked.omittedSections, ["Awards", "Hobbies"], "a blank-heading omitted section contributes nothing to omittedSections (no empty-string entries)");

// Every section off (neither tailorIds nor contextIds provided): everything is omitted.
const scopeAllOff = buildTailorScope(resume, [], []);
assert.deepEqual(scopeAllOff.sections, [], "no tailor ids -> the editable sections array is empty");
assert.deepEqual(scopeAllOff.contextSections, [], "no context ids -> the read-only context array is empty");
assert.deepEqual(scopeAllOff.locked.omittedSections, ["Summary", "Experience", "Education", "Awards", "Hobbies"], "every real heading is recorded as omitted when nothing is tailored or included");

// Empty resume (no sections at all).
const emptyResume = { name: "", contact: [], sections: [] };
const scopeEmpty = buildTailorScope(emptyResume, ["sum"], ["edu"]);
assert.deepEqual(scopeEmpty, { version: 1, locked: { omittedIdentity: true, omittedContact: true, omittedSections: [] }, sections: [], contextSections: [] }, "an empty resume yields an empty (but well-formed) scope, ignoring ids that don't exist");

// contextSectionIds defaults to empty when omitted.
const scopeNoContextArg = buildTailorScope(resume, ["sum"]);
assert.deepEqual(scopeNoContextArg.contextSections, [], "contextSectionIds defaults to an empty iterable when the caller omits it");
assert.deepEqual(scopeNoContextArg.locked.omittedSections, ["Experience", "Education", "Awards", "Hobbies"], "everything not explicitly tailored falls to omitted when no context set is given at all");

// ── tailorScopeToText: TAILOR sections render as editable body; skills/summary
//    have their own line shapes; standard entries render title | subtitle | bullets
const text = tailorScopeToText(scope);
assert.equal(text.startsWith("SUMMARY\n"), true, "section headings render upper-cased");
assert.ok(text.includes("Backend engineer with 5 years of experience."), "summary bullets render as bare lines (no title/subtitle prefix)");
assert.ok(text.includes("Software Engineer | Acme"), "standard entry titles join left|right with ' | '");
assert.ok(text.includes("Remote | 2021-2024"), "standard entry subtitles join left|right with ' | '");
assert.ok(text.includes("- Shipped the checkout redesign."), "standard entry bullets are prefixed with '- '");
assert.ok(text.includes("EDUCATION"), "editableOnly=false (default) also serializes contextSections, in tailor-then-context order");
assert.ok(text.indexOf("EXPERIENCE") < text.indexOf("EDUCATION"), "tailor sections render before context sections");
assert.ok(!text.includes("AWARDS") && !text.includes("HOBBIES"), "omitted sections never appear in the serialized text, not even their heading");

const editableOnlyText = tailorScopeToText(scope, true);
assert.ok(!editableOnlyText.includes("EDUCATION"), "editableOnly=true drops context sections entirely (used by the polish-gate length check)");
assert.ok(editableOnlyText.includes("SUMMARY") && editableOnlyText.includes("EXPERIENCE"), "editableOnly=true still includes every tailor section");

// Skills section line shape: "Label: skills" when a label is present, bare skills line otherwise.
const skillsScope = buildTailorScope(
  {
    name: "",
    contact: [],
    sections: [
      section("skl", "Technical Skills", "skills", [
        entry("skl-1", { titleLeft: "Languages", subtitleLeft: "TypeScript, Python, Go" }),
        entry("skl-2", { titleLeft: "", subtitleLeft: "Docker, Kubernetes" })
      ])
    ]
  },
  ["skl"]
);
const skillsText = tailorScopeToText(skillsScope);
assert.ok(skillsText.includes("Languages: TypeScript, Python, Go"), "a labeled skills row renders as 'Label: skills'");
assert.ok(skillsText.includes("Docker, Kubernetes") && !skillsText.includes(": Docker, Kubernetes"), "an unlabeled skills row renders bare, with no leading ': '");

// Empty scope / every-section-off end-to-end: no text at all.
assert.equal(tailorScopeToText(scopeEmpty), "", "an empty scope serializes to an empty string");
assert.equal(tailorScopeToText(scopeAllOff), "", "every-section-off (nothing tailored or included) serializes to an empty string, even though headings exist in locked.omittedSections");
assert.equal(tailorScopeToText(scopeAllOff, true), "", "every-section-off stays empty under editableOnly too");

console.log("tailor-scope probes passed");
