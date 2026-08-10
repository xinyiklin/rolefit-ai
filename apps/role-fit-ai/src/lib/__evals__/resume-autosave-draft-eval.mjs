import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DOC_STYLE_DEFAULTS } from "@typeset/engine/lib/documentStyle.ts";
import { serializeResumeFile } from "@typeset/engine/lib/resumeFile.ts";

import { createBlankResumeData } from "../blankResume.ts";
import { RESUME_ORIGINS } from "../resumeOrigin.ts";
import { parseResumeAutosaveDraft } from "../resumeAutosaveDraft.ts";

const base = {
  resumeSource: serializeResumeFile(createBlankResumeData(), DOC_STYLE_DEFAULTS),
  savedAt: "2026-08-10T12:00:00.000Z",
  jobLabel: "Backend Engineer · Synthetic Systems"
};

assert.equal(
  parseResumeAutosaveDraft(JSON.stringify(base)),
  null,
  "legacy recovery drafts without an explicit resume origin fail closed"
);

for (const resumeOrigin of RESUME_ORIGINS) {
  assert.equal(
    parseResumeAutosaveDraft(JSON.stringify({ ...base, resumeOrigin }))?.resumeOrigin,
    resumeOrigin,
    `${resumeOrigin} survives the autosave round trip`
  );
}

assert.equal(
  parseResumeAutosaveDraft(JSON.stringify({ ...base, resumeOrigin: "sample-ish" })),
  null,
  "unknown resume origins fail closed"
);

const autosaveHookSource = readFileSync(
  new URL("../../hooks/useAutosaveDraft.ts", import.meta.url),
  "utf8"
);
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
assert.match(
  autosaveHookSource,
  /useAutosaveDraft\(\{[^}]*resumeOrigin/,
  "the autosave hook receives the live resume origin"
);
assert.match(
  autosaveHookSource,
  /saveTabDraft\("resume", \{\s*resumeSource,\s*resumeOrigin,/,
  "the debounced autosave writes the live resume origin beside the strict source"
);
assert.match(
  appSource,
  /function handleRestoreAutosaveDraft\([\s\S]{0,650}?seedResumeData\(restored\.data\);[\s\S]{0,350}?detachBaseResumeIdentity\(\);[\s\S]{0,180}?setFileName\(""\);[\s\S]{0,180}?setResumeOrigin\(draft\.resumeOrigin\)/,
  "resume recovery restores origin explicitly and detaches any unrelated current file identity"
);

console.log("resume autosave origin evals passed");
