import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const applications = readFileSync(new URL("../useApplications.ts", import.meta.url), "utf8");
const apply = readFileSync(new URL("../useApplyFlow.ts", import.meta.url), "utf8");
const skip = readFileSync(new URL("../useSkipFlow.ts", import.meta.url), "utf8");
const prepare = readFileSync(
  new URL("../../sections/tabs/PrepareTab.tsx", import.meta.url),
  "utf8"
);
const materialCard = readFileSync(
  new URL("../../sections/tabs/prepare/PreparedMaterialCard.tsx", import.meta.url),
  "utf8"
);
const prepareRail = readFileSync(
  new URL("../../sections/tabs/prepare/PrepareApplicationRail.tsx", import.meta.url),
  "utf8"
);
const prepareStyles = readFileSync(new URL("../../styles/prepare.css", import.meta.url), "utf8");

assert.match(
  app,
  /const applyReady = hasLoadedApplications && preparationReadiness\.canApply/,
  "Apply waits for the first authoritative tracker snapshot"
);
assert.match(
  applications,
  /findDuplicateApplications\(target, applicationsRef\.current\)/,
  "duplicate lookup reads the snapshot refreshed by the same async action"
);
assert.match(
  app,
  /onOpenExisting: async \(applicationId, isCurrent\) => \{[\s\S]{0,160}?getApplication\(applicationId\)[\s\S]{0,160}?handleLoadApplication\(application, isCurrent\)/,
  "a match discovered by the fresh snapshot can be opened in the same handler"
);
for (const [name, source] of [["Apply", apply], ["Skip", skip]]) {
  assert.match(source, /refreshApplications: \(\) => Promise<boolean>/, `${name} accepts a fresh tracker preflight`);
  assert.match(
    source,
    /session\.mode === "new"[\s\S]{0,220}?await refreshApplications\(\)/,
    `${name} refreshes immediately before new-session duplicate resolution`
  );
  assert.match(source, /getApplication: \(id: string\) => Application \| undefined/, `${name} can verify live record existence`);
  assert.match(source, /getCurrentPreparationId: \(\) => string/, `${name} reads the synchronous preparation owner`);
  assert.match(
    source,
    /function capturedPreparationIsCurrent\([\s\S]{0,380}?PreparationIdRef\.current === getCurrentPreparationId\(\)[\s\S]{0,180}?PreparationGenerationRef\.current === getPreparationGeneration\(\)[\s\S]{0,180}?CommitIdentityRef\.current === currentPreparationIdentityRef\.current/,
    `${name} checks synchronous owner generation, committed run, and exact content`
  );
  assert.match(
    source,
    /function ownsCurrentPreparation\([\s\S]{0,180}?capturedPreparationIsCurrent\(\)[\s\S]{0,100}?getApplication\(applicationId\)/,
    `${name} owns a live preparation only while its saved record still exists`
  );
}
assert.match(
  apply,
  /function capturedApplyPacketIsCurrent\([\s\S]{0,520}?applyMaterialSelectionRef\.current[\s\S]{0,260}?applyDocumentVersionsRef\.current[\s\S]{0,420}?latestDocumentVersionsRef\.current/,
  "Apply validates its captured material choices and document revisions before persistence"
);
assert.match(
  apply,
  /if \(!capturedApplyPacketIsCurrent\(\)\)[\s\S]{0,360}?Nothing was saved/,
  "a changed Apply packet fails before creating or updating a tracker record"
);
assert.match(
  apply,
  /if \(ownsCurrentPreparation\(app\.id\)\) \{[\s\S]{0,180}?setActiveOutputTab\("applications"\)[\s\S]{0,180}?setExpandedApplicationId\(app\.id\)/,
  "a delayed Apply does not navigate a replacement preparation"
);
assert.match(
  apply,
  /const shouldLinkApplication = ownsCurrentPreparation\(app\.id\);[\s\S]{0,220}?if \(shouldLinkApplication\) linkApplication\(app\.id\)/,
  "Apply decides whether to link before captured identity cleanup"
);
assert.match(
  apply,
  /if \(ownsCurrentPreparation\(app\.id\)\) \{[\s\S]{0,520}?setApplicationPersistenceReceipt\([\s\S]{0,520}?if \(savedDocuments\.resumeSaved\) onResumeSaved\(\);[\s\S]{0,120}?if \(savedDocuments\.coverSaved\) onCoverLetterSaved\(\)/,
  "only the still-owned preparation can be marked clean after artifact persistence"
);
assert.match(
  skip,
  /if \(ownsCurrentPreparation\(commit\.application\.id\)\) linkApplication\(commit\.application\.id\)/,
  "a delayed Skip does not link its record into a replacement preparation"
);

assert.match(
  prepare,
  /const jobEditingDisabled = isPreparing \|\| applicationActionsBusy/,
  "job editing shares one disabled boundary for preparation and persistence"
);
assert.match(prepare, /className="prepare-brief-fields" disabled=\{jobEditingDisabled\}/);
assert.ok(
  (prepare.match(/disabled=\{jobEditingDisabled\}/g) ?? []).length >= 3,
  "URL, pasted source, and prepared brief fields lock during application persistence"
);
assert.match(materialCard, /disabled=\{controlsDisabled\}/, "Include and variant controls lock during an application action");
assert.ok(
  (materialCard.match(/disabled=\{[^\n]*controlsDisabled[^\n]*\}/g) ?? []).length >= 2,
  "both captured material controls share the busy boundary"
);
assert.doesNotMatch(
  prepareStyles,
  /\.prepare-material\.is-excluded[\s\S]{0,180}?opacity:/,
  "excluded materials keep readable text and enabled-control contrast"
);
assert.match(
  app,
  /const trackerReadinessBlocker = !hasLoadedApplications[\s\S]{0,220}?isApplicationsLoading[\s\S]{0,260}?choose Refresh/,
  "terminal tracker-load failure offers a real recovery action instead of an endless wait"
);
assert.match(
  app,
  /const primaryActionDisabledHint = applicationActionsBusy[\s\S]{0,160}?current application action/,
  "Apply surfaces one truthful busy reason while Skip is active"
);
assert.match(
  app,
  /publishPreparationSession\(\s*current\.mode === "update"[\s\S]{0,180}?\? current[\s\S]{0,260}?true/,
  "a newly committed run invalidates old work without detaching an explicit update target"
);
assert.match(
  prepareRail,
  /\(!primaryActionReady \|\| applicationActionsBusy\) && primaryActionBlocker/,
  "the Prepare rail renders the shared busy reason"
);

console.log("Application action integrity passed");
