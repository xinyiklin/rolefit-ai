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
      resumeArtifacts: { hasPdf: "false", hasTex: "false", fileName: "phantom.pdf" },
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
        name: "Candidate",
        ignored: "drop me",
        sections: [
          {
            id: "sec-1",
            heading: "Technical Skills",
            type: "nonsense",
            items: [{ id: "entry-1", titleLeft: "", bullets: [{ id: "b-1", text: "React" }] }]
          }
        ]
      }
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
  if (valid?.resumeData?.ignored) failures.push("unknown resume data fields survived");
  if (valid?.resumeData?.sections?.[0]?.type !== "skills") failures.push("resume section type was not inferred");

  // rawJobDescription roundtrips (trimmed via slice, not .trim()).
  if (valid?.rawJobDescription !== "  Raw JD text here.  ") failures.push("rawJobDescription did not persist");
  if (valid?.resumeArtifacts !== undefined) failures.push("string artifact booleans created a phantom saved file");

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
  const clientSnapshot = sanitizeApplications([
    { id: "record-a", title: "Record A", notes: "stale client A", updatedAt: "revision-a" },
    { id: "record-b", title: "Record B", notes: "client B", updatedAt: "revision-b-next" }
  ]);
  const reconciled = reconcileApplicationMutations(serverSnapshot, clientSnapshot, [
    { id: "record-b", operation: "upsert", baseUpdatedAt: "revision-b" }
  ]);
  if (reconciled.find((application) => application.id === "record-a")?.notes !== "newer server A") {
    failures.push("an unmutated stale row overwrote a newer server row");
  }
  if (reconciled.find((application) => application.id === "record-b")?.notes !== "client B") {
    failures.push("a revision-matched mutation did not apply");
  }

  let conflictRejected = false;
  try {
    reconcileApplicationMutations(serverSnapshot, clientSnapshot, [
      { id: "record-b", operation: "upsert", baseUpdatedAt: "stale-revision" }
    ]);
  } catch (error) {
    conflictRejected =
      error instanceof ApplicationsStorageError &&
      error.status === 409 &&
      error.currentApplications?.[1]?.updatedAt === "revision-b";
  }
  if (!conflictRejected) failures.push("a stale same-record mutation did not return the current 409 snapshot");

  let collisionRejected = false;
  try {
    reconcileApplicationMutations(serverSnapshot, clientSnapshot, [
      { id: "record-b", operation: "upsert", baseUpdatedAt: null }
    ]);
  } catch (error) {
    collisionRejected = error instanceof ApplicationsStorageError && error.status === 409;
  }
  if (!collisionRejected) failures.push("a new-record id collision overwrote an existing row");

  const deleted = reconcileApplicationMutations(serverSnapshot, [serverSnapshot[1]], [
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
