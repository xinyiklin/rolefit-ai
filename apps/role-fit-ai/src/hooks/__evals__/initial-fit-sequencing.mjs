import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const intake = readFileSync(new URL("../useJobIntake.ts", import.meta.url), "utf8");

assert.match(intake, /preparationId:\s*createPreparationId\(\)/, "every prepared intake snapshot receives a fresh preparation identity");
assert.match(
  app,
  /jobPrepared && jobAnalysisProgress\.status === "done" && importedJob[\s\S]{0,100}?importedJob\.preparationId/,
  "Initial Fit is eligible only after successful Job analysis"
);
assert.match(
  app,
  /const selectionSequence = initialFitPreparationId[\s\S]{0,160}?preparedResumeSelection\.begin\("automatic"\)[\s\S]*?readBaseResumeCandidates\(options\)/,
  "resume selection enters its pending state before candidate reads begin"
);
assert.match(
  app,
  /setIsRankingResumeVariants\(false\);[\s\S]{0,180}?preparedResumeSelection\.complete\(selectionSequence, selectedFileName, "automatic"\)/,
  "automatic selection completes only after ranking and any guarded load settle"
);
assert.match(
  app,
  /const applied = await loadBaseResumeVersion\(fileName\);[\s\S]{0,180}?if \(applied && initialFitPreparationId\)[\s\S]{0,180}?"manual"/,
  "a manual resume switch creates a new audit trigger only after the replacement commits"
);
assert.match(app, /resumeText:\s*fullResumeEvidenceText\(editedResume\)/, "Initial Fit receives the whole non-contact resume evidence view");
const autoKey = app.slice(
  app.indexOf("const initialFitAutoRunKey"),
  app.indexOf("const dispatchedInitialFitKeysRef")
);
assert.match(autoKey, /preparationId.*sequence.*currentInitialFitResumeVersion/s, "the automatic dispatch key binds preparation, selection event, and exact document version");
assert.doesNotMatch(autoKey, /jobDescription|resumeText|honestContext/, "later job or editor changes do not create a new automatic dispatch key");
assert.match(
  app,
  /dispatchedInitialFitKeysRef\.current\.add\(initialFitAutoRunKey\);\s*void initialFitAudit\.run\(\)/,
  "each automatic dispatch key is claimed before the request starts"
);
assert.match(
  app,
  /const readyInitialFitAudit =[\s\S]{0,220}?state\.result\.fingerprint === initialFitAudit\.fingerprint/,
  "render, automation, and Apply cannot consume a ready result from an earlier live input"
);
assert.match(
  app,
  /const applyPipelineAiUsage = initialFitPreparationId[\s\S]{0,300}?if \(readyInitialFitAudit\)[\s\S]{0,120}?delete usage\["initial-fit"\]/,
  "Apply strips stale Initial Fit provenance synchronously instead of waiting for an effect"
);

console.log("initial fit sequencing guards passed");
