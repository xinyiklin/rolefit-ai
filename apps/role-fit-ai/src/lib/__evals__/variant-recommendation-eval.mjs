import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const entry = fileURLToPath(new URL("../variantRecommendation.ts", import.meta.url));
const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const module = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const { recommendVariant } = module;

const job = `
Platform Engineer
Required Qualifications
TypeScript, Node.js, React, AWS, Docker, Kubernetes, PostgreSQL, Terraform.
Build cloud APIs and improve backend service reliability.
`;

const recommendation = recommendVariant(job, [
  {
    fileName: "general.resume",
    label: "General SDE",
    text: "Software engineer with Java, Python, SQL, testing, algorithms, and data structures experience.".repeat(3)
  },
  {
    fileName: "fullstack.resume",
    label: "Full-stack",
    text: "Full-stack engineer using TypeScript, Node.js, React, AWS, Docker, Kubernetes, PostgreSQL, Terraform, cloud APIs, and backend services.".repeat(
      3
    )
  }
]);

assert.equal(recommendation?.fileName, "fullstack.resume");
assert.ok((recommendation?.lead ?? 0) >= 2);
assert.ok(recommendation?.matchedKeywords.includes("typescript"));

const ambiguous = recommendVariant("Build reliable software with testing.", [
  {
    fileName: "one.resume",
    label: "One",
    text: "Built reliable software and automated testing.".repeat(4)
  },
  {
    fileName: "two.resume",
    label: "Two",
    text: "Built reliable software and automated testing.".repeat(4)
  }
]);
assert.equal(ambiguous, null, "an exact tie is not presented as a recommendation");

const weightedRecommendation = recommendVariant(
  `
Job Title:
Backend Engineer

Company / Product Context:
React AWS frontend cloud JavaScript product.

Core Responsibilities:
- Build reliable services.

Required Qualifications:
- Python
- Django
- PostgreSQL

Preferred Qualifications:
- React
- AWS
- JavaScript

Tech Stack / Keywords:
- Python
- Django
- PostgreSQL

Seniority Signals:
Not specified

Domain Signals:
Not specified
`,
  [
    {
      fileName: "broad.resume",
      label: "Broad",
      text: "React AWS frontend cloud JavaScript engineer.".repeat(4)
    },
    {
      fileName: "backend.resume",
      label: "Backend",
      text: "Backend engineer using Python, Django, and PostgreSQL.".repeat(4)
    }
  ]
);
assert.equal(
  weightedRecommendation?.fileName,
  "backend.resume",
  "required qualifications and tech-stack signals outweigh incidental context matches"
);

const incomplete = recommendVariant(
  job,
  [
    {
      fileName: "fullstack.resume",
      label: "Full-stack",
      text: "Full-stack engineer using TypeScript, Node.js, React, AWS, Docker, Kubernetes, PostgreSQL, Terraform, cloud APIs, and backend services.".repeat(
        3
      )
    }
  ],
  2
);
assert.equal(
  incomplete,
  null,
  "an incomplete comparison cannot recommend or auto-select its sole survivor"
);

assert.equal(
  recommendVariant(job, [{ fileName: "empty.resume", label: "Empty", text: "short" }]),
  null,
  "unusable resume files are not recommended"
);

// Cover letters are a second real consumer: short prose, ranked from the same
// prepared job. The winner must still be the closest letter even though the
// coverage a 150-word letter can reach never earns high confidence.
const coverRecommendation = recommendVariant(
  job,
  [
    {
      fileName: "healthcare.cover",
      label: "Healthcare",
      text: "I have spent four years building clinical intake software for hospital networks, working closely with care teams on scheduling and compliance."
    },
    {
      fileName: "platform.cover",
      label: "Platform",
      text: "I build cloud APIs in TypeScript and Node.js, run services on AWS with Docker and Kubernetes, and keep backend reliability measurable."
    }
  ],
  2,
  40
);
assert.equal(coverRecommendation?.fileName, "platform.cover", "the closest cover letter wins on the same signal");
assert.ok(
  (coverRecommendation?.lead ?? 0) > 0,
  "a cover-letter recommendation still reports its lead over the runner-up"
);

assert.equal(
  recommendVariant(job, [{ fileName: "stub.cover", label: "Stub", text: "Dear hiring team," }], 1, 40),
  null,
  "a letter shorter than its own usable floor is not recommended"
);

console.log("Variant recommendation eval passed");
