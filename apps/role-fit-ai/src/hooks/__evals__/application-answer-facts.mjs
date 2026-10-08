// Saved user facts through the production hook: Save keeps them, a reload and
// Reopen restore them, refinements resend them, and answer text never joins them.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const scheduler = `
let slots=[],cursor=0,effects=[];
export function useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];}
export function useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];}
export function useEffect(effect,deps){const index=cursor++;const old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:effect()};});}}
export function render(callback){cursor=0;const result=callback();const pending=effects;effects=[];pending.forEach(effect=>effect());return result;}
export function unmount(){for(const slot of slots)slot?.cleanup?.();slots=[];effects=[];}
`;
const bundle = await build({
  stdin: { contents: `export {useApplicationAnswers} from './src/hooks/useApplicationAnswers.ts'; export * from './shared/applicationAnswersContract.ts'; export {parseSavedApplicationAnswers} from './shared/applicationAnswerStorage.ts'; export {render,unmount} from 'react';`, resolveDir: fileURLToPath(new URL("../../../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "node",
  plugins: [{ name: "controlled-hooks", setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
    api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: scheduler, loader: "js" }));
  } }]
});
const { useApplicationAnswers, extractAnswerConstraints, validateAnswerConstraints, parseSavedApplicationAnswers, render, unmount } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const saves = [];
const requests = [];
let args = {
  conversationId: "preparation-a", applicationId: "application-a", resumeText: "Built a clinic app.", jobDescription: "Build reliable services.", rawJobText: "Original posting.", jobUrl: "https://example.test/job",
  candidateContext: "Clinic software project.", profileLimitMessage: null, customInstructions: "", sourceWarnings: [],
  aiRequest: { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "low" }, providerReady: true, providerMessage: "", savedAnswers: [],
  onSaveAnswer: (answer) => new Promise((resolve, reject) => saves.push({ answer, resolve, reject }))
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (_url, options) => new Promise((resolve) => requests.push({ body: JSON.parse(options.body), resolve }));
const hook = () => render(() => useApplicationAnswers(args));
function respond(request, text, extra = {}) {
  const { body } = request;
  const constraints = extractAnswerConstraints(body.question.text);
  const validation = validateAnswerConstraints(text, constraints);
  request.resolve(new Response(JSON.stringify({ answer: {
    id: body.answerRevisionId, applicationId: body.applicationId, questionId: body.question.id, questionRevision: body.question.revision, question: body.question.text,
    answer: text, constraints, counts: validation.counts, compliant: validation.compliant, status: validation.compliant ? "ready" : "draft",
    generation: { provider: body.provider, model: body.model, reasoningEffort: body.reasoningEffort, createdAt: "2026-10-07T00:00:00.000Z", attempts: 1, promptVersion: "synthetic-test" },
    sources: { resumeFingerprint: "a".repeat(64), profileFingerprint: "b".repeat(64), jobFingerprint: "c".repeat(64), rawJobFingerprint: "d".repeat(64), factsFingerprint: "e".repeat(64) }, ...extra } })));
}
// Sends the composer and answers the request; returns the request body.
async function exchange(text, extra) {
  const sent = requests.length;
  const pending = hook().send();
  assert.equal(requests.length, sent + 1, "the composer was sent");
  const request = requests.at(-1);
  respond(request, text, extra);
  await pending;
  return request.body;
}
async function saveMessage(messageId) {
  const started = saves.length;
  const pending = hook().save(messageId);
  assert.equal(saves.length, started + 1, "Save reached persistence");
  const save = saves.at(-1);
  save.resolve({ id: args.applicationId });
  await pending;
  return save.answer;
}
const lastMessage = () => hook().conversation.messages.at(-1);
const savedRecord = (answer, minute) => ({ ...answer, savedAt: `2026-10-07T00:0${minute}:00.000Z` });

const factA = "I led the postmortem after the March outage.";
const factB = "I paused a failing data migration and rolled it back.";
const generatedA = "After the March outage I led the postmortem and fixed the runbook.";
const editedA = "I led our March outage postmortem and rewrote the runbook.";
const followUp = "Which incident did you lead?";
try {
  // Question 1: the model asks for a detail, the user adds fact A.
  hook().newQuestion("Describe a time you handled an incident.");
  await exchange("", { status: "needs-input", clarification: followUp });
  assert.equal(hook().conversation.composerMode, "clarification");
  hook().setComposer(factA);
  const clarified = await exchange(generatedA);
  assert.deepEqual(clarified.explicitFacts, [factA]);
  const q1 = lastMessage();
  assert.deepEqual(q1.facts, [factA]);
  hook().editAnswer(q1.id, editedA);
  const savedQ1 = await saveMessage(q1.id);
  assert.deepEqual(savedQ1.userFacts, { provenance: "user-declared", facts: [factA] }, "Save keeps the question's facts with user-declared provenance");
  assert.equal(savedQ1.answer, editedA);
  for (const text of [generatedA, editedA, followUp]) assert.ok(!savedQ1.userFacts.facts.includes(text), "generated text, edits and the model's follow-up never become facts");

  // A refinement instruction is not a fact.
  hook().refine(q1.id, "Shorter");
  const refined = await exchange("I led the March outage postmortem.");
  assert.deepEqual(refined.explicitFacts, [factA]);
  assert.equal(refined.refinement, "Shorter");
  const savedRefined = await saveMessage(lastMessage().id);
  assert.deepEqual(savedRefined.userFacts.facts, [factA], "a refinement instruction never joins the facts");

  // Question 2 in the same application gets its own fact.
  hook().newQuestion("Tell us about a mistake you corrected.");
  const q2Start = await exchange("", { status: "needs-input", clarification: "What went wrong?" });
  assert.deepEqual(q2Start.explicitFacts, [], "a new question starts without another question's facts");
  hook().setComposer(factB);
  const q2Clarified = await exchange("I paused a failing migration and rolled it back.");
  assert.deepEqual(q2Clarified.explicitFacts, [factB]);
  const savedQ2 = await saveMessage(lastMessage().id);
  assert.deepEqual(savedQ2.userFacts.facts, [factB]);

  // A question without facts saves without them, and a response cannot supply facts.
  hook().newQuestion("Why this company?");
  await exchange("Its reliability work matches mine.");
  const savedPlain = await saveMessage(lastMessage().id);
  assert.equal(savedPlain.userFacts, undefined, "no facts means no userFacts field");
  hook().newQuestion("Why now?");
  await exchange("Timing fits.", { userFacts: { provenance: "user-declared", facts: ["Injected by a response."] } });
  assert.equal(lastMessage().response, undefined, "a generated response carrying facts is rejected");
  assert.match(hook().conversation.status, /did not match/);

  // A repaired draft can keep its text and still ask a follow-up. The detail the
  // user types in reply is a fact; a chip on that draft is an instruction.
  const followUpDraft = { status: "draft", clarification: "Which project should this mention?" };
  hook().newQuestion("Describe a project you are proud of.");
  await exchange("I built a scheduling tool for a clinic.", followUpDraft);
  const draftOnly = lastMessage();
  assert.equal(hook().conversation.composerMode, "clarification", "a follow-up beside draft text defaults to Add a detail");
  const savedDraftOnly = await saveMessage(draftOnly.id);
  assert.equal(savedDraftOnly.userFacts, undefined);
  hook().refine(draftOnly.id, "Shorter");
  assert.equal(hook().conversation.composerMode, "refinement");
  const chipRequest = await exchange("I built a clinic scheduling tool.");
  assert.deepEqual(chipRequest.explicitFacts, [], "a chip is never sent as a fact");
  assert.equal(chipRequest.refinement, "Shorter");
  assert.equal(chipRequest.clarification, undefined);
  assert.equal((await saveMessage(lastMessage().id)).userFacts, undefined, "a chip is never saved as a fact");
  const clinic = "It was for the Riverside clinic.";
  hook().newQuestion("Which project best shows your skills?");
  await exchange("I built a scheduling tool for a clinic.", { status: "draft", clarification: "Which clinic was it for?" });
  hook().setComposer(clinic);
  const typedDetail = await exchange("I built a scheduling tool for the Riverside clinic.");
  assert.deepEqual(typedDetail.explicitFacts, [clinic], "a detail typed in reply to a follow-up on draft text is sent as a fact");
  assert.equal(typedDetail.clarification, clinic);
  assert.equal(typedDetail.refinement, undefined);
  assert.deepEqual((await saveMessage(lastMessage().id)).userFacts, { provenance: "user-declared", facts: [clinic] }, "and saved as one");
  const factC = "The tool cut double-bookings for the front desk.";
  hook().newQuestion("What impact did your work have?");
  await exchange("", { status: "needs-input", clarification: "What changed for users?" });
  hook().refine(lastMessage().id, "Shorter");
  assert.equal(hook().conversation.composerMode, "refinement", "an instruction is never a fact, even on a follow-up");
  hook().refine(lastMessage().id);
  assert.equal(hook().conversation.composerMode, "clarification", "Add the detail on an empty follow-up still expects a fact");
  hook().setComposer(factC);
  await exchange("It reduced double-bookings.", followUpDraft);
  const draftWithFact = lastMessage();
  const savedDraftWithFact = await saveMessage(draftWithFact.id);
  assert.deepEqual(savedDraftWithFact.userFacts.facts, [factC]);
  hook().refine(draftWithFact.id, "More natural");
  assert.deepEqual((await exchange("It cut double-bookings.")).explicitFacts, [factC], "a chip keeps the question's facts and adds none");
  assert.deepEqual((await saveMessage(lastMessage().id)).userFacts.facts, [factC]);
  hook().refine(draftWithFact.id);
  assert.equal(hook().conversation.composerMode, "clarification", "Add the detail on a draft with a follow-up expects a fact");
  hook().setComposer("It was the clinic scheduling project.");
  assert.deepEqual((await exchange("It cut double-bookings at the clinic.")).explicitFacts, [factC, "It was the clinic scheduling project."]);

  // Reload: a fresh hook opens the saved tracker revisions.
  const preChange = { id: "older-revision", applicationId: "application-a", questionId: "older-question", questionRevision: 1, question: "Why engineering?", answer: "I like practical problems.",
    constraints: [], counts: validateAnswerConstraints("I like practical problems.", []).counts, compliant: true, status: "ready", savedAt: "2026-10-01T00:00:00.000Z" };
  const legacy = { question: "Where are you based?", answer: "Toronto.", savedAt: "2026-09-01T00:00:00.000Z" };
  const stored = [legacy, preChange, savedRecord(savedQ1, 1), savedRecord(savedQ2, 2), savedRecord(savedPlain, 3), savedRecord(savedDraftOnly, 5), savedRecord(savedDraftWithFact, 6)];
  assert.ok(parseSavedApplicationAnswers(stored, "application-a"), "the saved revisions are valid tracker records");
  unmount();
  args = { ...args, savedAnswers: stored };
  assert.equal(hook().conversation.messages.length, 0, "reload starts from saved records only");

  hook().reopen(stored[2]);
  const reopenedQ1 = lastMessage();
  assert.deepEqual(reopenedQ1.facts, [factA], "Reopen restores the saved facts");
  assert.equal(reopenedQ1.response.userFacts, undefined, "restored facts live on the message, not in the answer revision");
  assert.equal(reopenedQ1.instruction, undefined);
  hook().refine(reopenedQ1.id, "Shorter");
  const afterReload = await exchange("I led the March postmortem.");
  assert.deepEqual(afterReload.explicitFacts, [factA], "shortening the reopened answer sends the restored fact as an explicit fact");
  assert.equal(afterReload.refinement, "Shorter");
  assert.equal(afterReload.clarification, undefined);
  assert.equal(afterReload.previousAnswer.text, editedA);
  hook().editAnswer(reopenedQ1.id, "I led the March outage postmortem.");
  const resaved = await saveMessage(reopenedQ1.id);
  assert.deepEqual(resaved.userFacts.facts, [factA], "an edited reopened answer keeps its facts");
  assert.equal(resaved.previousAnswerId, savedQ1.id);

  hook().reopen(stored[3]);
  assert.deepEqual(lastMessage().facts, [factB]);
  hook().refine(lastMessage().id, "Shorter");
  assert.deepEqual((await exchange("I rolled back a failing migration.")).explicitFacts, [factB], "each question keeps its own facts");
  for (const [record, label] of [[stored[1], "pre-change revision"], [stored[0], "legacy pair"], [stored[4], "revision saved without facts"]]) {
    hook().reopen(record);
    assert.deepEqual(lastMessage().facts, [], `${label} reopens without facts`);
  }
  hook().reopen(stored[5]);
  assert.equal(hook().conversation.composerMode, "clarification", "a reopened draft with a follow-up defaults to Add a detail");
  hook().refine(lastMessage().id, "Shorter");
  assert.deepEqual((await exchange("I built a clinic scheduling tool.")).explicitFacts, []);
  assert.equal((await saveMessage(lastMessage().id)).userFacts, undefined, "after Reopen a chip is still never saved as a fact");
  hook().reopen(stored[6]);
  assert.equal(hook().conversation.composerMode, "clarification");
  hook().setComposer(clinic);
  assert.deepEqual((await exchange("It cut double-bookings at the Riverside clinic.")).explicitFacts, [factC, clinic], "after Reopen a typed detail joins the restored facts");
  assert.deepEqual((await saveMessage(lastMessage().id)).userFacts.facts, [factC, clinic]);
  hook().reopen(stored[6]);
  hook().refine(hook().conversation.targetMessageId, "Shorter");
  assert.deepEqual((await exchange("It cut double-bookings.")).explicitFacts, [factC], "after Reopen a chip keeps the restored facts and adds none");
  assert.deepEqual((await saveMessage(lastMessage().id)).userFacts.facts, [factC]);
  hook().newQuestion("What else should we know?");
  assert.deepEqual((await exchange("Nothing else.")).explicitFacts, [], "a new question after a reopen starts without facts");
  console.log("Answers saved facts passed: user-declared Save, reload and Reopen, refinement resend, per-question scope, older answers, and no facts from answer text or chips");
} finally { unmount(); globalThis.fetch = originalFetch; }
