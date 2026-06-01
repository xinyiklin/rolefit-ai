export const maxRequestBytes = 8_000_000;

export class FetchTimeoutError extends Error {}

export function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

export function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxRequestBytes) {
        reject(new Error("Request is too large."));
        req.destroy();
      }
    });

    req.on("end", () => resolveBody(body));
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
