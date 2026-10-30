import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import { createClient, loopbackFetch } from "../client.ts";

// A synthetic loopback server on an ephemeral port: never a canonical RoleFit port.
let closedByClient = false;
const server = createServer((request, response) => {
  if (request.url === "/echo") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      response.writeHead(201, { "Content-Type": "application/json", "X-Seen-Type": request.headers["content-type"] ?? "" });
      response.end(JSON.stringify({ method: request.method, body: JSON.parse(body) }));
    });
    return;
  }
  if (request.url === "/slow") {
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ done: true }));
    }, 300);
    return;
  }
  if (request.url === "/beyond-agent-timeout") {
    // Past http.globalAgent's 5 s socket timeout: only the request's signal may end it.
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ done: "late" }));
    }, 5_600);
    return;
  }
  if (request.url === "/cut") {
    response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "100" });
    response.write("{\"partial\":");
    setTimeout(() => request.socket.destroy(), 20);
    return;
  }
  if (request.url === "/empty") {
    response.writeHead(204);
    response.end();
    return;
  }
  // /hang never answers; record when the client gives up on it.
  request.on("close", () => { closedByClient = true; });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const client = createClient(base, loopbackFetch);

try {
  const echoed = await client.request("POST", "/echo", { question: "Why Acme?" });
  assert.deepEqual(echoed, { ok: true, value: { method: "POST", body: { question: "Why Acme?" } } }, "a JSON request and its reply round-trip");
  const raw = await loopbackFetch(`${base}/echo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(raw.status, 201);
  assert.equal(raw.headers.get("x-seen-type"), "application/json", "request headers reach the server and response headers come back");

  assert.deepEqual(await client.request("GET", "/slow", undefined, { timeoutMs: 5_000 }), { ok: true, value: { done: true } }, "a slow reply is awaited, not cut off");

  assert.deepEqual(
    await client.request("GET", "/beyond-agent-timeout", undefined, { timeoutMs: 20_000 }),
    { ok: true, value: { done: "late" } },
    "no socket or header deadline cuts a reply the request is still waiting for"
  );

  const cut = await client.request("GET", "/cut");
  assert.match(cut.value.error, /closed the connection before finishing its reply/, "a reply cut off mid-body is not reported as unreachable");

  const empty = await loopbackFetch(`${base}/empty`);
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), "", "a bodiless status yields an empty body");

  const timedOut = await client.request("GET", "/hang", undefined, { timeoutMs: 100 });
  assert.match(timedOut.value.error, /did not answer within 0\.1 seconds/, "the request's own timeout is reported as a timeout");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(closedByClient, true, "giving up closes the request, so RoleFit stops its work");

  closedByClient = false;
  const controller = new AbortController();
  const cancelled = client.request("GET", "/hang", undefined, { timeoutMs: 5_000, signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  assert.deepEqual(await cancelled, { ok: false, value: { error: "Cancelled." } }, "a caller's cancel is reported as cancelled");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(closedByClient, true, "a cancel closes the request too");
} finally {
  await new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); });
}

const unreachable = await createClient(base, loopbackFetch).request("GET", "/echo");
assert.match(unreachable.value.error, /RoleFit is not reachable at/, "a closed port reads as not reachable");

const entry = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
assert.match(entry, /serveStdio\(createTools\(baseUrl, loopbackFetch\)\)/, "the stdio server sends every request through the loopback fetch");

console.log("MCP loopback fetch: passed");
