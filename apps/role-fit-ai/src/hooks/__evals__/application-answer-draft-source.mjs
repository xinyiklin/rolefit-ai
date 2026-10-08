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
function appBlock(startMarker, endMarker, label) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `App's ${label} exists`);
  return appSource.slice(start, end);
}
const answersBoundary = appBlock(
  "  const answersConversationId = ", "  const answerController = useApplicationAnswers(", "Answers save boundary"
);
// The relationship's path into that save: the session owner, the committed-intake setter, and the duplicate guard.
const sessionBlock = appBlock(
  "  const [preparationSession, setPreparationSession] = useState(", "  const getPreparationOwner = useCallback(", "preparation session"
);
const commitSetterBlock = appBlock(
  "  const importedJobRef = useRef(", "  const handlePreparedJobTrackingChange = useCallback(", "committed-intake setter"
);
const duplicateGuardBlock = appBlock(
  "  const duplicateGuard = useDuplicateGuard({", "  const preparedSnapshotMatchesInputs = Boolean(", "duplicate guard"
);
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
import { useCallback, useRef, useState } from "react";
import { fitAssessmentPersistenceDecision } from "./src/lib/fitAssessmentLifecycle.ts";
import { newPreparationSession } from "./src/lib/preparationSession.ts";
import { useDuplicateGuard } from "./src/hooks/useDuplicateGuard.ts";
export { useApplications } from "./src/hooks/useApplications.ts";
export { render, reset } from "react";
export function renderAnswersBoundary(context) {
  const { preparationGenerationRef, currentPreparationId, getCurrentPreparationId, hasLoadedApplications,
    preparationSession, preparationSessionRef, jobPrepared, jobUrl, preparedApplicationJobDescription,
    jobRawText, jobTracking, currentJobTracking, importedJob, pipelineAiUsage, fitAssessmentState,
    saveApplicationAnswer, linkPostingRecords, getApplication, publishPreparationSession, duplicateGuard } = context;
  ${answersBoundary}
  return { answersConversationId, handleSaveAnswer };
}
export function renderPreparationDesk(context) {
  const { currentPreparationId, getCurrentPreparationId, hasLoadedApplications, jobPrepared, jobUrl, jobDescription,
    preparedApplicationJobDescription, jobRawText, jobTracking, currentJobTracking, importedJob, pipelineAiUsage,
    fitAssessmentState, saveApplicationAnswer, linkPostingRecords, getApplication, refreshApplications,
    findDuplicatesForTarget, setImportedJob } = context;
  // Document-title and material-card effects of a commit are outside this eval.
  const setMaterialSelection = () => undefined, DEFAULT_MATERIAL_SELECTION = null;
  const clearPreparedResumeRecommendationRef = { current: () => undefined };
  const resolveResumeApplicantName = () => "", editedResume = null, currentResumeText = "", resumeText = "";
  const setDocumentTitle = () => undefined, documentTitleForJob = () => "", setCoverLetterTitle = () => undefined;
  const handleLoadApplication = async () => false;
  ${sessionBlock}
  ${commitSetterBlock}
  ${duplicateGuardBlock}
  ${answersBoundary}
  return { preparationSession, publishPreparationSession, answersConversationId, handleSaveAnswer,
    setImportedJobAndDocumentTitle, duplicateGuard };
}`
  },
  bundle: true, write: false, format: "esm", platform: "node",
  plugins: [{ name: "controlled-hooks", setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "controlled" }));
    api.onLoad({ filter: /.*/, namespace: "controlled" }, () => ({ contents: scheduler, loader: "js" }));
  } }]
});
const { useApplications, renderAnswersBoundary, renderPreparationDesk, render, reset } = await import(
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
      duplicateGuard: { ackApplication: (application) => acknowledged.push(application), rememberedRelationship: () => undefined }
    });
  });
  renderDesk(preparedJobA);
  await applications.refresh();
  return { renderDesk, session, acknowledged, links };
}

// The composed desk runs the relationship's whole path in App: a Prepare run's duplicate gates
// (useDuplicateGuard), its commit (setImportedJobAndDocumentTitle), any later gate on the
// prepared job, and the first Answers Save, with App's real session generation.
const settle = () => new Promise((resolve) => setImmediate(resolve));
const urlB = "https://beta.example/jobs/firmware";
const preparedB = "Firmware Engineer at Beta Robotics\n\nResponsibilities\n- Write embedded C for motor controllers";
const snapshotA = { url: urlA, sourceText: postingA, tracking: trackingA, jobWarnings: warningsA };
const idleDesk = {
  jobPrepared: false, jobUrl: "", jobDescription: "", preparedApplicationJobDescription: "", jobRawText: "",
  jobTracking: {}, importedJob: null, pipelineAiUsage: {}, fitAssessmentState: { latestCompleted: null }
};
const deskJobA = { ...preparedJobA, jobDescription: tailoringA, importedJob: snapshotA };
// Prepare's paste path: B's text with the link field cleared, so nothing tracked matches it.
const pastedDeskB = {
  ...idleDesk, jobDescription: postingB, preparedApplicationJobDescription: postingB, jobTracking: trackingB,
  fitAssessmentState: { latestCompleted: { snapshot: fitA, previousPreparation: true } }
};
const deskJobB = {
  ...pastedDeskB, jobPrepared: true, jobDescription: preparedB, preparedApplicationJobDescription: preparedB,
  jobRawText: postingB, importedJob: { url: "", sourceText: postingB, tracking: trackingB, jobWarnings: [] },
  pipelineAiUsage: { "job-analysis": { source: "local", completedAt: "2026-10-07T13:00:00.000Z" } },
  fitAssessmentState: { latestCompleted: null }
};
const targetA = { url: urlA, text: postingA, tracking: trackingA };
const trackedRecord = (id, jobPostingGroupId, company, role, jobUrl) => ({
  id, jobPostingGroupId, company, role, title: `${role} at ${company}`, status: "applied", jobUrl,
  jobDescription: `${role} at ${company}`, createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-02T12:00:00.000Z", appliedAt: "2026-09-02T12:00:00.000Z"
});
const tracksAlpha = (target) => target.jobUrl === urlA && {
  application: trackedRecord("tracked-alpha", "group-alpha", "Alpha Health", "Platform Engineer", urlA),
  level: "same-posting", confidence: "exact", evidence: ["Same canonical posting URL"]
};
const tracksBeta = (target) => target.jobUrl === urlB && {
  application: trackedRecord("tracked-beta", "group-beta", "Beta Robotics", "Firmware Engineer", urlB),
  level: "same-posting", confidence: "exact", evidence: ["Same canonical posting URL"]
};
const tracksEditedAlpha = (target) => target.company === "Alpha Health Labs" && tracksAlpha({ jobUrl: urlA });
const answerIn = (conversationId) => ({ ...answer, applicationId: conversationId });

async function preparationDesk() {
  reset();
  stored = [];
  writes = 0;
  const desk = { tracked: [], links: [], linkOk: true, committedId: "" };
  let applications;
  desk.render = (state) => render(() => {
    applications = useApplications();
    return renderPreparationDesk({
      ...state, hasLoadedApplications: true,
      currentPreparationId: desk.committedId, getCurrentPreparationId: () => desk.committedId,
      currentJobTracking: () => state.jobTracking,
      saveApplicationAnswer: applications.saveApplicationAnswer, getApplication: applications.getApplication,
      refreshApplications: async () => true,
      findDuplicatesForTarget: (target) => desk.tracked.map((tracks) => tracks(target)).filter(Boolean),
      linkPostingRecords: async (ids, groupId) => { desk.links.push({ ids, groupId }); return desk.linkOk; },
      setImportedJob: () => undefined
    });
  });
  desk.render(idleDesk);
  await applications.refresh();
  return desk;
}

async function runGate(desk, state, gate, { url, text, tracking }, choice) {
  const pending = desk.render(state).duplicateGuard[gate](url, text, tracking, () => true);
  await settle();
  const guard = desk.render(state).duplicateGuard;
  if (guard.duplicatePrompt) guard.chooseDuplicate(choice);
  return pending;
}

// useJobIntake's commit contract (pinned in job-intake-entry-points.mjs): after both gates the
// run commits its prepared job with the later gate's resolution, else the earlier one.
async function commitRun(desk, fromState, preparedState, preparationId, target, choice) {
  const before = await runGate(desk, fromState, "confirmDuplicateBeforeJobAnalysis", target, choice);
  const after = await runGate(desk, fromState, "confirmDuplicateAfterJobAnalysis", target, choice);
  assert.ok(before.proceed && after.proceed, "the run continues to its commit");
  desk.render(fromState).setImportedJobAndDocumentTitle(
    preparedState.importedJob,
    after.relationship === undefined ? before.relationship : after.relationship
  );
  desk.committedId = preparationId;
  return desk.render(preparedState);
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

  // Baseline: a Link chosen in A's own Prepare reaches A's first Save.
  {
    const desk = await preparationDesk();
    desk.tracked.push(tracksAlpha);
    const view = await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA, "link");
    assert.deepEqual(view.preparationSession.pendingRelationship, relationshipA, "A's Link lands with A's commit");
    await view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false);
    assertDescribesJobA(stored[0], "A's own Link");
    assert.deepEqual(desk.links, [{ ids: [stored[0].id, "tracked-alpha"], groupId: "group-alpha" }]);
  }

  // Carry-over: A linked to T and left unsaved; B pasted and prepared with no duplicate match.
  {
    const desk = await preparationDesk();
    desk.tracked.push(tracksAlpha);
    await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA, "link");
    desk.render(pastedDeskB).setImportedJobAndDocumentTitle(null);
    const view = await commitRun(desk, pastedDeskB, deskJobB, "prepare-2", { url: "", text: postingB, tracking: trackingB });
    assert.equal(view.answersConversationId, "preparation-2-prepare-2", "B's commit starts its own conversation");
    assert.equal(view.preparationSession.pendingRelationship, null, "A's Link does not carry into B's preparation");
    await view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].rawJobDescription, postingB, "the Draft describes B");
    assert.equal(stored[0].company, "Beta Robotics");
    assert.deepEqual(desk.links, [], "B's Draft joins no posting group");
  }

  // In-flight leak: an extension or Retry Prepare of B keeps A's source fields while it runs, so A
  // still reads as prepared. B's duplicate choice must not reach A's first Save, made mid-run
  // (Save stays enabled during Prepare) or after B stops.
  for (const [label, choiceForB, aLinked] of [
    ["B linked, A linked", "link", true],
    ["B kept separate, A linked", "separate", true],
    ["B linked, A unmatched", "link", false]
  ]) {
    const desk = await preparationDesk();
    if (aLinked) desk.tracked.push(tracksAlpha);
    desk.tracked.push(tracksBeta);
    await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA, "link");
    const gate = await runGate(desk, deskJobA, "confirmDuplicateBeforeJobAnalysis",
      { url: urlB, text: postingB, tracking: trackingB }, choiceForB);
    assert.equal(gate.proceed, true, `${label}: B's run continues past the gate`);
    const view = desk.render(deskJobA);
    assert.equal(view.answersConversationId, "preparation-1-prepare-1", `${label}: A's conversation is still current`);
    assert.deepEqual(view.preparationSession.pendingRelationship, aLinked ? relationshipA : null,
      `${label}: an uncommitted run's choice does not replace A's`);
    await view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false);
    assertDescribesJobA(stored[0], label);
    assert.deepEqual(desk.links, aLinked ? [{ ids: [stored[0].id, "tracked-alpha"], groupId: "group-alpha" }] : [],
      `${label}: A's Draft links only through A's own preparation`);
  }

  // Re-preparing the same posting keeps its generation, and a match found by that run still lands.
  {
    const desk = await preparationDesk();
    await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA);
    desk.tracked.push(tracksAlpha);
    const view = await commitRun(desk, deskJobA, deskJobA, "prepare-2", targetA, "link");
    assert.equal(view.answersConversationId, "preparation-1-prepare-2");
    assert.deepEqual(view.preparationSession.pendingRelationship, relationshipA);
    await view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false);
    assert.deepEqual(desk.links, [{ ids: [stored[0].id, "tracked-alpha"], groupId: "group-alpha" }]);
  }

  // A later Polish gate on the same prepared job may still supply the relationship.
  {
    const desk = await preparationDesk();
    await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA);
    desk.tracked.push(tracksAlpha);
    const polish = desk.render(deskJobA).duplicateGuard.confirmDuplicateBeforePolish(() => true);
    await settle();
    desk.render(deskJobA).duplicateGuard.chooseDuplicate("link");
    assert.equal(await polish, true);
    const view = desk.render(deskJobA);
    assert.equal(view.answersConversationId, "preparation-1-prepare-1");
    await view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false);
    assertDescribesJobA(stored[0], "Polish-time Link");
    assert.deepEqual(desk.links, [{ ids: [stored[0].id, "tracked-alpha"], groupId: "group-alpha" }]);
  }

  // A Link chosen in a stopped re-prepare of the same posting is remembered; the next Polish
  // gate reuses it for that posting without asking and publishes it.
  {
    const desk = await preparationDesk();
    await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA);
    desk.tracked.push(tracksAlpha);
    const stopped = await runGate(desk, deskJobA, "confirmDuplicateBeforeJobAnalysis", targetA, "link");
    assert.deepEqual(stopped.relationship, relationshipA);
    assert.equal(desk.render(deskJobA).preparationSession.pendingRelationship, null, "the stopped run publishes nothing");
    const polish = desk.render(deskJobA).duplicateGuard.confirmDuplicateBeforePolish(() => true);
    assert.equal(await polish, true);
    const view = desk.render(deskJobA);
    assert.equal(view.duplicateGuard.duplicatePrompt, null, "Polish reuses the choice without asking again");
    assert.equal(view.answersConversationId, "preparation-1-prepare-1");
    assert.deepEqual(view.preparationSession.pendingRelationship, relationshipA);
    await view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false);
    assertDescribesJobA(stored[0], "Polish reuse after a stopped re-prepare");
    assert.deepEqual(desk.links, [{ ids: [stored[0].id, "tracked-alpha"], groupId: "group-alpha" }]);
  }

  // The first Answers Save reuses that remembered Link the same way when it comes before any
  // Polish, Apply or Skip gate, without asking.
  {
    const desk = await preparationDesk();
    await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA);
    desk.tracked.push(tracksAlpha);
    await runGate(desk, deskJobA, "confirmDuplicateBeforeJobAnalysis", targetA, "link");
    const view = desk.render(deskJobA);
    assert.equal(view.preparationSession.pendingRelationship, null, "the stopped run publishes nothing");
    await view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false);
    assertDescribesJobA(stored[0], "first Save after a stopped re-prepare");
    assert.deepEqual(desk.links, [{ ids: [stored[0].id, "tracked-alpha"], groupId: "group-alpha" }],
      "the remembered Link reaches the Draft with no later gate");
    assert.equal(desk.render(deskJobA).duplicateGuard.duplicatePrompt, null, "Save never asks");
  }

  // The lookup uses the posting as last prepared: pasting B afterwards, unprepared, still links
  // A's first Save through A's remembered Link.
  {
    const desk = await preparationDesk();
    await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA);
    desk.tracked.push(tracksAlpha);
    await runGate(desk, deskJobA, "confirmDuplicateBeforeJobAnalysis", targetA, "link");
    const pastedOverA = {
      ...deskJobA, jobPrepared: false, jobDescription: postingB, preparedApplicationJobDescription: postingB,
      jobRawText: "", jobTracking: trackingB, importedJob: null
    };
    const view = desk.render(pastedOverA);
    assert.equal(view.answersConversationId, "preparation-1-prepare-1", "pasting B keeps A's conversation");
    await view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false);
    assertDescribesJobA(stored[0], "remembered Link after pasting B");
    assert.deepEqual(desk.links, [{ ids: [stored[0].id, "tracked-alpha"], groupId: "group-alpha" }],
      "the remembered Link is looked up for A's prepared posting, not the live source fields");
  }

  // As at Polish and Apply, a remembered Keep separate for the posting's top match wins over a
  // committed Link.
  {
    const desk = await preparationDesk();
    desk.tracked.push(tracksAlpha);
    await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA, "link");
    const repost = (target) => target.jobUrl === urlA && {
      application: trackedRecord("tracked-alpha-repost", "group-alpha-repost", "Alpha Health", "Platform Engineer", urlA),
      level: "same-posting", confidence: "exact", evidence: ["Same canonical posting URL"]
    };
    desk.tracked.unshift(repost);
    await runGate(desk, deskJobA, "confirmDuplicateBeforeJobAnalysis", targetA, "separate");
    const view = desk.render(deskJobA);
    assert.deepEqual(view.preparationSession.pendingRelationship, relationshipA, "the committed Link is unchanged");
    await view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false);
    assertDescribesJobA(stored[0], "remembered Keep separate");
    assert.deepEqual(desk.links, [], "the Draft is saved unlinked");
  }

  // A Save retried after its link failed finds the remembered match, not its own Draft.
  {
    const desk = await preparationDesk();
    await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA);
    desk.tracked.push((target) => target.jobUrl === urlA && stored[0] && {
      application: stored[0], level: "same-posting", confidence: "exact", evidence: ["Same canonical posting URL"]
    }, tracksAlpha);
    await runGate(desk, deskJobA, "confirmDuplicateBeforeJobAnalysis", targetA, "link");
    desk.linkOk = false;
    const view = desk.render(deskJobA);
    await assert.rejects(view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false),
      /Retry Save to finish linking/);
    desk.linkOk = true;
    const retry = desk.render(deskJobA);
    await retry.handleSaveAnswer(answerIn(retry.answersConversationId), retry.answersConversationId, false);
    assert.equal(stored.length, 1, "the retry updates the same Draft");
    assert.deepEqual(desk.links, [
      { ids: [stored[0].id, "tracked-alpha"], groupId: "group-alpha" },
      { ids: [stored[0].id, "tracked-alpha"], groupId: "group-alpha" }
    ], "the retry links the Draft to the remembered match");
  }

  // A remembered choice belongs to its posting: B's in-flight Link to a record that also
  // matches A makes Polish on A ask again rather than reuse it.
  {
    const desk = await preparationDesk();
    await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA);
    desk.tracked.push((target) => (target.jobUrl === urlA || target.jobUrl === urlB) && tracksBeta({ jobUrl: urlB }));
    await runGate(desk, deskJobA, "confirmDuplicateBeforeJobAnalysis", { url: urlB, text: postingB, tracking: trackingB }, "link");
    const polish = desk.render(deskJobA).duplicateGuard.confirmDuplicateBeforePolish(() => true);
    await settle();
    const asked = desk.render(deskJobA).duplicateGuard;
    assert.ok(asked.duplicatePrompt, "Polish on A asks about the shared match instead of reusing B's Link");
    asked.chooseDuplicate("cancel");
    assert.equal(await polish, false);
    const view = desk.render(deskJobA);
    assert.equal(view.preparationSession.pendingRelationship, null);
    await view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false);
    assert.deepEqual(desk.links, [], "B's remembered Link never reaches A's Draft");
  }

  // A capture from an older conversation never describes the current one: after Save, Start a
  // new preparation (App's choosePreparedSourceReplacement) and a run that never commits.
  {
    const desk = await preparationDesk();
    let view = await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA);
    await view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false);
    assert.equal(desk.render(deskJobA).preparationSession.mode, "update");
    desk.render(deskJobA).publishPreparationSession({ mode: "new", applicationId: null, pendingRelationship: null }, true);
    view = desk.render(pastedDeskB);
    assert.equal(view.answersConversationId, "preparation-2-prepare-1", "the new preparation has its own conversation");
    await assert.rejects(view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false),
      /Prepare the posting/, "A's capture belongs to the earlier conversation");
    assert.equal(stored.length, 1, "no second Draft is created from A's posting");
  }

  // A same-posting re-prepare that resolves nothing keeps a Polish-time Link for that posting.
  {
    const desk = await preparationDesk();
    desk.tracked.push(tracksEditedAlpha);
    await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA);
    // Edited tracking matches T at Polish; Prepare's freshly extracted tracking does not.
    const editedA = { ...deskJobA, jobTracking: { ...trackingA, company: "Alpha Health Labs" } };
    const polish = desk.render(editedA).duplicateGuard.confirmDuplicateBeforePolish(() => true);
    await settle();
    desk.render(editedA).duplicateGuard.chooseDuplicate("link");
    assert.equal(await polish, true);
    const view = await commitRun(desk, editedA, editedA, "prepare-2", targetA);
    assert.equal(view.answersConversationId, "preparation-1-prepare-2");
    assert.deepEqual(view.preparationSession.pendingRelationship, relationshipA, "the posting's confirmed Link survives");
    await view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false);
    assert.deepEqual(desk.links, [{ ids: [stored[0].id, "tracked-alpha"], groupId: "group-alpha" }]);
  }

  // A queued extension run commits through the setter from its delivery render. When B committed
  // in between, A is a new preparation and must not keep B's Link.
  {
    const desk = await preparationDesk();
    desk.tracked.push(tracksBeta);
    await commitRun(desk, idleDesk, deskJobA, "prepare-1", targetA);
    const queuedSetter = desk.render(deskJobA).setImportedJobAndDocumentTitle;
    const deskJobBLinked = { ...deskJobB, jobUrl: urlB, importedJob: { ...deskJobB.importedJob, url: urlB } };
    await commitRun(desk, deskJobA, deskJobBLinked, "prepare-2", { url: urlB, text: postingB, tracking: trackingB }, "link");
    queuedSetter(snapshotA, undefined);
    desk.committedId = "prepare-3";
    const view = desk.render(deskJobA);
    assert.equal(view.answersConversationId, "preparation-3-prepare-3", "A after B is a new preparation");
    assert.equal(view.preparationSession.pendingRelationship, null, "B's Link does not carry into A");
    await view.handleSaveAnswer(answerIn(view.answersConversationId), view.answersConversationId, false);
    assertDescribesJobA(stored[0], "queued A after B");
    assert.deepEqual(desk.links, []);
  }

  console.log("Answers Draft source passed: pasted source, typed link with an uncommitted relationship, no prepared job, run-scoped posting relationships, and remembered choices for the same posting");
} finally {
  globalThis.fetch = originalFetch;
  reset();
}
