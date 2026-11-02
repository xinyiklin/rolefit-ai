// Cover-letter proposal freshness against resume-derived source warnings:
// drives the production useCoverLetter hook with controlled React state (no
// DOM) and a stubbed fetch. Accepting a warned Resume suggestion adds
// RESUME_SOURCE_WARNING without any letter change, so it must leave a pending
// Cover Letter proposal reviewable (resumeChanged), never hard-stale; a change
// to the letter's own accepted concerns still blocks it.
//
//   node apps/role-fit-ai/src/hooks/__evals__/cover-letter-source-warning-freshness.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { RESUME_SOURCE_WARNING } from "../../lib/sourceConcernNotices.ts";

const appRoot = fileURLToPath(new URL("../../../", import.meta.url));

const scheduler = `
let slots=[],cursor=0,effects=[],states=[];
export function useState(initial){const index=cursor++,store=slots;if(!(index in store)){store[index]=typeof initial==='function'?initial():initial;states.push(index);}return [store[index],value=>{store[index]=typeof value==='function'?value(store[index]):value;}];}
export function useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];}
export function useCallback(callback){return callback;}
export function useMemo(factory,deps){const index=cursor++;const old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))slots[index]={deps,value:factory()};return slots[index].value;}
export function useEffect(effect,deps){const index=cursor++;const old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i]))){effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:effect()};});}}
export function render(callback){cursor=0;const result=callback();const pending=effects;effects=[];pending.forEach(effect=>effect());return result;}
export function stateHolding(matches){const index=states.find(i=>matches(slots[i]));return index===undefined?null:next=>{slots[index]=next;};}
export function reset(){slots=[];cursor=0;effects=[];states=[];}
`;
const bundle = await build({
  stdin: { loader: "ts", resolveDir: appRoot, contents: `export { useCoverLetter } from "./src/hooks/useCoverLetter.ts"; export { render, reset, stateHolding } from "react";` },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
  plugins: [{ name: "controlled", setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
    api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: scheduler, loader: "js" }));
  } }]
});
const { useCoverLetter, render, reset, stateHolding } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const resumeData = {
  header: { name: "Jordan Lee" },
  sections: [{
    id: "s1", type: "experience", heading: "Experience",
    items: [{ id: "e1", titleLeft: "Acme Corp", bullets: [{ id: "b1", text: "Built the billing service for partners" }] }]
  }]
};
const letterText = "Dear Hiring Manager,\n\nI am applying for the Software Engineer role at Acme.\n\nSincerely,\nJordan Lee";
const appliedTexts = [];
const requests = [];
let nextResult;
globalThis.fetch = async (url, init) => {
  requests.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => nextResult };
};
const result = (text, concerns = []) => ({
  status: "ready",
  coverLetterText: text,
  bodyParagraphs: [{ text }],
  evidenceUsed: [],
  warnings: [],
  concerns
});
const baseProps = {
  currentCoverLetterText: letterText,
  currentResumeText: "Jordan Lee resume text",
  resumeData,
  jobText: "Software Engineer at Acme building billing services for partners and payments.",
  candidateContext: "",
  profileLimitMessage: null,
  sourceWarnings: undefined,
  customInstructions: "",
  aiRequest: { provider: "codex", selectedModel: "model", cliReasoningEffort: "medium" },
  providerReady: true,
  providerMessage: "",
  resumeText: "Jordan Lee resume text",
  sourceRevision: 1,
  candidateName: "Jordan Lee",
  tailorApplied: false,
  jobTarget: { role: "Software Engineer", company: "Acme" },
  onApplyTailored: (text) => appliedTexts.push(text)
};
const mount = (props) => render(() => useCoverLetter({ ...baseProps, ...props }));

async function polish(props, ready) {
  nextResult = ready;
  const before = mount(props);
  assert.equal(before.preflight.canTailor, true, "the synthetic letter is ready to Polish");
  await before.handleTailorCoverLetter();
  const after = mount(props);
  assert.deepEqual(after.proposal?.result, ready, "the Polish response becomes the pending proposal");
  return after;
}

// A resume-derived warning that appears after the proposal leaves it reviewable.
reset();
const first = await polish({}, result("First proposed letter"));
assert.deepEqual(first.proposal && { stale: first.proposal.stale, resumeChanged: first.proposal.resumeChanged }, { stale: false, resumeChanged: false });
const warned = mount({ sourceWarnings: [RESUME_SOURCE_WARNING] });
assert.equal(warned.proposal.stale, false, "a resume-derived warning does not hard-stale the cover proposal");
assert.equal(warned.proposal.resumeChanged, true, "a resume-derived warning flags the proposal as checked against the earlier resume");
warned.acceptProposal();
assert.deepEqual(appliedTexts, ["First proposed letter"], "the cover proposal stays acceptable after a sibling Resume acceptance");
assert.equal(mount({ sourceWarnings: [RESUME_SOURCE_WARNING] }).proposal, null, "acceptance settles the proposal");

// The request still carries every known warning to the provider.
reset();
requests.length = 0;
await polish({ sourceWarnings: [RESUME_SOURCE_WARNING] }, result("Warned proposal"));
assert.deepEqual(requests[0].body.sourceWarnings, [RESUME_SOURCE_WARNING], "resume-derived warnings still reach the cover request");

// A change to the letter's own accepted concerns still marks the proposal stale.
reset();
appliedTexts.length = 0;
const concerned = result("Accepted wording", ["The partner count is not in your resume."]);
(await polish({}, concerned)).acceptProposal();
requests.length = 0;
const second = await polish({}, result("Second proposed letter"));
assert.ok(requests[0].body.sourceWarnings.includes("The partner count is not in your resume."), "accepted concerns accompany the next request");
assert.equal(second.proposal.stale, false);
const replaceAccepted = stateHolding((value) => value?.coverLetterText === concerned.coverLetterText && Array.isArray(value.concerns));
assert.ok(replaceAccepted, "the accepted receipt is held as hook state");
replaceAccepted(result("Accepted wording", ["A different unresolved concern."]));
const changed = mount({});
assert.equal(changed.proposal.stale, true, "a change to the letter's own accepted concerns marks the proposal stale");
changed.acceptProposal();
assert.deepEqual(appliedTexts, ["Accepted wording"], "a stale cover proposal is refused");

console.log("Cover-letter source-warning freshness eval passed.");
