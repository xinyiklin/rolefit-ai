import assert from "node:assert/strict";
import { normalizeResumeScope } from "../resumeScope.ts";
import {
  flattenResumeTargets,
  resumePolishSectionIsLocked,
  sanitizeResumePolishWireResult
} from "../../../shared/resumePolishContract.ts";
import { sanitizeResumeAdvice, sanitizeResumeProposal, selectPromptTargets, buildResumeProposalPrompts } from "../resumeProposal.ts";
import { accomplishmentStyleRules } from "../prompts.ts";
const sections = Array.from({ length: 14 }, (_, s) => ({
  id: `s${s}`,
  heading: s === 13 ? "Academic Projects" : "Projects",
  type: "standard",
  entries: [
    {
      id: `e${s}`,
      titleLeft: "Personal project",
      bullets: Array.from({ length: 21 }, (_, b) => ({
        id: `b${s}-${b}`,
        text: s === 13 ? "Built Kubernetes deployment automation." : "Built Python service."
      }))
    }
  ]
}));
const scope = normalizeResumeScope({ sections });
const targets = flattenResumeTargets(scope);
assert.equal(targets.length, 294);
assert.equal(resumePolishSectionIsLocked("Academic Projects"), false);
assert.equal(resumePolishSectionIsLocked("Academic Background"), true);
assert.equal(resumePolishSectionIsLocked("Education & Training"), true);
assert.equal(
  selectPromptTargets(targets, "Kubernetes deployment automation").selectedTargets[0].target
    .sectionId,
  "s13"
);
assert.throws(() => normalizeResumeScope({ sections: [sections[0], sections[0]] }), /duplicate/);
assert.throws(
  () => normalizeResumeScope({ sections: [{ ...sections[0], heading: "x".repeat(121) }] }),
  /too long/
);
assert.doesNotMatch(
  buildResumeProposalPrompts({
    targets,
    jobText: "Kubernetes",
    scopeText: "",
    honestContext: "",
    customInstructions: ""
  }).userPrompt,
  /\[add metric/
);
assert.match(accomplishmentStyleRules(), /\[add metric/);
assert.equal(
  sanitizeResumePolishWireResult({
    status: "NO_CHANGES",
    changes: [],
    summary: [],
    omittedTargetCount: 200,
    withheld: { count: 0, reasons: [] }
  }).omittedTargetCount,
  200
);
console.log(
  "Full scope, education locks, late target ranking, and finished guidance probes passed"
);

const advice={kind:'emphasis',sectionId:'s0',entryId:'e0',jobExcerpt:'Python services',candidateExcerpt:'Built Python service.',rationale:'Highlight the Python service work.'};
assert.equal(sanitizeResumeAdvice([advice],scope,'Python services and Terraform workflows').length,1);
assert.equal(sanitizeResumeAdvice([{...advice,entryId:'not-sent'}],scope,'Python services').length,0);
assert.equal(sanitizeResumeAdvice([{...advice,rationale:'Ask for evidence of Terraform workflows before adding them.'}],scope,'Python services and Terraform workflows').length,1,'editorial guidance may discuss missing evidence without asserting it');

for (const rationale of [
  'Use 2 bullets to emphasize the Python service work.',
  'Do not add Kubernetes experience; the source only shows Python.',
  'Remove Kubernetes; the source only shows Python.'
]) {
  assert.equal(sanitizeResumeAdvice([{ ...advice, rationale }], scope, 'Python services').length, 1);
}
for (const patch of [
  { jobExcerpt: 'Not in posting' },
  { candidateExcerpt: 'Not in candidate entry' },
  { sectionId: 'not-sent' },
  { rationale: 'x'.repeat(501) }
]) {
  assert.equal(sanitizeResumeAdvice([{ ...advice, ...patch }], scope, 'Python services').length, 0);
}
const canonicalAdvice = sanitizeResumeAdvice([{ ...advice, replacement: 'Fabricated resume edit', claims: ['ignored'] }], scope, 'Python services')[0];
assert.equal('replacement' in canonicalAdvice, false);
assert.equal('claims' in canonicalAdvice, false);

const crowdedScope = normalizeResumeScope({ sections: [{
  id: 'crowded', heading: 'Experience', type: 'standard', entries: [{
    id: 'crowded-entry', titleLeft: 'Engineer',
    bullets: Array.from({ length: 25 }, (_, i) => ({ id: `crowded-${i}`, text: `Built Python service ${i}. ${'Supported reporting workflows. '.repeat(4)}` }))
  }]
}] });
const crowdedTargets = flattenResumeTargets(crowdedScope);
const crowdedSelection = selectPromptTargets(crowdedTargets, 'Python services');
assert.equal(crowdedSelection.selectedTargets.length, 25, 'entry context must not crowd out comfortably fitting targets');
assert.equal(crowdedSelection.omittedCount, 0);
assert.deepEqual(crowdedSelection.selectedTargets.map((item) => item.targetId), crowdedTargets.map((item) => item.targetId));
const crowdedPayload = JSON.parse(crowdedSelection.serialized);
assert.equal(crowdedPayload.entries.length, 1);
assert.equal(crowdedPayload.entries[0].text, crowdedTargets[0].entryText);
assert.equal(crowdedPayload.targets.every((item) => !('entryText' in item)), true);
assert.ok(crowdedSelection.serialized.length <= 42_000);

const mixedScope = normalizeResumeScope({ sections: [{
  id: 'mixed', heading: 'Experience and Projects', type: 'standard', entries: [
    'Scrum Master', 'Degree audit app', 'GPA calculator', 'Master of Science', "Bachelor's degree in Computing", 'Ph.D. in Computing', 'B.Sc. Computer Science'
  ].map((titleLeft, i) => ({ id: `mixed-${i}`, titleLeft, bullets: [{ id: `mixed-bullet-${i}`, text: 'Built Python services.' }] }))
}] });
assert.deepEqual(flattenResumeTargets(mixedScope).map((item) => item.target.entryId), ['mixed-0', 'mixed-1', 'mixed-2']);
console.log('Resume simplification: complete shared entry context, editorial advice, and precise credential locks passed');

const safeReplacement = 'Built reliable Python services.';
const claimTarget = { ...crowdedTargets[0], currentText: 'Built Python services.', entryText: 'Built reliable Python services.' };
for (const claims of [undefined, [{ claim: safeReplacement + '!', evidenceId: claimTarget.targetId, sourceExcerpt: 'Built reliable Python services.' }], { malformed: true }]) {
  const proposal = sanitizeResumeProposal({ status: 'PROPOSAL', changes: [{ targetId: claimTarget.targetId, replacement: safeReplacement, reason: 'Clarify service work.', claims }] }, [claimTarget], 'Python services', claimTarget.entryText, '');
  assert.equal(proposal.status, 'PROPOSAL', 'legacy auxiliary claims cannot reject a independently supported edit');
  assert.equal(proposal.changes[0].reason, 'Clarify service work.');
}
const boldClaim = sanitizeResumeProposal({ status: 'PROPOSAL', changes: [{ targetId: claimTarget.targetId, replacement: 'Built reliable <b>Python</b> services.', claims: [{ claim: 'Built reliable <b>Python</b> services.', evidenceId: claimTarget.targetId, sourceExcerpt: claimTarget.entryText }] }] }, [claimTarget], 'Python services', claimTarget.entryText, '', 0, false);
assert.equal(boldClaim.changes[0].replacement, safeReplacement);

{
  const scope = normalizeResumeScope({sections:[{id:"s",heading:"Projects",type:"standard",entries:[{id:"e",titleLeft:"Atlas",bullets:[{id:"b",text:"Built Python services."}]}]}]});
  const advice = {kind:"emphasis",sectionId:"s",entryId:"e",jobExcerpt:"Build Python services.",candidateExcerpt:"Built Python services.",rationale:"I led Terraform deployments and increased revenue by 99%."};
  assert.deepEqual(sanitizeResumeAdvice([advice],scope,advice.jobExcerpt),[],"explicit unsupported candidate claims are not editorial advice");
  assert.equal(sanitizeResumeAdvice([{...advice,rationale:"Use 2 bullets; do not add Terraform experience."}],scope,advice.jobExcerpt).length,1);
}
