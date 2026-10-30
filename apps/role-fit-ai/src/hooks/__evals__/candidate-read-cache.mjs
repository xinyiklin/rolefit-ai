// Executes the production useWorkspaceResume hook with a controlled hook
// scheduler to pin its base-resume candidate cache. A failed read must not be
// cached: the revision only advances on the next workspace snapshot, so a
// cached failure would silently disable automatic resume adoption until then.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { DOC_STYLE_DEFAULTS } from "../../../../../packages/engine/src/lib/documentStyle.ts";
import { serializeResumeFile } from "../../../../../packages/engine/src/lib/resumeFile.ts";
import { buildStarterResume } from "../../../../../packages/engine/src/sampleResume.ts";

const scheduler = `
let slots=[],cursor=0,effects=[];
export function useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];}
export function useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];}
export function useCallback(callback){return callback;}
export function useEffect(effect,deps){const index=cursor++;const old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:effect()};});}}
export function render(callback){cursor=0;const result=callback();const pending=effects;effects=[];pending.forEach(effect=>effect());return result;}
`;
const bundle = await build({
  stdin: {
    contents: `export {useWorkspaceResume} from './src/hooks/useWorkspaceResume.ts';export {render} from 'react';`,
    resolveDir: fileURLToPath(new URL("../../../", import.meta.url))
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  logLevel: "silent",
  plugins: [
    {
      name: "controlled-hooks",
      setup(api) {
        api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
        api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: scheduler, loader: "js" }));
      }
    }
  ]
});
const { useWorkspaceResume, render } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const noop = () => {};
const args = {
  confirm: async () => true,
  replacementGuard: {
    isDirtyNow: () => false,
    ownsRecoveryNow: () => false,
    currentVersion: () => "",
    confirmReplacement: async () => true,
    onReplacementCommitted: noop
  },
  fileName: "",
  setResumeText: noop,
  setFileName: noop,
  setDocumentTitle: noop,
  freshDocumentTitle: () => "",
  setResult: noop,
  resetCoverWorkflow: noop,
  setFileError: noop,
  setFileStatus: noop,
  setPolishStatus: noop,
  resetExportStatuses: noop,
  setExportStatus: noop,
  seedResumeData: noop,
  markResumeDocumentSaved: noop,
  getSeedRevision: () => 0,
  setResumeOrigin: noop,
  editedResume: buildStarterResume(),
  docStyle: { style: DOC_STYLE_DEFAULTS }
};

const resumeFile = serializeResumeFile(buildStarterResume(), DOC_STYLE_DEFAULTS);

// Each scenario answers its first candidate request with one failure kind, then
// with the requested variant. The answer echoes the requested file names.
const failures = {
  http: async () => ({ ok: false, json: async () => ({ error: "transient" }) }),
  throw: async () => {
    throw new Error("offline");
  },
  body: async () => ({ ok: true, json: async () => ({ candidates: "not an array" }) })
};
let requests = 0;
let failNext = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  assert.equal(url, "/api/workspace/base-resume/candidates", "only the candidate batch route is read");
  requests += 1;
  if (failNext) {
    const fail = failNext;
    failNext = null;
    return fail();
  }
  const { fileNames } = JSON.parse(init.body);
  return {
    ok: true,
    json: async () => ({
      candidates: fileNames.map((fileName) => ({ fileName, label: fileName, text: resumeFile }))
    })
  };
};

try {
  const hook = render(() => useWorkspaceResume(args));
  const revision = hook.readBaseResumeCandidatesRevision();
  for (const [kind, fail] of Object.entries(failures)) {
    // A distinct file per scenario keeps each cache key fresh at one revision.
    const fileName = `${kind}.resume`;
    const options = [{ fileName, label: kind, kind: "resume" }];
    requests = 0;
    failNext = fail;

    const first = await hook.readBaseResumeCandidates(options);
    assert.deepEqual(first, [], `a ${kind} failure yields no candidates rather than failing Prepare`);

    const second = await hook.readBaseResumeCandidates(options);
    assert.equal(hook.readBaseResumeCandidatesRevision(), revision, "every read shares one revision");
    assert.equal(requests, 2, `a ${kind} failure is not cached: the next read at the same revision requests again`);
    assert.deepEqual(
      second.map((candidate) => candidate.fileName),
      [fileName],
      `the read after a ${kind} failure returns the saved variant`
    );

    const third = await hook.readBaseResumeCandidates(options);
    assert.equal(requests, 2, "a successful read is still cached for the same revision");
    assert.equal(third, second, "the cached answer is returned as-is");
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Candidate read cache eval: passed");
