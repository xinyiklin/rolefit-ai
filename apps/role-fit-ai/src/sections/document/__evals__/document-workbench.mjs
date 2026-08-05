import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  documentRailPreferenceStorageKey,
  readDocumentRailPreference,
  writeDocumentRailPreference
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
const reviewRail = readFileSync(sourceUrl("../../ReviewRail.tsx"), "utf8");
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
  /<aside className=\{`workflow-rail/,
  "the shared workflow rail owns the complementary landmark"
);
assert.doesNotMatch(
  reviewRail,
  /<aside/,
  "Resume-specific review content does not create a nested complementary landmark"
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
  /\{!isExpanded \? \([\s\S]{0,200}?document-workbench__rail-tab/,
  "the edge tab exists only while the rail is collapsed, so one control is exposed per state"
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
  /\.document-workbench__rail-tab\s*\{[\s\S]{0,400}?position:\s*absolute/,
  "the collapsed rail is reopened from an edge tab over the document, not a reserved gutter"
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
assert.match(
  workflowRail,
  /PHASE_LABELS[\s\S]*proposal:\s*"Proposal ready"/,
  "both documents share the workflow state vocabulary"
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
