// Commit and status-route probes in an isolated temporary workspace.
//
// Locked here: a commit stores the record and its document sources together
// with every sent value intact; any value the tracker would drop, clip, or
// normalize refuses the whole commit with a path-named issue and writes
// nothing; a duplicate match refuses until its id is acknowledged; a dry run
// answers as the commit would and writes nothing; a Draft commit carries no
// dates or documents; a failed tracker write removes the document folder; the status
// route applies only the tracker row menu's moves and records the stage entry the
// tracker requires.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { COVER_LETTER_STYLE_DEFAULTS, serializeCoverLetterFile } from "@typeset/engine/lib/coverLetter.ts";
import { commitApplication } from "../commitService.ts";
import { strictApplicationIssues } from "../schema.ts";
import { invalidateApplicationsSnapshot, readApplications as readCachedApplications } from "../storage.ts";
import { handleAppendApplicationAnswers, handleApplicationStatus, handleCommitApplication, handleLogApplicationEvent } from "../trackerRoutes.ts";
import { withStatusChange } from "../../../src/lib/applicationStageHistory.ts";
import { toDateInput, toIso } from "../../../src/lib/dateInput.ts";
import { extractAnswerConstraints, validateAnswerConstraints } from "../../../shared/applicationAnswersContract.ts";

// Read back from disk, not the validated cache, to prove the round trip.
const readApplications = (dir) => {
  invalidateApplicationsSnapshot();
  return readCachedApplications(dir);
};

const isolatedRoot = await mkdtemp(join(tmpdir(), "rolefit-app-commit-"));
const workspaceDir = join(isolatedRoot, "workspace");

class FakeResponse {
  status = 0;
  chunk = "";
  writeHead(status) { this.status = status; }
  end(chunk = "") { this.chunk = chunk; }
  get json() { return JSON.parse(String(this.chunk)); }
}

function jsonRequest(method, payload) {
  const req = Readable.from([typeof payload === "string" ? payload : JSON.stringify(payload)]);
  req.method = method;
  return req;
}

async function commit(payload) {
  const res = new FakeResponse();
  await handleCommitApplication(jsonRequest("POST", payload), res, workspaceDir);
  return res;
}

async function changeStatus(id, payload, method = "POST") {
  const res = new FakeResponse();
  await handleApplicationStatus(jsonRequest(method, payload), res, id, workspaceDir);
  return res;
}

async function addAnswers(id, payload, method = "POST") {
  const res = new FakeResponse();
  await handleAppendApplicationAnswers(jsonRequest(method, payload), res, id, workspaceDir);
  return res;
}

async function logEvent(id, payload, method = "POST") {
  const res = new FakeResponse();
  await handleLogApplicationEvent(jsonRequest(method, payload), res, id, workspaceDir);
  return res;
}

const folders = async () => (await readdir(join(workspaceDir, "applications")).catch(() => [])).filter((name) => !name.startsWith("."));
const trackerText = () => readFile(join(workspaceDir, "applications.json"), "utf8").catch(() => null);

const resumeSource = await readFile(new URL("../../starter.resume", import.meta.url), "utf8");
const coverSource = serializeCoverLetterFile({
  header: { visible: true, name: "Synthetic Applicant", contact: ["applicant@example.test"] },
  sections: [{
    id: "cover",
    heading: "",
    type: "summary",
    items: [{
      id: "body",
      titleLeft: "",
      titleRight: "",
      subtitleLeft: "",
      subtitleRight: "",
      bullets: [{ id: "paragraph", text: "Dear Hiring Team,\n\nSynthetic cover letter paragraph." }]
    }]
  }]
}, COVER_LETTER_STYLE_DEFAULTS);

const fitAssessment = {
  resumeLabel: "Backend resume",
  assessedAt: "2026-10-20T09:30:00.000Z",
  provider: "codex-cli",
  model: "synthetic-model",
  reasoningEffort: "medium",
  attempts: 1,
  promptVersion: "fit-assessment-direct-rubric-v7",
  result: {
    status: "ASSESSED",
    verdict: "REASONABLE",
    summary: "Your background aligns well, with a few material gaps.",
    matches: [{ jobExcerpt: "Python APIs", candidateSource: "RESUME", candidateExcerpt: "Python APIs" }],
    gaps: ["Kubernetes"]
  }
};

const staleQuestion = "Why this team? Maximum 50 words.";
const staleReceipt = validateAnswerConstraints("I like reliable tools.", extractAnswerConstraints(staleQuestion));
const staleRevision = {
  id: "rev-stale", applicationId: "x", questionId: "q-stale", questionRevision: 1, question: staleQuestion,
  answer: "I like reliable tools.", constraints: extractAnswerConstraints(staleQuestion),
  counts: { ...staleReceipt.counts, words: staleReceipt.counts.words + 3 }, compliant: staleReceipt.compliant, status: "ready"
};

const application = {
  title: "Backend Engineer at Example Co",
  company: "Example Co",
  role: "Backend Engineer",
  source: "Company site",
  jobUrl: "https://example.test/jobs/1",
  jobDescription: "Build Python APIs.",
  status: "applied",
  notes: "Submitted through the careers page.",
  resumeUsed: "tailored",
  fitAssessment,
  applicationAnswers: [{ question: "Why this role?", answer: "I build reliable APIs." }]
};

try {
  // A valid commit stores everything it was sent, plus its documents.
  {
    const res = await commit({
      application,
      documents: { resume: { sourceText: resumeSource, fileName: "Applicant Resume.resume" }, cover: { sourceText: coverSource } }
    });
    assert.equal(res.status, 201, res.chunk);
    const { application: saved, revision } = res.json;
    assert.ok(revision);
    const [stored] = await readApplications(workspaceDir);
    assert.equal(stored.id, saved.id);
    assert.deepEqual(JSON.parse(JSON.stringify(stored.fitAssessment)), fitAssessment, "the Fit snapshot survives whole");
    assert.equal(stored.applicationAnswers[0].answer, "I build reliable APIs.");
    assert.ok(stored.applicationAnswers[0].savedAt, "a missing savedAt is stamped");
    assert.equal(stored.appliedAt, stored.createdAt, "appliedAt defaults to the commit time");
    assert.equal(stored.resumeArtifacts.hasSource, true);
    assert.equal(stored.resumeArtifacts.fileName, "Applicant Resume.resume");
    assert.ok(stored.resumeArtifacts.sourceFingerprint);
    assert.equal(stored.coverLetterArtifacts.fileName, "cover.cover");
    const dir = join(workspaceDir, "applications", saved.id);
    assert.equal(await readFile(join(dir, "resume.resume"), "utf8"), resumeSource);
    assert.equal(await readFile(join(dir, "cover.cover"), "utf8"), coverSource);
    assert.deepEqual(strictApplicationIssues(JSON.parse(JSON.stringify(stored))).issues, [], "a stored record re-validates strictly");
  }

  // A Skipped commit is a dated decision without documents.
  {
    const res = await commit({ application: { ...application, jobUrl: "https://example.test/jobs/2", status: "not_applying", notApplyingReasons: ["location"], resumeUsed: undefined } });
    assert.equal(res.status, 201, res.chunk);
    assert.equal(res.json.application.appliedAt, undefined);
    assert.ok(res.json.application.notApplyingAt);
    assert.deepEqual(res.json.application.notApplyingReasons, ["location"]);
  }
  {
    const res = await commit({ application: { ...application, jobUrl: "https://example.test/jobs/4", status: "not_applying", notApplyingReasons: ["fit", "location"], resumeUsed: undefined } });
    assert.equal(res.status, 201, res.chunk);
    assert.deepEqual(res.json.application.notApplyingReasons, ["location", "fit"], "reasons are stored in canonical order");
  }

  // Each refusal names its field and changes neither the tracker nor the folders.
  const refusals = [
    [{ application: { ...application, extra: true } }, "application.extra: dropped"],
    [{ application: { ...application, id: "chosen" } }, "application.id: set by the server"],
    [{ application: { ...application, stageHistory: [] } }, "application.stageHistory: set by the server"],
    [{ application: { ...application, status: "interviewing" } }, "application.status: must be applied or not_applying"],
    [{ application: { ...application, appliedAt: "2026-10-20" } }, "application.appliedAt: must be a canonical ISO timestamp"],
    [{ application: { ...application, title: "x".repeat(201) } }, "application.title: not stored as sent"],
    [{ application: { ...application, fitAssessment: { ...fitAssessment, result: { ...fitAssessment.result, verdict: "GREAT" } } } }, "application.fitAssessment: dropped"],
    [{ application: { ...application, fitAssessment: { ...fitAssessment, attempts: 40 } } }, "application.fitAssessment.attempts: not stored as sent"],
    [{ application: { ...application, source: "Newsletter" } }, "application.source: not stored as sent"],
    [{ application: { ...application, notes: "x".repeat(200_001) } }, "application.notes: longer than"],
    [{ application: { ...application, applicationAnswers: [{ question: "Q" }] } }, "application.applicationAnswers[0]: not a valid answer"],
    [{ application, documents: { resume: { sourceText: "{}" } } }, "documents.resume.sourceText: not a valid .resume document"],
    [{ application, documents: { resume: { sourceText: resumeSource, extra: 1 } } }, "documents.resume.extra: not a document field"],
    [{ application, documents: { portfolio: { sourceText: resumeSource } } }, "documents.portfolio: unknown document kind"],
    [{ application: { ...application, status: "not_applying", resumeUsed: undefined }, documents: { resume: { sourceText: resumeSource } } }, "documents: a Skipped commit cannot store application documents"],
    [{ application, extra: 1 }, "extra: not a commit field"],
    [{}, "application: required object"],
    [{ application: { ...application, location: null } }, "application.location: null is not a value here"],
    [{ application: { ...application, applicationAnswers: [{ question: "Q", answer: "A", savedAt: null }] } }, "application.applicationAnswers[0]: not a valid answer"],
    [{ application: { ...application, status: "not_applying", resumeUsed: undefined, notApplyingReasons: ["fit", "nope"] } }, "application.notApplyingReasons: not stored as sent"],
    [{ application, documents: { resume: { sourceText: resumeSource, fileName: "r".repeat(201) } } }, "documents.resume.fileName: must be a non-empty string of at most 200"],
    [{ application: { ...application, applicationAnswers: [{ question: "Q", answer: "A", savedAt: "yesterday" }] } }, "application.applicationAnswers[0].savedAt: must be a canonical ISO timestamp"],
    [{ application: JSON.parse(`{"title":"Proto","status":"applied","__proto__":{"x":1}}`) }, "application.__proto__: dropped"],
    [{ application: { ...application, applicationAnswers: [staleRevision] } }, "application.applicationAnswers[0]: its counts or limits do not match its text"],
    [{ application: { ...application, extra: true }, dryRun: true }, "application.extra: dropped"],
    [{ application, dryRun: "yes" }, "dryRun: must be true or false"],
    [{ application, acknowledgedDuplicates: [1] }, "acknowledgedDuplicates: must be a list"],
    [{ application, acknowledgedDuplicates: "a1" }, "acknowledgedDuplicates: must be a list"],
    [{ application, acknowledgedDuplicates: null }, "acknowledgedDuplicates: must be a list"],
    [{ application: { ...application, status: "draft", resumeUsed: undefined, appliedAt: "2026-10-01T12:00:00.000Z" } }, "application.appliedAt: a Draft has not been submitted"],
    [{ application: { ...application, status: "draft", resumeUsed: undefined, notApplyingAt: "2026-10-01T12:00:00.000Z" } }, "application.notApplyingAt: only a Skipped commit"],
    [{ application: { ...application, status: "draft", resumeUsed: undefined }, documents: { resume: { sourceText: resumeSource } } }, "documents: a Draft cannot store application documents"],
    [{ application: { ...application, status: "draft" } }, "application.status: a draft cannot carry"]
  ];
  const before = await trackerText();
  const beforeFolders = await folders();
  for (const [payload, expected] of refusals) {
    const res = await commit(payload);
    assert.equal(res.status, 400, `${expected}: ${res.chunk}`);
    assert.ok(res.json.issues.some((issue) => issue.startsWith(expected)), `${expected} not in ${JSON.stringify(res.json.issues)}`);
  }
  assert.equal(await trackerText(), before, "refusals leave the tracker untouched");
  assert.deepEqual(await folders(), beforeFolders, "refusals write no document folder");
  assert.equal((await commit("{not json")).status, 400);

  // A second record for a saved job is refused until each match is acknowledged.
  const first = (await readApplications(workspaceDir)).find((record) => record.jobUrl === application.jobUrl);
  {
    const res = await commit({ application, documents: { resume: { sourceText: resumeSource } } });
    assert.equal(res.status, 409, res.chunk);
    assert.match(res.json.issues[0], /^acknowledgedDuplicates: this job matches a saved record/);
    assert.deepEqual(res.json.duplicates.map(({ id, match }) => [id, match.confidence]), [[first.id, "exact"]]);
    assert.equal(res.json.duplicates[0].title, first.title);
    assert.equal(res.json.duplicates[0].jobDescription, undefined, "summaries only");
    const dryRun = await commit({ application, dryRun: true });
    assert.equal(dryRun.status, 409, "a dry run reports the duplicate the commit would refuse");
    assert.equal((await commit({ application, acknowledgedDuplicates: ["someone-else"] })).status, 409, "only the matching id acknowledges it");
    const acknowledged = await commit({ application, dryRun: true, acknowledgedDuplicates: [first.id], documents: { resume: { sourceText: resumeSource } } });
    assert.equal(acknowledged.status, 200, acknowledged.chunk);
    assert.deepEqual(acknowledged.json, { dryRun: true, valid: true });
    assert.equal(await trackerText(), before, "duplicate refusals and dry runs write nothing");
    assert.deepEqual(await folders(), beforeFolders, "nor any document folder");
  }

  // A Draft is an unsubmitted record: no dates, no documents, no stage history.
  {
    const draft = { ...application, title: "Platform Engineer at Draft Co", company: "Draft Co", role: "Platform Engineer", jobUrl: "https://draft.example.test/jobs/7", status: "draft", resumeUsed: undefined };
    const res = await commit({ application: draft });
    assert.equal(res.status, 201, res.chunk);
    const saved = res.json.application;
    assert.equal(saved.status, "draft");
    assert.equal(saved.appliedAt, undefined);
    assert.equal(saved.notApplyingAt, undefined);
    assert.equal(saved.stageHistory, undefined);
    assert.equal(saved.applicationAnswers[0].answer, "I build reliable APIs.", "a Draft keeps its answers");
    assert.equal((await commit({ application: draft })).status, 409, "the Draft guards its own job");
    const submitted = await changeStatus(saved.id, { status: "applied", baseUpdatedAt: saved.updatedAt });
    assert.equal(submitted.status, 200, submitted.chunk);
    assert.ok(submitted.json.application.appliedAt, "submitting the Draft dates it now");
  }

  // A failed tracker write removes the document folder it created.
  {
    const failing = { writeApplicationsSnapshot: async () => { throw new Error("disk full"); } };
    const before = await trackerText();
    const beforeFolders = await folders();
    const acknowledgedDuplicates = (await readApplications(workspaceDir)).map(({ id }) => id);
    await assert.rejects(commitApplication(workspaceDir, { application, acknowledgedDuplicates, documents: { resume: { sourceText: resumeSource } } }, failing), /disk full/);
    assert.equal(await trackerText(), before);
    assert.deepEqual(await folders(), beforeFolders, "no orphaned document folder");
  }

  // The status route moves a record as the row stage menu does, with history.
  const committed = await commit({ application: { ...application, jobUrl: "https://example.test/jobs/3", appliedAt: "2026-10-01T12:00:00.000Z" } });
  const applied = committed.json.application;
  {
    const stale = await changeStatus(applied.id, { status: "interviewing", baseUpdatedAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.application.id, applied.id, "a conflict returns the current record");
    assert.match((await changeStatus(applied.id, { status: "not_applying", date: "2026-10-22" })).json.error, /dated when it is saved/);
    assert.equal((await changeStatus(applied.id, { status: "interviewing", date: "2026-13-40" })).status, 400);
    assert.match((await changeStatus(applied.id, { status: "interviewing", date: "2026-02-30" })).json.error, /^date: must be a YYYY-MM-DD/, "an impossible day never rolls over");
    assert.equal((await changeStatus(applied.id, { status: "hired" })).status, 400);
    assert.match((await changeStatus(applied.id, { status: "rejected", at: "2026-10-02" })).json.error, /^at: not a status field/);
    assert.match((await changeStatus(applied.id, { status: "rejected", date: "2026-09-30" })).json.error, /between the application date and today/);
    assert.match((await changeStatus(applied.id, { status: "rejected", date: "2999-01-01" })).json.error, /between the application date and today/);
    assert.equal((await changeStatus("missing-id", { status: "rejected" })).status, 404);
    assert.equal((await changeStatus(applied.id, { status: "rejected" }, "PUT")).status, 405);

    const moved = await changeStatus(applied.id, { status: "interviewing", baseUpdatedAt: applied.updatedAt, date: "2026-10-22" });
    assert.equal(moved.status, 200, moved.chunk);
    assert.equal(moved.json.changed, true);
    const [stored] = (await readApplications(workspaceDir)).filter((record) => record.id === applied.id);
    assert.equal(stored.status, "interviewing");
    assert.ok(Date.parse(stored.updatedAt) > Date.parse(applied.updatedAt));
    assert.deepEqual(stored.stageHistory.map(({ type, status, at }) => ({ type, status, at })), [{ type: "stage", status: "interviewing", at: toIso("2026-10-22") }]);

    const same = await changeStatus(applied.id, { status: "interviewing" });
    assert.equal(same.json.changed, false);
    assert.equal(same.json.application.updatedAt, stored.updatedAt, "an unchanged stage writes nothing");

    assert.equal((await changeStatus(applied.id, { status: "rejected" })).status, 200);
    const ghosted = await changeStatus(applied.id, { status: "ghosted" });
    assert.equal(ghosted.status, 400, "a rejection is not waiting on a reply");
    assert.match(ghosted.json.error, /allowed: not_applying, applied, interviewing, offer, withdrawn/);
    assert.equal((await changeStatus(applied.id, { status: "applied" })).status, 200, "the row menu can reopen a rejection");
  }
  {
    const skipped = (await readApplications(workspaceDir)).find((record) => record.status === "not_applying" && !record.appliedAt);
    assert.match((await changeStatus(skipped.id, { status: "applied", date: "2026-10-22" })).json.error, /dated when it is saved/);
    const promoted = await changeStatus(skipped.id, { status: "applied" });
    assert.equal(promoted.status, 200, promoted.chunk);
    assert.ok(promoted.json.application.appliedAt, "applying to a skipped job dates the submission now");
    assert.equal(promoted.json.application.stageHistory, undefined);
  }

  // Later answers append as new revisions; saved ones never change.
  {
    const [target] = (await readApplications(workspaceDir)).filter((record) => record.id === applied.id);
    const savedAnswers = target.applicationAnswers;
    const res = await addAnswers(applied.id, { answers: [{ question: "Salary expectation?", answer: "Open to discussing." }], baseUpdatedAt: target.updatedAt });
    assert.equal(res.status, 200, res.chunk);
    assert.equal(res.json.added, 1);
    const [stored] = (await readApplications(workspaceDir)).filter((record) => record.id === applied.id);
    assert.deepEqual(stored.applicationAnswers.slice(0, savedAnswers.length), savedAnswers, "saved answers are untouched");
    assert.equal(stored.applicationAnswers.at(-1).question, "Salary expectation?");
    assert.ok(stored.applicationAnswers.at(-1).savedAt);
    assert.ok(Date.parse(stored.updatedAt) > Date.parse(target.updatedAt));
    assert.equal(stored.status, target.status, "adding answers changes nothing else");

    const before = await trackerText();
    const stale = await addAnswers(applied.id, { answers: [{ question: "Q", answer: "A" }], baseUpdatedAt: target.updatedAt });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.application.id, applied.id);
    const bad = await addAnswers(applied.id, { answers: [{ question: "Q", answer: "A" }, { question: "Missing answer" }] });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.json.issues, ["answers[1]: not a valid answer"]);
    const question = "Why this team? Maximum 50 words.";
    const answer = "I like reliable tools.";
    const constraints = extractAnswerConstraints(question);
    const receipt = validateAnswerConstraints(answer, constraints);
    const revision = {
      id: "rev-1", applicationId: "elsewhere", questionId: "q-1", questionRevision: 1, question, answer,
      constraints, counts: { ...receipt.counts, words: receipt.counts.words + 5 }, compliant: receipt.compliant, status: "ready"
    };
    const mismatched = await addAnswers(applied.id, { answers: [revision] });
    assert.equal(mismatched.status, 400, mismatched.chunk);
    assert.match(mismatched.json.issues[0], /^answers\[0\]: its counts or limits do not match its text/);
    assert.match((await addAnswers(applied.id, { answers: [], note: 1 })).json.issues[0], /^note: not an answers field/);
    assert.match((await addAnswers(applied.id, { answers: [] })).json.issues[0], /^answers: send 1 to 40/);
    assert.deepEqual((await addAnswers(applied.id, { answers: [{ question: "Q", answer: "A", savedAt: "yesterday" }] })).json.issues, ["answers[0].savedAt: must be a canonical ISO timestamp"]);
    const oversized = await addAnswers(applied.id, JSON.stringify({ answers: [{ question: "Q", answer: "x".repeat(2_100_000) }] }));
    assert.equal(oversized.status, 413);
    assert.match(oversized.json.error, /larger than the supported limit/);
    const tooMany = await addAnswers(applied.id, { answers: Array.from({ length: 40 }, (_, n) => ({ question: `Q${n}`, answer: "x".repeat(15_000) })) });
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.json.issues[0], /^answers: with the saved answers, this exceeds/);
    assert.equal((await addAnswers("missing-id", { answers: [{ question: "Q", answer: "A" }] })).status, 404);
    assert.equal((await addAnswers(applied.id, { answers: [{ question: "Q", answer: "A" }] }, "PUT")).status, 405);
    assert.equal(await trackerText(), before, "refusals write nothing");
    const fresh = await addAnswers(applied.id, { answers: [{ ...revision, counts: receipt.counts }] });
    assert.equal(fresh.status, 200, fresh.chunk);
    assert.equal(fresh.json.application.applicationAnswers.at(-1).applicationId, applied.id, "a full revision is stamped for its record");
    const skipped = (await readApplications(workspaceDir)).find((record) => record.status === "not_applying");
    assert.equal((await addAnswers(skipped.id, { answers: [{ question: "Why skip?", answer: "Location." }] })).status, 200, "a Skipped decision may keep answers");
  }

  // Timeline events go through the Log buttons' transform.
  {
    const [target] = (await readApplications(workspaceDir)).filter((record) => record.id === applied.id);
    assert.equal(target.status, "applied");
    const before = await trackerText();
    for (const [payload, expected] of [
      [{ type: "interview" }, /^kind: an interview needs one of/],
      [{ type: "response", kind: "technical" }, /^kind: only an interview has a kind/],
      [{ type: "offer" }, /^type: must be one of interview, response, followup/],
      [{ type: "followup", note: "  " }, /^note: must be non-blank text/],
      [{ type: "followup", date: "2026-02-30" }, /^date: must be a YYYY-MM-DD/],
      [{ type: "followup", at: "2026-10-01" }, /^at: not an event field/],
      [{ type: "followup", baseUpdatedAt: "2026-01-01T00:00:00.000Z" }, /changed since it was read/]
    ]) {
      const res = await logEvent(applied.id, payload);
      assert.ok(res.status === 400 || res.status === 409, res.chunk);
      assert.match(res.json.error, expected);
    }
    assert.equal((await logEvent(applied.id, { type: "followup", baseUpdatedAt: "2026-01-01T00:00:00.000Z" })).json.application.id, applied.id);
    assert.equal((await logEvent("missing-id", { type: "followup" })).status, 404);
    assert.equal((await logEvent(applied.id, { type: "followup" }, "PUT")).status, 405);
    const unsubmitted = (await readApplications(workspaceDir)).find((record) => !record.appliedAt);
    assert.match((await logEvent(unsubmitted.id, { type: "response" })).json.error, /no application date/);
    assert.equal(await trackerText(), before, "refusals write nothing");

    const interview = await logEvent(applied.id, { type: "interview", kind: "technical", date: "2099-01-15", note: "Panel with the platform team", baseUpdatedAt: target.updatedAt });
    assert.equal(interview.status, 200, interview.chunk);
    assert.equal(interview.json.statusChanged, true, "a new interview moves Applied to Interviewing");
    const [stored] = (await readApplications(workspaceDir)).filter((record) => record.id === applied.id);
    assert.equal(stored.status, "interviewing");
    const added = stored.stageHistory.slice(target.stageHistory.length);
    assert.deepEqual(added.map(({ type, kind, status, at, note }) => ({ type, kind, status, at, note })), [
      { type: "interview", kind: "technical", status: undefined, at: toIso("2099-01-15"), note: "Panel with the platform team" },
      { type: "stage", kind: undefined, status: "interviewing", at: added[1].at, note: undefined }
    ]);
    const response = await logEvent(applied.id, { type: "response" });
    assert.equal(response.json.statusChanged, false);
    assert.equal(response.json.entry.at, toIso(toDateInput(new Date().toISOString())), "the date defaults to today");
    assert.equal(response.json.application.stageHistory.at(-1).note, undefined);
  }

  // withStatusChange is the transform the tracker row's stage menu used inline.
  {
    const now = "2026-10-23T12:00:00.000Z";
    const draft = { id: "d", status: "draft", updatedAt: "2026-10-01T00:00:00.000Z" };
    assert.deepEqual(withStatusChange(draft, "applied", now), {
      ...draft, status: "applied", updatedAt: now, stageHistory: undefined, appliedAt: now,
      notApplyingAt: undefined, notApplyingReasons: undefined, notApplyingNote: undefined
    });
    const skip = withStatusChange({ ...draft, notApplyingReasons: ["fit"], notApplyingNote: "n" }, "not_applying", now);
    assert.equal(skip.notApplyingAt, now);
    assert.deepEqual(skip.notApplyingReasons, ["fit"]);
    assert.equal(skip.appliedAt, undefined);
    const submitted = { ...draft, status: "applied", appliedAt: "2026-10-02T00:00:00.000Z" };
    const ghosted = withStatusChange(submitted, "ghosted", now, "2026-10-23T12:00:00.000Z");
    assert.equal(ghosted.appliedAt, submitted.appliedAt);
    assert.deepEqual(ghosted.stageHistory.map(({ status, at }) => [status, at]), [["ghosted", "2026-10-23T12:00:00.000Z"]]);
  }

  // Corrupt tracker data stays fail-closed for both routes.
  {
    await writeFile(join(workspaceDir, "applications.json"), "{broken", "utf8");
    invalidateApplicationsSnapshot();
    assert.equal((await commit({ application })).status, 500);
    assert.equal((await changeStatus(applied.id, { status: "offer" })).status, 500);
    assert.equal(await trackerText(), "{broken");
  }
  console.log("application commit probes passed");
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
