// Unsaved Answers work (composer text, an unsaved draft, an in-flight request) must hold
// every path that replaces the current preparation. This drives the production hook and
// executes App's own guard code, so a change to either side fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const intakeSource = readFileSync(new URL("../useJobIntake.ts", import.meta.url), "utf8");

function slice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `source markers exist: ${startMarker.trim()}`);
  return source.slice(start, end);
}
const confirmMaterials = slice(appSource, "  const confirmReplacePreparedMaterials = ", "\n\n  // ----- State -----");
const sourceGuard = slice(appSource, "  const confirmPreparedSourceReplacement = useCallback(", "  const choosePreparedSourceReplacement = useCallback(");
const openGuard = slice(appSource, "  async function handleLoadApplication(", "      preemptPreparedCoverLetterResolution();");

const scheduler = `
let slots=[],cursor=0,effects=[];
export function useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];}
export function useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];}
export function useEffect(effect,deps){const index=cursor++;const old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:effect()};});}}
export function render(callback){cursor=0;const result=callback();const pending=effects;effects=[];pending.forEach(effect=>effect());return result;}
export function unmount(){for(const slot of slots)slot?.cleanup?.();slots=[];effects=[];}
`;
const bundle = await build({
  stdin: {
    loader: "ts", resolveDir: fileURLToPath(new URL("../../../", import.meta.url)),
    contents: `
export { useApplicationAnswers } from "./src/hooks/useApplicationAnswers.ts";
export { extractAnswerConstraints, validateAnswerConstraints } from "./shared/applicationAnswersContract.ts";
export { preparedSourceAppearsDifferent } from "./src/lib/preparedSourceReplacement.ts";
export { render, unmount } from "react";
export function bindSourceGuard(context) {
  const { useCallback, confirm, answersUnsavedRef, answersDiscardApprovedRef, getPreparationOwner, preparationSessionRef, getApplication,
    preparedSourceAppearsDifferent, sourceReplacementResolverRef, sourceReplacementOwnerRef, setSourceReplacementPromptOpen } = context;
  ${sourceGuard}
  return confirmPreparedSourceReplacement;
}
export function bindOpenGuard(context) {
  const { confirm, answersUnsavedRef, answersDiscardApprovedRef, applicationOpenInFlightRef, resumeReplacementStateRef, coverReplacementStateRef } = context;
  ${confirmMaterials}
  ${openGuard}
      return true;
    } finally {
      applicationOpenInFlightRef.current = false;
    }
  }
  return handleLoadApplication;
}`
  },
  bundle: true, write: false, format: "esm", platform: "node",
  plugins: [{ name: "controlled-hooks", setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
    api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: scheduler, loader: "js" }));
  } }]
});
const { useApplicationAnswers, extractAnswerConstraints, validateAnswerConstraints, preparedSourceAppearsDifferent, render, unmount, bindSourceGuard, bindOpenGuard } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const originalFetch = globalThis.fetch;
const QUESTION = "Why this role?";
const baseArgs = () => ({
  conversationId: "preparation-0-prepare-1", resumeText: "Built a clinic app.", jobDescription: "Build accessible apps.", rawJobText: "Original accessible app role.",
  jobUrl: "https://example.test/job", candidateContext: "Clinic software project.", profileLimitMessage: null, customInstructions: "", sourceWarnings: [],
  aiRequest: { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "low" }, providerReady: true, providerMessage: "", savedAnswers: [],
  onSaveAnswer: async () => ({ id: "application-a" })
});
function answerFor(request, text = "Useful software.") {
  const { body } = request;
  const constraints = extractAnswerConstraints(body.question.text);
  const validation = validateAnswerConstraints(text, constraints);
  return { id: body.answerRevisionId, applicationId: body.applicationId, questionId: body.question.id, questionRevision: body.question.revision, question: body.question.text,
    answer: text, constraints, counts: validation.counts, compliant: validation.compliant, status: "ready",
    generation: { provider: body.provider, model: body.model, reasoningEffort: body.reasoningEffort, createdAt: "2026-10-07T00:00:00.000Z", attempts: 1, promptVersion: "synthetic-test" },
    sources: { resumeFingerprint: "a".repeat(64), profileFingerprint: "b".repeat(64), jobFingerprint: "c".repeat(64), rawJobFingerprint: "d".repeat(64), factsFingerprint: "e".repeat(64) } };
}
const respond = (request) => request.resolve(new Response(JSON.stringify({ answer: answerFor(request) })));
const fail = (request) => request.resolve(new Response(JSON.stringify({ error: "Provider unavailable." }), { status: 500 }));

// App reads the live predicate through this ref, so the guards run against exactly what App wires.
const answersUnsavedRef = { current: () => false };
let args, requests, state;
const hook = () => {
  state = render(() => useApplicationAnswers(args));
  answersUnsavedRef.current = state.hasUnsavedAnswersNow;
  return state;
};
const owner = { generation: 0 };
const dialogs = [];
let decision = true;
let whileDialogOpen = null;
const confirm = async (options) => { dialogs.push(options); await whileDialogOpen?.(); return decision; };
const approvedRef = { current: false };
const savedApplication = {
  id: "saved-1", title: "Software Engineer at Acme", company: "Acme", role: "Software Engineer", jobUrl: "https://careers.acme.test/jobs/software-engineer",
  rawJobDescription: "platform typescript delivery ownership", status: "applied", createdAt: "2026-05-04T12:00:00.000Z", updatedAt: "2026-05-04T12:00:00.000Z"
};
const differentPosting = { url: "https://careers.globex.test/jobs/data-scientist", sourceText: "modeling python", tracking: { company: "Globex", role: "Data Scientist" } };
const session = { current: { mode: "new", applicationId: null, pendingRelationship: null } };
const prompts = { opened: 0, resolver: { current: null }, owner: { current: "" } };
const sourceGuardFor = () => bindSourceGuard({
  useCallback: (callback) => callback, confirm, answersUnsavedRef, answersDiscardApprovedRef: approvedRef, getPreparationOwner: () => `${owner.generation}`, preparationSessionRef: session,
  getApplication: (id) => (id === savedApplication.id ? savedApplication : undefined), preparedSourceAppearsDifferent,
  sourceReplacementResolverRef: prompts.resolver, sourceReplacementOwnerRef: prompts.owner, setSourceReplacementPromptOpen: (open) => { if (open) prompts.opened += 1; }
});
const documents = { resume: { current: { dirty: false, version: "r1" } }, cover: { current: { dirty: false, version: "c1" } } };
const openInFlight = { current: false };
const openGuardFor = () => bindOpenGuard({
  confirm, answersUnsavedRef, answersDiscardApprovedRef: approvedRef, applicationOpenInFlightRef: openInFlight, resumeReplacementStateRef: documents.resume, coverReplacementStateRef: documents.cover
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Each setup leaves the current thread in one named condition; `atRisk` is what the guards must do about it.
const conditions = [
  { name: "empty conversation", atRisk: false, setup: async () => {} },
  { name: "whitespace-only composer", atRisk: false, setup: async () => { hook().setComposer("   "); hook(); } },
  { name: "composer text", atRisk: true, setup: async () => { hook().setComposer(QUESTION); hook(); } },
  { name: "request in flight", atRisk: true, setup: async () => {
    hook().setComposer(QUESTION); hook().send(); hook();
    assert.equal(state.conversation.composer, "", "sending clears the composer, so only the request itself is unsaved work");
    assert.equal(state.isGeneratingAnswers, true);
  } },
  { name: "generated draft not saved", atRisk: true, setup: async () => {
    hook().setComposer(QUESTION); const sent = hook().send(); respond(requests[0]); await sent; hook();
  } },
  { name: "manual edit after a save", atRisk: true, setup: async () => {
    hook().setComposer(QUESTION); const sent = hook().send(); respond(requests[0]); await sent; hook();
    const { id } = state.conversation.messages[0];
    await state.save(id); hook();
    hook().editAnswer(id, "Edited after saving."); hook();
  } },
  { name: "saved conversation", atRisk: false, setup: async () => { await savedAnswer(); } },
  // A turn that fails or stops keeps what the user typed only on its message, so it counts once it carries typed text.
  { name: "failed detail turn", atRisk: true, setup: async () => {
    await savedAnswer();
    hook().setComposerMode("clarification"); hook().setComposer("I can start on November 1."); hook();
    const sent = state.send(); fail(requests[1]); await sent; hook();
    assert.equal(state.conversation.progress.status, "failed");
    assert.equal(state.conversation.composer, "", "the typed detail left the composer");
    assert.deepEqual(state.conversation.messages.at(-1).facts, ["I can start on November 1."]);
  } },
  { name: "stopped refinement turn", atRisk: true, setup: async () => {
    await savedAnswer();
    hook().setComposer("Shorter"); hook().send(); state.stopAnswers(); hook();
    assert.equal(state.conversation.progress.status, "stopped");
    assert.equal(state.conversation.messages.at(-1).instruction, "Shorter");
  } },
  { name: "failed bare question", atRisk: false, setup: async () => {
    hook().setComposer(QUESTION); const sent = hook().send(); fail(requests[0]); await sent; hook();
    assert.equal(state.conversation.progress.status, "failed");
    assert.equal(state.conversation.messages.length, 1, "the question stays visible and retryable");
  } },
  { name: "failed turn followed by a saved retry", atRisk: false, setup: async () => {
    await savedAnswer();
    hook().setComposer("Shorter"); const failed = hook().send(); fail(requests[1]); await failed; hook();
    assert.equal(state.hasUnsavedAnswers, true, "the failed refinement counts until it is retried");
    hook().setComposer("Shorter, please"); const retried = hook().send(); respond(requests[2]); await retried; hook();
    await state.save(state.conversation.messages.at(-1).id); hook();
  } }
];

async function savedAnswer() {
  hook().setComposer(QUESTION); const sent = hook().send(); respond(requests[0]); await sent; hook();
  await state.save(state.conversation.messages[0].id); hook();
}
const snapshot = () => { hook(); return JSON.stringify({ id: state.conversationId, conversation: state.conversation }); };
try {
  for (const { name, atRisk, setup } of conditions) {
    unmount();
    args = baseArgs(); requests = []; dialogs.length = 0; prompts.opened = 0; session.current = { mode: "new", applicationId: null, pendingRelationship: null };
    documents.resume.current = { dirty: false, version: "r1" }; documents.cover.current = { dirty: false, version: "c1" }; openInFlight.current = false;
    globalThis.fetch = (_url, options) => new Promise((resolve) => requests.push({ body: JSON.parse(options.body), options, resolve }));
    hook();
    await setup();
    assert.equal(state.hasUnsavedAnswers, atRisk, `${name}: render-time flag`);
    assert.equal(state.hasUnsavedAnswersNow(), atRisk, `${name}: live flag`);
    const before = snapshot();
    const abortedBefore = requests.map((request) => request.options.signal.aborted);

    // Prepare by link, paste, extension, or Retry: all reach the one source-replacement guard.
    const prepare = sourceGuardFor();
    decision = false;
    const declined = await prepare(differentPosting);
    assert.equal(dialogs.length, atRisk ? 1 : 0, `${name}: Prepare asks only when Answers work would be lost`);
    assert.equal(declined.choice, atRisk ? "cancel" : "continue", `${name}: declining stops the replacement`);
    if (atRisk) {
      assert.equal(declined.isCurrent(), true, `${name}: a declined replacement is reported, not treated as stale`);
      assert.match(dialogs[0].title, /Answers/);
      assert.match(dialogs[0].message, /^Replace the current Answers\? Unsaved work will be lost\.$/);
      assert.equal(snapshot(), before, `${name}: cancelling keeps the thread exactly as it was`);
      assert.deepEqual(requests.map((request) => request.options.signal.aborted), abortedBefore, `${name}: cancelling does not stop an in-flight request`);
    }
    dialogs.length = 0;
    decision = true;
    const approved = await prepare(differentPosting);
    assert.equal(dialogs.length, atRisk ? 1 : 0);
    assert.equal(approved.choice, "continue", `${name}: confirming lets Prepare proceed`);

    // Opening a saved application (tracker, detail modal, or duplicate review's open-existing).
    assert.equal(approvedRef.current, atRisk, `${name}: only an asked-and-approved Prepare records the approval`);
    approvedRef.current = false;
    const open = openGuardFor();
    decision = false;
    dialogs.length = 0;
    assert.equal(await open({ id: "saved-1" }), !atRisk, `${name}: declining the open guard stops the open`);
    assert.equal(dialogs.length, atRisk ? 1 : 0, `${name}: opening asks only when Answers work would be lost`);
    assert.equal(openInFlight.current, false, `${name}: a declined open releases its in-flight lock`);
    if (atRisk) {
      assert.equal(dialogs[0].title, "Replace prepared materials?");
      assert.match(dialogs[0].message, /^Replace the current resume, cover letter, and Answers\? Unsaved work will be lost\.$/);
      assert.equal(snapshot(), before);
    }
    dialogs.length = 0;
    decision = true;
    assert.equal(await open({ id: "saved-1" }), true);
    assert.equal(dialogs.length, atRisk ? 1 : 0, `${name}: one dialog covers documents and Answers together`);

    // Dirty documents alone keep their existing wording; combined with Answers they share one dialog.
    documents.resume.current = { dirty: true, version: "r2" };
    dialogs.length = 0;
    await open({ id: "saved-1" });
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].message, atRisk
      ? "Replace the current resume, cover letter, and Answers? Unsaved work will be lost."
      : "Replace the current resume and cover letter? Unsaved edits will be lost.");
  }

  // The owner can change while the Answers dialog is open (a first Save links the record); the run follows the new owner.
  for (const answer of [false, true]) {
    unmount();
    args = baseArgs(); requests = []; dialogs.length = 0; decision = answer;
    hook().setComposer(QUESTION); hook();
    whileDialogOpen = async () => { owner.generation += 1; };
    const result = await sourceGuardFor()(differentPosting);
    whileDialogOpen = null;
    assert.equal(result.choice, answer ? "continue" : "cancel");
    assert.equal(result.isCurrent(), true, `owner changes during the dialog (${answer ? "approved" : "declined"}) do not strand the run as stale`);
    owner.generation += 1;
    assert.equal(result.isCurrent(), false, "a later owner change still supersedes the run");
  }

  // One approval per Prepare run: a follow-on Open (duplicate review's open-existing) does not ask about Answers again.
  unmount();
  args = baseArgs(); requests = []; dialogs.length = 0; decision = true; approvedRef.current = false;
  documents.resume.current = { dirty: false, version: "r1" }; openInFlight.current = false;
  hook().setComposer(QUESTION); hook();
  await sourceGuardFor()(differentPosting);
  assert.equal(dialogs.length, 1);
  assert.equal(approvedRef.current, true, "approving Replace Answers is remembered for the run");
  dialogs.length = 0;
  assert.equal(await openGuardFor()({ id: "saved-1" }), true);
  assert.equal(dialogs.length, 0, "the follow-on Open skips the Answers it was already told about");
  documents.resume.current = { dirty: true, version: "r2" };
  decision = false;
  assert.equal(await openGuardFor()({ id: "saved-1" }), false, "Cancel on the remaining dialog still stops the open");
  assert.equal(dialogs.at(-1).message, "Replace the current resume and cover letter? Unsaved edits will be lost.", "the second dialog is about documents only");
  documents.resume.current = { dirty: false, version: "r1" };
  approvedRef.current = false;
  decision = true;
  dialogs.length = 0;
  await openGuardFor()({ id: "saved-1" });
  assert.equal(dialogs.length, 1, "once the run ends the approval no longer covers a later Open");

  // Confirmed replacement: the old thread's request is stopped and its late reply cannot reach the new thread.
  unmount();
  args = baseArgs(); requests = []; dialogs.length = 0; decision = true;
  globalThis.fetch = (_url, options) => new Promise((resolve) => requests.push({ body: JSON.parse(options.body), options, resolve }));
  hook().setComposer(QUESTION); hook().send(); hook();
  assert.equal(await sourceGuardFor()(differentPosting).then((result) => result.choice), "continue");
  args = { ...args, conversationId: "preparation-0-prepare-2" };
  hook();
  assert.equal(requests[0].options.signal.aborted, true, "a confirmed replacement stops the old request");
  respond(requests[0]);
  await settle();
  hook();
  assert.equal(state.conversation.messages.length, 0, "a late reply cannot attach to the new preparation");
  assert.equal(state.hasUnsavedAnswers, false);
  assert.equal(state.hasUnsavedAnswersNow(), false, "the new preparation starts with nothing unsaved");

  // An update-mode source that looks different keeps its own choice dialog, after the Answers consent.
  unmount();
  args = baseArgs(); requests = []; dialogs.length = 0; prompts.opened = 0; prompts.resolver.current = null;
  session.current = { mode: "update", applicationId: savedApplication.id, pendingRelationship: null };
  hook().setComposer(QUESTION); hook();
  decision = false;
  assert.equal((await sourceGuardFor()(differentPosting)).choice, "cancel");
  assert.equal(prompts.opened, 0, "declining Answers stops before the posting-choice dialog");
  decision = true;
  const choice = sourceGuardFor()(differentPosting);
  await settle();
  assert.equal(prompts.opened, 1, "after Answers consent the posting-choice dialog still decides the saved record");
  prompts.resolver.current({ choice: "keep-current", isCurrent: () => true });
  assert.equal((await choice).choice, "keep-current");

  // Tripwire: every site that can change the Answers conversation key sits behind a guard above.
  assert.equal(appSource.match(/preparationGenerationRef\.current \+= 1/g)?.length, 2, "only publishPreparationSession and the application open bump the generation");
  const openStart = appSource.indexOf("  async function handleLoadApplication(");
  const openEnd = appSource.indexOf("  async function handleRestoreAutosaveDraft(", openStart);
  assert.ok(openStart > 0 && openEnd > openStart);
  const handlerBody = appSource.slice(openStart, openEnd);
  assert.match(handlerBody, /preparationGenerationRef\.current \+= 1/, "the open bump runs inside the guarded handler");
  assert.ok(
    handlerBody.indexOf("coverLetterEditor.openApplicationSource(") < handlerBody.indexOf("preparationGenerationRef.current += 1"),
    "a malformed saved cover letter fails the open before the Answers thread's key changes"
  );
  assert.equal(appSource.match(/restorePreparedFitAssessment\(/g)?.length, 1, "the restored-preparation commit has one caller");
  assert.match(handlerBody, /restorePreparedFitAssessment\(/, "that caller is the guarded open");
  assert.match(handlerBody, /\(!answersUnsaved && answersUnsavedRef\.current\(\)\)[\s\S]{0,200}?title: "Open paused"/, "Answers that appear after approval pause the open instead of being replaced");
  const replacingPublishes = [];
  for (let at = appSource.indexOf("publishPreparationSession("); at >= 0; at = appSource.indexOf("publishPreparationSession(", at + 1)) {
    let depth = 0, close = at + "publishPreparationSession".length;
    do { const char = appSource[close]; if (char === "(") depth += 1; else if (char === ")") depth -= 1; close += 1; } while (depth > 0);
    if (/,\s*true\s*\)$/.test(appSource.slice(at, close))) replacingPublishes.push(at);
  }
  assert.equal(replacingPublishes.length, 2, "only committed intake and Start a new preparation replace the preparation");
  const startNew = appSource.indexOf('choice === "start-new"');
  assert.ok(replacingPublishes.some((at) => at > startNew && at < startNew + 200), "Start a new preparation replaces after the guarded choice");
  assert.equal(intakeSource.match(/await confirmPreparedSourceReplacement\(/g)?.length, 1, "one intake guard");
  assert.deepEqual(
    [...intakeSource.matchAll(/await runPreparedJobAnalysis\(\{\s*source: "(\w+)"/g)].map((match) => match[1]).sort(),
    ["extension", "link", "paste", "retry"], "link, paste, extension and Retry share that guard"
  );
  assert.equal(intakeSource.match(/\bcommitPreparation\(/g)?.length, 3, "commitPreparation is declared once and called from the guarded run and the guarded open");
  assert.match(appSource, /answerController\.hasUnsavedAnswers \|\| applicationUnloadGuardActive\(/, "the unload guard shares the same predicate");
  assert.match(appSource, /answersUnsavedRef\.current = answerController\.hasUnsavedAnswersNow/, "App wires the live predicate to the guards");
  assert.match(
    appSource,
    /useEffect\(\(\) => \{\s*if \(!jobPreparationActive\) answersDiscardApprovedRef\.current = false;\s*\}, \[jobPreparationActive\]\)/,
    "the approval ends with the Prepare run"
  );
  assert.match(appSource, /editBlocker: jobPreparationActive \?/, "Answers edits are locked while a Prepare run is active");
  console.log("Answers replacement guard passed: composer, draft and in-flight work hold Prepare and Open; saved and empty threads do not");
} finally { unmount(); globalThis.fetch = originalFetch; }
