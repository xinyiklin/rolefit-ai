import assert from "node:assert/strict";

import {
  ANALYTICS_PERIODS,
  MIN_RATE_SAMPLE,
  applicationReach,
  cohortStageCounts,
  dayNumber,
  isSubmittedApplication,
  median,
  outcomeBreakdown,
  outcomeOf,
  periodChange,
  periodMetrics,
  previousApplications,
  registerRows,
  SILENCE_EDGES,
  sentApplications,
  silenceBins,
  trackingHygiene,
  upcomingItems
} from "../applicationAnalytics.ts";
import {
  activityCount,
  applicationActivityDate,
  matchesActivityFilter
} from "../applicationDisplay.ts";
import { parseDate } from "../applicationFacts.ts";
import { noResponseCandidates } from "../noResponse.ts";
import { toIso } from "../dateInput.ts";

// Runs `check` with the process in `zone`. Build every Date and fixture inside
// it: a Date made before the switch keeps the old zone's local day.
function inZone(zone, check) {
  const prior = process.env.TZ;
  process.env.TZ = zone;
  try {
    return check();
  } finally {
    if (prior === undefined) delete process.env.TZ;
    else process.env.TZ = prior;
  }
}

const ymd = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const total = (rows, field) => rows.reduce((sum, row) => sum + row[field], 0);
const entryIds = (row) => row.entries.map((entry) => entry.application.id);

inZone("America/New_York", () => {
  const localDateOnly = parseDate("2026-07-20");
  assert.equal(localDateOnly?.getFullYear(), 2026);
  assert.equal(localDateOnly?.getMonth(), 6);
  assert.equal(localDateOnly?.getDate(), 20, "date-only tracker values stay on their local calendar day");
});

const base = {
  title: "Role",
  jobUrl: "",
  createdAt: "2026-04-01T12:00:00.000Z",
  updatedAt: "2026-07-01T12:00:00.000Z"
};
// Tuesday. Every check injects its day; nothing reads the real clock.
const today = new Date(2026, 9, 20, 12);

// --- Provenance: only an explicit appliedAt is a submission ------------------
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
    id: "applied-without-submit-date",
    company: "Beta",
    status: "applied"
  },
  {
    ...base,
    id: "skipped-with-legacy-submit-date",
    company: "Gamma",
    status: "not_applying",
    appliedAt: "2026-06-08T12:00:00.000Z",
    notApplyingAt: "2026-07-02T12:00:00.000Z"
  },
  {
    ...base,
    id: "job-only-skip",
    company: "Delta",
    status: "not_applying",
    notApplyingAt: "2026-07-03T12:00:00.000Z"
  }
];

const provenanceMonths = registerRows(applications, "all", 21, today);
assert.ok(provenanceMonths.every((row) => row.unit === "month"), "All time keeps the register by month");
assert.equal(
  provenanceMonths.filter((row) => row.sent > 0).length,
  2,
  "every explicit submission date fills a register row"
);
const june = provenanceMonths.find((row) => row.key === "m2026-5");
assert.deepEqual(june && entryIds(june), ["skipped-with-legacy-submit-date"], "a later skipped application keeps its original submission event");
assert.equal(june.entries[0].outcome, "skipped", "and stands as Skipped today");
assert.equal(
  total(provenanceMonths, "sent"),
  2,
  "a job-only Skipped decision and an application without a date add no submission"
);

const hygiene = trackingHygiene(applications);
assert.deepEqual(
  hygiene,
  { missingFollowup: 1, closed: 1, submitted: 2 },
  "tracking facts are exact counts over stored fields; no Skipped record needs a follow-up"
);
assert.deepEqual(
  trackingHygiene([{ ...base, id: "g", status: "ghosted", appliedAt: "2026-06-01T12:00:00.000Z" }]),
  { missingFollowup: 0, closed: 1, submitted: 1 },
  "a Ghosted record is closed and needs no follow-up date"
);
const skipped = applications.find((application) => application.id === "skipped-with-legacy-submit-date");
assert.ok(skipped);
assert.equal(matchesActivityFilter(skipped, "all"), true, "skip decisions remain visible in All");
assert.equal(matchesActivityFilter(skipped, "not_applying"), true, "Skipped has a dedicated filter");
assert.equal(matchesActivityFilter(skipped, "inactive"), true, "skip decisions are grouped as inactive history");
assert.equal(matchesActivityFilter(skipped, "active"), false);
assert.equal(activityCount(applications, "not_applying"), 2);
assert.equal(
  isSubmittedApplication(skipped),
  true,
  "a later skipped application remains in the submitted-metric denominator"
);
assert.equal(
  isSubmittedApplication(applications.find((application) => application.id === "job-only-skip")),
  false,
  "a job-only Skipped decision is never a submission"
);
assert.equal(
  isSubmittedApplication({ ...base, id: "draft", status: "draft", appliedAt: "2026-06-01T12:00:00.000Z" }),
  false,
  "a Draft is never a submission, even with a date"
);
assert.equal(
  applicationActivityDate(skipped),
  skipped.notApplyingAt,
  "tracker chronology uses the skip decision date rather than a stale appliedAt"
);

// --- Metrics over a dated fixture --------------------------------------------
// Built on demand so each time zone below gets its own local-noon dates.
const at = (day) => toIso(day);
const stage = (id, status, day) => ({ id, type: "stage", status, at: at(day) });
const response = (id, day) => ({ id, type: "response", at: at(day) });
const interview = (id, day, kind = "technical") => ({ id, type: "interview", kind, at: at(day) });
const followup = (id, day) => ({ id, type: "followup", at: at(day) });
const fit = (verdict) => ({ result: { verdict } });
const record = (id, company, status, appliedDay, extra = {}) => ({
  ...base,
  id,
  company,
  status,
  appliedAt: appliedDay ? at(appliedDay) : undefined,
  ...extra
});

const buildFixture = () => [
  record("a1", "Acme", "applied", "2026-10-15", { source: "LinkedIn", followupAt: at("2026-10-22"), fitAssessment: fit("STRETCH") }),
  record("a2", "Beta", "interviewing", "2026-10-01", {
    source: "Referral",
    followupAt: at("2026-10-30"),
    fitAssessment: fit("STRONG"),
    stageHistory: [
      stage("s1", "interviewing", "2026-10-05"),
      response("r1", "2026-10-05"),
      interview("i1", "2026-10-10"),
      interview("i2", "2026-10-20", "final")
    ]
  }),
  // A Sunday: the last day of the week of Sep 14.
  record("a3", "Gamma", "rejected", "2026-09-20", {
    source: "LinkedIn",
    fitAssessment: fit("REASONABLE"),
    stageHistory: [stage("s1", "rejected", "2026-09-25")]
  }),
  record("a4", "Delta", "rejected", "2026-09-10", {
    source: "LinkedIn",
    fitAssessment: fit("REASONABLE"),
    stageHistory: [response("r1", "2026-09-16"), stage("s1", "rejected", "2026-09-20")]
  }),
  record("a5", "Epsilon", "ghosted", "2026-08-01", { stageHistory: [stage("s1", "ghosted", "2026-08-25")] }),
  record("a6", "Zeta", "applied", "2026-08-05", { source: "LinkedIn", fitAssessment: fit("REASONABLE") }),
  record("a7", "Eta", "offer", "2026-07-01", {
    stageHistory: [stage("s1", "interviewing", "2026-07-10"), stage("s2", "offer", "2026-07-30")]
  }),
  record("a8", "Theta", "not_applying", undefined, { notApplyingAt: at("2026-10-02") }),
  record("a9", "Iota", "not_applying", "2026-10-12", { notApplyingAt: at("2026-10-14") }),
  record("a10", "Kappa", "draft", "2026-10-10"),
  record("a11", "Lambda", "applied", "2026-11-05"),
  record("a12", "Acme", "interviewing", "2026-10-10", {
    source: "Company site",
    followupAt: at("2026-10-18"),
    fitAssessment: fit("LIMITED"),
    stageHistory: [stage("s1", "interviewing", "2026-10-11"), interview("i1", "2026-10-23", "recruiter_screen")]
  }),
  record("a13", "Mu", "rejected", "2026-05-01", { followupAt: at("2026-10-21") }),
  record("a15", "Nu", "withdrawn", "2026-09-01")
];
const fixture = buildFixture();
const ids = (list) => list.map((application) => application.id).sort();

assert.deepEqual(
  ANALYTICS_PERIODS.map((option) => [option.id, option.weeks]),
  [["8w", 8], ["12w", 12], ["26w", 26], ["all", null]],
  "windowed periods are whole calendar weeks; All time has none"
);
assert.deepEqual(
  ids(sentApplications(fixture, "8w", today)),
  ["a1", "a12", "a15", "a2", "a3", "a4", "a9"],
  "8 weeks is this week plus the seven whole weeks before it, from Monday Aug 31"
);
assert.deepEqual(
  ids(sentApplications(fixture, "12w", today)),
  ["a1", "a12", "a15", "a2", "a3", "a4", "a6", "a9"],
  "12 weeks starts Monday Aug 3: Wednesday Aug 5 is in, Saturday Aug 1 is out"
);
assert.deepEqual(
  ids(sentApplications(fixture, "26w", today)),
  ["a1", "a12", "a13", "a15", "a2", "a3", "a4", "a5", "a6", "a7", "a9"],
  "26 weeks reaches back to Monday Apr 27"
);
assert.equal(sentApplications(fixture, "all", today).length, 11, "All time counts every submission on or before today");
assert.ok(
  !ids(sentApplications(fixture, "all", today)).some((id) => ["a8", "a10", "a11"].includes(id)),
  "a job-only Skip, a Draft with a date, and a future date are never submissions"
);

// Response and reach: a bare Rejected stage move is not a reply.
const reach = (id) => applicationReach(fixture.find((application) => application.id === id), today);
assert.equal(reach("a3").responded, false, "Rejected with only a stage entry is not a response");
assert.equal(reach("a4").responded, true, "Rejected with a response entry is a response");
assert.equal(reach("a5").responded, false, "Ghosted without a reply never counts as responded");
assert.deepEqual(
  { responded: reach("a7").responded, interviewed: reach("a7").interviewed, offer: reach("a7").offer },
  { responded: true, interviewed: true, offer: true },
  "an Offer implies Interviewing and Responded"
);
assert.equal(reach("a12").responded, true, "a scheduled interview means the employer responded");
assert.equal(reach("a12").responseDays, null, "a scheduled interview has no reply date yet");
assert.equal(reach("a2").responseDays, 4, "first dated response or interview, in days after submission");
assert.equal(reach("a7").responseDays, null, "stage moves alone give no reply date");

const eight = periodMetrics(fixture, "8w", today);
assert.deepEqual(
  { sent: eight.sent, responded: eight.responded, interviewed: eight.interviewed, offers: eight.offers },
  { sent: 7, responded: 3, interviewed: 2, offers: 0 }
);
assert.equal(eight.responseRate, 3 / 7);
assert.equal(eight.medianResponseDays, 5, "an even count of timed replies averages the middle two (4 and 6 days)");
const thin = periodMetrics(fixture.filter((application) => ["a1", "a2"].includes(application.id)), "all", today);
assert.equal(thin.sent, 2);
assert.equal(thin.responseRate, null, "the totals line keeps the three-sent floor, like every week row");
const twelve = periodMetrics(fixture, "12w", today);
assert.deepEqual(
  { sent: twelve.sent, responded: twelve.responded, interviewed: twelve.interviewed, offers: twelve.offers },
  { sent: 8, responded: 3, interviewed: 2, offers: 0 },
  "period scoping drops applications sent before the window"
);
const all = periodMetrics(fixture, "all", today);
assert.deepEqual(
  { sent: all.sent, responded: all.responded, interviewed: all.interviewed, offers: all.offers },
  { sent: 11, responded: 4, interviewed: 3, offers: 1 }
);
assert.equal(all.responseRate, 4 / 11);
const none = periodMetrics([], "all", today);
assert.deepEqual(
  { sent: none.sent, rate: none.responseRate, median: none.medianResponseDays },
  { sent: 0, rate: null, median: null },
  "no submissions gives no rates rather than zero"
);
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([1, 2, 3, 4]), 2.5);
assert.equal(median([]), null);

// --- Outcomes: one per application, No response before Awaiting/Interviewing -
const quiet = (id, status, appliedDay, extra) => record(id, "Quiet", status, appliedDay, extra);
const outcomeCases = [
  [quiet("applied-at-threshold", "applied", "2026-09-29"), 21, "noResponse", "21 quiet days reaches a 21-day threshold"],
  [quiet("applied-short-of-threshold", "applied", "2026-09-30"), 21, "awaiting", "20 quiet days is still Awaiting"],
  [quiet("applied-long-threshold", "applied", "2026-09-29"), 22, "awaiting", "the threshold decides, not the age alone"],
  [
    quiet("applied-followed-up", "applied", "2026-08-01", { stageHistory: [followup("f1", "2026-10-10")] }),
    21,
    "awaiting",
    "a follow-up the user sent is activity"
  ],
  [
    quiet("applied-followup-planned", "applied", "2026-08-01", { followupAt: at("2026-10-20") }),
    21,
    "awaiting",
    "a follow-up planned for today keeps the record fresh"
  ],
  [
    quiet("applied-followup-overdue", "applied", "2026-08-01", { followupAt: at("2026-10-19") }),
    21,
    "noResponse",
    "an overdue follow-up plan does not"
  ],
  [
    quiet("interviewing-quiet", "interviewing", "2026-08-01", {
      stageHistory: [stage("s1", "interviewing", "2026-08-10"), interview("i1", "2026-09-01")]
    }),
    21,
    "noResponse",
    "an Interviewing record quiet past the threshold is No response"
  ],
  [
    quiet("interviewing-recent", "interviewing", "2026-08-01", {
      stageHistory: [stage("s1", "interviewing", "2026-08-10"), interview("i1", "2026-09-01")]
    }),
    60,
    "interviewing",
    "and Interviewing again under a longer threshold"
  ],
  [
    quiet("interviewing-scheduled", "interviewing", "2026-08-01", { stageHistory: [interview("i1", "2026-10-30")] }),
    21,
    "interviewing",
    "a scheduled interview keeps the record fresh"
  ],
  [quiet("offer-quiet", "offer", "2026-07-01", { stageHistory: [stage("s1", "offer", "2026-07-30")] }), 21, "offer", "an Offer is never No response"],
  [quiet("rejected-quiet", "rejected", "2026-07-01"), 21, "rejected", "closed stages stand as stored"],
  [quiet("ghosted-quiet", "ghosted", "2026-07-01"), 21, "ghosted", "closed stages stand as stored"],
  [quiet("withdrawn-quiet", "withdrawn", "2026-07-01"), 21, "withdrawn", "closed stages stand as stored"],
  [quiet("skipped-later", "not_applying", "2026-07-01", { notApplyingAt: at("2026-07-05") }), 21, "skipped", "a later skip stands as Skipped"]
];
for (const [application, days, expected, message] of outcomeCases) {
  assert.equal(outcomeOf(application, days, today), expected, `${application.id}: ${message}`);
}
const outcomeApps = outcomeCases.filter(([, days]) => days === 21).map(([application]) => application);
const outcomeCounts = Object.fromEntries(outcomeBreakdown(outcomeApps, 21, today).map((outcome) => [outcome.id, outcome.count]));
assert.deepEqual(
  outcomeCounts,
  { awaiting: 3, noResponse: 3, interviewing: 1, offer: 1, rejected: 1, ghosted: 1, withdrawn: 1, skipped: 1 },
  "each application counts under exactly one outcome; a quiet Interviewing record leaves Interviewing"
);
assert.equal(
  Object.values(outcomeCounts).reduce((sum, count) => sum + count, 0),
  outcomeApps.length,
  "the outcomes partition the cohort"
);

const counts = (cohort, days = 21) =>
  Object.fromEntries(outcomeBreakdown(cohort, days, today).map((outcome) => [outcome.id, outcome.count]));
assert.deepEqual(
  counts(sentApplications(fixture, "12w", today)),
  { awaiting: 1, noResponse: 1, interviewing: 2, offer: 0, rejected: 2, ghosted: 0, withdrawn: 1, skipped: 1 },
  "stored outcomes plus the derived No response count partition the cohort"
);
assert.deepEqual(
  counts(sentApplications(fixture, "all", today)),
  { awaiting: 1, noResponse: 1, interviewing: 2, offer: 1, rejected: 3, ghosted: 1, withdrawn: 1, skipped: 1 }
);
assert.equal(counts(sentApplications(fixture, "12w", today), 7).noResponse, 1, "recent activity stays clear of even the shortest threshold");
assert.equal(counts(sentApplications(fixture, "12w", today), 180).noResponse, 0, "a long threshold flags no one");
assert.ok(
  !outcomeBreakdown(sentApplications(fixture, "8w", today).filter((application) => application.id !== "a9"), 21, today)
    .some((outcome) => outcome.id === "skipped"),
  "the Skipped row appears only when a later-skipped submission is in the cohort"
);
for (const row of registerRows(fixture, "all", 21, today)) {
  for (const entry of row.entries) {
    assert.equal(entry.outcome, outcomeOf(entry.application, 21, today), `${entry.application.id}: a register entry carries its outcome`);
  }
}

// --- The register: calendar weeks, newest first ------------------------------
for (const zone of ["America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
  inZone(zone, () => {
    const tuesday = new Date(2026, 9, 20, 12);
    const local = buildFixture();

    const weeks = registerRows(local, "8w", 21, tuesday);
    assert.deepEqual(
      weeks.map((row) => ymd(row.from)),
      ["2026-10-19", "2026-10-12", "2026-10-05", "2026-09-28", "2026-09-21", "2026-09-14", "2026-09-07", "2026-08-31"],
      `${zone}: one row per calendar week, newest first`
    );
    assert.ok(
      weeks.every((row) => row.unit === "week" && row.from.getDay() === 1 && row.from.getHours() === 0),
      `${zone}: every week starts at a local Monday midnight`
    );
    assert.equal(ymd(weeks[0].to), "2026-10-20", `${zone}: the current week runs to today`);
    assert.ok(
      weeks.slice(1).every((row) => row.to.getDay() === 0 && dayNumber(row.to) - dayNumber(row.from) === 6),
      `${zone}: earlier weeks run Monday to Sunday`
    );
    assert.deepEqual(
      weeks.map((row) => row.sent),
      [0, 2, 1, 1, 0, 1, 1, 1],
      `${zone}: Sunday Sep 20 closes the week of Sep 14, and empty weeks stay in the register`
    );
    assert.deepEqual([weeks[0].entries, weeks[4].entries], [[], []], `${zone}: an empty week has no entries`);
    assert.deepEqual(entryIds(weeks[1]), ["a9", "a1"], `${zone}: a row's entries run oldest first`);

    for (const option of ANALYTICS_PERIODS.filter((candidate) => candidate.weeks !== null)) {
      const rows = registerRows(local, option.id, 21, tuesday);
      const totals = periodMetrics(local, option.id, tuesday);
      assert.equal(rows.length, option.weeks, `${zone} ${option.id}: one row per week of the period`);
      assert.ok(
        rows.slice(1).every((row, index) => dayNumber(rows[index].from) - dayNumber(row.from) === 7),
        `${zone} ${option.id}: rows step back exactly one week, newest first`
      );
      assert.deepEqual(
        ["sent", "responded", "interviewed", "offers"].map((field) => total(rows, field)),
        [totals.sent, totals.responded, totals.interviewed, totals.offers],
        `${zone} ${option.id}: the week rows sum to the totals line`
      );
    }

    const months = registerRows(local, "all", 21, tuesday);
    assert.deepEqual(
      months.map((row) => [row.key, row.unit, ymd(row.from), row.sent, row.responded]),
      [
        ["m2026-9", "month", "2026-10-01", 4, 2],
        ["m2026-8", "month", "2026-09-01", 3, 1],
        ["m2026-7", "month", "2026-08-01", 2, 0],
        ["m2026-6", "month", "2026-07-01", 1, 1],
        ["m2026-5", "month", "2026-06-01", 0, 0],
        ["m2026-4", "month", "2026-05-01", 1, 0]
      ],
      `${zone}: All time keeps one row per month from the first send month, newest first, empty months included`
    );
    assert.equal(ymd(months[0].to), "2026-10-20", `${zone}: the current month runs to today`);
    assert.equal(ymd(months[1].to), "2026-09-30", `${zone}: an earlier month runs to its last day`);
    assert.equal(total(months, "sent"), periodMetrics(local, "all", tuesday).sent, `${zone}: month rows sum to the All time total`);

    // The week turns over at local midnight, whatever the UTC day is.
    const edges = [
      record("late-sunday", "Edge", "applied", undefined, { appliedAt: new Date(2026, 9, 18, 23, 30).toISOString() }),
      record("early-monday", "Edge", "applied", undefined, { appliedAt: new Date(2026, 9, 19, 0, 30).toISOString() })
    ];
    const edgeRows = registerRows(edges, "8w", 21, tuesday);
    assert.deepEqual(
      [entryIds(edgeRows[0]), entryIds(edgeRows[1])],
      [["early-monday"], ["late-sunday"]],
      `${zone}: Monday 00:30 opens this week; Sunday 23:30 closes the last`
    );

    const mondayDawn = registerRows([], "8w", 21, new Date(2026, 9, 19, 0, 5));
    assert.deepEqual(
      [mondayDawn.length, ymd(mondayDawn[0].from), ymd(mondayDawn[0].to)],
      [8, "2026-10-19", "2026-10-19"],
      `${zone}: just after Monday midnight, the current week is that one day`
    );
    const sundayNight = registerRows([], "8w", 21, new Date(2026, 9, 25, 23, 55));
    assert.deepEqual(
      [ymd(sundayNight[0].from), ymd(sundayNight[0].to), ymd(sundayNight[7].from)],
      ["2026-10-19", "2026-10-25", "2026-08-31"],
      `${zone}: late Sunday is still the week that began Monday`
    );
  });
}

// DST weeks: a 25-hour and a 23-hour Sunday still close exactly one week.
inZone("America/New_York", () => {
  const dstWeeks = [
    {
      name: "fall back",
      today: new Date(2026, 10, 4, 12),
      lateSunday: new Date(2026, 10, 1, 23, 30),
      earlyMonday: new Date(2026, 10, 2, 0, 30),
      froms: ["2026-11-02", "2026-10-26", "2026-10-19", "2026-10-12", "2026-10-05", "2026-09-28", "2026-09-21", "2026-09-14"],
      sunday: "2026-11-01"
    },
    {
      name: "spring forward",
      today: new Date(2026, 2, 11, 12),
      lateSunday: new Date(2026, 2, 8, 23, 30),
      earlyMonday: new Date(2026, 2, 9, 0, 30),
      froms: ["2026-03-09", "2026-03-02", "2026-02-23", "2026-02-16", "2026-02-09", "2026-02-02", "2026-01-26", "2026-01-19"],
      sunday: "2026-03-08"
    }
  ];
  for (const week of dstWeeks) {
    const sends = [
      record("late-sunday", "Edge", "applied", undefined, { appliedAt: week.lateSunday.toISOString() }),
      record("early-monday", "Edge", "applied", undefined, { appliedAt: week.earlyMonday.toISOString() })
    ];
    const rows = registerRows(sends, "8w", 21, week.today);
    assert.deepEqual(rows.map((row) => ymd(row.from)), week.froms, `${week.name}: weeks stay on Mondays across the change`);
    assert.ok(rows.every((row) => row.from.getHours() === 0 && row.from.getDay() === 1), `${week.name}: each week starts at local midnight`);
    assert.equal(ymd(rows[1].to), week.sunday, `${week.name}: the changeover week ends on its Sunday`);
    assert.deepEqual([entryIds(rows[0]), entryIds(rows[1])], [["early-monday"], ["late-sunday"]], `${week.name}: the boundary is local midnight`);
    assert.equal(total(rows, "sent"), periodMetrics(sends, "8w", week.today).sent, `${week.name}: rows sum to the total`);
  }
});

// All time across a year boundary, and with nothing sent.
const span = [record("old", "Old", "applied", "2025-11-14"), record("new", "New", "rejected", "2026-02-02")];
const february = new Date(2026, 1, 4, 12);
assert.deepEqual(
  registerRows(span, "all", 21, february).map((row) => [row.key, ymd(row.from), ymd(row.to), row.sent]),
  [
    ["m2026-1", "2026-02-01", "2026-02-04", 1],
    ["m2026-0", "2026-01-01", "2026-01-31", 0],
    ["m2025-11", "2025-12-01", "2025-12-31", 0],
    ["m2025-10", "2025-11-01", "2025-11-30", 1]
  ],
  "month rows run back across a year boundary to the first send month"
);
assert.deepEqual(registerRows([], "all", 21, today), [], "All time with nothing sent has no rows");
assert.deepEqual(
  registerRows([], "12w", 21, today).map((row) => row.sent),
  Array(12).fill(0),
  "a windowed period with nothing sent still lists its weeks"
);

// Per-row rate and median reply time.
const paced = [
  record("r1", "One", "applied", "2026-10-12", { stageHistory: [response("x", "2026-10-14")] }),
  record("r2", "Two", "interviewing", "2026-10-13", { stageHistory: [interview("x", "2026-10-19")] }),
  record("r3", "Three", "applied", "2026-10-14"),
  record("r4", "Four", "applied", "2026-10-05", { stageHistory: [response("x", "2026-10-06")] }),
  record("r5", "Five", "applied", "2026-10-06", { stageHistory: [response("x", "2026-10-09")] }),
  record("r6", "Six", "applied", "2026-09-28", { stageHistory: [response("x", "2026-09-29")] }),
  record("r7", "Seven", "applied", "2026-09-29", { stageHistory: [response("x", "2026-10-02")] }),
  record("r8", "Eight", "applied", "2026-09-30", { stageHistory: [response("x", "2026-10-10")] }),
  record("r9", "Nine", "rejected", "2026-10-01", { stageHistory: [stage("x", "rejected", "2026-10-08")] }),
  record("r10", "Ten", "rejected", "2026-09-22", { stageHistory: [stage("x", "rejected", "2026-09-30")] })
];
assert.equal(MIN_RATE_SAMPLE, 3);
const pacedRows = registerRows(paced, "8w", 21, today);
assert.deepEqual(
  pacedRows.slice(0, 5).map((row) => [ymd(row.from), row.sent, row.responded, row.interviewed, row.responseRate, row.medianResponseDays]),
  [
    ["2026-10-19", 0, 0, 0, null, null],
    ["2026-10-12", 3, 2, 1, 2 / 3, 4],
    ["2026-10-05", 2, 2, 0, null, 2],
    ["2026-09-28", 4, 3, 0, 0.75, 3],
    ["2026-09-21", 1, 0, 0, null, null]
  ],
  "a row's rate needs three sent (two of two shows none); its median is over its own timed replies"
);
assert.deepEqual(entryIds(pacedRows[1]), ["r1", "r2", "r3"], "entries run in sending order");

// --- The previous window, stage counts, and monthly rows -------------------
{
  const tuesday = new Date(2026, 9, 20, 12);
  const window = [
    record("cur-first", "Co", "applied", "2026-08-03"),
    record("cur-ghost", "Co", "ghosted", "2026-09-10"),
    record("cur-skip", "Co", "not_applying", "2026-10-01", { notApplyingAt: at("2026-10-02") }),
    record("prev-last", "Co", "rejected", "2026-07-28"),
    record("past-the-span", "Co", "applied", "2026-07-29"),
    record("prev-first", "Co", "applied", "2026-05-11"),
    record("too-early", "Co", "applied", "2026-05-10"),
    record("job-only", "Co", "not_applying", undefined, { notApplyingAt: at("2026-09-01") }),
    record("draft", "Co", "draft", undefined)
  ];
  const current = sentApplications(window, "12w", tuesday);
  assert.deepEqual(current.map((application) => application.id).sort(), ["cur-first", "cur-ghost", "cur-skip"]);
  assert.deepEqual(
    previousApplications(window, "12w", tuesday).map((application) => application.id).sort(),
    ["prev-first", "prev-last"],
    "on a Tuesday, the previous span runs Monday May 11 through Tuesday Jul 28: the same elapsed days, edges included"
  );
  assert.equal(previousApplications(window, "all", tuesday), null, "All time has no previous window");
  assert.deepEqual(
    cohortStageCounts(current),
    { applied: 1, interviewing: 0, offer: 0, ghosted: 1, rejected: 0, withdrawn: 0, not_applying: 1 },
    "a sent application later skipped counts as Skipped; job-only skips and drafts are not in the cohort"
  );
  assert.deepEqual(periodChange(0, 0), { kind: "none" });
  assert.deepEqual(periodChange(3, 0), { kind: "new" });
  assert.deepEqual(periodChange(3, 4), { kind: "percent", percent: -25 });
  assert.deepEqual(periodChange(5, 2), { kind: "percent", percent: 150 });
  const months = registerRows(window, "12w", 21, tuesday, "month");
  assert.deepEqual(
    months.map((row) => [row.unit, ymd(row.from), ymd(row.to), row.sent]),
    [["month", "2026-10-01", "2026-10-20", 1], ["month", "2026-09-01", "2026-09-30", 1], ["month", "2026-08-03", "2026-08-31", 1]],
    "a windowed period by month starts at the period's first day, not the month's"
  );
  assert.equal(registerRows(window, "12w", 21, tuesday).length, 12, "weekly stays the default for a windowed period");
}

// --- Upcoming ----------------------------------------------------------------
const upcoming = upcomingItems(fixture, today);
assert.deepEqual(
  upcoming.interviews.map((item) => [item.application.id, item.days, item.detail]),
  [["a2", 0, "Round 2 · Final"], ["a12", 3, "Round 1 · Recruiter screen"]],
  "an interview today is still upcoming; each carries its round"
);
assert.deepEqual(
  upcoming.followups.map((item) => [item.application.id, item.days]),
  [["a12", -2], ["a1", 2]],
  "overdue follow-ups lead; ones beyond a week and on closed records are left out"
);

// --- Silence: open submitted records by days since their last activity -------
assert.deepEqual([...SILENCE_EDGES], [0, 8, 15, 31, 60]);
assert.deepEqual(
  silenceBins([], 15, today).bins.map((bin) => [bin.id, bin.label]),
  [["d0", "0–7 days"], ["d8", "8–14 days"], ["d15", "15–30 days"], ["d31", "31–59 days"], ["d60", "60+ days"]],
  "a threshold already on an edge adds no bin"
);
assert.deepEqual(
  silenceBins([], 7, today).bins.map((bin) => [bin.label, bin.past]).slice(0, 3),
  [["0–6 days", false], ["7 days", true], ["8–14 days", true]],
  "any other threshold becomes a bin edge, so past starts exactly there"
);
const BOUNDARY_DAYS = [0, 7, 8, 14, 15, 30, 31, 59, 60, 120];
for (const zone of ["America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
  inZone(zone, () => {
    const tuesday = new Date(2026, 9, 20, 12);
    const ago = (days) => ymd(new Date(2026, 9, 20 - days, 12));
    // Even days: a reply is the last activity. Odd days: the submission is.
    const silent = BOUNDARY_DAYS.map((days, index) =>
      index % 2
        ? record(`quiet-${days}`, "Quiet", "applied", ago(days))
        : record(`quiet-${days}`, "Quiet", "interviewing", ago(days + 9), {
          stageHistory: [stage("s1", "interviewing", ago(days + 5)), response("r1", ago(days))]
        })
    );
    const { bins, open } = silenceBins(silent, 15, tuesday);
    assert.equal(open, BOUNDARY_DAYS.length, `${zone}: every open record is counted`);
    assert.deepEqual(
      bins.map((bin) => bin.count),
      [2, 2, 2, 2, 2],
      `${zone}: 7|8, 14|15, 30|31, and 59|60 split exactly at their boundaries`
    );
    assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), open, `${zone}: each record lands in one bin`);
    // The threshold is always an edge, so the past bins hold exactly the No
    // response candidates.
    for (const threshold of [7, 21, 25, 30, 90]) {
      const past = silenceBins(silent, threshold, tuesday).bins.filter((bin) => bin.past);
      assert.equal(
        past.reduce((sum, bin) => sum + bin.count, 0),
        noResponseCandidates(silent, threshold, tuesday).length,
        `${zone}: at ${threshold} days the past bins count the No response candidates`
      );
    }
  });
}
assert.deepEqual(
  silenceBins([], 21, today).bins.map((bin) => [bin.id, bin.past]),
  [["d0", false], ["d8", false], ["d15", false], ["d21", true], ["d31", true], ["d60", true]],
  "at 21 days, bins from 21 on are past"
);
assert.deepEqual(
  silenceBins([], 30, today).bins.filter((bin) => bin.past).map((bin) => [bin.id, bin.label]),
  [["d30", "30 days"], ["d31", "31–59 days"], ["d60", "60+ days"]],
  "at 30 days, the threshold splits 15–30 and only day 30 on is past"
);
assert.deepEqual(silenceBins([], 21, today).open, 0, "nothing open, nothing counted");

const daysBefore = (days) => ymd(new Date(2026, 9, 20 - days, 12));
const excluded = [
  record("draft-dated", "Ex", "draft", daysBefore(40)),
  record("job-only-skip", "Ex", "not_applying", undefined, { notApplyingAt: at(daysBefore(40)) }),
  record("later-skip", "Ex", "not_applying", daysBefore(40), { notApplyingAt: at(daysBefore(35)) }),
  record("rejected", "Ex", "rejected", daysBefore(40)),
  record("ghosted", "Ex", "ghosted", daysBefore(40), { stageHistory: [stage("s1", "ghosted", daysBefore(19))] }),
  record("withdrawn", "Ex", "withdrawn", daysBefore(40)),
  record("offer", "Ex", "offer", daysBefore(40)),
  record("applied-undated", "Ex", "applied", undefined),
  record("applied-future", "Ex", "applied", "2026-11-05"),
  record("interview-scheduled", "Ex", "interviewing", daysBefore(40), {
    stageHistory: [stage("s1", "interviewing", daysBefore(30)), interview("i1", "2026-10-23")]
  })
];
const counted = record("counted", "In", "applied", daysBefore(40));
const mixed = silenceBins([...excluded, counted], 21, today);
assert.equal(
  mixed.open,
  1,
  "Draft, Skipped, closed stages, Offer, undated, and future-dated activity are left out of the open count"
);
assert.equal(mixed.bins.find((bin) => bin.id === "d31").count, 1, "only the quiet Applied record is binned");
assert.equal(silenceBins(excluded, 21, today).open, 0, "none of the excluded records is open");
const heldByFollowup = record("held", "In", "applied", daysBefore(40), { followupAt: at(daysBefore(-1)) });
assert.equal(silenceBins([heldByFollowup], 21, today).open, 0, "a follow-up planned for later keeps a record out, as it does from No response");
assert.equal(noResponseCandidates([heldByFollowup], 21, today).length, 0);

console.log("PASS application analytics provenance, register, and metrics");
