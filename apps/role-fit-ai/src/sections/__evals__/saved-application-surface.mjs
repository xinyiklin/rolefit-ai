import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("../ApplicationModal.tsx", import.meta.url), "utf8");
const rail = readFileSync(
  new URL("../tabs/prepare/PrepareApplicationRail.tsx", import.meta.url),
  "utf8"
);
const tracker = readFileSync(new URL("../tabs/TrackerTab.tsx", import.meta.url), "utf8");

assert.ok(!modal.includes("value={form.roleDescription}"));
assert.ok(!modal.includes("value={form.jobDescription}"));
assert.ok(modal.includes("Prepared job snapshot"));
assert.ok(modal.includes("Continue preparation"));
assert.ok(modal.includes("Edit preparation"));
assert.ok(modal.includes("Not applying date"));
assert.ok(modal.includes("Decision note"));
assert.ok(modal.includes("Related records"));
assert.ok(
  modal.includes("withoutSubmittedApplicationArtifacts(next)"),
  "an interested record changed to Not applying cannot retain sent-document artifacts"
);

for (const text of [
  "Editing saved application",
  "Updates will be saved to this application. No new application will be created.",
  "Editing saved job",
  "Changes will update this saved decision. No application will be created."
]) {
  assert.ok(rail.includes(text), `the update-mode banner includes ${text}`);
}

assert.ok(!tracker.includes('label: "Open preparation"'));
assert.ok(tracker.includes('label: app.status === "interested" ? "Continue preparation" : "Edit preparation"'));
