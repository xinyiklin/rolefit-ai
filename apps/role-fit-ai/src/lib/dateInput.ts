// Tracker dates are day-granular. A yyyy-mm-dd from a date input anchors at
// local noon so it never slips a day across time zones.
export function toDateInput(iso?: string) {
  return iso ? iso.slice(0, 10) : "";
}

export function toIso(dateInput: string) {
  return dateInput ? new Date(`${dateInput}T12:00:00`).toISOString() : "";
}

export function todayIso(now = new Date()) {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return toIso(day);
}
