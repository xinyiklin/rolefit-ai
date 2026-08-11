import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../../App.tsx");
const modal = read("../ApplicationModal.tsx");
const fitSummary = read("../application/ApplicationFitSummary.tsx");
const jobSnapshot = read("../application/ApplicationJobSnapshot.tsx");
const skippedDecisionPopover = read("../application/SkippedDecisionPopover.tsx");
const postingOverlay = read("../application/ApplicationPostingOverlay.tsx");
const documentsTab = read("../application/ApplicationDocumentsTab.tsx");
const previewOverlay = read("../PreviewOverlay.tsx");
const previewZoomControls = read("../PreviewZoomControls.tsx");
const rail = read("../tabs/prepare/PrepareApplicationRail.tsx");
const tracker = read("../tabs/TrackerTab.tsx");
const inspector = read("../tracker/TrackerInspector.tsx");
const table = read("../tracker/TrackerTableView.tsx");
const duplicateReview = read("../tracker/DuplicateReviewModal.tsx");
const applicationStyles = read("../../styles/application-pages.css");
const previewStyles = read("../../styles/preview-overlay.css");

assert.ok(!modal.includes("value={form.roleDescription}"));
assert.ok(!modal.includes("value={form.jobDescription}"));
assert.ok(!modal.includes('value={form.source}'), "posting provenance is read-only");
assert.match(modal, />Source<\/dt><dd>\{displayValue\(form\.source\)\}<\/dd>/);
assert.ok(modal.includes("Edit preparation"));
assert.ok(modal.includes("Decision date"));
assert.ok(modal.includes("Job activity"));
assert.ok(jobSnapshot.includes("Job snapshot"));
assert.ok(!modal.includes("Continue preparation"));
assert.ok(rail.includes("fitAssessmentVerdictLabel(assessmentSnapshot.result.verdict)"));
assert.ok(!rail.includes("Strong fit"), "Prepare uses the one-word verdict vocabulary");
assert.ok(!rail.includes("assessmentSnapshot.resumeLabel"), "Prepare does not repeat the assessed resume beside Fit");
assert.ok(!rail.includes("fitAssessment.activeRun.resumeLabel"), "Fit progress stays concise");

for (const heading of [
  "Job details",
  "Compensation",
  "Application status",
  "Key dates",
  "Fit assessment",
  "Job activity"
]) {
  assert.match(modal, new RegExp(`>${heading}<`), `Overview exposes ${heading}`);
}
assert.doesNotMatch(modal, /<h4/, "application sections follow the dialog h2 at level 3");
assert.ok(jobSnapshot.includes('<h3 id="application-job-snapshot-title"'));
assert.ok(!jobSnapshot.includes("<h5"), "snapshot subsections sit one level below its h3");
assert.ok(!documentsTab.includes("<h4"), "document cards follow the dialog h2 at level 3");
assert.ok(modal.includes(">Role &amp; company<"));
assert.match(modal, /tab === "prep"[\s\S]{0,900}?form\.notes/, "general notes live in Prep");
assert.ok(!modal.includes("form.priority"));

for (const surface of [modal, inspector]) {
  assert.ok(surface.includes("<ApplicationFitSummary"), "saved views share the Fit advisory");
  assert.ok(surface.includes('<ul className="application-gap-list">'));
  assert.ok(surface.includes("<li key={gap}>{gap}</li>"));
  assert.ok(surface.includes('<ul className="application-related-records">'));
  assert.ok(surface.includes('className="application-related-records__marker"'));
}
assert.ok(fitSummary.includes(">Verdict<"));
assert.ok(!modal.includes("application-fit--ring"));
assert.ok(!modal.includes("application-fit-summary__resume"));
assert.ok(!modal.includes("Selected resume"));
assert.doesNotMatch(applicationStyles, /\.application-fit-summary__resume/);
assert.ok(applicationStyles.includes("@container fit-card"), "Fit adapts to its host width");

assert.ok(modal.includes('aria-haspopup="dialog"'));
assert.ok(modal.includes("<SkippedDecisionPopover"));
assert.ok(!modal.includes("application-details-decision"));
assert.ok(skippedDecisionPopover.includes('role="dialog"'));
assert.ok(skippedDecisionPopover.includes('aria-label="Skipped decision"'));
assert.ok(skippedDecisionPopover.includes('event.key !== "Escape"'));
assert.ok(skippedDecisionPopover.includes("onClose(true)"));
assert.ok(modal.includes("primaryInputRef.current?.focus()"));
assert.ok(skippedDecisionPopover.includes("maxLength={2_000}"));

assert.ok(modal.includes('role="tablist"'));
assert.match(modal, /role="tab"[\s\S]{0,400}?aria-selected=\{tab === id\}/);
assert.match(modal, /tabIndex=\{tab === id \? 0 : -1\}/, "tabs use roving tabindex");
assert.ok(!modal.includes("aria-pressed={tab === id}"));
assert.ok(modal.includes('role="tabpanel"'));
assert.equal((modal.match(/aria-controls="application-tabpanel"/g) ?? []).length, 1);
assert.ok(modal.includes('id="application-tabpanel"'));
for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
  assert.ok(modal.includes(`"${key}"`), `the tablist handles ${key}`);
}
assert.match(
  modal,
  /function selectTab[\s\S]{0,300}?closeSkipDecision\(false\)[\s\S]{0,300}?setRelatedMenu\(null\)[\s\S]{0,300}?setTab\(nextTab\)/,
  "changing tabs closes surfaces anchored in the previous tab"
);
assert.ok(modal.includes("onClick={() => selectTab(id)}"));

assert.ok(modal.includes("Mark as unrelated"));
assert.match(modal, /Merge accidental duplicate\?[\s\S]{0,700}?tone: "danger"/);
assert.ok(modal.includes("withoutSubmittedApplicationArtifacts(next)"));
assert.ok(!modal.includes("confirmSkipDowngrade"));

assert.ok(!modal.includes("if (!open || !application) return null"));
assert.ok(modal.includes("application ?? lastAvailableApplicationRef.current"));
for (const artifact of ["resumeArtifacts", "coverLetterArtifacts", "attachments"]) {
  assert.ok(modal.includes(`delete persisted.${artifact}`), `recovery drops stale ${artifact}`);
}

assert.ok(modal.includes("No other saved decisions or applications for this job."));
assert.match(
  modal,
  /aria-labelledby="application-job-activity-title"[\s\S]{0,500}?relatedApplications\.length \?/,
  "Job activity keeps its populated and empty states"
);
assert.ok(jobSnapshot.includes("buildPreparedJobBrief(preparedText, preparedText)"));
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
assert.ok(jobSnapshot.includes('items={snapshot.brief.benefits} collapsed'));
assert.ok(jobSnapshot.includes("collapsed && items.length > VISIBLE_LIST_ITEMS"));
assert.ok(jobSnapshot.includes('aria-labelledby="application-job-snapshot-title"'));
assert.ok(!jobSnapshot.includes("sectionCount"));
assert.ok(!jobSnapshot.includes('<details className="application-job-snapshot application-job-card'));
assert.ok(jobSnapshot.includes("View posting"));

assert.ok(modal.includes("<ApplicationPostingOverlay"));
assert.ok(
  modal.includes("inert={postingOverlayOpen || stackedViewerOpen}"),
  "stacked posting and document previews disable the underlying detail dialog"
);
assert.ok(app.includes("stackedViewerOpen={Boolean(documentPreview)}"));
assert.ok(postingOverlay.includes('className="preview-overlay application-posting-overlay"'));
assert.ok(postingOverlay.includes('role="dialog"'));
assert.ok(postingOverlay.includes('aria-modal="true"'));
assert.ok(postingOverlay.includes("useModalFocus"));
assert.ok(postingOverlay.includes("<PreviewZoomControls"));
assert.match(postingOverlay, /<pre[^>]*tabIndex=\{0\}/);

assert.ok(documentsTab.includes('aria-label="Job posting"'));
assert.ok(documentsTab.includes("<JobPostingPane"));
assert.ok(documentsTab.includes('application?.status === "not_applying"'));
assert.ok(documentsTab.includes("Skipped jobs keep job details only"));
assert.match(documentsTab, /disabled=\{!application \|\| jobOnly \|\| busy\}/);
assert.ok(previewOverlay.includes("<PreviewZoomControls"));
assert.ok(previewOverlay.includes("usePreviewZoom"));
assert.ok(previewOverlay.includes("Saved document PDF preview:"));
assert.ok(app.includes("const applicationPreviewRequestRef = useRef(0)"));
assert.match(
  app,
  /const requestId = \+\+applicationPreviewRequestRef\.current;[\s\S]{0,600}?await applicationDocumentPdfBlob[\s\S]{0,300}?if \(requestId !== applicationPreviewRequestRef\.current\) return;[\s\S]{0,300}?URL\.createObjectURL\(blob\)/,
  "only the latest saved-document preview request may open the viewer"
);
assert.match(
  app,
  /function closeApplicationPreview\(\)[\s\S]{0,200}?applicationPreviewRequestRef\.current \+= 1;[\s\S]{0,200}?setDocumentPreview\(null\)/,
  "closing a preview invalidates any slower request still in flight"
);
assert.ok(app.includes("onClose={closeApplicationPreview}"));
assert.ok(previewZoomControls.includes("PREVIEW_ZOOM_STEPS"));
assert.ok(previewZoomControls.includes('aria-live="polite"'));
for (const key of ['event.key === "="', 'event.key === "+"', 'event.key === "-"', 'event.key === "0"']) {
  assert.ok(previewZoomControls.includes(key), `shared preview zoom handles ${key}`);
}
assert.ok(!previewZoomControls.includes("event.shiftKey"));
for (const source of [modal, documentsTab, postingOverlay]) {
  assert.ok(source.includes("safeExternalUrl"), "posting links use the safe URL boundary");
}
assert.ok(previewStyles.includes("@media (pointer: coarse)"));
assert.ok(previewStyles.includes("min-width: 44px"));
assert.ok(previewStyles.includes("min-height: 44px"));

for (const text of [
  "Editing saved application",
  "No new application is created",
  "Editing saved job",
  "No application is created"
]) {
  assert.ok(rail.includes(text), `the update banner includes ${text}`);
}
assert.ok(!rail.includes('className="prepare-update-banner" role="status"'));

assert.ok(!tracker.includes('label: "Open preparation"'));
assert.ok(tracker.includes('label: "Edit preparation"'));
assert.ok(tracker.includes("postingGroupSizeByApplicationId"));
assert.ok(table.includes("independent records are linked to this posting"));
assert.ok(table.includes("records linked to this posting`"));
assert.ok(inspector.includes('className="sr-only"'));
assert.ok(inspector.includes("Each decision or application keeps its own status, dates, notes, and documents."));
assert.ok(!inspector.includes('title="Each decision or application keeps'));
for (const label of ["Job activity", "Application date", "Decision date", "Deadline", "Next step", "Documents"]) {
  assert.ok(inspector.includes(label), `the inspector exposes ${label}`);
}
assert.ok(inspector.includes("safeExternalUrls"));
assert.ok(inspector.includes("applicationActivityDate(app)"));
assert.ok(duplicateReview.includes("applicationActivityDate(app)"));
assert.ok(!duplicateReview.includes("<h4"), "duplicate cards follow the review dialog h2 at level 3");
assert.match(
  inspector,
  /const hasResume = Boolean\(selected\.resumeArtifacts\?\.hasPdf \|\| selected\.resumeArtifacts\?\.hasSource\)/
);
assert.ok(!inspector.includes('<label className="field">'));
assert.ok(!inspector.includes("APPLICATION_SOURCES"));
