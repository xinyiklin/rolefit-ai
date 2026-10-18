import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Drive the real cover-letter identity hook: an automatic retitle (D085) must
// keep a clean letter clean, while a typed title or a content edit stays dirty.
const scheduler = `
let slots = [], cursor = 0;
export function useState(initial) {
  const index = cursor++;
  if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
  return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
}
export function useRef(initial) {
  const index = cursor++;
  if (!(index in slots)) slots[index] = { current: initial };
  return slots[index];
}
export const useCallback = callback => callback;
export const useEffect = () => undefined;
export function render(callback) { cursor = 0; return callback(); }
`;
const bundle = await build({
  stdin: {
    loader: "ts",
    resolveDir: fileURLToPath(new URL("../../../", import.meta.url)),
    contents: `
export { useCoverLetterDocumentIdentity } from "./src/hooks/useCoverLetterDocumentIdentity.ts";
export { render } from "react";`
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [{ name: "controlled-hooks", setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
    api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: scheduler, loader: "js" }));
  } }]
});
globalThis.window = { sessionStorage: { getItem: () => null, setItem: () => undefined } };
const { useCoverLetterDocumentIdentity, render } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

let fingerprint = "letter v1";
const identity = () => render(() => useCoverLetterDocumentIdentity("letter v1", fingerprint));

// A letter adopted under a title naming the resume's applicant, whose own
// letterhead names someone else, is retitled without becoming unsaved.
identity().commitPersistenceBaseline("letter v1", "Xinyi_Lin_Intuit_Cover_Letter");
identity().setDocumentTitle("Xinyi_Lin_Intuit_Cover_Letter");
assert.equal(identity().recoveryDirty, false, "the adopted letter opens clean");
identity().followDocumentTitle(() => "Jane_Doe_Intuit_Cover_Letter");
let state = identity();
assert.equal(state.documentTitle, "Jane_Doe_Intuit_Cover_Letter", "the automatic retitle applies");
assert.equal(state.recoveryDirty, false, "an automatic retitle keeps a clean letter clean");

// A title the user typed is an edit, and an automatic retitle never cleans it.
identity().setDocumentTitle("Referral note");
assert.equal(identity().recoveryDirty, true, "a typed title is recoverable");
identity().followDocumentTitle(() => "Jane_Cover_Letter");
state = identity();
assert.equal(state.recoveryDirty, true, "an automatic retitle over an edited title stays dirty");
assert.equal(state.persistedDocumentTitle, "Jane_Doe_Intuit_Cover_Letter", "the saved title is untouched");

// Content edits keep their own dirtiness through an automatic retitle.
identity().commitPersistenceBaseline("letter v1", "Jane_Cover_Letter");
identity().setDocumentTitle("Jane_Cover_Letter");
fingerprint = "letter v2";
identity().followDocumentTitle(() => "Janet_Cover_Letter");
assert.equal(identity().recoveryDirty, true, "an edited body stays recoverable after a retitle");

console.log("PASS cover-letter automatic retitles keep clean letters clean");
