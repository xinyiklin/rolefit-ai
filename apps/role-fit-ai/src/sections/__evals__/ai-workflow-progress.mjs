import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const progressSource = readFileSync(new URL("../AiWorkflowProgress.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const jobIntakeSource = readFileSync(new URL("../../hooks/useJobIntake.ts", import.meta.url), "utf8");
const coverSource = readFileSync(new URL("../../hooks/useCoverLetter.ts", import.meta.url), "utf8");
const answersSource = readFileSync(new URL("../../hooks/useApplicationAnswers.ts", import.meta.url), "utf8");

assert.doesNotMatch(progressSource, /workflowStepLabel|Step \$\{|Step \d+ of \d+/, "single-task cards omit step counters");

for (const stageKey of ["job-analysis", "resume-polish", "cover", "answers"]) {
  assert.match(appSource, new RegExp(`stageKey=["']${stageKey}["']`), `${stageKey} renders as its own progress card`);
}

assert.match(appSource, /onStop=\{isExtractingLink \? stopJobAnalysis : undefined\}/, "active Job analysis exposes Stop");
assert.match(appSource, /onStop=\{stopPolish\}/, "active Resume Polish exposes Stop");
assert.match(appSource, /onStop=\{stopCoverPolish\}/, "active Cover Letter Polish exposes Stop");
assert.match(appSource, /onStop=\{stopAnswers\}/, "active answer drafting exposes Stop");

assert.match(jobIntakeSource, /function stopJobAnalysis\(\)[\s\S]*?controller\.abort\(\)/, "Job analysis Stop aborts its request owner");
assert.match(coverSource, /const stopCoverPolish[\s\S]*?invalidateCoverRequest\(\)/, "Cover Letter Stop invalidates and aborts its request owner");
assert.match(answersSource, /function stopAnswers\(\)[\s\S]*?requestAbortRef\.current\.abort\(\)/, "answer Stop aborts its request owner");

console.log("AI workflow progress: 12/12 checks passed");
