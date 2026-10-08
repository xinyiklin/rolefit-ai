import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { extractAnswerConstraints, validateAnswerConstraints } from "../../../shared/applicationAnswersContract.ts";
import { sanitizeApplications } from "../../../server/applications/schema.ts";
import { reconcileApplicationMutations } from "../../../server/applications/reconcile.ts";

// Execute App's actual persistence boundary with the production action/store
// hooks; held requests expose ownership before React gets another render.
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const start = appSource.indexOf("  async function handleSaveAnswer(");
const end = appSource.indexOf("  const answerController = useApplicationAnswers(", start);
assert.ok(start >= 0 && end > start, "App's explicit answer-save boundary exists");
const handler = appSource.slice(start, end);
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
export function reset() { slots = []; cursor = 0; }
`;
const bundle = await build({
  stdin: {
    loader: "ts", resolveDir: fileURLToPath(new URL("../../../", import.meta.url)),
    contents: `
export { useApplications } from "./src/hooks/useApplications.ts";
export { useApplyFlow } from "./src/hooks/useApplyFlow.ts";
export { render, reset } from "react";
export function bindSave(context) {
  const { applicationActionPendingRef, preparationGenerationRef, getCurrentPreparationId,
    hasLoadedApplications, preparationSessionRef, answersDraftIds, answersDraftSourceRef,
    saveApplicationAnswer, linkPostingRecords, getApplication,
    publishPreparationSession, duplicateGuard } = context;
  ${handler}
  return handleSaveAnswer;
}`
  },
  bundle: true, write: false, format: "esm", platform: "node",
  plugins: [{ name: "controlled-hooks", setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
    api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: scheduler, loader: "js" }));
  } }]
});
const { useApplications, useApplyFlow, bindSave, render, reset } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const originalFetch = globalThis.fetch;
const noop = () => undefined;
const question = "Why this role?";
const answerText = "I enjoy building accessible software.";
const constraints = extractAnswerConstraints(question);
const validation = validateAnswerConstraints(answerText, constraints);
const answer = {
  id: "answer-1", applicationId: "preparation-0-prep1", questionId: "question-1", questionRevision: 1,
  question, answer: answerText, status: "ready", constraints, counts: validation.counts, compliant: validation.compliant
};

async function scenario({ failWrite = false, prompt = false } = {}) {
  reset();
  let stored = [], writes = 0;
  let releaseWrite, notifyWrite;
  const heldWrite = new Promise((resolve) => { releaseWrite = resolve; });
  const writeStarted = new Promise((resolve) => { notifyWrite = resolve; });
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(url, "/api/applications");
    if (init.method !== "PUT") return { ok: true, json: async () => ({ applications: structuredClone(stored) }) };
    writes += 1;
    notifyWrite();
    await heldWrite;
    if (failWrite) {
      failWrite = false;
      return { ok: false, status: 500, json: async () => ({ error: "Synthetic persistence failure" }) };
    }
    const payload = JSON.parse(init.body);
    stored = reconcileApplicationMutations(stored, sanitizeApplications(payload.applications), payload.mutations);
    return { ok: true, json: async () => ({ applications: structuredClone(stored) }) };
  };
  const session = { current: { mode: "new", applicationId: null, pendingRelationship: null } };
  const acknowledged = [];
  const publishSession = (next) => { session.current = next; };
  const currentJobTracking = () => ({ role: "Engineer", company: "Synthetic" });
  const config = {
    canApply: true, applyBlocker: "", includeResume: prompt, includeCoverLetter: false,
    jobUrl: "https://example.test/role", preparedJobDescription: "Build accessible software.",
    jobRawText: "Build accessible software.", result: null, currentResumeText: "Built a clinic app.",
    fitAssessmentPersistence: { action: "preserve" }, pipelineAiUsage: {}, currentPreparationId: "prep1",
    getCurrentPreparationId: () => "prep1", getPreparationGeneration: () => 0,
    currentJobTracking, resolveApplyDuplicate: async () => ({ action: "continue", relationship: null }),
    canExportResumePdf: prompt, canExportCoverLetter: false,
    handleDownloadPdf: async () => true, handleDownloadCoverLetterPdf: async () => true,
    getResumeArtifacts: async () => null, getCoverLetterArtifacts: async () => null,
    saveApplicationDocument: async () => ({ ok: true }), resumeDocumentVersion: "r1", coverLetterDocumentVersion: "c1",
    onResumeSaved: noop, onCoverLetterSaved: noop, setApplicationPersistenceReceipt: noop,
    setApplicationActionStatus: noop, setActiveOutputTab: noop, setExpandedApplicationId: noop,
    linkApplication: (id) => publishSession({ mode: "update", applicationId: id, pendingRelationship: null })
  };
  const hooks = () => render(() => {
    const applications = useApplications();
    const flow = useApplyFlow({ ...config, ...applications, refreshApplications: applications.refresh, preparationSession: session.current });
    return { applications, flow };
  });
  let { applications, flow } = hooks();
  await applications.refresh();
  const save = bindSave({
    applicationActionPendingRef: { current: () => flow.isApplyPending() },
    preparationGenerationRef: { current: 0 }, getCurrentPreparationId: config.getCurrentPreparationId,
    hasLoadedApplications: true, preparationSessionRef: session, answersDraftIds: { current: new Map() },
    answersDraftSourceRef: { current: { conversationId: "preparation-0-prep1", relationship: null, target: {
      jobUrl: config.jobUrl, jobDescription: config.preparedJobDescription,
      rawJobDescription: config.jobRawText, metadata: currentJobTracking(), aiUsage: {}
    } } },
    saveApplicationAnswer: applications.saveApplicationAnswer, linkPostingRecords: applications.linkPostingRecords,
    getApplication: applications.getApplication, publishPreparationSession: publishSession,
    duplicateGuard: { ackApplication: (application) => acknowledged.push(application.id) }
  });
  const applying = flow.handleApply();
  if (prompt) await applying;
  else await writeStarted;
  assert.equal(flow.isApplyPending(), true, "Apply owns the preparation before another render");
  await assert.rejects(save(answer, "preparation-0-prep1", false), /Finish or cancel Apply/);
  assert.equal(writes, prompt ? 0 : 1, "blocked Save sends no tracker mutation");
  if (prompt) {
    ({ applications, flow } = hooks());
    assert.ok(flow.applyDownloadPrompt, "the download dialog keeps ownership after resolution settles");
    assert.equal(flow.isApplying, false);
    assert.equal(flow.isApplyPending(), true);
    flow.cancelApply();
  }
  releaseWrite();
  await applying;
  assert.equal(flow.isApplyPending(), false, "success, direct failure, or dialog cancellation releases ownership");
  const appliedId = stored[0]?.id;
  await save(answer, "preparation-0-prep1", false);
  assert.equal(stored.length, 1, "one preparation retains exactly one tracker record");
  assert.equal(stored[0].applicationAnswers.length, 1);
  assert.equal(session.current.applicationId, stored[0].id);
  assert.deepEqual(acknowledged, [stored[0].id], "the saved record is acknowledged so duplicate gates do not report it");
  if (appliedId) {
    assert.equal(stored[0].id, appliedId, "Save after Apply targets the same record");
    assert.equal(stored[0].status, "applied");
  } else {
    assert.equal(stored[0].status, "draft", "Save after failed or cancelled Apply creates a Draft");
    assert.equal(stored[0].appliedAt, undefined);
  }
}

try {
  await scenario();
  await scenario({ failWrite: true });
  await scenario({ prompt: true });
  console.log("Answer/action coordination passed: held Apply, same-record save, failed Apply recovery, and dialog cancellation");
} finally {
  globalThis.fetch = originalFetch;
  reset();
}
