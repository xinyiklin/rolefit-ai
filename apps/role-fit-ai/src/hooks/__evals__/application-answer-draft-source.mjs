import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { extractAnswerConstraints, validateAnswerConstraints } from "../../../shared/applicationAnswersContract.ts";
import { sanitizeApplications } from "../../../server/applications/schema.ts";
import { reconcileApplicationMutations } from "../../../server/applications/reconcile.ts";

// Run App's real Answers render code and save handler with the production store:
// source edits after Prepare must not become a first-Save Draft's posting or link.
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const start = appSource.indexOf("  const answersConversationId = ");
const end = appSource.indexOf("  const answerController = useApplicationAnswers(", start);
assert.ok(start >= 0 && end > start, "App's Answers save boundary exists");
const answersBoundary = appSource.slice(start, end);
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
import { useRef } from "react";
import { fitAssessmentPersistenceDecision } from "./src/lib/fitAssessmentLifecycle.ts";
export { useApplications } from "./src/hooks/useApplications.ts";
export { render, reset } from "react";
export function renderAnswersBoundary(context) {
  const { preparationGenerationRef, currentPreparationId, getCurrentPreparationId, hasLoadedApplications,
    preparationSession, preparationSessionRef, jobPrepared, jobUrl, preparedApplicationJobDescription,
    jobRawText, jobTracking, currentJobTracking, importedJob, pipelineAiUsage, fitAssessmentState,
    saveApplicationAnswer, linkPostingRecords, getApplication, publishPreparationSession, duplicateGuard } = context;
  ${answersBoundary}
  return { answersConversationId, handleSaveAnswer };
}`
  },
  bundle: true, write: false, format: "esm", platform: "node",
  plugins: [{ name: "controlled-hooks", setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
    api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: scheduler, loader: "js" }));
  } }]
});
const { useApplications, renderAnswersBoundary, render, reset } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const urlA = "https://alpha.example/jobs/platform-engineer";
const postingA = "Alpha Health is hiring a Platform Engineer to build reliable clinical data services in TypeScript and Postgres.";
const preparedA = [
  "Platform Engineer at Alpha Health",
  "Responsibilities\n- Build reliable clinical data services",
  "Technical keywords\nTypeScript, Postgres",
  "Benefits\nRemote equipment stipend"
].join("\n\n");
const tailoringA = preparedA.slice(0, preparedA.indexOf("\n\nBenefits"));
const trackingA = { company: "Alpha Health", role: "Platform Engineer", title: "Platform Engineer" };
const warningsA = [{ field: "location", message: "The posting does not state a work location." }];
const usageA = { "job-analysis": { source: "ai", provider: "claude-cli", model: "sonnet", completedAt: "2026-10-07T12:00:00.000Z" } };
const fitA = {
  result: {
    verdict: "REASONABLE",
    summary: "Your background aligns well, with a few material gaps.",
    matches: [{ jobExcerpt: "build reliable clinical data services", candidateSource: "RESUME", candidateExcerpt: "built reliable data services" }],
    gaps: ["Clinical domain experience"]
  },
  resumeLabel: "Base resume",
  assessedAt: "2026-10-07T12:01:00.000Z"
};
const postingB = "Beta Robotics needs a Firmware Engineer to write embedded C for motor controllers and bring up new boards.";
const trackingB = { company: "Beta Robotics", role: "Firmware Engineer", title: "Firmware Engineer" };
const relationshipA = { matchedApplicationId: "tracked-alpha", jobPostingGroupId: "group-alpha", confidence: "exact" };
const relationshipB = { matchedApplicationId: "tracked-beta", jobPostingGroupId: "group-beta", confidence: "exact" };

// Prepare committed job A: the prepared snapshot matches the source fields.
const preparedJobA = {
  jobPrepared: true, jobUrl: urlA, preparedApplicationJobDescription: preparedA, jobRawText: postingA,
  jobTracking: trackingA, importedJob: { jobWarnings: warningsA }, pipelineAiUsage: usageA,
  fitAssessmentState: { latestCompleted: { snapshot: fitA, previousPreparation: false } }
};
// handleManualJobDescriptionChange: pasting B clears the prepared snapshot and raw
// posting; the committed preparation, and so the Answers conversation, stays A's.
const pastedJobB = {
  ...preparedJobA, jobPrepared: false, preparedApplicationJobDescription: postingB, jobRawText: "",
  jobTracking: trackingB, importedJob: null, pipelineAiUsage: { "job-analysis": { source: "none" } },
  fitAssessmentState: { latestCompleted: { snapshot: fitA, previousPreparation: true } }
};

const question = "Why do you want to work here?";
const answerText = "I want to build reliable clinical data services for care teams.";
const constraints = extractAnswerConstraints(question);
const validation = validateAnswerConstraints(answerText, constraints);
const answer = {
  id: "answer-1", applicationId: "preparation-1-prepare-1", questionId: "question-1", questionRevision: 1,
  question, answer: answerText, status: "ready", constraints, counts: validation.counts, compliant: validation.compliant
};

let stored = [];
let writes = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  assert.equal(url, "/api/applications");
  if (init.method !== "PUT") return { ok: true, json: async () => ({ applications: structuredClone(stored) }) };
  writes += 1;
  const payload = JSON.parse(init.body);
  stored = reconcileApplicationMutations(stored, sanitizeApplications(payload.applications), payload.mutations);
  return { ok: true, json: async () => ({ applications: structuredClone(stored) }) };
};

async function freshDesk(initialRelationship = null) {
  reset();
  stored = [];
  writes = 0;
  const session = { current: { mode: "new", applicationId: null, pendingRelationship: initialRelationship } };
  const acknowledged = [];
  const links = [];
  let applications;
  const renderDesk = (state) => render(() => {
    applications = useApplications();
    return renderAnswersBoundary({
      ...state,
      preparationGenerationRef: { current: 1 }, currentPreparationId: "prepare-1",
      getCurrentPreparationId: () => "prepare-1", hasLoadedApplications: true,
      preparationSession: session.current, preparationSessionRef: session,
      currentJobTracking: () => state.jobTracking,
      saveApplicationAnswer: applications.saveApplicationAnswer, getApplication: applications.getApplication,
      linkPostingRecords: async (ids, groupId) => { links.push({ ids, groupId }); return true; },
      publishPreparationSession: (next) => { session.current = next; },
      duplicateGuard: { ackApplication: (application) => acknowledged.push(application) }
    });
  });
  renderDesk(preparedJobA);
  await applications.refresh();
  return { renderDesk, session, acknowledged, links };
}

function assertDescribesJobA(draft, label) {
  assert.equal(draft.status, "draft", label);
  assert.equal(draft.jobUrl, urlA, `${label}: committed link`);
  assert.equal(draft.jobDescription, preparedA, `${label}: prepared brief, not source text`);
  assert.equal(draft.rawJobDescription, postingA, `${label}: captured posting`);
  assert.equal(draft.company, "Alpha Health", `${label}: prepared tracking`);
  assert.equal(draft.role, "Platform Engineer", `${label}: prepared tracking`);
  assert.deepEqual(draft.jobWarnings, warningsA, `${label}: prepared job warnings`);
  assert.equal(draft.aiUsage?.["job-analysis"]?.source, "ai", `${label}: Job analysis attribution`);
  assert.equal(draft.fitAssessment?.result.verdict, "REASONABLE", `${label}: the preparation's Fit`);
}

try {
  // Reported case: prepare A, paste B without preparing it, save A's answer.
  {
    const { renderDesk, session, acknowledged } = await freshDesk();
    const desk = renderDesk(pastedJobB);
    assert.equal(desk.answersConversationId, "preparation-1-prepare-1", "pasting B keeps A's conversation");
    await desk.handleSaveAnswer(answer, desk.answersConversationId, false);
    assert.equal(stored.length, 1, "first Save creates one Draft");
    assertDescribesJobA(stored[0], "pasted B");
    assert.equal(stored[0].applicationAnswers.length, 1);
    assert.deepEqual(session.current, { mode: "update", applicationId: stored[0].id, pendingRelationship: null });
    assert.equal(acknowledged.length, 1);
    assert.equal(acknowledged[0].rawJobDescription, postingA, "duplicate gates acknowledge A's Draft, not B");
  }

  // A typed B link, then a stopped Prepare of B that chose Link: the Draft keeps
  // A's link and relationship, never B's.
  {
    const { renderDesk, session, links } = await freshDesk(relationshipA);
    renderDesk(preparedJobA);
    const typedLinkB = {
      ...preparedJobA, jobPrepared: false, jobUrl: "https://beta.example/jobs/firmware",
      preparedApplicationJobDescription: tailoringA, jobTracking: trackingB, importedJob: null,
      fitAssessmentState: { latestCompleted: { snapshot: fitA, previousPreparation: true } }
    };
    renderDesk(typedLinkB);
    session.current = { mode: "new", applicationId: null, pendingRelationship: relationshipB };
    const desk = renderDesk(typedLinkB);
    await desk.handleSaveAnswer(answer, desk.answersConversationId, false);
    assert.equal(stored.length, 1);
    assertDescribesJobA(stored[0], "typed B link");
    assert.deepEqual(links, [{ ids: [stored[0].id, "tracked-alpha"], groupId: "group-alpha" }],
      "the Draft links only through the relationship A's preparation chose");
    assert.equal(session.current.applicationId, stored[0].id);
  }

  // A conversation that never had a prepared job has nothing committed to describe.
  {
    reset();
    stored = [];
    writes = 0;
    const session = { current: { mode: "new", applicationId: null, pendingRelationship: null } };
    let applications;
    const renderDesk = () => render(() => {
      applications = useApplications();
      return renderAnswersBoundary({
        ...pastedJobB, preparationGenerationRef: { current: 0 }, currentPreparationId: "",
        getCurrentPreparationId: () => "", hasLoadedApplications: true,
        preparationSession: session.current, preparationSessionRef: session,
        currentJobTracking: () => pastedJobB.jobTracking,
        saveApplicationAnswer: applications.saveApplicationAnswer, getApplication: applications.getApplication,
        linkPostingRecords: async () => true, publishPreparationSession: (next) => { session.current = next; },
        duplicateGuard: { ackApplication: () => undefined }
      });
    });
    renderDesk();
    await applications.refresh();
    const desk = renderDesk();
    await assert.rejects(desk.handleSaveAnswer(answer, desk.answersConversationId, false), /Prepare the posting/);
    assert.equal(writes, 0, "an unprepared source never becomes a Draft");
    assert.equal(session.current.mode, "new");
  }

  console.log("Answers Draft source passed: pasted source, typed link with an uncommitted relationship, and no prepared job");
} finally {
  globalThis.fetch = originalFetch;
  reset();
}
