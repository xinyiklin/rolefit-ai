import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  clampDocumentRailWidth,
  documentRailPreferenceStorageKey,
  documentRailWidthBounds,
  documentRailWidthStorageKey,
  readDocumentRailPreference,
  readDocumentRailWidth,
  writeDocumentRailPreference,
  writeDocumentRailWidth,
  DOCUMENT_RAIL_MAX_REM,
  DOCUMENT_RAIL_MIN_REM
} from "../../../hooks/useDocumentRailPreference.ts";

const sourceUrl = (path) => new URL(path, import.meta.url);
const requiredFiles = [
  "../DocumentWorkbench.tsx",
  "../DocumentWorkflowRail.tsx",
  "../../../hooks/useDocumentRailPreference.ts",
  "../../../styles/document-workbench.css"
];

for (const path of requiredFiles) {
  assert.ok(existsSync(sourceUrl(path)), `Phase 2 owns ${path}`);
}

const workbench = readFileSync(sourceUrl("../DocumentWorkbench.tsx"), "utf8");
const workflowRail = readFileSync(sourceUrl("../DocumentWorkflowRail.tsx"), "utf8");
const preference = readFileSync(
  sourceUrl("../../../hooks/useDocumentRailPreference.ts"),
  "utf8"
);
const styles = readFileSync(sourceUrl("../../../styles/document-workbench.css"), "utf8");
const studioStyles = readFileSync(sourceUrl("../../../styles/studio.css"), "utf8");
const resumeTab = readFileSync(sourceUrl("../../tabs/ResumeTab.tsx"), "utf8");
const coverTab = readFileSync(sourceUrl("../../tabs/CoverLetterTab.tsx"), "utf8");
const documentCheckSummary = readFileSync(sourceUrl("../DocumentCheckSummary.tsx"), "utf8");
const app = readFileSync(sourceUrl("../../../App.tsx"), "utf8");

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value)
};

assert.equal(
  documentRailPreferenceStorageKey("resume-review"),
  "rolefit:document-rail:resume-review",
  "Resume review uses the public preference key"
);
assert.equal(
  documentRailPreferenceStorageKey("cover-tailoring"),
  "rolefit:document-rail:cover-tailoring",
  "Cover tailoring uses the public preference key"
);
assert.equal(
  readDocumentRailPreference(storage, "resume-review", true),
  true,
  "a newly available Resume review defaults expanded"
);
writeDocumentRailPreference(storage, "resume-review", false);
assert.equal(
  readDocumentRailPreference(storage, "resume-review", true),
  false,
  "an explicit collapsed preference wins over the expanded default"
);
writeDocumentRailPreference(storage, "cover-tailoring", true);
assert.equal(
  readDocumentRailPreference(storage, "cover-tailoring", false),
  true,
  "expanded state survives a remount regardless of the fallback"
);

// Width is one shared preference, unlike disclosure: it is a workspace layout
// decision, and a per-document width would move the page on every tab switch.
assert.equal(
  documentRailWidthStorageKey(),
  "rolefit:document-rail:width",
  "the rail width persists once, under the same namespace as the disclosures"
);
const bounds = documentRailWidthBounds(16);
assert.deepEqual(
  bounds,
  { min: DOCUMENT_RAIL_MIN_REM * 16, max: DOCUMENT_RAIL_MAX_REM * 16 },
  "the bounds are rem-derived, so they follow the reader's font size"
);
assert.equal(
  documentRailWidthBounds(20).min,
  DOCUMENT_RAIL_MIN_REM * 20,
  "a larger root font size moves the floor with it"
);
assert.equal(documentRailWidthBounds(0).min, DOCUMENT_RAIL_MIN_REM * 16, "an unreadable root size falls back to 16px");
assert.equal(
  readDocumentRailWidth(storage, bounds),
  bounds.min,
  "an unset width opens at the documented default, which is also the floor"
);
assert.equal(clampDocumentRailWidth(bounds.min - 120, bounds), bounds.min, "the rail never narrows past its floor");
assert.equal(clampDocumentRailWidth(bounds.max + 400, bounds), bounds.max, "nor widens past its ceiling");
assert.equal(clampDocumentRailWidth(Number.NaN, bounds), bounds.min, "a corrupt value opens at the default rather than collapsing the rail");
writeDocumentRailWidth(storage, bounds.min + 64);
assert.equal(
  readDocumentRailWidth(storage, bounds),
  bounds.min + 64,
  "a resized rail survives the reload"
);
values.set(documentRailWidthStorageKey(), "9999");
assert.equal(
  readDocumentRailWidth(storage, bounds),
  bounds.max,
  "a width stored under a different font size is clamped, not rejected"
);
values.delete(documentRailWidthStorageKey());

assert.match(
  preference,
  /rolefit:document-rail:/,
  "document rail preferences use one namespaced storage contract"
);
assert.match(preference, /resume-review/, "Resume review owns a stable preference key");
assert.match(preference, /cover-tailoring/, "Cover tailoring owns a stable preference key");
assert.match(
  preference,
  /useState[\s\S]{0,320}?defaultExpanded/,
  "the first render derives disclosure state from the persisted preference and its expanded default"
);

assert.match(workbench, /aria-expanded=\{isExpanded\}/, "the rail toggle exposes disclosure state");
assert.match(
  workbench,
  /aria-controls=\{contentId\}[\s\S]*?aria-controls=\{contentId\}/,
  "both disclosure controls own the same rail content region"
);
assert.match(
  workbench,
  /inert=\{!isExpanded\}/,
  "the collapsed rail leaves the accessibility tree while staying mounted"
);
assert.doesNotMatch(
  workbench,
  /<aside[\s\S]{0,120}?className="document-workbench__rail"/,
  "the structural rail does not duplicate its feature child's complementary landmark"
);
assert.match(
  workflowRail,
  /<aside\s*\n?\s*className=\{`workflow-rail/,
  "the shared workflow rail owns the complementary landmark"
);
assert.doesNotMatch(
  documentCheckSummary,
  /<aside|<section|<h[1-6]/,
  "the closing check is a phase of the rail, not a nested landmark or section of its own"
);
assert.doesNotMatch(
  documentCheckSummary,
  /primary-button/,
  "the closing check offers no primary action — it is not a tool the user operates"
);
assert.match(
  workbench,
  /id=\{contentId\}[\s\S]{0,200}?\{rail\.content\}/,
  "rail feature content remains mounted while collapsed"
);
assert.match(
  workbench,
  /pendingFocusRef\.current = next \? "rail" : "tab"/,
  "each toggle hands focus to the control that replaces it"
);
assert.match(
  workbench,
  /\(target === "rail" \? hideButtonRef : showButtonRef\)\.current\?\.focus\(\{ preventScroll: true \}\)/,
  "the replacement control is focused after the disclosure re-renders, without scrolling: it sits outside the box until the track settles, and a scrolling focus drags the whole workspace sideways to reveal it"
);
assert.match(
  workbench,
  /aria-label=\{`Hide \$\{rail\.label\} panel`\}/,
  "the expanded rail names its own hide control"
);
assert.equal(
  workbench.includes(
    'const showRailLabel = `Show ${rail.label} panel${attention ? `, ${attention.label}` : ""}`;'
  ),
  true,
  "the icon-only edge tab names the panel and any collapsed attention count for assistive technology"
);
assert.match(workbench, /aria-label=\{showRailLabel\}/, "the collapsed control exposes that full label");
assert.match(
  workbench,
  /action\?: ReactNode/,
  "the workbench rail contract carries one primary action for the shell to place"
);
assert.match(
  workbench,
  /document-workbench__rail-dock">\s*\{rail\.action\}/,
  "the docked action is the host's own control, wrapped in nothing"
);
assert.match(
  workbench,
  /document-workbench__rail-label">\{rail\.label\}<\/span>[\s\S]{0,320}?\{isExpanded \? rail\.action : null\}[\s\S]{0,200}?document-workbench__rail-toggle/,
  "open, the same action sits between the rail's label and its disclosure control — and only open, so the collapsed dock never leaves a second copy in the inert panel"
);
assert.match(
  workbench,
  /\{!isExpanded \? \([\s\S]{0,120}?document-workbench__rail-dock"[\s\S]{0,520}?document-workbench__rail-tab/,
  "collapsing leaves one dock holding both the action and the tab, and only while collapsed"
);
assert.match(
  workbench,
  /\{attention \? \([\s\S]{0,180}?document-workbench__rail-attention[\s\S]{0,100}?attention\.count/,
  "a collapsed rail renders only its bounded attention count, not a duplicate failure panel"
);

assert.match(
  styles,
  /--document-rail-width:\s*[\d.]+rem\s*;/,
  "the rail is sized in rem so it tracks its own rem-based type and the reader's font-size, not the viewport — the space it divides grows linearly, so a proportional rail bites hardest where least is spare"
);
assert.match(
  styles,
  /\.document-workbench__layout\.has-rail[\s\S]{0,200}?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--document-rail-width\)/,
  "the expanded rail owns its own grid track"
);
assert.match(
  styles,
  /\.document-workbench__layout\.is-collapsed[\s\S]{0,200}?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+0/,
  "collapsing returns the whole rail track to the editor"
);
assert.match(
  styles,
  /\.document-workbench__rail-header\s*\{[\s\S]{0,120}?width:\s*calc\(var\(--document-rail-width\) - 1px\)/,
  "rail contents keep the full rail width while the track closes, so they do not reflow on the way out"
);
assert.match(
  styles,
  /\.document-workbench__rail-dock\s*\{[\s\S]{0,320}?position:\s*absolute/,
  "the collapsed rail is reopened from a dock on the document's edge, not a reserved gutter"
);
const dockBlock = styles.match(/\.document-workbench__rail-dock\s*\{[^}]*\}/)?.[0] ?? "";
assert.doesNotMatch(
  dockBlock,
  /background:|box-shadow:|border:/,
  "the dock is bare placement — no card wraps the pair of collapsed controls"
);
assert.match(
  styles,
  /\.document-workbench__rail-toggle,\s*\n\.document-workbench__rail-tab\s*\{[\s\S]{0,420}?width:\s*30px[\s\S]{0,320}?box-shadow:\s*var\(--shadow-rest\)/,
  "the disclosure control is one shape in both states, sized to the compact button beside it, so the pair keeps its proportions when the rail opens or closes"
);
assert.match(
  styles,
  /\.document-workbench__rail-label\s*\{[\s\S]{0,200}?margin-inline-end:\s*auto/,
  "the open header's label takes the slack, pairing the action with the disclosure at its end"
);
assert.doesNotMatch(
  styles,
  /document-workbench__collapsed-action/,
  "no free-floating collapsed action styling survives beside the dock"
);
assert.match(
  styles,
  /\.document-workbench__rail-attention\s*\{[\s\S]{0,300}?background:\s*var\(--danger\)/,
  "the collapsed attention count uses the existing semantic danger token"
);
assert.match(
  styles,
  /prefers-reduced-motion[\s\S]{0,240}?transition:\s*none/,
  "the collapse animation respects reduced-motion"
);
assert.match(
  styles,
  /--document-rail-motion:\s*\d+ms\s+cubic-bezier\([^)]*\)/,
  "the disclosure's timing is one token, so its two halves cannot drift apart"
);
for (const property of ["grid-template-columns", "padding-inline-start"]) {
  assert.match(
    styles,
    new RegExp(`transition:\\s*${property}\\s+var\\(--document-rail-motion\\)`),
    `${property} animates on the shared rail clock — the page holds still only while the pane's start padding gains exactly what the rail's track loses, so a step change in either throws the document sideways mid-transition and snaps back`
  );
}
assert.match(
  studioStyles,
  /\.studio-body\[data-tab="resume"\],\s*\.studio-body\[data-tab="cover"\]\s*\{[\s\S]{0,700}?overflow:\s*clip/,
  "the document tabs' host is unscrollable, not merely clipped: `overflow: hidden` leaves it a scroll container, and a focus that reveals its horizontal popover overflow shifts the toolbar and editor sideways"
);
assert.match(
  styles,
  /has-rail:not\(\.is-collapsed\)\s+\.document-workbench__editor\s*\{[\s\S]{0,320}?padding-inline-start:\s*max\([\s\S]{0,240}?var\(--document-rail-width\)[\s\S]{0,160}?var\(--document-page-width/,
  "the rail's track is paid out of the desk margin first: biasing the pane's start padding by the rail width keeps the page where it sat, rather than re-centring it and spending whitespace the rail already stands in"
);
for (const [name, source] of [["Resume", resumeTab], ["Cover Letter", coverTab]]) {
  assert.match(
    source,
    /pageWidthPx=\{DOC_PAGE_WIDTH_PX \* [\w.]*docStyle\.style\.zoom\}/,
    `${name} reports the rendered page width, so the bias tracks zoom instead of assuming 100%`
  );
  assert.match(source, /action: /, `${name} hands its one Polish action to the shared workbench`);
}
assert.match(styles, /@container\s+document-workbench/, "the shared shell owns narrow host adaptation");
assert.match(
  styles,
  /@container\s+document-workbench\s+\(max-width:\s*1080px\)[\s\S]*?has-rail:not\(\.is-collapsed\)\s+\.document-workbench__editor\s*\{[\s\S]{0,320}?padding-inline-start:\s*var\(--s5\)/,
  "stacked, the rail sits below and claims no horizontal space, so the page keeps its centred padding instead of the docked bias"
);
assert.match(
  styles,
  /@container\s+document-workbench[\s\S]*?\.document-workbench__layout\s*\{[\s\S]{0,180}?overflow-y:\s*auto/,
  "the stacked layout remains scrollable inside the document tabs' clipped host"
);
assert.match(styles, /\.document-workbench__editor[\s\S]{0,220}?overflow:\s*auto/, "the editor scrolls independently on desktop");
assert.match(styles, /\.document-workbench__rail-content[\s\S]{0,220}?overflow-y:\s*auto/, "the expanded rail scrolls independently on desktop");

for (const [name, source] of [
  ["Resume", resumeTab],
  ["Cover Letter", coverTab]
]) {
  assert.match(source, /<DocumentWorkbench/, `${name} uses the shared document workbench shell`);
  assert.match(source, /<DocumentWorkbenchEditorPane/, `${name} uses the shared editor pane`);
}
assert.match(
  resumeTab,
  /content:\s*\([\s\S]{0,160}?<ResumeWorkflowRail/,
  "Resume keeps workflow content available before a result exists"
);
assert.match(
  coverTab,
  /content:\s*<CoverLetterReview/,
  "Cover Letter keeps its readiness rail available before tailoring"
);
assert.match(
  coverTab,
  /const issueCount = failure\?\.kind === "blocked" \? failure\.issues\.length : 0;/,
  "only a typed post-draft blocker adds a collapsed Cover Letter rail count"
);
assert.match(coverTab, /issueCount > 0[\s\S]{0,180}?attention:/);
// The vocabulary moved to the shared contract so a resume's granular edits and
// a letter's whole-document replacement cannot drift into two workflows.
const workflowContract = readFileSync(
  sourceUrl("../../../../shared/documentWorkflowContract.ts"),
  "utf8"
);
assert.match(
  workflowContract,
  /DOCUMENT_WORKFLOW_LABELS[\s\S]*proposal:\s*"Proposal ready"/,
  "both documents share the workflow state vocabulary"
);
assert.match(
  workflowRail,
  /documentWorkflowLabel\(workflow\)/,
  "the rail renders the shared label rather than owning a second one"
);
assert.doesNotMatch(
  workflowRail,
  /PHASE_LABELS/,
  "the rail no longer keeps a private phase vocabulary"
);
// One action, one name. Both workspaces — and the Prepare cards that start the
// same runs — say Polish; Tailor and Audit survive only as the resume pipeline's
// own stage names inside its progress list.
const resumeRail = readFileSync(sourceUrl("../../resume/ResumeWorkflowRail.tsx"), "utf8");
const coverRail = readFileSync(sourceUrl("../../cover-letter/CoverLetterReview.tsx"), "utf8");
const prepareTab = readFileSync(sourceUrl("../../tabs/PrepareTab.tsx"), "utf8");
const coverWorkflow = readFileSync(sourceUrl("../../../hooks/useCoverLetter.ts"), "utf8");

for (const [name, source] of [["Resume", resumeTab], ["Cover Letter", coverTab]]) {
  assert.match(
    source,
    /"Polishing…"[\s\S]{0,120}?"Polish again"[\s\S]{0,24}?"Polish"/,
    `${name}'s rail action spells the run the same way in every state`
  );
}
for (const [name, source] of [["Resume", resumeRail], ["Cover Letter", coverRail]]) {
  assert.doesNotMatch(
    source,
    /"(Tailor|Tailoring…|Polish resume|Retry Polish|Retry Tailor|Use proposal|Keep current)"/,
    `${name} does not name the shared run with a second vocabulary`
  );
}
// Prepare starts the very same runs, so its material cards spell the action the
// same way. Stage words survive only where they report which half is running.
assert.match(
  prepareTab,
  /\{isPolishing \? "Polishing…" : "Polish"\}/,
  "Prepare's resume card starts Polish under the name the editor uses"
);
assert.match(
  prepareTab,
  /\{isTailoringCoverLetter \? "Polishing…" : "Polish"\}/,
  "Prepare's cover-letter card starts Polish under the name the editor uses"
);
// The action moved to the shell's header slot, so a rail footer that still
// rendered its own Polish would show the same control twice while open.
assert.doesNotMatch(
  resumeRail,
  /"Polish again" : "Polish"/,
  "the resume rail's footer does not duplicate the header's Polish action"
);
assert.doesNotMatch(
  coverRail,
  />\s*Polish\s*<\/button>/,
  "and neither does the cover letter's"
);
for (const [name, source] of [["Resume", resumeTab], ["Cover Letter", coverTab]]) {
  assert.match(
    source,
    /className="primary-button is-compact"/,
    `${name}'s rail action is the ordinary primary button, not a bespoke control`
  );
}
assert.match(coverRail, /Accept proposal/, "a proposed replacement is accepted, as in the resume's review rail");
assert.match(coverRail, /Discard proposal/, "and discarded with the same verb the resume uses");
assert.doesNotMatch(
  coverWorkflow,
  /Tailoring panel|Tailoring blocked|Tailor the letter again|Tailoring this letter/,
  "cover-letter status never names a panel or verb the interface does not show"
);
assert.match(
  resumeRail,
  /readiness\("Resume", resumeReady, "Add your resume"\)/,
  "both rails phrase the same readiness gate identically"
);
assert.match(coverRail, /readiness\("Resume", resumeReady, "Add your resume"\)/);
assert.doesNotMatch(
  resumeRail,
  /label: "Workflow", state: "ready"/,
  "the readiness list holds gates only, not an always-ready description of the workflow"
);

assert.match(
  workbench,
  /role="separator"[\s\S]{0,320}?aria-valuenow=\{Math\.round\(railWidth\)\}[\s\S]{0,200}?aria-valuemin[\s\S]{0,120}?aria-valuemax/,
  "the resize affordance is a separator that reports its current and bounded width"
);
assert.match(
  workbench,
  /onKeyDown=\{onResizeKeyDown\}/,
  "and it resizes from the keyboard, not by pointer alone"
);
assert.match(
  workbench,
  /workbenchRef\.current\?\.style\.setProperty\("--document-rail-width"/,
  "a drag writes the width variable straight to the element, so the rail's review content does not re-render on every pointer frame"
);
assert.match(
  workbench,
  /setResizing\(true\)[\s\S]*?setResizing\(false\)/,
  "and the drag brackets itself, so the disclosure's transition cannot make the rail trail the cursor"
);
assert.match(
  styles,
  /\.document-workbench\[data-resizing\][\s\S]{0,400}?transition:\s*none/,
  "the resize state suspends the shared rail clock"
);
assert.match(
  styles,
  /\.document-workbench__rail-resize\s*\{[\s\S]{0,320}?touch-action:\s*none/,
  "a touch drag resizes the rail instead of scrolling the workspace"
);
assert.match(
  styles,
  /@container\s+document-workbench[\s\S]*?\.document-workbench__rail-resize\s*\{[\s\S]{0,80}?display:\s*none/,
  "stacked, the rail owns the full row and there is no track left to resize"
);

assert.match(app, /const pane = resumeFitViewportRef\.current/, "Fit targets the shared editor pane ref");
assert.equal(
  app.match(/fitViewportRef=\{resumeFitViewportRef\}/g)?.length,
  2,
  "Resume wires the same pane ref to its editor and the shared Fit control"
);
assert.match(
  resumeTab,
  /fitViewportRef\.current = node/,
  "Resume publishes the mounted editor pane to the shared Fit observer"
);

console.log("Document workbench contract probes passed");
