import type { IncomingMessage, ServerResponse } from "node:http";

// Module-internal default byte cap for readBody; not part of the public surface.
const maxRequestBytes = 8_000_000;

export class FetchTimeoutError extends Error {}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
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
export function readBody(req: IncomingMessage, maxBytes = maxRequestBytes): Promise<string> {
  return new Promise<string>((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
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
export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {},
  timeoutMs = 120_000
): ReturnType<typeof fetch> {
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
