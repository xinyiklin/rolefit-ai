// Base64 <-> Buffer helpers shared by workspace base-resume storage and the
// application-tracker PDF artifact save. Kept dependency-free.

export function base64ToBuffer(value: unknown, label = "File"): Buffer {
  const base64 = String(value ?? "").replace(/^data:[^,]+,/, "");
  if (!base64 || !/^[a-z0-9+/=\s]+$/i.test(base64)) {
    throw new Error(`${label} data was not valid base64.`);
  }
  const buffer = Buffer.from(base64, "base64");
  // Bound the decoded file (real resumes/PDFs are well under 1 MB) so a crafted
  // body can't exhaust memory/temp disk via base-resume save or export.
  if (buffer.length > 10_000_000) {
    throw new Error(`${label} file is too large.`);
  }
  return buffer;
}

export function bufferToBase64(buffer: Uint8Array): string {
  return Buffer.from(buffer).toString("base64");
}
