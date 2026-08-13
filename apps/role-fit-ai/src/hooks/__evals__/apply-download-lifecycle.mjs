import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const applyFlow = readFileSync(new URL("../useApplyFlow.ts", import.meta.url), "utf8");
const compact = (source) =>
  source
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
const compactApplyFlow = compact(applyFlow);
const clearCapturedApplyStart = applyFlow.indexOf("function clearCapturedApply(): void");
const clearCapturedApplyEnd = applyFlow.indexOf("\n  }", clearCapturedApplyStart);
const clearCapturedApply = applyFlow.slice(clearCapturedApplyStart, clearCapturedApplyEnd);
const downloadPickStart = applyFlow.indexOf("async function handleApplyDownloadPick(");
const downloadPickEnd = applyFlow.indexOf("\n\n  async function handleApplyOnly()", downloadPickStart);
const downloadPick = applyFlow.slice(downloadPickStart, downloadPickEnd);
const compactDownloadPick = compact(downloadPick);
const commitApplyStart = applyFlow.indexOf("async function commitApply(): Promise<boolean>");
const commitApplyEnd = applyFlow.indexOf("\n  // New preparations", commitApplyStart);
const commitApply = applyFlow.slice(commitApplyStart, commitApplyEnd);
const blockedCommitStart = commitApply.indexOf("if (!canApplyRef.current)");
const blockedCommitEnd = commitApply.indexOf("if (applyCommitInFlightRef.current)", blockedCommitStart);
const blockedCommit = commitApply.slice(blockedCommitStart, blockedCommitEnd);
const handleApplyStart = applyFlow.indexOf("async function handleApply()");
const handleApplyEnd = applyFlow.indexOf("\n  // Downloads run sequentially:", handleApplyStart);
const handleApply = applyFlow.slice(handleApplyStart, handleApplyEnd);
const compactHandleApply = compact(handleApply);

assert.ok(downloadPickStart >= 0, "Apply exposes the post-commit download flow");
assert.ok(downloadPickEnd > downloadPickStart, "the download-flow source probe is bounded to its function");
assert.ok(commitApplyStart >= 0, "the commit probe finds commitApply");
assert.ok(commitApplyEnd > commitApplyStart, "the commit probe is bounded to commitApply");
assert.ok(
  blockedCommitStart >= 0 && blockedCommitEnd > blockedCommitStart,
  "the readiness probe stays bounded before the commit reentry guard"
);
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
assert.match(
  applyFlow,
  /applicationSavePending: isCommittingApply/,
  "Apply exposes its save-only phase separately from post-commit PDF exports"
);
assert.ok(clearCapturedApplyStart >= 0, "Apply centralizes captured-state cleanup");
for (const ref of [
  "applyMaterialSelectionRef",
  "applySessionRef",
  "applyActionRef",
  "applyUnrelatedApplicationIdRef",
  "applyCommitIdentityRef"
]) {
  assert.ok(
    clearCapturedApply.includes(`${ref}.current = null;`),
    `captured-state cleanup clears ${ref}`
  );
}

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
const captureSession = compactHandleApply.indexOf("applySessionRef.current = session;", captureMaterials);
const newSessionGuard = compactHandleApply.indexOf('if (session.mode === "new")', captureSession);
const awaitResolution = compactHandleApply.indexOf("await resolveApplyDuplicate(isCurrent)", showResolutionBusy);
assert.ok(resolutionGuard >= 0, "Apply rejects reentry during any active lifecycle phase");
assert.ok(
  claimResolution > resolutionGuard &&
    showResolutionBusy > claimResolution &&
    captureMaterials > showResolutionBusy &&
    captureSession > captureMaterials &&
    newSessionGuard > captureSession &&
    awaitResolution > newSessionGuard,
  "Apply captures the explicit session before limiting duplicate review to new preparations"
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
  /catch \{[\s\S]{0,120}?clearCapturedApply\(\);[\s\S]{0,240}?headline: "Nothing was saved",[\s\S]{0,120}?detail: "Duplicate checking failed\. Retry Apply\."[\s\S]{0,120}?return;/,
  "an unexpected duplicate-check failure clears the captured session and reports that nothing was saved"
);
assert.doesNotMatch(
  applyFlow,
  /mergeTargetId|applyMergeTargetRef/,
  "the normal Apply lifecycle carries a relationship result, never a merge target"
);
assert.match(
  handleApply,
  /pendingRelationship: resolution\.relationship/,
  "a confirmed relationship is captured into the new preparation before commit"
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
const commitFinally = commitApply.slice(commitApply.lastIndexOf("finally"));
assert.match(
  commitFinally,
  /finally \{[\s\S]{0,420}?if \(shouldLinkApplication\) linkApplication\(app\.id\);[\s\S]{0,80}?\n\s*\}/,
  "the original Apply links only its still-owned preparation from finally cleanup"
);
assert.match(
  blockedCommit,
  /const message = applyBlockerRef\.current \|\| "Finish preparation before continuing\.";[\s\S]*setApplySaveError\(message\);[\s\S]*detail: message/,
  "a readiness change while the download dialog is open remains visible in that dialog"
);
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
