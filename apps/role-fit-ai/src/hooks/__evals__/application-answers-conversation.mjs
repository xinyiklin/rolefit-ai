// Production hook with controlled scheduling: this covers async ownership and
// exact revisions without claiming browser interaction coverage.
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
  stdin: { contents: `export {useApplicationAnswers} from './src/hooks/useApplicationAnswers.ts'; export * from './shared/applicationAnswersContract.ts'; export {parseApplicationAnswerRevision} from './shared/applicationAnswerStorage.ts'; export {render,unmount} from 'react';`, resolveDir: fileURLToPath(new URL("../../../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "node",
  plugins: [{ name: "controlled-hooks", setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
    api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: scheduler, loader: "js" }));
  } }]
});
const { useApplicationAnswers, extractAnswerConstraints, validateAnswerConstraints, parseApplicationAnswerRevision, render, unmount } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
let args = {
  conversationId: "preparation-a", resumeText: "Built a clinic app.", jobDescription: "Build accessible apps.", rawJobText: "Original accessible app role.", jobUrl: "https://example.test/job", candidateContext: "Clinic software project.", profileLimitMessage: null, customInstructions: "", sourceWarnings: [],
  aiRequest: { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "low" }, providerReady: true, providerMessage: "", savedAnswers: [],
  onSaveAnswer: (answer, conversationId, preserveDraft) => new Promise((resolve, reject) => saves.push({ answer, conversationId, preserveDraft, resolve, reject }))
};
const saves = [];
const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (_url, options) => new Promise((resolve) => requests.push({ body: JSON.parse(options.body), options, resolve }));
const hook = () => render(() => useApplicationAnswers(args));
function answerFor(request, text = "Useful software.", extra = {}) {
  const { body } = request;
  const constraints = extractAnswerConstraints(body.question.text);
  const validation = validateAnswerConstraints(text, constraints);
  return { id: body.answerRevisionId, applicationId: body.applicationId, questionId: body.question.id, questionRevision: body.question.revision, question: body.question.text,
    answer: text, constraints, counts: validation.counts, compliant: validation.compliant, status: validation.compliant ? "ready" : "draft",
    generation: { provider: body.provider, model: body.model, reasoningEffort: body.reasoningEffort, createdAt: "2026-10-07T00:00:00.000Z", attempts: 1, promptVersion: "synthetic-test" }, sources: { resumeFingerprint: "a".repeat(64), profileFingerprint: "b".repeat(64), jobFingerprint: "c".repeat(64), rawJobFingerprint: "d".repeat(64), factsFingerprint: "e".repeat(64) }, ...extra };
}
function respond(request, text, extra) { request.resolve(new Response(JSON.stringify({ answer: answerFor(request, text, extra) }))); }
try {
  let state = hook();
  assert.equal(saves.length, 0, "drafting does not create a tracker record");
  const question = `${"Long employer context. ".repeat(25)}Why this role? Maximum 4 words.`;
  state.setComposer(question);
  state = hook();
  const first = state.send();
  assert.equal(requests[0].body.question.text, question, "question longer than 400 characters and trailing limit survive");
  args = { ...args, aiRequest: { ...args.aiRequest, selectedModel: "gpt-6-astra" } };
  state = hook();
  assert.equal(requests[0].options.signal.aborted, false, "model changes affect the next request only");
  respond(requests[0]);
  await first;
  state = hook();
  const messageId = state.conversation.messages[0].id;
  assert.equal(state.conversation.messages[0].response.generation.model, "gpt-6.1-sol");
  assert.equal(state.conversation.targetMessageId, messageId);
  state.editAnswer(messageId, "one two three four five");
  state = hook();
  assert.equal(state.conversation.messages[0].response.counts.words, 5);
  assert.equal(state.conversation.messages[0].response.compliant, false, "manual edits immediately invalidate compliance");
  assert.equal(state.conversation.messages[0].response.generation, undefined, "edited text does not claim AI authorship");
  await state.save(messageId);
  assert.equal(saves.length, 0, "normal save cannot pass a hard limit");
  const saveDraft = state.save(messageId, true);
  const pendingId = saves[0].answer.id;
  assert.equal(saves[0].preserveDraft, true);
  assert.equal(saves[0].answer.status, "draft");
  assert.ok(parseApplicationAnswerRevision(saves[0].answer));
  state.editAnswer(messageId, "  Better fit.  ");
  args = { ...args, conversationId: "preparation-b" };
  state = hook();
  saves[0].resolve({ id: "application-a" });
  await saveDraft;
  state = hook();
  assert.equal(state.conversation.messages.length, 0, "saving the prior application cannot publish into a new conversation");
  args = { ...args, conversationId: "preparation-a", applicationId: "application-a" };
  state = hook();
  assert.equal(state.conversation.messages[0].response.answer, "  Better fit.  ", "tab and application navigation retain exact manual edits");
  assert.equal(state.conversation.messages[0].response.counts.characters, 15);
  assert.equal(state.conversation.messages[0].savedRevisionId, pendingId);
  assert.notEqual(state.conversation.messages[0].response.id, pendingId, "late save does not mark a newer edit saved");
  const saveReady = state.save(messageId);
  await state.save(messageId);
  assert.equal(saves.length, 2, "double-click save is idempotent before persistence resolves");
  assert.equal(saves[1].answer.answer, "  Better fit.  ");
  assert.equal(saves[1].conversationId, "preparation-a");
  saves[1].resolve({ id: "application-a" });
  await saveReady;
  state = hook();
  await state.save(messageId);
  assert.equal(saves.length, 2, "saved revision is not duplicated");
  state.refine(messageId, "Shorter");
  state = hook();
  const refinement = state.send();
  assert.equal(requests[1].body.question.text, question, "refinement retains original employer question");
  assert.equal(requests[1].body.previousAnswer.text, "  Better fit.  ");
  assert.equal(requests[1].body.refinement, "Shorter");
  assert.equal(requests[1].body.applicationId, "application-a");
  respond(requests[1], "Good fit.");
  await refinement;
  state = hook();
  assert.equal(state.conversation.messages[0].response.answer, "  Better fit.  ", "refining appends without overwriting older response");
  state.editQuestion(messageId);
  state.setComposer("Why us? Under 5 words.");
  state = hook();
  const changedQuestion = state.send();
  assert.equal(requests[2].body.question.id, requests[0].body.question.id);
  assert.equal(requests[2].body.question.revision, 2, "editing an employer question creates a new revision");
  args = { ...args, resumeText: "Changed source resume." };
  state = hook();
  assert.equal(requests[2].options.signal.aborted, true);
  respond(requests[2], "Late answer.");
  await changedQuestion;
  state = hook();
  assert.equal(state.conversation.messages[2].response, undefined, "held result after source change cannot attach");
  state.newQuestion("When can you start?");
  state = hook();
  const missingFact = state.send();
  respond(requests[3], "", { status: "needs-input", clarification: "What is your earliest start date?" });
  await missingFact;
  state = hook();
  state.setComposer("I can start on November 1.");
  state = hook();
  assert.equal(state.conversation.composerMode, "clarification", "a requested missing fact is explicitly identified as evidence");
  state.setComposerMode("clarification");
  state = hook();
  const clarified = state.send();
  assert.deepEqual(requests[4].body.explicitFacts, ["I can start on November 1."]);
  respond(requests[4], "November 1.");
  await clarified;
  state = hook();
  state.setComposer("Only fix the punctuation.");
  state = hook();
  const refineFact = state.send();
  assert.deepEqual(requests[5].body.explicitFacts, ["I can start on November 1."], "follow-up keeps explicit user evidence without promoting earlier model text");
  args = { ...args, conversationId: "preparation-b" };
  state = hook();
  respond(requests[5], "November 1");
  await refineFact;
  state = hook();
  assert.equal(state.conversation.messages.length, 0, "late generation never attaches to another application");
  state.reopen({ question: "Old question", answer: "Older saved words.", savedAt: "2026-01-01T00:00:00.000Z" });
  state = hook();
  assert.equal(state.conversation.messages[0].response.generation, undefined, "legacy provenance remains unknown");
  assert.equal(state.conversation.messages[0].response.sources, undefined);
  assert.equal(saves.length, 2, "reopening never persists automatically");
  const legacyMessage = state.conversation.messages[0];
  state.editAnswer(legacyMessage.id, "Updated legacy words.");
  state = hook();
  const legacySave = state.save(legacyMessage.id);
  assert.ok(parseApplicationAnswerRevision(saves[2].answer), "reopened savedAt storage field never leaks into a revision request");
  state = hook();
  assert.equal(state.isSavingAnswers, true);
  saves[2].resolve({ id: "application-b" });
  await legacySave;
  state = hook();
  assert.equal(state.isSavingAnswers, false);
  state.newQuestion("One last question?");
  state = hook();
  const last = state.send();
  state.newQuestion();
  respond(requests[6]);
  await last;
  state = hook();
  assert.equal(state.conversation.targetMessageId, null, "a new-question intent during a held request is not overwritten");
  assert.equal(state.hasUnsavedAnswers, true, "unsaved answers in the current conversation protect unload");
  args = { ...args, conversationId: "preparation-c" };
  state = hook();
  assert.equal(state.hasUnsavedAnswers, false, "an unreachable earlier thread no longer holds the unload guard");
  args = { ...args, conversationId: "preparation-b" };
  state = hook();
  state.newQuestion("Why this company?");
  state = hook();
  const unfinished = state.send();
  respond(requests[7], "I want to apply because [add: personal reason].", { status: "draft" });
  await unfinished;
  state = hook();
  const unfinishedMessage = state.conversation.messages.at(-1);
  assert.equal(unfinishedMessage.response.compliant, true, "format compliance does not make unfinished prose ready");
  state.editAnswer(unfinishedMessage.id, "I want to apply because [Company Name] builds accessible tools.");
  state = hook();
  assert.equal(state.conversation.messages.at(-1).response.status, "draft", "an edit keeps bracketed placeholders out of ready");
  state.editAnswer(unfinishedMessage.id, "I want to apply because [add: personal reason].");
  state = hook();
  const preserveUnfinished = state.save(unfinishedMessage.id);
  assert.equal(state.isSavePending(), true, "application actions see Save ownership before another render");
  assert.equal(saves[3].answer.status, "draft", "saving preserves the generated draft status");
  assert.equal(saves[3].preserveDraft, true, "unfinished prose takes the draft-preservation path");
  assert.ok(parseApplicationAnswerRevision(saves[3].answer));
  saves[3].resolve({ id: "application-b" });
  await preserveUnfinished;
  assert.equal(state.isSavePending(), false, "settled Save releases application actions");
  console.log("Answers conversation lifecycle passed: identity, exact revisions, manual edits, facts, save races and stale requests");
} finally { unmount(); globalThis.fetch = originalFetch; }
