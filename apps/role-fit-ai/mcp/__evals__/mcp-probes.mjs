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
// abandoned call is aborted without a reply. D103: update_application and a
// first submission's resumeUsed reach their routes, answers carry their origin,
// unreadable tracker records are named, and render_pdf writes the engine's PDF
// of the text as written, refusing to replace a file unasked.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { COVER_LETTER_STYLE_DEFAULTS, coverLetterPlainText, parseCoverLetterFile, serializeCoverLetterFile } from "@typeset/engine/lib/coverLetter.ts";
import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import { serializeResumeData } from "../../src/lib/resumeText.ts";

import { handleMcpMessage, serveStdio } from "../server.ts";
import { roleFitBaseUrl } from "../client.ts";
import { computeWorkspaceFingerprint } from "../../server/health-contract.ts";
import { createTools } from "../tools.ts";

const base = "http://127.0.0.1:5181";
const artifacts = (fileName, hasSource = true) => ({ hasPdf: !hasSource, hasSource, fileName, savedAt: "2026-10-01T00:00:00.000Z" });
const records = [
  {
    id: "a1", title: "Backend Engineer at Acme", company: "Acme, Inc.", role: "Backend Engineer", status: "applied",
    jobUrl: "https://boards.greenhouse.io/acme/jobs/4012345", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
    appliedAt: "2026-10-01T00:00:00.000Z", jobDescription: "private text", resumeUsed: "tailored",
    notes: "Form asks for a portfolio link.", salaryMin: 150000, salaryMax: 180000, salaryCurrency: "USD", salaryPeriod: "yr",
    resumeArtifacts: artifacts("Acme Resume.resume"), coverLetterArtifacts: artifacts("Acme Cover.cover"),
    fitAssessment: { resumeLabel: "Base resume", result: { status: "ASSESSED", verdict: "REASONABLE" } },
    applicationAnswers: [
      { question: "Why Acme?", answer: "Old answer.", savedAt: "2026-10-01T00:00:00.000Z", questionId: "q1" },
      {
        question: "Why Acme?", answer: "Corrected answer about reliable APIs.", savedAt: "2026-10-02T00:00:00.000Z", questionId: "q1", status: "ready",
        generation: { provider: "claude-cli", model: "opus", reasoningEffort: "high", createdAt: "2026-10-02T00:00:00.000Z", attempts: 1, promptVersion: "v1" }
      },
      { question: "Salary expectation?", answer: "Open to discussing.", savedAt: "2026-10-01T00:00:00.000Z" }
    ]
  },
  {
    id: "b2", title: "Data Analyst at Globex", company: "Globex", role: "Data Analyst", status: "rejected", jobUrl: "https://globex.example/jobs/9",
    createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z", resumeArtifacts: artifacts("resume.pdf", false),
    rawJobDescription: "Globex Data Analyst. Requisition ID: JR-90210. Build dashboards.",
    applicationAnswers: [{ question: "Why data?", answer: "I like reliable pipelines.", savedAt: "2026-10-05T00:00:00.000Z" }]
  },
  {
    id: "c3", title: "Broken at Initech", company: "Initech", role: "Engineer", status: "applied", createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z", resumeArtifacts: artifacts("resume.resume"),
    jobUrl: "https://initech.example/careers/engineer", sourceUrls: [{ url: "https://initech.wd5.myworkdayjobs.com/External/job/Remote/Engineer_JR-77777", addedAt: "2026-10-07T00:00:00.000Z" }]
  }
];
const resumeSource = await readFile(new URL("../../server/starter.resume", import.meta.url), "utf8");
const coverSource = serializeCoverLetterFile({
  header: { visible: true, name: "Synthetic Applicant", contact: ["applicant@example.test"] },
  sections: [{
    id: "cover", heading: "", type: "summary",
    items: [{ id: "body", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "paragraph", text: "Dear Hiring Team,\n\nSynthetic cover letter paragraph." }] }]
  }]
}, COVER_LETTER_STYLE_DEFAULTS);
let workspaceFingerprint = computeWorkspaceFingerprint("/nonexistent/rolefit-probe-workspace");
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
  if (path === "/api/applications/a1/update") return json(200, { application: { id: "a1" }, changed: true });
  if (path === "/api/applications/a1/documents/resume.resume") return new Response(resumeSource, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
  if (path === "/api/applications/a1/documents/cover.cover") return new Response(coverSource, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
  if (path === "/api/applications/c3/documents/resume.resume") return new Response("{broken", { status: 200, headers: { "Content-Type": "application/octet-stream" } });
  if (path === "/api/workspace/preferences") return json(200, preferences);
  if (path === "/api/health") return json(200, { service: "role-fit-ai", status: "ok", workspaceFingerprint });
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
    "search_applications", "get_application", "commit_application", "update_application_status", "update_application",
    "log_application_event", "add_application_answers", "list_resumes", "get_resume", "list_cover_letters", "get_cover_letter",
    "get_submission_package", "get_answers", "get_candidate_profile", "analyze_job", "assess_fit", "polish_resume",
    "apply_resume_edits", "polish_cover_letter", "draft_answer", "review_application", "render_pdf"
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
  for (const name of ["commit_application", "update_application_status"]) {
    const tool = listed.find((item) => item.name === name);
    assert.deepEqual(tool.inputSchema.properties.resumeNotRequested.const, true, `${name} takes the cover-only attestation (D105)`);
    assert.match(tool.description, /resumeNotRequested: true with/);
  }
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
  const byRequisition = async (requisitionId) => (await call("search_applications", { requisitionId })).structuredContent.applications.map(({ id }) => id);
  assert.deepEqual(await byRequisition("jr 90210"), ["b2"], "the id printed in the posting, punctuation and case ignored");
  assert.deepEqual(await byRequisition("4012345"), ["a1"], "the job id in an ATS URL");
  assert.deepEqual(await byRequisition("JR-77777"), ["c3"], "or in any source URL, as the duplicate matcher reads them");
  assert.deepEqual(await byRequisition("JR-9021"), [], "an exact id, not a prefix");
  assert.match((await rpc("tools/list", {})).result.tools.find((tool) => tool.name === "search_applications").description, /"General Motors" does not find "GM"/);
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
  await call("update_application_status", { id: "a1", status: "applied", documents, resumeUsed: "tailored" });
  assert.deepEqual(calls[0].body, { status: "applied", documents, resumeUsed: "tailored" }, "a first submission's resumeUsed reaches the route");

  calls.length = 0;
  const fields = { jobDescription: "A brief", fitAssessment: { result: { status: "ASSESSED" }, resumeLabel: "Base" }, resumeUsed: "base" };
  const updated = await call("update_application", { id: "a1", fields, documents: { cover: { sourceText: coverSource } }, baseUpdatedAt: "2026-10-01T00:00:00.000Z" });
  assert.equal(updated.isError, false);
  assert.equal(calls[0].url, `${base}/api/applications/a1/update`);
  assert.deepEqual(calls[0].body, { fields, documents: { cover: { sourceText: coverSource } }, baseUpdatedAt: "2026-10-01T00:00:00.000Z" }, "sent through unchanged");
  assert.equal((await call("update_application", { fields })).isError, true, "an id is required");

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
  assert.equal(pkg.notes, "Form asks for a portfolio link.");
  assert.deepEqual([pkg.application.salaryMin, pkg.application.salaryMax, pkg.application.salaryCurrency, pkg.application.salaryPeriod], [150000, 180000, "USD", "yr"]);
  assert.equal(pkg.resume.fileName, "Acme Resume.resume");
  assert.equal(pkg.resume.text, serializeResumeData(parseResumeFile(resumeSource).data));
  assert.equal(pkg.coverLetter.sourceText, coverSource);
  assert.deepEqual(pkg.applicationAnswers.map(({ answer }) => answer), ["Corrected answer about reliable APIs.", "Open to discussing."], "newest answer per question");
  assert.equal(pkg.fitAssessment.result.verdict, "REASONABLE");
  assert.deepEqual(pkg.missing, []);
  const sparse = (await call("get_submission_package", { id: "b2" })).structuredContent;
  assert.deepEqual(sparse.resume, { fileName: "resume.pdf", savedAt: "2026-10-01T00:00:00.000Z", pdfOnly: true });
  assert.equal(sparse.coverLetter, null);
  assert.equal(sparse.notes, "", "a record without notes reads as empty, never missing");
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
  assert.deepEqual(all.answers[1].application, {
    id: "a1", title: "Backend Engineer at Acme", company: "Acme, Inc.", role: "Backend Engineer", status: "applied", appliedAt: "2026-10-01T00:00:00.000Z"
  });
  assert.equal(all.answers[1].status, "ready");
  assert.equal(all.answers[1].questionId, "q1");
  assert.equal(all.answers[1].origin, "ai-draft");
  assert.deepEqual(all.answers[1].drafted, { provider: "claude-cli", model: "opus", reasoningEffort: "high", at: "2026-10-02T00:00:00.000Z" });
  assert.equal(all.answers[0].origin, "saved-text", "an answer without a generation is the user's or a plain saved pair");
  assert.equal(all.answers[0].drafted, undefined);
  assert.deepEqual((await call("get_answers", { query: "RELIABLE apis" })).structuredContent.answers.map(({ answer }) => answer), ["Corrected answer about reliable APIs."]);
  assert.equal((await call("get_answers", { query: "old answer" })).structuredContent.total, 0);
  assert.equal((await call("get_answers", { company: "globex corp" })).structuredContent.total, 1);
  assert.equal((await call("get_answers", { limit: 1 })).structuredContent.answers.length, 1);
}

// A plain-pair correction and a full revision of the same question collapse to the later one, either way round;
// two revisions with different questionIds stay two questions even when their text matches.
{
  const revision = (id, questionId, question, answer, savedAt) => ({ id, applicationId: "m1", questionId, questionRevision: 1, question, answer, savedAt, status: "ready" });
  const mixed = {
    id: "m1", title: "Eng at Acme", company: "Acme", role: "Eng", status: "applied", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z",
    applicationAnswers: [
      revision("rev1", "qa", "Why Acme?", "Old Acme answer.", "2026-10-01T00:00:00.000Z"),
      { question: "why acme? ", answer: "Corrected Acme answer.", savedAt: "2026-10-02T00:00:00.000Z" },
      { question: "Why now?", answer: "Old timing answer.", savedAt: "2026-10-01T00:00:00.000Z" },
      revision("rev2", "qn", "Why now?", "Revised timing answer.", "2026-10-03T00:00:00.000Z"),
      revision("rev3", "qx", "Describe a project.", "First project.", "2026-10-01T00:00:00.000Z"),
      revision("rev4", "qy", "Describe a project.", "Second project.", "2026-10-02T00:00:00.000Z")
    ]
  };
  const mixedTools = createTools(base, async () => new Response(JSON.stringify({ applications: [mixed], revision: "r1" }), { status: 200, headers: { "Content-Type": "application/json" } }));
  const run = (name, args) => mixedTools.find((tool) => tool.name === name).run(args);
  const pkg = (await run("get_submission_package", { id: "m1" })).value;
  assert.deepEqual(pkg.applicationAnswers.map(({ answer }) => answer), ["Corrected Acme answer.", "Revised timing answer.", "First project.", "Second project."], "the later of a pair and a revision wins");
  assert.equal(pkg.applicationAnswers[0].status, undefined, "the superseded ready revision's status does not leak onto the correction");
  const found = (await run("get_answers", { query: "acme" })).value;
  assert.deepEqual(found.answers.map(({ answer }) => answer), ["Corrected Acme answer."]);
}

// Records the tracker cannot read safely are named, never silently missing.
{
  const invalidRecords = [{ index: 1, id: "bad1", title: "Broken at Hooli", issues: ["status: dropped (not a stored field or not a valid value)"] }];
  const flagged = createTools(base, async (url) => new URL(url).pathname === "/api/applications"
    ? new Response(JSON.stringify({ applications: [records[0]], revision: "r1", invalidRecords }), { status: 200 })
    : new Response("{}", { status: 404 }));
  const run = (name, args) => flagged.find((tool) => tool.name === name).run(args);
  const searched = await run("search_applications", {});
  assert.deepEqual(searched.value.invalidRecords, invalidRecords, "search names the unreadable records");
  assert.equal(searched.value.total, 1);
  const unreadable = await run("get_application", { id: "bad1" });
  assert.equal(unreadable.ok, false);
  assert.match(unreadable.value.error, /cannot read it safely/);
  assert.deepEqual(unreadable.value.issues, invalidRecords[0].issues);
  assert.equal((await run("get_answers", {})).value.invalidRecordsSkipped, 1);
  assert.equal((await call("search_applications", {})).structuredContent.invalidRecords, undefined, "absent when every record reads");
}

// render_pdf: the engine's own PDF, fonts from RoleFit's /fonts, written only where asked.
{
  const engineFonts = new URL("../../../../packages/engine/fonts/", import.meta.url);
  const realFetch = globalThis.fetch;
  const fontRequests = [];
  globalThis.fetch = async (url, init) => {
    const { pathname } = new URL(url);
    if (pathname.startsWith("/fonts/")) {
      fontRequests.push(url);
      return new Response(await readFile(new URL(pathname.slice("/fonts/".length), engineFonts)));
    }
    return realFetch(url, init);
  };
  const dir = await mkdtemp(join(tmpdir(), "rolefit-mcp-pdf-"));
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdfText = async (path) => {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await readFile(path)), useWorkerFetch: false, isEvalSupported: false }).promise;
      let text = "";
      for (let page = 1; page <= doc.numPages; page += 1) text += (await (await doc.getPage(page)).getTextContent()).items.map((item) => item.str).join(" ");
      return { pages: doc.numPages, text };
    };
    const resumePath = join(dir, "Resume.pdf");
    const rendered = await call("render_pdf", { kind: "resume", sourceText: resumeSource, outputPath: resumePath });
    assert.equal(rendered.isError, false, rendered.content[0].text);
    assert.equal(rendered.structuredContent.path, resumePath);
    assert.ok(fontRequests.length > 0 && fontRequests.every((url) => url.startsWith(`${base}/fonts/`)), "fonts come from the running RoleFit");
    const resumePdf = await pdfText(resumePath);
    assert.equal(rendered.structuredContent.pages, resumePdf.pages, "the page count is the PDF's");
    assert.ok(resumePdf.text.includes(parseResumeFile(resumeSource).data.header.name.replace(/<[^>]+>/g, "")), "the resume text is in the PDF");

    const again = await call("render_pdf", { kind: "resume", sourceText: resumeSource, outputPath: resumePath });
    assert.equal(again.isError, true);
    assert.match(again.structuredContent.error, /already there/, "an existing file is never replaced unasked");
    assert.equal((await call("render_pdf", { kind: "resume", sourceText: resumeSource, outputPath: resumePath, overwrite: true })).isError, false);

    // A letter that already ends with its sign-off renders it exactly once.
    const signed = serializeCoverLetterFile({
      header: { visible: true, name: "Synthetic Applicant", contact: ["applicant@example.test"] },
      sections: [{
        id: "cover", heading: "", type: "summary",
        items: [{ id: "body", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "paragraph", text: "Dear Hiring Team,\n\nSynthetic cover letter paragraph.\n\nSincerely,\nSynthetic Applicant" }] }]
      }]
    }, COVER_LETTER_STYLE_DEFAULTS);
    const coverPath = join(dir, "Cover.pdf");
    const cover = await call("render_pdf", { kind: "cover", sourceText: signed, outputPath: coverPath, title: "Cover" });
    assert.equal(cover.isError, false, cover.content[0].text);
    const coverPdf = await pdfText(coverPath);
    assert.equal(coverPdf.pages, 1);
    assert.equal(coverPdf.text.match(/Sincerely/g)?.length, 1, "nothing is appended to the letter");

    const saved = await call("render_pdf", { kind: "cover", applicationId: "a1", outputPath: join(dir, "Saved.pdf") });
    assert.equal(saved.isError, false, "a record's saved document renders");
    assert.equal((await call("render_pdf", { kind: "resume", fileName: "default.resume", outputPath: join(dir, "Base.pdf") })).isError, false);
    assert.match((await call("render_pdf", { kind: "resume", applicationId: "b2", outputPath: join(dir, "x.pdf") })).structuredContent.error, /PDF only/);
    assert.match((await call("render_pdf", { kind: "cover", applicationId: "b2", outputPath: join(dir, "x.pdf") })).structuredContent.error, /no saved cover/);
    assert.match((await call("render_pdf", { kind: "resume", sourceText: "{broken", outputPath: join(dir, "x.pdf") })).structuredContent.error, /could not be read/);
    assert.match((await call("render_pdf", { kind: "resume", sourceText: resumeSource, outputPath: "Resume.pdf" })).structuredContent.error, /absolute path/);
    assert.match((await call("render_pdf", { kind: "resume", sourceText: resumeSource, outputPath: join(dir, "Resume.txt") })).structuredContent.error, /ending in \.pdf/);
    assert.match((await call("render_pdf", { kind: "resume", sourceText: resumeSource, fileName: "default.resume", outputPath: join(dir, "x.pdf") })).structuredContent.error, /exactly one/);
    assert.match((await call("render_pdf", { kind: "resume", sourceText: resumeSource, outputPath: join(dir, "missing", "x.pdf") })).structuredContent.error, /folder does not exist/);

    // Never inside RoleFit's workspace (named by fingerprint), even through a
    // symlinked folder, and never through a symlinked file.
    const workspace = join(dir, "workspace");
    await mkdir(join(workspace, "applications", "a1"), { recursive: true });
    await symlink(join(workspace, "applications"), join(dir, "linked"));
    await symlink(join(workspace, "applications", "a1", "resume.pdf"), join(dir, "Linked.pdf"));
    const realFingerprint = workspaceFingerprint;
    workspaceFingerprint = computeWorkspaceFingerprint(workspace);
    try {
      for (const outputPath of [join(workspace, "applications", "a1", "resume.pdf"), join(dir, "linked", "a1", "resume.pdf")]) {
        const inside = await call("render_pdf", { kind: "resume", sourceText: resumeSource, outputPath, overwrite: true });
        assert.match(inside.structuredContent.error, /inside RoleFit's workspace/, outputPath);
      }
      assert.match((await call("render_pdf", { kind: "resume", sourceText: resumeSource, outputPath: join(dir, "Linked.pdf"), overwrite: true })).structuredContent.error, /symbolic link/);
      await assert.rejects(readFile(join(workspace, "applications", "a1", "resume.pdf")), /ENOENT/, "nothing was written into the workspace");
      assert.equal((await call("render_pdf", { kind: "resume", sourceText: resumeSource, outputPath: join(dir, "Outside.pdf") })).isError, false, "a sibling folder is outside");
    } finally {
      workspaceFingerprint = realFingerprint;
    }
    // A workspace whose configured path differs (reached through a symlink)
    // is still recognized by its tracker file.
    await writeFile(join(workspace, "applications.json"), "{}");
    const viaLink = await call("render_pdf", { kind: "resume", sourceText: resumeSource, outputPath: join(dir, "linked", "a1", "resume.pdf"), overwrite: true });
    assert.match(viaLink.structuredContent.error, /inside RoleFit's workspace/, "a folder holding a tracker file is a workspace");
    // An overwrite replaces the name, never the content of a hard-linked file.
    await mkdir(join(dir, "kept"));
    await writeFile(join(dir, "kept", "saved.pdf"), "saved bytes");
    await link(join(dir, "kept", "saved.pdf"), join(dir, "Hardlink.pdf"));
    assert.equal((await call("render_pdf", { kind: "resume", sourceText: resumeSource, outputPath: join(dir, "Hardlink.pdf"), overwrite: true })).isError, false);
    assert.equal(await readFile(join(dir, "kept", "saved.pdf"), "utf8"), "saved bytes", "the other name keeps its bytes");
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
    const offline = await call("render_pdf", { kind: "resume", sourceText: resumeSource, outputPath: join(dir, "Offline.pdf") });
    assert.match(offline.structuredContent.error, /fonts could not be loaded/);
    await assert.rejects(readFile(join(dir, "Offline.pdf")), /ENOENT/, "no file is written without fonts");
  } finally {
    globalThis.fetch = realFetch;
    await rm(dir, { recursive: true, force: true });
  }
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
