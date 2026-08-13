import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dock = readFileSync(new URL("../ActionStatus.tsx", import.meta.url), "utf8");
const masthead = readFileSync(new URL("../Masthead.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const applyFlow = readFileSync(new URL("../../hooks/useApplyFlow.ts", import.meta.url), "utf8");
const skipFlow = readFileSync(new URL("../../hooks/useSkipFlow.ts", import.meta.url), "utf8");
const shellStyles = readFileSync(new URL("../../styles/shell.css", import.meta.url), "utf8");
const exportStyles = readFileSync(new URL("../../styles/export-rail.css", import.meta.url), "utf8");
const applyDialog = readFileSync(new URL("../ApplyDownloadDialog.tsx", import.meta.url), "utf8");
const skipDialog = readFileSync(new URL("../SkipJobDialog.tsx", import.meta.url), "utf8");
const draggableDock = readFileSync(new URL("../../hooks/useDraggableDock.ts", import.meta.url), "utf8");
const restRule = shellStyles.match(/\n\.action-status \{[^}]*\}/)?.[0] ?? "";
const textRule = shellStyles.match(/\.action-status__text \{[^}]*\}/)?.[0] ?? "";
const headlineRule = shellStyles.match(/\.action-status__headline \{[^}]*\}/)?.[0] ?? "";
const detailRule = shellStyles.match(/\.action-status__detail \{[^}]*\}/)?.[0] ?? "";
const leaveRule = shellStyles.match(/\.action-status\.is-leaving \{[^}]*\}/)?.[0] ?? "";

// Severity is declared by the flow that wrote the message. A keyword test over
// the wording read "changed before it could be saved" as a calm success.
assert.doesNotMatch(
  app,
  /applicationActionStatus\w*\s*=\s*\/.*\/[a-z]*\.test/,
  "the receipt's tone is never sniffed from its own message text"
);
assert.match(
  app,
  /useState<ApplicationActionStatus \| null>\(null\)/,
  "App holds the receipt as a typed value rather than a bare string"
);
assert.match(
  app,
  /const dismissApplicationActionStatus = useCallback\(\(\) => setApplicationActionStatus\(null\), \[\]\)/,
  "the dismiss callback is stable, or the expiry timer restarts every render"
);
assert.match(
  app,
  /const progressDockVisible = Boolean\(\s*visibleApplicationActionStatus\s*\|\| polishProgressVisible/,
  "the shared dock opens for a receipt, not only for task progress"
);
assert.match(
  app,
  /progress-dock[\s\S]{0,700}?<ActionStatus[\s\S]{0,180}?status=\{visibleApplicationActionStatus\}[\s\S]{0,260}?suspendExpiry=\{applicationActionsBusy \|\| dock\.dragging\}[\s\S]{0,180}?onDismiss=\{dismissApplicationActionStatus\}[\s\S]{0,180}?onDismissButton=\{dismissApplicationActionStatusFromButton\}/,
  "the receipt leads the shared dock column, so it cannot collide with a task card"
);
assert.match(
  app,
  /const visibleApplicationActionStatus = applyDownloadPrompt \|\| skipPrompt \? null : applicationActionStatus/,
  "a dialog-local alert owns failures until its modal closes"
);
const dockTagStart = app.indexOf('<div\n          ref={dock.ref}');
const dockTagEnd = app.indexOf('>', dockTagStart);
assert.ok(dockTagStart >= 0 && dockTagEnd > dockTagStart, "the dock tag probe is bounded");
const dockTag = app.slice(dockTagStart, dockTagEnd + 1);
assert.doesNotMatch(dockTag, /aria-label=/, "the generic dock container is not misnamed as a landmark");
assert.doesNotMatch(
  shellStyles,
  /action-status-dock|\.action-status \{[^}]*position: fixed/,
  "the receipt has no second floating region of its own"
);
assert.match(
  restRule,
  /pointer-events: auto/,
  "the receipt hit-tests as a dock card while the dock stays click-through"
);
assert.doesNotMatch(
  masthead,
  /applicationActionStatus|masthead-feedback/,
  "the masthead no longer anchors a receipt over the inspector record Apply opens"
);

// Only an idle, clean success expires. Hover and focus stay independent so one
// interaction ending cannot unmount the control while the other still holds it.
assert.match(
  dock,
  /const expires = !isError && !suspendExpiry && !hovered && !focused/,
  "errors, active work, dragging, hover, and focus all suspend expiry"
);
assert.match(dock, /onPointerEnter=\{\(\) => setHovered\(true\)\}/);
assert.match(dock, /onPointerLeave=\{\(\) => setHovered\(false\)\}/);
assert.match(dock, /onFocus=\{\(\) => setFocused\(true\)\}/);
assert.match(dock, /onBlur=\{\(\) => setFocused\(false\)\}/);
assert.doesNotMatch(
  dock,
  /key=\{status\.tone\}/,
  "a partial failure changes tone without remounting the focused receipt"
);

// Expiry fades before it unmounts, and the fade is reversible.
assert.match(
  dock,
  /setTimeout\(\(\) => setLeaving\(true\), SUCCESS_HOLD_MS\)[\s\S]{0,140}?setTimeout\(onDismiss, SUCCESS_HOLD_MS \+ FADE_MS\)/,
  "the card fades on its own hold, then unmounts a fade later — never a bare pop-out"
);
assert.match(
  dock,
  /setLeaving\(false\);\s*\n\s*if \(!expires\) return;/,
  "hover, focus, or a replacement message mid-fade returns the card to rest"
);
assert.match(
  restRule,
  /transition: opacity 300ms var\(--ease\), transform 300ms var\(--ease\)/,
  "the leave state has something to animate"
);
assert.match(leaveRule, /opacity: 0/, "the leave state exists");
assert.doesNotMatch(
  leaveRule,
  /pointer-events/,
  "the fading card stays reachable, so it cannot vanish from under a pointer arriving for it"
);
assert.match(
  dock,
  /className="action-status__text"[\s\S]{0,100}?role=\{isError \? "alert" : "status"\}[\s\S]{0,80}?aria-atomic="true"/,
  "the text is an atomic live region without wrapping the dismiss control"
);
assert.match(dock, /aria-label="Dismiss action status"/, "the dismiss action names the shared receipt");
assert.match(
  app,
  /const dismissApplicationActionStatusFromButton = useCallback\(\(\) => \{[\s\S]{0,100}?setApplicationActionStatus\(null\);[\s\S]{0,100}?primaryActionRef\.current\?\.focus\(\)/,
  "explicit receipt dismissal restores focus without making timed expiry steal it"
);
assert.match(restRule, /touch-action: pan-y/, "the receipt preserves touch scrolling in a bounded dock");
assert.match(
  textRule,
  /overflow-wrap: anywhere/,
  "long record titles and server errors cannot overflow the receipt"
);
assert.match(headlineRule, /font-size: 0\.82rem/, "receipt headlines use the body type ramp");
assert.match(detailRule, /font-size: 0\.82rem/, "receipt recovery copy uses the body type ramp");
assert.match(
  shellStyles,
  /@media \(pointer: coarse\)[\s\S]{0,140}?\.action-status__dismiss[\s\S]{0,100}?width: 44px;[\s\S]{0,60}?height: 44px;/,
  "the dismiss action reaches the app's coarse-pointer target size"
);
assert.match(
  shellStyles,
  /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,260}?\.action-status\.is-leaving[\s\S]{0,120}?transform: none/,
  "receipt entry and exit respect reduced-motion preferences"
);

assert.match(
  applyFlow,
  /if \(applyCommitInFlightRef\.current\) return false;\s*\n\s*setApplicationActionStatus\(null\);\s*\n\s*applyCommitInFlightRef\.current = true/,
  "an Apply retry clears its obsolete receipt before the new commit starts"
);
const preArtifactSaveStart = applyFlow.indexOf('setActiveOutputTab("applications");');
const preArtifactSaveEnd = applyFlow.indexOf(
  "const savedDocuments = await saveAppliedDocumentArtifacts(",
  preArtifactSaveStart
);
assert.ok(
  preArtifactSaveStart >= 0 && preArtifactSaveEnd > preArtifactSaveStart,
  "the receipt probe stays bounded to the pre-artifact phase"
);
const preArtifactSave = applyFlow.slice(preArtifactSaveStart, preArtifactSaveEnd);
assert.doesNotMatch(
  preArtifactSave,
  /setApplicationActionStatus\(/,
  "the direct Apply path waits for the document outcome before publishing one receipt"
);
const skipActionSources = [
  skipFlow.slice(
    skipFlow.indexOf("async function handleSkip"),
    skipFlow.indexOf("async function saveSkip")
  ),
  skipFlow.slice(
    skipFlow.indexOf("async function saveSkip"),
    skipFlow.indexOf("async function saveJobUpdates")
  ),
  skipFlow.slice(
    skipFlow.indexOf("async function saveJobUpdates"),
    skipFlow.indexOf("function cancelSkip")
  )
];
for (const source of skipActionSources) {
  assert.match(source, /setApplicationActionStatus\(null\);/, "each Skip action clears its obsolete receipt");
}

// A saved record whose link, document, or PDF failed is a partial result: it
// keeps the sticky error treatment instead of expiring as a clean receipt.
assert.match(
  applyFlow,
  /tone: relationshipWarning \? "error" : "success"/,
  "an unlinked posting downgrades the Apply receipt"
);
assert.match(
  applyFlow,
  /headline: relationshipWarning\s*\? `\$\{action\.receipt\} — relationship update failed`\s*: action\.receipt/,
  "a partial Apply receipt does not keep a clean-success headline"
);
assert.match(
  skipFlow,
  /tone: relationshipWarning \? "error" : "success"/,
  "an unlinked posting downgrades the Skip receipt"
);
assert.match(
  skipFlow,
  /headline: relationshipWarning\s*\? "Saved as skipped — relationship update failed"\s*: "Saved as skipped"/,
  "a partial Skip receipt does not keep a clean-success headline"
);
// The headline is built from the action, not chained onto whatever headline the
// commit left, which stacked "— resume not saved — PDF export failed".
assert.match(
  applyFlow,
  /headline: `\$\{action\.receipt\} — PDF export failed`,\s*\n\s*detail: statusDetail\(current\?\.detail, reason\)/,
  "a failed export keeps the commit's detail and makes the receipt sticky"
);
assert.doesNotMatch(
  applyFlow,
  /`The \$\{failure\.name\} \$\{failure\.reason\}\.`,/,
  "complete server error sentences are not embedded in another sentence"
);
assert.match(
  applyFlow,
  /failures\.map\(\(failure\) => failure\.message\)\.join\(" "\)/,
  "partial-save details preserve complete, readable failure messages"
);
assert.doesNotMatch(shellStyles, /masthead-feedback/, "the masthead-anchored receipt styles are gone");

assert.match(
  shellStyles,
  /\.progress-dock \{[^}]*max-height: calc\(100dvh[^}]*overflow-y: auto/,
  "stacked receipts remain reachable within the viewport"
);
assert.match(draggableDock, /new ResizeObserver\(/, "the dock re-clamps when its content changes size");
assert.match(draggableDock, /window\.addEventListener\("resize"/, "the dock re-clamps after viewport changes");
assert.match(
  exportStyles,
  /\.rename-dialog \{[^}]*display: flex[^}]*align-items: flex-start[^}]*overflow-y: auto/,
  "fixed dialogs scroll safely at high zoom and short viewport heights"
);
for (const source of [applyDialog, skipDialog]) {
  assert.match(source, /returnFocusRef/, "application dialogs restore focus to a persistent action");
}

console.log("Application action receipt passed");
