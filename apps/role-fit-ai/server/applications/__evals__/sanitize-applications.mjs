import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationsStorageError,
  applicationsFilePath,
  readApplications,
  reconcileApplicationMutations,
  sanitizeApplications,
  writeApplications
} from "../index.ts";

const workspace = await mkdtemp(join(tmpdir(), "rolefit-applications-"));

try {
  const rawApplications = [
    {
      id: "app_valid-123",
      title: "Valid application",
      jobUrl: "https://example.com/job",
      status: "applied",
      review: {
        verdict: "STRETCH",
        gaps: [
          { gap: "Active Secret clearance", severity: "CRITICAL", evidenceType: "none" },
          { gap: "PostgreSQL", severity: "HIGH", evidenceType: "exact", canHonestlyAdd: "false" }
        ]
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
      resumeArtifacts: { hasPdf: "false", hasTex: "false", fileName: "phantom.pdf" },
      coverLetterArtifacts: { hasPdf: true, hasSource: true, fileName: "letter.pdf", savedAt: "2026-07-27T00:00:00.000Z" },
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
      },
      resumeData: {
        header: { visible: false, name: "", contact: ["candidate@example.com"] },
        sections: [{ id: "sec-1", heading: "Technical Skills", items: [] }]
      },
      polishedText: "retired flattened resume",
      coverLetterText: "retired flattened letter"
    },
    {
      id: "../escape",
      title: "Invalid id",
      status: "interested"
    },
    {
      // Empty aiUsage (no valid entries) → undefined.
      id: "app_empty-ai",
      title: "Empty AI usage",
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
  if (valid?.review?.gaps?.length !== 1 || valid.review.gaps[0]?.severity !== "HIGH") {
    failures.push("invalid review severity was normalized into a fabricated judgment");
  }
  if (valid?.review?.gaps?.[0]?.canHonestlyAdd !== false) failures.push("string review boolean became an affirmative judgment");
  if (
    Object.hasOwn(valid ?? {}, "resumeData") ||
    Object.hasOwn(valid ?? {}, "polishedText") ||
    Object.hasOwn(valid ?? {}, "coverLetterText")
  ) {
    failures.push("retired duplicate document models survived tracker sanitization");
  }
  const noncanonicalHeaders = sanitizeApplications([
    {
      id: "legacy-flat-header",
      title: "Legacy flat header",
      resumeData: {
        name: "Must not hydrate at runtime",
        contact: ["legacy@example.test"],
        sections: [{ heading: "Experience", items: [] }]
      }
    },
    {
      id: "empty-structural-header",
      title: "Empty structural header",
      resumeData: {
        header: { visible: true, name: null, contact: [] },
        sections: [{ heading: "Experience", items: [] }]
      }
    }
  ]);
  if (noncanonicalHeaders.some((application) => Object.hasOwn(application, "resumeData"))) {
    failures.push("runtime tracker sanitization retained a retired resume snapshot");
  }

  // rawJobDescription roundtrips (trimmed via slice, not .trim()).
  if (valid?.rawJobDescription !== "  Raw JD text here.  ") failures.push("rawJobDescription did not persist");
  if (valid?.resumeArtifacts !== undefined) failures.push("string artifact booleans created a phantom saved file");

  // The cover letter's artifacts carry the same shape as the resume's, so the
  // tracker can never describe one document more richly than the other.
  if (valid?.coverLetterArtifacts?.hasPdf !== true || valid?.coverLetterArtifacts?.hasSource !== true) {
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
      title: `Overflow ${index}`
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
      { id: "duplicate", title: "First" },
      { id: "duplicate", title: "Second" }
    ]));
  } catch (error) {
    duplicateWriteRejected = error instanceof ApplicationsStorageError && error.status === 400;
  }
  if (!duplicateWriteRejected) failures.push("duplicate application ids were accepted for storage");

  const serverSnapshot = sanitizeApplications([
    { id: "record-a", title: "Record A", notes: "newer server A", updatedAt: "revision-a" },
    { id: "record-b", title: "Record B", notes: "server B", updatedAt: "revision-b" }
  ]);
  const fullClientSnapshot = sanitizeApplications([
    { id: "record-a", title: "Record A", notes: "stale client A", updatedAt: "revision-a" },
    { id: "record-b", title: "Record B", notes: "client B", updatedAt: "revision-b-next" }
  ]);
  const sparseClientSnapshot = [fullClientSnapshot[1]];
  const reconciled = reconcileApplicationMutations(serverSnapshot, sparseClientSnapshot, [
    { id: "record-b", operation: "upsert", baseUpdatedAt: "revision-b" }
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
      { id: "record-b", operation: "upsert", baseUpdatedAt: "revision-b" }
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
    { id: "record-new-b", title: "New B", updatedAt: "new-b-revision" },
    { id: "record-new-a", title: "New A", updatedAt: "new-a-revision" }
  ]);
  const withNewRecords = reconcileApplicationMutations(serverSnapshot, newRecords, [
    { id: "record-new-b", operation: "upsert", baseUpdatedAt: null },
    { id: "record-new-a", operation: "upsert", baseUpdatedAt: null }
  ]);
  if (withNewRecords.map((application) => application.id).join(",") !== "record-new-b,record-new-a,record-a,record-b") {
    failures.push("multiple new upserts were not prepended in incoming order");
  }

  const mergeSnapshot = sanitizeApplications([
    { id: "record-a", title: "Record A", updatedAt: "revision-a" },
    { id: "record-b", title: "Record B", updatedAt: "revision-b" },
    { id: "record-c", title: "Record C", updatedAt: "revision-c" },
    { id: "record-d", title: "Record D", updatedAt: "revision-d" }
  ]);
  const mergedCanonical = sanitizeApplications([
    { id: "record-c", title: "Record C", notes: "merged", updatedAt: "revision-c-next" }
  ]);
  const merged = reconcileApplicationMutations(mergeSnapshot, mergedCanonical, [
    { id: "record-c", operation: "upsert", baseUpdatedAt: "revision-c" },
    { id: "record-b", operation: "delete", baseUpdatedAt: "revision-b" }
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
      error.currentApplications?.[1]?.updatedAt === "revision-b";
  }
  if (!conflictRejected) failures.push("a stale same-record mutation did not return the current 409 snapshot");

  let reusedRevisionRejected = false;
  try {
    reconcileApplicationMutations(serverSnapshot, serverSnapshot, [
      { id: "record-b", operation: "upsert", baseUpdatedAt: "revision-b" }
    ]);
  } catch (error) {
    reusedRevisionRejected = error instanceof ApplicationsStorageError && error.status === 400;
  }
  if (!reusedRevisionRejected) failures.push("an upsert reused its optimistic-concurrency revision");

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
    { id: "record-a", operation: "delete", baseUpdatedAt: "revision-a" }
  ]);
  if (deleted.some((application) => application.id === "record-a")) {
    failures.push("a revision-matched delete did not remove its row");
  }

  // Legacy records without updatedAt need a stable first-edit revision. Using
  // the read time here would make GET return t1 and PUT compare against t2,
  // causing the row's first edit to conflict with itself. Empty strings are
  // legacy-missing too; they must not survive as an unmatchable revision.
  const legacyCreatedAt = "2024-01-02T03:04:05.000Z";
  const legacyWithCreatedAt = sanitizeApplications([
    { id: "legacy-created", title: "Legacy created", createdAt: legacyCreatedAt, updatedAt: "" }
  ])[0];
  const legacyUndatedFirst = sanitizeApplications([
    { id: "legacy-undated", title: "Legacy undated" }
  ])[0];
  const legacyUndatedSecond = sanitizeApplications([
    { id: "legacy-undated", title: "Legacy undated" }
  ])[0];
  if (legacyWithCreatedAt?.updatedAt !== legacyCreatedAt) {
    failures.push("a legacy row did not reuse createdAt as its stable migration revision");
  }
  if (!legacyUndatedFirst?.updatedAt || legacyUndatedFirst.updatedAt !== legacyUndatedSecond?.updatedAt) {
    failures.push("an undated legacy row received an unstable read-time revision");
  }

  const RealDate = globalThis.Date;
  const dateAt = (iso) => class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [iso]));
    }
    static now() {
      return new RealDate(iso).getTime();
    }
  };
  const undatedRaw = [{
    id: "deterministic-read",
    title: "Deterministic read",
    sourceUrls: [{ url: "https://example.com/alternate" }],
    attachments: [{ fileName: "work-sample.pdf", label: "Work sample", size: 1 }],
    resumeArtifacts: { hasSource: true, fileName: "resume.resume" }
  }];
  globalThis.Date = dateAt("2026-07-29T10:00:00.000Z");
  const deterministicFirst = sanitizeApplications(undatedRaw);
  globalThis.Date = dateAt("2026-07-29T11:00:00.000Z");
  const deterministicSecond = sanitizeApplications(undatedRaw);
  globalThis.Date = RealDate;
  if (JSON.stringify(deterministicFirst) !== JSON.stringify(deterministicSecond)) {
    failures.push("the same stored application input sanitizes differently at different read times");
  }

  // Corruption must fail closed and remain byte-for-byte recoverable. Returning
  // [] here would let the next save overwrite the user's tracker as if it were
  // intentionally empty.
  const filePath = applicationsFilePath(workspace);
  await writeFile(filePath, JSON.stringify({ applications: [
    { id: "duplicate", title: "First" },
    { id: "duplicate", title: "Second" }
  ] }), "utf8");
  let duplicateDiskRejected = false;
  try {
    await readApplications(workspace);
  } catch (error) {
    duplicateDiskRejected = error instanceof ApplicationsStorageError;
  }
  if (!duplicateDiskRejected) failures.push("duplicate ids in applications.json did not fail closed");

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
