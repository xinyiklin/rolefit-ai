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
assert.ok(unsupportedTerminology('Built CI/CD pipelines.', 'Built continuous integration pipelines.', jobTerminology(job).terms).length);
assert.equal(unsupportedTerminology('Used k8s.', 'Used Kubernetes.', jobTerminology(job).terms).length, 0);
const categoryTerms = ['database', 'frontend', 'backend', 'rest api', 'algorithms'].map((keyword) => ({ keyword, phrase: keyword, category: 'required' }));
for (const [replacement, evidence] of [
  ['Tuned PostgreSQL database queries.', 'Tuned PostgreSQL queries.'],
  ['Built a React frontend and a Node.js backend.', 'Clinic platform with React and Node.js.'],
  ['Built REST APIs for rate lookups.', 'Built Django REST Framework endpoints for rate lookups.'],
  ['Implemented scheduling algorithms.', 'Wrote an algorithmic route scheduler.']
]) assert.deepEqual(unsupportedTerminology(replacement, evidence, categoryTerms), [], `${evidence} entails ${replacement}`);
assert.equal(unsupportedTerminology('Designed the database schema.', 'Built React forms.', categoryTerms).length, 1, 'a category needs specific evidence');
const cloudTerm = [{ keyword: 'cloud', phrase: 'cloud', category: 'required' }];
assert.deepEqual(unsupportedTerminology('Deployed the frontends to AWS Amplify cloud hosting.', 'Deployed with AWS Amplify frontends.', cloudTerm), [], 'AWS entails cloud');
assert.equal(unsupportedTerminology('Deployed to cloud hosting.', 'Deployed to an on-premises server.', cloudTerm).length, 1, 'cloud needs a named provider');
assert.equal(unsupportedTerminology('Deployed to cloud hosting.', 'No AWS or other cloud experience.', cloudTerm).length, 1, 'a denied provider entails no cloud');
assert.deepEqual(unsupportedTerminology('Built backend services.', 'Built REST services with Express.js.', categoryTerms), [], 'Express.js entails backend');
const pythonTerm = [{ keyword: 'python', phrase: 'Python', category: 'required' }];
assert.deepEqual(unsupportedTerminology('Built Python services.', 'Built Django REST endpoints.', pythonTerm), [], 'Django entails Python');
assert.equal(unsupportedTerminology('Built Python services.', 'Washed each flask after the assay.', pythonTerm).length, 1, 'a lab flask is not Flask');
assert.equal(unsupportedTerminology('Built Python services.', 'Built Django admin pages. No Python experience.', pythonTerm).length, 1, 'a denied language is not entailed');
assert.equal(unsupportedTerminology('Tuned the database.', 'Have not used PostgreSQL.', categoryTerms).length, 1, 'denied evidence entails nothing');
assert.equal(unsupportedTerminology('Built a PostgreSQL schema.', 'Designed the database schema.', [{ keyword: 'postgresql', phrase: 'PostgreSQL', category: 'required' }]).length, 1, 'a category never entails a specific tool');
for (const [replacement, evidence] of [
  ['Built frontend dashboards.', 'Helped on-call staff react to incidents.'],
  ['Built backend services.', 'Titrated each flask by hand in the lab.'],
  ['Designed the database.', 'Talked with Mongo about the roadmap.'],
  ['Built backend services.', 'Have not built a backend. Used Django templates for the admin pages.'],
  ['Built frontend dashboards.', 'React to pager alerts within five minutes.'],
  ['Built frontend dashboards.', 'Angular momentum simulations for the physics lab.'],
  ['Built backend services.', 'Flask cultures were prepared for the assay.'],
  ['Built backend services.', 'Analyst at American Express.'],
  ['Designed the database.', 'Paired with Cassandra on the roadmap.']
]) assert.equal(unsupportedTerminology(replacement, evidence, categoryTerms).length, 1, `${evidence} entails nothing`);
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
const warnedMetric = {original:'Maintained PostgreSQL reports.',current:'Maintained PostgreSQL reports, reducing runtime by 50%.'};
assert.deepEqual(lostAcceptedTerms(snapshot,'job-a',accepted[0].current,accepted,[warnedMetric]),[],
 'an unrelated metric warning must not hide originally supported retained terminology');
assert.deepEqual(lostAcceptedTerms(snapshot,'job-a',accepted[0].current,accepted,[{...warnedMetric,current:'Maintained Postgres reports, reducing runtime by 50%.'}]),[],
 'a retained true alias also preserves the supported mention');
for (const uncertain of [
 {original:'Maintained reports.',current:warnedMetric.current},
 {...warnedMetric,current:'Maintained reports, reducing runtime by 50%.'},
 {...warnedMetric,current:'No PostgreSQL experience.'},
 {...warnedMetric,current:'Currently learning PostgreSQL.'}
]) assert.equal(lostAcceptedTerms(snapshot,'job-a',accepted[0].current,accepted,[uncertain]).length,1,
 'new, removed, negated or aspirational terms in a warned field cannot suppress a real loss');

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
 ['Built [add metric] Python tools.',false,true],
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
assert.deepEqual(unsupportedTerminology('Express interest in customer needs.', 'Built Python APIs.', jobTerminology('Required Qualifications:\nExpress interest in customer needs.').terms), []);
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
// A held-back edit the user restored and accepted carries its warnings like a kept one.
const heldPrior = {documentGeneration:1,suggestedChanges:[],review:'REVIEWED',heldBack:[{reason:'INCORRECT',suggestion:prior.suggestedChanges[0]}]};
assert.equal(currentResumeConcerns(heldPrior,currentTargets,1).length,1);
assert.equal(currentResumeConcerns(heldPrior,[target],1).length,0,'an unrestored held-back edit never reached the document');
const fit = sanitizeFitAssessmentResponse({status:'ASSESSED',verdict:'STRONG',summary:'The candidate has 10 years of Kubernetes experience.',matches:[{jobExcerpt:'Build Python services.',candidateExcerpt:'Built Python services.',candidateSource:'resume'}],gaps:[]},{jobText:'Build Python services.',resumeText:'Built Python services.',candidateContext:''});
assert.ok(fit?.warnings?.some(w => w.startsWith('Summary:')));
console.log('Reviewer regressions passed: punctuation, ordinary Go, absent advice references, repeated Polish source concerns, and unsupported Fit summary.');
const proseInput={jobText:'Build Python services. Kubernetes experience preferred.',resumeText:'Built Python services.',candidateContext:''};
const proseBase={status:'ASSESSED',verdict:'LIMITED',matches:[],gaps:[]};
for(const patch of [
 {summary:'The candidate has 10 years of Kubernetes experience.'},
 {eligibility:{status:'CLEAR',note:'The candidate has 10 years of Kubernetes experience.'}}
]) {
 const result=sanitizeFitAssessmentResponse({...proseBase,...patch},proseInput);
 assert.ok(result?.warnings?.length,'unsupported explanatory assertions warn');
}
const absence=sanitizeFitAssessmentResponse({...proseBase,summary:'Kubernetes experience is not shown in the resume.'},proseInput);
assert.ok(absence);
assert.equal(absence.warnings?.length??0,0,'truthful absence observation is not a candidate experience assertion');
