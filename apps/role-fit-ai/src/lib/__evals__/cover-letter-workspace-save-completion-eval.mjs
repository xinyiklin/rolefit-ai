import assert from "node:assert/strict";

import { createCoverLetterPersistenceBaselineOwnership } from "../coverLetterPersistenceBaseline.ts";
import {
  applyCoverLetterSaveCompletion,
  coverLetterDocumentVersion,
  createCoverLetterSaveOwnership
} from "../coverLetterWorkspaceOwnership.ts";

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function createCompletionState(baselineOwnership) {
  const state = {
    options: [],
    history: [],
    candidatesRevision: 0,
    activeFileName: "default.cover",
    status: "",
    baselinePayload: "initial",
    baselineTitle: "Initial",
    clean: false,
    recoveryCleared: false
  };
  return {
    state,
    effects: {
      publishSnapshot(snapshot) {
        state.options = snapshot.coverLetterOptions;
        state.history = snapshot.coverLetterHistory;
        state.candidatesRevision += 1;
      },
      bindActiveFile(fileName) {
        state.activeFileName = fileName;
      },
      markClean() {
        state.clean = true;
      },
      commitBaseline(payload, title) {
        baselineOwnership.commit();
        state.baselinePayload = payload;
        state.baselineTitle = title;
      },
      commitBaselineIfUnchanged(expectedRevision, payload, title) {
        if (!baselineOwnership.commitIfUnchanged(expectedRevision)) return false;
        state.baselinePayload = payload;
        state.baselineTitle = title;
        return true;
      },
      clearRecovery() {
        state.recoveryCleared = true;
      },
      setStatus(status) {
        state.status = status;
      }
    }
  };
}

{
  const saveOwnership = createCoverLetterSaveOwnership();
  const baselineOwnership = createCoverLetterPersistenceBaselineOwnership();
  const { state, effects } = createCompletionState(baselineOwnership);
  const firstResponse = deferred();
  const secondResponse = deferred();
  const current = {
    documentVersion: coverLetterDocumentVersion("same payload", "Same title"),
    sourceRevision: 3,
    activeFileName: "default.cover"
  };
  const firstClaim = saveOwnership.claim({
    payload: "same payload",
    documentTitle: "Same title",
    documentVersion: current.documentVersion,
    persistenceBaselineRevision: baselineOwnership.capture(),
    sourceRevision: current.sourceRevision,
    activeFileName: current.activeFileName,
    intendedFileName: "first.cover"
  });
  const secondClaim = saveOwnership.claim({
    payload: "same payload",
    documentTitle: "Same title",
    documentVersion: current.documentVersion,
    persistenceBaselineRevision: baselineOwnership.capture(),
    sourceRevision: current.sourceRevision,
    activeFileName: current.activeFileName,
    intendedFileName: "second.cover"
  });

  const publish = async (response, claim) => {
    const snapshot = await response.promise;
    return applyCoverLetterSaveCompletion({
      completion: saveOwnership.evaluate(claim, current),
      claim,
      snapshot,
      effects
    });
  };
  const pendingFirst = publish(firstResponse, firstClaim);
  const pendingSecond = publish(secondResponse, secondClaim);
  const secondSnapshot = {
    fileName: "second.cover",
    label: "Second",
    coverLetterOptions: [{ fileName: "second.cover", label: "Second" }],
    coverLetterHistory: [{ variant: "second", label: "Second", entries: [] }]
  };
  secondResponse.resolve(secondSnapshot);
  assert.deepEqual(await pendingSecond, {
    published: true,
    baselineAcknowledged: true
  });
  firstResponse.resolve({
    fileName: "first.cover",
    label: "First",
    coverLetterOptions: [{ fileName: "first.cover", label: "First" }],
    coverLetterHistory: [{ variant: "first", label: "First", entries: [] }]
  });
  assert.deepEqual(await pendingFirst, {
    published: false,
    baselineAcknowledged: false
  });

  assert.deepEqual(state.options, secondSnapshot.coverLetterOptions);
  assert.deepEqual(state.history, secondSnapshot.coverLetterHistory);
  assert.equal(state.candidatesRevision, 1);
  assert.equal(state.activeFileName, "second.cover");
  assert.equal(state.status, "Saved Second to your workspace.");
}

{
  const saveOwnership = createCoverLetterSaveOwnership();
  const baselineOwnership = createCoverLetterPersistenceBaselineOwnership();
  const { state, effects } = createCompletionState(baselineOwnership);
  const workspaceResponse = deferred();
  const title = "Application cover letter";
  const payloadP1 = "workspace payload P1";
  const payloadP2 = "application payload P2";
  let current = {
    documentVersion: coverLetterDocumentVersion(payloadP1, title),
    sourceRevision: 5,
    activeFileName: "application.cover"
  };
  const workspaceClaim = saveOwnership.claim({
    payload: payloadP1,
    documentTitle: title,
    documentVersion: current.documentVersion,
    persistenceBaselineRevision: baselineOwnership.capture(),
    sourceRevision: current.sourceRevision,
    activeFileName: current.activeFileName,
    intendedFileName: current.activeFileName
  });
  const pendingWorkspace = workspaceResponse.promise.then((snapshot) =>
    applyCoverLetterSaveCompletion({
      completion: saveOwnership.evaluate(workspaceClaim, current),
      claim: workspaceClaim,
      snapshot,
      effects
    })
  );

  current = {
    ...current,
    documentVersion: coverLetterDocumentVersion(payloadP2, title)
  };
  baselineOwnership.commit();
  state.baselinePayload = payloadP2;
  state.baselineTitle = title;
  state.recoveryCleared = true;

  workspaceResponse.resolve({
    fileName: "application.cover",
    label: "Application",
    coverLetterOptions: [{ fileName: "application.cover", label: "Application" }],
    coverLetterHistory: []
  });
  assert.deepEqual(await pendingWorkspace, {
    published: true,
    baselineAcknowledged: false
  });
  assert.equal(state.baselinePayload, payloadP2);
  assert.equal(state.baselineTitle, title);
  assert.equal(state.recoveryCleared, true);
  const recoveryDirty =
    current.documentVersion !==
    coverLetterDocumentVersion(state.baselinePayload, state.baselineTitle);
  assert.equal(
    recoveryDirty,
    false,
    "a delayed P1 workspace completion cannot make application-saved P2 dirty again"
  );
}

console.log("cover-letter workspace save completion ownership: PASS");
