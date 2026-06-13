export const maxRequestBytes = 8_000_000;

export class FetchTimeoutError extends Error {}

export function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

// Reads the request body as UTF-8, enforcing a true BYTE cap (default 8 MB).
// Accumulates Buffers and decodes once at the end so the cap is accurate and
// multibyte characters are never split across chunk boundaries. Pass a smaller
// `maxBytes` for JSON/AI routes that never need the full DOCX-sized budget.
export function readBody(req, maxBytes = maxRequestBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length; // Buffer.length is the byte length
      if (total > maxBytes) {
        reject(new Error("Request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Shared fetch wrapper that aborts after `timeoutMs` so a hung peer never
// holds a request open forever. Surfaces a tagged FetchTimeoutError on abort.
export async function fetchWithTimeout(input, init = {}, timeoutMs = 120_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new FetchTimeoutError("The request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
