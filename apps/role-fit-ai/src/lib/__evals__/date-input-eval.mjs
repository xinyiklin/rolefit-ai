import assert from "node:assert/strict";

import { toDateInput, toIso, todayIso } from "../dateInput.ts";

// A picked day must survive storage in every zone, including the ones where
// local noon is the previous UTC day. Node re-reads TZ when it is reassigned.
const ZONES = ["Pacific/Honolulu", "America/New_York", "UTC", "Asia/Kolkata", "Pacific/Auckland", "Pacific/Kiritimati"];
const DAYS = ["2026-01-01", "2026-03-08", "2026-04-05", "2026-07-15", "2026-09-27", "2026-10-20", "2026-12-31"];

const offsets = new Set();
for (const zone of ZONES) {
  process.env.TZ = zone;
  offsets.add(new Date(Date.UTC(2026, 0, 1, 12)).getTimezoneOffset());
  for (const day of DAYS) {
    assert.equal(toDateInput(toIso(day)), day, `${zone}: ${day} round-trips through storage`);
  }
  assert.equal(toDateInput(todayIso(new Date(2026, 9, 20, 23, 30))), "2026-10-20", `${zone}: a late-evening entry keeps its local day`);
  assert.equal(toDateInput(todayIso(new Date(2026, 9, 20, 0, 15))), "2026-10-20", `${zone}: an after-midnight entry keeps its local day`);
}
assert.ok(offsets.size >= 5, "the zones above really ran with different offsets");

for (const invalid of ["", "20260-01-01", "2026-1-01", "2026-13-01T00:00", "soon"]) {
  assert.equal(toIso(invalid), "", `toIso refuses ${JSON.stringify(invalid)} instead of throwing`);
}
assert.equal(toDateInput("2026-10-05"), "2026-10-05", "a stored date-only value is shown as written");
assert.equal(toDateInput("not a date"), "", "an unreadable stored value shows no date");
assert.equal(toDateInput(undefined), "");

console.log("date input eval passed");
