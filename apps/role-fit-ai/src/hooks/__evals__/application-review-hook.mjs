// Executes the production hook with a controlled hook scheduler. This checks
// async ownership/effects without claiming React DOM or browser coverage.
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
  stdin: {
    contents: `export {useApplicationReview} from './src/hooks/useApplicationReview.ts';export {render,unmount} from 'react';`,
    resolveDir: fileURLToPath(new URL("../../../", import.meta.url)),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [
    {
      name: "controlled-hooks",
      setup(api) {
        api.onResolve({ filter: /^react$/ }, () => ({
          path: "react",
          namespace: "controlled",
        }));
        api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({
          contents: scheduler,
          loader: "js",
        }));
      },
    },
  ],
});
const { useApplicationReview, render, unmount } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
let input = {
  jobText: "Build Python services.",
  company: "Acme",
  role: "Engineer",
  includeResume: true,
  includeCoverLetter: false,
  resumeText: "Built Python services.",
  coverLetterText: "",
  evidence: [],
};
let preparationIdentity = "prepare1";
const stage = {
  provider: "openai",
  selectedModel: "synthetic",
  cliReasoningEffort: "",
};
let readyResolve;
let ensureProviderReady = () => Promise.resolve({ ready: true });
const renderHook = () =>
  render(() =>
    useApplicationReview({
      input,
      stage,
      preparationIdentity,
      ensureProviderReady,
    }),
  );
const oldFetch = globalThis.fetch;
let fetched = [];
globalThis.fetch = (url, options) =>
  new Promise((resolve) => fetched.push({ options, resolve }));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const result = {
  findings: [],
  complete: false,
  overflow: false,
  reviewedDocuments: ["resume"],
  completedAt: new Date().toISOString(),
};
try {
  let hook = renderHook();
  const first = hook.run();
  await tick();
  hook = renderHook();
  assert.equal(hook.status, "running");
  assert.equal(fetched.length, 1);
  input = { ...input, resumeText: "Changed current resume." };
  hook = renderHook();
  assert.equal(fetched[0].options.signal.aborted, true);
  fetched[0].resolve(new Response(JSON.stringify(result)));
  await first;
  hook = renderHook();
  assert.equal(hook.status, "stopped");
  assert.equal(hook.stale, true);
  const second = hook.run();
  await tick();
  hook = renderHook();
  hook.stop();
  fetched[1].resolve(new Response(JSON.stringify(result)));
  await second;
  hook = renderHook();
  assert.equal(hook.status, "stopped");
  ensureProviderReady = () =>
    new Promise((resolve) => {
      readyResolve = resolve;
    });
  hook = renderHook();
  const third = hook.run();
  await tick();
  preparationIdentity = "restored2";
  hook = renderHook();
  readyResolve({ ready: true });
  await third;
  assert.equal(
    fetched.length,
    2,
    "restore while checking provider never dispatches",
  );
  ensureProviderReady = () => Promise.resolve({ ready: true });
  hook = renderHook();
  const fourth = hook.run();
  await tick();
  unmount();
  assert.equal(fetched[2].options.signal.aborted, true);
  fetched[2].resolve(new Response(JSON.stringify(result)));
  await fourth;
  input = {
    ...input,
    evidence: Array.from({ length: 401 }, (_, i) => ({
      id: `e-${i}`,
      kind: "context",
      label: "About you",
      text: "Built Python services.",
    })),
  };
  let readinessChecks = 0;
  ensureProviderReady = async () => {
    readinessChecks++;
    return { ready: true };
  };
  hook = renderHook();
  await hook.run();
  hook = renderHook();
  assert.equal(hook.status, "failed");
  assert.match(hook.receipt.result.error, /400 evidence items/);
  assert.equal(
    readinessChecks,
    0,
    "over-budget evidence fails before provider checks",
  );
  assert.equal(fetched.length, 3, "over-budget evidence never dispatches");
} finally {
  globalThis.fetch = oldFetch;
  unmount();
}
console.log(
  "Production review hook: input changes, Stop, restore, late responses and unload passed under controlled scheduler",
);
