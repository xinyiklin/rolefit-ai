import assert from 'node:assert/strict';
import { terminologyMatch } from '../../resume/keywords.ts';
import { affirmativeTerm, jobTerminology, lostAcceptedTerms, unsupportedTerminology } from '../../resume/terminology.ts';
import { sanitizeContentWarnings } from '../../../shared/contentWarnings.ts';
import { sanitizeResumeAdvice, sanitizeResumeProposal } from '../../../server/ai/resumeProposal.ts';
import { currentResumeConcerns } from '../../resume/proposalWarnings.ts';
import { sanitizeFitAssessmentResponse } from '../../../server/ai/fitAssessment.ts';
import { resumeProposalKey } from '../resumeProposalDecisionState.ts';

const matches = [
 ['Postgres', 'postgresql', 'equivalent'], ['PostgreSQL', 'postgresql', 'exact'],
 ['k8s', 'kubernetes', 'equivalent'], ['continuous integration', 'ci/cd', 'related'],
 ['CI/CD', 'ci/cd', 'exact'], ['HTML', 'html/css', 'related'],
 ['HTML and CSS', 'html/css', 'equivalent'], ['unit test', 'testing', 'related'],
 ['JWT', 'authentication', 'related'], ['data models', 'database', 'related'],
 ['ASP.NET', '.net', 'related'], ['relational database', 'postgresql', 'absent'],
 ['PostgreSQL.', 'postgresql', 'exact'], ['C++', 'c++', 'exact'],
 ['Express interest in customer needs', 'express', 'absent'],
 ['Built express.js APIs', 'express', 'equivalent'], ['Built expressjs APIs', 'express', 'equivalent'],
 ['unit tests', 'testing', 'related'], ['integration tests', 'testing', 'related'],
 ['unit testing', 'testing', 'related'], ['integration testing', 'testing', 'related'],
 ['unit-testing', 'testing', 'related'], ['unit <b>tests</b>', 'testing', 'related'],
 ['Unit tests and testing infrastructure', 'testing', 'exact'], ['Automated tests', 'testing', 'equivalent']
];
for (const [source, term, expected] of matches) assert.equal(terminologyMatch(source, term), expected, `${source}/${term}`);
for (const source of ['No Kubernetes experience.', 'Currently learning Kubernetes.', 'I have not used Kubernetes.']) assert.equal(affirmativeTerm(source, 'kubernetes'), false, source);
assert.equal(affirmativeTerm('Used PostgreSQL. Built services.', 'postgresql'), true);
const job = `Preferred Qualifications:\n${Array.from({length:25}, (_, i) => `- React project ${i}`).join('\n')}\nRequired Qualifications:\n- PostgreSQL\n- Kubernetes\n- CI/CD\nCore Responsibilities:\n- Develop REST APIs`;
const analysis = jobTerminology(job);
assert.equal(analysis.terms[0].keyword, 'postgresql');
assert.equal(analysis.terms[1].keyword, 'kubernetes');
assert.equal(analysis.terms.find(t => t.keyword === 'react').category, 'preferred');
assert.ok(analysis.limitations.length);
assert.ok(jobTerminology('Uncategorized job prose').limitations.some(t => t.includes('not assessed')));
assert.ok(unsupportedTerminology('Built CI/CD pipelines.', 'Built continuous integration pipelines.', job).length);
assert.equal(unsupportedTerminology('Used k8s.', 'Used Kubernetes.', job).length, 0);
const snapshot = {inputKey:'job-a', terms: [{keyword:'postgresql',phrase:'PostgreSQL',category:'required'}], limitations:[]};
const accepted = [{original:'Built PostgreSQL tools.',current:'Built relational database tools.'}];
assert.equal(lostAcceptedTerms(snapshot,'job-a',accepted[0].current,accepted).length,1);
for (const [key,text,decisions] of [
 ['job-a',accepted[0].current,[]], // pending or discarded
 ['job-b',accepted[0].current,accepted], // replaced job/evidence/document
 ['job-a','Skills: Postgres',accepted], // retained true alias elsewhere
 ['job-a',accepted[0].original,accepted], // Undo/manual restoration
]) assert.deepEqual(lostAcceptedTerms(snapshot,key,text,decisions),[]);
assert.equal(lostAcceptedTerms(snapshot,'job-a','Currently learning PostgreSQL.',accepted).length,1);
assert.notEqual(resumeProposalKey({runId:'one'}),resumeProposalKey({runId:'two'}));
for (const value of [[],['Review this'],Array(14).fill(0).map((_,i)=>`Concern ${i}`),{},[null],['<script>bad</script>']]) {
 const safe=sanitizeContentWarnings(value);
 assert.deepEqual(sanitizeContentWarnings(safe),safe,'warning normalization must round-trip');
}
const target={targetId:'t',kind:'bullet',section:'Projects',sectionType:'standard',currentText:'Built Python tools.',entryText:'Built Python tools.',target:{sectionId:'s',entryId:'e',bulletId:'b',field:'bullet'}};
let missedWarnings=0,falseWarnings=0,incorrectlyWithheld=0,unsafeAccepted=0;
for (const [replacement,warning,technical] of [
 ['Built reliable Python tools.',false,false],
 ['Built Kubernetes tools.',true,false],
 ['Built 500 Python tools.',true,false],
 ['Built [add metric] Python tools.',true,false],
 ['<script>steal()</script>',false,true],
 ['<b></b>',false,true],
]) {
 const result=sanitizeResumeProposal({status:'PROPOSAL',changes:[{targetId:'t',replacement}]},[target],job,target.entryText,'');
 const has=Boolean(result.changes[0]?.warnings?.length);
 if (warning&&!has) missedWarnings++;
 if (!warning&&!technical&&has) falseWarnings++;
 if (!technical&&!result.changes.length) incorrectlyWithheld++;
 if (technical&&result.changes.length) unsafeAccepted++;
}
assert.deepEqual({missedWarnings,falseWarnings,incorrectlyWithheld,unsafeAccepted},{missedWarnings:0,falseWarnings:0,incorrectlyWithheld:0,unsafeAccepted:0});
console.log(`Terminology/warning fixtures passed: ${matches.length} match cases, priority, negation, acceptance identity/Undo, warning round-trips; missed=0 false=0 withheld=0 unsafe=0`);

for (const value of ['PostgreSQL-backed services', 'PostgreSQL/MySQL']) assert.equal(affirmativeTerm(value, 'postgresql'), true);
assert.deepEqual(jobTerminology('Required Qualifications:\nGo to customer sites.').terms, []);
assert.deepEqual(jobTerminology('Required Qualifications:\nExpress interest in customer needs.').terms, []);
assert.deepEqual(unsupportedTerminology('Express interest in customer needs.', 'Built Python APIs.', 'Required Qualifications:\nExpress interest in customer needs.'), []);
assert.equal(jobTerminology('Required Qualifications:\nexpress.js').terms[0].keyword, 'express');
assert.equal(jobTerminology('Required Qualifications:\nKubernetes/Docker').terms.length, 2);
const advice = {kind:'emphasis',sectionId:'s',entryId:'e',jobExcerpt:'Kubernetes',rationale:'Emphasize service implementation.'};
assert.ok(sanitizeResumeAdvice([advice],{sections:[],contextSections:[]},'Kubernetes')[0].warnings.length);
const prior = {documentGeneration:1,suggestedChanges:[{target:target.target,currentText:target.currentText,proposedText:'Built Kubernetes tools.',warnings:['Unconfirmed']}]};
const currentTargets = [{...target,currentText:'Built Kubernetes tools.'}];
assert.equal(currentResumeConcerns(prior,currentTargets,1).length,1);
assert.equal(currentResumeConcerns(prior,currentTargets,2).length,0);
assert.equal(currentResumeConcerns(prior,[target],1).length,0);
assert.equal(currentResumeConcerns({...prior,sourceConcerns:currentResumeConcerns(prior,currentTargets,1),suggestedChanges:[]},currentTargets,1).length,1);
const fit = sanitizeFitAssessmentResponse({status:'ASSESSED',verdict:'STRONG',summary:'The candidate has 10 years of Kubernetes experience.',matches:[{jobExcerpt:'Build Python services.',candidateExcerpt:'Built Python services.',candidateSource:'resume'}],gaps:[]},{jobText:'Build Python services.',resumeText:'Built Python services.',candidateContext:''});
assert.ok(fit?.warnings?.some(w => w.startsWith('Summary:')));
console.log('Reviewer regressions passed: punctuation, ordinary Go, absent advice references, repeated Polish source concerns, and unsupported Fit summary.');
const proseInput={jobText:'Build Python services. Kubernetes experience preferred.',resumeText:'Built Python services.',candidateContext:''};
const proseBase={status:'ASSESSED',verdict:'LIMITED',matches:[],gaps:[]};
for(const patch of [
 {summary:'The candidate has 10 years of Kubernetes experience.'},
 {gaps:[{status:'NOT_SHOWN',jobExcerpt:'Kubernetes experience preferred.',note:'The candidate has 10 years of Kubernetes experience.'}]},
 {eligibility:{status:'CLEAR',note:'The candidate has 10 years of Kubernetes experience.'}}
]) {
 const result=sanitizeFitAssessmentResponse({...proseBase,...patch},proseInput);
 assert.ok(result?.warnings?.length,'unsupported explanatory assertions warn');
}
const absence=sanitizeFitAssessmentResponse({...proseBase,summary:'Kubernetes experience is not shown in the resume.'},proseInput);
assert.ok(absence);
assert.equal(absence.warnings?.length??0,0,'truthful absence observation is not a candidate experience assertion');
