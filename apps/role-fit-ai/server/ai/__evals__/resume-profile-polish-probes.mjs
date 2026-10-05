// Profile-aware Resume Polish: a Profile heading that names a resume entry
// grounds rewrites of that entry and up to two new bullets for it; nothing else
// in the Profile is evidence for that entry. Evidence concerns stay reviewable
// warnings; only invalid targets are dropped.

import assert from "node:assert/strict";

import { NEW_BULLETS_PER_ENTRY, flattenResumeTargets, resumePolishSectionIsLocked, sanitizeResumePolishWireResult } from "../../../shared/resumePolishContract.ts";
import { buildResumePolishScope } from "../../../src/lib/resumePolishScope.ts";
import { buildResumeProposalPrompts, sanitizeResumeAdvice, sanitizeResumeProposal, selectPromptTargets } from "../resumeProposal.ts";
import { normalizeResumeScope } from "../resumeScope.ts";

const unsupported = (warnings) => warnings?.some((warning) => warning.startsWith("Not supported by provided evidence. "));
const UNCONFIRMED = "Source reference could not be confirmed.";

const scope = {
  version: 1,
  locked: { omittedIdentity: true, omittedContact: true, omittedSections: [] },
  sections: [
    {
      id: "experience",
      heading: "Experience",
      type: "standard",
      entries: [
        { id: "acme", titleLeft: "Acme Corp", titleRight: "2024", subtitleLeft: "Software Engineer Intern", subtitleRight: "", bullets: [{ id: "b-acme", text: "Built internal JavaScript tools for support teams." }] },
        { id: "beta", titleLeft: "Beta Health", titleRight: "2023", subtitleLeft: "Data Analyst", subtitleRight: "", bullets: [{ id: "b-beta", text: "Maintained SQL reports for clinic operations." }] }
      ]
    },
    {
      id: "projects",
      heading: "Projects",
      type: "standard",
      entries: [
        { id: "careflow", titleLeft: "CareFlow", titleRight: "", subtitleLeft: "Clinic scheduling app", subtitleRight: "", bullets: [{ id: "b-careflow", text: "Built a Django scheduling service." }] }
      ]
    },
    {
      id: "education",
      heading: "Education",
      type: "standard",
      entries: [
        { id: "school", titleLeft: "State University", titleRight: "", subtitleLeft: "B.S. Computer Science", subtitleRight: "", bullets: [{ id: "b-school", text: "Capstone in distributed systems." }] }
      ]
    }
  ],
  contextSections: [
    {
      id: "volunteer",
      heading: "Volunteer",
      type: "standard",
      entries: [
        { id: "codeclub", titleLeft: "Code Club", titleRight: "", subtitleLeft: "Mentor", subtitleRight: "", bullets: [{ id: "b-club", text: "Mentored students." }] }
      ]
    }
  ]
};

const profile = [
  "Candidate facts:",
  "- Citizenship: U.S. citizen.",
  "",
  "Prefers backend work. Used Terraform for a home lab.",
  "",
  "## CareFlow (personal project, 2025–present)",
  "Added Redis caching that cut p95 latency by 40%.",
  "Wrote PostgreSQL migrations for appointment history.",
  "",
  "## Acme Corp (internship, 2024)",
  "Automated release notes with GitHub Actions.",
  "",
  "## Code Club (volunteer, 2022)",
  "Ran weekly Python workshops.",
  "",
  "## State University (academic, 2020–2024)",
  "Built a Raft consensus simulator.",
  "",
  "## Slotwise (personal project, 2023)",
  "Built a Kubernetes-deployed booking API in Go."
].join("\n");
const jobText = "Backend engineer: Redis, PostgreSQL, GitHub Actions, Kubernetes, Go, and latency improvements for clinic scheduling.";
const scopeText = "EXPERIENCE\nAcme Corp | 2024\nSoftware Engineer Intern\n- Built internal JavaScript tools for support teams.\nBeta Health | 2023\nData Analyst\n- Maintained SQL reports for clinic operations.\nPROJECTS\nCareFlow\nClinic scheduling app\n- Built a Django scheduling service.";

// ── Targets ──────────────────────────────────────────────────────────────────
const plainTargets = flattenResumeTargets(scope);
const targets = flattenResumeTargets(scope, profile);
assert.deepEqual(
  targets.filter((target) => target.kind !== "new-bullet").map(({ targetId, target }) => ({ targetId, target })),
  plainTargets.map(({ targetId, target }) => ({ targetId, target })),
  "a linked Profile keeps every existing target id"
);
const additions = targets.filter((target) => target.kind === "new-bullet");
assert.deepEqual(
  additions.map((target) => [target.targetId, target.target.entryId]),
  [["add-1", "acme"], ["add-2", "acme"], ["add-3", "careflow"], ["add-4", "careflow"]],
  "two new-bullet slots per linked in-scope entry"
);
assert.ok(additions.every((target) => target.currentText === "" && !target.target.bulletId), "slots carry no bullet yet");
assert.equal(additions.some((target) => ["beta", "school", "codeclub"].includes(target.target.entryId)), false,
  "unlinked, locked, and read-only context entries get no new-bullet slots");
assert.match(targets.find((target) => target.target.bulletId === "b-careflow").profileText, /Redis caching/);
assert.equal(targets.find((target) => target.target.bulletId === "b-beta").profileText, "", "an unlinked entry has no Profile text");

// ── Budget: a linked Profile never changes which existing fields are sent ─────
const withProfile = selectPromptTargets(targets, jobText);
const withoutProfile = selectPromptTargets(plainTargets, jobText);
assert.deepEqual(
  withProfile.selectedTargets.filter((target) => target.kind !== "new-bullet").map((target) => target.targetId),
  withoutProfile.selectedTargets.map((target) => target.targetId),
  "existing target selection is unchanged"
);
assert.ok(withProfile.serialized.startsWith(withoutProfile.serialized.slice(0, withoutProfile.serialized.indexOf(',"targets"'))),
  "existing entry evidence serializes the same way");

// ── Prompt ───────────────────────────────────────────────────────────────────
const prompts = buildResumeProposalPrompts({ jobText, targets, scopeText, candidateContext: profile, customInstructions: "" });
assert.match(prompts.userPrompt, /<entry_profiles>[\s\S]*"entryId":"careflow"[\s\S]*Redis caching[\s\S]*<\/entry_profiles>/);
assert.doesNotMatch(prompts.userPrompt.match(/<entry_profiles>[\s\S]*<\/entry_profiles>/)[0], /Slotwise|Terraform/,
  "only linked Profile text is listed per entry");
assert.match(prompts.userPrompt, /A new-bullet target adds one bullet at the end of its entry/);
assert.ok(prompts.userPrompt.includes(`Use only the add targets whose target.entryId is that entry (at most ${NEW_BULLETS_PER_ENTRY} per entry)`),
  "each add slot belongs to its own entry; the count follows NEW_BULLETS_PER_ENTRY");
assert.match(prompts.userPrompt, /another entry's profile text and the rest of candidate_context are never evidence for it/);
assert.match(prompts.userPrompt, /add-from-profile/);
assert.match(prompts.systemPrompt, /<entry_profiles>/, "entry_profiles is fenced as untrusted data");
const generalOnly = buildResumeProposalPrompts({
  jobText,
  targets: flattenResumeTargets(scope, "Prefers backend work."),
  scopeText,
  candidateContext: "Prefers backend work.",
  customInstructions: ""
});
assert.doesNotMatch(generalOnly.userPrompt, /entry_profiles>|new-bullet|add-from-profile|"evidence"/,
  "a Profile without headings adds no Profile-linking instructions");

// ── Edits ────────────────────────────────────────────────────────────────────
function review(changes) {
  return sanitizeResumeProposal({ status: "PROPOSAL", changes }, targets, jobText, scopeText, profile);
}
const idFor = (bulletId) => targets.find((target) => target.target.bulletId === bulletId).targetId;
const redisRewrite = "Built a Django scheduling service with Redis caching that cut p95 latency by 40%.";

const linkedEdit = review([{ targetId: idFor("b-careflow"), replacement: redisRewrite }]);
assert.equal(linkedEdit.changes.length, 1);
assert.equal(linkedEdit.changes[0].warnings, undefined, "a fact from the entry's own Profile block is supported");
assert.equal(linkedEdit.changes[0].evidence, "profile", "an edit that needs Profile text is labelled Profile");

for (const [label, bulletId, replacement] of [
  ["another entry's block", "b-acme", "Built internal JavaScript tools with Redis caching that cut p95 latency by 40%."],
  ["an unlinked entry", "b-beta", "Maintained SQL reports with Redis caching that cut p95 latency by 40%."],
  ["general Profile text", "b-acme", "Built internal JavaScript tools with Terraform for support teams."]
]) {
  const flagged = review([{ targetId: idFor(bulletId), replacement }]);
  assert.equal(flagged.status, "PROPOSAL", `${label}: stays reviewable`);
  assert.ok(unsupported(flagged.changes[0].warnings), `${label}: carries the support warning`);
}

const resumeOnly = review([{ targetId: idFor("b-acme"), replacement: "Built JavaScript tools used by internal support teams." }]);
assert.equal(resumeOnly.changes[0].warnings, undefined);
assert.equal(resumeOnly.changes[0].evidence, undefined, "an edit supported by the resume alone is not labelled Profile");

const declared = review([{ targetId: idFor("b-acme"), replacement: "Built JavaScript tools used by internal support teams.", evidence: "profile" }]);
assert.equal(declared.changes[0].evidence, "profile", "a declared Profile edit on a linked entry keeps its label");
const declaredUnlinked = review([{ targetId: idFor("b-beta"), replacement: "Maintained SQL reports used in clinic operations.", evidence: "profile" }]);
assert.equal(declaredUnlinked.changes[0].evidence, undefined, "an entry with no linked Profile text is never labelled Profile");

// ── New bullets ──────────────────────────────────────────────────────────────
const adds = review([
  { targetId: "add-1", entryId: "acme", replacement: "Automated release notes with GitHub Actions." },
  { targetId: "add-3", entryId: "careflow", replacement: "Wrote PostgreSQL migrations for appointment history." },
  { targetId: "add-4", entryId: "careflow", replacement: "Deployed the scheduler on Kubernetes for 10,000 clinics." },
  { targetId: "add-2", entryId: "acme", replacement: "Built internal JavaScript tools for support teams." },
  { targetId: "add-5", entryId: "acme", replacement: "Added a third Acme bullet." },
  { targetId: "add-1", entryId: "acme", replacement: "Repeated slot." }
]);
assert.deepEqual(adds.changes.map((change) => change.targetId), ["add-1", "add-3", "add-4"]);
assert.deepEqual(adds.changes[0].target, { sectionId: "experience", entryId: "acme" }, "each change echoes the server's target");
assert.ok(adds.changes.every((change) => change.evidence === "profile"), "every new bullet is labelled Profile");
assert.equal(adds.changes[0].warnings, undefined, "a grounded Acme bullet has no warning");
assert.equal(adds.changes[1].warnings, undefined, "a grounded CareFlow bullet has no warning");
assert.ok(unsupported(adds.changes[2].warnings), "an ungrounded tool and number stay reviewable with a warning");
assert.deepEqual(adds.withheld.reasons.sort(), ["INVALID_TARGET", "MALFORMED", "UNCHANGED"],
  "a repeated bullet is a no-op, a third slot is invalid, and a reused slot is malformed");
assert.equal(adds.withheld.count, 2, "only the invalid and malformed adds count as withheld");

const slotChecks = review([
  { targetId: "add-2", replacement: "Automated release notes with GitHub Actions." },
  { targetId: "add-3", entryId: "acme", replacement: "Automated release notes with GitHub Actions." }
]);
assert.equal(slotChecks.changes.length, 0, "a new bullet that omits or misnames its entry is not applied");
assert.deepEqual(slotChecks.withheld.reasons, ["INVALID_TARGET"]);

const repeats = review([
  { targetId: "add-1", entryId: "acme", replacement: "Automated release notes with GitHub Actions." },
  { targetId: "add-2", entryId: "acme", replacement: "Automated release notes with <b>GitHub Actions</b>." },
  { targetId: idFor("b-careflow"), replacement: redisRewrite },
  { targetId: "add-3", entryId: "careflow", replacement: redisRewrite }
]);
assert.deepEqual(repeats.changes.map((change) => change.targetId), [idFor("b-careflow"), "add-1"],
  "a new bullet repeating another change to the same entry is a no-op; edits are listed before new bullets");
assert.deepEqual(repeats.withheld, { count: 0, reasons: ["UNCHANGED"] });
const addThenRewrite = review([
  { targetId: "add-3", entryId: "careflow", replacement: redisRewrite },
  { targetId: idFor("b-careflow"), replacement: redisRewrite }
]);
assert.deepEqual(addThenRewrite.changes.map((change) => change.targetId), [idFor("b-careflow")],
  "when a rewrite and a new bullet share text, the existing bullet is rewritten, whichever comes first");
assert.equal(
  review([{ targetId: idFor("b-acme"), replacement: "Built internal JavaScript tools for support teams and on-call staff." }]).changes[0].target.bulletId,
  "b-acme",
  "an existing bullet's echo names the bullet"
);

// Adds only use budget the existing targets leave, even when the budget binds.
const crowded = {
  ...scope,
  sections: [{
    ...scope.sections[0],
    entries: scope.sections[0].entries.map((entry) => ({
      ...entry,
      bullets: Array.from({ length: 160 }, (_, index) => ({ id: `${entry.id}-${index}`, text: `Built ${entry.id} backend feature ${index} with Redis, PostgreSQL, and GitHub Actions for clinic scheduling latency.` }))
    }))
  }, scope.sections[1]]
};
const crowdedWith = selectPromptTargets(flattenResumeTargets(crowded, profile), jobText);
const crowdedWithout = selectPromptTargets(flattenResumeTargets(crowded), jobText);
assert.ok(crowdedWithout.omittedCount > 0, "the crowded fixture exceeds the prompt budget");
assert.deepEqual(
  crowdedWith.selectedTargets.filter((target) => target.kind !== "new-bullet").map((target) => target.targetId),
  crowdedWithout.selectedTargets.map((target) => target.targetId),
  "a linked Profile never displaces an existing target under budget pressure"
);
assert.equal(crowdedWith.omittedCount, crowdedWithout.omittedCount, "unsent new-bullet slots never count as omitted fields");

// The client flattens the raw scope it sent; the server flattens its
// normalized copy. Both must number every target the same way.
const rawScope = {
  ...scope,
  sections: [
    { ...scope.sections[0], heading: "<align=center>Experience</align>" },
    { id: "blank", heading: "<align=center></align>", type: "standard", entries: [
      { id: "acme-2", titleLeft: "Acme Corp", titleRight: "", subtitleLeft: "Contractor", subtitleRight: "", bullets: [{ id: "b-blank", text: "Contract work." }] }
    ] },
    { id: "markup", heading: "Markup", type: "standard", entries: [
      { id: "markup-entry", titleLeft: "Markup Co", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [
        { id: "b-markup-only", text: "<align=left></align>" },
        { id: "b-markup-real", text: "<align=left>Shipped a real change.</align>" }
      ] }
    ] },
    { id: "edu", heading: "<align=center>Education</align>", type: "standard", entries: [
      { id: "degree", titleLeft: "State University", titleRight: "", subtitleLeft: "B.S.", subtitleRight: "", bullets: [{ id: "b-degree", text: "Capstone." }] }
    ] },
    scope.sections[1]
  ]
};
const ids = (list) => list.map(({ targetId, target }) => [targetId, target.sectionId, target.entryId, target.bulletId ?? ""]);
assert.deepEqual(
  ids(flattenResumeTargets(rawScope, profile)),
  ids(flattenResumeTargets(normalizeResumeScope(rawScope), profile)),
  "client and server derive identical targets from a scope with structural markup and a blank heading"
);
assert.equal(flattenResumeTargets(rawScope, profile).some((target) => target.target.bulletId === "b-markup-only"), false,
  "a bullet holding only structural markup is never a target on either side");
assert.ok(flattenResumeTargets(rawScope, profile).some((target) => target.targetId.startsWith("add-") && target.target.entryId === "acme"),
  "a blank-heading section does not make a Profile heading ambiguous");
assert.equal(flattenResumeTargets(rawScope, profile).some((target) => target.target.sectionId === "edu"), false,
  "an Education heading with alignment markup stays locked on the client too");

const omittedScope = { ...scope, locked: { ...scope.locked, omittedEntryNames: [["Acme Corp", "Contractor"]] } };
assert.equal(flattenResumeTargets(normalizeResumeScope(omittedScope), profile).some((target) => target.target.entryId === "acme" && target.kind === "new-bullet"), false,
  "a name an omitted entry shares links nothing, so it grounds no new bullet");
// A role heading written under an employer the resume does not name exactly
// must not reach another employer's same-titled entry.
const roleScope = {
  ...scope,
  sections: [{ ...scope.sections[0], entries: [
    { id: "acme", titleLeft: "Acme Corp", titleRight: "", subtitleLeft: "Software Engineer", subtitleRight: "", bullets: [{ id: "b-a", text: "Built billing." }] },
    { id: "beta", titleLeft: "Beta Inc", titleRight: "", subtitleLeft: "Data Engineer", subtitleRight: "", bullets: [{ id: "b-b", text: "Built reports." }] }
  ] }]
};
const roleProfile = "# My years at Acme\n## Data Engineer\nBuilt Spark pipelines at Acme.";
assert.equal(flattenResumeTargets(roleScope, roleProfile).some((target) => target.kind === "new-bullet"), false,
  "a bare role heading grounds no new bullet for another employer");
const roleAdd = sanitizeResumeProposal(
  { status: "PROPOSAL", changes: [{ targetId: "add-1", entryId: "beta", replacement: "Built Spark pipelines." }] },
  flattenResumeTargets(roleScope, roleProfile), jobText, scopeText, roleProfile
);
assert.deepEqual(roleAdd.withheld.reasons, ["INVALID_TARGET"]);

// Client and server truncate the omitted-name list identically, so a long
// list cannot make them disagree about a link.
const manyOmitted = {
  header: null,
  sections: [
    { id: "exp", heading: "Experience", type: "standard", items: [
      { id: "acme", titleLeft: "Acme Corp", titleRight: "", subtitleLeft: "Engineer", subtitleRight: "", bullets: [{ id: "b1", text: "Built tools." }] }
    ] },
    { id: "old", heading: "Older roles", type: "standard", items: [
      ...Array.from({ length: 200 }, (_, index) => ({ id: `old-${index}`, titleLeft: `Filler ${index}`, titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [] })),
      { id: "old-acme", titleLeft: "Acme Corp", titleRight: "", subtitleLeft: "Contractor", subtitleRight: "", bullets: [] }
    ] }
  ]
};
const clientScope = buildResumePolishScope(manyOmitted, ["exp"], []);
const acmeProfile = "## Acme Corp\nAutomated release notes.";
assert.deepEqual(
  flattenResumeTargets(clientScope, acmeProfile).map((target) => target.targetId),
  flattenResumeTargets(normalizeResumeScope(clientScope), acmeProfile).map((target) => target.targetId),
  "a long omitted list yields identical targets on client and server"
);

for (const heading of ["<align=center>Education</align>", "<b>Education</b>", "<i>Contact</i>"]) {
  assert.equal(resumePolishSectionIsLocked(heading), true, `inline marks never unlock ${heading}`);
}

const omittedPrompt = buildResumeProposalPrompts({
  jobText,
  targets: flattenResumeTargets(normalizeResumeScope(omittedScope), profile),
  scopeText,
  candidateContext: profile,
  customInstructions: ""
});
assert.doesNotMatch(`${omittedPrompt.systemPrompt}\n${omittedPrompt.userPrompt}`, /Contractor/, "omitted entry names never reach the prompt");

const unbolded = sanitizeResumeProposal(
  { status: "PROPOSAL", changes: [{ targetId: "add-1", entryId: "acme", replacement: "Automated release notes with <b>GitHub Actions</b>." }] },
  targets, jobText, scopeText, profile, 0, false
);
assert.equal(unbolded.changes[0].replacement, "Automated release notes with GitHub Actions.", "a new bullet honors the no-bold preference");

const wire = sanitizeResumePolishWireResult({ ...adds, advice: [] });
assert.deepEqual(wire.changes.map((change) => change.evidence), ["profile", "profile", "profile"], "the client keeps the Profile label");

// ── Suggestions ──────────────────────────────────────────────────────────────
// The advice list keeps at most three items, so the cases run in two batches.
const suggest = (items) => sanitizeResumeAdvice(items, scope, jobText, profile);
const advice = [...suggest([
  { kind: "missing-evidence", sectionId: "experience", entryId: "acme", jobExcerpt: "GitHub Actions", candidateExcerpt: "", profileExcerpt: "Automated release notes with GitHub Actions.", rationale: "Show the CI automation from this internship." },
  { kind: "missing-evidence", sectionId: "experience", entryId: "acme", jobExcerpt: "Redis", candidateExcerpt: "", profileExcerpt: "Added Redis caching that cut p95 latency by 40%.", rationale: "Mention caching." },
  { kind: "add-from-profile", sectionId: "projects", entryId: "careflow", jobExcerpt: "Kubernetes", candidateExcerpt: "", profileExcerpt: "Built a Kubernetes-deployed booking API in Go.", rationale: "Consider adding Slotwise as a project." }
]), ...suggest([
  { kind: "add-from-profile", sectionId: "", entryId: "", jobExcerpt: "Redis", candidateExcerpt: "", profileExcerpt: "Added Redis caching that cut p95 latency by 40%.", rationale: "Consider adding CareFlow." },
  { kind: "add-from-profile", sectionId: "", entryId: "", jobExcerpt: "Kubernetes", candidateExcerpt: "", profileExcerpt: "Used Terraform for a home lab.", rationale: "Consider a home lab entry." },
  { kind: "add-from-profile", sectionId: "", entryId: "", jobExcerpt: "Kubernetes", candidateExcerpt: "", profileExcerpt: "Built a Kubernetes booking API.", rationale: "Consider adding Slotwise." }
])];
assert.equal(advice.length, 6, "every suggestion is kept");
assert.equal(advice[0].warnings, undefined, "an exact quote from the entry's own Profile block is confirmed");
assert.deepEqual(advice[1].warnings, [UNCONFIRMED], "another entry's Profile text is not this entry's evidence");
assert.equal(advice[2].warnings, undefined, "an unlinked Profile block can be suggested for the resume");
assert.deepEqual([advice[2].sectionId, advice[2].entryId], ["", ""], "an add-from-profile suggestion names no resume entry");
assert.deepEqual(advice[3].warnings, [UNCONFIRMED], "a block already linked to the resume is not an add suggestion");
assert.deepEqual(advice[4].warnings, [UNCONFIRMED], "general Profile text is not a heading block");
assert.deepEqual(advice[5].warnings, [UNCONFIRMED], "a quote that is not word for word stays unconfirmed");

const sharedName = { ...scope, sections: [...scope.sections, { id: "more", heading: "More", type: "standard", entries: [
  { id: "slotwise-a", titleLeft: "Slotwise", titleRight: "", subtitleLeft: "Founder", subtitleRight: "", bullets: [] },
  { id: "slotwise-b", titleLeft: "Slotwise", titleRight: "", subtitleLeft: "Advisor", subtitleRight: "", bullets: [] }
] }] };
assert.deepEqual(
  sanitizeResumeAdvice([{ kind: "add-from-profile", sectionId: "", entryId: "", jobExcerpt: "Kubernetes", candidateExcerpt: "", profileExcerpt: "Built a Kubernetes-deployed booking API in Go.", rationale: "Consider adding Slotwise." }], sharedName, jobText, profile)[0].warnings,
  [UNCONFIRMED],
  "a heading naming two resume entries is on the resume, even though it links to neither"
);

console.log("resume Profile-polish probes passed");
