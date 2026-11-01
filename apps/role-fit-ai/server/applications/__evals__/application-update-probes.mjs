// Record-update route and first-submission resumeUsed probes (D103), in an
// isolated temporary workspace.
//
// Locked here: an update sets only the listed snapshot fields, stores each
// exactly as sent or refuses with field-named issues and writes nothing,
// advances updatedAt, and honours baseUpdatedAt; a submitted record can gain a
// document it never received, never replace one; resending a saved update is
// a no-op even with the old baseUpdatedAt; a Draft or job-only Skip gets
// documents and resumeUsed only with its first submission, which now accepts
// resumeUsed; a failed tracker write removes an attached file; and a tracker
// holding an unreadable record refuses the update.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { COVER_LETTER_STYLE_DEFAULTS, serializeCoverLetterFile } from "@typeset/engine/lib/coverLetter.ts";
import { APPLICATION_NOTES_MAX_LENGTH } from "../../../shared/applicationNotesContract.ts";
import { strictApplicationIssues } from "../schema.ts";
import { invalidateApplicationsSnapshot, readApplications as readCachedApplications } from "../storage.ts";
import { handleApplicationStatus, handleCommitApplication, handleUpdateApplication } from "../trackerRoutes.ts";
import { updateApplication } from "../updateService.ts";

const readApplications = (dir) => {
  invalidateApplicationsSnapshot();
  return readCachedApplications(dir);
};

const isolatedRoot = await mkdtemp(join(tmpdir(), "rolefit-app-update-"));
const workspaceDir = join(isolatedRoot, "workspace");

class FakeResponse {
  status = 0;
  chunk = "";
  writeHead(status) { this.status = status; }
  end(chunk = "") { this.chunk = chunk; }
  get json() { return JSON.parse(String(this.chunk)); }
}

const jsonRequest = (method, payload) => {
  const req = Readable.from([JSON.stringify(payload)]);
  req.method = method;
  return req;
};
async function commit(payload) {
  const res = new FakeResponse();
  await handleCommitApplication(jsonRequest("POST", payload), res, workspaceDir);
  return res;
}
// The per-record routes share one signature.
const recordRoute = (handler) => async (id, payload) => {
  const res = new FakeResponse();
  await handler(jsonRequest("POST", payload), res, id, workspaceDir);
  return res;
};
const changeStatus = recordRoute(handleApplicationStatus);
const update = recordRoute(handleUpdateApplication);
const trackerText = () => readFile(join(workspaceDir, "applications.json"), "utf8");
const stored = async (id) => (await readApplications(workspaceDir)).find((record) => record.id === id);

const resumeSource = await readFile(new URL("../../starter.resume", import.meta.url), "utf8");
const coverSource = serializeCoverLetterFile({
  header: { visible: true, name: "Synthetic Applicant", contact: ["applicant@example.test"] },
  sections: [{
    id: "cover", heading: "", type: "summary",
    items: [{ id: "body", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "paragraph", text: "Dear Hiring Team,\n\nSynthetic paragraph." }] }]
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
const job = (n) => ({ title: `Engineer ${n} at Co${n}`, company: `Co${n}`, role: `Engineer ${n}`, jobUrl: `https://co${n}.example.test/jobs/${n}` });

try {
  const applied = (await commit({ application: { ...job(1), status: "applied" }, documents: { resume: { sourceText: resumeSource } } })).json.application;
  const draft = (await commit({ application: { ...job(2), status: "draft" } })).json.application;
  const skipped = (await commit({ application: { ...job(3), status: "not_applying" } })).json.application;
  assert.ok(applied && draft && skipped, "fixtures committed");

  // A submitted record's snapshot fields are set exactly as sent.
  {
    const fields = { jobDescription: "Build Python APIs.", rawJobDescription: "We build Python APIs at scale.", notes: "Repaired.", fitAssessment, resumeUsed: "base" };
    const res = await update(applied.id, { fields, baseUpdatedAt: applied.updatedAt });
    assert.equal(res.status, 200, res.chunk);
    assert.equal(res.json.changed, true);
    const record = await stored(applied.id);
    for (const [key, value] of Object.entries(fields)) assert.deepEqual(record[key], value, `${key} is stored as sent`);
    assert.ok(record.updatedAt > applied.updatedAt, "updatedAt advances");
    assert.equal(record.appliedAt, applied.appliedAt, "dates are untouched");
    assert.deepEqual(record.stageHistory, applied.stageHistory, "history is untouched");
    assert.deepEqual(strictApplicationIssues(JSON.parse(JSON.stringify(record))).issues, [], "the record re-validates strictly");

    // A retry after a lost reply: same values, the old baseUpdatedAt, no write.
    const unchanged = await trackerText();
    const retried = await update(applied.id, { fields, baseUpdatedAt: applied.updatedAt });
    assert.equal(retried.status, 200, retried.chunk);
    assert.equal(retried.json.changed, false);
    assert.equal(await trackerText(), unchanged, "a repeated update writes nothing");

    const stale = await update(applied.id, { fields: { notes: "late" }, baseUpdatedAt: applied.updatedAt });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.application.id, applied.id, "a stale update returns the current record");
  }

  // Refusals name the field and write nothing.
  {
    const before = await trackerText();
    const cases = [
      [{ fields: { status: "offer" } }, /fields\.status: not updatable here/],
      [{ fields: { notes: null } }, /fields\.notes: send a value/],
      [{ fields: { jobDescription: "" } }, /fields\.jobDescription: send a value/],
      [{ fields: { resumeUsed: "mine" } }, /fields\.resumeUsed: must be base or tailored/],
      [{ fields: { notes: "x".repeat(APPLICATION_NOTES_MAX_LENGTH + 1) } }, /fields\.notes: longer than/],
      [{ fields: { fitAssessment: { resumeLabel: "x" } } }, /fields\.fitAssessment/],
      [{}, /send at least one field or document/],
      [{ fields: { notes: "x" }, extra: 1 }, /extra: not an update field/],
      [{ documents: { resume: { sourceText: "{}" } } }, /documents\.resume\.sourceText: not a valid \.resume document/]
    ];
    for (const [body, pattern] of cases) {
      const res = await update(applied.id, body);
      assert.equal(res.status, 400, `${JSON.stringify(body).slice(0, 60)}: ${res.chunk}`);
      assert.match(res.json.issues.join("\n"), pattern);
    }
    assert.equal((await update("missing", { fields: { notes: "x" } })).status, 404);
    assert.equal(await trackerText(), before, "no refusal wrote anything");
  }

  // A submitted record gains a document it never received, never a replacement.
  {
    const dir = join(workspaceDir, "applications", applied.id);
    const failing = { writeApplicationsSnapshot: async () => { throw new Error("disk full"); } };
    await assert.rejects(updateApplication(workspaceDir, applied.id, { documents: { cover: { sourceText: coverSource } } }, failing), /disk full/);
    assert.deepEqual((await readdir(dir)).sort(), ["resume.resume"], "a failed write removes the attached file");

    const attached = await update(applied.id, { documents: { cover: { sourceText: coverSource, fileName: "Co1 Cover.cover" } } });
    assert.equal(attached.status, 200, attached.chunk);
    const record = await stored(applied.id);
    assert.equal(record.coverLetterArtifacts.fileName, "Co1 Cover.cover");
    assert.equal(record.coverLetterArtifacts.savedAt, record.updatedAt);
    assert.equal(await readFile(join(dir, "cover.cover"), "utf8"), coverSource);

    const before = await trackerText();
    const repeated = await update(applied.id, { documents: { cover: { sourceText: coverSource } }, fields: { notes: "Repaired." } });
    assert.equal(repeated.json.changed, false, "resending the saved cover is a no-op, not a replacement");
    const otherCover = coverSource.replace("Synthetic paragraph.", "A different paragraph.");
    const again = await update(applied.id, { documents: { cover: { sourceText: otherCover } } });
    assert.equal(again.status, 400);
    assert.match(again.json.issues[0], /already has its cover; a saved document is never replaced/);
    assert.match((await update(applied.id, { documents: { resume: { sourceText: `${resumeSource}\n` } } })).json.issues[0], /already has its resume/);
    assert.equal(await trackerText(), before);
  }

  // A Draft or job-only Skip takes snapshot fields, but documents and
  // resumeUsed only with its first submission.
  {
    for (const record of [draft, skipped]) {
      assert.equal((await update(record.id, { fields: { jobDescription: "A recovered brief." } })).status, 200);
      assert.match((await update(record.id, { fields: { resumeUsed: "base" } })).json.issues[0], /only a submitted record has one/);
      assert.match((await update(record.id, { documents: { resume: { sourceText: resumeSource } } })).json.issues[0], /gets documents with its first submission/);
    }
    assert.equal((await stored(draft.id)).jobDescription, "A recovered brief.");
  }

  // The first submission accepts resumeUsed; no other move does.
  {
    const current = await stored(draft.id);
    assert.match((await changeStatus(draft.id, { status: "applied", documents: { resume: { sourceText: resumeSource } }, resumeUsed: "mine" })).json.error, /^resumeUsed: must be base or tailored/);
    const submitted = await changeStatus(draft.id, { status: "applied", documents: { resume: { sourceText: resumeSource } }, resumeUsed: "tailored", baseUpdatedAt: current.updatedAt });
    assert.equal(submitted.status, 200, submitted.chunk);
    assert.equal((await stored(draft.id)).resumeUsed, "tailored");
    const moved = await changeStatus(draft.id, { status: "interviewing", resumeUsed: "base" });
    assert.equal(moved.status, 400);
    assert.match(moved.json.error, /^resumeUsed: only a first submission/);
    assert.equal((await stored(draft.id)).status, "applied");
  }

  // A tracker holding an unreadable record refuses the update (D103).
  {
    const path = join(workspaceDir, "applications.json");
    const text = await trackerText();
    const file = JSON.parse(text);
    file.applications.push({ id: "broken", title: "Broken", status: "bogus" });
    await writeFile(path, JSON.stringify(file), "utf8");
    invalidateApplicationsSnapshot();
    const refused = await update(applied.id, { fields: { notes: "x" } });
    assert.equal(refused.status, 500);
    assert.match(refused.json.error, /Saving is paused/);
    assert.equal(JSON.parse(await trackerText()).applications.length, file.applications.length, "the unreadable record is untouched");
    await writeFile(path, text, "utf8");
  }

  console.log("application update probes passed");
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
