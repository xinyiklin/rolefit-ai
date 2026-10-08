// While a Prepare run owns the preparation, Answers must not take new typing or edits: the run's
// conversation key changes at commit, so anything entered after the replacement prompt would be lost.
// This drives the production hook, then renders the production Answers tab around its controller.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const appRoot = fileURLToPath(new URL("../../../", import.meta.url));
const scheduler = `
let slots=[],cursor=0,effects=[];
export function useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];}
export function useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];}
export function useEffect(effect,deps){const index=cursor++;const old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:effect()};});}}
export function render(callback){cursor=0;const result=callback();const pending=effects;effects=[];pending.forEach(effect=>effect());return result;}
export function unmount(){for(const slot of slots)slot?.cleanup?.();slots=[];effects=[];}
`;
const hookBundle = await build({
  stdin: {
    loader: "ts", resolveDir: appRoot,
    contents: `export { useApplicationAnswers } from "./src/hooks/useApplicationAnswers.ts";
      export { extractAnswerConstraints, validateAnswerConstraints } from "./shared/applicationAnswersContract.ts";
      export { render, unmount } from "react";`
  },
  bundle: true, write: false, format: "esm", platform: "node",
  plugins: [{ name: "controlled-hooks", setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
    api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: scheduler, loader: "js" }));
  } }]
});
const { useApplicationAnswers, extractAnswerConstraints, validateAnswerConstraints, render, unmount } = await import(
  `data:text/javascript;base64,${Buffer.from(hookBundle.outputFiles[0].text).toString("base64")}`
);

const tabBundle = await build({
  stdin: {
    loader: "tsx", resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { AnswersTab } from "../tabs/AnswersTab.tsx";
      export const tab = (controller) => renderToStaticMarkup(
        <AnswersTab controller={controller} resumeReady jobReady modelPicker={null} />
      );`
  },
  bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent"
});
const tabModule = { exports: {} };
new Function("require", "module", "exports", tabBundle.outputFiles[0].text)(createRequire(import.meta.url), tabModule, tabModule.exports);
const { tab } = tabModule.exports;

const REASON = "Paused while the job is prepared.";
const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = (_url, options) => new Promise((resolve) => requests.push({ body: JSON.parse(options.body), options, resolve }));
const saves = [];
let args = {
  conversationId: "preparation-0-prepare-1", resumeText: "Built a clinic app.", jobDescription: "Build accessible apps.", rawJobText: "Original accessible app role.",
  jobUrl: "https://example.test/job", candidateContext: "Clinic software project.", profileLimitMessage: null, customInstructions: "", sourceWarnings: [],
  aiRequest: { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "low" }, providerReady: true, providerMessage: "", savedAnswers: [],
  onSaveAnswer: async (answer) => { saves.push(answer); return { id: "application-a" }; }
};
const hook = () => render(() => useApplicationAnswers(args));
function answerFor(request, text = "Useful software.") {
  const { body } = request;
  const constraints = extractAnswerConstraints(body.question.text);
  const validation = validateAnswerConstraints(text, constraints);
  return { id: body.answerRevisionId, applicationId: body.applicationId, questionId: body.question.id, questionRevision: body.question.revision, question: body.question.text,
    answer: text, constraints, counts: validation.counts, compliant: validation.compliant, status: "ready",
    generation: { provider: body.provider, model: body.model, reasoningEffort: body.reasoningEffort, createdAt: "2026-10-07T00:00:00.000Z", attempts: 1, promptVersion: "synthetic-test" },
    sources: { resumeFingerprint: "a".repeat(64), profileFingerprint: "b".repeat(64), jobFingerprint: "c".repeat(64), rawJobFingerprint: "d".repeat(64), factsFingerprint: "e".repeat(64) } };
}
const snapshot = (state) => JSON.stringify({ id: state.conversationId, conversation: state.conversation });
const buttons = (html) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
  .map(([, attrs, inner]) => ({ attrs, text: `${inner.replace(/<[^>]+>/g, "")} ${attrs.match(/aria-label="([^"]*)"/)?.[1] ?? ""}`.trim() }));
const control = (html, label) => {
  const found = buttons(html).find((button) => button.text.includes(label));
  assert.ok(found, `the tab renders a "${label}" control`);
  return found.attrs;
};
const textareas = (html) => [...html.matchAll(/<textarea\b([^>]*)>/g)].map(([, attrs]) => attrs);
const isOff = (attrs) => /\bdisabled\b|\breadonly\b/i.test(attrs);

try {
  // A draft with a pending refinement typed before Prepare.
  let state = hook();
  state.setComposer("Why this role?");
  const sent = hook().send();
  const first = { ...requests[0] };
  first.resolve(new Response(JSON.stringify({ answer: answerFor(first) })));
  await sent;
  state = hook();
  state.setComposer("Shorter");
  state = hook();
  const typed = snapshot(state);
  const messageId = state.conversation.messages[0].id;
  assert.equal(state.editBlocker, undefined);
  let html = tab(state);
  assert.ok(textareas(html).every((attrs) => !isOff(attrs)), "editable before Prepare");
  for (const label of ["Edit question", "Shorter", "More natural", "Refine answer", "New question"]) assert.equal(isOff(control(html, label)), false, `${label} is available before Prepare`);
  assert.doesNotMatch(html, new RegExp(REASON));

  // Prepare starts: the same thread renders read-only with one line naming why.
  args = { ...args, editBlocker: REASON };
  state = hook();
  html = tab(state);
  assert.equal(state.editBlocker, REASON);
  assert.equal(textareas(html).length, 2, "composer and answer text");
  assert.ok(textareas(html).every(isOff), "the composer and the answer text are read-only");
  for (const label of ["Edit question", "Shorter", "More natural", "Emphasize this role", "Refine answer", "New question"]) {
    assert.equal(isOff(control(html, label)), true, `${label} is disabled during Prepare`);
  }
  assert.equal(isOff(control(html, "Save answer")), false, "saving stays available");
  assert.equal(isOff(control(html, "Copy answer")), false, "copying stays available");
  assert.equal((html.match(new RegExp(REASON.replace(".", "\\."), "g")) ?? []).length, 1, "one terse line names why");
  assert.ok(REASON.length < 50 && !/\n/.test(REASON));

  // The controller enforces it too, so a stale handler or shortcut cannot slip an edit through.
  const fetched = requests.length;
  state.setComposer("typed during Prepare");
  state.newQuestion("Why this company?");
  state.refine(messageId, "More natural");
  state.editQuestion(messageId);
  state.editAnswer(messageId, "Edited during Prepare.");
  state.setComposerMode("clarification");
  state.reopen({ question: "Old question", answer: "Older saved words.", savedAt: "2026-01-01T00:00:00.000Z" });
  state.retryAnswers();
  assert.equal(await state.send(), undefined);
  state = hook();
  assert.equal(snapshot(state), typed, "nothing typed before Prepare changes, and nothing is added during it");
  assert.equal(state.hasUnsavedAnswersNow(), true, "the work typed before Prepare is still there for the replacement prompt");
  assert.equal(requests.length, fetched, "no request starts during Prepare");

  // Save and Stop are not edits.
  await state.save(messageId);
  assert.equal(saves.length, 1, "saving still persists the visible revision");
  state = hook();
  assert.equal(state.conversation.composer, "Shorter");

  // Prepare ends (declined, failed, or finished): editing resumes.
  args = { ...args, editBlocker: undefined };
  state = hook();
  assert.ok(textareas(tab(state)).every((attrs) => !isOff(attrs)));
  state.setComposer("Shorter please");
  state = hook();
  assert.equal(state.conversation.composer, "Shorter please", "editing resumes once Prepare ends");

  // A request already in flight keeps its Stop control during Prepare.
  const running = hook().send();
  state = hook();
  assert.equal(state.isGeneratingAnswers, true);
  args = { ...args, editBlocker: REASON };
  state = hook();
  assert.equal(isOff(control(tab(state), "Stop drafting")), false, "Stop stays available");
  const live = requests.at(-1);
  state.stopAnswers();
  assert.equal(live.options.signal.aborted, true, "Stop still aborts the request");
  live.resolve(new Response("{}"));
  await running;

  const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /editBlocker: jobPreparationActive \? "Paused while the job is prepared\." : undefined/, "App locks Answers for the whole Prepare run");
  console.log("Answers Prepare lock passed: composer and answer edits are read-only during Prepare; Save and Stop stay");
} finally { unmount(); globalThis.fetch = originalFetch; }
