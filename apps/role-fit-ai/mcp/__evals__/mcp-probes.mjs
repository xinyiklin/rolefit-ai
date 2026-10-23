// Local MCP server probes: protocol handling against a fake RoleFit fetch, and
// one stdio subprocess run proving stdout carries only JSON-RPC lines.
//
// Locked here: version negotiation, notifications get no reply, tool errors
// surface the server's issues with isError, search uses the tracker's duplicate
// matcher and filters, tool calls hit the intended routes, and ROLEFIT_URL is
// loopback-only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { handleMcpMessage } from "../server.ts";
import { createTools, roleFitBaseUrl } from "../tools.ts";

const base = "http://127.0.0.1:5181";
const records = [
  { id: "a1", title: "Backend Engineer at Acme", company: "Acme, Inc.", role: "Backend Engineer", status: "applied", jobUrl: "https://boards.greenhouse.io/acme/jobs/4012345", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", appliedAt: "2026-10-01T00:00:00.000Z", jobDescription: "private text" },
  { id: "b2", title: "Data Analyst at Globex", company: "Globex", role: "Data Analyst", status: "rejected", jobUrl: "https://globex.example/jobs/9", createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z" }
];
const calls = [];
async function fakeFetch(url, init = {}) {
  calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
  const path = new URL(url).pathname;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (path === "/api/applications" && init.method === "GET") return json(200, { applications: records, revision: "r1" });
  if (path === "/api/applications/commit") {
    return JSON.parse(init.body).application.title
      ? json(201, { application: { id: "new" }, revision: "r2" })
      : json(400, { error: "The application was not saved.", issues: ["application.title: required"] });
  }
  if (path === "/api/applications/a1/status") return json(200, { application: { id: "a1", status: "interviewing" }, changed: true });
  if (path === "/api/applications/a1/answers") return json(200, { application: { id: "a1" }, added: 1 });
  if (path === "/api/applications/a1/events") return json(200, { application: { id: "a1" }, statusChanged: true });
  return json(404, { error: "API route not found." });
}
const tools = createTools(base, fakeFetch);
const rpc = (method, params, id = 1) => handleMcpMessage({ jsonrpc: "2.0", id, method, params }, tools);
const call = async (name, args) => (await rpc("tools/call", { name, arguments: args })).result;

// Protocol.
{
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "0" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  assert.equal((await rpc("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion, "2025-11-25", "unknown versions get the newest");
  assert.equal(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, tools), null);
  assert.deepEqual((await rpc("ping")).result, {});
  assert.equal((await rpc("resources/list")).error.code, -32601);
  assert.equal((await rpc("tools/call", { name: "delete_everything" })).error.code, -32602);
  assert.equal((await handleMcpMessage({ id: 4, method: "ping" }, tools)).error.code, -32600);
  assert.equal((await handleMcpMessage([{ jsonrpc: "2.0", id: 5, method: "ping" }], tools)).error.code, -32600, "batches are not part of the transport");
  assert.equal((await handleMcpMessage({ jsonrpc: "2.0", id: null, method: "ping" }, tools)).error.code, -32600, "MCP request ids are never null");
  assert.equal(await handleMcpMessage({ jsonrpc: "2.0", id: 7, result: {} }, tools), null, "a client response gets no reply");
  const listed = (await rpc("tools/list")).result.tools;
  assert.deepEqual(listed.map((tool) => tool.name), ["search_applications", "get_application", "commit_application", "update_application_status", "log_application_event", "add_application_answers"]);
  for (const tool of listed) {
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(tool.description.length > 40);
  }
  const commitSchema = listed.find((tool) => tool.name === "commit_application").inputSchema;
  assert.deepEqual(commitSchema.properties.application.properties.status.enum, ["applied", "not_applying"]);
  assert.ok(!commitSchema.properties.application.properties.notApplyingReasons.items.enum.includes("constraints"), "retired skip reason is not offered");
}

// search_applications.
{
  const all = await call("search_applications", {});
  assert.equal(all.isError, false);
  assert.deepEqual(all.structuredContent.applications.map((record) => record.id), ["b2", "a1"], "newest first");
  assert.equal(all.structuredContent.applications[0].jobDescription, undefined, "summaries only");
  const dupe = await call("search_applications", { posting: { jobUrl: "https://boards.greenhouse.io/acme/jobs/4012345?gh_src=abc" } });
  assert.equal(dupe.structuredContent.applications[0].id, "a1");
  assert.equal(dupe.structuredContent.applications[0].match.confidence, "exact");
  assert.equal((await call("search_applications", { company: "ACME corp" })).structuredContent.total, 1);
  assert.equal((await call("search_applications", { query: "analyst", status: "rejected" })).structuredContent.applications[0].id, "b2");
  assert.equal((await call("search_applications", { status: "offer" })).structuredContent.total, 0);
  assert.equal((await call("search_applications", { limit: 1 })).structuredContent.applications.length, 1);
  for (const posting of [{ jobUrl: 123 }, ["x"], { jobText: null }]) {
    const bad = await call("search_applications", { posting });
    assert.equal(bad.isError, true, "a malformed duplicate check is an error, never an empty result");
    assert.match(bad.structuredContent.error, /^posting: must be an object of text fields/);
  }
}

// commit_application and update_application_status reach their routes.
{
  calls.length = 0;
  const saved = await call("commit_application", { application: { title: "Role", status: "applied" } });
  assert.equal(saved.isError, false);
  assert.equal(calls[0].url, `${base}/api/applications/commit`);
  assert.deepEqual(calls[0].body, { application: { title: "Role", status: "applied" } });
  const refused = await call("commit_application", { application: { status: "applied" } });
  assert.equal(refused.isError, true);
  assert.deepEqual(refused.structuredContent.issues, ["application.title: required"]);
  assert.match(refused.content[0].text, /application\.title: required/);

  calls.length = 0;
  const moved = await call("update_application_status", { id: "a1", status: "interviewing", date: "2026-10-22" });
  assert.equal(moved.isError, false);
  assert.equal(calls[0].url, `${base}/api/applications/a1/status`);
  assert.deepEqual(calls[0].body, { status: "interviewing", date: "2026-10-22" });
  assert.equal((await call("update_application_status", { status: "rejected" })).isError, true);

  calls.length = 0;
  const answered = await call("add_application_answers", { id: "a1", answers: [{ question: "Q", answer: "A" }] });
  assert.equal(answered.isError, false);
  assert.equal(calls[0].url, `${base}/api/applications/a1/answers`);
  assert.deepEqual(calls[0].body, { answers: [{ question: "Q", answer: "A" }] });

  calls.length = 0;
  const logged = await call("log_application_event", { id: "a1", type: "interview", kind: "technical", date: "2026-10-30" });
  assert.equal(logged.isError, false);
  assert.equal(calls[0].url, `${base}/api/applications/a1/events`);
  assert.deepEqual(calls[0].body, { type: "interview", kind: "technical", date: "2026-10-30" });

  const record = await call("get_application", { id: "a1" });
  assert.equal(record.isError, false);
  assert.equal(record.structuredContent.jobDescription, "private text", "the full record");
  const missing = await call("get_application", { id: "zz" });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /No application has id zz/);
}

// Unreachable server and the loopback-only base URL.
{
  const offline = createTools(base, async () => { throw new TypeError("fetch failed"); });
  const result = await handleMcpMessage({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "search_applications", arguments: {} } }, offline);
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /not reachable/);
  const timedOut = createTools(base, async () => { throw new DOMException("timed out", "TimeoutError"); });
  const slow = await handleMcpMessage({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "search_applications", arguments: {} } }, timedOut);
  assert.match(slow.result.content[0].text, /did not answer within 60 seconds/);
  assert.equal(roleFitBaseUrl(), base);
  assert.equal(roleFitBaseUrl("http://localhost:6000/"), "http://localhost:6000");
  for (const bad of ["https://127.0.0.1:5181", "http://example.com:5181", "http://10.0.0.2:5181", "http://127.0.0.1:5181/api", "http://user@127.0.0.1:5181", "nope"]) {
    assert.throws(() => roleFitBaseUrl(bad), /ROLEFIT_URL/, bad);
  }
}

// The real stdio entry: protocol lines only, parse errors answered, bad URL refused.
{
  const entry = fileURLToPath(new URL("../server.ts", import.meta.url));
  const input = [
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    "{not json",
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
  ].join("\n") + "\n";
  const run = spawnSync(process.execPath, [entry], { input, encoding: "utf8", env: { ...process.env, ROLEFIT_URL: "http://127.0.0.1:9" }, timeout: 20_000 });
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => line.id ?? null), [1, null, 2]);
  assert.equal(lines[1].error.code, -32700);
  const refused = spawnSync(process.execPath, [entry], { input: "", encoding: "utf8", env: { ...process.env, ROLEFIT_URL: "http://example.com" }, timeout: 20_000 });
  assert.equal(refused.status, 2);
  assert.equal(refused.stdout, "");
  assert.match(refused.stderr, /loopback/);
}

console.log("mcp probes passed");
