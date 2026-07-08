import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readApplications, writeApplications } from "../index.ts";

const workspace = await mkdtemp(join(tmpdir(), "rolefit-applications-"));

try {
  const written = await writeApplications(workspace, [
    {
      id: "app_valid-123",
      title: "Valid application",
      jobUrl: "https://example.com/job",
      status: "applied",
      review: {
        verdict: "STRETCH",
        gaps: [{ gap: "Active Secret clearance", severity: "CRITICAL", evidenceType: "none" }]
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
  ]);

  const read = await readApplications(workspace);
  const failures = [];
  const valid = read[0];
  const emptyAi = read.find((a) => a.id === "app_empty-ai");

  if (written.length !== 2 || read.length !== 2) failures.push("invalid ids are not dropped");
  if (valid?.id !== "app_valid-123") failures.push("valid id did not persist");
  if (valid?.review?.gaps?.[0]?.severity !== "MEDIUM") failures.push("invalid review severity was not normalized");
  if (valid?.resumeData?.ignored) failures.push("unknown resume data fields survived");
  if (valid?.resumeData?.sections?.[0]?.type !== "skills") failures.push("resume section type was not inferred");

  // rawJobDescription roundtrips (trimmed via slice, not .trim()).
  if (valid?.rawJobDescription !== "  Raw JD text here.  ") failures.push("rawJobDescription did not persist");

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

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("sanitize-applications probes passed");
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}
