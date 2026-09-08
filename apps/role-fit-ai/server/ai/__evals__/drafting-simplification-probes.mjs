import assert from "node:assert/strict";
import { sanitizeJobAnalysis } from "../jobAnalysis.ts";
import { reviewProviderFindings } from "../applicationReview.ts";
import { localApplicationReview } from "../../../shared/applicationReviewContract.ts";
import { coverLetterParagraphClaims } from "../coverLetterParagraphEvidence.ts";

for (const prefix of ["Responsibilities\nBuild Python services.", "Benefits\nHealth insurance."]) {
  const result = sanitizeJobAnalysis({ requiredQualifications: ["Python experience."] }, `${prefix}\nWhat you bring\nPython experience.`);
  assert.deepEqual(result.requiredQualifications, ["Python experience."]);
}
const concise = sanitizeJobAnalysis({ responsibilities: ["Build Python services.", "Maintain SQL databases."] }, "Responsibilities\nBuild Python services and maintain SQL databases.");
assert.deepEqual(concise.responsibilities, ["Build Python services.", "Maintain SQL databases."]);
assert.deepEqual(concise.conditionIssues, []);
for (const original of ["Python or Java experience is required.", "Python experience is not required.", "Python experience is required unless equivalent experience is demonstrated."]) {
  const result = sanitizeJobAnalysis({ requiredQualifications: ["Python experience is required."] }, original);
  assert.deepEqual(result.requiredQualifications, [original]);
}
assert.deepEqual(sanitizeJobAnalysis({requiredQualifications:["Python experience is required."]}, "Python experience is preferred.").requiredQualifications, ["Python experience is preferred."]);
assert.equal(sanitizeJobAnalysis({workAuth:"Visa sponsorship is available."}, "We do not offer visa sponsorship.").workAuth, "We do not offer visa sponsorship.");

const input = {jobText:"Build Python services.", company:"Acme", role:"Engineer", includeResume:true, includeCoverLetter:false, resumeText:"Built Python services with Kubernetes.", coverLetterText:"", evidence:[{id:"original",kind:"resume",label:"Loaded resume evidence",text:"Built Python services."}]};
for (const recovery of ["Remove Kubernetes; the source only shows Python.", "Use 2 bullets to explain the Python work."]) {
  const result = reviewProviderFindings({coverageComplete:true,overflow:false,findings:[{code:"revision",document:"resume",anchor:input.resumeText,message:"Check this bullet.",recovery,evidenceId:"original",sourceExcerpt:input.evidence[0].text}]},input,localApplicationReview(input));
  assert.equal(result.findings.length, 1);
  assert.equal(result.complete, true);
}
const evidence = [{id:"a",source:"resume",entry:"Atlas project",text:"Built reporting services using Python."}];
const resolved = {company:"Acme",role:"Engineer",candidateName:"Jordan Lee"};
for (const text of ["Using Python, I built reporting services.", "Acme builds tools for clinicians."]) {
  const result = coverLetterParagraphClaims({paragraphs:[{text,evidenceIds:["a"],slotIds:[]}],evidence,authoredProse:"",jobText:"Acme builds software tools for clinicians.",resolved});
  assert.equal(result.issues.length, 0);
}
for (const source of ["I have never used Python.", "I am currently learning Python."]) {
  const result = coverLetterParagraphClaims({paragraphs:[{text:"I built Python services.",evidenceIds:["a"],slotIds:[]}],evidence:[{...evidence[0],text:source}],authoredProse:"",jobText:"Build Python services.",resolved});
  assert.ok(result.issues.length);
}
console.log("Drafting simplification positives and explicit-conflict regressions passed");

const shortName = coverLetterParagraphClaims({
  paragraphs:[{text:"I maintained Kubernetes deployments.", evidenceIds:["b"], slotIds:[]}],
  evidence:[{id:"a",source:"resume",entry:"AI",text:"Built Python services."}, {id:"b",source:"resume",entry:"Beacon project",text:"Maintained Kubernetes deployments."}],
  authoredProse:"",jobText:"Build Kubernetes deployments.",resolved
});
assert.deepEqual(shortName.issues, [], "entry identity must match whole names, not letters inside maintained");
