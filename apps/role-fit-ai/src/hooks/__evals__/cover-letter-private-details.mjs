// Cover-letter private facts against Prepare brief edits: drives the production
// useCoverLetter hook with controlled React state (no DOM). A brief edit
// rewrites jobText on every keystroke, so it must keep the typed private-slot
// answers and detail values; a new job (resetCoverWorkflow) or a new source
// letter (sourceRevision) still clears them.
//
//   node apps/role-fit-ai/src/hooks/__evals__/cover-letter-private-details.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const appRoot = fileURLToPath(new URL("../../../", import.meta.url));

const scheduler = `
let slots=[],cursor=0,effects=[];
export function useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];}
export function useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];}
export function useCallback(callback){return callback;}
export function useMemo(factory,deps){const index=cursor++;const old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))slots[index]={deps,value:factory()};return slots[index].value;}
export function useEffect(effect,deps){const index=cursor++;const old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i]))){effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:effect()};});}}
export function render(callback){cursor=0;const result=callback();const pending=effects;effects=[];pending.forEach(effect=>effect());return result;}
`;
const bundle = await build({
  stdin: { loader: "ts", resolveDir: appRoot, contents: `export { useCoverLetter } from "./src/hooks/useCoverLetter.ts"; export { render } from "react";` },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
  plugins: [{ name: "controlled", setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
    api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: scheduler, loader: "js" }));
  } }]
});
const { useCoverLetter, render } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const letter = "Dear Hiring Manager,\n\nI am applying for the Software Engineer role at Acme because I have built billing services for partners and I enjoy making payments reliable for small businesses.\n\nMention [Referral name].\n\nSincerely,\nJordan Lee";
// App passes the assembled tailoring text, which a Role title edit rewrites.
const brief = (title) => `Job Title: ${title}\nCompany / Product Context: Acme payments\nCore Responsibilities:\n- Build billing services`;
const baseProps = {
  currentCoverLetterText: letter,
  currentResumeText: "Jordan Lee resume text",
  resumeData: { header: { name: "Jordan Lee" }, sections: [] },
  jobText: brief("Sofware Engineer"),
  candidateContext: "",
  profileLimitMessage: null,
  customInstructions: "",
  aiRequest: { provider: "codex", selectedModel: "model", cliReasoningEffort: "medium" },
  providerReady: true,
  providerMessage: "",
  resumeText: "Jordan Lee resume text",
  sourceRevision: 1,
  candidateName: "Jordan Lee",
  tailorApplied: false,
  jobTarget: { role: "Software Engineer", company: "Acme" },
  onApplyTailored: () => {}
};
// Two renders let a state change from the first render's effects settle.
const mount = (props = {}) => {
  render(() => useCoverLetter({ ...baseProps, ...props }));
  return render(() => useCoverLetter({ ...baseProps, ...props }));
};

const answer = "Morgan Rivera, a staff engineer on the billing team, referred me.";
let hook = mount();
const slot = hook.preflight.privateSlots[0];
assert.ok(slot, "the synthetic letter has one private slot");
hook.updateSlotAnswer(slot.id, answer);
hook.updateDetail("company", "Acme Payments");
hook = mount();
assert.deepEqual(hook.slotAnswers, { [slot.id]: answer }, "the typed slot answer is held");

// A Prepare brief edit (Role title typo fix) keeps both kinds of typed facts.
hook = mount({ jobText: brief("Software Engineer") });
assert.deepEqual(hook.slotAnswers, { [slot.id]: answer }, "a brief edit keeps the typed slot answer");
assert.deepEqual(hook.detailValues, { company: "Acme Payments" }, "a brief edit keeps the typed detail value");
assert.ok(
  hook.evidenceItems.some((item) => item.text?.includes("Morgan Rivera")),
  "the kept answer still reaches the Polish evidence"
);

// A new job clears them through the intake's reset.
hook.resetCoverWorkflow();
hook = mount({ jobText: brief("Software Engineer") });
assert.deepEqual(hook.slotAnswers, {}, "a new job clears the slot answers");
assert.deepEqual(hook.detailValues, {}, "a new job clears the detail values");

// A new source letter clears them too.
hook.updateSlotAnswer(slot.id, answer);
hook.updateDetail("role", "Staff Engineer");
hook = mount({ jobText: brief("Software Engineer") });
assert.equal(hook.slotAnswers[slot.id], answer);
hook = mount({ jobText: brief("Software Engineer"), sourceRevision: 2 });
assert.deepEqual(hook.slotAnswers, {}, "a new source letter clears the slot answers");
assert.deepEqual(hook.detailValues, {}, "a new source letter clears the detail values");

console.log("Cover-letter private-details eval passed.");
