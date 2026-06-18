import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readApplications, writeApplications } from "../index.mjs";

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
    }
  ]);

  const read = await readApplications(workspace);
  const failures = [];
  const valid = read[0];

  if (written.length !== 1 || read.length !== 1) failures.push("invalid ids are not dropped");
  if (valid?.id !== "app_valid-123") failures.push("valid id did not persist");
  if (valid?.review?.gaps?.[0]?.severity !== "MEDIUM") failures.push("invalid review severity was not normalized");
  if (valid?.resumeData?.ignored) failures.push("unknown resume data fields survived");
  if (valid?.resumeData?.sections?.[0]?.type !== "skills") failures.push("resume section type was not inferred");

  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("sanitize-applications probes passed");
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}
