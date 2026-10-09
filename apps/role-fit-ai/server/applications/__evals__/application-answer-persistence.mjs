import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { extractAnswerConstraints, validateAnswerConstraints } from "../../../shared/applicationAnswersContract.ts";
import { answerReceiptIsCurrent, editedSavedApplicationAnswer, parseApplicationAnswerRevision, parseSavedApplicationAnswers } from "../../../shared/applicationAnswerStorage.ts";
import { sanitizeApplications } from "../schema.ts";
import { invalidateApplicationsSnapshot, readApplications as readCachedApplications, writeApplications } from "../storage.ts";
import { handleSaveApplications } from "../trackerRoutes.ts";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "../../workspaceBackup.ts";
import { appliedApplicationForSession } from "../../../src/lib/preparationApplication.ts";
import { skipApplicationForSession } from "../../../src/lib/notApplyingApplication.ts";
import { preparationPrimaryAction, preparationSessionForApplication } from "../../../src/lib/preparationSession.ts";
import { applicationStatusTransitionAllowed } from "../../../src/lib/applicationStatusTransitions.ts";
import { isSubmittedApplication, trackingHygiene } from "../../../src/lib/applicationAnalytics.ts";

// Read back from disk, not the server's validated cache, so every check below
// proves a strict round trip through applications.json.
const readApplications = (dir) => {
  invalidateApplicationsSnapshot();
  return readCachedApplications(dir);
};

const now = "2026-10-07T00:00:00.000Z";
const later = "2026-10-07T01:00:00.000Z";
const question = `Why this role? ${"Consider the work carefully. ".repeat(25)}Maximum 150 words.`;
const answer = "I enjoy building reliable tools. I helped test a scheduling feature and learned to make errors easier to diagnose.";
const constraints = extractAnswerConstraints(question);
const receipt = validateAnswerConstraints(answer, constraints);
const revision = {
  id: "response-1", applicationId: "draft-1", originId: "preparation-1", questionId: "question-1", questionRevision: 1,
  question, answer, constraints, counts: receipt.counts, compliant: receipt.compliant, status: "ready",
  generation: { provider: "synthetic", model: "synthetic", reasoningEffort: "low", createdAt: now, attempts: 1, promptVersion: "answers-v1" },
  sources: Object.fromEntries(["resumeFingerprint", "profileFingerprint", "jobFingerprint", "rawJobFingerprint", "factsFingerprint"].map((key) => [key, "a".repeat(64)]))
};
const saved = { ...revision, savedAt: now };
const legacy = { question: "Why engineering?", answer: "I like solving practical problems.", savedAt: now };
const draft = { id: "draft-1", title: "Synthetic role", jobUrl: "https://example.test/job/1", jobDescription: "Synthetic role context.", status: "draft", createdAt: now, updatedAt: now, applicationAnswers: [legacy, saved] };
assert.ok(parseApplicationAnswerRevision(revision));
assert.ok(question.length > 400);
assert.equal(parseSavedApplicationAnswers([saved], draft.id)[0].question, question);
assert.equal(parseSavedApplicationAnswers([saved], "different-id"), null);
for (const change of [
  { question: "x".repeat(12_001) }, { answer: "x".repeat(16_001) }, { extra: true }, { compliant: false },
  { generation: { ...revision.generation, attempts: -1 } }, { sources: { ...revision.sources, resumeFingerprint: "unknown" } }
]) assert.equal(parseApplicationAnswerRevision({ ...revision, ...change }), null);
assert.equal(answerReceiptIsCurrent(revision), true);
for (const stale of [{ counts: { ...receipt.counts, words: 999 } }, { constraints: [] }]) {
  assert.ok(parseApplicationAnswerRevision({ ...revision, ...stale }), "stored receipts are shape-checked, so a later count rule never invalidates a tracker");
  assert.equal(answerReceiptIsCurrent({ ...revision, ...stale }), false);
}
assert.equal(parseSavedApplicationAnswers(Array.from({ length: 161 }, (_, n) => ({ ...legacy, question: String(n) })), draft.id), null);
assert.equal(parseSavedApplicationAnswers([{ ...legacy, answer: "x".repeat(16_001) }], draft.id), null);
assert.equal(parseSavedApplicationAnswers([legacy], draft.id)[0].generation, undefined, "legacy provenance stays unknown");
const edited = editedSavedApplicationAnswer(saved, "Why this role? Under 3 words.", "A longer manual answer", "manual-1", later);
assert.equal(edited.generation, undefined);
assert.equal(edited.sources, undefined);
assert.equal(edited.status, "draft");
assert.equal(edited.questionRevision, 2);
assert.equal(edited.previousAnswerId, revision.id);
assert.ok(parseSavedApplicationAnswers([saved, edited], draft.id));

// Saved user facts: optional and strict, within the request's explicit-fact limits.
const facts = ["I led the postmortem after the March outage."];
const factRevision = { ...revision, id: "response-2", questionId: "question-2", userFacts: { provenance: "user-declared", facts } };
const factSaved = { ...factRevision, savedAt: later };
assert.deepEqual(parseApplicationAnswerRevision(factRevision), factRevision);
assert.equal(parseApplicationAnswerRevision(revision).userFacts, undefined, "a revision saved before facts were kept stays valid without them");
const withFacts = (userFacts) => ({ ...factRevision, userFacts });
for (const list of [Array.from({ length: 20 }, (_, n) => `Fact ${n}.`), ["x".repeat(4_000)], ["x".repeat(4_000), "x".repeat(4_000), "x".repeat(3_998)], ["Tab\tand\nnewline\r\nkept."], ["Same fact.", "Same fact."]]) {
  assert.ok(parseApplicationAnswerRevision(withFacts({ provenance: "user-declared", facts: list })), `boundary accepted: ${list.length} facts, ${list.join("\n").length} characters`);
}
for (const [label, userFacts] of [
  ["string container", "I led the postmortem."], ["array container", facts], ["null container", null], ["number container", 1],
  ["extra key", { provenance: "user-declared", facts, note: "x" }], ["missing provenance", { facts }],
  ["generated provenance", { provenance: "generated", facts }], ["case-changed provenance", { provenance: "User-declared", facts }],
  ["profile provenance", { provenance: "profile", facts }], ["missing facts", { provenance: "user-declared" }],
  ["string facts", { provenance: "user-declared", facts: "x" }], ["empty facts", { provenance: "user-declared", facts: [] }],
  ["number fact", { provenance: "user-declared", facts: [1] }], ["null fact", { provenance: "user-declared", facts: [null] }],
  ["object fact", { provenance: "user-declared", facts: [{}] }], ["empty fact", { provenance: "user-declared", facts: [""] }],
  ["blank fact", { provenance: "user-declared", facts: ["   "] }], ["4,001-character fact", { provenance: "user-declared", facts: ["x".repeat(4_001)] }],
  ["vertical tab", { provenance: "user-declared", facts: ["a\u000bb"] }], ["NUL", { provenance: "user-declared", facts: ["a\u0000b"] }],
  ["21 facts", { provenance: "user-declared", facts: Array.from({ length: 21 }, (_, n) => `Fact ${n}.`) }],
  ["12,001 joined characters", { provenance: "user-declared", facts: ["x".repeat(4_000), "x".repeat(4_000), "x".repeat(3_999)] }],
  ["12,002 joined characters", { provenance: "user-declared", facts: ["x".repeat(4_000), "x".repeat(4_000), "x".repeat(4_000)] }]
]) assert.equal(parseApplicationAnswerRevision(withFacts(userFacts)), null, label);
assert.equal(parseSavedApplicationAnswers([legacy, saved, { ...factSaved, userFacts: { provenance: "user-declared", facts: [] } }], draft.id), null, "one malformed fact list invalidates the record");
const factEdit = editedSavedApplicationAnswer(factSaved, factSaved.question, "A manual answer in my own words.", "manual-facts", later);
assert.deepEqual(factEdit.userFacts, factSaved.userFacts, "a manual edit keeps the question's facts");
assert.equal(factEdit.generation, undefined);
const factQuestionEdit = editedSavedApplicationAnswer(factSaved, "Why this team? Maximum 150 words.", "A manual answer in my own words.", "manual-facts-2", later);
assert.equal(factQuestionEdit.questionRevision, 2);
assert.deepEqual(factQuestionEdit.userFacts, factSaved.userFacts, "a question-text edit keeps the same question's facts");
assert.equal(editedSavedApplicationAnswer(saved, saved.question, "Edited text.", "manual-no-facts", later).userFacts, undefined, "an edit never creates facts");
assert.equal(editedSavedApplicationAnswer(legacy, legacy.question, "Edited text.", "manual-legacy", later).userFacts, undefined);
assert.ok(parseSavedApplicationAnswers([legacy, saved, factSaved, factEdit, factQuestionEdit], draft.id));
assert.equal(sanitizeApplications([{ ...draft, appliedAt: now }]).length, 0);
assert.equal(sanitizeApplications([{ ...draft, resumeUsed: "base" }]).length, 0);
assert.equal(isSubmittedApplication({ ...draft, appliedAt: now }), false, "even malformed Draft dates never count as submissions");
assert.deepEqual(trackingHygiene([draft]), { submitted: 0, closed: 0, missingFollowup: 0 });
for (const status of ["applied", "interviewing", "offer", "rejected", "withdrawn", "not_applying"]) assert.equal(applicationStatusTransitionAllowed(status, "draft"), false);
assert.equal(applicationStatusTransitionAllowed("draft", "offer"), false);
const session = preparationSessionForApplication(draft);
assert.equal(preparationPrimaryAction(session, draft.status).kind, "apply");
const applied = appliedApplicationForSession({ session, prepared: { ...draft, id: "ignored-new-id" }, existing: draft, now: later });
assert.equal(applied.operation, "update");
assert.equal(applied.application.id, draft.id);
assert.equal(applied.application.status, "applied");
assert.equal(applied.application.appliedAt, later);
assert.deepEqual(applied.application.applicationAnswers, draft.applicationAnswers);
const skipped = skipApplicationForSession({ session, prepared: { ...draft, id: "ignored-new-id" }, existingDraft: draft, matchedNotApplying: null, now: later, reason: "interest", note: "Synthetic reason" });
assert.equal(skipped.operation, "update");
assert.equal(skipped.application.id, draft.id);
assert.equal(skipped.application.status, "not_applying");
assert.equal(skipped.application.appliedAt, undefined);
assert.deepEqual(skipped.application.applicationAnswers, draft.applicationAnswers);

const root = await mkdtemp(join(tmpdir(), "rolefit-answer-persistence-"));
async function saveRoute(applications, mutations) {
  const req = Readable.from([Buffer.from(JSON.stringify({ applications, mutations }))]);
  let code; let body;
  await handleSaveApplications(req, { writeHead(status) { code = status; }, end(text) { body = JSON.parse(text); } }, join(root, "source"));
  return { code, body };
}
try {
  const written = await writeApplications(join(root, "source"), [draft]);
  assert.deepEqual((await readApplications(join(root, "source")))[0].applicationAnswers, draft.applicationAnswers);
  const backup = await createWorkspaceBackup(join(root, "source"));
  await restoreWorkspaceBackup(join(root, "restored"), backup, new Date(later), 0);
  assert.deepEqual((await readApplications(join(root, "restored")))[0].applicationAnswers, draft.applicationAnswers, "backup/import retains exact enriched and legacy answers");
  const mutated = { ...written[0], updatedAt: later, applicationAnswers: [legacy, { ...saved, answer: "changed" }] };
  const rejected = await saveRoute([mutated], [{ id: draft.id, operation: "upsert", baseUpdatedAt: now }]);
  assert.equal(rejected.code, 400, "HTTP save refuses stale count receipts without silently stripping metadata");
  const oversized = await saveRoute([{ ...written[0], updatedAt: later, applicationAnswers: [{ ...legacy, answer: "x".repeat(16_001) }] }], [{ id: draft.id, operation: "upsert", baseUpdatedAt: now }]);
  assert.equal(oversized.code, 400);
  const alteredRevision = editedSavedApplicationAnswer(saved, question, "Changed text.", saved.id, now);
  const immutable = await saveRoute([{ ...written[0], updatedAt: later, applicationAnswers: [legacy, alteredRevision] }], [{ id: draft.id, operation: "upsert", baseUpdatedAt: now }]);
  assert.equal(immutable.code, 400, "existing revision identity cannot be repurposed for other text");
  const staleReceipt = await saveRoute([{ ...written[0], updatedAt: later, applicationAnswers: [legacy, saved, { ...edited, id: "manual-stale", counts: { ...edited.counts, words: 999 } }] }], [{ id: draft.id, operation: "upsert", baseUpdatedAt: now }]);
  assert.equal(staleReceipt.code, 400, "a new revision must carry counts computed from the current rules");
  await writeApplications(join(root, "stale"), [{ ...draft, id: "draft-stale", applicationAnswers: [{ ...saved, applicationId: "draft-stale", counts: { ...saved.counts, words: 999 } }] }]);
  assert.equal((await readApplications(join(root, "stale"))).length, 1, "a tracker saved under earlier count rules still loads");
  const appended = await saveRoute([{ ...written[0], updatedAt: later, applicationAnswers: [legacy, saved, edited] }], [{ id: draft.id, operation: "upsert", baseUpdatedAt: now }]);
  assert.equal(appended.code, 200);
  assert.deepEqual(appended.body.applications[0].applicationAnswers, [legacy, saved, edited]);
  const stale = await saveRoute(written, [{ id: draft.id, operation: "upsert", baseUpdatedAt: now }]);
  assert.equal(stale.code, 409);
  assert.deepEqual(stale.body.applications[0].applicationAnswers, [legacy, saved, edited]);
} finally {
  await rm(root, { recursive: true, force: true });
}

const factRoot = await mkdtemp(join(tmpdir(), "rolefit-answer-facts-"));
async function saveFactsRoute(applications, mutations) {
  const req = Readable.from([Buffer.from(JSON.stringify({ applications, mutations }))]);
  let code; let body;
  await handleSaveApplications(req, { writeHead(status) { code = status; }, end(text) { body = JSON.parse(text); } }, join(factRoot, "source"));
  return { code, body };
}
try {
  const factDraft = { ...draft, applicationAnswers: [legacy, saved, factSaved] };
  const [written] = await writeApplications(join(factRoot, "source"), [factDraft]);
  assert.deepEqual((await readApplications(join(factRoot, "source")))[0].applicationAnswers, factDraft.applicationAnswers, "legacy, pre-change and fact-bearing revisions load together");
  await restoreWorkspaceBackup(join(factRoot, "restored"), await createWorkspaceBackup(join(factRoot, "source")), new Date(later), 0);
  const restored = (await readApplications(join(factRoot, "restored")))[0].applicationAnswers;
  assert.deepEqual(restored, factDraft.applicationAnswers, "backup/restore keeps saved facts exactly");
  assert.deepEqual(restored[2].userFacts, { provenance: "user-declared", facts });
  const upsert = [{ id: draft.id, operation: "upsert", baseUpdatedAt: written.updatedAt }];
  const rewritten = await saveFactsRoute([{ ...written, updatedAt: later, applicationAnswers: [legacy, saved, { ...factSaved, userFacts: { provenance: "user-declared", facts: ["A different fact."] } }] }], upsert);
  assert.equal(rewritten.code, 400, "a saved revision's facts are immutable");
  const malformed = await saveFactsRoute([{ ...written, updatedAt: later, applicationAnswers: [legacy, saved, factSaved, { ...factEdit, userFacts: { provenance: "user-declared", facts: Array.from({ length: 21 }, (_, n) => `Fact ${n}.`) } }] }], upsert);
  assert.equal(malformed.code, 400, "the tracker route rejects malformed facts");
  const appended = await saveFactsRoute([{ ...written, updatedAt: later, applicationAnswers: [legacy, saved, factSaved, factEdit] }], upsert);
  assert.equal(appended.code, 200);
  assert.deepEqual((await readApplications(join(factRoot, "source")))[0].applicationAnswers.at(-1).userFacts, factSaved.userFacts, "a new revision's facts persist through the route");
} finally {
  await rm(factRoot, { recursive: true, force: true });
}
console.log("Application answer persistence passed: shape-checked stored receipts, verified new revisions, exact legacy/new round-trip and backup, saved user facts, Draft lifecycle, immutable revisions, rejection and conflicts");
