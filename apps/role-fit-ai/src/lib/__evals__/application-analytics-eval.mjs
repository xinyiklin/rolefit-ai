import assert from "node:assert/strict";

import {
  isSubmittedApplication,
  monthlyApplicationsSent,
  topTrackedCompanies,
  trackingHygiene
} from "../applicationAnalytics.ts";
import {
  activityCount,
  applicationActivityDate,
  matchesActivityFilter
} from "../applicationDisplay.ts";
import { parseDate } from "../applicationFacts.ts";

const priorTimeZone = process.env.TZ;
process.env.TZ = "America/New_York";
const localDateOnly = parseDate("2026-07-20");
assert.equal(localDateOnly?.getFullYear(), 2026);
assert.equal(localDateOnly?.getMonth(), 6);
assert.equal(localDateOnly?.getDate(), 20, "date-only tracker values stay on their local calendar day");
if (priorTimeZone === undefined) delete process.env.TZ;
else process.env.TZ = priorTimeZone;

const base = {
  title: "Role",
  jobUrl: "",
  createdAt: "2026-04-01T12:00:00.000Z",
  updatedAt: "2026-07-01T12:00:00.000Z"
};

const applications = [
  {
    ...base,
    id: "withdrawn-without-submit",
    company: "Acme",
    status: "withdrawn",
    followupAt: undefined
  },
  {
    ...base,
    id: "submitted",
    company: "Acme",
    status: "interviewing",
    appliedAt: "2026-05-03T12:00:00.000Z",
    followupAt: "2026-05-10T12:00:00.000Z"
  },
  {
    ...base,
    id: "saved",
    company: "Beta",
    status: "interested"
  },
  {
    ...base,
    id: "passed-with-legacy-submit-date",
    company: "Gamma",
    status: "not_applying",
    appliedAt: "2026-06-08T12:00:00.000Z",
    notApplyingAt: "2026-07-02T12:00:00.000Z"
  }
];

const months = monthlyApplicationsSent(applications);
assert.equal(months.length, 1, "only explicit submission dates create activity buckets");
assert.equal(months[0][1].applications, 1, "generic updates and withdrawn drafts are not employer events");

const hygiene = trackingHygiene(applications);
assert.deepEqual(
  hygiene,
  { missingFollowup: 1, closed: 1, submitted: 1 },
  "tracking facts are exact counts over stored fields"
);
assert.deepEqual(topTrackedCompanies(applications)[0], ["Acme", 2], "company counts aggregate displayed company identity");
const passed = applications.find((application) => application.status === "not_applying");
assert.ok(passed);
assert.equal(matchesActivityFilter(passed, "all"), true, "pass decisions remain visible in All");
assert.equal(matchesActivityFilter(passed, "not_applying"), true, "Not applying has a dedicated filter");
assert.equal(matchesActivityFilter(passed, "inactive"), true, "pass decisions are grouped as inactive history");
assert.equal(matchesActivityFilter(passed, "active"), false);
assert.equal(activityCount(applications, "not_applying"), 1);
assert.equal(
  isSubmittedApplication(passed),
  false,
  "Not applying is excluded from the shared submitted-metric denominator even with stale appliedAt"
);
assert.equal(
  applicationActivityDate(passed),
  passed.notApplyingAt,
  "tracker chronology uses the pass decision date rather than a stale appliedAt"
);

console.log("PASS application analytics provenance");
