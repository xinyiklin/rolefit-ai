import assert from "node:assert/strict";

import {
  coverLetterDocumentVersion,
  createCoverLetterReplacementOwnership,
  createCoverLetterSaveOwnership
} from "../coverLetterWorkspaceOwnership.ts";

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const RECOVERY_DEBOUNCE_MS = 1200;

async function loadOwned({ ownership, getDocumentVersion, load, adopt }) {
  const claim = ownership.claim(getDocumentVersion());
  const value = await load;
  const result = ownership.evaluate(claim, getDocumentVersion());
  if (result === "current") adopt(value);
  return result;
}

{
  const ownership = createCoverLetterReplacementOwnership();
  const select = deferred();
  let documentVersion = "draft-v1\u0000Title";
  let adopted = "";

  const pending = loadOwned({
    ownership,
    getDocumentVersion: () => documentVersion,
    load: select.promise,
    adopt: (value) => {
      adopted = value;
    }
  });
  documentVersion = "draft-v2\u0000Title";
  select.resolve("saved variant");

  assert.equal(await pending, "document-changed");
  assert.equal(adopted, "", "typing before a saved select resolves preserves the live draft");
}

{
  const ownership = createCoverLetterReplacementOwnership();
  const restoreA = deferred();
  const openB = deferred();
  let documentVersion = "current";
  const adopted = [];

  const pendingRestore = loadOwned({
    ownership,
    getDocumentVersion: () => documentVersion,
    load: restoreA.promise,
    adopt: (value) => {
      adopted.push(value);
      documentVersion = value;
    }
  });
  const pendingOpen = loadOwned({
    ownership,
    getDocumentVersion: () => documentVersion,
    load: openB.promise,
    adopt: (value) => {
      adopted.push(value);
      documentVersion = value;
    }
  });

  openB.resolve("saved B");
  assert.equal(await pendingOpen, "current");
  restoreA.resolve("history A");
  assert.equal(await pendingRestore, "superseded");
  assert.deepEqual(adopted, ["saved B"], "a later saved open owns a reversed restore response");
}

{
  const ownership = createCoverLetterReplacementOwnership();
  const restoreA = deferred();
  const restoreB = deferred();
  let documentVersion = "current";
  const adopted = [];

  const pendingA = loadOwned({
    ownership,
    getDocumentVersion: () => documentVersion,
    load: restoreA.promise,
    adopt: (value) => {
      adopted.push(value);
      documentVersion = value;
    }
  });
  const pendingB = loadOwned({
    ownership,
    getDocumentVersion: () => documentVersion,
    load: restoreB.promise,
    adopt: (value) => {
      adopted.push(value);
      documentVersion = value;
    }
  });

  restoreB.resolve("history B");
  assert.equal(await pendingB, "current");
  restoreA.resolve("history A");
  assert.equal(await pendingA, "superseded");
  assert.deepEqual(adopted, ["history B"], "the latest restore owns reversed history responses");
}

console.log("cover-letter workspace replacement ownership: PASS");

{
  const ownership = createCoverLetterSaveOwnership();
  const saveResponse = deferred();
  const payloadV1 = "saved payload v1";
  const payloadV2 = "edited payload v2";
  const title = "Application cover letter";
  let current = {
    documentVersion: coverLetterDocumentVersion(payloadV1, title),
    sourceRevision: 4,
    activeFileName: "application.cover"
  };
  let recoveryDraft = null;
  let clearedRecovery = false;

  const claim = ownership.claim({
    payload: payloadV1,
    documentTitle: title,
    documentVersion: current.documentVersion,
    persistenceBaselineRevision: 0,
    sourceRevision: current.sourceRevision,
    activeFileName: current.activeFileName,
    intendedFileName: current.activeFileName
  });
  const pending = saveResponse.promise.then(() => ownership.evaluate(claim, current));

  current = {
    ...current,
    documentVersion: coverLetterDocumentVersion(payloadV2, title)
  };
  // Let the recovery debounce finish before the older workspace save resolves.
  await new Promise((resolve) =>
    setTimeout(() => {
      recoveryDraft = payloadV2;
      resolve();
    }, RECOVERY_DEBOUNCE_MS)
  );
  saveResponse.resolve();
  const result = await pending;
  if (result === "current") {
    recoveryDraft = null;
    clearedRecovery = true;
  }

  assert.equal(result, "document-changed");
  assert.equal(clearedRecovery, false);
  assert.equal(
    recoveryDraft,
    payloadV2,
    "a completed recovery debounce survives an older workspace save"
  );
}

{
  const ownership = createCoverLetterSaveOwnership();
  const saveResponse = deferred();
  let current = {
    documentVersion: coverLetterDocumentVersion("variant A", "A"),
    sourceRevision: 8,
    activeFileName: "a.cover"
  };
  const claim = ownership.claim({
    payload: "variant A",
    documentTitle: "A",
    documentVersion: current.documentVersion,
    persistenceBaselineRevision: 0,
    sourceRevision: current.sourceRevision,
    activeFileName: current.activeFileName,
    intendedFileName: current.activeFileName
  });
  const pending = saveResponse.promise.then(() => ownership.evaluate(claim, current));

  current = {
    documentVersion: coverLetterDocumentVersion("variant B", "B"),
    sourceRevision: 9,
    activeFileName: "b.cover"
  };
  saveResponse.resolve();

  assert.equal(await pending, "document-replaced");
  assert.equal(
    current.activeFileName,
    "b.cover",
    "a delayed save for A cannot rebind the editor after B is opened"
  );
}

{
  const ownership = createCoverLetterSaveOwnership();
  const current = {
    documentVersion: coverLetterDocumentVersion("same payload", "Same title"),
    sourceRevision: 2,
    activeFileName: "same.cover"
  };
  const first = ownership.claim({
    payload: "same payload",
    documentTitle: "Same title",
    documentVersion: current.documentVersion,
    persistenceBaselineRevision: 0,
    sourceRevision: current.sourceRevision,
    activeFileName: current.activeFileName,
    intendedFileName: current.activeFileName
  });
  ownership.claim({
    payload: "same payload",
    documentTitle: "Same title",
    documentVersion: current.documentVersion,
    persistenceBaselineRevision: 0,
    sourceRevision: current.sourceRevision,
    activeFileName: current.activeFileName,
    intendedFileName: "newer.cover"
  });

  assert.equal(
    ownership.evaluate(first, current),
    "superseded",
    "an older save operation cannot publish completion after a newer save begins"
  );
}

console.log("cover-letter workspace save ownership: PASS");
