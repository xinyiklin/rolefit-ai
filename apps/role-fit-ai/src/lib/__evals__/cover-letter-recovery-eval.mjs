import assert from "node:assert/strict";

import { coverLetterRecoveryDirty } from "../coverLetterRecovery.ts";

assert.equal(
  coverLetterRecoveryDirty({
    documentDirty: false,
    documentTitle: "Cover letter",
    persistedDocumentTitle: "Cover letter",
    hasContent: false
  }),
  false,
  "an untouched blank default letter does not create recovery noise"
);
assert.equal(
  coverLetterRecoveryDirty({
    documentDirty: false,
    documentTitle: "Acme cover letter",
    persistedDocumentTitle: "Cover letter",
    hasContent: false
  }),
  true,
  "a user-authored title-only change is recoverable"
);
assert.equal(
  coverLetterRecoveryDirty({
    documentDirty: true,
    documentTitle: "Cover letter",
    persistedDocumentTitle: "Cover letter",
    hasContent: false
  }),
  true,
  "a style-only change to a blank letter is recoverable"
);

console.log("cover-letter recovery decisions: PASS");
