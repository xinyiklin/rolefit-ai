// Resume PDF import lifecycle: drives the production useResumeImport hook with
// controlled React state (no DOM), a synthetic PDF, and a stubbed fetch, then
// pins the App, workspace, and editor-adapter seams the hook relies on. Covers
// AC8 (existing resume protected, exact Discard) and AC12 (no Polish during an
// open review) from the import brief.
//
//   node apps/role-fit-ai/src/hooks/__evals__/resume-import-lifecycle.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { DOC_STYLE_DEFAULTS } from "@typeset/engine/lib/documentStyle.ts";
import { resumeDocumentVersion } from "../../lib/resumeDocumentVersion.ts";

const appRoot = fileURLToPath(new URL("../../../", import.meta.url));
globalThis.__resumeImportEvalPdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const scheduler = `
let slots=[],cursor=0,effects=[];
export function useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];}
export function useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];}
export function useCallback(callback){return callback;}
export function useEffect(effect,deps){const index=cursor++;const old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i]))){effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:effect()};});}}
export function render(callback){cursor=0;const result=callback();const pending=effects;effects=[];pending.forEach(effect=>effect());return result;}
`;
const bundle = await build({
  stdin: { loader: "ts", resolveDir: appRoot, contents: `export { useResumeImport } from "./src/hooks/useResumeImport.ts"; export { render } from "react";` },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
  plugins: [{ name: "controlled", setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
    api.onResolve({ filter: /browserPdfjs\.ts$/ }, () => ({ path: "pdfjs", namespace: "controlled" }));
    api.onLoad({ filter: /.*/, namespace: "controlled" }, ({ path }) => ({
      contents: path === "pdfjs" ? "export const pdfjs = globalThis.__resumeImportEvalPdfjs;" : scheduler,
      loader: "js"
    }));
  } }]
});
const { useResumeImport, render } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

async function resumePdf(name) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = (value, x, y, size = 10, font = regular) => page.drawText(value, { x, y, size, font });
  text(name, 54, 730, 18, bold);
  text("person@example.test | 555-0100", 54, 712);
  text("EXPERIENCE", 54, 684, 12, bold);
  text("Acme Corp", 54, 668, 10, bold);
  text("2019 – 2021", 500, 668);
  text("•", 57, 641);
  text("Built the billing service for partners", 68, 641);
  return new File([await doc.save()], `${name.replace(/ /g, "_")}.pdf`, { type: "application/pdf" });
}

// A harness standing in for App: the editor's seed revision, the workspace's
// commit/restore/replace, and dialogs, each recording what the hook asked for.
// Versions are computed the way App computes the editor's.
function harness() {
  const state = { seedRevision: 0, version: "v-before", style: {}, calls: [], confirmAnswer: true, confirms: [], commitAnswer: true, reads: 0 };
  const versionOf = (data) => resumeDocumentVersion(data, { ...DOC_STYLE_DEFAULTS, ...state.style });
  const snapshot = (label) => ({ label, data: { header: null, sections: [] }, style: {}, unsaved: false, fileName: "", baseResumeName: "fullstack.resume", documentTitle: label, origin: "saved", resumeText: "" });
  const args = () => ({
    seedRevision: state.seedRevision,
    getSeedRevision: () => state.seedRevision,
    commit: async (imported, readSnapshot) => {
      if (!state.commitAnswer) return null;
      const captured = readSnapshot();
      state.calls.push({ kind: "commit", fileName: imported.fileName, snapshot: captured.label });
      state.seedRevision += 1;
      state.style = imported.style;
      state.version = versionOf(imported.data);
      return captured;
    },
    replaceContent: (data) => {
      state.calls.push({ kind: "replace" });
      state.seedRevision += 1;
      state.version = versionOf(data);
    },
    restore: (restored) => {
      state.calls.push({ kind: "restore", snapshot: restored.label });
      state.seedRevision += 1;
    },
    // Each read is labeled, so a reused snapshot differs from a fresh one.
    readSnapshot: () => snapshot(`read ${(state.reads += 1)}`),
    currentVersion: () => state.version,
    confirm: async (options) => {
      state.confirms.push(options.title);
      return state.confirmAnswer;
    },
    interpretRequestFields: () => ({ provider: "claude-cli", model: "claude-sonnet-5-5", reasoningEffort: "low" })
  });
  return { state, view: () => render(() => useResumeImport(args())) };
}

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("an import opens a review tied to its own seed; any later seed ends it", async () => {
  const { state, view } = harness();
  await view().importFile(await resumePdf("Jane Doe"));
  let api = view();
  assert.equal(api.reviewOpen, true);
  assert.equal(api.review.fileName, "Jane_Doe.pdf");
  assert.equal(api.review.source, "local");
  assert.ok(api.review.audit.ok);
  assert.deepEqual(state.calls.map((call) => call.kind), ["commit"]);
  state.seedRevision += 1; // a save, an open, or a draft restore reseeds the editor
  api = view();
  api = view();
  assert.equal(api.reviewOpen, false);
  assert.equal(api.review, null);
});

test("Discard of an unedited import restores without asking; an edited one asks first", async () => {
  const unedited = harness();
  await unedited.view().importFile(await resumePdf("Jane Doe"));
  await unedited.view().discard();
  assert.deepEqual(unedited.state.confirms, []);
  assert.deepEqual(unedited.state.calls.at(-1), { kind: "restore", snapshot: "read 1" });

  const edited = harness();
  await edited.view().importFile(await resumePdf("Jane Doe"));
  edited.state.version = "v-edited";
  edited.state.confirmAnswer = false;
  await edited.view().discard();
  assert.deepEqual(edited.state.confirms, ["Discard import?"]);
  assert.ok(!edited.state.calls.some((call) => call.kind === "restore"), "declining keeps the edited import");
  edited.state.confirmAnswer = true;
  await edited.view().discard();
  assert.equal(edited.state.calls.at(-1).kind, "restore");
});

test("importing over an unsaved import keeps the document from before the first import", async () => {
  const { state, view } = harness();
  await view().importFile(await resumePdf("Jane Doe"));
  view();
  await view().importFile(await resumePdf("Sam Roe"));
  view();
  const commits = state.calls.filter((call) => call.kind === "commit");
  assert.deepEqual(commits.map((call) => call.snapshot), ["read 1", "read 1"], "the second commit reuses the first import's snapshot");
  assert.equal(state.reads, 1);
  await view().discard();
  assert.deepEqual(state.calls.at(-1), { kind: "restore", snapshot: "read 1" });
});

test("a refused second import is reported while the first review stays open, and ends with it", async () => {
  const { view } = harness();
  await view().importFile(await resumePdf("Jane Doe"));
  view();
  await view().importFile(new File([new TextEncoder().encode("not a pdf")], "notes.pdf", { type: "application/pdf" }));
  let api = view();
  assert.equal(api.reviewOpen, true);
  assert.equal(api.status.kind, "refused");
  assert.match(api.status.message, /not a PDF/);
  await api.discard();
  view();
  api = view();
  assert.equal(api.reviewOpen, false);
  assert.equal(api.status.kind, "idle", "the rail returns to Polish, not to the old refusal");
});

test("a refusal outside a review stays until dismissed", async () => {
  const { view } = harness();
  await view().importFile(new File([new TextEncoder().encode("not a pdf")], "notes.pdf", { type: "application/pdf" }));
  view();
  let api = view();
  assert.equal(api.status.kind, "refused");
  api.dismissRefusal();
  api = view();
  assert.equal(api.status.kind, "idle");
});

test("interpretation sends only provider fields and lines, and a faithful reply replaces the local reading", async () => {
  const { state, view } = harness();
  await view().importFile(await resumePdf("Jane Doe"));
  view();
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    const pieces = sent.body.lines.flatMap((line) => line.pieces);
    const id = (text) => pieces.find((piece) => piece.text === text).id;
    const structure = {
      name: [id("Jane Doe")],
      contact: [[{ piece: id("person@example.test | 555-0100"), text: "person@example.test" }], [{ piece: id("person@example.test | 555-0100"), text: "555-0100" }]],
      sections: [{ heading: [id("EXPERIENCE")], type: "standard", entries: [{ titleLeft: [id("Acme Corp")], titleRight: [id("2019 – 2021")], bullets: [[id("Built the billing service for partners")]] }] }]
    };
    return new Response(JSON.stringify({ structure }), { status: 200 });
  };
  await view().interpret();
  const api = view();
  assert.equal(sent.url, "/api/resume-import");
  assert.deepEqual(Object.keys(sent.body).sort(), ["lines", "model", "provider", "reasoningEffort"]);
  assert.equal(api.review.source, "ai");
  assert.equal(api.interpretation.status, "done");
  assert.equal(state.calls.at(-1).kind, "replace");
  assert.equal(api.reviewOpen, true, "replacing the reading keeps the review");
});

test("a reply that reorders text is not used and the local reading stays", async () => {
  const { state, view } = harness();
  await view().importFile(await resumePdf("Jane Doe"));
  view();
  globalThis.fetch = async (_url, init) => {
    const pieces = JSON.parse(init.body).lines.flatMap((line) => line.pieces);
    const contact = pieces.find((piece) => piece.text.startsWith("person@")).id;
    return new Response(JSON.stringify({ structure: { name: [], contact: [[{ piece: contact, text: "555-0100" }], [{ piece: contact, text: "person@example.test" }]], sections: [] } }), { status: 200 });
  };
  await view().interpret();
  const api = view();
  assert.equal(api.interpretation.status, "failed");
  assert.equal(api.review.source, "local");
  assert.ok(!state.calls.some((call) => call.kind === "replace"));
});

// A provider reply held until the test releases it.
function heldReply() {
  const held = {};
  globalThis.fetch = (_url, init) => {
    held.signal = init.signal;
    held.pieces = JSON.parse(init.body).lines.flatMap((line) => line.pieces);
    return new Promise((resolve) => (held.respond = resolve));
  };
  held.faithful = () => {
    const id = (text) => held.pieces.find((piece) => piece.text === text).id;
    const contact = id("person@example.test | 555-0100");
    const structure = {
      name: [id("Jane Doe")],
      contact: [[{ piece: contact, text: "person@example.test" }], [{ piece: contact, text: "555-0100" }]],
      sections: [{ heading: [id("EXPERIENCE")], type: "standard", entries: [{ titleLeft: [id("Acme Corp")], titleRight: [id("2019 – 2021")], bullets: [[id("Built the billing service for partners")]] }] }]
    };
    held.respond(new Response(JSON.stringify({ structure }), { status: 200 }));
  };
  return held;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("a reply that arrives after the review ended is dropped", async () => {
  const { state, view } = harness();
  await view().importFile(await resumePdf("Jane Doe"));
  view();
  const held = heldReply();
  const running = view().interpret();
  await settle();
  state.seedRevision += 1; // the user edited, then saved the variant, while the request ran
  state.version = "v-edited";
  view();
  view();
  held.faithful(); // a transport that answers despite the abort
  await running;
  const api = view();
  assert.equal(api.reviewOpen, false);
  assert.ok(!state.calls.some((call) => call.kind === "replace"), "a stale reply never reaches the editor");
  assert.deepEqual(state.confirms, [], "nothing asks about a review that has ended");
  assert.equal(api.interpretation.status, "idle");
});

test("edits made while a request runs are confirmed before the reply replaces them", async () => {
  const { state, view } = harness();
  await view().importFile(await resumePdf("Jane Doe"));
  view();
  let held = heldReply();
  let running = view().interpret();
  await settle();
  assert.deepEqual(state.confirms, [], "an unedited import is interpreted without asking");
  state.version = "v-edited";
  state.confirmAnswer = false;
  held.faithful();
  await running;
  let api = view();
  assert.deepEqual(state.confirms, ["Replace your corrections?"]);
  assert.ok(!state.calls.some((call) => call.kind === "replace"), "declining keeps the user's edits");
  assert.equal(api.review.source, "local");
  assert.equal(api.interpretation.status, "idle");

  state.confirmAnswer = true;
  held = heldReply();
  running = api.interpret();
  await settle();
  held.faithful();
  await running;
  api = view();
  assert.equal(state.calls.at(-1).kind, "replace");
  assert.equal(api.review.source, "ai");
});

test("a declined second import does not stop a running interpretation", async () => {
  const { state, view } = harness();
  await view().importFile(await resumePdf("Jane Doe"));
  view();
  let signal;
  let respond;
  globalThis.fetch = (_url, init) => {
    signal = init.signal;
    return new Promise((resolve) => (respond = resolve));
  };
  const running = view().interpret();
  await new Promise((resolve) => setTimeout(resolve, 20));
  state.commitAnswer = false;
  await view().importFile(await resumePdf("Sam Roe"));
  assert.equal(signal.aborted, false);
  respond(new Response(JSON.stringify({ error: "done" }), { status: 500 }));
  await running;
});

// ── Seams the hook relies on ────────────────────────────────────────────────
const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const app = source("App.tsx");
const workspace = source("hooks/useWorkspaceResume.ts");
const editor = source("hooks/useResumeEditor.ts");
const body = (text, name) => text.slice(text.indexOf(`function ${name}(`), text.indexOf("\n  }\n", text.indexOf(`function ${name}(`)));

test("App gates every Resume Polish route while a review is open", () => {
  assert.match(app, /const canPolish = polishInputsReady && selectedPolishProvidersReady && !resumeImport\.reviewOpen;/);
  assert.match(body(app, "handleResumePolish"), /\|\| resumeImport\.reviewOpen\s*\) return false;/);
  assert.match(app, /const retryResumePolish = \(\) => \{\s*if \(!resumeImport\.reviewOpen\) void retryStage\(\);\s*\};/);
  assert.equal((app.match(/retryStage\(\)/g) ?? []).length, 1, "retryStage is reached only through the guard");
  assert.match(app, /onRetry=\{resumeImport\.reviewOpen \? undefined : retryResumePolish\}/, "the dock hides Retry during a review");
  assert.match(app, /onRetryPolish=\{retryResumePolish\}/);
});

test("the workspace commits an import as unsaved, in memory, and Discard restores it exactly", () => {
  const commit = body(workspace, "commitImportedResume");
  assert.match(commit, /approveCurrentReplacement\(\)/);
  assert.match(commit, /seedResumeData\(imported\.data, \{ unsaved: true \}\)/);
  assert.match(commit, /setBaseResumeName\(""\)/);
  assert.doesNotMatch(commit, /saveLastBaseResumeName|detachBaseResumeIdentity|fetch\(/, "an unsaved import writes no workspace file or preference");
  const restore = body(workspace, "restoreResumeSnapshot");
  assert.match(restore, /replacementGuard\.onReplacementCommitted\(\)/);
  assert.match(restore, /seedResumeData\(snapshot\.data, \{ unsaved: snapshot\.unsaved \}\)/);
  assert.match(restore, /docStyle\.replaceDocumentStyle\(snapshot\.style\)/);
  assert.doesNotMatch(restore, /saveLastBaseResumeName|fetch\(/);
});

test("the editor adapter counts an unsaved seed as dirty until a seed or markClean", () => {
  assert.match(editor, /dirty: editor\.dirty \|\| unsavedSeed/);
  assert.match(editor, /setUnsavedSeed\(Boolean\(options\.unsaved\)\);/);
  assert.match(editor, /const markClean = useCallback\(\(\) => \{\s*setUnsavedSeed\(false\);/);
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n  ${error.message}`);
  }
}
console.log(`resume-import-lifecycle: ${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
