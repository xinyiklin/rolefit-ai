import type { IncomingMessage, ServerResponse } from "node:http";

// Module-internal default byte cap for readBody; not part of the public surface.
const maxRequestBytes = 8_000_000;

export class FetchTimeoutError extends Error {}
export class RequestAbortedError extends Error {
  constructor(message = "The request was cancelled.") {
    super(message);
    this.name = "AbortError";
  }
}

export function isRequestAborted(error: unknown, req?: IncomingMessage, res?: ServerResponse): boolean {
  return error instanceof RequestAbortedError
    || (error instanceof Error && error.name === "AbortError")
    || Boolean(req?.aborted)
    || Boolean(res?.destroyed && !res.writableEnded);
}

// The browser can abort a local request while a hosted provider or CLI is still
// working. Convert request/response disconnects into one signal and pass it down
// to that expensive side effect; dispose removes listeners after a normal reply.
export function requestAbortSignal(req: IncomingMessage, res: ServerResponse): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const abort = (): void => {
    if (!controller.signal.aborted) controller.abort(new RequestAbortedError());
  };
  const onResponseClose = (): void => {
    if (!res.writableEnded) abort();
  };
  req.once("aborted", abort);
  res.once("close", onResponseClose);
  return {
    signal: controller.signal,
    dispose: () => {
      req.off("aborted", abort);
      res.off("close", onResponseClose);
    }
  };
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

export function isApiPathname(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

// Reads the request body as UTF-8, enforcing a true BYTE cap (default 8 MB).
// Accumulates Buffers and decodes once at the end so the cap is accurate and
// multibyte characters are never split across chunk boundaries. Pass a smaller
// `maxBytes` for JSON/AI routes that never need the full upload-sized budget.
export function readBody(req: IncomingMessage, maxBytes = maxRequestBytes): Promise<string> {
  return new Promise<string>((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const cleanup = (): void => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        // Drain the remaining body instead of resetting the socket; the route can
        // now return its stable 413 JSON response to the browser.
        fail(new Error("Request is too large."));
        const finishDrain = (): void => {
          req.off("end", finishDrain);
          req.off("error", finishDrain);
        };
        // A socket error while draining must not become an unhandled EventEmitter
        // error after fail() removed the normal reader listeners.
        req.once("end", finishDrain);
        req.once("error", finishDrain);
        req.resume();
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveBody(Buffer.concat(chunks).toString("utf8"));
    };
    const onError = (error: Error): void => fail(error);
    const onAborted = (): void => {
      fail(new RequestAbortedError());
      // IncomingMessage commonly emits ECONNRESET after `aborted`; absorb that
      // expected follow-up now that the normal error listener has been removed.
      req.once("error", () => undefined);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
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
  const callerSignal = init.signal;
  let timedOut = false;
  const abortFromCaller = (): void => controller.abort(callerSignal?.reason ?? new RequestAbortedError());
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new FetchTimeoutError("The request timed out."));
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new FetchTimeoutError("The request timed out.");
    }
    if (callerSignal?.aborted) throw new RequestAbortedError();
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
