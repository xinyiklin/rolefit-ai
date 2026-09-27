import assert from "node:assert/strict";
import { bindApplicationAnswers, bindApplicationRoleDescriptions } from "../../../server/ai/applicationAnswers.ts";

const question = "Describe relevant work.";
const job = "Acme seeks Python, Kubernetes, and continuous delivery experience.";
const fixtures = [
  { label: "supported", text: "I built Python APIs.", evidence: "Built Python APIs.", warning: false },
  { label: "unsupported tool", text: "I deployed Kubernetes clusters.", evidence: "Built Python APIs.", warning: true },
  { label: "unsupported metric", text: "I built Python APIs serving 500 users.", evidence: "Built Python APIs.", warning: true },
  { label: "negated evidence", text: "I deployed Kubernetes clusters.", evidence: "No Kubernetes experience. Built Python APIs.", warning: true },
  { label: "contradictory evidence", text: "I deployed Kubernetes clusters.", evidence: "Deployed Kubernetes clusters. No Kubernetes experience.", warning: true },
  { label: "ownership increase", text: "I led the platform migration.", evidence: "Helped with the platform migration.", warning: true },
  { label: "safe placeholder", text: "[add: your reason]", evidence: "Built Python APIs.", warning: false }
];
const counts = { missedWarnings: 0, falseWarnings: 0, incorrectlyWithheld: 0, unsafeAccepted: 0 };
for (const fixture of fixtures) {
  let result;
  try {
    result = bindApplicationAnswers([
      { questionId: "question-1", question, answer: fixture.text },
      { questionId: "question-2", question: "Anything else?", answer: "I built Python APIs." }
    ], [question, "Anything else?"], job, fixture.evidence);
  } catch { counts.incorrectlyWithheld++; continue; }
  assert.equal(result.length, 2, `${fixture.label}: usable batch siblings survive`);
  assert.equal(result[0].answer, fixture.text, `${fixture.label}: exact text survives`);
  const warned = Boolean(result[0].warnings?.length);
  if (fixture.warning && !warned) counts.missedWarnings++;
  if (!fixture.warning && warned) counts.falseWarnings++;
}
const roles = [
  { id: "role-1", label: "Developer at Acme", bullets: ["Built Python APIs."] },
  { id: "role-2", label: "Engineer at Beta", bullets: ["Deployed Kubernetes clusters."] }
];
const roleResult = bindApplicationRoleDescriptions([
  { roleId: "role-1", description: "Deployed Kubernetes clusters." },
  { roleId: "role-2", description: "Deployed Kubernetes clusters." }
], roles, job);
assert.match(roleResult[0].warnings.join(" "), /for this role/);
assert.equal(roleResult[1].warnings, undefined);
for (const answer of ["", {}, "<script>alert(1)</script>", "x".repeat(4001)]) {
  try { bindApplicationAnswers([{ questionId: "question-1", question, answer }], [question], job, "Built Python APIs."); counts.unsafeAccepted++; }
  catch (error) { assert.equal(error.status, 502); }
}
try {
  bindApplicationRoleDescriptions([{ roleId: "wrong-role", description: "Built Python APIs." }, { roleId: "role-2", description: "Deployed Kubernetes clusters." }], roles, job);
  counts.unsafeAccepted++;
} catch (error) { assert.equal(error.status, 502); }
assert.deepEqual(counts, { missedWarnings: 0, falseWarnings: 0, incorrectlyWithheld: 0, unsafeAccepted: 0 });
console.log("Application answer warning expectations:", JSON.stringify(counts));
