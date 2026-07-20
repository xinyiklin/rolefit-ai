import assert from "node:assert/strict";

import {
  highestFitApplication,
  monthlyApplicationsSent,
  topTrackedCompanies,
  trackingHygiene
} from "../applicationAnalytics.ts";
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
    fitScore: 82,
    followupAt: undefined
  },
  {
    ...base,
    id: "submitted",
    company: "Acme",
    status: "interviewing",
    appliedAt: "2026-05-03T12:00:00.000Z",
    fitScore: 91,
    followupAt: "2026-05-10T12:00:00.000Z"
  },
  {
    ...base,
    id: "saved",
    company: "Beta",
    status: "interested",
    fitScoreSource: "local",
    fitScore: 99
  }
];

const months = monthlyApplicationsSent(applications);
assert.equal(months.length, 1, "only explicit submission dates create activity buckets");
assert.equal(months[0][1].applications, 1, "generic updates and withdrawn drafts are not employer events");

const hygiene = trackingHygiene(applications);
assert.deepEqual(
  hygiene,
  { highFit: 2, missingFollowup: 1, closed: 1, submitted: 1 },
  "tracking facts are exact counts over stored fields"
);
assert.equal(highestFitApplication(applications)?.id, "submitted", "legacy local estimates are excluded from best fit");
assert.deepEqual(topTrackedCompanies(applications)[0], ["Acme", 2], "company counts aggregate displayed company identity");

console.log("PASS application analytics provenance");
