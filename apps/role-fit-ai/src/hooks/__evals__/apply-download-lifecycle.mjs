import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const applyFlow = readFileSync(new URL("../useApplyFlow.ts", import.meta.url), "utf8");
const compact = (source) =>
  source
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
const compactApplyFlow = compact(applyFlow);
const downloadPickStart = applyFlow.indexOf("async function handleApplyDownloadPick(");
const downloadPickEnd = applyFlow.indexOf("\n\n  async function handleApplyOnly()", downloadPickStart);
const downloadPick = applyFlow.slice(downloadPickStart, downloadPickEnd);
const compactDownloadPick = compact(downloadPick);
const commitApplyStart = applyFlow.indexOf("async function commitApply(): Promise<boolean>");
const commitApplyEnd = applyFlow.indexOf("\n  // Apply button handler:", commitApplyStart);
const commitApply = applyFlow.slice(commitApplyStart, commitApplyEnd);
const handleApplyStart = applyFlow.indexOf("async function handleApply()");
const handleApplyEnd = applyFlow.indexOf("\n  // Downloads run sequentially:", handleApplyStart);
const handleApply = applyFlow.slice(handleApplyStart, handleApplyEnd);
const compactHandleApply = compact(handleApply);

assert.ok(downloadPickStart >= 0, "Apply exposes the post-commit download flow");
assert.ok(downloadPickEnd > downloadPickStart, "the download-flow source probe is bounded to its function");
assert.match(
  applyFlow,
  /const \[isResolvingApply, setIsResolvingApply\] = useState\(false\);/,
  "Apply tracks duplicate resolution as its own visible phase"
);
assert.match(
  applyFlow,
  /const \[isCommittingApply, setIsCommittingApply\] = useState\(false\);/,
  "Apply tracks commit persistence separately from post-commit exports"
);
assert.match(
  applyFlow,
  /const \[isDownloadingApplyPdfs, setIsDownloadingApplyPdfs\] = useState\(false\);/,
  "Apply tracks the visible post-commit export phase"
);
assert.match(
  applyFlow,
  /const applyResolutionInFlightRef = useRef\(false\);/,
  "Apply has a synchronous duplicate-resolution reentry guard"
);
assert.match(
  applyFlow,
  /const applyDownloadInFlightRef = useRef\(false\);/,
  "Apply has a synchronous post-commit export reentry guard"
);
assert.match(
  applyFlow,
  /const isApplying = isResolvingApply \|\| isCommittingApply \|\| isDownloadingApplyPdfs;/,
  "public Apply busy state covers resolution, persistence, and exports"
);

const resolutionGuard = compactHandleApply.indexOf(
  "if (applyResolutionInFlightRef.current || applyCommitInFlightRef.current || applyDownloadInFlightRef.current) return;"
);
const claimResolution = compactHandleApply.indexOf(
  "applyResolutionInFlightRef.current = true;",
  resolutionGuard
);
const showResolutionBusy = compactHandleApply.indexOf("setIsResolvingApply(true);", claimResolution);
const captureMaterials = compactHandleApply.indexOf(
  "applyMaterialSelectionRef.current = {",
  showResolutionBusy
);
const awaitResolution = compactHandleApply.indexOf("await resolveApplyDuplicate()", showResolutionBusy);
assert.ok(resolutionGuard >= 0, "Apply rejects reentry during any active lifecycle phase");
assert.ok(
  claimResolution > resolutionGuard &&
    showResolutionBusy > claimResolution &&
    captureMaterials > showResolutionBusy &&
    awaitResolution > captureMaterials,
  "Apply claims visible duplicate-resolution ownership before shared mutation or await"
);

const resolutionFinally = compactHandleApply.lastIndexOf("finally");
const directCommit = compactHandleApply.indexOf("await commitApply()", awaitResolution);
const downloadPrompt = compactHandleApply.indexOf("setApplyDownloadPrompt({", awaitResolution);
const clearResolutionRef = compactHandleApply.indexOf(
  "applyResolutionInFlightRef.current = false;",
  resolutionFinally
);
const clearResolutionState = compactHandleApply.indexOf("setIsResolvingApply(false);", clearResolutionRef);
assert.ok(resolutionFinally > awaitResolution, "duplicate resolution has an outer finally cleanup");
assert.ok(
  clearResolutionRef > resolutionFinally && clearResolutionState > clearResolutionRef,
  "duplicate-resolution ownership always clears on every exit"
);
assert.ok(
  directCommit > awaitResolution && resolutionFinally > directCommit,
  "resolution remains visibly busy across the direct-commit path"
);
assert.ok(
  downloadPrompt > awaitResolution && resolutionFinally > downloadPrompt,
  "the naming prompt is created before resolution busy clears for interaction"
);
assert.match(
  handleApply,
  /catch \{[\s\S]{0,320}?applyMaterialSelectionRef\.current = null;[\s\S]{0,180}?applyMergeTargetRef\.current = null;[\s\S]{0,240}?setApplyStatus\("Duplicate checking failed, so the application was not saved\. Retry Apply\."\);[\s\S]{0,80}?return;/,
  "an unexpected duplicate-check failure clears shared targets and reports that nothing was saved"
);

const outerGuard = compactDownloadPick.indexOf(
  "if (applyResolutionInFlightRef.current || applyDownloadInFlightRef.current || applyCommitInFlightRef.current) return;"
);
const markOuterBusy = compactDownloadPick.indexOf("applyDownloadInFlightRef.current = true;", outerGuard);
const setOuterBusy = compactDownloadPick.indexOf("setIsDownloadingApplyPdfs(true);", markOuterBusy);
const commit = compactDownloadPick.indexOf("if (!(await commitApply())) return;", setOuterBusy);
assert.ok(outerGuard >= 0, "download selection rejects synchronous reentry and concurrent commit");
assert.ok(
  markOuterBusy > outerGuard && setOuterBusy > markOuterBusy && commit > setOuterBusy,
  "download selection claims its outer busy phase before awaiting commit"
);

const runExports = compactDownloadPick.indexOf("await runApplyPdfExports({", commit);
const clearDownloadPrompt = compactDownloadPick.indexOf("setApplyDownloadPrompt(null);", runExports);
assert.ok(
  runExports > commit && clearDownloadPrompt > runExports,
  "a successful commit keeps the prompt mounted until the export helper settles"
);
assert.doesNotMatch(
  compactDownloadPick.slice(commit, runExports),
  /setApplyDownloadPrompt\(null\)/,
  "a failed commit returns with the naming prompt still open for retry"
);

const outerFinally = compactDownloadPick.indexOf("finally", commit);
const clearOuterRef = compactDownloadPick.indexOf(
  "applyDownloadInFlightRef.current = false;",
  outerFinally
);
const clearOuterState = compactDownloadPick.indexOf("setIsDownloadingApplyPdfs(false);", clearOuterRef);
assert.ok(outerFinally > commit, "download busy phase has a finally cleanup");
assert.ok(
  clearOuterRef > outerFinally && clearOuterState > clearOuterRef,
  "download busy clears after all selected exports settle, including exceptions"
);

assert.doesNotMatch(commitApply, /setIsApplying\(/, "commitApply does not clear the combined public busy state");
assert.match(commitApply, /setIsCommittingApply\(false\);/, "commit persistence still clears its own phase");
assert.match(
  compactApplyFlow,
  /if \(applyResolutionInFlightRef\.current \|\| applyCommitInFlightRef\.current \|\| applyDownloadInFlightRef\.current\) return;/,
  "the primary Apply handler is synchronously guarded during every phase"
);
assert.match(
  compactApplyFlow,
  /async function handleApplyOnly\(\) \{\s*if \(applyResolutionInFlightRef\.current \|\| applyCommitInFlightRef\.current \|\| applyDownloadInFlightRef\.current\) return;/,
  "Apply-only cannot start a second commit during resolution, commit, or post-commit exports"
);

console.log("apply-download-lifecycle-eval: passed");
