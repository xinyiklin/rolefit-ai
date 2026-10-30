// RoleFit's resume editor composes its own wrapper over the shared editor
// state with the shared document style on one history clock. A Paragraph
// styles alignment and Reset text formatting each change content and style in
// one gesture, so one undo must revert both parts and one redo reapply both.
// Executes the production hooks with a stand-in React whose useReducer applies
// queued actions at render, as React does.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const reactStandIn = `
let slots=[],cursor=0;
export function resetHooks(){slots=[];}
export function render(component){cursor=0;return component();}
export function useReducer(reducer,initialArg,init){const index=cursor++;if(!(index in slots)){const slot={state:init?init(initialArg):initialArg,queue:[]};slot.dispatch=action=>{slot.queue.push(action);};slots[index]=slot;}const slot=slots[index];for(const action of slot.queue.splice(0))slot.state=reducer(slot.state,action);return [slot.state,slot.dispatch];}
export function useState(initial){const index=cursor++;if(!(index in slots)){const slot={value:typeof initial==='function'?initial():initial};slot.set=next=>{slot.value=typeof next==='function'?next(slot.value):next;};slots[index]=slot;}return [slots[index].value,slots[index].set];}
export function useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];}
export function useMemo(factory,deps){const index=cursor++;const slot=slots[index];if(slot&&deps.length===slot.deps.length&&deps.every((dep,at)=>Object.is(dep,slot.deps[at])))return slot.value;slots[index]={value:factory(),deps};return slots[index].value;}
export function useCallback(callback,deps){return useMemo(()=>callback,deps);}
export function useEffect(){cursor++;}
export function useSyncExternalStore(subscribe,getSnapshot){cursor++;return getSnapshot();}
`;
const bundle = await build({
  stdin: {
    contents: [
      "export {useResumeEditor} from './src/hooks/useResumeEditor.ts';",
      "export {useDocStyle} from '@typeset/editor/hooks/useDocStyle.ts';",
      "export {createHistoryClock, historySourceFor} from '@typeset/editor/hooks/historyClock.ts';",
      "export {TEXT_STYLE_DEFAULTS} from '@typeset/engine/lib/documentStyle.ts';",
      "export {newSection} from '@typeset/engine/lib/resumeData.ts';",
      "export {render, resetHooks} from 'react';"
    ].join("\n"),
    resolveDir: fileURLToPath(new URL("../../../", import.meta.url))
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "controlled-hooks",
    setup(api) {
      api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
      api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: reactStandIn, loader: "js" }));
    }
  }]
});
const {
  useResumeEditor,
  useDocStyle,
  createHistoryClock,
  historySourceFor,
  TEXT_STYLE_DEFAULTS,
  newSection,
  render,
  resetHooks
} = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));

const CENTERED = "<align=center>Centered summary</align>";

// RoleFit's App: the wrapper and the shared style hook on one clock.
function mountRoleFit() {
  resetHooks();
  const resumeHistoryClock = createHistoryClock();
  const app = () => render(() => ({
    editor: useResumeEditor(resumeHistoryClock),
    docStyle: useDocStyle(resumeHistoryClock)
  }));
  const section = newSection("summary", "Summary");
  section.items[0].bullets[0].text = CENTERED;
  app().editor.seedData({ header: null, sections: [section] });
  app();
  return app;
}

// TypesetEditor's commitHistory over RoleFit's wrapped actions.
function press(app, direction) {
  const { editor, docStyle } = app();
  const source = historySourceFor(
    direction,
    direction === "undo" ? editor.undoSequence : editor.redoSequence,
    direction === "undo" ? docStyle.undoSequence : docStyle.redoSequence
  );
  if (source === "style" || source === "both") docStyle[direction]();
  if (source !== "style") editor.actions[direction]();
  return { source, ...app() };
}

const summaryText = ({ editor }) => editor.editedResume.sections[0].items[0].bullets[0].text;

{
  const app = mountRoleFit();
  const before = app();
  assert.equal(summaryText(before), CENTERED);
  assert.equal(before.docStyle.style.bodyAlign, "left");

  // RoleFit App's onGlobalAlignmentChange.
  before.docStyle.groupHistory(() => {
    before.editor.actions.clearAlignmentOverrides("body");
    before.docStyle.set("bodyAlign", "justify");
  });
  const after = app();
  assert.equal(summaryText(after), "Centered summary");
  assert.equal(after.docStyle.style.bodyAlign, "justify");
  assert.equal(after.editor.undoSequence, after.docStyle.undoSequence, "the alignment gesture is one history step");

  const undone = press(app, "undo");
  assert.equal(undone.source, "both");
  assert.equal(undone.docStyle.style.bodyAlign, "left", "one undo restores the old default");
  assert.equal(summaryText(undone), CENTERED, "the same undo restores the centered paragraph");
  assert.equal(undone.editor.canUndo || undone.docStyle.canUndo, false);

  const redone = press(app, "redo");
  assert.equal(redone.source, "both");
  assert.equal(redone.docStyle.style.bodyAlign, "justify", "one redo reapplies the default");
  assert.equal(summaryText(redone), "Centered summary", "the same redo clears the override again");
}

{
  const app = mountRoleFit();
  app().editor.actions.setStyleFieldSize("body", 12.5);
  app().docStyle.set("sectionRule", false);
  const formatted = app();
  const formattedText = summaryText(formatted);
  assert.notEqual(formattedText, CENTERED, "setup sized the body text");

  // TextStylesPopover's reset with RoleFit App's onResetStyleFormatting.
  formatted.docStyle.groupHistory(() => {
    formatted.docStyle.applyStyle(TEXT_STYLE_DEFAULTS);
    formatted.editor.actions.resetStyleFieldFormatting();
  });
  const reset = app();
  assert.equal(reset.docStyle.style.sectionRule, true);
  assert.equal(summaryText(reset), CENTERED);
  assert.equal(reset.editor.undoSequence, reset.docStyle.undoSequence, "the reset is one history step");

  const undone = press(app, "undo");
  assert.equal(undone.source, "both");
  assert.equal(undone.docStyle.style.sectionRule, false, "one undo restores the custom style");
  assert.equal(summaryText(undone), formattedText, "the same undo restores the per-field size");

  const redone = press(app, "redo");
  assert.equal(redone.source, "both");
  assert.equal(redone.docStyle.style.sectionRule, true, "one redo reapplies the defaults");
  assert.equal(summaryText(redone), CENTERED, "the same redo clears the per-field size again");
}

// The host handlers above mirror RoleFit's wiring.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
assert.match(
  read("../../App.tsx"),
  /onGlobalAlignmentChange=\{\(scope, alignment\) => \{[\s\S]{0,120}?docStyle\.groupHistory\(\(\) => \{\s*resumeEditorActions\.clearAlignmentOverrides\(scope\);[\s\S]{0,320}?docStyle\.set\("headingAlign"/,
  "the resume alignment gesture groups clearing overrides with the new default"
);
assert.match(
  read("../../sections/cover-letter/CoverLetterToolbar.tsx"),
  /onGlobalAlignmentChange=\{\(scope, alignment\) => \{\s*editor\.docStyle\.groupHistory\(\(\) => \{\s*editor\.actions\.clearAlignmentOverrides\(scope\);/,
  "the letter alignment gesture calls the group seam (a pass-through: letter style keeps no history)"
);

console.log("grouped style history probes passed");
