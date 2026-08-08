// Probes for src/lib/resumePolishScope.ts — default modes, partitioning, and
// serialization. This is the per-section Polish/Include/Off contract that
// decides the AI payload: POLISH sections are the only editable targets (the
// sanitizer's target map comes from `sections` alone), INCLUDE sections are
// read-only Resume Polish evidence, and OFF
// sections are omitted from the payload entirely (heading noted only, for
// audit). Getting this partition wrong either leaks an OFF section into the AI
// payload or makes an INCLUDE section silently editable — both anti-fabrication
// relevant, hence a locked eval.
//
//   node src/lib/__evals__/resume-polish-scope-eval.mjs

import assert from "node:assert/strict";

import {
  buildResumePolishScope,
  defaultResumePolishScopeMode,
  defaultResumePolishScopeModes,
  resumePolishScopeToText
} from "../resumePolishScope.ts";

function section(id, heading, type, items) {
  return { id, heading, type, items };
}
function entry(id, { titleLeft = "", titleRight = "", subtitleLeft = "", subtitleRight = "", bullets = [] } = {}) {
  return { id, titleLeft, titleRight, subtitleLeft, subtitleRight, bullets: bullets.map((text, i) => ({ id: `${id}-b${i}`, text })) };
}

// ── defaultResumePolishScopeMode: the three buckets ─────────────────────────
assert.equal(defaultResumePolishScopeMode(section("s", "", "standard", [])), "off", "an empty/blank heading is always off, regardless of type");
assert.equal(defaultResumePolishScopeMode(section("s", "Skills", "skills", [])), "polish", "a skills-typed section defaults to Polish even with a generic heading");
assert.equal(defaultResumePolishScopeMode(section("s", "Profile", "summary", [])), "polish", "a summary-typed section defaults to Polish even with a non-matching heading");
assert.equal(defaultResumePolishScopeMode(section("s", "Education", "standard", [])), "include", "Education is read-only evidence by default");
assert.equal(defaultResumePolishScopeMode(section("s", "Certifications", "standard", [])), "include", "Certifications default to include");
assert.equal(defaultResumePolishScopeMode(section("s", "Awards", "standard", [])), "include", "Awards default to include");
assert.equal(defaultResumePolishScopeMode(section("s", "Publications", "standard", [])), "include", "Publications default to include");
assert.equal(defaultResumePolishScopeMode(section("s", "Experience", "standard", [])), "polish", "Experience is an editable target by default");
assert.equal(defaultResumePolishScopeMode(section("s", "Projects", "standard", [])), "polish", "Projects is an editable target by default");
assert.equal(defaultResumePolishScopeMode(section("s", "Hobbies", "standard", [])), "off", "a heading matching neither list defaults to off");
// Education is checked before the Polish keyword list, so a heading that could
// plausibly match both stays a read-only include (exclusion wins).
assert.equal(defaultResumePolishScopeMode(section("s", "Education & Training", "standard", [])), "include", "the exclusion regex wins over any coincidental Polish-keyword overlap");

// ── defaultResumePolishScopeModes: off is the implicit absent-key default ──
const modesResume = {
  header: { visible: true, name: "Jordan Lee", contact: [] },
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
  defaultResumePolishScopeModes(modesResume),
  { sum: "polish", skl: "polish", exp: "polish", edu: "include", awd: "include" },
  "off sections (Hobbies, the blank heading) are absent keys, not explicit 'off' entries"
);
assert.deepEqual(defaultResumePolishScopeModes(null), {}, "a null resume yields an empty mode map, not a throw");
assert.deepEqual(defaultResumePolishScopeModes({ header: null, sections: [] }), {}, "an empty resume yields an empty mode map");

// ── buildResumePolishScope: the three disjoint buckets ─────────────────────
const resume = {
  header: {
    visible: true,
    name: "Jordan Lee",
    contact: ["jordan@example.com"]
  },
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

const scope = buildResumePolishScope(resume, ["sum", "exp"], ["edu"]);
assert.deepEqual(scope.locked, { omittedIdentity: true, omittedContact: true, omittedSections: ["Awards", "Hobbies"] }, "identity/contact are always locked-omitted; unassigned sections land in omittedSections by heading only");
assert.deepEqual(scope.sections.map((s) => s.id), ["sum", "exp"], "Polish ids populate the editable `sections` array, in resume order");
assert.deepEqual(scope.contextSections.map((s) => s.id), ["edu"], "context ids populate the read-only `contextSections` array, disjoint from `sections`");
// Structural fail-safe: an omitted section carries ONLY its heading — no items/bullets leak.
assert.deepEqual(scope.locked.omittedSections, ["Awards", "Hobbies"], "omitted sections are headings only, never entry/bullet content");

// A section id in neither set, with a blank heading, is omitted silently (not even a heading recorded).
const blankHeadingResume = { ...resume, sections: [...resume.sections, section("blank", "", "standard", [entry("b-1", { titleLeft: "x" })])] };
const scopeBlank = buildResumePolishScope(blankHeadingResume, ["sum", "exp"], ["edu"]);
assert.deepEqual(scopeBlank.locked.omittedSections, ["Awards", "Hobbies"], "a blank-heading omitted section contributes nothing to omittedSections (no empty-string entries)");

// Every section off (neither polishIds nor contextIds provided): everything is omitted.
const scopeAllOff = buildResumePolishScope(resume, [], []);
assert.deepEqual(scopeAllOff.sections, [], "no Polish ids -> the editable sections array is empty");
assert.deepEqual(scopeAllOff.contextSections, [], "no context ids -> the read-only context array is empty");
assert.deepEqual(scopeAllOff.locked.omittedSections, ["Summary", "Experience", "Education", "Awards", "Hobbies"], "every real heading is recorded as omitted when nothing is polished or included");

// Empty resume (no sections at all).
const emptyResume = { header: null, sections: [] };
const scopeEmpty = buildResumePolishScope(emptyResume, ["sum"], ["edu"]);
assert.deepEqual(scopeEmpty, { version: 1, locked: { omittedIdentity: true, omittedContact: true, omittedSections: [] }, sections: [], contextSections: [] }, "an empty resume yields an empty (but well-formed) scope, ignoring ids that don't exist");

// contextSectionIds defaults to empty when omitted.
const scopeNoContextArg = buildResumePolishScope(resume, ["sum"]);
assert.deepEqual(scopeNoContextArg.contextSections, [], "contextSectionIds defaults to an empty iterable when the caller omits it");
assert.deepEqual(scopeNoContextArg.locked.omittedSections, ["Experience", "Education", "Awards", "Hobbies"], "everything not explicitly selected for Polish falls to omitted when no context set is given at all");

// ── resumePolishScopeToText: POLISH sections render as editable body; skills/summary
//    have their own line shapes; standard entries render title | subtitle | bullets
const text = resumePolishScopeToText(scope);
assert.equal(text.startsWith("SUMMARY\n"), true, "section headings render upper-cased");
assert.ok(text.includes("Backend engineer with 5 years of experience."), "summary bullets render as bare lines (no title/subtitle prefix)");
assert.ok(text.includes("Software Engineer | Acme"), "standard entry titles join left|right with ' | '");
assert.ok(text.includes("Remote | 2021-2024"), "standard entry subtitles join left|right with ' | '");
assert.ok(text.includes("- Shipped the checkout redesign."), "standard entry bullets are prefixed with '- '");
assert.ok(text.includes("EDUCATION"), "editableOnly=false (default) also serializes contextSections, in Polish-then-context order");
assert.ok(text.indexOf("EXPERIENCE") < text.indexOf("EDUCATION"), "Polish sections render before context sections");
assert.ok(!text.includes("AWARDS") && !text.includes("HOBBIES"), "omitted sections never appear in the serialized text, not even their heading");

const editableOnlyText = resumePolishScopeToText(scope, true);
assert.ok(!editableOnlyText.includes("EDUCATION"), "editableOnly=true drops context sections entirely (used by the polish-gate length check)");
assert.ok(editableOnlyText.includes("SUMMARY") && editableOnlyText.includes("EXPERIENCE"), "editableOnly=true still includes every Polish section");

// Skills section line shape: "Label: skills" when a label is present, bare skills line otherwise.
const skillsScope = buildResumePolishScope(
  {
    header: null,
    sections: [
      section("skl", "Technical Skills", "skills", [
        entry("skl-1", { titleLeft: "Languages", subtitleLeft: "TypeScript, Python, Go" }),
        entry("skl-2", { titleLeft: "", subtitleLeft: "Docker, Kubernetes" })
      ])
    ]
  },
  ["skl"]
);
const skillsText = resumePolishScopeToText(skillsScope);
assert.ok(skillsText.includes("Languages: TypeScript, Python, Go"), "a labeled skills row renders as 'Label: skills'");
assert.ok(skillsText.includes("Docker, Kubernetes") && !skillsText.includes(": Docker, Kubernetes"), "an unlabeled skills row renders bare, with no leading ': '");

// Empty scope / every-section-off end-to-end: no text at all.
assert.equal(resumePolishScopeToText(scopeEmpty), "", "an empty scope serializes to an empty string");
assert.equal(resumePolishScopeToText(scopeAllOff), "", "every-section-off (nothing polished or included) serializes to an empty string, even though headings exist in locked.omittedSections");
assert.equal(resumePolishScopeToText(scopeAllOff, true), "", "every-section-off stays empty under editableOnly too");

console.log("resume-polish-scope probes passed");
