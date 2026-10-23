// Tracker dates are day-granular. A yyyy-mm-dd from a date input is stored at
// local noon and read back as the local calendar day, so it keeps its day in
// every time zone (UTC+13/+14 included).
const DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/;

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function toDateInput(iso?: string) {
  if (!iso) return "";
  if (DATE_INPUT.test(iso)) return iso;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : localDay(date);
}

// "" for anything that is not a real four-digit-year date: a date input can
// emit a five-digit year mid-typing, and toISOString would throw on it.
export function toIso(dateInput: string) {
  if (!DATE_INPUT.test(dateInput)) return "";
  const date = new Date(`${dateInput}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

// toIso for typed input from outside a date picker: an impossible day such as
// 2026-02-30 is refused instead of rolling over into the next month.
export function exactDayIso(dateInput: string) {
  const iso = toIso(dateInput);
  return iso && toDateInput(iso) === dateInput ? iso : "";
}

export function todayIso(now = new Date()) {
  return toIso(localDay(now));
}
