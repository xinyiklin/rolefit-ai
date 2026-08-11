import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { preparedSourceAppearsDifferent } from "../preparedSourceReplacement.ts";

const paragraph = (topic, detail) => Array.from(
  { length: 75 },
  (_, index) => `${topic}${index} ${detail}${index} delivery ownership collaboration`
).join(" ");

const saved = {
  id: "saved-1",
  title: "Software Engineer at Acme",
  company: "Acme",
  role: "Software Engineer",
  jobUrl: "https://careers.acme.test/jobs/software-engineer",
  rawJobDescription: paragraph("platform", "typescript"),
  status: "applied",
  createdAt: "2026-05-04T12:00:00.000Z",
  updatedAt: "2026-05-04T12:00:00.000Z"
};

assert.equal(
  preparedSourceAppearsDifferent(saved, {
    url: saved.jobUrl,
    sourceText: `${saved.rawJobDescription} corrected-location`,
    tracking: { company: "Acme, Inc.", role: "Software Engineer" }
  }),
  false,
  "small corrections to the same source remain attached to the explicit saved record"
);

assert.equal(
  preparedSourceAppearsDifferent(saved, {
    url: saved.jobUrl,
    sourceText: paragraph("marketing", "campaign"),
    tracking: { company: "Acme", role: "Marketing Director" }
  }),
  true,
  "a reused generic URL cannot hide a materially different posting"
);

assert.equal(
  preparedSourceAppearsDifferent(saved, {
    url: "https://careers.globex.test/jobs/data-scientist",
    sourceText: paragraph("modeling", "python"),
    tracking: { company: "Globex", role: "Data Scientist" }
  }),
  true,
  "a different company and role require an explicit new preparation"
);

const atsSaved = {
  ...saved,
  jobUrl: "https://boards.greenhouse.io/acme/jobs/4012345"
};
assert.equal(
  preparedSourceAppearsDifferent(atsSaved, {
    url: "https://acme.example/careers?gh_jid=4012345",
    sourceText: paragraph("updated", "typescript"),
    tracking: { company: "Acme", role: "Senior Software Engineer" }
  }),
  false,
  "the same explicit ATS posting ID permits corrected preparation content"
);
assert.equal(
  preparedSourceAppearsDifferent(atsSaved, {
    url: "https://boards.greenhouse.io/acme/jobs/9988776",
    sourceText: atsSaved.rawJobDescription,
    tracking: { company: "Acme", role: "Software Engineer" }
  }),
  true,
  "conflicting explicit posting IDs fail closed even when descriptions are copied"
);

const intakeSource = readFileSync(new URL("../../hooks/useJobIntake.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const dialogSource = readFileSync(
  new URL("../../sections/PreparedSourceReplacementDialog.tsx", import.meta.url),
  "utf8"
);

const replacementGuard = intakeSource.indexOf("await confirmPreparedSourceReplacement({");
const duplicateGuard = intakeSource.indexOf("await confirmDuplicateBeforeJobAnalysis(", replacementGuard);
const providerAnalysis = intakeSource.indexOf("await analyzeJobPosting(", replacementGuard);
assert.ok(
  replacementGuard >= 0 && duplicateGuard > replacementGuard && providerAnalysis > duplicateGuard,
  "a materially different saved-record source is blocked before duplicate review or provider analysis"
);
assert.match(
  appSource,
  /if \(!snapshot\) return;[\s\S]{0,520}?current\.mode === "update"\s*\? current/,
  "typing a replacement does not silently clear the explicit update target"
);
assert.match(
  appSource,
  /choice === "start-new"[\s\S]{0,180}?setPreparationSession\(newPreparationSession\(\)\)/,
  "only the explicit Start a new preparation choice clears the saved-record target"
);
for (const text of [
  "This appears to be a different job.",
  "Updating would replace the posting attached to this saved record.",
  "Keep the current posting",
  "Start a new preparation",
  "Cancel"
]) {
  assert.ok(dialogSource.includes(text), `the replacement dialog includes ${text}`);
}
