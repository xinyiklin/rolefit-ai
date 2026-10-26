// MCP AI-stage tools against a fake RoleFit server that inspects each request.
//
// Locked here: every tool sends the request its browser stage sends (the
// stage's saved provider, model and effort; the Profile and declared facts;
// the stage's own instructions; Polish's bold-keyword and review switches),
// saves nothing, and returns the app's result: analyze_job's brief with a
// local fallback, assess_fit's commit-ready snapshot, polish_resume's
// suggestions applied by apply_resume_edits, polish_cover_letter's needs-input
// stop and applied .cover, draft_answer's checked revision, and
// review_application over the record's saved documents. The browser's other
// signals reach the agent: concern notices carried between stages, the
// review outcome, Fit-gap statements, dropped job terms, and its response
// checks. An over-limit Profile stops the stages that read it, and unreadable
// settings every stage, before any provider call.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  COVER_LETTER_STYLE_DEFAULTS,
  coverLetterPlainText,
  parseCoverLetterFile,
  serializeCoverLetterFile
} from "@typeset/engine/lib/coverLetter.ts";
import { coerceDocStyle } from "@typeset/engine/lib/documentStyle.ts";
import { parseResumeFile, serializeResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import { PROFILE_BACKGROUND_CHAR_LIMIT } from "../../shared/candidateProfileContract.ts";
import { flattenResumeTargets } from "../../shared/resumePolishContract.ts";
import { buildStageRequestFields } from "../../src/lib/aiRequest.ts";
import { serializeResumeData } from "../../src/lib/resumeText.ts";
import {
  COVER_ACCEPTED_CONCERNS_WARNING,
  RESUME_POLISH_RESULT_WARNING,
  RESUME_POLISH_SOURCE_WARNING,
  RESUME_SOURCE_WARNING
} from "../../src/lib/sourceConcernNotices.ts";
import { seedStage } from "../../src/lib/stageSettings.ts";
import { createTools } from "../tools.ts";

const base = "http://127.0.0.1:5181";
const resumeSource = await readFile(new URL("../../server/starter.resume", import.meta.url), "utf8");
const resumeText = serializeResumeData(parseResumeFile(resumeSource).data);
const coverSource = serializeCoverLetterFile({
  header: { visible: true, name: "Synthetic Applicant", contact: ["applicant@example.test"] },
  sections: [{
    id: "cover", heading: "", type: "summary",
    items: [{ id: "body", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "p", text: "Dear Hiring Team,\n\nI build reliable services.\n\nSincerely,\nSynthetic Applicant" }] }]
  }]
}, COVER_LETTER_STYLE_DEFAULTS);
const brief = "Responsibilities: Build Python APIs and data pipelines. Requirements: three years of backend experience.";
const posting = `Acme is hiring a Backend Engineer. ${brief} Apply today.`;
const fitResult = {
  status: "ASSESSED",
  verdict: "REASONABLE",
  summary: "Your background aligns well, with a few material gaps.",
  matches: [{ jobExcerpt: "Build Python APIs and data pipelines", candidateSource: "RESUME", candidateExcerpt: "Python" }],
  gaps: ["three years of backend experience"]
};
let settings;
const resetSettings = () => {
  settings = {
    profileBackground: "Built payment APIs at a startup.",
    citizenshipStatus: "us-citizen",
    customInstructions: "Shared guidance.",
    stageCustomInstructions: { "resume-polish": "Polish guidance." },
    resumePolishProvider: "anthropic",
    resumePolishSelectedModel: "claude-opus-5-5",
    applicationReviewProvider: "openai"
  };
};
resetSettings();
const records = [{
  id: "a1", title: "Backend Engineer at Acme", company: "Acme", role: "Backend Engineer", status: "draft",
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
  jobDescription: brief, rawJobDescription: posting,
  resumeArtifacts: { hasPdf: false, hasSource: true, fileName: "resume.resume", savedAt: "2026-10-01T00:00:00.000Z" },
  coverLetterArtifacts: { hasPdf: false, hasSource: true, fileName: "cover.cover", savedAt: "2026-10-01T00:00:00.000Z" }
}, {
  id: "b2", title: "No brief", company: "Globex", role: "Analyst", status: "draft",
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z"
}];

const calls = [];
let reply = {};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function fakeFetch(url, init = {}) {
  const path = new URL(url).pathname;
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ path, body });
  if (path === "/api/workspace/preferences") return reply.preferences?.() ?? json(200, { exists: true, settings });
  if (path === "/api/applications") return json(200, { applications: records });
  if (path === "/api/applications/a1/documents/resume.resume") return new Response(resumeSource, { status: 200 });
  if (path === "/api/applications/a1/documents/cover.cover") return new Response(coverSource, { status: 200 });
  if (path === "/api/workspace/base-resume/candidates") {
    return json(200, { candidates: body.fileNames[0] === "default.resume" ? [{ fileName: "default.resume", label: "Base resume", text: resumeSource }] : [] });
  }
  if (path === "/api/workspace/cover-letter/candidates") {
    return json(200, { candidates: body.fileNames[0] === "default.cover" ? [{ fileName: "default.cover", label: "Default", text: coverSource }] : [] });
  }
  const handler = reply[path];
  return handler ? handler(body) : json(404, { error: "API route not found." });
}
const tools = Object.fromEntries(createTools(base, fakeFetch).map((tool) => [tool.name, tool]));
const call = (name, args) => tools[name].run(args);
const stageFields = (stage) => buildStageRequestFields(seedStage(stage, settings));
const aiCalls = () => calls.filter(({ path }) => !["/api/workspace/preferences", "/api/applications"].includes(path) && !path.includes("/documents/") && !path.endsWith("/candidates"));

// analyze_job: the brief from AI fields, the local extractor on failure.
{
  reply["/api/job-analysis"] = () => json(200, {
    source: "ai", title: "Backend Engineer", company: "Acme", location: "Remote", jobType: "", workAuth: "",
    salaryMin: null, salaryMax: null, salaryCurrency: "", salaryPeriod: "", roleDescription: "Builds APIs.",
    responsibilities: ["Build Python APIs and data pipelines"], requiredQualifications: ["Three years of backend experience"],
    preferredQualifications: [], techKeywords: ["Python"], senioritySignals: [], domainSignals: []
  });
  calls.length = 0;
  const analyzed = await call("analyze_job", { text: posting, url: "https://acme.example/jobs/1" });
  assert.equal(analyzed.ok, true, JSON.stringify(analyzed.value));
  const sent = aiCalls()[0].body;
  assert.deepEqual(sent, { text: posting, url: "https://acme.example/jobs/1", ...stageFields("job-analysis") }, "the browser's analysis request");
  assert.equal(analyzed.value.source, "ai");
  assert.match(analyzed.value.jobDescription, /Build Python APIs and data pipelines/);
  assert.equal(analyzed.value.rawJobDescription, posting);
  assert.equal(analyzed.value.tracking.company, "Acme");

  reply["/api/job-analysis"] = () => json(502, { error: "The provider is unavailable." });
  const fallback = (await call("analyze_job", { text: posting })).value;
  assert.equal(fallback.source, "local");
  assert.equal(fallback.aiError, "The provider is unavailable.");
  assert.ok(fallback.jobDescription.length > 0, "the local brief still comes back");
  calls.length = 0;
  assert.equal((await call("analyze_job", { text: "Too short." })).value.source, "local");
  assert.equal(aiCalls().length, 0, "a posting under 40 characters makes no provider call");
}

// assess_fit: the Fit request and a snapshot commit_application accepts.
{
  reply["/api/job-analysis"] = () => json(200, { fitAssessment: fitResult, provider: "anthropic", model: "claude-opus-5-5", reasoningEffort: "high", attempts: 14 });
  calls.length = 0;
  const assessed = await call("assess_fit", { jobText: posting, resume: { fileName: "default.resume" } });
  assert.equal(assessed.ok, true, JSON.stringify(assessed.value));
  const sent = aiCalls()[0].body;
  assert.equal(sent.mode, "fit-assessment");
  assert.equal(sent.text, posting);
  assert.equal(sent.resumeText, resumeText, "the plain resume text the app sends");
  assert.match(sent.candidateContext, /Built payment APIs at a startup\./);
  assert.match(sent.candidateContext, /citizen/i);
  assert.deepEqual({ provider: sent.provider, model: sent.model, reasoningEffort: sent.reasoningEffort }, stageFields("fit-assessment"));
  const { fitAssessment } = assessed.value;
  assert.deepEqual(fitAssessment.result, fitResult);
  assert.equal(fitAssessment.resumeLabel, "Base resume");
  assert.equal(fitAssessment.attempts, 9, "attempts are clamped to the tracker's range");
  assert.equal(fitAssessment.promptVersion, "fit-assessment-direct-rubric-v7");
  assert.ok(Date.parse(fitAssessment.assessedAt));
  reply["/api/job-analysis"] = () => json(200, { fitAssessment: { status: "NOPE" }, fitAssessmentError: "Fit Assessment returned unreadable JSON" });
  assert.match((await call("assess_fit", { jobText: posting, resume: { sourceText: resumeSource } })).value.error, /unreadable JSON/);
  assert.match((await call("assess_fit", { jobText: posting, resume: { fileName: "default.resume", sourceText: resumeSource } })).value.error, /exactly one of fileName and sourceText/);
}

// polish_resume and apply_resume_edits.
{
  let rewritten;
  reply["/api/resume-polish"] = (body) => {
    rewritten = flattenResumeTargets(body.resumeScope, body.candidateContext).find((target) => target.target.field === "bullet" && target.currentText);
    return json(200, {
      status: "PROPOSAL",
      changes: [{ targetId: rewritten.targetId, target: { sectionId: rewritten.target.sectionId, entryId: rewritten.target.entryId, bulletId: rewritten.target.bulletId }, replacement: "Rewritten grounded bullet.", reason: "Leads with the job's API work.", warnings: ["Check the number."] }],
      summary: [], omittedTargetCount: 0, withheld: { count: 0, reasons: [] }
    });
  };
  calls.length = 0;
  const fitSnapshot = { result: fitResult, resumeLabel: "Base resume" };
  const polished = await call("polish_resume", { resume: { fileName: "default.resume" }, jobDescription: brief, fitAssessment: fitSnapshot });
  assert.equal(polished.ok, true, JSON.stringify(polished.value));
  const sent = aiCalls()[0].body;
  assert.equal(sent.mode, "resume-proposal");
  assert.equal(sent.jobText, brief, "Polish reads the brief, not the posting");
  assert.equal(sent.customInstructions, "Polish guidance.", "the stage's own guidance wins");
  assert.equal(sent.boldBulletKeywords, true);
  assert.equal(sent.reviewEdits, undefined, "the review switch is off by default");
  assert.equal(sent.fitFindings.earlierVersion, true, "a snapshot is labelled an earlier assessment");
  assert.deepEqual({ provider: sent.provider, model: sent.model, reasoningEffort: sent.reasoningEffort }, stageFields("resume-polish"));
  assert.equal(sent.provider, "anthropic", "the saved provider, not the default");
  const [suggestion] = polished.value.suggestions;
  assert.equal(suggestion.kind, "rewrite");
  assert.equal(suggestion.proposedText, "Rewritten grounded bullet.");
  assert.deepEqual(suggestion.warnings, ["Check the number."]);

  const applied = await call("apply_resume_edits", { proposalId: polished.value.proposalId, accept: [suggestion.id] });
  assert.equal(applied.ok, true, JSON.stringify(applied.value));
  // Element ids are per parse, so compare by text.
  const data = parseResumeFile(applied.value.sourceText).data;
  const before = resumeText.split("\n");
  const after = serializeResumeData(data).split("\n");
  assert.equal(after.length, before.length);
  assert.deepEqual(after.filter((line, index) => line !== before[index]).map((line) => line.replace(/^\W+/, "")), ["Rewritten grounded bullet."], "exactly the accepted bullet changed");
  assert.equal(applied.value.text, serializeResumeData(data));
  assert.deepEqual(applied.value.warnings, [{ id: suggestion.id, warnings: ["Check the number."] }]);
  const edited = await call("apply_resume_edits", { proposalId: polished.value.proposalId, accept: [suggestion.id], edits: { [suggestion.id]: "My own wording." } });
  assert.match(edited.value.text, /My own wording\./);
  assert.ok(edited.value.warnings[0].warnings.includes("Your replacement text was not checked by RoleFit."));
  const refused = await call("apply_resume_edits", { proposalId: polished.value.proposalId, accept: ["nope"], edits: { other: "x" } });
  assert.deepEqual(refused.value.issues, ["accept: nope is not in this proposal", "edits.other: not in accept"]);
  assert.match((await call("apply_resume_edits", { proposalId: polished.value.proposalId, accept: [suggestion.id], edits: { [suggestion.id]: " " } })).value.error, /Nothing was applied/);
  assert.match((await call("apply_resume_edits", { proposalId: "gone", accept: ["x"] })).value.error, /run polish_resume again/);

  settings.resumePolishReview = true;
  settings.boldBulletKeywords = false;
  calls.length = 0;
  await call("polish_resume", { resume: { sourceText: resumeSource }, jobDescription: brief });
  assert.equal(aiCalls()[0].body.reviewEdits, true);
  assert.equal(aiCalls()[0].body.boldBulletKeywords, false);
  assert.equal(aiCalls()[0].body.fitFindings, undefined);
  resetSettings();
  assert.match((await call("polish_resume", { resume: { sourceText: resumeSource }, jobDescription: brief, fitAssessment: { result: { status: "?" } } })).value.error, /^fitAssessment:/);
}

// polish_cover_letter: a missing detail stops before the provider.
{
  calls.length = 0;
  const needs = await call("polish_cover_letter", { coverLetter: { fileName: "default.cover" }, resume: { fileName: "default.resume" }, jobDescription: brief });
  assert.equal(needs.ok, true);
  assert.equal(needs.value.status, "needs-input");
  assert.deepEqual(needs.value.missing.map(({ key }) => key).sort(), ["company", "role"]);
  assert.equal(aiCalls().length, 0, "no provider call until the details are given");

  reply["/api/cover-polish"] = () => json(200, {
    status: "ready",
    coverLetterText: "Dear Acme Hiring Team,\n\nI build reliable Python services.\n\nSincerely,\nSynthetic Applicant",
    bodyParagraphs: ["I build reliable Python services."], evidenceUsed: ["resume-1"], warnings: [], concerns: []
  });
  calls.length = 0;
  const ready = await call("polish_cover_letter", { coverLetter: { fileName: "default.cover" }, resume: { fileName: "default.resume" }, jobDescription: brief, company: "Acme", role: "Backend Engineer" });
  assert.equal(ready.ok, true, JSON.stringify(ready.value));
  const sent = aiCalls()[0].body;
  assert.equal(sent.resolvedContext.company, "Acme");
  assert.equal(sent.customInstructions, "Shared guidance.", "no override: the shared guidance");
  assert.ok(sent.evidenceItems.some((item) => item.source === "resume"));
  assert.ok(sent.evidenceItems.some((item) => /Built payment APIs/.test(item.text)), "the Profile is evidence");
  assert.deepEqual({ provider: sent.provider, model: sent.model, reasoningEffort: sent.reasoningEffort }, stageFields("cover-polish"));
  const letter = parseCoverLetterFile(ready.value.sourceText);
  assert.equal(letter.data.header.name, "Synthetic Applicant", "the letterhead is kept");
  assert.equal(coverLetterPlainText(letter.data), "Dear Acme Hiring Team,\n\nI build reliable Python services.\n\nSincerely,\nSynthetic Applicant");

  reply["/api/cover-polish"] = () => json(422, { error: "Polish blocked.", status: "blocked", issues: [{ code: "unsupported-claim", message: "An unsupported claim.", excerpt: "x" }], reasons: ["x"] });
  const blocked = await call("polish_cover_letter", { coverLetter: { sourceText: coverSource }, resume: { sourceText: resumeSource }, jobDescription: brief, details: { company: "Acme", role: "Engineer" } });
  assert.equal(blocked.ok, false);
}

// draft_answer: the record's sources, a checked revision.
{
  const revision = (body, extra = {}) => ({
    id: body.answerRevisionId, applicationId: body.applicationId, questionId: body.question.id, questionRevision: body.question.revision,
    question: body.question.text, answer: "I build reliable APIs.", status: "ready", compliant: true, constraints: [],
    counts: { words: 4, characters: 22, sentences: 1 },
    generation: { provider: "anthropic", model: "m", reasoningEffort: "high", createdAt: "2026-10-26T00:00:00.000Z", attempts: 1, promptVersion: "v1" },
    sources: Object.fromEntries(["resumeFingerprint", "profileFingerprint", "jobFingerprint", "rawJobFingerprint", "factsFingerprint"].map((key) => [key, "a".repeat(64)])),
    ...extra
  });
  reply["/api/application-answers"] = (body) => json(200, { answer: revision(body) });
  calls.length = 0;
  const drafted = await call("draft_answer", { id: "a1", question: "Why Acme?" });
  assert.equal(drafted.ok, true, JSON.stringify(drafted.value));
  const sent = aiCalls()[0].body;
  assert.equal(sent.mode, "conversation");
  assert.equal(sent.applicationId, "a1");
  assert.equal(sent.question.text, "Why Acme?");
  assert.equal(sent.question.revision, 1);
  assert.equal(sent.resumeText, resumeText, "the record's saved resume");
  assert.equal(sent.jobText, brief);
  assert.equal(sent.rawJobText, posting);
  assert.equal(sent.customInstructions, "Shared guidance.");
  assert.deepEqual({ provider: sent.provider, model: sent.model, reasoningEffort: sent.reasoningEffort }, stageFields("application-answers"));
  assert.equal(drafted.value.answer.answer, "I build reliable APIs.");

  reply["/api/application-answers"] = (body) => json(200, { answer: revision(body, { userFacts: { provenance: "user-declared", facts: ["x"] } }) });
  assert.match((await call("draft_answer", { id: "a1", question: "Why Acme?" })).value.error, /did not match/, "a generated revision never carries user facts");
  assert.match((await call("draft_answer", { id: "b2", question: "Why?" })).value.error, /no job brief/);
  assert.match((await call("draft_answer", { id: "zz", question: "Why?" })).value.error, /No application has id zz/);
}

// review_application: the record's documents, the base resume as evidence.
{
  reply["/api/application-review"] = (body) => json(200, {
    findings: [], complete: true, overflow: false, completedAt: "2026-10-26T00:00:00.000Z",
    reviewedDocuments: [...(body.includeResume ? ["resume"] : []), ...(body.includeCoverLetter ? ["coverLetter"] : [])]
  });
  calls.length = 0;
  const reviewed = await call("review_application", { id: "a1", baseResume: "default.resume" });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed.value));
  const sent = aiCalls()[0].body;
  assert.equal(sent.includeResume, true);
  assert.equal(sent.includeCoverLetter, true);
  assert.equal(sent.jobText, posting, "the review reads the original posting");
  assert.ok(sent.evidence.some((item) => item.kind === "resume"), "the base resume is evidence");
  assert.deepEqual({ provider: sent.provider, model: sent.model, reasoningEffort: sent.reasoningEffort }, stageFields("application-review"));
  assert.equal(sent.provider, "openai");
  assert.deepEqual(reviewed.value.reviewedDocuments, ["resume", "coverLetter"]);
  calls.length = 0;
  await call("review_application", { id: "a1" });
  assert.ok(!aiCalls()[0].body.evidence.some((item) => item.kind === "resume"), "without baseResume only the Profile is evidence");
  assert.match((await call("review_application", { id: "b2" })).value.error, /no resume or cover letter saved/);
}

// The browser's other signals: concern notices carried between stages, the
// review outcome, Fit-gap statements and summary, dropped job terms, and the
// browser's response checks.
{
  // A resume bullet that states a job term, so dropping it is visible.
  const parsed = parseResumeFile(resumeSource);
  const section = parsed.data.sections.find((item) => item.type === "standard" && item.items.some((entry) => entry.bullets.length));
  const entry = section.items.find((item) => item.bullets.length);
  entry.bullets[0] = { ...entry.bullets[0], text: "Built Terraform modules for payments." };
  const termSource = serializeResumeFile(parsed.data, coerceDocStyle(parsed.documentStyle));
  // The brief as analyze_job assembles it: terminology reads its sections.
  reply["/api/job-analysis"] = () => json(200, {
    source: "ai", title: "Backend Engineer", company: "Acme", location: "", jobType: "", workAuth: "",
    salaryMin: null, salaryMax: null, salaryCurrency: "", salaryPeriod: "", roleDescription: "",
    responsibilities: ["Build APIs"], requiredQualifications: ["Terraform"], preferredQualifications: [], techKeywords: ["Terraform"],
    senioritySignals: [], domainSignals: []
  });
  const sectionedBrief = (await call("analyze_job", { text: posting })).value.jobDescription;
  let target;
  reply["/api/resume-polish"] = (body) => {
    const targets = flattenResumeTargets(body.resumeScope, body.candidateContext);
    target = targets.find((item) => item.currentText.includes("Built Terraform modules"));
    const held = targets.find((item) => item.kind === "bullet" && item !== target && item.currentText);
    const echo = (item) => ({ sectionId: item.target.sectionId, entryId: item.target.entryId, bulletId: item.target.bulletId });
    return json(200, {
      status: "PROPOSAL",
      changes: [{ targetId: target.targetId, target: echo(target), replacement: "Built payment services.", reason: "Shorter." }],
      summary: ["Tightened one bullet."], omittedTargetCount: 0, withheld: { count: 0, reasons: [] },
      review: { outcome: "REVIEWED", attempts: 1, heldBack: [{ change: { targetId: held.targetId, target: echo(held), replacement: "Held text.", reason: "r" }, reason: "LOW_IMPACT" }] },
      fitGaps: [{ gap: "gap-1", status: "ADDRESSED", targetIds: [target.targetId] }]
    });
  };
  calls.length = 0;
  const polished = await call("polish_resume", {
    resume: { sourceText: termSource }, jobDescription: sectionedBrief, fitAssessment: { result: fitResult, resumeLabel: "x" }, resumeConcerns: ["Check the number."]
  });
  assert.equal(polished.ok, true, JSON.stringify(polished.value));
  assert.deepEqual(aiCalls()[0].body.sourceWarnings, [RESUME_POLISH_SOURCE_WARNING], "the browser's notice for wording with earlier concerns");
  assert.ok(polished.value.warnings.includes(RESUME_POLISH_RESULT_WARNING));
  assert.equal(polished.value.review, "REVIEWED", "the review's outcome reaches the agent");
  assert.equal(polished.value.heldBack[0].heldBackReason, "LOW_IMPACT");
  assert.deepEqual(polished.value.summary, ["Tightened one bullet."]);
  assert.deepEqual(polished.value.fitGaps, [{ gap: "three years of backend experience", status: "ADDRESSED", suggestionIds: [target.targetId] }]);
  const applied = await call("apply_resume_edits", { proposalId: polished.value.proposalId, accept: [target.targetId] });
  assert.ok(applied.value.terminologyWarnings?.some((warning) => /terraform/i.test(warning)), JSON.stringify(applied.value.terminologyWarnings));
  assert.equal(applied.value.warnings, undefined, "the accepted edit had no warnings of its own");
  assert.deepEqual(applied.value.resumeConcerns, ["Check the number."], "the concerns the polish was given stay open");

  // Every Fit gap sent is reported; one cited only by a held-back edit, or
  // never mentioned, is Not reported, as in the app.
  const twoGaps = { ...fitResult, gaps: ["three years of backend experience", "Kubernetes operations"] };
  reply["/api/resume-polish"] = (body) => {
    const targets = flattenResumeTargets(body.resumeScope, body.candidateContext).filter((item) => item.kind === "bullet" && item.currentText);
    const echo = (item) => ({ sectionId: item.target.sectionId, entryId: item.target.entryId, bulletId: item.target.bulletId });
    return json(200, {
      status: "PROPOSAL",
      changes: [{ targetId: targets[0].targetId, target: echo(targets[0]), replacement: "Kept text.", reason: "r" }],
      summary: [], omittedTargetCount: 0, withheld: { count: 0, reasons: [] },
      review: { outcome: "REVIEWED", attempts: 1, heldBack: [{ change: { targetId: targets[1].targetId, target: echo(targets[1]), replacement: "Held.", reason: "r" }, reason: "INCORRECT" }] },
      fitGaps: [{ gap: "gap-1", status: "ADDRESSED", targetIds: [targets[1].targetId] }]
    });
  };
  const gapRows = (await call("polish_resume", { resume: { sourceText: resumeSource }, jobDescription: brief, fitAssessment: { result: twoGaps, resumeLabel: "x" } })).value.fitGaps;
  assert.deepEqual(gapRows, [
    { gap: "three years of backend experience", status: "NOT_REPORTED", suggestionIds: [] },
    { gap: "Kubernetes operations", status: "NOT_REPORTED", suggestionIds: [] }
  ]);

  reply["/api/resume-polish"] = () => json(200, { status: "NO_CHANGES", changes: [], summary: [], omittedTargetCount: 10_000, withheld: { count: 0, reasons: [] } });
  assert.match((await call("polish_resume", { resume: { sourceText: resumeSource }, jobDescription: brief })).value.error, /invalid outcome/, "more omitted targets than were sent");

  reply["/api/cover-polish"] = () => json(200, { status: "ready", coverLetterText: "Dear Acme Hiring Team,\n\nText.", evidenceUsed: [] });
  calls.length = 0;
  const cover = await call("polish_cover_letter", {
    coverLetter: { sourceText: coverSource }, resume: { sourceText: resumeSource }, jobDescription: brief, company: "Acme", role: "Engineer",
    resumeConcerns: ["Check the number."], coverConcerns: ["Paragraph 1: unsupported claim."]
  });
  assert.deepEqual(aiCalls()[0].body.sourceWarnings, [RESUME_SOURCE_WARNING, COVER_ACCEPTED_CONCERNS_WARNING, "Paragraph 1: unsupported claim."]);
  assert.match(cover.value.error, /no usable letter/, "a reply without bodyParagraphs is refused, as in the app");
  calls.length = 0;
  const invented = await call("polish_cover_letter", {
    coverLetter: { sourceText: coverSource }, resume: { sourceText: resumeSource }, jobDescription: brief, company: "Acme", role: "Engineer",
    slotAnswers: { invented_achievement: "Led a 50-person team." }
  });
  assert.deepEqual(invented.value.issues, ["slotAnswers.invented_achievement: not a slot this letter asks for"], "only a slot the template asks for takes an answer");
  assert.equal(aiCalls().length, 0);

  reply["/api/application-answers"] = (body) => json(200, { answer: {
    id: body.answerRevisionId, applicationId: body.applicationId, questionId: body.question.id, questionRevision: body.question.revision,
    question: "A different question?", answer: "x", status: "draft", compliant: true, constraints: [], counts: { words: 1, characters: 1, sentences: 1 },
    generation: { provider: "p", model: "m", reasoningEffort: "", createdAt: "2026-10-26T00:00:00.000Z", attempts: 1, promptVersion: "v" },
    sources: Object.fromEntries(["resumeFingerprint", "profileFingerprint", "jobFingerprint", "rawJobFingerprint", "factsFingerprint"].map((key) => [key, "b".repeat(64)]))
  } });
  calls.length = 0;
  assert.match((await call("draft_answer", { id: "a1", question: "Why Acme?", resumeConcerns: ["x"] })).value.error, /did not match/, "an answer to another question is refused");
  assert.deepEqual(aiCalls()[0].body.sourceWarnings, [RESUME_SOURCE_WARNING]);

  reply["/api/application-review"] = (body) => json(200, {
    findings: [], complete: false, overflow: false, completedAt: "2026-10-26T00:00:00.000Z", error: "The provider is unavailable.",
    reviewedDocuments: [...(body.includeResume ? ["resume"] : []), ...(body.includeCoverLetter ? ["coverLetter"] : [])]
  });
  const failed = await call("review_application", { id: "a1" });
  assert.equal(failed.ok, false, "a review whose provider failed is an error");
  assert.equal(failed.value.error, "The provider is unavailable.");
  assert.deepEqual(failed.value.reviewedDocuments, ["resume", "coverLetter"], "with the local result");
  settings.profileBackground = "x".repeat(PROFILE_BACKGROUND_CHAR_LIMIT + 1);
  calls.length = 0;
  const declined = await call("review_application", { id: "a1" });
  assert.equal(declined.ok, false);
  assert.match(declined.value.error, /^Profile too long/);
  assert.deepEqual(declined.value.reviewedDocuments, ["resume", "coverLetter"], "a declined review still carries the local checks");
  assert.ok(Array.isArray(declined.value.findings));
  assert.equal(aiCalls().length, 0);
  resetSettings();

  // At most three provider runs at once; the fourth is refused, not queued.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  reply["/api/job-analysis"] = async () => { await held; return json(502, { error: "x" }); };
  const running = [1, 2, 3].map(() => call("analyze_job", { text: posting }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match((await call("assess_fit", { jobText: posting, resume: { sourceText: resumeSource } })).value.error, /3 RoleFit AI calls are already running/);
  release();
  await Promise.all(running);

  assert.match(tools.polish_resume.inputSchema.properties.resume.description, /candidate's own evidence/, "the resume input says how RoleFit reads it");
}

// An over-limit Profile stops the stages that read it (job analysis does not),
// and unreadable settings stop every stage, before any provider call.
{
  settings.profileBackground = "x".repeat(PROFILE_BACKGROUND_CHAR_LIMIT + 1);
  calls.length = 0;
  assert.match((await call("assess_fit", { jobText: posting, resume: { sourceText: resumeSource } })).value.error, /^Profile too long/);
  assert.equal(aiCalls().length, 0);
  reply["/api/job-analysis"] = () => json(502, { error: "unavailable" });
  await call("analyze_job", { text: posting });
  assert.equal(aiCalls().length, 1, "job analysis never reads the Profile");
  assert.equal(aiCalls()[0].body.candidateContext, undefined);
  resetSettings();
  reply.preferences = () => json(200, { exists: false, newer: true });
  calls.length = 0;
  assert.match((await call("draft_answer", { id: "a1", question: "Why?" })).value.error, /newer version of RoleFit/);
  assert.equal(aiCalls().length, 0);
  delete reply.preferences;
}

console.log("mcp ai probes passed");
