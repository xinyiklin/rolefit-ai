import { Buffer } from "node:buffer";

// Read an HTTP response without trusting Content-Length. Compatible reused
// listeners are still process-external, so every response body must be bounded
// while streaming rather than after response.text() has already allocated it.
export async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error("The local server response limit is invalid.");
  }
  const declaredLengthHeader = response.headers.get("content-length");
  if (declaredLengthHeader && /^\d+$/.test(declaredLengthHeader)) {
    const declaredLength = Number(declaredLengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
      throw new Error("The local server response is too large.");
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("The local server response is too large.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}
