// Every Answers generation path (tab send, tab Retry, the progress dock's Retry) shares the tab's
// resume and prepared-job gates. Source edits keep the conversation but unprepare the job, and the
// bundled Starter sample is never the applicant's resume, so a Retry of a failed draft must reach the
// provider with neither. Drives the production hook and Answers tab.
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
    contents: `export { useApplicationAnswers } from "./src/hooks/useApplicationAnswers.ts"; export { render, unmount } from "react";`
  },
  bundle: true, write: false, format: "esm", platform: "node",
  plugins: [{ name: "controlled-hooks", setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
    api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: scheduler, loader: "js" }));
  } }]
});
const { useApplicationAnswers, render, unmount } = await import(
  `data:text/javascript;base64,${Buffer.from(hookBundle.outputFiles[0].text).toString("base64")}`
);
const tabBundle = await build({
  stdin: {
    loader: "tsx", resolveDir: fileURLToPath(new URL("../../sections/__evals__/", import.meta.url)),
    contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { AnswersTab } from "../tabs/AnswersTab.tsx";
      export const tab = (controller, jobReady, resumeReady = true) => renderToStaticMarkup(
        <AnswersTab controller={controller} resumeReady={resumeReady} jobReady={jobReady} modelPicker={null} />
      );`
  },
  bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent"
});
const tabModule = { exports: {} };
new Function("require", "module", "exports", tabBundle.outputFiles[0].text)(createRequire(import.meta.url), tabModule, tabModule.exports);
const { tab } = tabModule.exports;

const GATE = "Add the job on Prepare first.";
const RESUME_GATE = "Add your resume first.";
const STARTER = "Starter sample: Jordan Lee, software engineer.";
const JOB_A = "Build accessible clinic apps with React and TypeScript for care teams.";
const JOB_B = "Unprepared marker: operate payroll batch jobs for a finance team.";
const originalFetch = globalThis.fetch;
let requests = [];
const sentJobTexts = [];
const sentResumeTexts = [];
globalThis.fetch = (_url, options) => new Promise((resolve) => {
  const body = JSON.parse(options.body);
  sentJobTexts.push(body.jobText);
  sentResumeTexts.push(body.resumeText);
  requests.push({ body, options, resolve });
});
const fail = (request) => request.resolve(new Response(JSON.stringify({ error: "Provider unavailable." }), { status: 500 }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const preparedArgs = (conversationId) => ({
  conversationId, resumeText: "Built a clinic app.", resumeReady: true, jobDescription: JOB_A, jobReady: true, rawJobText: "Original clinic app posting.",
  jobUrl: "https://example.test/job-a", candidateContext: "", profileLimitMessage: null, customInstructions: "", sourceWarnings: [],
  aiRequest: { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "low" }, providerReady: true, providerMessage: "", savedAnswers: [],
  onSaveAnswer: async () => ({ id: "application-a" })
});
let args;
const hook = () => render(() => useApplicationAnswers(args));
const markup = (html) => ({
  status: html.match(/<div class="answers-status" role="status"><span[^>]*>([^<]*)<\/span>/)?.[1],
  retry: html.match(/<button\b([^>]*)>Retry<\/button>/)?.[1],
  send: html.match(/<button\b([^>]*aria-label="(?:Draft|Refine) answer"[^>]*)>/)?.[1]
});
const disabled = (attrs) => /\bdisabled\b/.test(attrs ?? "");

// A failed draft for prepared job A, so the dock (and the tab) offer Retry.
async function failedDraft(conversationId) {
  unmount();
  requests = [];
  args = preparedArgs(conversationId);
  hook().setComposer("Why this role?");
  const sent = hook().send();
  fail(requests[0]);
  await sent;
  const state = hook();
  assert.equal(state.answersProgress.status, "failed", "the failed draft shows Retry");
  return state;
}

try {
  // A prepared job keeps Retry working.
  let state = await failedDraft("preparation-0-prepare-a");
  state.retryAnswers();
  assert.equal(requests.length, 2, "Retry drafts again while the job is prepared");
  assert.equal(requests[1].body.jobText, JOB_A);
  fail(requests[1]);
  await settle();
  state = hook();
  assert.equal(state.answersProgress.status, "failed");

  // Each source edit keeps this conversation but leaves the job unprepared.
  const edits = [
    ["pasting job B into Prepare", { jobDescription: JOB_B, rawJobText: "", jobReady: false }],
    ["editing the job link", { jobUrl: "https://example.test/job-b", jobReady: false }]
  ];
  for (const [label, edit] of edits) {
    state = await failedDraft(`preparation-0-${label}`);
    const messages = JSON.stringify(state.conversation.messages);
    args = { ...args, ...edit };
    state = hook();
    assert.equal(state.conversationId, args.conversationId, `${label}: the conversation is unchanged`);
    assert.equal(state.answersProgress.status, "failed", `${label}: the dock still offers Retry`);

    // The dock's Retry is the controller's retryAnswers (App's onRetry); the tab's Retry calls the same.
    state.retryAnswers();
    state = hook();
    assert.equal(requests.length, 1, `${label}: Retry sends nothing for an unprepared job`);
    assert.deepEqual(state.answersProgress, { status: "failed", errorHeadline: "Cannot draft yet", error: GATE }, `${label}: Retry names the prepared-job gate`);
    assert.equal(state.answersStatus, GATE);
    assert.equal(JSON.stringify(state.conversation.messages), messages, `${label}: the blocked Retry leaves the thread as it was`);

    // The tab shows the same gate and disables both of its paths.
    state.setComposer("Why this company?");
    state = hook();
    const view = markup(tab(state, false));
    assert.equal(view.status, GATE, `${label}: the tab names the same gate`);
    assert.ok(disabled(view.retry) && disabled(view.send), `${label}: the tab's Retry and send are disabled`);
    await state.send();
    assert.equal(requests.length, 1, `${label}: send is blocked by the same gate`);
    state = hook();
    assert.equal(state.answersProgress.error, GATE);
  }

  // The gate's order matches the tab's: an unprepared job is named before provider setup.
  state = await failedDraft("preparation-0-provider");
  args = { ...args, jobDescription: JOB_B, jobReady: false, providerReady: false, providerMessage: "Connect an AI provider first." };
  state = hook();
  state.retryAnswers();
  state = hook();
  assert.equal(requests.length, 1);
  assert.equal(state.answersProgress.error, markup(tab(state, false)).status, "the dock and the tab name the same blocker");
  assert.equal(state.answersProgress.error, GATE);
  assert.ok(sentJobTexts.length && sentJobTexts.every((text) => text === JOB_A), "unprepared source text never reaches a request");

  // Open > Bundled starter after a failed draft: App's resumeReady is false for the sample.
  state = await failedDraft("preparation-0-starter");
  args = { ...args, resumeText: STARTER, resumeReady: false };
  state = hook();
  assert.equal(state.answersProgress.status, "failed", "starter: the dock still offers Retry");
  state.retryAnswers();
  state = hook();
  assert.equal(requests.length, 1, "starter: Retry sends nothing");
  assert.deepEqual(state.answersProgress, { status: "failed", errorHeadline: "Cannot draft yet", error: RESUME_GATE }, "starter: Retry names the resume gate");
  state.setComposer("Why this company?");
  state = hook();
  const starterView = markup(tab(state, true, false));
  assert.equal(starterView.status, RESUME_GATE, "starter: the tab names the same gate");
  assert.ok(disabled(starterView.retry) && disabled(starterView.send), "starter: the tab's Retry and send are disabled");
  await state.send();
  assert.equal(requests.length, 1, "starter: send is blocked by the same gate");
  // The tab's order: the resume gate comes before the prepared-job gate.
  args = { ...args, jobDescription: JOB_B, jobReady: false };
  state = hook();
  state.retryAnswers();
  state = hook();
  assert.equal(requests.length, 1);
  assert.equal(state.answersProgress.error, markup(tab(state, false, false)).status, "starter: the dock and the tab name the same blocker");
  assert.equal(state.answersProgress.error, RESUME_GATE);
  assert.ok(sentResumeTexts.length && !sentResumeTexts.includes(STARTER), "the Starter sample never reaches a request");

  // App gives the hook and the tab the one prepared-job signal, and the dock Retry is the controller's.
  const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  const hookCall = appSource.slice(appSource.indexOf("useApplicationAnswers({"), appSource.indexOf("onSaveAnswer: handleSaveAnswer"));
  assert.match(hookCall, /[{,]\s*jobReady\s*[,}]/, "App passes jobReady to the hook");
  assert.match(hookCall, /[{,]\s*resumeReady\s*[,}]/, "App passes resumeReady to the hook");
  assert.match(appSource, /<AnswersTab[^>]*?\bresumeReady=\{resumeReady\}/, "the tab reads the same resumeReady");
  assert.match(appSource, /const resumeReady = Boolean\(\s*resumeHasContent && !resumeIsStarterSample\s*\);/, "resumeReady excludes the Starter");
  assert.match(appSource, /const resumeIsStarterSample = resumeOrigin === "starter";/, "an application of record does not make the Starter ready");
  assert.match(appSource, /<AnswersTab[^>]*?\bjobReady=\{jobReady\}/, "the tab reads the same jobReady");
  assert.match(appSource, /const jobReady = jobPrepared;/);
  assert.match(appSource, /stageKey="application-answers"[^>]*?onRetry=\{retryAnswers\}/, "the dock's Retry is the controller's");
  console.log("Answers Retry gate passed: tab send, tab Retry, and the dock Retry share the resume and prepared-job gates");
} finally { unmount(); globalThis.fetch = originalFetch; }
