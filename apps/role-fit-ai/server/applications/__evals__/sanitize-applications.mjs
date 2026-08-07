import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationsStorageError,
  sanitizeApplications
} from "../schema.ts";
import { reconcileApplicationMutations } from "../reconcile.ts";
import {
  applicationsFilePath,
  readApplications,
  writeApplications
} from "../storage.ts";

const workspace = await mkdtemp(join(tmpdir(), "rolefit-applications-"));

try {
  const rawApplications = [
    {
      id: "app_valid-123",
      title: "Valid application",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-29T10:00:00.000Z",
      jobUrl: "https://example.com/job",
      status: "applied",
      initialFitAudit: {
        assessment: {
          verdict: "REASONABLE_FIT",
          confidence: "HIGH",
          summary: "Relevant product engineering evidence with one adjacent core requirement.",
          verdictReason: "Most core requirements have direct or adjacent evidence.",
          eligibility: { status: "SATISFIED", items: [] },
          requirements: [{
            id: "python",
            requirement: "Python",
            importance: "CORE",
            coverage: "COVERED",
            evidence: [{ source: "RESUME", excerpt: "Python" }],
            explanation: "Python is listed in Technical Skills.",
            canSurfaceInResume: false
          }],
          strengths: ["Python evidence is direct."],
          concerns: [],
          recommendation: { action: "APPLY", reason: "The important requirements are supported." }
        },
        resumeFileName: "full-stack.resume",
        completedAt: "2026-07-28T14:30:00.000Z"
      },
      submissionAssessment: {
        readiness: "READY",
        summary: "The resume is ready to submit.",
        requirementVisibility: [],
        unsupportedClaims: [],
        missingEvidence: [],
        presentationIssues: [],
        topEdits: []
      },
      // sourceUrls: one dupe of the own jobUrl via a tracking-param variant (must
      // collapse), one dupe of another entry, one distinct URL, one empty (dropped).
      sourceUrls: [
        { url: "https://example.com/job?utm_source=linkedin", source: "LinkedIn" },
        { url: "https://boards.greenhouse.io/acme/jobs/123", source: "Greenhouse", addedAt: "2026-07-01T00:00:00Z" },
        { url: "https://boards.greenhouse.io/acme/jobs/123#apply", source: "Greenhouse dup" },
        { url: "   ", source: "empty" }
      ],
      rawJobDescription: "  Raw JD text here.  ",
      duplicateDismissedIds: ["other-app", "other-app", "app_valid-123", "../bad"],
      coverLetterArtifacts: {
        hasPdf: false,
        hasSource: true,
        sourceFingerprint: "typeset-cover-letter-1",
        fileName: "letter.cover",
        savedAt: "2026-07-27T00:00:00.000Z"
      },
      attachments: [
        { fileName: "../escape.pdf", label: "Escape", size: 10, savedAt: "2026-07-27T00:00:00.000Z" },
        { fileName: "transcript.pdf", label: "  Transcript  ", size: 2048, savedAt: "2026-07-27T00:00:00.000Z" },
        { fileName: "transcript.pdf", label: "Duplicate", size: 99 },
        { fileName: "payload.exe", label: "Nope", size: 10 },
        { fileName: "supplemental.pdf", size: -5 }
      ],
      aiUsage: {
        distill: {
          source: "ai",
          provider: "claude-cli",
          model: "opus",
          reasoningEffort: "high",
          requestedProvider: "claude-cli",
          requestedModel: "opus",
          attempts: 2,
          fallback: false,
          completedAt: "2026-07-05T00:00:00Z",
          bogusSubfield: "drop me"
        },
        // Empty-string optionals must drop rather than persist as "".
        tailor: { source: "local", provider: "", model: "" },
        // Invalid source enum → whole entry dropped.
        review: { source: "bogus", provider: "openai" },
        // attempts clamps to 1..9 (12 → 9).
        cover: { source: "ai", attempts: 12 },
        // Bad stage key (uppercase) → dropped.
        BADKEY: { source: "ai" }
      }
    },
    {
      id: "../escape",
      title: "Invalid id",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-29T10:00:00.000Z",
      status: "interested"
    },
    {
      // Empty aiUsage (no valid entries) → undefined.
      id: "app_empty-ai",
      title: "Empty AI usage",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-29T10:00:00.000Z",
      status: "interested",
      aiUsage: { review: { source: "nope" }, "9bad": { source: "ai" } }
    }
  ];
  const written = await writeApplications(workspace, sanitizeApplications(rawApplications));

  const read = await readApplications(workspace);
  const failures = [];
  const valid = read[0];
  const emptyAi = read.find((a) => a.id === "app_empty-ai");

  if (written.length !== 2 || read.length !== 2) failures.push("invalid ids are not dropped");
  if (valid?.id !== "app_valid-123") failures.push("valid id did not persist");
  if (
    valid?.initialFitAudit?.assessment.verdict !== "REASONABLE_FIT" ||
    valid.initialFitAudit.resumeFileName !== "full-stack.resume"
  ) {
    failures.push("categorical Initial Fit assessment did not roundtrip");
  }
  if (valid?.submissionAssessment?.readiness !== "READY") {
    failures.push("submission assessment did not roundtrip independently from Initial Fit");
  }
  const malformedInitialFit = sanitizeApplications([
    {
      id: "bad-initial-fit",
      title: "Bad Initial Fit",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-29T10:00:00.000Z",
      initialFitAudit: {
        score: 42,
        verdict: "STRONG FIT",
        resumeFileName: "../escape.resume",
        completedAt: "2026-07-28T14:30:00.000Z"
      }
    }
  ])[0];
  if (!malformedInitialFit || malformedInitialFit.initialFitAudit !== undefined) {
    failures.push("a contradictory or unsafe Initial Fit audit survived sanitization");
  }
  const canonicalCreatedAt = "2026-07-01T00:00:00.000Z";
  const canonicalUpdatedAt = "2026-07-29T10:00:00.000Z";
  const noncanonicalHeaders = sanitizeApplications([
    {
      id: "legacy-flat-header",
      title: "Legacy flat header",
      createdAt: canonicalCreatedAt,
      updatedAt: canonicalUpdatedAt,
      resumeData: {
        name: "Must not hydrate at runtime",
        contact: ["legacy@example.test"],
        sections: [{ heading: "Experience", items: [] }]
      }
    },
    {
      id: "empty-structural-header",
      title: "Empty structural header",
      createdAt: canonicalCreatedAt,
      updatedAt: canonicalUpdatedAt,
      resumeData: {
        header: { visible: true, name: null, contact: [] },
        sections: [{ heading: "Experience", items: [] }]
      }
    }
  ]);
  if (noncanonicalHeaders.length !== 0) {
    failures.push("runtime tracker sanitization accepted a retired resume snapshot");
  }

  // rawJobDescription roundtrips (trimmed via slice, not .trim()).
  if (valid?.rawJobDescription !== "  Raw JD text here.  ") failures.push("rawJobDescription did not persist");
  if (valid?.resumeArtifacts !== undefined) failures.push("an absent resume artifact slot was invented");

  // The cover letter's artifacts carry the same shape as the resume's, so the
  // tracker can never describe one document more richly than the other.
  if (valid?.coverLetterArtifacts?.hasPdf !== false || valid?.coverLetterArtifacts?.hasSource !== true) {
    failures.push("cover-letter artifacts did not roundtrip");
  }

  // Attachment metadata only survives when its name would survive the upload
  // route's own validation: traversal is neutralized to the base name,
  // duplicates collapse, an unsupported extension is dropped, and the content
  // type is re-derived rather than trusted from the client.
  const attachments = valid?.attachments ?? [];
  const names = attachments.map((entry) => entry.fileName);
  if (names.length !== 3) failures.push(`unexpected attachment count: ${JSON.stringify(names)}`);
  if (!names.includes("escape.pdf")) failures.push("a traversing attachment name was not neutralized to its base name");
  if (names.filter((name) => name === "transcript.pdf").length !== 1) failures.push("duplicate attachment names did not collapse");
  if (names.includes("payload.exe")) failures.push("an unsupported attachment extension survived");
  if (attachments.find((entry) => entry.fileName === "transcript.pdf")?.label !== "Transcript") {
    failures.push("attachment labels are not trimmed");
  }
  if (attachments.find((entry) => entry.fileName === "transcript.pdf")?.contentType !== "application/pdf") {
    failures.push("attachment content types are not re-derived from the stored name");
  }
  if (attachments.find((entry) => entry.fileName === "supplemental.pdf")?.size !== 0) {
    failures.push("a negative attachment size was not clamped");
  }
  if (attachments.find((entry) => entry.fileName === "supplemental.pdf")?.label !== "supplemental.pdf") {
    failures.push("a missing attachment label does not fall back to the file name");
  }
  if (
    !Array.isArray(valid?.duplicateDismissedIds) ||
    valid.duplicateDismissedIds.length !== 1 ||
    valid.duplicateDismissedIds[0] !== "other-app"
  ) {
    failures.push("duplicate review dismissals did not sanitize and roundtrip");
  }

  // sourceUrls: the utm variant collapses against jobUrl, the #apply dup collapses
  // against the greenhouse entry, the empty is dropped → exactly 1 survives.
  const su = valid?.sourceUrls;
  if (!Array.isArray(su) || su.length !== 1) {
    failures.push(`sourceUrls cap/dedupe wrong (expected 1, got ${su?.length})`);
  }
  if (su?.[0]?.url !== "https://boards.greenhouse.io/acme/jobs/123") failures.push("sourceUrls kept the wrong entry");
  if (!su?.[0]?.addedAt) failures.push("sourceUrls addedAt default missing");

  // aiUsage: distill valid, tailor keeps only source (empty optionals dropped),
  // review dropped (bad source), cover attempts clamped to 9, BADKEY dropped.
  const ai = valid?.aiUsage;
  if (!ai || typeof ai !== "object") failures.push("aiUsage did not persist");
  if (ai?.distill?.bogusSubfield) failures.push("aiUsage unknown subfield survived");
  if (ai?.distill?.source !== "ai" || ai?.distill?.model !== "opus") failures.push("aiUsage distill entry corrupted");
  if (ai?.distill?.attempts !== 2) failures.push("aiUsage valid attempts not preserved");
  if ("provider" in (ai?.tailor ?? {}) || "model" in (ai?.tailor ?? {})) failures.push("aiUsage empty-string optionals persisted");
  if (ai?.tailor?.source !== "local") failures.push("aiUsage tailor source lost");
  if (ai && "review" in ai) failures.push("aiUsage invalid source enum did not drop the entry");
  if (ai?.cover?.attempts !== 9) failures.push("aiUsage attempts not clamped to 9");
  if (ai && "BADKEY" in ai) failures.push("aiUsage bad stage key survived");

  // Empty aiUsage → undefined (no key persisted).
  if (emptyAi && emptyAi.aiUsage !== undefined) failures.push("empty aiUsage did not become undefined");

  let overflowRejected = false;
  try {
    await writeApplications(workspace, Array.from({ length: 501 }, (_, index) => ({
      id: `overflow-${index}`,
      title: `Overflow ${index}`,
      createdAt: canonicalCreatedAt,
      updatedAt: canonicalUpdatedAt
    })));
  } catch (error) {
    overflowRejected = error instanceof ApplicationsStorageError && error.status === 400;
  }
  if (!overflowRejected) failures.push("tracker overflow was silently truncated instead of rejected");

  // Duplicate ids are ambiguous in both storage and request snapshots and must
  // be rejected rather than silently applying the last occurrence.
  let duplicateWriteRejected = false;
  try {
    await writeApplications(workspace, sanitizeApplications([
      { id: "duplicate", title: "First", createdAt: canonicalCreatedAt, updatedAt: canonicalUpdatedAt },
      { id: "duplicate", title: "Second", createdAt: canonicalCreatedAt, updatedAt: canonicalUpdatedAt }
    ]));
  } catch (error) {
    duplicateWriteRejected = error instanceof ApplicationsStorageError && error.status === 400;
  }
  if (!duplicateWriteRejected) failures.push("duplicate application ids were accepted for storage");

  const revisionA = "2026-07-29T10:00:00.000Z";
  const revisionB = "2026-07-29T11:00:00.000Z";
  const revisionBNext = "2026-07-29T12:00:00.000Z";
  const revisionC = "2026-07-29T13:00:00.000Z";
  const revisionCNext = "2026-07-29T14:00:00.000Z";
  const revisionD = "2026-07-29T15:00:00.000Z";
  const serverSnapshot = sanitizeApplications([
    { id: "record-a", title: "Record A", notes: "newer server A", createdAt: canonicalCreatedAt, updatedAt: revisionA },
    { id: "record-b", title: "Record B", notes: "server B", createdAt: canonicalCreatedAt, updatedAt: revisionB }
  ]);
  const fullClientSnapshot = sanitizeApplications([
    { id: "record-a", title: "Record A", notes: "stale client A", createdAt: canonicalCreatedAt, updatedAt: revisionA },
    { id: "record-b", title: "Record B", notes: "client B", createdAt: canonicalCreatedAt, updatedAt: revisionBNext }
  ]);
  const sparseClientSnapshot = [fullClientSnapshot[1]];
  const reconciled = reconcileApplicationMutations(serverSnapshot, sparseClientSnapshot, [
    { id: "record-b", operation: "upsert", baseUpdatedAt: revisionB }
  ]);
  if (reconciled.find((application) => application.id === "record-a")?.notes !== "newer server A") {
    failures.push("an unmutated stale row overwrote a newer server row");
  }
  if (reconciled.find((application) => application.id === "record-b")?.notes !== "client B") {
    failures.push("a revision-matched mutation did not apply");
  }
  if (reconciled.map((application) => application.id).join(",") !== "record-a,record-b") {
    failures.push("an edited existing row did not retain its server list position");
  }

  let fullSnapshotRejected = false;
  try {
    reconcileApplicationMutations(serverSnapshot, fullClientSnapshot, [
      { id: "record-b", operation: "upsert", baseUpdatedAt: revisionB }
    ]);
  } catch (error) {
    fullSnapshotRejected =
      error instanceof ApplicationsStorageError &&
      error.status === 400;
  }
  if (!fullSnapshotRejected) {
    failures.push("a retired full-snapshot mutation request was accepted");
  }

  const newRecords = sanitizeApplications([
    { id: "record-new-b", title: "New B", createdAt: revisionBNext, updatedAt: revisionBNext },
    { id: "record-new-a", title: "New A", createdAt: revisionC, updatedAt: revisionC }
  ]);
  const withNewRecords = reconcileApplicationMutations(serverSnapshot, newRecords, [
    { id: "record-new-b", operation: "upsert", baseUpdatedAt: null },
    { id: "record-new-a", operation: "upsert", baseUpdatedAt: null }
  ]);
  if (withNewRecords.map((application) => application.id).join(",") !== "record-new-b,record-new-a,record-a,record-b") {
    failures.push("multiple new upserts were not prepended in incoming order");
  }

  const mergeSnapshot = sanitizeApplications([
    { id: "record-a", title: "Record A", createdAt: canonicalCreatedAt, updatedAt: revisionA },
    { id: "record-b", title: "Record B", createdAt: canonicalCreatedAt, updatedAt: revisionB },
    { id: "record-c", title: "Record C", createdAt: canonicalCreatedAt, updatedAt: revisionC },
    { id: "record-d", title: "Record D", createdAt: canonicalCreatedAt, updatedAt: revisionD }
  ]);
  const mergedCanonical = sanitizeApplications([
    { id: "record-c", title: "Record C", notes: "merged", createdAt: canonicalCreatedAt, updatedAt: revisionCNext }
  ]);
  const merged = reconcileApplicationMutations(mergeSnapshot, mergedCanonical, [
    { id: "record-c", operation: "upsert", baseUpdatedAt: revisionC },
    { id: "record-b", operation: "delete", baseUpdatedAt: revisionB }
  ]);
  if (
    merged.map((application) => application.id).join(",") !== "record-a,record-c,record-d" ||
    merged[1]?.notes !== "merged"
  ) {
    failures.push("a merge did not retain the canonical record's server position");
  }

  let conflictRejected = false;
  try {
    reconcileApplicationMutations(serverSnapshot, sparseClientSnapshot, [
      { id: "record-b", operation: "upsert", baseUpdatedAt: "stale-revision" }
    ]);
  } catch (error) {
    conflictRejected =
      error instanceof ApplicationsStorageError &&
      error.status === 409 &&
      error.currentApplications?.[1]?.updatedAt === revisionB;
  }
  if (!conflictRejected) failures.push("a stale same-record mutation did not return the current 409 snapshot");

  let reusedRevisionRejected = false;
  try {
    reconcileApplicationMutations(serverSnapshot, serverSnapshot, [
      { id: "record-b", operation: "upsert", baseUpdatedAt: revisionB }
    ]);
  } catch (error) {
    reusedRevisionRejected = error instanceof ApplicationsStorageError && error.status === 400;
  }
  if (!reusedRevisionRejected) failures.push("an upsert reused its optimistic-concurrency revision");

  let olderRevisionRejected = false;
  try {
    const older = sanitizeApplications([
      {
        id: "record-b",
        title: "Record B",
        createdAt: canonicalCreatedAt,
        updatedAt: revisionA
      }
    ]);
    reconcileApplicationMutations(serverSnapshot, older, [
      { id: "record-b", operation: "upsert", baseUpdatedAt: revisionB }
    ]);
  } catch (error) {
    olderRevisionRejected =
      error instanceof ApplicationsStorageError && error.status === 400;
  }
  if (!olderRevisionRejected) {
    failures.push("an upsert moved its optimistic-concurrency revision backward");
  }

  let collisionRejected = false;
  try {
    reconcileApplicationMutations(serverSnapshot, sparseClientSnapshot, [
      { id: "record-b", operation: "upsert", baseUpdatedAt: null }
    ]);
  } catch (error) {
    collisionRejected = error instanceof ApplicationsStorageError && error.status === 409;
  }
  if (!collisionRejected) failures.push("a new-record id collision overwrote an existing row");

  const deleted = reconcileApplicationMutations(serverSnapshot, [], [
    { id: "record-a", operation: "delete", baseUpdatedAt: revisionA }
  ]);
  if (deleted.some((application) => application.id === "record-a")) {
    failures.push("a revision-matched delete did not remove its row");
  }

  const invalidCurrentShapes = [
    { id: "missing-created", title: "Missing created", updatedAt: canonicalUpdatedAt },
    { id: "missing-updated", title: "Missing updated", createdAt: canonicalCreatedAt },
    { id: "invalid-updated", title: "Invalid updated", createdAt: canonicalCreatedAt, updatedAt: "not-a-date" },
    { id: "retired-resume", title: "Retired resume", createdAt: canonicalCreatedAt, updatedAt: canonicalUpdatedAt, resumeData: {} },
    { id: "retired-text", title: "Retired text", createdAt: canonicalCreatedAt, updatedAt: canonicalUpdatedAt, polishedText: "legacy" },
    {
      id: "retired-artifact",
      title: "Retired artifact",
      createdAt: canonicalCreatedAt,
      updatedAt: canonicalUpdatedAt,
      resumeArtifacts: { hasSource: true, hasPdf: false, hasTex: false }
    },
    {
      id: "impossible-artifact",
      title: "Impossible artifact",
      createdAt: canonicalCreatedAt,
      updatedAt: canonicalUpdatedAt,
      resumeArtifacts: { hasSource: true, hasPdf: true }
    }
  ];
  for (const invalid of invalidCurrentShapes) {
    let rejected = false;
    try {
      await writeApplications(workspace, [invalid]);
    } catch (error) {
      rejected = error instanceof ApplicationsStorageError && error.status === 400;
    }
    if (!rejected) failures.push(`invalid current tracker shape was accepted: ${invalid.id}`);
  }

  // Corruption must fail closed and remain byte-for-byte recoverable. Returning
  // [] here would let the next save overwrite the user's tracker as if it were
  // intentionally empty.
  const filePath = applicationsFilePath(workspace);
  await writeFile(filePath, JSON.stringify({ applications: [
    { id: "duplicate", title: "First", createdAt: canonicalCreatedAt, updatedAt: canonicalUpdatedAt },
    { id: "duplicate", title: "Second", createdAt: canonicalCreatedAt, updatedAt: canonicalUpdatedAt }
  ] }), "utf8");
  let duplicateDiskRejected = false;
  try {
    await readApplications(workspace);
  } catch (error) {
    duplicateDiskRejected = error instanceof ApplicationsStorageError;
  }
  if (!duplicateDiskRejected) failures.push("duplicate ids in applications.json did not fail closed");

  for (const invalid of [
    {
      id: "retired-on-disk",
      title: "Retired on disk",
      createdAt: canonicalCreatedAt,
      updatedAt: canonicalUpdatedAt,
      coverLetterText: "legacy"
    },
    {
      id: "impossible-on-disk",
      title: "Impossible on disk",
      createdAt: canonicalCreatedAt,
      updatedAt: canonicalUpdatedAt,
      coverLetterArtifacts: { hasPdf: true, hasSource: true }
    }
  ]) {
    await writeFile(
      filePath,
      JSON.stringify({ applications: [invalid] }),
      "utf8"
    );
    let rejected = false;
    try {
      await readApplications(workspace);
    } catch (error) {
      rejected = error instanceof ApplicationsStorageError;
    }
    if (!rejected) {
      failures.push(`invalid on-disk tracker shape did not fail closed: ${invalid.id}`);
    }
  }

  await writeFile(filePath, "{not valid json", "utf8");
  const corruptBytes = await readFile(filePath, "utf8");
  let corruptRejected = false;
  try {
    await readApplications(workspace);
  } catch (error) {
    corruptRejected = error instanceof ApplicationsStorageError;
  }
  if (!corruptRejected) failures.push("corrupted tracker did not fail closed");
  if (await readFile(filePath, "utf8") !== corruptBytes) failures.push("corrupted tracker bytes were changed");

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("sanitize-applications probes passed");
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}
