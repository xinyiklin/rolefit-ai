import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("../ApplicationModal.tsx", import.meta.url), "utf8");
const jobSnapshot = readFileSync(
  new URL("../application/ApplicationJobSnapshot.tsx", import.meta.url),
  "utf8"
);
const rail = readFileSync(
  new URL("../tabs/prepare/PrepareApplicationRail.tsx", import.meta.url),
  "utf8"
);
const tracker = readFileSync(new URL("../tabs/TrackerTab.tsx", import.meta.url), "utf8");
const inspector = readFileSync(new URL("../tracker/TrackerInspector.tsx", import.meta.url), "utf8");
const table = readFileSync(new URL("../tracker/TrackerTableView.tsx", import.meta.url), "utf8");
const applicationStyles = readFileSync(
  new URL("../../styles/application-pages.css", import.meta.url),
  "utf8"
);

assert.ok(!modal.includes("value={form.roleDescription}"));
assert.ok(!modal.includes("value={form.jobDescription}"));
assert.ok(jobSnapshot.includes("Job snapshot"));
assert.ok(!modal.includes("Continue preparation"));
assert.ok(modal.includes("Edit preparation"));
assert.ok(modal.includes("Decision date"));
assert.ok(modal.includes("Related records"));

// Details uses compact application-control cards followed by read-only job-fact
// cards in the wide pane. Fit and related history form the right rail.
for (const heading of ["Job details", "Compensation", "Status", "Timing", "Skipped decision", "Fit assessment", "Related records history"]) {
  assert.match(modal, new RegExp(`>${heading}<`), `Details exposes ${heading}`);
}
assert.ok(modal.includes(">Role &amp; company<"));
assert.ok(!modal.includes("application-details-pane__head"));
assert.ok(!modal.includes(">Opportunity<"));
assert.ok(!modal.includes(">Application record<"));
assert.match(
  modal,
  /application-modal__main[\s\S]{0,500}?application-workflow-grid[\s\S]{0,1200}?form\.status[\s\S]{0,800}?form\.source[\s\S]{0,2600}?Skipped decision[\s\S]{0,1800}?application-job-facts[\s\S]{0,1000}?form\.company[\s\S]{0,1400}?form\.location[\s\S]{0,1800}?form\.salaryMin[\s\S]{0,1800}?ApplicationJobSnapshot/,
  "the wide pane owns editable application controls followed by compact saved job facts"
);
assert.match(
  modal,
  /aria-label="Fit assessment and related history"[\s\S]{0,500}?Fit assessment[\s\S]{0,2800}?Related records history/,
  "the right rail leads with Fit and keeps related history directly beneath it"
);
assert.match(modal, /tab === "prep"[\s\S]{0,900}?form\.notes/, "general notes live in Prep");
assert.ok(modal.includes('className="application-match-card__title">Fit assessment</h4>'));
assert.ok(!modal.includes("application-decision-status"), "the outcome is not rendered as a form-field imitation");

// The selected reference uses real fact cards without reintroducing nested form
// shells, and the tabs still follow the APG model.
assert.ok(!modal.includes('className="application-comp"'));
assert.ok(!modal.includes('className="application-form__grid"'));
assert.ok(modal.includes('className="application-details-pane application-modal__main"'));
assert.ok(modal.includes('className="application-details-pane application-modal__side"'));
assert.ok(modal.includes('className="application-job-card"'));
assert.ok(modal.includes('className="application-fit-summary"'));
assert.ok(modal.includes('role="tablist"'));
assert.match(modal, /role="tab"[\s\S]{0,400}?aria-selected=\{tab === id\}/);
assert.match(modal, /tabIndex=\{tab === id \? 0 : -1\}/, "roving tabindex");
assert.ok(!modal.includes("aria-pressed={tab === id}"), "tabs are not toggle buttons");
assert.ok(modal.includes('role="tabpanel"'));
assert.equal(
  (modal.match(/aria-controls="application-tabpanel"/g) ?? []).length,
  1,
  "each mapped tab points to the single mounted tab panel"
);
assert.ok(modal.includes('id="application-tabpanel"'));
assert.ok(!modal.includes("application-tabpanel-${id}"));
assert.deepEqual(
  [...modal.matchAll(/\{ id: "(details|prep|documents)", label: "([^"]+)"/g)].map((match) => match[2]),
  ["Details", "Prep", "Documents"],
  "Application Detail exposes three task-oriented tabs"
);
for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
  assert.ok(modal.includes(`"${key}"`), `the tablist handles ${key}`);
}

// The Mono Means Data Rule: dates and money render as data, not prose.
assert.equal(
  (modal.match(/className="text-input is-data"/g) ?? []).length,
  4,
  "both date branches, deadline, and next step retain the data treatment"
);
assert.ok(applicationStyles.includes(".application-compensation-facts > div:not(:last-child) dd"));

// The AI card no longer restates fields that sit beside it in the form.
assert.ok(!modal.includes("application-checks"));
assert.ok(!modal.includes("Stage: {STATUS_LABEL[form.status]}"));
assert.ok(modal.includes("Mark as unrelated"));
assert.ok(modal.includes("Merge accidental duplicate?"));
assert.match(modal, /Merge accidental duplicate\?[\s\S]{0,700}?tone: "danger"/);
assert.ok(
  modal.includes("withoutSubmittedApplicationArtifacts(next)"),
  "a record changed to Skipped cannot retain sent-document artifacts"
);

// The terminal, artifact-dropping downgrade must never ride a bare Save.
assert.match(
  modal,
  /Mark this job as Skipped\?[\s\S]{0,400}?tone: "danger"/,
  "changing stage to Skipped confirms destructively"
);
for (const flushPath of [
  "if (!(await confirmSkipDowngrade(statusOverride))) return;",
  "if (formHasUnsavedChanges && !(await confirmSkipDowngrade(form.status))) return;",
  "if (!(await confirmSkipDowngrade(form.status))) return;"
]) {
  assert.ok(modal.includes(flushPath), `every form flush gates on the skip confirm: ${flushPath}`);
}

// The wide pane owns edits and saved job facts; the right rail is deliberately
// reserved for Fit and related history in the selected reference composition.
assert.ok(modal.includes('<aside className="application-details-pane application-modal__side" aria-label="Fit assessment and related history">'));
assert.ok(
  modal.indexOf('aria-label="Fit assessment and related history"') < modal.indexOf("application-match-card__title"),
  "Fit stays at the top of the right rail"
);
assert.ok(
  modal.indexOf("application-match-card__title") < modal.indexOf("application-related-records-title"),
  "related history follows Fit"
);
assert.match(applicationStyles, /grid-template-columns:\s*minmax\(0, 1fr\) 360px/);
assert.match(applicationStyles, /\.application-details-pane\s*\{[\s\S]{0,180}?display:\s*grid/);
assert.match(applicationStyles, /\.application-details-section > h4,[\s\S]{0,180}?margin:\s*0/);
assert.match(applicationStyles, /\.application-workflow-grid\s*\{[\s\S]{0,160}?grid-template-columns:\s*minmax\(240px/);
assert.match(applicationStyles, /\.application-job-facts\s*\{[\s\S]{0,160}?grid-template-columns:\s*repeat\(2/);
assert.match(applicationStyles, /\.application-job-card\s*\{[\s\S]{0,220}?border:\s*1px solid var\(--hairline\)/);
assert.match(applicationStyles, /\.application-fit-summary\s*\{[\s\S]{0,300}?grid-template-columns:\s*88px/);
assert.match(applicationStyles, /\.application-related-records li:not\(:last-child\)::after/);
assert.ok(!modal.includes("application-prepared-snapshot"));
assert.ok(!modal.includes("application-posting-reference"));
assert.ok(!modal.includes("form.priority"));
assert.match(
  modal,
  /application-job-facts[\s\S]{0,5000}?<ApplicationJobSnapshot application=\{application\} \/>/,
  "the structured job snapshot finishes the same compact job-fact grid"
);
assert.ok(jobSnapshot.includes("buildPreparedJobBrief"));
assert.ok(jobSnapshot.includes("removePreparedJobRoleSummary"));
assert.ok(
  jobSnapshot.includes("buildPreparedJobBrief(preparedText, preparedText)"),
  "the digest reads every edited prepared section, including Benefits"
);
assert.ok(jobSnapshot.includes("memo(function ApplicationJobSnapshot"));
for (const part of [
  "Overview",
  "Responsibilities",
  "Required qualifications",
  "Preferred qualifications",
  "Benefits & policies",
  "Tools & keywords",
  "Seniority signals",
  "Domain signals"
]) {
  assert.ok(jobSnapshot.includes(part), `the job snapshot can render ${part}`);
}
assert.ok(jobSnapshot.includes("const VISIBLE_LIST_ITEMS = 4"));
assert.ok(jobSnapshot.includes("remainingItems.length"), "long sections collapse their remainder");
assert.ok(jobSnapshot.includes('items={snapshot.brief.benefits} collapsed'), "Benefits stays bounded when saved prose is unusually long");
assert.ok(jobSnapshot.includes("aria-label={`Job snapshot,"));
assert.ok(jobSnapshot.includes("sectionCount"), "the summary reports scannable sections, not a noisy item total");
assert.ok(jobSnapshot.includes("application-job-snapshot--source-only"));
assert.ok(jobSnapshot.includes("application-job-card application-job-card--wide"));
assert.match(applicationStyles, /\.application-job-snapshot__grid\s*\{[\s\S]{0,180}?grid-template-columns:\s*repeat\(2/);

// Desktop Details columns scroll independently; the stacked breakpoint returns
// them to one natural scroll surface.
assert.ok(modal.includes('application-modal__body--${tab === "details" ? "details" : "single"}'));
assert.match(applicationStyles, /\.application-modal__main\s*\{[\s\S]{0,300}?overflow-y:\s*auto/);
assert.match(applicationStyles, /\.application-modal__side\s*\{[\s\S]{0,500}?overflow-y:\s*auto/);
assert.match(
  applicationStyles,
  /@media \(max-width: 1080px\)[\s\S]{0,900}?\.application-modal__main,[\s\S]{0,160}?overflow:\s*visible/,
  "stacked Details uses the modal body as its single scroll surface"
);

// The immutable source is secondary to the digest, opt-in, and keyboard-scrollable.
assert.ok(jobSnapshot.includes("Full source posting"));
assert.ok(jobSnapshot.includes("application.rawJobDescription?.trim() || preparedText"));
assert.match(jobSnapshot, /<pre tabIndex=\{0\}/);

for (const text of [
  "Editing saved application",
  "No new application is created",
  "Editing saved job",
  "No application is created"
]) {
  assert.ok(rail.includes(text), `the update-mode banner includes ${text}`);
}
// A permanent banner is not an announcement.
assert.ok(!rail.includes('className="prepare-update-banner" role="status"'));

assert.ok(!tracker.includes('label: "Open preparation"'));
assert.ok(tracker.includes('label: "Edit preparation"'));
assert.ok(tracker.includes("postingGroupSizeByApplicationId"));
assert.ok(table.includes("independent records are linked to this posting"));
// The badge lives inside a row that carries its own aria-label, so it only
// reaches assistive tech through the composed row label.
assert.ok(table.includes("records linked to this posting`"));
assert.ok(inspector.includes('className="sr-only"'));
assert.ok(inspector.includes("Each decision or application keeps its own status, dates, notes, and documents."));
assert.ok(!inspector.includes('title="Each decision or application keeps'));
