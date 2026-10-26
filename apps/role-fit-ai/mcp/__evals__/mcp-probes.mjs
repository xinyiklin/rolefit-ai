// Local MCP server probes: protocol handling against a fake RoleFit fetch, and
// one stdio subprocess run proving stdout carries only JSON-RPC lines.
//
// Locked here: version negotiation, notifications get no reply, tool errors
// surface the server's issues with isError, search uses the tracker's duplicate
// matcher and filters, tool calls hit the intended routes, resume and cover reads
// return the app's own plain text beside the source, a submission package reads
// the saved documents and names what is missing, answer search returns only the
// newest answer per question, the profile carries only declared facts, and
// ROLEFIT_URL is loopback-only. Calls run concurrently and a cancelled or
// abandoned call is aborted without a reply.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { COVER_LETTER_STYLE_DEFAULTS, coverLetterPlainText, parseCoverLetterFile, serializeCoverLetterFile } from "@typeset/engine/lib/coverLetter.ts";
import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import { serializeResumeData } from "../../src/lib/resumeText.ts";

import { handleMcpMessage, serveStdio } from "../server.ts";
import { roleFitBaseUrl } from "../client.ts";
import { createTools } from "../tools.ts";

const base = "http://127.0.0.1:5181";
const artifacts = (fileName, hasSource = true) => ({ hasPdf: !hasSource, hasSource, fileName, savedAt: "2026-10-01T00:00:00.000Z" });
const records = [
  {
    id: "a1", title: "Backend Engineer at Acme", company: "Acme, Inc.", role: "Backend Engineer", status: "applied",
    jobUrl: "https://boards.greenhouse.io/acme/jobs/4012345", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    appliedAt: "2026-10-01T00:00:00.000Z", jobDescription: "private text", resumeUsed: "tailored",
    resumeArtifacts: artifacts("Acme Resume.resume"), coverLetterArtifacts: artifacts("Acme Cover.cover"),
    fitAssessment: { resumeLabel: "Base resume", result: { status: "ASSESSED", verdict: "REASONABLE" } },
    applicationAnswers: [
      { question: "Why Acme?", answer: "Old answer.", savedAt: "2026-10-01T00:00:00.000Z", questionId: "q1" },
      { question: "Why Acme?", answer: "Corrected answer about reliable APIs.", savedAt: "2026-10-02T00:00:00.000Z", questionId: "q1", status: "ready" },
      { question: "Salary expectation?", answer: "Open to discussing.", savedAt: "2026-10-01T00:00:00.000Z" }
    ]
  },
  {
    id: "b2", title: "Data Analyst at Globex", company: "Globex", role: "Data Analyst", status: "rejected", jobUrl: "https://globex.example/jobs/9",
    createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z", resumeArtifacts: artifacts("resume.pdf", false),
    applicationAnswers: [{ question: "Why data?", answer: "I like reliable pipelines.", savedAt: "2026-10-05T00:00:00.000Z" }]
  },
  { id: "c3", title: "Broken at Initech", company: "Initech", role: "Engineer", status: "applied", createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z", resumeArtifacts: artifacts("resume.resume") }
];
const resumeSource = await readFile(new URL("../../server/starter.resume", import.meta.url), "utf8");
const coverSource = serializeCoverLetterFile({
  header: { visible: true, name: "Synthetic Applicant", contact: ["applicant@example.test"] },
  sections: [{
    id: "cover", heading: "", type: "summary",
    items: [{ id: "body", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "paragraph", text: "Dear Hiring Team,\n\nSynthetic cover letter paragraph." }] }]
  }]
}, COVER_LETTER_STYLE_DEFAULTS);
let preferences = { exists: true, settings: { profileBackground: "Built payment APIs.", citizenshipStatus: "us-citizen", educationLevel: "unspecified", major: "" } };
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
  if (path === "/api/applications/a1/documents/resume.resume") return new Response(resumeSource, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
  if (path === "/api/applications/a1/documents/cover.cover") return new Response(coverSource, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
  if (path === "/api/applications/c3/documents/resume.resume") return new Response("{broken", { status: 200, headers: { "Content-Type": "application/octet-stream" } });
  if (path === "/api/workspace/preferences") return json(200, preferences);
  if (path === "/api/applications/a1/answers") return json(200, { application: { id: "a1" }, added: 1 });
  if (path === "/api/applications/a1/events") return json(200, { application: { id: "a1" }, statusChanged: true });
  if (path === "/api/workspace" && init.method === "GET") {
    return json(200, {
      baseResume: { text: "private" },
      baseResumeOptions: [{ fileName: "default.resume", label: "Base resume", kind: "resume" }, { fileName: "data.resume", label: "data", kind: "resume" }],
      coverLetter: { text: "private" },
      coverLetterOptions: [{ fileName: "default.cover", label: "Cover letter" }]
    });
  }
  if (path === "/api/workspace/cover-letter/candidates") {
    const [fileName] = JSON.parse(init.body).fileNames;
    return json(200, { candidates: fileName === "default.cover" ? [{ fileName, label: "Cover letter", text: coverSource }] : [] });
  }
  if (path === "/api/workspace/base-resume/candidates") {
    const [fileName] = JSON.parse(init.body).fileNames;
    const text = { "default.resume": resumeSource, "broken.resume": "{broken" }[fileName];
    return json(200, { candidates: text ? [{ fileName, label: "Base resume", kind: "resume", text }] : [] });
  }
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
  assert.deepEqual(listed.map((tool) => tool.name), [
    "search_applications", "get_application", "commit_application", "update_application_status", "log_application_event",
    "add_application_answers", "list_resumes", "get_resume", "list_cover_letters", "get_cover_letter", "get_submission_package",
    "get_answers", "get_candidate_profile", "analyze_job", "assess_fit", "polish_resume", "apply_resume_edits",
    "polish_cover_letter", "draft_answer", "review_application"
  ]);
  for (const tool of listed) {
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(tool.description.length > 40);
  }
  for (const name of ["commit_application", "add_application_answers", "log_application_event"]) {
    assert.match(listed.find((tool) => tool.name === name).description, /read the record .* before retrying/, `${name} warns against blind retries`);
  }
  const commitSchema = listed.find((tool) => tool.name === "commit_application").inputSchema;
  assert.deepEqual(commitSchema.properties.application.properties.status.enum, ["applied", "not_applying", "draft"]);
  assert.equal(commitSchema.properties.dryRun.type, "boolean");
  assert.equal(commitSchema.properties.acknowledgedDuplicates.items.type, "string");
  assert.ok(!commitSchema.properties.application.properties.notApplyingReasons.items.enum.includes("constraints"), "retired skip reason is not offered");
  const statusSchema = listed.find((tool) => tool.name === "update_application_status").inputSchema;
  assert.deepEqual(statusSchema.properties.documents.properties, commitSchema.properties.documents.properties, "one documents shape");
  assert.match(listed.find((tool) => tool.name === "update_application_status").description, /first submission .* must send documents/);
  assert.match(listed.find((tool) => tool.name === "commit_application").description, /applied commit must include documents\.resume/);
}

// search_applications.
{
  const all = await call("search_applications", {});
  assert.equal(all.isError, false);
  assert.deepEqual(all.structuredContent.applications.map((record) => record.id), ["c3", "b2", "a1"], "newest first");
  assert.equal(all.structuredContent.applications.find((record) => record.id === "a1").jobDescription, undefined, "summaries only");
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
  const documents = { resume: { sourceText: resumeSource }, cover: { sourceText: coverSource } };
  await call("update_application_status", { id: "a1", status: "applied", documents });
  assert.deepEqual(calls[0].body, { status: "applied", documents }, "submission documents reach the route unchanged");

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

  calls.length = 0;
  const checked = await call("commit_application", { application: { title: "Role", status: "draft" }, dryRun: true, acknowledgedDuplicates: ["a1"] });
  assert.equal(checked.isError, false);
  assert.deepEqual(calls[0].body, { application: { title: "Role", status: "draft" }, dryRun: true, acknowledgedDuplicates: ["a1"] }, "sent through unchanged");

  const record = await call("get_application", { id: "a1" });
  assert.equal(record.isError, false);
  assert.equal(record.structuredContent.jobDescription, "private text", "the full record");
  const missing = await call("get_application", { id: "zz" });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /No application has id zz/);
}

// list_resumes and get_resume.
{
  const listed = await call("list_resumes", {});
  assert.equal(listed.isError, false);
  assert.deepEqual(listed.structuredContent, { resumes: [{ fileName: "default.resume", label: "Base resume" }, { fileName: "data.resume", label: "data" }] }, "names only, no resume text");
  calls.length = 0;
  const resume = await call("get_resume", { fileName: "default.resume" });
  assert.equal(resume.isError, false);
  assert.deepEqual(calls[0].body, { fileNames: ["default.resume"] });
  assert.equal(resume.structuredContent.sourceText, resumeSource);
  assert.equal(resume.structuredContent.text, serializeResumeData(parseResumeFile(resumeSource).data), "the plain text RoleFit sends to Fit");
  assert.doesNotMatch(resume.structuredContent.text, /<\/?[a-z]+>/, "no inline markup");
  const missing = await call("get_resume", { fileName: "data.resume" });
  assert.equal(missing.isError, true);
  assert.match(missing.structuredContent.error, /No readable saved resume is named data\.resume/);
  assert.equal((await call("get_resume", {})).isError, true);
}

// list_cover_letters and get_cover_letter mirror the resume pair.
{
  assert.deepEqual((await call("list_cover_letters", {})).structuredContent, { coverLetters: [{ fileName: "default.cover", label: "Cover letter" }] });
  const cover = await call("get_cover_letter", { fileName: "default.cover" });
  assert.equal(cover.isError, false);
  assert.equal(cover.structuredContent.sourceText, coverSource);
  assert.equal(cover.structuredContent.text, coverLetterPlainText(parseCoverLetterFile(coverSource).data));
  assert.match((await call("get_cover_letter", { fileName: "other.cover" })).structuredContent.error, /No readable saved cover letter is named other\.cover\. List them with list_cover_letters/);
  const broken = await call("get_resume", { fileName: "broken.resume" });
  assert.equal(broken.isError, true, "an unreadable saved file is a tool error, not an internal one");
  assert.match(broken.structuredContent.error, /^broken\.resume could not be read: /);
}

// get_submission_package reads the saved documents and names what is missing.
{
  const full = await call("get_submission_package", { id: "a1" });
  assert.equal(full.isError, false, full.content[0].text);
  const pkg = full.structuredContent;
  assert.equal(pkg.application.resumeUsed, "tailored");
  assert.equal(pkg.jobDescription, "private text");
  assert.equal(pkg.resume.fileName, "Acme Resume.resume");
  assert.equal(pkg.resume.text, serializeResumeData(parseResumeFile(resumeSource).data));
  assert.equal(pkg.coverLetter.sourceText, coverSource);
  assert.deepEqual(pkg.applicationAnswers.map(({ answer }) => answer), ["Corrected answer about reliable APIs.", "Open to discussing."], "newest answer per question");
  assert.equal(pkg.fitAssessment.result.verdict, "REASONABLE");
  assert.deepEqual(pkg.missing, []);
  const sparse = (await call("get_submission_package", { id: "b2" })).structuredContent;
  assert.deepEqual(sparse.resume, { fileName: "resume.pdf", savedAt: "2026-10-01T00:00:00.000Z", pdfOnly: true });
  assert.equal(sparse.coverLetter, null);
  assert.deepEqual(sparse.missing, ["coverLetter", "fitAssessment", "jobDescription"]);
  const broken = await call("get_submission_package", { id: "c3" });
  assert.equal(broken.isError, true);
  assert.match(broken.structuredContent.error, /^The saved resume\.resume of application c3 could not be read/);
  assert.match((await call("get_submission_package", { id: "zz" })).structuredContent.error, /No application has id zz/);
  assert.equal((await call("get_submission_package", {})).isError, true);
}

// get_answers searches every record, newest answer per question first.
{
  const all = (await call("get_answers", {})).structuredContent;
  assert.equal(all.total, 3, "the superseded answer is not returned");
  assert.deepEqual(all.answers.map(({ answer }) => answer), ["I like reliable pipelines.", "Corrected answer about reliable APIs.", "Open to discussing."]);
  assert.deepEqual(all.answers[1].application, { id: "a1", title: "Backend Engineer at Acme", company: "Acme, Inc.", role: "Backend Engineer", status: "applied" });
  assert.equal(all.answers[1].status, "ready");
  assert.deepEqual((await call("get_answers", { query: "RELIABLE apis" })).structuredContent.answers.map(({ answer }) => answer), ["Corrected answer about reliable APIs."]);
  assert.equal((await call("get_answers", { query: "old answer" })).structuredContent.total, 0);
  assert.equal((await call("get_answers", { company: "globex corp" })).structuredContent.total, 1);
  assert.equal((await call("get_answers", { limit: 1 })).structuredContent.answers.length, 1);
}

// get_candidate_profile returns the Profile and only declared facts.
{
  const profile = (await call("get_candidate_profile", {})).structuredContent;
  assert.equal(profile.saved, true);
  assert.equal(profile.profileBackground, "Built payment APIs.");
  assert.match(profile.declaredFacts, /citizen/i);
  assert.doesNotMatch(profile.declaredFacts, /education|degree|sponsor/i, "unset facts claim nothing");
  preferences = { exists: false };
  assert.deepEqual((await call("get_candidate_profile", {})).structuredContent, { saved: false, profileBackground: "", declaredFacts: "" });
  preferences = { exists: false, newer: true };
  assert.match((await call("get_candidate_profile", {})).structuredContent.error, /newer version of RoleFit/);
}

// Unreachable server and the loopback-only base URL.
{
  const offline = createTools(base, async () => { throw new TypeError("fetch failed"); });
  const result = await handleMcpMessage({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "search_applications", arguments: {} } }, offline);
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /not reachable/);
  // A tracker saved by a newer RoleFit (D095): the agent gets the update instruction.
  const newerMessage = "applications.json was saved by a newer version of RoleFit. Update RoleFit to use it; this version leaves it unchanged.";
  const newer = createTools(base, async () => new Response(JSON.stringify({ error: newerMessage, code: "workspace-newer" }), { status: 423 }));
  const locked = await handleMcpMessage({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "search_applications", arguments: {} } }, newer);
  assert.equal(locked.result.isError, true);
  assert.match(locked.result.content[0].text, /newer version of RoleFit\. Update RoleFit/);
  const timedOut = createTools(base, async () => { throw new DOMException("timed out", "TimeoutError"); });
  const slow = await handleMcpMessage({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "search_applications", arguments: {} } }, timedOut);
  assert.match(slow.result.content[0].text, /did not answer within 60 seconds/);
  assert.equal(roleFitBaseUrl(), base);
  assert.equal(roleFitBaseUrl("http://localhost:6000/"), "http://localhost:6000");
  for (const bad of ["https://127.0.0.1:5181", "http://example.com:5181", "http://10.0.0.2:5181", "http://127.0.0.1:5181/api", "http://user@127.0.0.1:5181", "nope"]) {
    assert.throws(() => roleFitBaseUrl(bad), /ROLEFIT_URL/, bad);
  }
}

// A slow call never holds up the others; a cancelled call is aborted and gets
// no reply, and so is every open call when the client goes away.
{
  const seen = [];
  const slow = {
    name: "slow", title: "Slow", description: "Waits until its call is aborted.", inputSchema: { type: "object" },
    run: (_args, signal) => new Promise((resolve) => signal.addEventListener("abort", () => { seen.push("aborted"); resolve({ ok: true, value: {} }); }))
  };
  const input = new PassThrough();
  const output = new PassThrough();
  const replies = [];
  output.on("data", (chunk) => replies.push(...String(chunk).trim().split("\n").map((line) => JSON.parse(line))));
  const served = serveStdio([slow], input, output);
  const send = (message) => input.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  send({ id: 1, method: "tools/call", params: { name: "slow", arguments: {} } });
  send({ id: 2, method: "ping" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(replies.map(({ id }) => id), [2], "ping answers while the slow call runs");
  send({ method: "notifications/cancelled", params: { requestId: 1, reason: "user" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ["aborted"], "cancelling aborts the call");
  send({ id: 3, method: "tools/call", params: { name: "slow", arguments: {} } });
  await new Promise((resolve) => setImmediate(resolve));
  input.end();
  await served;
  assert.deepEqual(seen, ["aborted", "aborted"], "closing the input aborts every open call");
  assert.deepEqual(replies.map(({ id }) => id), [2], "aborted calls get no reply");
}

// A cancelled AI call closes its request and reports the cancellation, not an
// unreachable server.
{
  const controller = new AbortController();
  let reached;
  const aiRoute = new Promise((resolve) => { reached = resolve; });
  const tools = createTools(base, (url, init) => {
    if (new URL(url).pathname === "/api/workspace/preferences") return Promise.resolve(new Response(JSON.stringify({ exists: false })));
    reached();
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  });
  const pending = tools.find((tool) => tool.name === "analyze_job").run({ text: "A posting long enough to send to job analysis." }, controller.signal);
  await aiRoute;
  controller.abort();
  assert.deepEqual((await pending).value, { error: "Cancelled." });
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
  // Replies are matched by id, not order.
  const lines = new Map(run.stdout.trim().split("\n").map((line) => JSON.parse(line)).map((reply) => [reply.id ?? null, reply]));
  assert.deepEqual([...lines.keys()].sort(), [1, 2, null].sort());
  assert.equal(lines.get(null).error.code, -32700);
  const refused = spawnSync(process.execPath, [entry], { input: "", encoding: "utf8", env: { ...process.env, ROLEFIT_URL: "http://example.com" }, timeout: 20_000 });
  assert.equal(refused.status, 2);
  assert.equal(refused.stdout, "");
  assert.match(refused.stderr, /loopback/);
}

console.log("mcp probes passed");
