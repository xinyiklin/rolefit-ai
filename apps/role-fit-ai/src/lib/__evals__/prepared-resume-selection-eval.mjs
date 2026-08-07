import assert from "node:assert/strict";

import { resolvePreparedResumeSelection } from "../../hooks/usePreparedResumeSelection.ts";
import { documentSourceFingerprint } from "../documentSourceFingerprint.ts";

const base = {
  preparationId: "prep-123",
  resumeFileName: "backend.resume",
  source: "automatic",
  sequence: 4,
  busy: false,
  currentFileName: "backend.resume",
  currentDocumentVersion: "complete serialized resume version",
  resumeReady: true
};

assert.equal(resolvePreparedResumeSelection({ ...base, busy: true }), null, "selection cannot settle while ranking or loading is active");
assert.deepEqual(
  resolvePreparedResumeSelection({ ...base, currentFileName: "frontend.resume" }),
  {
    status: "needs-user",
    preparationId: base.preparationId,
    reason: "The recommended resume did not finish loading. Choose a resume to continue."
  },
  "a different active file cannot impersonate the selected resume"
);
assert.equal(
  resolvePreparedResumeSelection({ ...base, resumeReady: false })?.status,
  "needs-user",
  "an incomplete resume needs user action"
);
assert.deepEqual(
  resolvePreparedResumeSelection(base),
  {
    status: "settled",
    preparationId: base.preparationId,
    resumeFileName: base.resumeFileName,
    resumeDocumentVersion: documentSourceFingerprint(base.currentDocumentVersion),
    source: base.source,
    sequence: base.sequence
  },
  "the settled contract binds one preparation to the exact active file and document version"
);

console.log("prepared resume selection probes passed");
